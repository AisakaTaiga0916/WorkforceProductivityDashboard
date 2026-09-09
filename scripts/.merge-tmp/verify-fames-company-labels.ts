import { prisma, prismaSecondary } from "@/lib/prisma";
import { Prisma } from "@prisma/client/secondary";

async function main() {
  const nodes = await prisma.orgChartNode.findMany({
    where: { companyName: { equals: "MCHISI LPG", mode: "insensitive" } },
    select: {
      personName: true,
      companyName: true,
      mergedSourceUserId: true,
      section: { select: { name: true } },
    },
  });
  const famesSectionStillLpg = nodes.filter((n) => /fames/i.test(n.section?.name ?? ""));

  const famesNodes = await prisma.orgChartNode.findMany({
    where: {
      OR: [
        { companyName: { contains: "FAMES", mode: "insensitive" } },
        { section: { name: { contains: "FAMES", mode: "insensitive" } } },
      ],
    },
    select: {
      personName: true,
      companyName: true,
      section: { select: { name: true } },
    },
    orderBy: { personName: "asc" },
  });

  const famesTeam = await prisma.team.findFirst({
    where: { name: "MCHISI FAMES" },
    select: { id: true },
  });
  const agents = famesTeam
    ? await prisma.agent.findMany({
        where: { teamId: famesTeam.id },
        select: {
          name: true,
          email: true,
          team: { select: { name: true } },
        },
      })
    : [];

  const merged = await prismaSecondary.$queryRaw<
    Array<{ name: string; company_name: string | null; email: string | null }>
  >(Prisma.sql`
    SELECT name, company_name, email
    FROM merged_users
    WHERE is_active = true
      AND (
        LOWER(company_name) LIKE ${"%fames%"}
        OR LOWER(company_name) LIKE ${"%mchisi%"}
      )
    ORDER BY company_name, name
    LIMIT 100
  `);

  console.log(
    JSON.stringify(
      {
        orgNodesStillLabeledLpg: nodes.length,
        famesSectionStillLpg,
        famesRelatedNodes: famesNodes,
        famesAgents: agents.map((a) => ({
          name: a.name,
          team: a.team?.name,
          email: a.email,
        })),
        mergedMchisiOrFames: merged,
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
    await prismaSecondary.$disconnect();
  });
