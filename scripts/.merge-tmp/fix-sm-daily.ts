import { prisma } from "../../src/lib/prisma";
import { DateTime } from "luxon";
import { computeTaskMetrics } from "../../src/lib/kpis";

async function main() {
  const updated = await prisma.kpiMaintenance.updateMany({
    where: { title: "SYSTEM MAINTENANCE", isRecurring: true },
    data: {
      frequency: "DAILY",
      recurrenceWeekday: null,
      recurrenceMonthDay: null,
    },
  });
  console.log(`Updated SYSTEM MAINTENANCE → DAILY (${updated.count} row(s))`);

  const zone = "Asia/Taipei";
  const from = DateTime.fromISO("2026-04-01", { zone }).startOf("day").toJSDate();
  const to = DateTime.fromISO("2026-06-30", { zone }).endOf("day").toJSDate();
  const payload = await computeTaskMetrics({ from, to }, {}, "MONTHLY", {
    timeZone: zone,
    taskType: "task",
  });
  const daily = payload.taskChecklistPillars?.["DAILY"];
  const sm = (daily?.includedTasks ?? []).find((t) => t.title === "SYSTEM MAINTENANCE");
  const db = (daily?.includedTasks ?? []).find((t) => t.title === "DATA BACKUP");
  console.log(
    JSON.stringify(
      {
        dailyPercent: daily?.percent,
        periodsCounted: daily?.periodsCounted,
        systemMaintenance: sm
          ? {
              totalRecorded: sm.totalDataRecordedPercent,
              recorded: sm.recordedPercent,
              done: sm.done,
              total: sm.total,
            }
          : null,
        dataBackup: db
          ? {
              totalRecorded: db.totalDataRecordedPercent,
              recorded: db.recordedPercent,
            }
          : null,
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
