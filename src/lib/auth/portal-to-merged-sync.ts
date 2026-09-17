/**
 * Sync PortalAccount (source of truth) → merged_users + auth_users + agents.
 * Idempotent; supports dry-run.
 */
import { PrismaClient as PrismaClientSecondary } from "@prisma/client/secondary";
import { randomUUID } from "node:crypto";
import { ensureAgentRowForPortalStaff, pickCanonicalAgentForPortal } from "@/lib/admin-roster";
import { mapPortalRoleToMergedHrisRole } from "@/lib/auth/portal-to-merged-role";
import { isStaffPortalRole, normalizePortalRole } from "@/lib/staff-role";
import { prismaAuth, prismaPrimary } from "@/lib/prisma";
import { withSecondaryWriteClient } from "@/lib/prisma-secondary-write";
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
  authUpdated: number;
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

async function upsertMergedUser(
  db: PrismaClientSecondary | null,
  portal: PortalRow,
  mergedSourceUserId: bigint,
  dryRun: boolean,
): Promise<void> {
  const mergedRole = mapPortalRoleToMergedHrisRole(portal.role, portal.headPrivileges);
  const username = portal.username?.trim() || null;
  const email = portal.email.trim().toLowerCase();
  const hrisTag = process.env.HRIS_MERGE_SOURCE_TAG?.trim() || "hrisdemo";
  const sourceTag =
    portal.mergedSourceUserId != null && portal.mergedSourceUserId < PORTAL_SYNTHETIC_ID_BASE
      ? hrisTag
      : PORTAL_MERGE_SOURCE_TAG;

  if (dryRun || !db) return;

  await db.$executeRaw`
    INSERT INTO merged_users (
      source_user_id,
      source_database,
      username,
      password_hash,
      name,
      email,
      role,
      employment_status,
      is_active,
      merged_at
    ) VALUES (
      ${mergedSourceUserId},
      ${sourceTag},
      ${username},
      ${portal.passwordHash},
      ${portal.name},
      ${email},
      ${mergedRole},
      'active',
      1,
      CURRENT_TIMESTAMP
    )
    ON DUPLICATE KEY UPDATE
      username = COALESCE(VALUES(username), username),
      password_hash = COALESCE(VALUES(password_hash), password_hash),
      name = VALUES(name),
      email = COALESCE(VALUES(email), email),
      role = VALUES(role),
      is_active = 1,
      merged_at = CURRENT_TIMESTAMP
  `;
}

async function syncAuthFromPortal(portal: PortalRow, mergedSourceUserId: bigint, dryRun: boolean): Promise<boolean> {
  const portalRole = normalizePortalRole(portal.role) ?? "Customer";
  const email = portal.email.trim().toLowerCase();
  const username = portal.username?.trim().toLowerCase() || null;
  const hrisRole = mapPortalRoleToMergedHrisRole(portal.role, portal.headPrivileges);

  if (dryRun) return true;

  let authUser =
    (await prismaAuth.user.findUnique({ where: { portalAccountId: portal.id } })) ??
    (await prismaAuth.user.findUnique({ where: { hrisSourceUserId: mergedSourceUserId } })) ??
    (await prismaAuth.user.findUnique({ where: { email } }));

  const data = {
    email,
    name: portal.name,
    username,
    portalAccountId: portal.id,
    hrisSourceUserId: mergedSourceUserId,
    hrisRole,
    portalRole,
    headPrivileges: portal.headPrivileges,
    lastSyncedAt: new Date(),
  };

  if (!authUser) {
    try {
      authUser = await prismaAuth.user.create({ data });
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code !== "P2002") throw e;
      authUser =
        (await prismaAuth.user.findUnique({ where: { portalAccountId: portal.id } })) ??
        (await prismaAuth.user.findUnique({ where: { hrisSourceUserId: mergedSourceUserId } })) ??
        (await prismaAuth.user.findUnique({ where: { email } }));
      if (!authUser) throw e;
    }
  }

  if (authUser) {
    // Unique portal_account_id / hris_source_user_id — free from other auth rows first.
    await prismaAuth.user.updateMany({
      where: { portalAccountId: portal.id, NOT: { id: authUser.id } },
      data: { portalAccountId: null },
    });
    await prismaAuth.user.updateMany({
      where: { hrisSourceUserId: mergedSourceUserId, NOT: { id: authUser.id } },
      data: { hrisSourceUserId: null },
    });

    const emailTaken =
      authUser.email !== email
        ? await prismaAuth.user.findUnique({ where: { email } })
        : null;
    const usernameTaken =
      username && authUser.username !== username
        ? await prismaAuth.user.findUnique({ where: { username } })
        : null;

    try {
      authUser = await prismaAuth.user.update({
        where: { id: authUser.id },
        data: {
          name: data.name,
          email: emailTaken && emailTaken.id !== authUser.id ? authUser.email : email,
          username:
            usernameTaken && usernameTaken.id !== authUser.id ? authUser.username : username,
          portalAccountId: portal.id,
          hrisSourceUserId: mergedSourceUserId,
          hrisRole,
          portalRole,
          headPrivileges: portal.headPrivileges,
          lastSyncedAt: new Date(),
        },
      });
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code !== "P2002") throw e;
      await prismaAuth.user.updateMany({
        where: { portalAccountId: portal.id, NOT: { id: authUser.id } },
        data: { portalAccountId: null },
      });
      await prismaAuth.user.updateMany({
        where: { hrisSourceUserId: mergedSourceUserId, NOT: { id: authUser.id } },
        data: { hrisSourceUserId: null },
      });
      authUser = await prismaAuth.user.update({
        where: { id: authUser.id },
        data: {
          name: data.name,
          portalAccountId: portal.id,
          hrisSourceUserId: mergedSourceUserId,
          hrisRole,
          portalRole,
          headPrivileges: portal.headPrivileges,
          lastSyncedAt: new Date(),
        },
      });
    }
  }

  if (!authUser) {
    throw new Error(`Could not resolve auth user for portal ${portal.id}`);
  }

  // auth_user_id is unique on portal_accounts — free conflicts before link.
  await prismaPrimary.portalAccount.updateMany({
    where: { authUserId: authUser.id, NOT: { id: portal.id } },
    data: { authUserId: null },
  });
  try {
    await prismaPrimary.portalAccount.update({
      where: { id: portal.id },
      data: { authUserId: authUser.id },
    });
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code !== "P2002") throw e;
    await prismaPrimary.portalAccount.updateMany({
      where: { authUserId: authUser.id, NOT: { id: portal.id } },
      data: { authUserId: null },
    });
    await prismaPrimary.portalAccount.update({
      where: { id: portal.id },
      data: { authUserId: authUser.id },
    });
  }
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
    authUpdated: 0,
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

        await upsertMergedUser(secondaryWrite, portal, mergedSourceUserId, dryRun);
        result.mergedUpserted++;

        result.aliasesRegistered += await registerLegacyAliases(portal, dryRun);

        if (await syncAuthFromPortal(portal, mergedSourceUserId, dryRun)) {
          result.authUpdated++;
        }

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
