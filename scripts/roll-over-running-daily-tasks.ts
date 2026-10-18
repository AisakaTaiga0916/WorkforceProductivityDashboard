/**
 * Roll currently running DAILY recurring KPI tasks over to the current period now.
 *
 * Replicates the Task Board GET route's stale-cycle rollover under the new policy:
 * DAILY cadence has no 10-day incomplete hold, so a stale cycle rolls immediately
 * (snapshot the finished period, reset the checklist, advance periodCycleStartAt /
 * periodKey to the current period).
 *
 * Usage:
 *   npx tsx scripts/roll-over-running-daily-tasks.ts                      # apply
 *   npx tsx scripts/roll-over-running-daily-tasks.ts --dry-run            # preview only
 *   npx tsx scripts/roll-over-running-daily-tasks.ts --title="SYSTEMS AVAILABILITY"
 */
import { KpiFrequency } from "@prisma/client/primary";

import { prisma } from "../src/modules/platform/db/prisma";
import { getPeriodStartInclusive } from "../src/modules/tasks/kpi-period-window";
import {
  computePeriodKey,
  getPeriodEndExclusiveFromCycleStart,
  isLegacyPeriodKey,
  normalizeTimeZone,
  type KpiFrequencyCode,
} from "../src/modules/tasks/kpi-recurrence";
import {
  recurringIncompleteRolloverEligibleAt,
  recurringIncompleteRolloverHoldDays,
} from "../src/modules/tasks/kpi-cycle-state";
import { upsertKpiPeriodSnapshot } from "../src/modules/tasks/kpi-period-snapshots";
import {
  collectChecklistProgressItems,
  hasItemsInUnassignedSegment,
  resetAllSubKpiDone,
} from "../src/modules/tasks/kpi-subkpis";
import { subKpiRequirementsMet } from "../src/modules/tasks/sub-kpi-completion-mode";
import { kpiMainTaskLabel } from "../src/modules/tasks/kpi-main-task";

const FREQ = "DAILY" as KpiFrequencyCode;

function parseArgs(argv: string[]) {
  const flags = new Map<string, string>();
  for (const a of argv) {
    if (!a.startsWith("--")) continue;
    const [k, v] = a.replace(/^--/, "").split("=", 2);
    flags.set(k, v ?? "1");
  }
  return flags;
}

function checklistFullyComplete(subKpis: unknown, taskTitle?: string): boolean {
  // Segmented tasks cannot finalize while cards remain on Unassigned.
  if (hasItemsInUnassignedSegment(subKpis)) return false;
  const items = collectChecklistProgressItems(subKpis, taskTitle);
  if (items.length === 0) return false;
  return items.every((x) => subKpiRequirementsMet(x));
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const dryRun = flags.get("dry-run") === "1";
  const titleFilter = flags.get("title")?.trim() || null;
  const timeZone = normalizeTimeZone(
    process.env.KPI_SNAPSHOT_TZ ?? process.env.REPORT_TZ ?? process.env.APP_TIME_ZONE ?? "Asia/Manila",
  );
  const now = new Date();

  const rows = await prisma.kpiMaintenance.findMany({
    where: {
      isRecurring: true,
      frequency: KpiFrequency.DAILY,
      ...(titleFilter ? { title: { contains: titleFilter, mode: "insensitive" } } : {}),
    },
    orderBy: { title: "asc" },
    include: { assignedAgent: { select: { id: true, name: true } } },
  });

  console.log(`DAILY recurring tasks found: ${rows.length} (zone=${timeZone}, dryRun=${dryRun})`);
  if (rows.length === 0) return;

  const currentCycleStart = getPeriodStartInclusive(FREQ, null, null, now, timeZone);
  const expectedKey = computePeriodKey(FREQ, null, null, now, timeZone);
  console.log(
    `Current period start: ${currentCycleStart.toISOString()}  periodKey=${expectedKey}\n`,
  );

  let rolled = 0;
  let skipped = 0;
  let held = 0;

  for (const row of rows) {
    const label = row.mainTask?.trim() || row.title;
    const anchor =
      row.periodCycleStartAt ??
      getPeriodStartInclusive(FREQ, null, null, row.createdAt, timeZone);
    const staleCycle = currentCycleStart.getTime() > anchor.getTime();
    const complete = checklistFullyComplete(row.subKpis, kpiMainTaskLabel(row));

    if (!staleCycle) {
      console.log(`[SKIP]   ${label} — already on the current period (${row.periodKey})`);
      skipped += 1;
      continue;
    }

    const cycleDeadline = getPeriodEndExclusiveFromCycleStart(anchor, FREQ, null, null, timeZone);
    const holdUntil = recurringIncompleteRolloverEligibleAt(
      cycleDeadline,
      timeZone,
      recurringIncompleteRolloverHoldDays(FREQ),
    );
    if (!complete && now.getTime() < holdUntil.getTime()) {
      console.log(
        `[HOLD]   ${label} — cycle stale but not yet eligible (rolls after ${holdUntil.toISOString()})`,
      );
      held += 1;
      continue;
    }

    const snapshotPeriodKey =
      row.periodKey && !isLegacyPeriodKey(row.periodKey)
        ? row.periodKey
        : computePeriodKey(FREQ, null, null, anchor, timeZone);

    console.log(
      `[${dryRun ? "WOULD ROLL" : "ROLL"}] ${label}  (${row.periodKey} → ${expectedKey}, ` +
        `complete=${complete}, anchor=${anchor.toISOString()}, snapshotKey=${snapshotPeriodKey})`,
    );

    if (dryRun) {
      rolled += 1;
      continue;
    }

    await upsertKpiPeriodSnapshot(
      {
        id: row.id,
        title: row.title,
        mainTask: row.mainTask,
        frequency: row.frequency,
        subKpis: row.subKpis,
        periodKey: row.periodKey,
        recurrenceWeekday: row.recurrenceWeekday,
        recurrenceMonthDay: row.recurrenceMonthDay,
        periodCycleStartAt: row.periodCycleStartAt,
        isRecurring: row.isRecurring,
        assignedAgent: row.assignedAgent ?? null,
      },
      timeZone,
      anchor,
      snapshotPeriodKey,
    );

    const res = await prisma.kpiMaintenance.updateMany({
      where: {
        id: row.id,
        periodKey: row.periodKey,
        periodCycleStartAt: row.periodCycleStartAt,
        lastFullCompletionAt: row.lastFullCompletionAt,
      },
      data: {
        subKpis: resetAllSubKpiDone(row.subKpis, {
          frequency: FREQ,
          recurrenceWeekday: null,
          recurrenceMonthDay: null,
          timeZone,
          fromCycleStart: anchor,
          toCycleStart: currentCycleStart,
        }),
        periodCycleStartAt: currentCycleStart,
        periodKey: expectedKey,
        lastFullCompletionAt: null,
        rolledOverIncomplete: !complete,
      },
    });
    if (res.count > 0) rolled += 1;
    else console.log(`       ${label} — update matched 0 rows (concurrent rollover skipped)`);
  }

  console.log(
    `\nDone: ${rolled} ${dryRun ? "would roll" : "rolled"}, ${skipped} already current, ${held} held (not yet eligible).`,
  );
  if (dryRun) console.log("Dry run only — no changes written.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
