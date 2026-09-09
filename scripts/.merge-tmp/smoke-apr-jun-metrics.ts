import { DateTime } from "luxon";
import { computeTaskMetrics } from "../../src/lib/kpis";
import { prisma } from "../../src/lib/prisma";

async function main() {
  const zone = "Asia/Taipei";
  const from = DateTime.fromISO("2026-04-01", { zone }).startOf("day").toJSDate();
  const to = DateTime.fromISO("2026-06-30", { zone }).endOf("day").toJSDate();
  const payload = await computeTaskMetrics({ from, to }, {}, "MONTHLY", {
    timeZone: zone,
    taskType: "task",
  });
  const daily = payload.taskChecklistPillars?.["DAILY"];
  console.log(
    JSON.stringify(
      {
        dailyPercent: daily?.percent,
        periodsCounted: daily?.periodsCounted,
        periodsInRange: daily?.periodsInRange,
        tasks: (daily?.includedTasks ?? []).map((t) => ({
          title: t.title,
          recorded: t.recordedPercent,
          totalRecorded: t.totalDataRecordedPercent,
          done: t.done,
          total: t.total,
        })),
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
