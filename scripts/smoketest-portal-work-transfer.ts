#!/usr/bin/env npx tsx
/**
 * Smoke test: verify legacy portal work landed on HRIS-linked accounts.
 *
 * Usage: npx tsx scripts/smoketest-portal-work-transfer.ts
 */
import { Prisma } from "@prisma/client/primary";
import { pickCanonicalAgentForPortal } from "../src/lib/admin-roster";
import { prismaPrimary } from "../src/modules/platform/db/prisma";

const SPOT_CHECKS = [
  { label: "Mark Robina", email: "markanthony.robina@gmail.com", minTickets: 1 },
  { label: "Reginald Malubay", email: "reginald@hris.merged", minTickets: 1 },
  { label: "Zyrah Faith Gascon", email: "zyrahfaithcubagascon@gmail.com", minTickets: 1 },
] as const;

type Check = { name: string; ok: boolean; detail: string };

function check(name: string, ok: boolean, detail: string): Check {
  return { name, ok, detail };
}

async function main() {
  const checks: Check[] = [];
  const agents = await prismaPrimary.agent.findMany({ orderBy: { createdAt: "asc" } });
  const agentIds = new Set(agents.map((a) => a.id));

  const hrisStaff = await prismaPrimary.portalAccount.findMany({
    where: {
      mergedSourceUserId: { not: null },
      role: { in: ["Admin", "Personnel", "SuperAdmin"] },
    },
    select: {
      id: true,
      email: true,
      name: true,
      accountStatus: true,
      mergedSourceUserId: true,
    },
  });

  const legacyConflict = await prismaPrimary.portalAccount.findMany({
    where: { accountStatus: "LEGACY_CONFLICT" },
    select: { id: true, email: true, name: true },
  });

  // 1) Transferred HRIS staff with work should resolve to an agent
  let hrisWithWork = 0;
  let hrisWithWorkNoAgent = 0;
  for (const portal of hrisStaff) {
    const agent = pickCanonicalAgentForPortal(portal, agents);
    if (!agent) continue;
    const tickets = await prismaPrimary.ticket.count({ where: { assignedAgentId: agent.id } });
    const kpis = await prismaPrimary.kpiMaintenance.count({ where: { assignedAgentId: agent.id } });
    if (tickets + kpis === 0) continue;
    hrisWithWork++;
    const resolved = pickCanonicalAgentForPortal(portal, agents);
    if (!resolved) hrisWithWorkNoAgent++;
  }
  checks.push(
    check(
      "HRIS staff with work resolve to agent",
      hrisWithWorkNoAgent === 0 && hrisWithWork > 0,
      `${hrisWithWork} HRIS staff have ticket/KPI work; ${hrisWithWorkNoAgent} missing agent`,
    ),
  );

  // 2) Legacy conflict portals should not hold ticket/KPI assignments
  let legacyWithWork = 0;
  for (const portal of legacyConflict) {
    const agent = pickCanonicalAgentForPortal(portal, agents);
    if (!agent) continue;
    const tickets = await prismaPrimary.ticket.count({ where: { assignedAgentId: agent.id } });
    const kpis = await prismaPrimary.kpiMaintenance.count({ where: { assignedAgentId: agent.id } });
    if (tickets + kpis > 0) legacyWithWork++;
  }
  checks.push(
    check(
      "LEGACY_CONFLICT portals have no ticket/KPI work",
      legacyWithWork === 0,
      `${legacyWithWork} legacy portal(s) still have assignments`,
    ),
  );

  // 3) Contributor progress references valid agents
  const snaps = await prismaPrimary.kpiMaintenancePeriodSnapshot.findMany({
    where: { contributorProgress: { not: Prisma.DbNull } },
    select: { contributorProgress: true },
  });
  let badContributorIds = 0;
  for (const snap of snaps) {
    const arr = snap.contributorProgress as Array<{ id?: string }> | null;
    if (!Array.isArray(arr)) continue;
    for (const row of arr) {
      if (!row.id || row.id === "__unassigned__") continue;
      if (!agentIds.has(row.id)) badContributorIds++;
    }
  }
  checks.push(
    check(
      "KPI contributor snapshots reference valid agents",
      badContributorIds === 0,
      `${badContributorIds} orphan contributor id(s) in ${snaps.length} snapshot(s)`,
    ),
  );

  // 4) Spot-check known transferred users
  for (const spot of SPOT_CHECKS) {
    const portal = await prismaPrimary.portalAccount.findFirst({
      where: { email: { equals: spot.email, mode: "insensitive" } },
      select: { email: true, name: true, mergedSourceUserId: true, accountStatus: true },
    });
    if (!portal?.mergedSourceUserId) {
      checks.push(check(`Spot: ${spot.label}`, false, "HRIS-linked portal not found"));
      continue;
    }
    const agent = pickCanonicalAgentForPortal(portal, agents);
    const tickets = agent
      ? await prismaPrimary.ticket.count({ where: { assignedAgentId: agent.id } })
      : 0;
    const kpis = agent
      ? await prismaPrimary.kpiMaintenance.count({ where: { assignedAgentId: agent.id } })
      : 0;
    const ok =
      !!agent &&
      portal.accountStatus === "ACTIVE" &&
      agent.email.toLowerCase() === portal.email.toLowerCase() &&
      tickets >= spot.minTickets;
    checks.push(
      check(
        `Spot: ${spot.label}`,
        ok,
        `agent=${agent?.email ?? "none"} tickets=${tickets} kpis=${kpis} status=${portal.accountStatus}`,
      ),
    );
  }

  // 5) No duplicate merged_source_user_id on active portals
  const dupMerged = await prismaPrimary.$queryRaw<Array<{ c: bigint }>>`
    SELECT COUNT(*)::bigint AS c FROM (
      SELECT merged_source_user_id FROM portal_accounts
      WHERE merged_source_user_id IS NOT NULL
      GROUP BY merged_source_user_id HAVING COUNT(*) > 1
    ) d
  `;
  checks.push(
    check(
      "No duplicate merged_source_user_id",
      Number(dupMerged[0]?.c ?? 0) === 0,
      `${dupMerged[0]?.c ?? 0} duplicate group(s)`,
    ),
  );

  // 6) Task board items (task_items) — same agent transfer path as tickets/KPIs
  const taskTotal = await prismaPrimary.taskItem.count();
  let taskOnLegacy = 0;
  let taskOnHris = 0;
  let taskOrphan = 0;
  if (taskTotal > 0) {
    const tasks = await prismaPrimary.taskItem.findMany({
      select: { assignedAgentId: true },
    });
    for (const task of tasks) {
      if (!task.assignedAgentId) continue;
      if (!agentIds.has(task.assignedAgentId)) {
        taskOrphan++;
        continue;
      }
      const portal = hrisStaff.find(
        (p) => pickCanonicalAgentForPortal(p, agents)?.id === task.assignedAgentId,
      );
      if (portal) taskOnHris++;
      else {
        const legacy = legacyConflict.find(
          (p) => pickCanonicalAgentForPortal(p, agents)?.id === task.assignedAgentId,
        );
        if (legacy) taskOnLegacy++;
      }
    }
  }
  checks.push(
    check(
      "Task items on HRIS-linked agents (not legacy)",
      taskTotal === 0 || (taskOnLegacy === 0 && taskOrphan === 0),
      taskTotal === 0
        ? "no task_items rows in DB (nothing to transfer)"
        : `${taskOnHris} on HRIS, ${taskOnLegacy} on legacy, ${taskOrphan} orphan`,
    ),
  );

  console.log("=== Portal work transfer smoke test ===\n");
  let failed = 0;
  for (const c of checks) {
    const mark = c.ok ? "PASS" : "FAIL";
    if (!c.ok) failed++;
    console.log(`[${mark}] ${c.name}`);
    console.log(`       ${c.detail}`);
  }
  console.log(`\n${checks.length - failed}/${checks.length} passed`);
  if (failed > 0) process.exit(1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prismaPrimary.$disconnect());
