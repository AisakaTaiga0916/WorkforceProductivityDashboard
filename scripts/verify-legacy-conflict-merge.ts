#!/usr/bin/env npx tsx
import { findMergedUserByLogin } from "../src/modules/platform/auth/merged-credentials";
import { findPortalAccountByLogin } from "../src/modules/platform/auth/portal-credentials";
import { prismaPrimary, prismaSecondary } from "../src/modules/platform/db/prisma";

async function main() {
  const legacy = await prismaPrimary.portalAccount.findMany({
    where: { accountStatus: "LEGACY_CONFLICT" },
    select: { email: true, name: true },
    orderBy: { name: "asc" },
    take: 5,
  });

  const portalAliasCount = await prismaPrimary.portalUsernameAlias.count({
    where: { source: "legacy_conflict" },
  });
  const mergedAliasCount = await prismaSecondary.$queryRaw<Array<{ c: bigint }>>`
    SELECT COUNT(*) AS c FROM merged_username_aliases WHERE source = 'legacy_conflict'
  `;

  console.log("legacy_conflict portal aliases:", portalAliasCount);
  console.log("legacy_conflict merged aliases:", Number(mergedAliasCount[0]?.c ?? 0));

  console.log("\n--- Login resolution samples ---");
  for (const row of legacy) {
    const login = row.email.trim().toLowerCase();
    const portal = await findPortalAccountByLogin(login);
    const merged = await findMergedUserByLogin(login);
    console.log(
      JSON.stringify({
        legacyEmail: login,
        name: row.name,
        resolvesPortal: portal?.email ?? null,
        resolvesMerged: merged?.email ?? merged?.username ?? null,
        mergedUserId: merged?.sourceUserId?.toString() ?? null,
      }),
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prismaPrimary.$disconnect();
    await prismaSecondary.$disconnect();
  });
