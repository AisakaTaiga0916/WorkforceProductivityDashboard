import { randomUUID } from "node:crypto";
import { ensureAgentRowForPortalStaff } from "@/lib/admin-roster";
import {
  type CanonicalUserProfile,
  type SyncPortalProfileOptions,
  fallbackEmailFromUsername,
  normalizeCanonicalEmail,
  type SyncSource,
} from "@/lib/auth/canonical-user-profile";
import { mapHrisToPortalRole } from "@/lib/auth/role-mapping";
import { resolveRosterCompanyName } from "@/lib/hris-company-aliases";
import { isMergedUserOrgChartSectionHead } from "@/lib/org-chart-section-scope";
import { prismaAuth, prismaPrimary } from "@/lib/prisma";
import { isStaffPortalRole, normalizePortalRole, type PortalRole } from "@/lib/staff-role";

export type SyncPortalProfileResult = {
  authUserId: string;
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
};

type RoleMappingRow = {
  portalRole: string;
  headPrivileges: boolean;
};

async function loadRoleMapping(hrisRole: string | null | undefined): Promise<RoleMappingRow | null> {
  const key = (hrisRole ?? "").trim().toLowerCase();
  if (!key) return null;
  try {
    return await prismaAuth.roleMapping.findUnique({
      where: { hrisRole: key },
      select: { portalRole: true, headPrivileges: true },
    });
  } catch (e) {
    // Auth DB not migrated yet (missing auth_role_mappings) — fall back to code defaults.
    const code = (e as { code?: string }).code;
    if (code === "P2021" || code === "P2022") return null;
    throw e;
  }
}

