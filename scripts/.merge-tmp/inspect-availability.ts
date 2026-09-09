import { prisma } from "../../src/lib/prisma";

async function main() {
  const kpis = await prisma.kpiMaintenance.findMany({
    where: {
      OR: [
        { title: { contains: "AVAILABILITY", mode: "insensitive" } },
        { title: { equals: "MONITORING" } },
      ],
    },
    select: {
      id: true,
      title: true,
      frequency: true,
      isRecurring: true,
      assignedAgent: { select: { name: true } },
      _count: { select: { periodSnapshots: true } },
    },
  });
  console.log("kpis", JSON.stringify(kpis, null, 2));

  for (const k of kpis) {
    const snaps = await prisma.kpiMaintenancePeriodSnapshot.groupBy({
      by: ["frequency"],
      where: {
        kpiMaintenanceId: k.id,
        OR: [
          { periodKey: { contains: "2026-03" } },
          { periodKey: { contains: "2026-04" } },
          { periodKey: { contains: "2026-05" } },
          { periodKey: { contains: "2026-06" } },
        ],
      },
      _count: true,
      _avg: { percent: true },
    });
    console.log(k.title, snaps);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
