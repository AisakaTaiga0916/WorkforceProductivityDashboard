import { prismaAuth, prismaPrimary, prismaSecondary } from "../../src/lib/prisma";

async function main() {
  const merged = await prismaSecondary.$queryRaw<
    Array<{
      source_user_id: bigint;
      username: string | null;
      name: string;
      email: string | null;
      is_active: number;
      created_at: Date | null;
      updated_at: Date | null;
      merged_at: Date | null;
    }>
  >`
    SELECT source_user_id, username, name, email, is_active, created_at, updated_at, merged_at
    FROM merged_users
    WHERE source_database = 'hris'
      AND source_user_id IN (1838, 1839)
  `;

  const missingHris = await prismaSecondary.$queryRaw<{ c: bigint }[]>`
    SELECT COUNT(*) AS c
    FROM hris.users u
    LEFT JOIN \`mergedatabase-live\`.merged_users m
      ON m.source_user_id = u.id AND m.source_database = 'hris'
    WHERE m.source_user_id IS NULL
  `;

  const ids = [1838n, 1839n];
  const portals = await prismaPrimary.portalAccount.findMany({
    where: { mergedSourceUserId: { in: ids } },
    select: {
      name: true,
      email: true,
      username: true,
      role: true,
      mergedSourceUserId: true,
      authUserId: true,
      accountStatus: true,
      profileSyncedAt: true,
    },
  });
  const auth = await prismaAuth.user.findMany({
    where: { hrisSourceUserId: { in: ids } },
    select: {
      name: true,
      email: true,
      username: true,
      portalRole: true,
      hrisSourceUserId: true,
      lastSyncedAt: true,
    },
  });
  const agents = await prismaPrimary.agent.findMany({
    where: {
      email: { in: portals.map((p) => p.email) },
    },
    select: { name: true, email: true },
  });

  console.log(
    JSON.stringify(
      {
        hrisMissingFromMerged: Number(missingHris[0]?.c ?? 0),
        merged: merged.map((m) => ({
          id: String(m.source_user_id),
          name: m.name,
          username: m.username,
          email: m.email,
          active: Boolean(m.is_active),
          createdAt: m.created_at,
          mergedAt: m.merged_at,
        })),
        portals: portals.map((p) => ({
          ...p,
          mergedSourceUserId: p.mergedSourceUserId?.toString() ?? null,
        })),
        auth: auth.map((u) => ({
          ...u,
          hrisSourceUserId: u.hrisSourceUserId?.toString() ?? null,
        })),
        agents,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prismaPrimary.$disconnect();
    await prismaAuth.$disconnect();
    await prismaSecondary.$disconnect();
  });
