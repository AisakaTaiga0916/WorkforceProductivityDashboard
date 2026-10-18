#!/usr/bin/env npx tsx
/**
 * Re-point work assignments (KPI cards, tasks, tickets, sub-KPI JSON,
 * snapshot contributors) at the canonical agent row of each
 * mergedatabase-demo (HRIS) user, and rename that agent to the merged name.
 *
 * Duplicate agent rows (legacy emails / old portal names) are folded into the
 * canonical agent and deleted when nothing references them anymore.
 *
 * Usage:
 *   npx tsx scripts/reassign-agents-to-merged-users.ts          (dry run)
 *   npx tsx scripts/reassign-agents-to-merged-users.ts --apply
 */
import { mergeAgentOwnership } from "../src/lib/reconcile-duplicate-agents";
import {
  buildCanonicalMergedIdMap,
  canonicalMergedId,
} from "../src/lib/sync/merged-person-identity";
import { prismaPrimary, prismaSecondary } from "../src/modules/platform/db/prisma";

type MergedRow = {
  source_user_id: bigint;
  name: string;
  email: string | null;
  username: string | null;
};

function personTokens(name: string): Set<string> {
  return new Set(
    name
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1),
  );
}

/**
 * Same-person name check: the shorter token set must be fully contained in the
 * longer one (e.g. "Mark Robina" ⊆ "Mark Anthony Robina"). A plain 2-token
 * overlap is not enough — siblings share surname + middle name (Rodmark vs
 * Aeron Danggoy Maquilan) and would merge into each other.
 */
function sameNamePerson(a: Set<string>, b: Set<string>): boolean {
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  if (small.size < 2) return false;
  return [...small].every((t) => big.has(t));
}

async function main() {
  const apply = process.argv.includes("--apply");
  const sourceTag = process.env.HRIS_MERGE_SOURCE_TAG?.trim() || "hrisdemo";

  const mergedRows = await prismaSecondary.$queryRaw<MergedRow[]>`
    SELECT source_user_id, name, email, username
    FROM merged_users
    WHERE is_active = 1 AND source_database = ${sourceTag}
  `;
  const allMerged = await prismaSecondary.$queryRaw<MergedRow[]>`
    SELECT source_user_id, name, email, username FROM merged_users WHERE is_active = 1
  `;
  const canonicalIds = buildCanonicalMergedIdMap(
    allMerged.map((m) => ({
      sourceUserId: m.source_user_id,
      name: m.name,
      email: m.email,
    })),
  );

  const [agents, portals] = await Promise.all([
    prismaPrimary.agent.findMany({ orderBy: { createdAt: "asc" } }),
    prismaPrimary.portalAccount.findMany({
      where: { mergedSourceUserId: { not: null } },
      select: { email: true, accountStatus: true, mergedSourceUserId: true },
    }),
  ]);

  // Portal emails per canonical merged id (ACTIVE portals first).
  const portalEmailsByMergedId = new Map<string, string[]>();
  const sortedPortals = [...portals].sort(
    (a, b) =>
      (a.accountStatus === "ACTIVE" ? 0 : 1) - (b.accountStatus === "ACTIVE" ? 0 : 1),
  );
  for (const p of sortedPortals) {
    const key = canonicalMergedId(p.mergedSourceUserId!, canonicalIds).toString();
    const list = portalEmailsByMergedId.get(key) ?? [];
    list.push(p.email.trim().toLowerCase());
    portalEmailsByMergedId.set(key, list);
  }

  let renamed = 0;
  let merges = 0;
  let deleted = 0;
  const claimedAgentIds = new Set<string>();

  for (const merged of mergedRows) {
    const mergedKey = merged.source_user_id.toString();
    const mergedEmail = merged.email?.trim().toLowerCase() || null;
    const portalEmails = portalEmailsByMergedId.get(mergedKey) ?? [];
    const emailSet = new Set([...(mergedEmail ? [mergedEmail] : []), ...portalEmails]);
    const nameTokens = personTokens(merged.name);

    const matching = agents.filter((a) => {
      if (claimedAgentIds.has(a.id)) return false;
      const email = a.email.trim().toLowerCase();
      if (emailSet.has(email)) return true;
      return sameNamePerson(personTokens(a.name), nameTokens);
    });
    if (matching.length === 0) continue;

    // Canonical agent: merged_users email first, then ACTIVE-portal email, then newest.
    const target =
      matching.find((a) => mergedEmail && a.email.trim().toLowerCase() === mergedEmail) ??
      matching.find((a) => portalEmails[0] && a.email.trim().toLowerCase() === portalEmails[0]) ??
      matching[matching.length - 1];

    for (const a of matching) claimedAgentIds.add(a.id);

    if (target.name !== merged.name) {
      console.log(`RENAME agent ${target.id}: "${target.name}" -> "${merged.name}" (${target.email})`);
      renamed++;
      if (apply) {
        await prismaPrimary.agent.update({
          where: { id: target.id },
          data: { name: merged.name },
        });
      }
    }

    for (const stale of matching) {
      if (stale.id === target.id) continue;
      const moved = await mergeAgentOwnership(
        stale.id,
        { id: target.id, name: merged.name },
        { dryRun: !apply },
      );
      const total =
        moved.ticketsUpdated +
        moved.kpisUpdated +
        moved.tasksUpdated +
        moved.kpiSubAssigneeRowsUpdated +
        moved.snapshotRowsUpdated;
      console.log(
        `MERGE ${stale.name} <${stale.email}> -> ${merged.name} <${target.email}> ` +
          `(tickets=${moved.ticketsUpdated} kpis=${moved.kpisUpdated} tasks=${moved.tasksUpdated} ` +
          `subKpiRows=${moved.kpiSubAssigneeRowsUpdated} snapshots=${moved.snapshotRowsUpdated})`,
      );
      if (total > 0) merges++;

      if (apply) {
        const stillReferenced =
          (await prismaPrimary.ticket.count({ where: { assignedAgentId: stale.id } })) +
          (await prismaPrimary.kpiMaintenance.count({ where: { assignedAgentId: stale.id } })) +
          (await prismaPrimary.taskItem.count({ where: { assignedAgentId: stale.id } }));
        if (stillReferenced === 0) {
          try {
            await prismaPrimary.agent.delete({ where: { id: stale.id } });
            console.log(`  deleted stale agent ${stale.id} <${stale.email}>`);
            deleted++;
          } catch {
            console.log(`  kept stale agent ${stale.id} <${stale.email}> (still referenced elsewhere)`);
          }
        }
      }
    }
  }

  console.log(
    `\n${apply ? "Applied" : "Dry run"}: renamed=${renamed} mergesWithData=${merges} staleAgentsDeleted=${deleted}`,
  );
  if (!apply) console.log("Pass --apply to write the changes.");
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
