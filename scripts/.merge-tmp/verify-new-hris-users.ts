import { prismaAuth, prismaPrimary, prismaSecondary } from "../../src/lib/prisma";

type HrisRow = {
  id: bigint;
  username: string | null;
  name: string;
  email: string | null;
  role: string;
  is_active: number | boolean;
  created_at: Date | null;
  updated_at: Date | null;
};

type MergedRow = {
  source_user_id: bigint;
  username: string | null;
  name: string;
  email: string | null;
  role: string;
  company_name: string | null;
  is_active: number | boolean;
  created_at: Date | null;
  updated_at: Date | null;
  merged_at: Date | null;
};

function yn(v: unknown): string {
  return v ? "yes" : "NO";
}

function fmt(d: Date | null | undefined): string {
  return d ? d.toISOString().replace("T", " ").slice(0, 19) : "—";
}

async function main() {
  const cutoff = new Date(Date.now() - 14 * 86_400_000);

  const hrisNew = await prismaSecondary.$queryRaw<HrisRow[]>`
    SELECT id, username, name, email, role, is_active, created_at, updated_at
    FROM hris.users
    WHERE created_at >= ${cutoff} OR updated_at >= ${cutoff}
    ORDER BY COALESCE(created_at, updated_at) DESC
  `;

  const mergedRecent = await prismaSecondary.$queryRaw<MergedRow[]>`
    SELECT source_user_id, username, name, email, role, company_name, is_active,
           created_at, updated_at, merged_at
    FROM merged_users
    WHERE source_database = 'hris'
      AND (merged_at >= ${cutoff} OR created_at >= ${cutoff} OR updated_at >= ${cutoff})
    ORDER BY COALESCE(merged_at, updated_at, created_at) DESC
  `;

  const sourceIds = [
    ...new Set([
      ...hrisNew.map((r) => r.id),
      ...mergedRecent.map((r) => r.source_user_id),
    ]),
  ];

  const portals = await prismaPrimary.portalAccount.findMany({
    where: { mergedSourceUserId: { in: sourceIds } },
    select: {
      id: true,
      name: true,
      email: true,
      username: true,
      role: true,
      mergedSourceUserId: true,
      authUserId: true,
      accountStatus: true,
      profileSyncedAt: true,
      createdAt: true,
    },
  });
  const portalBySource = new Map(portals.map((p) => [p.mergedSourceUserId!.toString(), p]));

  const authUsers = await prismaAuth.user.findMany({
    where: { hrisSourceUserId: { in: sourceIds } },
    select: {
      id: true,
      name: true,
      email: true,
      username: true,
      portalRole: true,
      hrisSourceUserId: true,
      lastSyncedAt: true,
      createdAt: true,
    },
  });
  const authBySource = new Map(authUsers.map((u) => [u.hrisSourceUserId!.toString(), u]));

  const agents = await prismaPrimary.agent.findMany({
    where: {
      OR: [
        { email: { in: portals.map((p) => p.email).filter(Boolean) } },
        { name: { in: portals.map((p) => p.name).filter(Boolean) } },
      ],
    },
    select: { id: true, name: true, email: true },
  });
  const agentEmails = new Set(agents.map((a) => (a.email ?? "").toLowerCase()));

  const hrisMissingMerged = await prismaSecondary.$queryRaw<HrisRow[]>`
    SELECT u.id, u.username, u.name, u.email, u.role, u.is_active, u.created_at, u.updated_at
    FROM hris.users u
    LEFT JOIN \`mergedatabase-live\`.merged_users m
      ON m.source_user_id = u.id AND m.source_database = 'hris'
    WHERE m.source_user_id IS NULL
    ORDER BY COALESCE(u.created_at, u.updated_at) DESC
    LIMIT 50
  `;

  const mergedMissingPortal = mergedRecent.filter(
    (m) => Number(m.is_active) === 1 && !portalBySource.has(m.source_user_id.toString()),
  );
  const mergedMissingAuth = mergedRecent.filter(
    (m) => Number(m.is_active) === 1 && !authBySource.has(m.source_user_id.toString()),
  );

  console.log("=== HRIS users created/updated in last 14 days ===");
  console.log(`count=${hrisNew.length}`);
  for (const u of hrisNew) {
    const id = u.id.toString();
    const portal = portalBySource.get(id);
    const auth = authBySource.get(id);
    console.log(
      JSON.stringify({
        hrisId: id,
        name: u.name,
        username: u.username,
        email: u.email,
        role: u.role,
        active: Boolean(u.is_active),
        hrisCreated: fmt(u.created_at),
        hrisUpdated: fmt(u.updated_at),
        inPortal: yn(portal),
        portalRole: portal?.role ?? null,
        portalEmail: portal?.email ?? null,
        inAuth: yn(auth),
        authRole: auth?.portalRole ?? null,
        lastSynced: fmt(auth?.lastSyncedAt ?? portal?.profileSyncedAt),
        hasAgent: yn(portal ? agentEmails.has(portal.email.toLowerCase()) : false),
      }),
    );
  }

  console.log("\n=== Recently merged HRIS rows (14 days) missing ticketing link ===");
  console.log(
    JSON.stringify(
      {
        mergedRecent: mergedRecent.length,
        missingPortal: mergedMissingPortal.map((m) => ({
          id: String(m.source_user_id),
          name: m.name,
          username: m.username,
          email: m.email,
        })),
        missingAuth: mergedMissingAuth.map((m) => ({
          id: String(m.source_user_id),
          name: m.name,
          username: m.username,
          email: m.email,
        })),
      },
      null,
      2,
    ),
  );

  console.log("\n=== HRIS users not present in mergedatabase-live.merged_users ===");
  console.log(`count=${hrisMissingMerged.length}`);
  for (const u of hrisMissingMerged) {
    console.log(
      JSON.stringify({
        hrisId: String(u.id),
        name: u.name,
        username: u.username,
        email: u.email,
        active: Boolean(u.is_active),
        created: fmt(u.created_at),
        updated: fmt(u.updated_at),
      }),
    );
  }

  const counts = {
    hrisTotal: Number(
      (
        await prismaSecondary.$queryRaw<{ c: bigint }[]>`SELECT COUNT(*) AS c FROM hris.users`
      )[0]?.c ?? 0,
    ),
    hrisActive: Number(
      (
        await prismaSecondary.$queryRaw<{ c: bigint }[]>`
          SELECT COUNT(*) AS c FROM hris.users WHERE is_active = 1
        `
      )[0]?.c ?? 0,
    ),
    mergedHris: Number(
      (
        await prismaSecondary.$queryRaw<{ c: bigint }[]>`
          SELECT COUNT(*) AS c FROM merged_users WHERE source_database = 'hris'
        `
      )[0]?.c ?? 0,
    ),
    mergedHrisActive: Number(
      (
        await prismaSecondary.$queryRaw<{ c: bigint }[]>`
          SELECT COUNT(*) AS c FROM merged_users WHERE source_database = 'hris' AND is_active = 1
        `
      )[0]?.c ?? 0,
    ),
    portalLinked: await prismaPrimary.portalAccount.count({
      where: { mergedSourceUserId: { not: null } },
    }),
    authLinked: await prismaAuth.user.count({
      where: { hrisSourceUserId: { not: null } },
    }),
  };
  console.log("\n=== Totals ===");
  console.log(JSON.stringify(counts, null, 2));
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
