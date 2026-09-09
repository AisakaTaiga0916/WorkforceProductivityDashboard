import { DateTime } from "luxon";
import { computeTaskMetrics } from "../../src/lib/kpis";
import { prisma } from "../../src/lib/prisma";

async function main() {
  const zone = "Asia/Taipei";
  const from = DateTime.fromISO("2026-06-01", { zone }).startOf("day").toJSDate();
  const to = DateTime.fromISO("2026-07-31", { zone }).endOf("day").toJSDate();
  const payload = await computeTaskMetrics({ from, to }, {}, "MONTHLY", {
    timeZone: zone,
    taskType: "task",
  });
  const daily = payload.taskChecklistPillars?.["DAILY"];
  const row = (daily?.includedTasks ?? []).find((t) => /availability/i.test(t.title));
  console.log(
    JSON.stringify(
      {
        title: row?.title,
        totalRecorded: row?.totalDataRecordedPercent,
        recorded: row?.recordedPercent,
        snapCount: await prisma.kpiMaintenancePeriodSnapshot.count({
          where: {
            kpiMaintenance: { title: "SYSTEMS AVAILABILITY" },
            OR: [{ periodKey: { contains: "2026-06" } }, { periodKey: { contains: "2026-07" } }],
          },
        }),
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
