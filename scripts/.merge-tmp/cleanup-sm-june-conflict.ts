import { prisma } from "../../src/lib/prisma";

/** Drop the conflicting Taipei June 33% monthly row so Manila monthly history wins. */
async function main() {
  const removed = await prisma.kpiMaintenancePeriodSnapshot.deleteMany({
    where: {
      periodKey: "M:Asia/Taipei:2026-06-30",
      kpiMaintenance: { title: "SYSTEM MAINTENANCE" },
      percent: 33,
    },
  });
  console.log(`Removed conflicting Taipei June monthly row(s): ${removed.count}`);

  const remaining = await prisma.kpiMaintenancePeriodSnapshot.findMany({
    where: {
      kpiMaintenance: { title: "SYSTEM MAINTENANCE" },
      frequency: "MONTHLY",
      OR: [
        { periodKey: { contains: "2026-04" } },
        { periodKey: { contains: "2026-05" } },
        { periodKey: { contains: "2026-06" } },
      ],
    },
    select: { periodKey: true, percent: true },
    orderBy: { periodKey: "asc" },
  });
  console.log(remaining);

  const kpi = await prisma.kpiMaintenance.findFirst({
    where: { title: "SYSTEM MAINTENANCE", isRecurring: true },
    select: { frequency: true, recurrenceMonthDay: true },
  });
  console.log("SYSTEM MAINTENANCE cadence:", kpi);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
