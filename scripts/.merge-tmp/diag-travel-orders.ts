import { prisma } from "../../src/lib/prisma";

async function main() {
  const byStatus = await prisma.travelOrder.groupBy({
    by: ["status"],
    _count: { _all: true },
  });
  console.table(byStatus);
  const all = await prisma.travelOrder.findMany({
    select: {
      id: true,
      status: true,
      kpiMaintenanceId: true,
      createdByAgentId: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });
  console.table(all);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
