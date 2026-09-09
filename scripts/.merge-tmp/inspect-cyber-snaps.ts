import { PrismaClient } from "@prisma/client/primary";

const prisma = new PrismaClient();
const ID = "cmsfm27oe0007cv1hw25xgnnz";

async function main() {
  const snaps = await prisma.kpiMaintenancePeriodSnapshot.findMany({
    where: { kpiMaintenanceId: ID },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  console.log(
    JSON.stringify(
      snaps.map((s) => ({
        id: s.id,
        periodKey: s.periodKey,
        frequency: s.frequency,
        timeZone: s.timeZone,
        total: s.total,
        done: s.done,
        missing: s.missing,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      })),
      null,
      2,
    ),
  );
}

main().finally(() => prisma.$disconnect());
