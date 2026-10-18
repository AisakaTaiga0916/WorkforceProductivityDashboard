import { prismaPrimary, prismaSecondary } from "../src/modules/platform/db/prisma";

async function main() {
  const noHash = await prismaPrimary.portalAccount.count({
    where: { OR: [{ passwordHash: null }, { passwordHash: "" }] },
  });
  const suspended = await prismaPrimary.portalAccount.count({
    where: { accountStatus: { not: "ACTIVE" } },
  });
  const dupUsernames = await prismaPrimary.$queryRaw<{ username: string; c: bigint }[]>`
    SELECT username, COUNT(*) AS c FROM portal_accounts
    WHERE username IS NOT NULL GROUP BY username HAVING COUNT(*) > 1
  `;
  const sample = await prismaPrimary.portalAccount.findMany({
    where: { username: { not: null } },
    select: { username: true, email: true, accountStatus: true, passwordHash: true },
    take: 8,
  });
  const mergedSample = await prismaSecondary.$queryRaw<
    { username: string | null; email: string | null; has_hash: boolean }[]
  >`
    SELECT username, email, password_hash IS NOT NULL AS has_hash
    FROM merged_users WHERE is_active = 1 LIMIT 5
  `;
  console.log({ noHash, suspended, dupUsernames: dupUsernames.length, sample, mergedSample });
}

main().finally(async () => {
  await prismaPrimary.$disconnect();
  await prismaSecondary.$disconnect();
});
