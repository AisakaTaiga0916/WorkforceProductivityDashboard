import { prisma, prismaSecondary } from "@/lib/prisma";
import { resolveRosterCompanyName } from "@/lib/hris-company-aliases";
import { Prisma } from "@prisma/client/secondary";

async function main() {
  // Users labeled plain MCHISI (alias → LPG)
  const plain = await prismaSecondary.$queryRaw<
    Array<{
      source_user_id: bigint;
      name: string;
      email: string | null;
      company_name: string | null;
      department: string | null;
      position: string | null;
    }>
  >(Prisma.sql`
    SELECT source_user_id, name, email, company_name, department, position
    FROM merged_users
    WHERE company_name IS NOT NULL
      AND LOWER(TRIM(company_name)) = 'mchisi'
    ORDER BY name
  `);
  console.log("plainMchisiCount", plain.length);
  console.log(
    "plainMchisi",
    plain.map((r) => ({
      name: r.name,
      email: r.email,
      dept: r.department,
      position: r.position,
      roster: resolveRosterCompanyName(r.company_name),
    })),
  );

  const fames = await prismaSecondary.$queryRaw<
    Array<{ name: string; email: string | null; company_name: string | null }>
  >(Prisma.sql`
    SELECT name, email, company_name
    FROM merged_users
    WHERE company_name IS NOT NULL
      AND LOWER(company_name) LIKE '%fames%'
    ORDER BY name
  `);

  // Org chart: FAMES agent emails vs node companyName
  const famesEmails = fames
    .map((r) => r.email?.trim().toLowerCase())
    .filter((e): e is string => Boolean(e));
  const famesAgents = await prisma.agent.findMany({
    where: {
      OR: famesEmails.map((email) => ({
        email: { equals: email, mode: "insensitive" as const },
      })),
    },
    select: { id: true, name: true, email: true, team: { select: { name: true } } },
  });

  // Map agent → merged source via portal
  const portals = await prisma.portalAccount.findMany({
    where: {
      OR: famesEmails.map((email) => ({
        email: { equals: email, mode: "insensitive" as const },
      })),
    },
    select: {
      email: true,
      name: true,
      mergedSourceUserId: true,
      staffDesignatedCompany: { select: { name: true } },
    },
  });

  const mergedIds = portals
    .map((p) => p.mergedSourceUserId)
    .filter((id): id is bigint => id != null)
    .map((id) => id.toString());

  const nodes = mergedIds.length
    ? await prisma.orgChartNode.findMany({
        where: { mergedSourceUserId: { in: mergedIds } },
        select: {
          personName: true,
          companyName: true,
          mergedSourceUserId: true,
          section: { select: { name: true } },
        },
      })
    : [];

  console.log(
    "famesOrgChartNodes",
    nodes.map((n) => ({
      person: n.personName,
      companyName: n.companyName,
      section: n.section?.name ?? null,
      merged: n.mergedSourceUserId,
    })),
  );
  console.log(
    "famesAgents",
    famesAgents.map((a) => ({ name: a.name, team: a.team?.name })),
  );

  // Any UI that shows company from org chart would mislabel FAMES people as LPG
  const lpgLabeledFamesNodes = nodes.filter((n) =>
    (n.companyName ?? "").toUpperCase().includes("LPG"),
  );
  console.log("famesNodesLabeledLpg", lpgLabeledFamesNodes.length);
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
