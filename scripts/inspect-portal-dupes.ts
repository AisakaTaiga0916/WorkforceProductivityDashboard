/**
 * Find portal-only accounts that may be name duplicates of merged HRIS users,
 * and agents whose email no longer matches the linked portal (KPI/task risk).
 */
import { normalizePersonName } from "../src/lib/person-name";
import { prismaPrimary, prismaSecondary } from "../src/modules/platform/db/prisma";

type MergedRow = {
  source_user_id: bigint;
  username: string | null;
  email: string | null;
  name: string;
};

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
  const merged = await prismaSecondary.$queryRaw<MergedRow[]>`
    SELECT source_user_id, username, email, name FROM merged_users WHERE is_active = 1
  `;

  const mergedByName = new Map<string, MergedRow[]>();
  for (const m of merged) {
    const key = normalizePersonName(m.name);
    const list = mergedByName.get(key) ?? [];
    list.push(m);
    mergedByName.set(key, list);
  }

  const unlinked = portals.filter((p) => p.mergedSourceUserId == null);
  const nameDupes: Array<Record<string, unknown>> = [];
  for (const p of unlinked) {
    const hits = mergedByName.get(normalizePersonName(p.name)) ?? [];
    if (hits.length > 0) {
      nameDupes.push({
        portal: { id: p.id, username: p.username, email: p.email, name: p.name, status: p.accountStatus },
        merged: hits.map((m) => ({
          source_user_id: String(m.source_user_id),
          username: m.username,
          email: m.email,
        })),
      });
    }
  }

  // Agents that match a portal by name but not email (progress risk)
  const agentMismatches: Array<Record<string, unknown>> = [];
  for (const a of agents) {
    const portalByEmail = portals.find(
      (p) => p.email.trim().toLowerCase() === a.email.trim().toLowerCase(),
    );
    if (portalByEmail) continue;
    const portalByName = portals.find(
      (p) => normalizePersonName(p.name) === normalizePersonName(a.name),
    );
    if (portalByName) {
      const kpi = await prismaPrimary.kpiMaintenance.count({ where: { assignedAgentId: a.id } });
      const tasks = await prismaPrimary.taskItem.count({ where: { assignedAgentId: a.id } });
      const tickets = await prismaPrimary.ticket.count({ where: { assignedAgentId: a.id } });
      agentMismatches.push({
        agent: { id: a.id, email: a.email, name: a.name },
        portal: {
          id: portalByName.id,
          email: portalByName.email,
          username: portalByName.username,
          mergedSourceUserId: portalByName.mergedSourceUserId?.toString() ?? null,
        },
        work: { kpi, tasks, tickets },
      });
    }
  }

  // Duplicate agents for same person (email + name variants)
  const agentsByName = new Map<string, typeof agents>();
  for (const a of agents) {
    const key = normalizePersonName(a.name);
    const list = agentsByName.get(key) ?? [];
    list.push(a);
    agentsByName.set(key, list);
  }
  const dupAgents = [...agentsByName.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([name, list]) => ({ name, agents: list }));

  console.log(
    JSON.stringify(
      {
        unlinkedPortalCount: unlinked.length,
        unlinkedNameDupesOfMerged: nameDupes.length,
        nameDupeSamples: nameDupes.slice(0, 15),
        agentEmailMismatches: agentMismatches.length,
        agentMismatchSamples: agentMismatches.slice(0, 15),
        duplicateAgentNameGroups: dupAgents.length,
        dupAgentSamples: dupAgents.slice(0, 10),
        unlinkedStatuses: Object.fromEntries(
          Object.entries(
            unlinked.reduce<Record<string, number>>((acc, p) => {
              acc[p.accountStatus] = (acc[p.accountStatus] ?? 0) + 1;
              return acc;
            }, {}),
          ),
        ),
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
