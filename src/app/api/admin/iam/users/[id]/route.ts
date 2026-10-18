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

type Ctx = { params: Promise<{ id: string }> };

/**
 * PATCH /api/admin/iam/users/:id
 * Body: { roleId?: string, companyId?: string | null, active?: boolean }
 * - roleId requires `users.assign`; companyId / active require `users.update`.
 * - Non–Super Admins may only edit users in their own company and cannot move them out.
 * - Lockout guards: last active Super Admin, self-deactivation, Super Admin grants.
 */
export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as {
    roleId?: unknown;
    companyId?: unknown;
    active?: unknown;
  };

  const wantsRole = typeof body.roleId === "string" && body.roleId.length > 0;
  const wantsCompany = body.companyId === null || typeof body.companyId === "string";
  const wantsActive = typeof body.active === "boolean";
  if (!wantsRole && !wantsCompany && !wantsActive) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  const needed: string[] = [];
  if (wantsRole) needed.push("users.assign");
  if (wantsCompany || wantsActive) needed.push("users.update");
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
  const nextCompanyId = wantsCompany ? ((body.companyId as string | null) || null) : undefined;
  if (scope !== undefined) {
    if (!scope || target.staffDesignatedCompanyId !== scope) {
      return NextResponse.json({ error: "User is outside your company scope." }, { status: 403 });
    }
    if (nextCompanyId !== undefined && nextCompanyId !== scope) {
      return NextResponse.json(
        { error: "Only a Super Admin can move users between companies." },
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
  if (nextCompanyId) {
    const team = await prismaPrimary.team.findUnique({
      where: { id: nextCompanyId },
      select: { id: true },
    });
    if (!team) return NextResponse.json({ error: "Company not found." }, { status: 404 });
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
  const updated = await prismaPrimary.portalAccount.update({
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
      ...(nextCompanyId !== undefined ? { staffDesignatedCompanyId: nextCompanyId } : {}),
      ...(wantsActive
        ? { accountStatus: body.active ? ACCOUNT_STATUS_ACTIVE : ACCOUNT_STATUS_INACTIVE }
        : {}),
    },
    select: iamUserSelect,
  });

  const companyForAgent = updated.staffDesignatedCompanyId;
  if (companyForAgent && updated.roleId && (nextCompanyId !== undefined || nextRole)) {
    try {
      await ensureAgentRowForPortalStaff({ email: updated.email, name: updated.name }, companyForAgent);
    } catch (e) {
      console.error("[iam/users] ensureAgentRowForPortalStaff failed", e);
    }
  }

  return NextResponse.json({ user: toIamUser(updated) });
}
