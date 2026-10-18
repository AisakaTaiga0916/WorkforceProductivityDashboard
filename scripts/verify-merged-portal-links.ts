import { prismaPrimary, prismaSecondary } from "../src/modules/platform/db/prisma";

async function main() {
  const byStatus = await prismaPrimary.portalAccount.groupBy({
    by: ["accountStatus"],
    _count: true,
  });
  const linked = await prismaPrimary.portalAccount.count({
    where: { mergedSourceUserId: { not: null } },
  });
  const agents = await prismaPrimary.agent.count();
  const merged = await prismaSecondary.$queryRaw<{ c: bigint }[]>`
    SELECT COUNT(*) AS c FROM merged_users WHERE is_active = 1
  `;
  const unlinkedMerged = await prismaSecondary.$queryRaw<
    { source_user_id: bigint; username: string | null; email: string | null; name: string }[]
  >`
    SELECT mu.source_user_id, mu.username, mu.email, mu.name
    FROM merged_users mu
    WHERE mu.is_active = 1
      AND NOT EXISTS (
        SELECT 1 FROM (
          SELECT 1
        ) x
      )
  `;

  // Find merged users without portal link via primary query
  const portals = await prismaPrimary.portalAccount.findMany({
    where: { mergedSourceUserId: { not: null } },
    select: { mergedSourceUserId: true },
  });
  const linkedIds = new Set(portals.map((p) => p.mergedSourceUserId!.toString()));
  const allMerged = await prismaSecondary.$queryRaw<
    { source_user_id: bigint; username: string | null; name: string }[]
  >`SELECT source_user_id, username, name FROM merged_users WHERE is_active = 1`;
  const missing = allMerged.filter((m) => !linkedIds.has(m.source_user_id.toString()));

  console.log({
    byStatus,
    linked,
    agents,
    mergedActive: Number(merged[0]?.c ?? 0),
    missingMergedLinks: missing.map((m) => ({
      id: String(m.source_user_id),
      username: m.username,
      name: m.name,
    })),
  });
}

main().finally(async () => {
  await prismaPrimary.$disconnect();
  await prismaSecondary.$disconnect();
});
