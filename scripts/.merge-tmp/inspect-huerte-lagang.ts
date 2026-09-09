import { prismaAuth, prismaPrimary, prismaSecondary } from "../../src/lib/prisma";

async function main() {
  const merged = await prismaSecondary.$queryRaw<
    Array<{
      source_user_id: bigint;
      username: string | null;
      name: string;
      email: string | null;
      role: string;
      is_active: number;
      company_name: string | null;
    }>
  >`
    SELECT source_user_id, username, name, email, role, is_active, company_name
    FROM merged_users
    WHERE source_user_id IN (1682, 1709)
  `;

  const emails = ["jmhuerte@amalgatedlending.com", "dlagang@mconpincohomeimprovement.com"];
  const usernames = ["jhuerte", "donabel"];

  const portals = await prismaPrimary.portalAccount.findMany({
    where: {
      OR: [
        { mergedSourceUserId: { in: [1682n, 1709n] } },
        { email: { in: emails, mode: "insensitive" } },
        { username: { in: usernames, mode: "insensitive" } },
        { name: { contains: "Huerte", mode: "insensitive" } },
        { name: { contains: "Lagang", mode: "insensitive" } },
      ],
    },
  });

  const aliases = await prismaPrimary.portalUsernameAlias.findMany({
    where: { username: { in: usernames, mode: "insensitive" } },
  });

  const auth = await prismaAuth.user.findMany({
    where: {
      OR: [
        { hrisSourceUserId: { in: [1682n, 1709n] } },
        { email: { in: emails, mode: "insensitive" } },
        { username: { in: usernames, mode: "insensitive" } },
      ],
    },
  });

  const agents = await prismaPrimary.agent.findMany({
    where: {
      OR: [
        { email: { in: emails, mode: "insensitive" } },
        { name: { contains: "Huerte", mode: "insensitive" } },
        { name: { contains: "Lagang", mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true, email: true, teamId: true },
  });

  console.log(
    JSON.stringify(
      {
        merged: merged.map((m) => ({ ...m, source_user_id: String(m.source_user_id) })),
        portals: portals.map((p) => ({
          id: p.id,
          name: p.name,
          email: p.email,
          username: p.username,
          role: p.role,
          status: p.accountStatus,
          mergedSourceUserId: p.mergedSourceUserId?.toString() ?? null,
          authUserId: p.authUserId,
          companyId: p.companyId,
          staffDesignatedCompanyId: p.staffDesignatedCompanyId,
        })),
        aliases,
        auth: auth.map((u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          username: u.username,
          portalRole: u.portalRole,
          portalAccountId: u.portalAccountId,
          hrisSourceUserId: u.hrisSourceUserId?.toString() ?? null,
          lastSyncedAt: u.lastSyncedAt,
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
