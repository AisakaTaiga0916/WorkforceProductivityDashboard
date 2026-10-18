/**
 * Sync PortalAccount (source of truth) → agents, merge mappings, and portal-only
 * rows in merged_users (for task / efficiency attribution only). HRIS identity
 * flows the other way via the merged-dump import. Idempotent; supports dry-run.
 */
import { PrismaClient as PrismaClientSecondary } from "@prisma/client/secondary";
import { randomUUID } from "node:crypto";
import { ensureAgentRowForPortalStaff, pickCanonicalAgentForPortal } from "@/lib/admin-roster";
import { mapPortalRoleToMergedHrisRole } from "@/modules/platform/auth/portal-to-merged-role";
import { isStaffPortalRole } from "@/lib/staff-role";
import { prismaPrimary } from "@/modules/platform/db/prisma";
import { withSecondaryWriteClient } from "@/modules/platform/db/prisma-secondary-write";
import { mergeAgentOwnership } from "@/lib/reconcile-duplicate-agents";

export const PORTAL_MERGE_SOURCE_TAG =
  process.env.PORTAL_MERGE_SOURCE_TAG?.trim() || "portal_ticketing";

/** Synthetic merged_users IDs for portal-only accounts without HRIS source_user_id. */
const PORTAL_SYNTHETIC_ID_BASE = 9_000_000_000n;

export type PortalToMergedSyncResult = {
  dryRun: boolean;
  portalsProcessed: number;
  mergedUpserted: number;
  mappingsCreated: number;
  aliasesRegistered: number;
  /** HRIS-linked portals are never written back to merged_users (one-way import). */
  hrisRowsSkipped: number;
  agentsEnsured: number;
  agentOwnershipMerged: number;
  errors: Array<{ portalAccountId: string; message: string }>;
};

type PortalRow = {
  id: string;
  email: string;
  name: string;
  username: string | null;
  passwordHash: string | null;
  role: string;
  headPrivileges: boolean;
  mergedSourceUserId: bigint | null;
  accountStatus: string;
  staffDesignatedCompanyId: string | null;
};

function normUsername(v: string | null | undefined): string | null {
  const u = v?.trim().toLowerCase();
  return u || null;
}

async function allocateSyntheticMergedId(): Promise<bigint> {
  const rows = await prismaPrimary.$queryRaw<Array<{ max_id: bigint | null }>>`
    SELECT MAX(merged_source_user_id) AS max_id
    FROM portal_merge_mappings
    WHERE merged_source_user_id >= ${PORTAL_SYNTHETIC_ID_BASE}
  `;
  const current = rows[0]?.max_id ?? PORTAL_SYNTHETIC_ID_BASE - 1n;
  return current + 1n;
}

async function resolveMergedSourceUserId(portal: PortalRow, dryRun: boolean): Promise<bigint> {
  if (portal.mergedSourceUserId != null) return portal.mergedSourceUserId;

  const existing = await prismaPrimary.portalMergeMapping.findUnique({
    where: { portalAccountId: portal.id },
    select: { mergedSourceUserId: true },
  });
  if (existing) return existing.mergedSourceUserId;

  if (dryRun) return PORTAL_SYNTHETIC_ID_BASE;

  const mergedSourceUserId = await allocateSyntheticMergedId();
  await prismaPrimary.portalMergeMapping.create({
    data: {
      portalAccountId: portal.id,
      mergedSourceUserId,
      legacyPortalEmail: portal.email,
      legacyUsername: portal.username,
    },
  });
  await prismaPrimary.portalAccount.update({
    where: { id: portal.id },
    data: { mergedSourceUserId },
  });
  return mergedSourceUserId;
}

