/**
 * Backfill period snapshots for all recurring KPIs (current checklist state).
 * Run after enabling snapshot metrics: npx tsx scripts/backfill-kpi-period-snapshots.ts
 */
import { normalizeTimeZone } from "../src/modules/tasks/kpi-recurrence";
import { upsertKpiPeriodSnapshot } from "../src/modules/tasks/kpi-period-snapshots";
import { prisma } from "../src/modules/platform/db/prisma";

const timeZone = normalizeTimeZone(process.env.KPI_SNAPSHOT_TZ ?? "Asia/Manila");

async function main() {
  const rows = await prisma.kpiMaintenance.findMany({
    where: { isRecurring: true },
    select: {
      id: true,
      title: true,
      frequency: true,
      subKpis: true,
      periodKey: true,
      recurrenceWeekday: true,
      recurrenceMonthDay: true,
      periodCycleStartAt: true,
      isRecurring: true,
      assignedAgent: { select: { id: true, name: true } },
    },
  });

  let count = 0;
  for (const row of rows) {
    await upsertKpiPeriodSnapshot(row, timeZone);
    count += 1;
  }

  console.log(`Backfilled ${count} KPI period snapshot(s) (tz=${timeZone}).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
