import { prisma, prismaSecondary } from "@/lib/prisma";
import { resolveRosterCompanyName } from "@/lib/hris-company-aliases";
import { Prisma } from "@prisma/client/secondary";

async function main() {
  const teams = await prisma.team.findMany({
    where: {
      OR: [
        { name: { contains: "MCHISI", mode: "insensitive" } },
        { name: { contains: "FAMES", mode: "insensitive" } },
      ],
    },
    select: {
      id: true,
      name: true,
      _count: {
        select: {
          agents: true,
          customerPortalAccounts: true,
          staffDesignatedPortalAccounts: true,
        },
      },
    },
  });
  console.log("teams", JSON.stringify(teams, null, 2));

  const lpg = teams.find((t) => t.name === "MCHISI LPG");
  const fames = teams.find((t) => t.name === "MCHISI FAMES");

  const mergedBuckets = await prismaSecondary.$queryRaw<
    Array<{ company_name: string | null; cnt: bigint }>
  >(Prisma.sql`
    SELECT company_name, COUNT(*) AS cnt
    FROM merged_users
    WHERE company_name IS NOT NULL
      AND (
        LOWER(company_name) LIKE '%fames%'
        OR LOWER(company_name) LIKE '%mchisi%'
        OR LOWER(company_name) LIKE '%conpinco%'
      )
    GROUP BY company_name
    ORDER BY cnt DESC
  `);
  console.log(
    "mergedCompanyBuckets",
    mergedBuckets.map((r) => ({
      company_name: r.company_name,
      cnt: Number(r.cnt),
      roster: resolveRosterCompanyName(r.company_name),
    })),
  );

  const famesMerged = await prismaSecondary.$queryRaw<
    Array<{
      source_user_id: bigint;
      name: string;
      email: string | null;
      company_name: string | null;
    }>
  >(Prisma.sql`
    SELECT source_user_id, name, email, company_name
    FROM merged_users
    WHERE company_name IS NOT NULL
      AND LOWER(company_name) LIKE '%fames%'
    ORDER BY name
  `);
  console.log("famesMergedCount", famesMerged.length);

  const emails = famesMerged
    .map((r) => r.email?.trim().toLowerCase())
    .filter((e): e is string => Boolean(e));

  const agents = emails.length
    ? await prisma.agent.findMany({
        where: {
          OR: emails.map((email) => ({
            email: { equals: email, mode: "insensitive" as const },
          })),
        },
        select: {
          id: true,
          name: true,
          email: true,
          teamId: true,
          team: { select: { name: true } },
        },
      })
    : [];

  const wrongAgents = agents.filter((a) => a.team?.name === "MCHISI LPG");
  const okAgents = agents.filter((a) => a.team?.name === "MCHISI FAMES");
  console.log("agentsMatched", agents.length);
  console.log(
    "wrongAgentsOnLpg",
    wrongAgents.length,
    wrongAgents.map((a) => ({ name: a.name, email: a.email })),
  );
  console.log("okAgentsOnFames", okAgents.length);

  const portals = emails.length
    ? await prisma.portalAccount.findMany({
        where: {
          OR: emails.map((email) => ({
            email: { equals: email, mode: "insensitive" as const },
          })),
        },
        select: {
          id: true,
          name: true,
          email: true,
          company: { select: { name: true } },
          staffDesignatedCompany: { select: { name: true } },
        },
      })
    : [];
  console.log(
    "portals",
    portals.map((p) => ({
      name: p.name,
      email: p.email,
      company: p.company?.name ?? null,
      designated: p.staffDesignatedCompany?.name ?? null,
    })),
  );

  const nodes = await prisma.orgChartNode.findMany({
    where: {
      OR: [
        { companyName: { contains: "fames", mode: "insensitive" } },
        { companyName: { contains: "mchisi", mode: "insensitive" } },
      ],
    },
    select: { personName: true, companyName: true },
  });
  const nodeBuckets: Record<string, number> = {};
  for (const n of nodes) {
    const k = n.companyName ?? "(null)";
    nodeBuckets[k] = (nodeBuckets[k] ?? 0) + 1;
  }
  console.log("orgChartCompanyBuckets", nodeBuckets);
  console.log("famesTeamId", fames?.id ?? null, "lpgTeamId", lpg?.id ?? null);
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
