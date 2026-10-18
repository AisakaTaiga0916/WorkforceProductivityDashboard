import type { PortalRole } from "@/lib/staff-role";
import {
  isAdminPortalRole,
  isElevatedPlatformRole,
  isStaffPortalRole,
  normalizePortalRole,
} from "@/lib/staff-role";

export type PortalPermissionContext = {
  portalAccountId: string;
  role: string;
  headPrivileges?: boolean;
  staffDesignatedCompanyId?: string | null;
  companyId?: string | null;
};

function role(ctx: PortalPermissionContext): PortalRole | null {
  return normalizePortalRole(ctx.role);
}

/** SuperAdmin / HighAdmin: full platform access. */
export function canManageAllCompanies(ctx: PortalPermissionContext): boolean {
  return isElevatedPlatformRole(ctx.role);
}

/** Admin (or legacy headPrivileges): company-scoped coordinator. */
export function canCoordinateCompany(
  ctx: PortalPermissionContext,
  companyTeamId: string,
): boolean {
  if (canManageAllCompanies(ctx)) return true;
  const r = role(ctx);
  if (r !== "Admin" && !ctx.headPrivileges) return false;
  return ctx.staffDesignatedCompanyId === companyTeamId;
}

/**
 * Personnel / Admin / HighAdmin may be assigned tickets/KPIs and selected as approvers.
 * SuperAdmin stays non-assignable (HRIS super_admin is excluded from agent pickers).
 */
export function canBeAssignedStaffWork(ctx: PortalPermissionContext): boolean {
  return isStaffPortalRole(ctx.role);
}

/** Example: create ticket — customers for own company; staff for designated company. */
export function canCreateTicketForCompany(
  ctx: PortalPermissionContext,
  targetCompanyTeamId: string | null,
): boolean {
  if (canManageAllCompanies(ctx)) return true;
  const r = role(ctx);
  if (r === "Customer") return ctx.companyId === targetCompanyTeamId;
  if (isStaffPortalRole(ctx.role)) {
    return ctx.staffDesignatedCompanyId === targetCompanyTeamId;
  }
  return false;
}

/** Example: assign agent — Admin coordinator for that company only. */
export function canAssignAgentOnTicket(
  ctx: PortalPermissionContext,
  ticketCompanyTeamId: string | null,
): boolean {
  if (canManageAllCompanies(ctx)) return true;
  if (!ticketCompanyTeamId) return isAdminPortalRole(ctx.role);
  return canCoordinateCompany(ctx, ticketCompanyTeamId);
}

/** Example: read enriched user label from synced portal profile (no Auth DB round-trip in hot path). */
export function displayRoleLabel(ctx: PortalPermissionContext): string {
  const r = role(ctx);
  if (!r) return ctx.role;
  if (r === "Admin" && ctx.headPrivileges) return "Admin (Head)";
  if (r === "HighAdmin") return "High Admin";
  if (r === "SuperAdmin") return "Super Admin";
  return r;
}
