import { randomUUID } from "node:crypto";
import { ensureAgentRowForPortalStaff } from "@/lib/admin-roster";
import {
  type CanonicalUserProfile,
  type SyncPortalProfileOptions,
  fallbackEmailFromUsername,
  normalizeCanonicalEmail,
  type SyncSource,
} from "@/modules/platform/auth/canonical-user-profile";
import { mapHrisToPortalRole } from "@/modules/platform/auth/role-mapping";
import { resolveCompanyLabel } from "@/modules/platform/companies/company-directory";
import { ensureCompanyMembership } from "@/modules/platform/companies/company-membership";
import { isMergedUserOrgChartSectionHead } from "@/modules/platform/scope/org-chart-section-scope";
import { prismaPrimary } from "@/modules/platform/db/prisma";
import { rbacRoleIdForLegacyChange, rbacRoleIdForLegacyRole } from "@/modules/platform/rbac/rbac-role-sync";
import { isStaffPortalRole, normalizePortalRole, type PortalRole } from "@/lib/staff-role";

export type SyncPortalProfileResult = {
  portalAccountId: string;
  created: boolean;
};

type ExistingPortalRow = {
  id: string;
  email: string;
  name: string;
  role: string;
  headPrivileges: boolean;
  username: string | null;
  companyId: string | null;
  staffDesignatedCompanyId: string | null;
  profileImage: string | null;
  authUserId: string | null;
  roleId: string | null;
};

async function resolvePortalRole(profile: CanonicalUserProfile): Promise<{
  portalRole: PortalRole;
  headPrivileges: boolean;
}> {
  const mapped = mapHrisToPortalRole(
    {
      hrisRole: profile.hrisRole ?? profile.portalRole,
      position: profile.position,
      department: profile.department,
    },
    { portalRole: profile.portalRole, headPrivileges: profile.headPrivileges },
  );

  if (
    mapped.portalRole === "SuperAdmin" ||
    mapped.portalRole === "HighAdmin" ||
    mapped.portalRole === "Customer" ||
    mapped.portalRole === "Personnel-Guard"
  ) {
    return mapped;
  }

  // Org-chart department / sub-department heads own Admin vs Personnel.
  const mergedId =
    profile.hrisSourceUserId != null ? String(profile.hrisSourceUserId) : null;
  if (mergedId && (await isMergedUserOrgChartSectionHead(mergedId))) {
    return { portalRole: "Admin", headPrivileges: true };
  }
  return { portalRole: "Personnel", headPrivileges: false };
}

async function resolvePrimaryTeamId(companyName: string | null | undefined): Promise<string | null> {
  return (await resolveCompanyLabel(companyName))?.id ?? null;
}

/**
 * Conflict policy when syncing HRIS/OAuth → Primary portal_accounts:
 * - Profile fields (name, username, image): always refresh from canonical source.
 * - SuperAdmin / HighAdmin: never auto-changed.
 * - Admin with headPrivileges: follow org-chart head overlay (heads → Admin;
 *   former heads → Personnel).
 * - Admin without headPrivileges: keep (SuperAdmin elevate from Org Chart).
 * - Personnel → Admin: allow when incoming says Admin (new chart head).
 */
function buildPortalRoleUpdate(
  existing: ExistingPortalRow,
  incoming: { portalRole: PortalRole; headPrivileges: boolean },
  forceRoleRefresh = false,
): { role?: PortalRole; headPrivileges?: boolean } {
  if (forceRoleRefresh) {
    return { role: incoming.portalRole, headPrivileges: incoming.headPrivileges };
  }

  const existingNorm = normalizePortalRole(existing.role) ?? (existing.role as PortalRole);
  const update: { role?: PortalRole; headPrivileges?: boolean } = {};

  if (existingNorm === "SuperAdmin" || existingNorm === "HighAdmin") {
    return update;
  }

  if (existingNorm === "Customer" && incoming.portalRole !== "Customer") {
    update.role = incoming.portalRole;
    update.headPrivileges = incoming.headPrivileges;
  } else if (
    existingNorm === "Personnel" &&
    (incoming.portalRole === "Admin" ||
      incoming.portalRole === "SuperAdmin" ||
      incoming.portalRole === "HighAdmin")
  ) {
    update.role = incoming.portalRole;
    if (incoming.headPrivileges) update.headPrivileges = true;
  } else if (existingNorm === "Admin" && incoming.portalRole === "Personnel") {
    // Chart-head Admins (headPrivileges) demote when no longer a head.
    // Manual Org Chart elevates keep Admin (headPrivileges false).
    if (existing.headPrivileges) {
      update.role = "Personnel";
      update.headPrivileges = false;
    }
  } else if (incoming.headPrivileges && !existing.headPrivileges) {
    update.headPrivileges = true;
  } else if (
    existingNorm === "Admin" &&
    incoming.portalRole === "Admin" &&
    incoming.headPrivileges &&
    !existing.headPrivileges
  ) {
    update.headPrivileges = true;
  }

  return update;
}

