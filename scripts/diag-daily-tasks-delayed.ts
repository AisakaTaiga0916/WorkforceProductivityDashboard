/**
 * Read-only diagnostic: why are daily recurring tasks showing as Delayed?
 *
 * Computes the same board status the Task Board uses (taskKanbanDerivedStatus)
 * for every recurring DAILY task, then prints the specific sub-task due dates
 * that pushed each Delayed card into the Delayed column.
 *
 * Run: npx tsx scripts/diag-daily-tasks-delayed.ts
 */
import { prisma } from "../src/modules/platform/db/prisma";
import {
  taskKanbanDerivedStatus,
  recurringTaskHasDelay,
  recurringIncompleteRolloverHoldDays,
  recurringDeadlineExclusive,
} from "../src/modules/tasks/kpi-cycle-state";
import {
  collectChecklistProgressItems,
  getTaskTargetDueDate,
  resolveEffectiveSubKpiDueDate,
  subKpiHasCustomDueDate,
} from "../src/modules/tasks/kpi-subkpis";
import { isNonRecurringSubKpiDelayed } from "../src/modules/tasks/kpi-cycle-state";
import { kpiChecklistProgress, kpiChecklistMetricView } from "../src/modules/tasks/kpi-subkpis";
import { kpiMainTaskLabel } from "../src/modules/tasks/kpi-main-task";
import { subKpiRequirementsMet } from "../src/modules/tasks/sub-kpi-completion-mode";
import { DEFAULT_TIME_ZONE } from "../src/modules/tasks/kpi-recurrence";
import type { KpiFrequencyCode } from "../src/modules/tasks/kpi-recurrence";

const TZ = DEFAULT_TIME_ZONE;

async function main() {
  const rows = await prisma.kpiMaintenance.findMany({
    where: { isRecurring: true, frequency: "DAILY" as KpiFrequencyCode },
    orderBy: { title: "asc" },
  });

  const nowMs = Date.now();
  console.log(`Daily recurring tasks in DB: ${rows.length}  (now=${new Date(nowMs).toISOString()}, tz=${TZ})`);

  let delayedCount = 0;
  let withCustomDue = 0;

  for (const row of rows) {
    const progress = kpiChecklistMetricView(
      kpiChecklistProgress(row.subKpis, kpiMainTaskLabel(row)),
      false,
    );
    const status = taskKanbanDerivedStatus(
      {
        title: row.title,
        isRecurring: row.isRecurring,
        frequency: row.frequency as KpiFrequencyCode,
        recurrenceWeekday: row.recurrenceWeekday,
        recurrenceMonthDay: row.recurrenceMonthDay,
        periodCycleStartAt: row.periodCycleStartAt,
        subKpis: row.subKpis,
      },
      { total: progress.total, done: progress.done, nowMs, timeZone: TZ },
    );

    const label = `${row.title}${row.mainTask ? ` — ${row.mainTask}` : ""}`;
    if (status !== "DELAYED") {
      console.log(`[${status.padEnd(7)}] ${label} (${progress.done}/${progress.total})`);
      continue;
    }
    delayedCount += 1;

    const parentDue = getTaskTargetDueDate(row.subKpis);
    const items = collectChecklistProgressItems(row.subKpis);
    const withDue = items.filter(
      (it) => resolveEffectiveSubKpiDueDate(it, parentDue).dueDate != null,
    );
    if (withDue.length > 0) withCustomDue += 1;

    const deadline = recurringDeadlineExclusive(
      {
        isRecurring: true,
        frequency: row.frequency as KpiFrequencyCode,
        recurrenceWeekday: row.recurrenceWeekday,
        recurrenceMonthDay: row.recurrenceMonthDay,
        periodCycleStartAt: row.periodCycleStartAt,
      },
      TZ,
    );

    console.log(`\n[DELAYED] ${label} (${progress.done}/${progress.total})`);
    console.log(
      `   periodKey=${row.periodKey} | cycleStart=${row.periodCycleStartAt?.toISOString() ?? "(null)"} | cycleDeadline=${deadline?.toISOString() ?? "(null)"}`,
    );
    for (const it of items) {
      const eff = resolveEffectiveSubKpiDueDate(it, parentDue);
      const delayed = isNonRecurringSubKpiDelayed(it, nowMs, TZ, parentDue);
      const complete = subKpiRequirementsMet(it);
      console.log(
        `   item="${it.title}" done=${it.done ?? false} complete=${complete} customDue=${it.dueDate ?? "(none)"}${it.dueDateRollsWithCycle ? " [rolls]" : ""} effectiveDue=${eff.dueDate ?? "(none)"} delayed=${delayed}`,
      );
    }
    console.log(
      `   parentTargetDue=${parentDue ?? "(none)"} | holdDays(DAILY)=${recurringIncompleteRolloverHoldDays("DAILY")} | recurringTaskHasDelay=${recurringTaskHasDelay(
        { isRecurring: true, frequency: "DAILY" as KpiFrequencyCode, periodCycleStartAt: row.periodCycleStartAt, subKpis: row.subKpis, recurrenceWeekday: row.recurrenceWeekday, recurrenceMonthDay: row.recurrenceMonthDay },
        nowMs,
        TZ,
      )}`,
    );
  }

  console.log(`\nSummary: ${delayedCount}/${rows.length} daily tasks are DELAYED; ${withCustomDue} of those have a custom/effective due date.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