async function resolvePortalRole(profile: CanonicalUserProfile): Promise<{
  portalRole: PortalRole;
  headPrivileges: boolean;
}> {
  const dbMapping = await loadRoleMapping(profile.hrisRole);
  const mapped = mapHrisToPortalRole(
    {
      hrisRole: profile.hrisRole ?? profile.portalRole,
      position: profile.position,
      department: profile.department,
    },
    dbMapping
      ? {
          portalRole: normalizePortalRole(dbMapping.portalRole) ?? undefined,
          headPrivileges: dbMapping.headPrivileges,
        }
      : {
          portalRole: profile.portalRole,
          headPrivileges: profile.headPrivileges,
        },
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

async function upsertAuthCompany(profile: CanonicalUserProfile): Promise<string | null> {
  const name = profile.companyName?.trim();
  if (!name) return null;

  // HRIS data can map multiple company names to one company_id, but
  // auth_companies.external_id is unique. Only claim externalId if no other
  // company already owns it, so a shared id never fails the whole sync/login.
  let externalId = profile.companyExternalId ?? null;
  if (externalId != null) {
    const owner = await prismaAuth.company.findUnique({
      where: { externalId },
      select: { name: true },
    });
    if (owner && owner.name !== name) externalId = null;
  }

  try {
    const company = await prismaAuth.company.upsert({
      where: { name },
      create: {
        name,
        externalId,
      },
      update: {
        externalId: externalId ?? undefined,
      },
      select: { id: true },
    });
    return company.id;
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "P2021" || code === "P2022") return null;
    // External_id race/collision: fall back to a name-only company row so
    // login and profile sync still succeed for this user.
    if (code === "P2002") {
      const company = await prismaAuth.company.upsert({
        where: { name },
        create: { name, externalId: null },
        update: {},
        select: { id: true },
      });
      return company.id;
    }
    throw e;
  }
}

async function resolvePrimaryTeamId(companyName: string | null | undefined): Promise<string | null> {
  const rosterName = resolveRosterCompanyName(companyName);
  if (!rosterName) return null;
  const team = await prismaPrimary.team.findFirst({
    where: { name: rosterName },
    select: { id: true },
  });
  return team?.id ?? null;
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

function canReclaimAuthRow(
  row: { hrisSourceUserId: bigint | null },
  incomingHrisId: bigint | null,
): boolean {
  if (row.hrisSourceUserId == null) return true;
  if (incomingHrisId != null && row.hrisSourceUserId === incomingHrisId) return true;
  return isSyntheticHrisSourceId(row.hrisSourceUserId);
}

async function freeAuthUniqueFields(opts: {
  keepAuthUserId?: string;
  email?: string | null;
  username?: string | null;
  portalAccountId?: string | null;
  hrisSourceUserId?: bigint | null;
}) {
  const notKeep = opts.keepAuthUserId ? { NOT: { id: opts.keepAuthUserId } } : {};

  if (opts.username) {
    await prismaAuth.user.updateMany({
      where: { username: opts.username, ...notKeep },
      data: { username: null },
    });
  }
  if (opts.portalAccountId) {
    await prismaAuth.user.updateMany({
      where: { portalAccountId: opts.portalAccountId, ...notKeep },
      data: { portalAccountId: null },
    });
  }
  if (opts.hrisSourceUserId != null) {
    await prismaAuth.user.updateMany({
      where: { hrisSourceUserId: opts.hrisSourceUserId, ...notKeep },
      data: { hrisSourceUserId: null },
    });
  }
  if (opts.email) {
    const owners = await prismaAuth.user.findMany({
      where: { email: opts.email, ...notKeep },
      select: { id: true, hrisSourceUserId: true },
    });
    for (const owner of owners) {
      if (!canReclaimAuthRow(owner, opts.hrisSourceUserId ?? null)) continue;
      await prismaAuth.user.update({
        where: { id: owner.id },
        data: { email: `freed+${owner.id}@portal.local` },
      });
    }
  }
}

async function upsertAuthUser(
  profile: CanonicalUserProfile,
  portalAccountId: string | null,
  companyId: string | null,
  mapped: { portalRole: PortalRole; headPrivileges: boolean },
) {
  const email = normalizeCanonicalEmail(profile.email);
  const username = profile.username?.trim().toLowerCase() || null;
  const hrisId = profile.hrisSourceUserId ?? null;

  // Prefer HRIS / portal link over email — email can belong to a stale
  // portal_ticketing auth row while username login resolves the real HRIS user.
  let authUser =
    (hrisId != null
      ? await prismaAuth.user.findUnique({ where: { hrisSourceUserId: hrisId } })
      : null) ??
    (portalAccountId
      ? await prismaAuth.user.findUnique({ where: { portalAccountId } })
      : null);

  if (!authUser && username) {
    const byUsername = await prismaAuth.user.findUnique({ where: { username } });
    if (byUsername && canReclaimAuthRow(byUsername, hrisId)) authUser = byUsername;
  }

  if (!authUser) {
    const byEmail = await prismaAuth.user.findUnique({ where: { email } });
    if (byEmail && canReclaimAuthRow(byEmail, hrisId)) authUser = byEmail;
  }

  let emailToWrite = email;
  const emailOwner = await prismaAuth.user.findUnique({
    where: { email },
    select: { id: true, hrisSourceUserId: true },
  });
  if (emailOwner && (!authUser || emailOwner.id !== authUser.id)) {
    if (canReclaimAuthRow(emailOwner, hrisId)) {
      await prismaAuth.user.update({
        where: { id: emailOwner.id },
        data: { email: `freed+${emailOwner.id}@portal.local` },
      });
    } else if (authUser) {
      // Real other HRIS user owns this email — keep the row's current address.
      emailToWrite = authUser.email;
    } else {
      // Cannot create under a taken email; fall back to username-derived address.
      emailToWrite = fallbackEmailFromUsername(username) || `user+${randomUUID()}@portal.local`;
    }
  }

  await freeAuthUniqueFields({
    keepAuthUserId: authUser?.id,
    username,
    portalAccountId,
    hrisSourceUserId: hrisId,
  });

  const data = {
    email: emailToWrite,
    name: profile.name,
    username,
    image: profile.image ?? null,
    emailVerified: profile.emailVerified ? new Date() : undefined,
    portalAccountId: portalAccountId ?? undefined,
    hrisSourceUserId: hrisId ?? undefined,
    hrisRole: profile.hrisRole ?? undefined,
    portalRole: mapped.portalRole,
    headPrivileges: mapped.headPrivileges,
    companyId,
    lastSyncedAt: new Date(),
  };

  try {
    if (!authUser) {
      authUser = await prismaAuth.user.create({ data });
    } else {
      authUser = await prismaAuth.user.update({
        where: { id: authUser.id },
        data: {
          ...data,
          emailVerified: profile.emailVerified
            ? authUser.emailVerified ?? new Date()
            : authUser.emailVerified,
          portalAccountId: authUser.portalAccountId ?? portalAccountId ?? undefined,
        },
      });
    }
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code !== "P2002") throw e;
    // Last-resort reclaim after a race / missed stale unique, then retry once.
    await freeAuthUniqueFields({
      keepAuthUserId: authUser?.id,
      email: emailToWrite,
      username,
      portalAccountId,
      hrisSourceUserId: hrisId,
    });
    if (!authUser) {
      authUser = await prismaAuth.user.create({ data });
    } else {
      authUser = await prismaAuth.user.update({
        where: { id: authUser.id },
        data: {
          ...data,
          portalAccountId: authUser.portalAccountId ?? portalAccountId ?? undefined,
        },
      });
    }
  }

  if (profile.oauth) {
    await prismaAuth.account.upsert({
      where: {
        provider_providerAccountId: {
          provider: profile.oauth.provider,
          providerAccountId: profile.oauth.providerAccountId,
        },
      },
      create: {
        userId: authUser.id,
        type: "oauth",
        provider: profile.oauth.provider,
        providerAccountId: profile.oauth.providerAccountId,
      },
      update: { userId: authUser.id },
    });
  }

  return authUser;
}

function isAuthSchemaError(e: unknown): boolean {
  const code = (e as { code?: string }).code;
  return code === "P2021" || code === "P2022" || code === "P2010";
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
      },
    });
  }
  return null;
}