/** portal_ticketing merge ids are synthetic (9e9+); HRIS source ids are real employee ids. */
function isSyntheticHrisSourceId(id: bigint | null | undefined): boolean {
  return id != null && id >= 9000000000n;
}

async function findExistingPortal(
  email: string,
  username: string | null,
  hrisSourceUserId?: bigint | null,
): Promise<ExistingPortalRow | null> {
  if (hrisSourceUserId != null) {
    const bySource = await prismaPrimary.portalAccount.findFirst({
      where: { mergedSourceUserId: hrisSourceUserId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        headPrivileges: true,
        username: true,
        companyId: true,
        staffDesignatedCompanyId: true,
        profileImage: true,
        authUserId: true,
        roleId: true,
      },
    });
    if (bySource) return bySource;
  }

  const byEmail = await prismaPrimary.portalAccount.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      headPrivileges: true,
      username: true,
      companyId: true,
      staffDesignatedCompanyId: true,
      profileImage: true,
      authUserId: true,
      roleId: true,
    },
  });
  if (byEmail) return byEmail;

  if (username) {
    return prismaPrimary.portalAccount.findFirst({
      where: { username: { equals: username, mode: "insensitive" } },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        headPrivileges: true,
        username: true,
        companyId: true,
        staffDesignatedCompanyId: true,
        profileImage: true,
        authUserId: true,
        roleId: true,
      },
    });
  }
  return null;
}