async function registerLegacyAliases(portal: PortalRow, dryRun: boolean): Promise<number> {
  let count = 0;
  const canonicalUsername = normUsername(portal.username);
  const portalTokens = personTokens(portal.name);

  const legacyPortals = await prismaPrimary.portalAccount.findMany({
    where: { accountStatus: "LEGACY_CONFLICT" },
    select: { username: true, email: true, name: true },
  });

  const candidates = new Set<string>();
  for (const legacy of legacyPortals) {
    const legacyTokens = personTokens(legacy.name);
    const overlap = [...portalTokens].filter((t) => legacyTokens.has(t)).length;
    const nameMatch = overlap >= 2;
    const emailMatch = legacy.email.toLowerCase() === portal.email.toLowerCase();
    if (!nameMatch && !emailMatch) continue;

    const u = normUsername(legacy.username);
    if (u && u !== canonicalUsername) candidates.add(u);
    const emailLocal = legacy.email.split("@")[0]?.toLowerCase();
    if (emailLocal && emailLocal !== canonicalUsername) candidates.add(emailLocal);
  }

  for (const username of candidates) {
    const exists = await prismaPrimary.portalUsernameAlias.findFirst({
      where: { username: { equals: username, mode: "insensitive" } },
    });
    if (exists) continue;
    count++;
    if (!dryRun) {
      await prismaPrimary.portalUsernameAlias.create({
        data: {
          id: randomUUID(),
          portalAccountId: portal.id,
          username: username.toLowerCase(),
          source: "legacy",
        },
      });
    }
  }
  return count;
}

function personTokens(name: string): Set<string> {
  return new Set(
    name
      .trim()
      .toLowerCase()
      .replace(/[,.]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1),
  );
}

/**
 * Register a portal-only account in merged_users so task / efficiency data can be
 * attributed to it. HRIS-linked accounts are skipped (merged is an import source;
 * HRIS rows are never overwritten), and credentials are never copied. Returns
 * whether a row was written (or would be, on dry runs).
 */
async function upsertMergedUser(
  db: PrismaClientSecondary | null,
  portal: PortalRow,
  mergedSourceUserId: bigint,
  dryRun: boolean,
): Promise<boolean> {
  if (mergedSourceUserId < PORTAL_SYNTHETIC_ID_BASE) return false;
  if (dryRun || !db) return true;

  const mergedRole = mapPortalRoleToMergedHrisRole(portal.role, portal.headPrivileges);
  const username = portal.username?.trim() || null;
  const email = portal.email.trim().toLowerCase();

  await db.$executeRaw`
    INSERT INTO merged_users (
      source_user_id,
      source_database,
      username,
      name,
      email,
      role,
      employment_status,
      is_active,
      merged_at
    ) VALUES (
      ${mergedSourceUserId},
      ${PORTAL_MERGE_SOURCE_TAG},
      ${username},
      ${portal.name},
      ${email},
      ${mergedRole},
      'active',
      1,
      CURRENT_TIMESTAMP
    )
    ON DUPLICATE KEY UPDATE
      username = COALESCE(VALUES(username), username),
      name = VALUES(name),
      email = COALESCE(VALUES(email), email),
      role = VALUES(role),
      is_active = 1,
      merged_at = CURRENT_TIMESTAMP
  `;
  return true;
}

async function upsertPortalMergeMapping(input: {
  portalAccountId: string;
  mergedSourceUserId: bigint;
  legacyPortalEmail: string;
  legacyUsername: string | null;
}): Promise<void> {
  const { portalAccountId, mergedSourceUserId, legacyPortalEmail, legacyUsername } = input;
  const now = new Date();

  // Unique on merged_source_user_id: move or clear any other portal's claim first.
  const conflict = await prismaPrimary.portalMergeMapping.findFirst({
    where: { mergedSourceUserId, NOT: { portalAccountId } },
    select: { portalAccountId: true },
  });
  if (conflict) {
    await prismaPrimary.portalMergeMapping.delete({
      where: { portalAccountId: conflict.portalAccountId },
    });
  }

  const existing = await prismaPrimary.portalMergeMapping.findUnique({
    where: { portalAccountId },
    select: { portalAccountId: true },
  });
  if (existing) {
    await prismaPrimary.portalMergeMapping.update({
      where: { portalAccountId },
      data: {
        mergedSourceUserId,
        legacyPortalEmail,
        legacyUsername,
        lastSyncedAt: now,
      },
    });
    return;
  }

  try {
    await prismaPrimary.portalMergeMapping.create({
      data: {
        portalAccountId,
        mergedSourceUserId,
        legacyPortalEmail,
        legacyUsername,
        lastSyncedAt: now,
      },
    });
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code !== "P2002") throw e;
    // Lost a race — retry as update after freeing the merged id.
    await prismaPrimary.portalMergeMapping.deleteMany({
      where: { mergedSourceUserId, NOT: { portalAccountId } },
    });
    await prismaPrimary.portalMergeMapping.update({
      where: { portalAccountId },
      data: {
        mergedSourceUserId,
        legacyPortalEmail,
        legacyUsername,
        lastSyncedAt: now,
      },
    });
  }
}

