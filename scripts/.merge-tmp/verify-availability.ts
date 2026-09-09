import { DateTime } from "luxon";
import { computeTaskMetrics } from "../../src/lib/kpis";
import { prisma } from "../../src/lib/prisma";

async function main() {
  const count = await prisma.kpiMaintenancePeriodSnapshot.count({
    where: { kpiMaintenance: { title: "SYSTEMS AVAILABILITY" } },
  });
  const sample = await prisma.kpiMaintenancePeriodSnapshot.findMany({
    where: { kpiMaintenance: { title: "SYSTEMS AVAILABILITY" } },
    select: { periodKey: true, percent: true, frequency: true },
    orderBy: { periodKey: "asc" },
    take: 5,
  });
  console.log({ count, sample });

  const zone = "Asia/Taipei";
  const from = DateTime.fromISO("2026-03-01", { zone }).startOf("day").toJSDate();
  const to = DateTime.fromISO("2026-04-30", { zone }).endOf("day").toJSDate();
  const payload = await computeTaskMetrics({ from, to }, {}, "MONTHLY", {
    timeZone: zone,
    taskType: "task",
  });
  const daily = payload.taskChecklistPillars?.["DAILY"];
  const row = (daily?.includedTasks ?? []).find((t) =>
    /availability/i.test(t.title),
  );
  console.log({
    dailyPercent: daily?.percent,
    systemsAvailability: row
      ? {
          title: row.title,
          totalRecorded: row.totalDataRecordedPercent,
          recorded: row.recordedPercent,
        }
      : null,
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