async function upsertPortalAccount(
  profile: CanonicalUserProfile,
  mapped: { portalRole: PortalRole; headPrivileges: boolean },
  teamId: string | null,
  forceRoleRefresh = false,
): Promise<{ portal: ExistingPortalRow; created: boolean }> {
  const email = normalizeCanonicalEmail(profile.email);
  const username = profile.username?.trim().toLowerCase() || null;
  const isStaff = isStaffPortalRole(mapped.portalRole);

  const existing = await findExistingPortal(email, username, profile.hrisSourceUserId);

  // Unique columns — free them from any other row before write (avoids P2002 races).
  if (profile.hrisSourceUserId != null) {
    await prismaPrimary.portalAccount.updateMany({
      where: {
        mergedSourceUserId: profile.hrisSourceUserId,
        ...(existing ? { NOT: { id: existing.id } } : {}),
      },
      data: { mergedSourceUserId: null },
    });
  }

  if (existing) {
    const roleUpdate = buildPortalRoleUpdate(existing, mapped, forceRoleRefresh);
    const roleIdUpdate =
      roleUpdate.role !== undefined || existing.roleId == null
        ? await rbacRoleIdForLegacyChange(existing.roleId, roleUpdate.role ?? existing.role)
        : undefined;
    let usernameUpdate: string | undefined = username ?? existing.username ?? undefined;
    if (username && existing.username?.toLowerCase() !== username) {
      const conflict = await prismaPrimary.portalAccount.findFirst({
        where: {
          username: { equals: username, mode: "insensitive" },
          NOT: { id: existing.id },
        },
        select: { id: true, mergedSourceUserId: true },
      });
      if (conflict) {
        const conflictHris = conflict.mergedSourceUserId;
        const canTake =
          conflictHris == null ||
          isSyntheticHrisSourceId(conflictHris) ||
          (profile.hrisSourceUserId != null && conflictHris === profile.hrisSourceUserId);
        if (canTake) {
          await prismaPrimary.portalAccount.update({
            where: { id: conflict.id },
            data: { username: null },
          });
          usernameUpdate = username;
        } else {
          usernameUpdate = existing.username ?? undefined;
        }
      }
    }

    // Keep portal email aligned with merged_users when the address is free
    // (or only held by a reclaimable / non-HRIS row).
    let emailUpdate: string | undefined;
    if (email && existing.email.trim().toLowerCase() !== email) {
      const emailConflict = await prismaPrimary.portalAccount.findFirst({
        where: {
          email: { equals: email, mode: "insensitive" },
          NOT: { id: existing.id },
        },
        select: { id: true, mergedSourceUserId: true, accountStatus: true },
      });
      if (!emailConflict) {
        emailUpdate = email;
      } else {
        const conflictHris = emailConflict.mergedSourceUserId;
        const canTake =
          emailConflict.accountStatus === "LEGACY_CONFLICT" ||
          conflictHris == null ||
          isSyntheticHrisSourceId(conflictHris) ||
          (profile.hrisSourceUserId != null && conflictHris === profile.hrisSourceUserId);
        if (canTake) {
          await prismaPrimary.portalAccount.update({
            where: { id: emailConflict.id },
            data: {
              email: `freed+${emailConflict.id}@portal.local`,
              mergedSourceUserId: null,
              accountStatus: "LEGACY_CONFLICT",
            },
          });
          emailUpdate = email;
        }
      }
    }

    const writeExisting = async () => {
      await prismaPrimary.portalAccount.update({
        where: { id: existing.id },
        data: {
          name: profile.name,
          username: usernameUpdate,
          ...(emailUpdate ? { email: emailUpdate } : {}),
          mergedSourceUserId: profile.hrisSourceUserId ?? undefined,
          emailVerifiedAt: profile.emailVerified ? new Date() : undefined,
          profileSyncedAt: new Date(),
          ...(profile.image && !existing.profileImage ? { profileImage: profile.image } : {}),
          ...roleUpdate,
          ...(roleIdUpdate !== undefined ? { roleId: roleIdUpdate } : {}),
        },
      });
      // HRIS company only fills gaps: User Management memberships win.
      if (teamId && isStaff) await ensureCompanyMembership(existing.id, teamId);
    };

    try {
      await writeExisting();
    } catch (e) {
      const code =
        e && typeof e === "object" && "code" in e ? String((e as { code?: string }).code) : "";
      if (code !== "P2002") throw e;
      // Concurrent sync raced on unique columns — clear again and retry once.
      if (profile.hrisSourceUserId != null) {
        await prismaPrimary.portalAccount.updateMany({
          where: {
            mergedSourceUserId: profile.hrisSourceUserId,
            NOT: { id: existing.id },
          },
          data: { mergedSourceUserId: null },
        });
      }
      await writeExisting();
    }

    const refreshed = await prismaPrimary.portalAccount.findUniqueOrThrow({
      where: { id: existing.id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        headPrivileges: true,
        username: true,
        companyId: true,
        staffDesignatedCompanyId: true,
        profileImage: true,
        authUserId: true,
        roleId: true,
      },
    });
    return { portal: refreshed, created: false };
  }

  const id = randomUUID();
  const createData = {
    id,
    email,
    username,
    name: profile.name,
    role: mapped.portalRole,
    roleId: (await rbacRoleIdForLegacyRole(mapped.portalRole)) ?? null,
    headPrivileges: mapped.headPrivileges,
    passwordHash: null as string | null,
    mergedSourceUserId: profile.hrisSourceUserId ?? null,
    emailVerifiedAt: profile.emailVerified ? new Date() : null,
    profileImage: profile.image ?? null,
    profileSyncedAt: new Date(),
    staffDesignatedCompanyId: isStaff && teamId ? teamId : null,
    ...(profile.oauth
      ? {
          oauthProvider: profile.oauth.provider,
          oauthSubject: profile.oauth.providerAccountId,
        }
      : {}),
  };
  const selectCreated = {
    id: true,
    email: true,
    name: true,
    role: true,
    headPrivileges: true,
    username: true,
    companyId: true,
    staffDesignatedCompanyId: true,
    profileImage: true,
    authUserId: true,
    roleId: true,
  } as const;

  try {
    const created = await prismaPrimary.portalAccount.create({
      data: createData,
      select: selectCreated,
    });
    if (created.staffDesignatedCompanyId) {
      await ensureCompanyMembership(created.id, created.staffDesignatedCompanyId, { makeDefault: "always" });
    }
    return { portal: created, created: true };
  } catch (e) {
    const code =
      e && typeof e === "object" && "code" in e ? String((e as { code?: string }).code) : "";
    if (code !== "P2002") throw e;
    // Another worker may have created the row — re-find and update instead.
    const raced = await findExistingPortal(email, username, profile.hrisSourceUserId);
    if (!raced) throw e;
    if (profile.hrisSourceUserId != null) {
      await prismaPrimary.portalAccount.updateMany({
        where: {
          mergedSourceUserId: profile.hrisSourceUserId,
          NOT: { id: raced.id },
        },
        data: { mergedSourceUserId: null },
      });
    }
    await prismaPrimary.portalAccount.update({
      where: { id: raced.id },
      data: {
        name: profile.name,
        mergedSourceUserId: profile.hrisSourceUserId ?? undefined,
        profileSyncedAt: new Date(),
      },
    });
    const refreshed = await prismaPrimary.portalAccount.findUniqueOrThrow({
      where: { id: raced.id },
      select: selectCreated,
    });
    return { portal: refreshed, created: false };
  }
}

