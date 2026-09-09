import { prisma } from "../../src/lib/prisma";
import { prismaSecondary } from "../../src/lib/prisma";

async function main() {
  const ids = [
    "cmrppavrc0001j1cia3cd2ui3",
    "cmrpro8a6002n10lffr5hs326",
    "cmrbdhqpo011011jos69ve29s",
  ];
  const agents = await prisma.agent.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, email: true },
  });
  const emails = agents.map((a) => a.email).filter((e): e is string => Boolean(e));
  const users = await prismaSecondary.mergedUser.findMany({
    where: { email: { in: emails } },
    select: { sourceUserId: true, email: true, username: true, name: true, role: true, companyName: true },
  });
  console.table(users);
}

main()
  .catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await prismaSecondary.$disconnect();
  });