import { prisma } from "../../src/lib/prisma";

async function main() {
  const rows = await prisma.kpiMaintenancePeriodSnapshot.findMany({
    where: {
      AND: [
        { periodKey: { contains: "Asia/Taipei" } },
        {
          OR: [
            { periodKey: { contains: "2026-04" } },
            { periodKey: { contains: "2026-05" } },
            { periodKey: { contains: "2026-06" } },
          ],
        },
      ],
    },
    select: {
      id: true,
      periodKey: true,
      percent: true,
      kpiMaintenance: { select: { title: true } },
    },
    orderBy: { periodKey: "asc" },
  });
  console.log("count", rows.length);
  console.log(JSON.stringify(rows, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
