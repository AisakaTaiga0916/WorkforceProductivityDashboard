import { PrismaClient } from "@prisma/client/primary";

const prisma = new PrismaClient();
const ID = "cmsfm27oe0007cv1hw25xgnnz";

async function main() {
  const row = await prisma.kpiMaintenance.findUnique({
    where: { id: ID },
    select: { id: true, title: true, subKpis: true, lastFullCompletionAt: true, periodKey: true },
  });
  console.log(JSON.stringify(row, null, 2));
}

main().finally(() => prisma.$disconnect());