async function ensureAgentForPortal(portal: PortalRow, dryRun: boolean): Promise<boolean> {
  if (!isStaffPortalRole(portal.role)) return false;
  if (!portal.staffDesignatedCompanyId) return false;
  if (dryRun) return true;
  await ensureAgentRowForPortalStaff(
    { email: portal.email, name: portal.name },
    portal.staffDesignatedCompanyId,
  );
  return true;
}

/** Merge agent rows from LEGACY_CONFLICT portal onto canonical portal agent. */
async function mergeLegacyAgentOwnership(portal: PortalRow, dryRun: boolean): Promise<number> {
  const agents = await prismaPrimary.agent.findMany({ orderBy: { createdAt: "asc" } });
  const canonicalAgent = pickCanonicalAgentForPortal(portal, agents);
  if (!canonicalAgent) return 0;

  const legacyPortals = await prismaPrimary.portalAccount.findMany({
    where: { accountStatus: "LEGACY_CONFLICT", email: { not: portal.email } },
    select: { email: true, name: true },
  });

  let merged = 0;
  for (const legacy of legacyPortals) {
    if (legacy.name.trim().toLowerCase() !== portal.name.trim().toLowerCase()) continue;
    const legacyAgent = pickCanonicalAgentForPortal(legacy, agents);
    if (!legacyAgent || legacyAgent.id === canonicalAgent.id) continue;
    const result = await mergeAgentOwnership(
      legacyAgent.id,
      { id: canonicalAgent.id, name: portal.name },
      { dryRun },
    );
    if (result.ticketsUpdated + result.kpisUpdated + result.tasksUpdated > 0) merged++;
  }
  return merged;
}

export async function runPortalToMergedSync(options?: {
  dryRun?: boolean;
  portalAccountId?: string;
}): Promise<PortalToMergedSyncResult> {
  const dryRun = options?.dryRun ?? false;
  const result: PortalToMergedSyncResult = {
    dryRun,
    portalsProcessed: 0,
    mergedUpserted: 0,
    mappingsCreated: 0,
    aliasesRegistered: 0,
    hrisRowsSkipped: 0,
    agentsEnsured: 0,
    agentOwnershipMerged: 0,
    errors: [],
  };

  const portals = await prismaPrimary.portalAccount.findMany({
    where: {
      accountStatus: { not: "LEGACY_CONFLICT" },
      ...(options?.portalAccountId ? { id: options.portalAccountId } : {}),
    },
    select: {
      id: true,
      email: true,
      name: true,
      username: true,
      passwordHash: true,
      role: true,
      headPrivileges: true,
      mergedSourceUserId: true,
      accountStatus: true,
      staffDesignatedCompanyId: true,
    },
  });

  const runForPortals = async (secondaryWrite: PrismaClientSecondary | null) => {
    for (const portal of portals) {
      result.portalsProcessed++;
      try {
        const hadMapping = await prismaPrimary.portalMergeMapping.findUnique({
          where: { portalAccountId: portal.id },
        });
        const mergedSourceUserId = await resolveMergedSourceUserId(portal, dryRun);
        if (!hadMapping && !portal.mergedSourceUserId && !dryRun) result.mappingsCreated++;

        if (await upsertMergedUser(secondaryWrite, portal, mergedSourceUserId, dryRun)) {
          result.mergedUpserted++;
        } else {
          result.hrisRowsSkipped++;
        }

        result.aliasesRegistered += await registerLegacyAliases(portal, dryRun);

        if (await ensureAgentForPortal(portal, dryRun)) {
          result.agentsEnsured++;
        }

        result.agentOwnershipMerged += await mergeLegacyAgentOwnership(portal, dryRun);

        if (!dryRun) {
          await upsertPortalMergeMapping({
            portalAccountId: portal.id,
            mergedSourceUserId,
            legacyPortalEmail: portal.email,
            legacyUsername: portal.username,
          });
        }
      } catch (e) {
        result.errors.push({
          portalAccountId: portal.id,
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }
  };

  // Writes go through DATABASE_URL_SECONDARY_SYNC — merge_app is SELECT-only.
  if (dryRun) {
    await runForPortals(null);
  } else {
    await withSecondaryWriteClient((db) => runForPortals(db));
  }

  return result;
}
