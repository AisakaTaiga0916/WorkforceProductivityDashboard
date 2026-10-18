/**
 * Inspect overlap between portal_accounts, agents, and merged_users.
 * Usage: npx tsx scripts/inspect-portal-merged-overlap.ts
 */
import { normalizePersonName } from "../src/lib/person-name";
import { prismaPrimary, prismaSecondary } from "../src/modules/platform/db/prisma";

type MergedRow = {
  source_user_id: bigint;
  username: string | null;
  email: string | null;
  name: string;
  role: string;
  company_name: string | null;
};

function norm(v: string | null | undefined) {
  return (v ?? "").trim().toLowerCase() || null;
}

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
  const kpiAssigned = await prismaPrimary.kpiMaintenance.count({
    where: { assignedAgentId: { not: null } },
  });
  const taskAssigned = await prismaPrimary.taskItem.count({
    where: { assignedAgentId: { not: null } },
  });

  const merged = await prismaSecondary.$queryRaw<MergedRow[]>`
    SELECT source_user_id, username, email, name, role, company_name
    FROM merged_users WHERE is_active = 1
  `;

  const mergedByUsername = new Map<string, MergedRow>();
  const mergedByEmail = new Map<string, MergedRow>();
  const mergedByName = new Map<string, MergedRow>();
  for (const m of merged) {
    const u = norm(m.username);
    const e = norm(m.email);
    if (u) mergedByUsername.set(u, m);
    if (e) mergedByEmail.set(e, m);
    mergedByName.set(normalizePersonName(m.name), m);
  }

  let matchUsername = 0;
  let matchEmail = 0;
  let matchNameOnly = 0;
  let unmatchedPortal = 0;
  let linked = 0;
  const samples: Array<Record<string, unknown>> = [];

  for (const p of portals) {
    if (p.mergedSourceUserId != null) linked++;
    const u = norm(p.username);
    const e = norm(p.email);
    const byU = u ? mergedByUsername.get(u) : undefined;
    const byE = e ? mergedByEmail.get(e) : undefined;
    const byN = mergedByName.get(normalizePersonName(p.name));
    if (byU) matchUsername++;
    else if (byE) matchEmail++;
    else if (byN) matchNameOnly++;
    else unmatchedPortal++;

    if (samples.length < 12 && (byU || byE || byN)) {
      const m = byU ?? byE ?? byN!;
      samples.push({
        portal: { username: p.username, email: p.email, name: p.name, role: p.role },
        merged: {
          source_user_id: String(m.source_user_id),
          username: m.username,
          email: m.email,
          name: m.name,
          role: m.role,
        },
        match: byU ? "username" : byE ? "email" : "name",
        agentEmailHit: agents.some(
          (a) =>
            a.email.trim().toLowerCase() === e ||
            normalizePersonName(a.name) === normalizePersonName(p.name),
        ),
      });
    }
  }

  const agentEmailSet = new Set(agents.map((a) => a.email.trim().toLowerCase()));
  let agentsMatchedToPortal = 0;
  for (const a of agents) {
    const hit = portals.some(
      (p) =>
        p.email.trim().toLowerCase() === a.email.trim().toLowerCase() ||
        normalizePersonName(p.name) === normalizePersonName(a.name),
    );
    if (hit) agentsMatchedToPortal++;
  }

  console.log(
    JSON.stringify(
      {
        portalCount: portals.length,
        mergedCount: merged.length,
        agentCount: agents.length,
        linkedToMergedId: linked,
        matchUsername,
        matchEmail,
        matchNameOnly,
        unmatchedPortal,
        agentsMatchedToPortal,
        kpiAssigned,
        taskAssigned,
        agentEmailCount: agentEmailSet.size,
        samples,
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
    await prismaSecondary.$disconnect();
  });
