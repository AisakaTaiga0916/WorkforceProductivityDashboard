/**
 * Merge LEGACY_CONFLICT portal accounts into their canonical HRIS-linked
 * portal + mergedatabase-demo user (identity match by person name / merged_users).
 */
import { randomUUID } from "node:crypto";
import { pickCanonicalAgentForPortal } from "@/lib/admin-roster";
import { normalizePersonName } from "@/lib/person-name";
import { mergeAgentOwnership } from "@/lib/reconcile-duplicate-agents";
import { prismaAuth, prismaPrimary, prismaSecondary } from "@/modules/platform/db/prisma";

const STAFF_ROLES = ["Admin", "Personnel", "SuperAdmin"] as const;

export type LegacyConflictPortal = {
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

export type LegacyConflictMergePair = {
  score: number;
  legacy: LegacyConflictPortal;
  canonical: LegacyConflictPortal;
  merged: MergedRow;
};

export type MergeLegacyConflictResult = {
  dryRun: boolean;
  sourceTag: string;
  pairs: LegacyConflictMergePair[];
  portalAliasesRegistered: number;
  mergedAliasesRegistered: number;
  ticketsUpdated: number;
  kpisUpdated: number;
  tasksUpdated: number;
  kpiSubAssigneeRowsUpdated: number;
  snapshotRowsUpdated: number;
  actionRequestsUpdated: number;
  createdByEmailsUpdated: number;
  staffCompanyCopied: number;
  authPortalRelinked: number;
  mergeMappingsUpdated: number;
  unmatched: Array<{ id: string; name: string; email: string }>;
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

function normLogin(v: string | null | undefined): string | null {
  const s = v?.trim().toLowerCase();
  return s || null;
}

function scorePair(legacy: LegacyConflictPortal, canonical: LegacyConflictPortal, merged: MergedRow): number {
  const lt = personTokens(legacy.name);
  const ct = personTokens(canonical.name);
  const mt = personTokens(merged.name);
  const overlapCanonical = [...lt].filter((t) => ct.has(t)).length;
  const overlapMerged = [...lt].filter((t) => mt.has(t)).length;
  if (overlapCanonical < 2 && overlapMerged < 2) return 0;

  let score = 0;
  if (overlapCanonical >= 2) score += 12;
  else if (overlapCanonical === 1 && lt.size <= 2) score += 6;
  if (overlapMerged >= 2) score += 12;
  else if (overlapMerged === 1 && lt.size <= 2) score += 6;

  const ll = emailLocal(legacy.email);
  const cl = emailLocal(canonical.email);
  const mu = merged.username?.trim().toLowerCase() ?? "";
  if (mu && (ll.includes(mu) || cl.includes(mu) || mu.includes(ll) || mu.includes(cl))) score += 10;
  if (ll.length >= 4 && (cl.includes(ll) || ll.includes(cl))) score += 8;

  return score;
}

function buildPairs(
  legacyPortals: LegacyConflictPortal[],
  canonicalPortals: LegacyConflictPortal[],
  mergedById: Map<string, MergedRow>,
  minScore: number,
): LegacyConflictMergePair[] {
  const candidates: LegacyConflictMergePair[] = [];
  for (const legacy of legacyPortals) {
    for (const canonical of canonicalPortals) {
      if (!canonical.mergedSourceUserId) continue;
      const merged = mergedById.get(canonical.mergedSourceUserId.toString());
      if (!merged) continue;
      const score = scorePair(legacy, canonical, merged);
      if (score >= minScore) candidates.push({ score, legacy, canonical, merged });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  const usedLegacy = new Set<string>();
  const usedCanonical = new Set<string>();
  const chosen: LegacyConflictMergePair[] = [];
  for (const pair of candidates) {
    if (usedLegacy.has(pair.legacy.id) || usedCanonical.has(pair.canonical.id)) continue;
    usedLegacy.add(pair.legacy.id);
    usedCanonical.add(pair.canonical.id);
    chosen.push(pair);
  }
  return chosen;
}

function legacyLoginIdentifiers(legacy: LegacyConflictPortal): string[] {
  const out = new Set<string>();
  const email = normLogin(legacy.email);
  const username = normLogin(legacy.username);
  if (email) out.add(email);
  if (username) out.add(username);
  const local = email ? emailLocal(email) : null;
  if (local && local.length >= 2) out.add(local);
  return [...out];
}

async function registerPortalAlias(
  canonicalPortalId: string,
  username: string,
  dryRun: boolean,
): Promise<boolean> {
  const needle = username.toLowerCase();
  const existing = await prismaPrimary.portalUsernameAlias.findFirst({
    where: { username: { equals: needle, mode: "insensitive" } },
  });
  if (existing) return false;
  if (!dryRun) {
    await prismaPrimary.portalUsernameAlias.create({
      data: {
        id: randomUUID(),
        portalAccountId: canonicalPortalId,
        username: needle,
        source: "legacy_conflict",
      },
    });
  }
  return true;
}

async function registerMergedAlias(
  sourceUserId: bigint,
  username: string,
  dryRun: boolean,
): Promise<boolean> {
  const needle = username.toLowerCase();
  const existing = await prismaSecondary.$queryRaw<Array<{ c: bigint }>>`
    SELECT COUNT(*) AS c FROM merged_username_aliases WHERE LOWER(username) = ${needle}
  `;
  if (Number(existing[0]?.c ?? 0) > 0) return false;
  if (!dryRun) {
    await prismaSecondary.mergedUsernameAlias.create({
      data: {
        id: randomUUID(),
        sourceUserId,
        username: needle,
        source: "legacy_conflict",
      },
    });
  }
  return true;
}

async function resolveCanonicalAgent(
  canonical: LegacyConflictPortal,
  legacyAgent: { id: string; email: string; name: string; teamId: string },
  agents: Array<{ id: string; email: string; name: string; createdAt: Date; teamId: string }>,
  dryRun: boolean,
): Promise<{ id: string; name: string }> {
  const existing = pickCanonicalAgentForPortal(canonical, agents);
  if (existing) return { id: existing.id, name: canonical.name };

  if (!dryRun) {
    await prismaPrimary.agent.update({
      where: { id: legacyAgent.id },
      data: {
        email: canonical.email.trim().toLowerCase(),
        name: canonical.name,
        teamId: legacyAgent.teamId,
      },
    });
  }
  return { id: legacyAgent.id, name: canonical.name };
}

export async function mergeLegacyConflictPortals(options?: {
  dryRun?: boolean;
  minScore?: number;
}): Promise<MergeLegacyConflictResult> {
  const dryRun = options?.dryRun ?? true;
  const minScore = options?.minScore ?? 12;
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

  const legacyPortals = portals.filter((p) => p.accountStatus === "LEGACY_CONFLICT");
  const canonicalPortals = portals.filter(
    (p) => p.mergedSourceUserId != null && p.accountStatus !== "LEGACY_CONFLICT",
  );
  const pairs = buildPairs(legacyPortals, canonicalPortals, mergedById, minScore);

  const result: MergeLegacyConflictResult = {
    dryRun,
    sourceTag,
    pairs,
    portalAliasesRegistered: 0,
    mergedAliasesRegistered: 0,
    ticketsUpdated: 0,
    kpisUpdated: 0,
    tasksUpdated: 0,
    kpiSubAssigneeRowsUpdated: 0,
    snapshotRowsUpdated: 0,
    actionRequestsUpdated: 0,
    createdByEmailsUpdated: 0,
    staffCompanyCopied: 0,
    authPortalRelinked: 0,
    mergeMappingsUpdated: 0,
    unmatched: legacyPortals
      .filter((p) => !pairs.some((pair) => pair.legacy.id === p.id))
      .map((p) => ({ id: p.id, name: p.name, email: p.email })),
  };

  for (const pair of pairs) {
    const canonicalUsername = normLogin(pair.canonical.username);
    const canonicalEmail = normLogin(pair.canonical.email);
    const mergedUsername = normLogin(pair.merged.username);
    const mergedEmail = normLogin(pair.merged.email);

    for (const identifier of legacyLoginIdentifiers(pair.legacy)) {
      if (identifier === canonicalUsername || identifier === canonicalEmail) continue;
      if (identifier === mergedUsername || identifier === mergedEmail) continue;

      if (await registerPortalAlias(pair.canonical.id, identifier, dryRun)) {
        result.portalAliasesRegistered++;
      }
      if (await registerMergedAlias(pair.merged.source_user_id, identifier, dryRun)) {
        result.mergedAliasesRegistered++;
      }
    }

    const legacyAgent = pickCanonicalAgentForPortal(pair.legacy, agents);
    if (legacyAgent) {
      const canonicalAgent = await resolveCanonicalAgent(pair.canonical, legacyAgent, agents, dryRun);
      if (legacyAgent.id !== canonicalAgent.id) {
        const merged = await mergeAgentOwnership(legacyAgent.id, canonicalAgent, { dryRun });
        result.ticketsUpdated += merged.ticketsUpdated;
        result.kpisUpdated += merged.kpisUpdated;
        result.tasksUpdated += merged.tasksUpdated;
        result.kpiSubAssigneeRowsUpdated += merged.kpiSubAssigneeRowsUpdated;
        result.snapshotRowsUpdated += merged.snapshotRowsUpdated;

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
    }

    if (!dryRun) {
      if (pair.legacy.staffDesignatedCompanyId && !pair.canonical.staffDesignatedCompanyId) {
        await prismaPrimary.portalAccount.update({
          where: { id: pair.canonical.id },
          data: { staffDesignatedCompanyId: pair.legacy.staffDesignatedCompanyId },
        });
        result.staffCompanyCopied++;
      }

      const actionResult = await prismaPrimary.accountActionRequest.updateMany({
        where: { portalAccountId: pair.legacy.id },
        data: { portalAccountId: pair.canonical.id },
      });
      result.actionRequestsUpdated += actionResult.count;

      const legacyEmail = pair.legacy.email.trim().toLowerCase();
      const canonicalEmailWrite = pair.canonical.email.trim().toLowerCase();
      result.createdByEmailsUpdated += (
        await prismaPrimary.taskItem.updateMany({
          where: { createdBy: { equals: legacyEmail, mode: "insensitive" } },
          data: { createdBy: canonicalEmailWrite },
        })
      ).count;
      result.createdByEmailsUpdated += (
        await prismaPrimary.taskActivity.updateMany({
          where: { author: { equals: legacyEmail, mode: "insensitive" } },
          data: { author: canonicalEmailWrite },
        })
      ).count;
      result.createdByEmailsUpdated += (
        await prismaPrimary.kpiMaintenance.updateMany({
          where: { createdBy: { equals: legacyEmail, mode: "insensitive" } },
          data: { createdBy: canonicalEmailWrite },
        })
      ).count;

      await prismaPrimary.portalMergeMapping.deleteMany({
        where: {
          mergedSourceUserId: pair.canonical.mergedSourceUserId!,
          NOT: { portalAccountId: pair.canonical.id },
        },
      });
      await prismaPrimary.portalMergeMapping.upsert({
        where: { portalAccountId: pair.canonical.id },
        create: {
          portalAccountId: pair.canonical.id,
          mergedSourceUserId: pair.canonical.mergedSourceUserId!,
          legacyPortalEmail: pair.legacy.email,
          legacyUsername: pair.legacy.username,
          lastSyncedAt: new Date(),
        },
        update: {
          mergedSourceUserId: pair.canonical.mergedSourceUserId!,
          legacyPortalEmail: pair.legacy.email,
          legacyUsername: pair.legacy.username ?? undefined,
          lastSyncedAt: new Date(),
        },
      });
      result.mergeMappingsUpdated++;

      const authUsers = await prismaAuth.user.findMany({
        where: { portalAccountId: pair.legacy.id },
        select: { id: true },
      });
      const canonicalAuth = await prismaAuth.user.findUnique({
        where: { portalAccountId: pair.canonical.id },
        select: { id: true },
      });
      for (const authUser of authUsers) {
        if (canonicalAuth && canonicalAuth.id !== authUser.id) {
          // Canonical portal already has an auth user — drop the legacy auth link.
          await prismaAuth.user.update({
            where: { id: authUser.id },
            data: { portalAccountId: null },
          });
          continue;
        }
        await prismaAuth.user.update({
          where: { id: authUser.id },
          data: { portalAccountId: pair.canonical.id },
        });
        result.authPortalRelinked++;
      }
    } else {
      result.actionRequestsUpdated += await prismaPrimary.accountActionRequest.count({
        where: { portalAccountId: pair.legacy.id },
      });
      const legacyEmail = pair.legacy.email.trim().toLowerCase();
      result.createdByEmailsUpdated +=
        (await prismaPrimary.taskItem.count({
          where: { createdBy: { equals: legacyEmail, mode: "insensitive" } },
        })) +
        (await prismaPrimary.taskActivity.count({
          where: { author: { equals: legacyEmail, mode: "insensitive" } },
        })) +
        (await prismaPrimary.kpiMaintenance.count({
          where: { createdBy: { equals: legacyEmail, mode: "insensitive" } },
        }));
      if (pair.legacy.staffDesignatedCompanyId && !pair.canonical.staffDesignatedCompanyId) {
        result.staffCompanyCopied++;
      }
      result.mergeMappingsUpdated++;
    }
  }

  return result;
}
