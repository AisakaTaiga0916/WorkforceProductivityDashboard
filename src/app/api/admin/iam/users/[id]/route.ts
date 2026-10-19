import { NextResponse } from "next/server";
import { ensureAgentRowForPortalStaff } from "@/lib/admin-roster";
import {
  ACCOUNT_STATUS_ACTIVE,
  ACCOUNT_STATUS_INACTIVE,
  ACCOUNT_STATUS_LEGACY_CONFLICT,
  accountStatusIsActive,
} from "@/modules/platform/rbac/account-status";
import {
  actorCompanyScope,
  countActiveSuperAdmins,
  iamUserSelect,
  toIamUser,
} from "@/modules/platform/rbac/iam-admin";
import { requirePermission } from "@/modules/platform/rbac/permissions";
import { userChangeError } from "@/modules/platform/rbac/rbac-policy";
import { isCustomerLegacyRole, legacyPortalRoleForRbacRoleKey } from "@/modules/platform/rbac/rbac-seed";
import { prismaPrimary } from "@/modules/platform/db/prisma";
import { setUserCompanyMemberships } from "@/modules/platform/companies/company-membership";
import { normalizeMembershipInput } from "@/modules/platform/scope/company-access-core";

type Ctx = { params: Promise<{ id: string }> };

/**
 * PATCH /api/admin/iam/users/:id
 * Body: { roleId?: string, companyIds?: string[], defaultCompanyId?: string | null, active?: boolean }
 * - roleId requires `users.assign`; company access / active require `users.update`.
 * - `companyIds` replaces the user's memberships; `defaultCompanyId` must be one of them
 *   (send it alone to only change the default).
 * - Non–Super Admins may only edit users who share one of their companies and
 *   cannot change company access.
 * - Lockout guards: last active Super Admin, self-deactivation, Super Admin grants.
 */