async function upsertPortalAccount(
  profile: CanonicalUserProfile,
  authUserId: string | null,
  mapped: { portalRole: PortalRole; headPrivileges: boolean },
  teamId: string | null,
  forceRoleRefresh = false,
): Promise<{ portal: ExistingPortalRow; created: boolean }> {
  const email = normalizeCanonicalEmail(profile.email);
  const username = profile.username?.trim().toLowerCase() || null;
  const isStaff = isStaffPortalRole(mapped.portalRole);

  const existing = await findExistingPortal(email, username, profile.hrisSourceUserId);

  // Unique columns — free them from any other row before write (avoids P2002 races).
  if (authUserId) {
    await prismaPrimary.portalAccount.updateMany({
      where: {
        authUserId,
        ...(existing ? { NOT: { id: existing.id } } : {}),
      },
      data: { authUserId: null },
    });
  }
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
          authUserId,
          mergedSourceUserId: profile.hrisSourceUserId ?? undefined,
          emailVerifiedAt: profile.emailVerified ? new Date() : undefined,
          profileSyncedAt: new Date(),
          ...(profile.image && !existing.profileImage ? { profileImage: profile.image } : {}),
          ...roleUpdate,
          ...(teamId && isStaff ? { staffDesignatedCompanyId: teamId } : {}),
        },
      });
    };

    try {
      await writeExisting();
    } catch (e) {
      const code =
        e && typeof e === "object" && "code" in e ? String((e as { code?: string }).code) : "";
      if (code !== "P2002") throw e;
      // Concurrent sync raced on unique columns — clear again and retry once.
      if (authUserId) {
        await prismaPrimary.portalAccount.updateMany({
          where: { authUserId, NOT: { id: existing.id } },
          data: { authUserId: null },
        });
      }
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
    headPrivileges: mapped.headPrivileges,
    passwordHash: null as string | null,
    authUserId,
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
  } as const;

  try {
    const created = await prismaPrimary.portalAccount.create({
      data: createData,
      select: selectCreated,
    });
    return { portal: created, created: true };
  } catch (e) {
    const code =
      e && typeof e === "object" && "code" in e ? String((e as { code?: string }).code) : "";
    if (code !== "P2002") throw e;
    // Another worker may have created the row — re-find and update instead.
    const raced = await findExistingPortal(email, username, profile.hrisSourceUserId);
    if (!raced) throw e;
    if (authUserId) {
      await prismaPrimary.portalAccount.updateMany({
        where: { authUserId, NOT: { id: raced.id } },
        data: { authUserId: null },
      });
    }
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
        authUserId,
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
 * Single entry point: Auth DB (source of truth) ↔ Primary portal_accounts (operational profile).
 */
export async function syncPortalProfile(
  profile: CanonicalUserProfile,
  _source: SyncSource = "hris",
  options: SyncPortalProfileOptions = {},
): Promise<SyncPortalProfileResult> {
  const forceRoleRefresh = options.forceRoleRefresh === true;
  const email = normalizeCanonicalEmail(profile.email);
  if (!email) throw new Error("syncPortalProfile: email required");

  const mapped = await resolvePortalRole(profile);
  const authCompanyId = await upsertAuthCompany(profile);
  const teamId = await resolvePrimaryTeamId(profile.companyName);

  const username = profile.username?.trim().toLowerCase() || null;
  const existingPortalRow = await findExistingPortal(email, username, profile.hrisSourceUserId);
  const existingPortal = existingPortalRow
    ? { id: existingPortalRow.id, authUserId: existingPortalRow.authUserId }
    : null;

  let authUserId: string | null = existingPortal?.authUserId ?? null;
  try {
    const authUser = await upsertAuthUser(
      profile,
      existingPortal?.id ?? null,
      authCompanyId,
      mapped,
    );
    authUserId = authUser.id;

    const { portal, created } = await upsertPortalAccount(
      profile,
      authUserId,
      mapped,
      teamId,
      forceRoleRefresh,
    );

    if (authUser.portalAccountId !== portal.id) {
      // portal_account_id is unique on auth_users — free it from any other row first.
      await prismaAuth.user.updateMany({
        where: { portalAccountId: portal.id, NOT: { id: authUser.id } },
        data: { portalAccountId: null },
      });
      await prismaAuth.user.update({
        where: { id: authUser.id },
        data: { portalAccountId: portal.id },
      });
    }

    await ensureAgentRow(portal);

    return {
      authUserId: authUser.id,
      portalAccountId: portal.id,
      created,
    };
  } catch (e) {
    if (!isAuthSchemaError(e)) throw e;
    console.warn("[sync-portal-profile] Auth DB unavailable; syncing portal only.", e);

    const { portal, created } = await upsertPortalAccount(
      profile,
      authUserId,
      mapped,
      teamId,
      forceRoleRefresh,
    );
    await ensureAgentRow(portal);

    return {
      authUserId: authUserId ?? "",
      portalAccountId: portal.id,
      created,
    };
  }
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
