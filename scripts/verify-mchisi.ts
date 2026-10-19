import { prisma } from "../src/modules/platform/db/prisma";

async function main() {
  const oldId = "3cd2fdf9-7e56-4c5c-89d2-5558b5acff70";
  const oldTeam = await prisma.company.findUnique({ where: { id: oldId }, select: { id: true, name: true } });
  console.log("old UUID team still exists:", oldTeam);

  const all = await prisma.company.findMany({
    where: { OR: [{ name: { contains: "MCHISI" } }, { id: oldId }] },
    select: {
      id: true,
      name: true,
      _count: { select: { tickets: true, agents: true, customerPortalAccounts: true, staffDesignatedPortalAccounts: true } },
    },
  });
  console.log(JSON.stringify(all, null, 2));

  const noTeam = await prisma.ticket.count({ where: { teamId: null } });
  console.log("tickets with null team:", noTeam);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
