import { prisma } from "../../src/lib/prisma";
import { DateTime } from "luxon";
import { computeTaskMetrics } from "../../src/lib/kpis";

async function main() {
  const updated = await prisma.kpiMaintenance.updateMany({
    where: { title: "SYSTEM MAINTENANCE", isRecurring: true },
    data: {
      frequency: "MONTHLY",
      recurrenceWeekday: null,
      recurrenceMonthDay: 1,
    },
  });
  console.log(`Updated SYSTEM MAINTENANCE → MONTHLY (${updated.count} row(s))`);

  const snaps = await prisma.kpiMaintenancePeriodSnapshot.findMany({
    where: {
      kpiMaintenance: { title: "SYSTEM MAINTENANCE" },
      frequency: "MONTHLY",
      OR: [
        { periodKey: { contains: "2026-04" } },
        { periodKey: { contains: "2026-05" } },
        { periodKey: { contains: "2026-06" } },
      ],
    },
    select: { periodKey: true, percent: true, frequency: true },
    orderBy: { periodKey: "asc" },
  });
  console.log("monthly snapshots Apr–Jun:", snaps);

  const zone = "Asia/Taipei";
  const from = DateTime.fromISO("2026-04-01", { zone }).startOf("day").toJSDate();
  const to = DateTime.fromISO("2026-06-30", { zone }).endOf("day").toJSDate();
  const payload = await computeTaskMetrics({ from, to }, {}, "MONTHLY", {
    timeZone: zone,
    taskType: "task",
  });
  const monthly = payload.taskChecklistPillars?.["MONTHLY"];
  const sm = (monthly?.includedTasks ?? []).find((t) => t.title === "SYSTEM MAINTENANCE");
  console.log(
    JSON.stringify(
      {
        monthlyDonutPercent: monthly?.percent,
        periodsCounted: monthly?.periodsCounted,
        systemMaintenance: sm
          ? {
              totalRecorded: sm.totalDataRecordedPercent,
              recorded: sm.recordedPercent,
              done: sm.done,
              total: sm.total,
            }
          : null,
        monthlyTitles: (monthly?.includedTasks ?? []).map((t) => t.title),
      },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
