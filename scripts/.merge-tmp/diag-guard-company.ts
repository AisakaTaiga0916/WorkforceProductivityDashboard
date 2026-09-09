import { prisma } from "../../src/lib/prisma";
import { loadEffectiveCompaniesByPortalEmail } from "../../src/lib/staff-company-scope";

async function main() {
  const emails = [
    "marvin.iscototo@hris.merged",
    "rommick.pabro@hris.merged",
    "jayson.kadil@hris.merged",
  ];
  const portals = await prisma.portalAccount.findMany({
    where: { email: { in: emails, mode: "insensitive" } },
    select: {
      email: true,
      name: true,
      role: true,
      mergedSourceUserId: true,
      staffDesignatedCompany: { select: { id: true, name: true } },
    },
  });
  const effective = await loadEffectiveCompaniesByPortalEmail(portals);
  const agents = await prisma.agent.findMany({
    where: { email: { in: emails, mode: "insensitive" } },
    select: { id: true, email: true, name: true, teamId: true, team: { select: { name: true } } },
  });

  console.log(
    JSON.stringify(
      {
        portals: portals.map((p) => ({
          email: p.email,
          name: p.name,
          role: p.role,
          mergedSourceUserId: p.mergedSourceUserId?.toString() ?? null,
          designated: p.staffDesignatedCompany,
          effective: effective.get(p.email.trim().toLowerCase()) ?? null,
        })),
        agents: agents.map((a) => ({
          email: a.email,
          name: a.name,
          teamId: a.teamId,
          teamName: a.team?.name ?? null,
        })),
      },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
