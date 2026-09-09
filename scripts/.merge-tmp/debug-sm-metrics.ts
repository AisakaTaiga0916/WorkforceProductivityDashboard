import { DateTime } from "luxon";
import { computeTaskMetrics } from "../../src/lib/kpis";
import { prisma } from "../../src/lib/prisma";

async function main() {
  const sm = await prisma.kpiMaintenance.findMany({
    where: { title: "SYSTEM MAINTENANCE" },
    select: {
      id: true,
      frequency: true,
      isRecurring: true,
      assignedAgentId: true,
      assignedAgent: { select: { name: true } },
      _count: { select: { periodSnapshots: true } },
    },
  });
  console.log("SYSTEM MAINTENANCE rows", sm);

  const zone = "Asia/Taipei";
  const from = DateTime.fromISO("2026-04-01", { zone }).startOf("day").toJSDate();
  const to = DateTime.fromISO("2026-06-30", { zone }).endOf("day").toJSDate();
  const payload = await computeTaskMetrics({ from, to }, {}, "MONTHLY", {
    timeZone: zone,
    taskType: "task",
  });
  const daily = payload.taskChecklistPillars?.["DAILY"];
  console.log(
    "titles",
    (daily?.includedTasks ?? []).map((t) => t.title).sort(),
  );
  console.log(
    "SM snapshot sample",
    await prisma.kpiMaintenancePeriodSnapshot.findMany({
      where: {
        kpiMaintenance: { title: "SYSTEM MAINTENANCE" },
        periodKey: { contains: "2026-05-15" },
      },
      select: { periodKey: true, percent: true },
    }),
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
