#!/usr/bin/env npx tsx
/**
 * Transfer tickets, KPI progress, and tasks from legacy work-email portal accounts
 * to their HRIS-linked portal accounts (matched by person identity).
 *
 * Usage:
 *   npx tsx scripts/transfer-portal-work-to-hris-users.ts
 *   npx tsx scripts/transfer-portal-work-to-hris-users.ts --apply
 */
import { pickCanonicalAgentForPortal } from "../src/lib/admin-roster";
import { normalizePersonName } from "../src/lib/person-name";
import { mergeAgentOwnership } from "../src/lib/reconcile-duplicate-agents";
import { prismaAuth, prismaPrimary, prismaSecondary } from "../src/modules/platform/db/prisma";

const STAFF_ROLES = ["Admin", "Personnel", "SuperAdmin"] as const;

type PortalRow = {
  id: string;
  email: string;
  name: string;
  username: string | null;
  role: string;
  mergedSourceUserId: bigint | null;
  accountStatus: string;
  staffDesignatedCompanyId: string | null;
};

type MergedRow = {
  source_user_id: bigint;
  name: string;
  username: string | null;
  email: string | null;
};

type TransferPair = {
  score: number;
  legacy: PortalRow;
  hris: PortalRow;
  merged: MergedRow;
};

function personTokens(name: string): Set<string> {
  return new Set(
    normalizePersonName(name)
      .replace(/[,.]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1),
  );
}

function emailLocal(email: string): string {
  return email.split("@")[0]?.trim().toLowerCase() ?? "";
}

function isSharedRolePortal(portal: PortalRow): boolean {
  const username = portal.username?.toLowerCase() ?? "";
  const name = portal.name.toLowerCase();
  if (username.endsWith(".admin") || username.endsWith(".personnel")) return true;
  if (/^(aci|agoc|ali|agc)\s/.test(name) && name.includes("admin")) return true;
  if (name === "admin" || name.endsWith(" admin")) return true;
  const generic = new Set([
    "internal audit",
    "amalgated group",
    "audit amalgated",
    "aci admin",
    "aci personnel",
    "agoc admin",
    "agoc personnel",
  ]);
  if (generic.has(name)) return true;
  return false;
}

function scorePair(legacy: PortalRow, hris: PortalRow, merged: MergedRow): number {
  const lt = personTokens(legacy.name);
  const ht = personTokens(hris.name);
  const mt = personTokens(merged.name);
  const overlapHris = [...lt].filter((t) => ht.has(t)).length;
  const overlapMerged = [...lt].filter((t) => mt.has(t)).length;
  if (overlapHris < 2 && overlapMerged < 2) return 0;

  let score = 0;
  if (overlapHris >= 2) score += 12;
  else if (overlapHris === 1 && lt.size <= 2) score += 6;
  if (overlapMerged >= 2) score += 12;
  else if (overlapMerged === 1 && lt.size <= 2) score += 6;

  const ll = emailLocal(legacy.email);
  const hl = emailLocal(hris.email);
  const mu = merged.username?.trim().toLowerCase() ?? "";
  if (mu && (ll.includes(mu) || hl.includes(mu) || mu.includes(ll) || mu.includes(hl))) score += 10;
  if (ll.length >= 4 && (hl.includes(ll) || ll.includes(hl))) score += 8;

  return score;
}

