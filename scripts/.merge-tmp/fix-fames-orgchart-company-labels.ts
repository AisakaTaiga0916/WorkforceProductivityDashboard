import { prisma, prismaSecondary } from "@/lib/prisma";
import { resolveRosterCompanyName } from "@/lib/hris-company-aliases";
import { Prisma } from "@prisma/client/secondary";

async function main() {
  const famesTeam = await prisma.team.findFirst({
    where: { name: "MCHISI FAMES" },
    select: { id: true, name: true },
  });
  if (!famesTeam) throw new Error("MCHISI FAMES team missing");

  const nodes = await prisma.orgChartNode.findMany({
    select: {
      id: true,
      personName: true,
      companyName: true,
      mergedSourceUserId: true,
      sectionId: true,
      section: { select: { id: true, name: true } },
    },
  });

  const mergedIds = [
    ...new Set(nodes.map((n) => n.mergedSourceUserId.trim()).filter(Boolean)),
  ];
  const mergedRows =
    mergedIds.length === 0
      ? []
      : await prismaSecondary.$queryRaw<
          Array<{ source_user_id: bigint; company_name: string | null }>
        >(Prisma.sql`
          SELECT source_user_id, company_name
          FROM merged_users
          WHERE source_user_id IN (${Prisma.join(mergedIds.map((id) => BigInt(id)))})
        `);
  const companyByMerged = new Map(
    mergedRows.map((r) => [r.source_user_id.toString(), r.company_name] as const),
  );

  const updates: Array<{
    id: string;
    personName: string;
    from: string | null;
    to: string;
    reason: string;
  }> = [];

  for (const node of nodes) {
    const mergedRaw = companyByMerged.get(node.mergedSourceUserId.trim()) ?? null;
    const fromMerged = resolveRosterCompanyName(mergedRaw) ?? mergedRaw?.trim() ?? null;
    const sectionName = node.section?.name ?? "";
    const sectionLooksFames = /fames/i.test(sectionName);

    let next: string | null = fromMerged;
    let reason = "merged company";

    // Org-chart section named FAMES should not display as LPG.
    if (sectionLooksFames) {
      next = "MCHISI FAMES";
      reason = fromMerged === "MCHISI FAMES" ? "merged+section FAMES" : "section MCHISI - FAMES";
    }

    if (!next) continue;
    const prev = node.companyName?.trim() || null;
    if (prev === next) continue;

    updates.push({
      id: node.id,
      personName: node.personName,
      from: prev,
      to: next,
      reason,
    });
  }

  for (const u of updates) {
    await prisma.orgChartNode.update({
      where: { id: u.id },
      data: { companyName: u.to },
    });
  }

  // Ensure FAMES section is linked to FAMES company team when unset/wrong.
  const famesSections = await prisma.orgChartSection.findMany({
    where: { name: { contains: "FAMES", mode: "insensitive" } },
    select: { id: true, name: true, companyTeamId: true },
  });
  const sectionFixes: string[] = [];
  for (const s of famesSections) {
    if (s.companyTeamId !== famesTeam.id) {
      await prisma.orgChartSection.update({
        where: { id: s.id },
        data: { companyTeamId: famesTeam.id },
      });
      sectionFixes.push(`${s.name}: companyTeam → MCHISI FAMES`);
    }
  }

  console.log(
    JSON.stringify(
      {
        nodeUpdates: updates.length,
        updates,
        sectionFixes,
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
