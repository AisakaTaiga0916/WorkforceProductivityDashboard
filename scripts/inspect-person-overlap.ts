/**
 * Show portal + agent rows for known duplicate people (seed vs HRIS vs July backup).
 */
import { normalizePersonName } from "../src/lib/person-name";
import { prismaPrimary, prismaSecondary } from "../src/modules/platform/db/prisma";

const NEEDLES = ["zyrah", "reginald", "mark", "kurt", "neziah", "john", "darwin", "manilyn", "marvin"];

async function main() {
  const portals = await prismaPrimary.portalAccount.findMany({
    select: {
      id: true,
      username: true,
      email: true,
      name: true,
      role: true,
      mergedSourceUserId: true,
      accountStatus: true,
    },
  });
  const agents = await prismaPrimary.agent.findMany({
    select: { id: true, email: true, name: true },
  });
  const merged = await prismaSecondary.$queryRaw<
    { source_user_id: bigint; username: string | null; email: string | null; name: string }[]
  >`SELECT source_user_id, username, email, name FROM merged_users WHERE is_active = 1`;

  for (const needle of NEEDLES) {
    const pHits = portals.filter(
      (p) =>
        (p.username ?? "").toLowerCase().includes(needle) ||
        p.email.toLowerCase().includes(needle) ||
        normalizePersonName(p.name).includes(needle),
    );
    const aHits = agents.filter(
      (a) =>
        a.email.toLowerCase().includes(needle) || normalizePersonName(a.name).includes(needle),
    );
    const mHits = merged.filter(
      (m) =>
        (m.username ?? "").toLowerCase().includes(needle) ||
        (m.email ?? "").toLowerCase().includes(needle) ||
        normalizePersonName(m.name).includes(needle),
    );
    if (pHits.length + aHits.length + mHits.length === 0) continue;
    console.log(`\n=== ${needle} ===`);
    console.log(
      "merged:",
      mHits.map((m) => ({
        id: String(m.source_user_id),
        username: m.username,
        email: m.email,
        name: m.name,
      })),
    );
    console.log(
      "portals:",
      pHits.map((p) => ({
        username: p.username,
        email: p.email,
        name: p.name,
        mergedId: p.mergedSourceUserId?.toString() ?? null,
        status: p.accountStatus,
      })),
    );
    console.log(
      "agents:",
      aHits.map((a) => ({ email: a.email, name: a.name, id: a.id })),
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
