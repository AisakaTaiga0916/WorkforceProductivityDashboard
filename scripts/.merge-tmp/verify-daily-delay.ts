/**
 * Verify the board's Delayed handling for real DAILY recurring tasks.
 *
 * Replicates kpi-kanban-flow.tsx statusOf()/progress() against the live DB and
 * reports which daily tasks land in DELAYED / CURRENT / DONE under the new
 * rollover policy (DAILY has no 10-day incomplete hold).
 *
 * Usage:
 *   npx tsx scripts/.merge-tmp/verify-daily-delay.ts
 */
import { KpiFrequency } from "@prisma/client/primary";

import { prisma } from "../../src/lib/prisma";
import { getPeriodStartInclusive } from "../../src/lib/kpi-period-window";
import {
  computePeriodKey,
  normalizeTimeZone,
} from "../../src/lib/kpi-recurrence";
import {
  recurringIncompleteRolloverEligibleAt,
  recurringIncompleteRolloverHoldDays,
  recurringTaskHasDelay,
  taskKanbanDerivedStatus,
} from "../../src/lib/kpi-cycle-state";
import {
  getPeriodEndExclusiveFromCycleStart,
  type KpiFrequencyCode,
} from "../../src/lib/kpi-recurrence";
import { isItProjectImplementationPillar } from "../../src/lib/it-task-pillar-titles";
import { usesProjectTimelineTracker } from "../../src/lib/it-project-subkpis";
import {
  kpiChecklistMetricView,
  kpiChecklistProgress,
  taskUsesInvertedRecording,
} from "../../src/lib/kpi-subkpis";
import { kpiMainTaskLabel } from "../../src/lib/kpi-main-task";

const TZ = normalizeTimeZone(
  process.env.KPI_SNAPSHOT_TZ ?? process.env.REPORT_TZ ?? process.env.APP_TIME_ZONE ?? "Asia/Manila",
);
const nowMs = Date.now();
const now = new Date(nowMs);

async function main() {
  const rows = await prisma.kpiMaintenance.findMany({
    where: { isRecurring: true, frequency: KpiFrequency.DAILY },
    orderBy: { title: "asc" },
    include: { assignedAgent: { select: { id: true, name: true } } },
  });

  console.log(`DAILY recurring tasks: ${rows.length}  (tz=${TZ}, now=${now.toISOString()})\n`);

  const currentCycleStart = getPeriodStartInclusive("DAILY", null, null, now, TZ);
  const expectedKey = computePeriodKey("DAILY", null, null, now, TZ);
  console.log(`current period start=${currentCycleStart.toISOString()}  expectedKey=${expectedKey}\n`);

  let delayed = 0;
  for (const r of rows) {
    const label = (r.mainTask?.trim() || r.title).slice(0, 52);
    const isTimeline = isItProjectImplementationPillar(r.title) || usesProjectTimelineTracker(r.subKpis);

    const raw = r.subKpis as unknown;
    const p = kpiChecklistProgress(raw, kpiMainTaskLabel(r));
    const view = kpiChecklistMetricView(
      p,
      taskUsesInvertedRecording({ title: r.title, subKpis: raw }),
    );

    const status = (() => {
      if (view.inverted && !isTimeline) {
        if (taskKanbanDerivedStatus(r, { total: view.total, done: 0, nowMs, timeZone: TZ }) === "DELAYED") {
          return "DELAYED";
        }
        return "CURRENT";
      }
      return taskKanbanDerivedStatus(r, { total: view.total, done: view.done, nowMs, timeZone: TZ });
    })();

    const hasDelay = recurringTaskHasDelay(r, nowMs, TZ);
    const holdDays = recurringIncompleteRolloverHoldDays(r.frequency as KpiFrequencyCode);

    const anchor = r.periodCycleStartAt ?? getPeriodStartInclusive("DAILY", null, null, r.createdAt, TZ);
    const staleCycle = currentCycleStart.getTime() > anchor.getTime();
    const cycleDeadline = getPeriodEndExclusiveFromCycleStart(
      anchor,
      "DAILY",
      null,
      null,
      TZ,
    );
    const holdUntil = recurringIncompleteRolloverEligibleAt(
      cycleDeadline,
      TZ,
      recurringIncompleteRolloverHoldDays("DAILY"),
    );
    const rolloverNow = staleCycle && now.getTime() >= holdUntil.getTime();

    if (status === "DELAYED") delayed += 1;

    console.log(
      [
        `[${status.padEnd(7)}]`,
        hasDelay ? "delay=Y" : "delay=N",
        `roll=${rolloverNow ? "NOW" : staleCycle ? "not-yet" : "current"}`,
        `done=${view.done}/${view.total}`,
        `hold=${holdDays}d`,
        `key=${r.periodKey}${r.periodKey === expectedKey ? "" : ` (expect ${expectedKey})`}`,
        `anchor=${anchor.toISOString().slice(0, 16)}`,
        label,
      ].join("  "),
    );
  }

  console.log(`\nDelayed in board: ${delayed}/${rows.length}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
