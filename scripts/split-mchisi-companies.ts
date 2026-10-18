import { prisma } from "../src/modules/platform/db/prisma";
import { ensureRosterTeamsInDb } from "../src/lib/roster-teams";

async function main() {
  await ensureRosterTeamsInDb();

  const teams = await prisma.team.findMany({
    where: { name: { in: ["MCHISI", "MCHISI LPG", "MCHISI FAMES"] } },
    select: {
      id: true,
      name: true,
      _count: {
        select: {
          tickets: true,
          customerPortalAccounts: true,
          staffDesignatedPortalAccounts: true,
          agents: true,
        },
      },
    },
    orderBy: { name: "asc" },
  });
  console.log(JSON.stringify(teams, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
