import { normalizePortalRole, type PortalRole } from "@/lib/staff-role";

/** Map ticketing portal role → merged_users.role (HRIS-style enum string). */
export function mapPortalRoleToMergedHrisRole(
  portalRole: string | null | undefined,
  headPrivileges = false,
): string {
  const role = normalizePortalRole(portalRole ?? "") ?? "Customer";
  // Keep SuperAdmin as super_admin so assignable-staff loaders exclude them.
  if (role === "SuperAdmin") return "super_admin";
  // HighAdmin stays visible in approver/agent pickers (not filtered as super_admin).
  if (role === "HighAdmin") return "high_admin";
  if (role === "Admin" || headPrivileges) return "admin";
  if (role === "Personnel-Guard") return "personnel_guard";
  if (role === "Personnel") return "employee";
  return "employee";
}

/** Map merged_users.role → portal role for display (inverse; head/leader still from position). */
export function mapMergedHrisRoleToPortalRole(hrisRole: string): PortalRole {
  const key = (hrisRole ?? "").trim().toLowerCase();
  if (key === "super_admin") return "SuperAdmin";
  if (key === "high_admin") return "HighAdmin";
  if (key === "admin") return "Admin";
  if (key === "personnel_guard" || key === "personnel-guard" || key === "personnelguard") {
    return "Personnel-Guard";
  }
  return "Personnel";
}
