/**
 * Portal account roles stored on PortalAccount.role:
 * SuperAdmin (full platform access; not selectable as an approver — maps to HRIS super_admin),
 * HighAdmin (same platform access as SuperAdmin, but may be set as an approver),
 * Admin (company-scoped coordinator), Personnel, Personnel-Guard (gate-pass kiosk), Customer.
 * Legacy "Head" strings in the DB are normalized to Admin on read.
 */

export const PORTAL_ROLES = [
  "SuperAdmin",
  "HighAdmin",
  "Admin",
  "Personnel",
  "Personnel-Guard",
  "Customer",
] as const;
export type PortalRole = (typeof PORTAL_ROLES)[number];

const LEGACY_PERSONNEL = new Set(
  [
    "personnel",
    "agent",
    "it support",
    "it-support",
    "itsupport",
    "admin", // legacy stored portal label; distinct from role Admin when normalized with other cues
  ].map((s) => s.toLowerCase()),
);

const LEGACY_HEAD = new Set(
  [
    "head",
    "operations head",
    "finance head",
    "hr head",
    "it support head",
  ].map((s) => s.toLowerCase()),
);

/** Self-service signup: Personnel or Customer; Admin is assigned by SuperAdmin in Portal Accounts. */
export const SIGNUP_PORTAL_ROLES = ["Customer", "Personnel"] as const;

/** Staff-facing roster / assignment tooling (includes HighAdmin so they can be approvers/assignees). */
export const STAFF_PORTAL_ROLES = ["HighAdmin", "Admin", "Personnel"] as const;

/** @deprecated use STAFF_PORTAL_ROLES */
export const STAFF_ROLE_OPTIONS = STAFF_PORTAL_ROLES;

/**
 * Maps stored portal role to SuperAdmin | HighAdmin | Admin | Personnel | Personnel-Guard | Customer.
 * Returns null if unknown.
 */
export function normalizePortalRole(role: string | null | undefined): PortalRole | null {
  const raw = (role ?? "").trim().toLowerCase();
  if (!raw) return null;
  if (raw === "superadmin" || raw === "super_admin" || raw === "super-admin") return "SuperAdmin";
  if (raw === "highadmin" || raw === "high_admin" || raw === "high-admin") return "HighAdmin";
  if (raw === "admin") return "Admin";
  if (
    raw === "personnel-guard" ||
    raw === "personnel_guard" ||
    raw === "personnelguard"
  ) {
    return "Personnel-Guard";
  }
  if (raw === "personnel") return "Personnel";
  if (raw === "customer") return "Customer";
  if (LEGACY_HEAD.has(raw) || raw.endsWith(" head")) return "Admin";
  if (LEGACY_PERSONNEL.has(raw)) return "Personnel";
  return null;
}

/**
 * Product-facing label for a portal role. Stored values (and role checks) keep
 * the legacy vocabulary; only what users read changes (Personnel → Employee).
 */
export function portalRoleDisplayLabel(role: string | null | undefined): string {
  switch (normalizePortalRole(role)) {
    case "SuperAdmin":
      return "Super Admin";
    case "HighAdmin":
      return "High Admin";
    case "Admin":
      return "Admin";
    case "Personnel":
      return "Employee";
    case "Personnel-Guard":
      return "Employee (Guard)";
    case "Customer":
      return "Customer";
    default:
      return role?.trim() || "";
  }
}

/** @deprecated use normalizePortalRole */
export function normalizeStaffRoleLabel(role: string | null | undefined): string | null {
  return normalizePortalRole(role);
}

/** Assignable staff (Admin / Personnel / HighAdmin). SuperAdmin is platform-only. */
export function isStaffPortalRole(role: string | null | undefined): boolean {
  const n = normalizePortalRole(role);
  return n === "HighAdmin" || n === "Admin" || n === "Personnel";
}

/** True SuperAdmin only (excluded from approver pickers via HRIS super_admin). */
export function isPlatformSuperAdminPortalRole(role: string | null | undefined): boolean {
  return normalizePortalRole(role) === "SuperAdmin";
}

/** HighAdmin portal role. */
export function isHighAdminPortalRole(role: string | null | undefined): boolean {
  return normalizePortalRole(role) === "HighAdmin";
}

/** Gate-pass kiosk role: travel-orders only, capture Start/End, no create/approve. */
export function isPersonnelGuardPortalRole(role: string | null | undefined): boolean {
  return normalizePortalRole(role) === "Personnel-Guard";
}

/**
 * SuperAdmin or HighAdmin — same platform privileges.
 * Prefer this over `role === "SuperAdmin"` for access checks.
 */
export function isElevatedPlatformRole(role: string | null | undefined): boolean {
  const n = normalizePortalRole(role);
  return n === "SuperAdmin" || n === "HighAdmin";
}

/** Company coordinator tier (assignment board, KPI assignment within company scope). */
export function isAdminPortalRole(role: string | null | undefined): boolean {
  return normalizePortalRole(role) === "Admin";
}

/** @deprecated use isAdminPortalRole */
export function isHeadPortalRole(role: string | null | undefined): boolean {
  return isAdminPortalRole(role);
}

/** Only Admin staff may hold company coordination privileges (replaces Head tier). */
export function isAdminEligibleStaffRole(role: string | null | undefined): boolean {
  return isAdminPortalRole(role);
}

/** @deprecated use isAdminEligibleStaffRole */
export function isHeadEligibleStaffRole(role: string | null | undefined): boolean {
  return isAdminEligibleStaffRole(role);
}