async function ensureAgentRow(portal: ExistingPortalRow): Promise<void> {
  const role = normalizePortalRole(portal.role);
  const isStaff = isStaffPortalRole(role);
  if (!isStaff || !portal.staffDesignatedCompanyId) return;

  try {
    await ensureAgentRowForPortalStaff(
      { email: portal.email, name: portal.name },
      portal.staffDesignatedCompanyId,
    );
  } catch (e) {
    console.error("[sync-portal-profile] ensureAgentRowForPortalStaff failed", e);
  }
}

/**
 * Single entry point for HRIS / OAuth profiles → main-DB `portal_accounts`
 * (the users table). Nothing is written to the Auth DB or the merged DB.
 */
export async function syncPortalProfile(
  profile: CanonicalUserProfile,
  _source: SyncSource = "hris",
  options: SyncPortalProfileOptions = {},
): Promise<SyncPortalProfileResult> {
  const email = normalizeCanonicalEmail(profile.email);
  if (!email) throw new Error("syncPortalProfile: email required");

  const mapped = await resolvePortalRole(profile);
  const teamId = await resolvePrimaryTeamId(profile.companyName);
  const { portal, created } = await upsertPortalAccount(
    profile,
    mapped,
    teamId,
    options.forceRoleRefresh === true,
  );
  await ensureAgentRow(portal);
  return { portalAccountId: portal.id, created };
}

/** Build canonical profile from merged_users row shape. */
export function canonicalProfileFromMerged(input: {
  sourceUserId: bigint;
  username: string | null;
  name: string;
  email: string | null;
  role: string;
  companyName: string | null;
  companyId?: bigint | null;
  position?: string | null;
  department?: string | null;
}): CanonicalUserProfile {
  const email = input.email?.trim()
    ? normalizeCanonicalEmail(input.email)
    : fallbackEmailFromUsername(input.username);

  const mapped = mapHrisToPortalRole({
    hrisRole: input.role,
    position: input.position,
    department: input.department,
  });

  return {
    email,
    name: input.name.trim() || email.split("@")[0] || "User",
    username: input.username,
    portalRole: mapped.portalRole,
    headPrivileges: mapped.headPrivileges,
    hrisSourceUserId: input.sourceUserId,
    hrisRole: input.role,
    position: input.position ?? null,
    department: input.department ?? null,
    companyName: input.companyName,
    companyExternalId: input.companyId ?? null,
    emailVerified: Boolean(input.email?.trim()),
  };
}

/** Build canonical profile from OAuth sign-in. */
export function canonicalProfileFromOAuth(input: {
  email: string;
  name?: string | null;
  image?: string | null;
  provider: string;
  providerAccountId: string;
  roleHint?: string | null;
}): CanonicalUserProfile {
  const email = normalizeCanonicalEmail(input.email);
  const roleHint = normalizePortalRole(input.roleHint ?? "Customer") ?? "Customer";

  return {
    email,
    name: input.name?.trim() || email.split("@")[0] || "User",
    image: input.image ?? null,
    portalRole: roleHint,
    headPrivileges: roleHint === "Admin",
    emailVerified: true,
    oauth: {
      provider: input.provider,
      providerAccountId: input.providerAccountId,
    },
  };
}