function buildPairs(
  legacyPortals: PortalRow[],
  hrisPortals: PortalRow[],
  mergedById: Map<string, MergedRow>,
  minScore: number,
): TransferPair[] {
  const candidates: TransferPair[] = [];
  for (const legacy of legacyPortals) {
    for (const hris of hrisPortals) {
      const merged = mergedById.get(hris.mergedSourceUserId!.toString());
      if (!merged) continue;
      const score = scorePair(legacy, hris, merged);
      if (score >= minScore) candidates.push({ score, legacy, hris, merged });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  const usedLegacy = new Set<string>();
  const usedHris = new Set<string>();
  const chosen: TransferPair[] = [];
  for (const pair of candidates) {
    if (usedLegacy.has(pair.legacy.id) || usedHris.has(pair.hris.id)) continue;
    usedLegacy.add(pair.legacy.id);
    usedHris.add(pair.hris.id);
    chosen.push(pair);
  }
  return chosen;
}

async function resolveCanonicalAgent(
  hrisPortal: PortalRow,
  legacyAgent: { id: string; email: string; name: string; teamId: string },
  agents: Array<{ id: string; email: string; name: string; createdAt: Date; teamId: string }>,
  dryRun: boolean,
): Promise<{ id: string; name: string }> {
  const existing = pickCanonicalAgentForPortal(hrisPortal, agents);
  if (existing) return { id: existing.id, name: hrisPortal.name };

  if (!dryRun) {
    await prismaPrimary.agent.update({
      where: { id: legacyAgent.id },
      data: {
        email: hrisPortal.email.trim().toLowerCase(),
        name: hrisPortal.name,
        teamId: legacyAgent.teamId,
      },
    });
  }
  return { id: legacyAgent.id, name: hrisPortal.name };
}

export async function transferPortalWorkToHrisUsers(options?: { dryRun?: boolean }) {
  const dryRun = options?.dryRun ?? true;
  const sourceTag = process.env.HRIS_MERGE_SOURCE_TAG?.trim() || "hrisdemo";

  const mergedRows = await prismaSecondary.$queryRaw<MergedRow[]>`
    SELECT source_user_id, name, username, email
    FROM merged_users
    WHERE is_active = 1 AND source_database = ${sourceTag}
  `;
  const mergedById = new Map(mergedRows.map((m) => [m.source_user_id.toString(), m]));

  const portals = await prismaPrimary.portalAccount.findMany({
    where: { role: { in: [...STAFF_ROLES] } },
    select: {
      id: true,
      email: true,
      name: true,
      username: true,
      role: true,
      mergedSourceUserId: true,
      accountStatus: true,
      staffDesignatedCompanyId: true,
    },
  });
  const agents = await prismaPrimary.agent.findMany({ orderBy: { createdAt: "asc" } });

  const legacyPortals = portals.filter(
    (p) => !p.mergedSourceUserId && p.accountStatus !== "LEGACY_CONFLICT" && !isSharedRolePortal(p),
  );
  const hrisPortals = portals.filter((p) => p.mergedSourceUserId != null);
  const pairs = buildPairs(legacyPortals, hrisPortals, mergedById, 12);

  let ticketsUpdated = 0;
  let kpisUpdated = 0;
  let tasksUpdated = 0;
  let kpiSubAssigneeRowsUpdated = 0;
  let snapshotRowsUpdated = 0;
  let actionRequestsUpdated = 0;
  let legacyMarked = 0;
  let staffCompanyCopied = 0;
  let authPortalRelinked = 0;
  let createdByEmailsUpdated = 0;

  for (const pair of pairs) {
    const legacyAgent = pickCanonicalAgentForPortal(pair.legacy, agents);
    if (!legacyAgent) continue;

    const canonical = await resolveCanonicalAgent(pair.hris, legacyAgent, agents, dryRun);

    if (legacyAgent.id !== canonical.id) {
      const merged = await mergeAgentOwnership(legacyAgent.id, canonical, { dryRun });
      ticketsUpdated += merged.ticketsUpdated;
      kpisUpdated += merged.kpisUpdated;
      tasksUpdated += merged.tasksUpdated;
      kpiSubAssigneeRowsUpdated += merged.kpiSubAssigneeRowsUpdated;
      snapshotRowsUpdated += merged.snapshotRowsUpdated;

      if (!dryRun) {
        const stillReferenced =
          (await prismaPrimary.ticket.count({ where: { assignedAgentId: legacyAgent.id } })) +
          (await prismaPrimary.kpiMaintenance.count({ where: { assignedAgentId: legacyAgent.id } })) +
          (await prismaPrimary.taskItem.count({ where: { assignedAgentId: legacyAgent.id } }));
        if (stillReferenced === 0) {
          await prismaPrimary.agent.delete({ where: { id: legacyAgent.id } });
        }
      }
    }

    if (!dryRun) {
      if (pair.legacy.staffDesignatedCompanyId && !pair.hris.staffDesignatedCompanyId) {
        await prismaPrimary.portalAccount.update({
          where: { id: pair.hris.id },
          data: { staffDesignatedCompanyId: pair.legacy.staffDesignatedCompanyId },
        });
        staffCompanyCopied++;
      }

      const actionResult = await prismaPrimary.accountActionRequest.updateMany({
        where: { portalAccountId: pair.legacy.id },
        data: { portalAccountId: pair.hris.id },
      });
      actionRequestsUpdated += actionResult.count;

      const legacyEmail = pair.legacy.email.trim().toLowerCase();
      const hrisEmail = pair.hris.email.trim().toLowerCase();
      createdByEmailsUpdated += (
        await prismaPrimary.taskItem.updateMany({
          where: { createdBy: { equals: legacyEmail, mode: "insensitive" } },
          data: { createdBy: hrisEmail },
        })
      ).count;
      createdByEmailsUpdated += (
        await prismaPrimary.taskActivity.updateMany({
          where: { author: { equals: legacyEmail, mode: "insensitive" } },
          data: { author: hrisEmail },
        })
      ).count;
      createdByEmailsUpdated += (
        await prismaPrimary.kpiMaintenance.updateMany({
          where: { createdBy: { equals: legacyEmail, mode: "insensitive" } },
          data: { createdBy: hrisEmail },
        })
      ).count;

      await prismaPrimary.portalAccount.update({
        where: { id: pair.legacy.id },
        data: {
          accountStatus: "LEGACY_CONFLICT",
          mergedSourceUserId: null,
          username: null,
        },
      });
      legacyMarked++;

      const authUsers = await prismaAuth.user.findMany({
        where: { portalAccountId: pair.legacy.id },
        select: { id: true },
      });
      for (const authUser of authUsers) {
        await prismaAuth.user.update({
          where: { id: authUser.id },
          data: { portalAccountId: pair.hris.id },
        });
        authPortalRelinked++;
      }
    } else {
      const legacyEmail = pair.legacy.email.trim().toLowerCase();
      actionRequestsUpdated += await prismaPrimary.accountActionRequest.count({
        where: { portalAccountId: pair.legacy.id },
      });
      createdByEmailsUpdated +=
        (await prismaPrimary.taskItem.count({
          where: { createdBy: { equals: legacyEmail, mode: "insensitive" } },
        })) +
        (await prismaPrimary.taskActivity.count({
          where: { author: { equals: legacyEmail, mode: "insensitive" } },
        })) +
        (await prismaPrimary.kpiMaintenance.count({
          where: { createdBy: { equals: legacyEmail, mode: "insensitive" } },
        }));
      if (pair.legacy.staffDesignatedCompanyId && !pair.hris.staffDesignatedCompanyId) staffCompanyCopied++;
      legacyMarked++;
    }
  }

  return {
    pairs,
    ticketsUpdated,
    kpisUpdated,
    tasksUpdated,
    kpiSubAssigneeRowsUpdated,
    snapshotRowsUpdated,
    actionRequestsUpdated,
    legacyMarked,
    staffCompanyCopied,
    authPortalRelinked,
    createdByEmailsUpdated,
  };
}

async function main() {
  const apply = process.argv.includes("--apply");
  const result = await transferPortalWorkToHrisUsers({ dryRun: !apply });

  console.log(apply ? "=== Applied portal work transfer ===" : "=== Dry run (pass --apply to write) ===");
  console.log(`Matched legacy → HRIS pairs: ${result.pairs.length}`);
  for (const pair of result.pairs) {
    console.log(
      `  [${pair.score}] ${pair.legacy.name} (${pair.legacy.email}) → ${pair.hris.name} (${pair.hris.email})`,
    );
  }
  console.log(
    JSON.stringify(
      {
        ticketsUpdated: result.ticketsUpdated,
        kpisUpdated: result.kpisUpdated,
        tasksUpdated: result.tasksUpdated,
        kpiSubAssigneeRowsUpdated: result.kpiSubAssigneeRowsUpdated,
        snapshotRowsUpdated: result.snapshotRowsUpdated,
        actionRequestsUpdated: result.actionRequestsUpdated,
        legacyMarked: result.legacyMarked,
        staffCompanyCopied: result.staffCompanyCopied,
        authPortalRelinked: result.authPortalRelinked,
        createdByEmailsUpdated: result.createdByEmailsUpdated,
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
    await prismaAuth.$disconnect();
  });