export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as {
    roleId?: unknown;
    companyIds?: unknown;
    defaultCompanyId?: unknown;
    active?: unknown;
  };

  const wantsRole = typeof body.roleId === "string" && body.roleId.length > 0;
  const wantsCompanies = body.companyIds !== undefined || body.defaultCompanyId !== undefined;
  const wantsActive = typeof body.active === "boolean";
  if (!wantsRole && !wantsCompanies && !wantsActive) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }
  if (
    body.companyIds !== undefined &&
    (!Array.isArray(body.companyIds) || body.companyIds.some((c) => typeof c !== "string"))
  ) {
    return NextResponse.json({ error: "companyIds must be a list of company ids." }, { status: 400 });
  }
  if (
    body.defaultCompanyId !== undefined &&
    body.defaultCompanyId !== null &&
    typeof body.defaultCompanyId !== "string"
  ) {
    return NextResponse.json({ error: "Invalid default company." }, { status: 400 });
  }

  const needed: string[] = [];
  if (wantsRole) needed.push("users.assign");
  if (wantsCompanies || wantsActive) needed.push("users.update");
  const { session, role: actorRole, unauthorized } = await requirePermission(
    ...(needed as [string, ...string[]]),
  );
  if (unauthorized) return unauthorized;
  const actorId = session?.user?.id;
  if (!actorId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const target = await prismaPrimary.portalAccount.findUnique({
    where: { id },
    select: { ...iamUserSelect, companyId: true },
  });
  if (!target) return NextResponse.json({ error: "User not found." }, { status: 404 });
  if (target.accountStatus === ACCOUNT_STATUS_LEGACY_CONFLICT) {
    return NextResponse.json(
      { error: "Legacy-conflict duplicates cannot be edited. Edit the active account instead." },
      { status: 409 },
    );
  }

  const scope = await actorCompanyScope(actorId, actorRole?.key ?? null);
  if (scope !== undefined) {
    const shares = target.companyMemberships.some((m) => scope.includes(m.companyId));
    if (!shares) {
      return NextResponse.json({ error: "User is outside your company scope." }, { status: 403 });
    }
    if (wantsCompanies) {
      return NextResponse.json(
        { error: "Only a Super Admin can change a user's company access." },
        { status: 403 },
      );
    }
  }

  const nextRole = wantsRole
    ? await prismaPrimary.role.findFirst({
        where: { id: body.roleId as string, archivedAt: null },
        select: { id: true, key: true },
      })
    : null;
  if (wantsRole && !nextRole) {
    return NextResponse.json({ error: "Role not found." }, { status: 404 });
  }

  let membership: { companyIds: string[]; defaultCompanyId: string | null } | null = null;
  if (wantsCompanies) {
    const currentIds = target.companyMemberships.map((m) => m.companyId);
    const requestedIds =
      body.companyIds !== undefined ? (body.companyIds as string[]) : currentIds;
    let defaultId =
      body.defaultCompanyId !== undefined
        ? (body.defaultCompanyId as string | null)
        : (target.companyMemberships.find((m) => m.isDefault)?.companyId ?? null);
    // A kept default that was just deselected falls back to the first selected company.
    if (body.defaultCompanyId === undefined && defaultId && !requestedIds.includes(defaultId)) {
      defaultId = null;
    }
    const normalized = normalizeMembershipInput(requestedIds, defaultId);
    if ("error" in normalized) {
      return NextResponse.json({ error: normalized.error }, { status: 400 });
    }
    membership = normalized;
    const newlyAdded = membership.companyIds.filter((cid) => !currentIds.includes(cid));
    if (newlyAdded.length > 0) {
      const active = await prismaPrimary.company.count({
        where: { id: { in: newlyAdded }, isActive: true },
      });
      if (active !== newlyAdded.length) {
        return NextResponse.json({ error: "Company not found or archived." }, { status: 404 });
      }
    }
  }

  const policyError = userChangeError({
    actorRoleKey: actorRole?.key ?? null,
    actorUserId: actorId,
    targetUserId: target.id,
    targetCurrentRoleKey: target.rbacRole?.key ?? null,
    targetCurrentlyActive: accountStatusIsActive(target.accountStatus),
    nextRoleKey: nextRole?.key,
    nextActive: wantsActive ? (body.active as boolean) : undefined,
    activeSuperAdminCount: await countActiveSuperAdmins(),
  });
  if (policyError) return NextResponse.json({ error: policyError }, { status: 409 });

  const wasCustomer = isCustomerLegacyRole(target.role) && target.roleId == null;
  if (nextRole || wantsActive) {
    await prismaPrimary.portalAccount.update({
      where: { id: target.id },
      data: {
        ...(nextRole
          ? {
              roleId: nextRole.id,
              role: legacyPortalRoleForRbacRoleKey(nextRole.key, target.role),
              headPrivileges: false,
              ...(wasCustomer ? { companyId: null, customerOrgRole: null } : {}),
            }
          : {}),
        ...(wantsActive
          ? { accountStatus: body.active ? ACCOUNT_STATUS_ACTIVE : ACCOUNT_STATUS_INACTIVE }
          : {}),
      },
    });
  }
  if (membership) {
    await setUserCompanyMemberships(target.id, membership.companyIds, membership.defaultCompanyId);
  }

  const updated = await prismaPrimary.portalAccount.findUniqueOrThrow({
    where: { id: target.id },
    select: { ...iamUserSelect, staffDesignatedCompanyId: true },
  });

  const companyForAgent = updated.staffDesignatedCompanyId;
  if (companyForAgent && updated.roleId && (membership || nextRole)) {
    try {
      await ensureAgentRowForPortalStaff({ email: updated.email, name: updated.name }, companyForAgent);
    } catch (e) {
      console.error("[iam/users] ensureAgentRowForPortalStaff failed", e);
    }
  }

  return NextResponse.json({ user: toIamUser(updated) });
}
