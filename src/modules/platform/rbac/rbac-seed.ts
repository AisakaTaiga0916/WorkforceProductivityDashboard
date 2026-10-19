/**
 * RBAC system roles, default grants, and legacy-role mapping.
 *
 * Pure (no database access) so it can be unit-tested and shared by
 * `scripts/seed-iam.ts`, the merged-user import, and the Roles UI.
 *
 * v1 ships exactly three system roles: Super Admin, Admin, Employee.
 * Custom roles are created in SuperAdmin Settings → Roles.
 */

import {
  ALL_PERMISSION_KEYS,
  type PermissionKey,
} from "./permission-catalog";

export const SUPER_ADMIN_ROLE_KEY = "super_admin";
export const ADMIN_ROLE_KEY = "admin";
export const EMPLOYEE_ROLE_KEY = "employee";

export const SYSTEM_ROLE_KEYS = [SUPER_ADMIN_ROLE_KEY, ADMIN_ROLE_KEY, EMPLOYEE_ROLE_KEY] as const;
export type SystemRoleKey = (typeof SYSTEM_ROLE_KEYS)[number];

export type RbacRoleDefinition = {
  key: SystemRoleKey;
  name: string;
  description: string;
  /** System roles cannot be archived or deleted. */
  isSystem: true;
  /** When true, the role receives every catalog permission. */
  grantAllPermissions?: boolean;
  grants: readonly PermissionKey[];
};

const EMPLOYEE_GRANTS: readonly PermissionKey[] = [
  "requests.create",
  "requests.read",
  "requests.update",
  "requests.submit",
  "requests.approve",
  "tasks.read",
  "tasks.update",
  "tasks.submit",
  "tasks.verify",
  "projects.read",
  "projects.update",
  "work_plans.read",
  "work_plans.update",
  "work_plans.submit",
  "work_plans.approve",
  "hierarchy.read",
  "reports.read",
];

const ADMIN_GRANTS: readonly PermissionKey[] = [
  ...EMPLOYEE_GRANTS,
  "requests.assign",
  "tasks.create",
  "tasks.assign",
  "projects.create",
  "projects.assign",
  "work_plans.create",
  "work_plans.assign",
  "users.read",
  "users.update",
  "settings.read",
  "reports.export",
];

/**
 * - Super Admin always holds the full catalog (reconciled on every seed and
 *   short-circuited in `getEffectivePermissions`).
 * - Admin replaces legacy HighAdmin + Admin. No `rbac.*`, `settings.update`,
 *   `hierarchy.update`, or role assignment — company scope still applies.
 * - Employee replaces legacy Personnel. `approve`/`verify` still require the
 *   workflow seat / org-chart eligibility check.
 */
export const RBAC_ROLE_DEFINITIONS: readonly RbacRoleDefinition[] = [
  {
    key: SUPER_ADMIN_ROLE_KEY,
    name: "Super Admin",
    description:
      "Built-in global administrator. Holds every permission; cannot be archived or edited.",
    isSystem: true,
    grantAllPermissions: true,
    grants: [],
  },
  {
    key: ADMIN_ROLE_KEY,
    name: "Admin",
    description:
      "Company administrator: assigns work and manages users within company scope. No role or system configuration.",
    isSystem: true,
    grants: ADMIN_GRANTS,
  },
  {
    key: EMPLOYEE_ROLE_KEY,
    name: "Employee",
    description: "Standard employee: create and work on requests, tasks, and work plans.",
    isSystem: true,
    grants: EMPLOYEE_GRANTS,
  },
];

const ROLE_DEFINITION_BY_KEY = new Map<string, RbacRoleDefinition>(
  RBAC_ROLE_DEFINITIONS.map((r) => [r.key, r]),
);

export function roleDefinitionForKey(key: string): RbacRoleDefinition | undefined {
  return ROLE_DEFINITION_BY_KEY.get(key);
}

export function isSystemRoleKey(key: string | null | undefined): key is SystemRoleKey {
  return Boolean(key) && ROLE_DEFINITION_BY_KEY.has(key!);
}

/** Expand a role definition into its permission keys (fresh array). */
export function grantsForRoleDefinition(def: RbacRoleDefinition): PermissionKey[] {
  if (def.grantAllPermissions) return [...ALL_PERMISSION_KEYS];
  return [...def.grants];
}

/** Default grants for a system role, or `null` for custom roles. */
export function defaultGrantsForRoleKey(key: string): PermissionKey[] | null {
  const def = roleDefinitionForKey(key);
  return def ? grantsForRoleDefinition(def) : null;
}

// ---------------------------------------------------------------------------
// Legacy role ↔ RBAC role mapping
// ---------------------------------------------------------------------------

function normalizeLegacyRoleToken(role: string | null | undefined): string {
  return (role ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Maps a legacy portal role (or HRIS role) to an RBAC system role key.
 *
 * High Admin and Personnel are no longer product roles: they collapse into
 * Admin and Employee. `Customer` maps to `null` (Guest is deferred; customers
 * get no staff role). Unknown values return `null` so callers decide.
 */
export function resolveLegacyRoleToRbacRoleKey(
  legacyRole: string | null | undefined,
): SystemRoleKey | null {
  switch (normalizeLegacyRoleToken(legacyRole)) {
    case "superadmin":
      return SUPER_ADMIN_ROLE_KEY;
    case "highadmin":
    case "admin":
    case "head":
      return ADMIN_ROLE_KEY;
    case "personnel":
    case "agent":
    case "employee":
    case "personnelguard":
      return EMPLOYEE_ROLE_KEY;
    default:
      return null;
  }
}

export function isCustomerLegacyRole(legacyRole: string | null | undefined): boolean {
  return normalizeLegacyRoleToken(legacyRole) === "customer";
}

/**
 * Legacy `portal_accounts.role` label to store alongside an RBAC role, so the
 * existing role-name checks keep working until routes move to permissions.
 *
 * - Custom roles fall back to `Personnel` (least-privileged staff label).
 * - Personnel-Guard kiosk accounts keep their restricted label on Employee.
 */
export function legacyPortalRoleForRbacRoleKey(
  roleKey: string,
  currentLegacyRole?: string | null,
): "SuperAdmin" | "Admin" | "Personnel" | "Personnel-Guard" {
  if (roleKey === SUPER_ADMIN_ROLE_KEY) return "SuperAdmin";
  if (roleKey === ADMIN_ROLE_KEY) return "Admin";
  if (normalizeLegacyRoleToken(currentLegacyRole) === "personnelguard") return "Personnel-Guard";
  return "Personnel";
}

// ---------------------------------------------------------------------------
// Seed / import role planning
// ---------------------------------------------------------------------------

export type RolePromotions = {
  /** Emails or usernames (case-insensitive) promoted to Super Admin. */
  superAdmins: readonly string[];
  /** Emails or usernames (case-insensitive) promoted to Admin. */
  admins: readonly string[];
};

export type SeedRoleSubject = {
  email: string;
  username: string | null;
  legacyRole: string | null;
  accountStatus: string;
};

export function parseIdentifierList(raw: string | null | undefined): string[] {
  return (raw ?? "")
    .split(/[,;\s]+/)
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
}

function subjectMatches(subject: SeedRoleSubject, list: readonly string[]): boolean {
  if (list.length === 0) return false;
  const email = subject.email.trim().toLowerCase();
  const username = subject.username?.trim().toLowerCase() ?? "";
  return list.some((id) => id === email || (username !== "" && id === username));
}

/**
 * Role a user receives after an IAM wipe:
 * 1. Legacy-conflict duplicates get no role (they cannot sign in).
 * 2. Seed-config promotions win (Super Admin, then Admin).
 * 3. Otherwise the legacy role maps onto Super Admin / Admin / Employee.
 * 4. Customers stay role-less; everything else defaults to Employee.
 */
export function planSeedRoleKey(
  subject: SeedRoleSubject,
  promotions: RolePromotions,
): SystemRoleKey | null {
  if (subject.accountStatus === "LEGACY_CONFLICT") return null;
  if (subjectMatches(subject, promotions.superAdmins)) return SUPER_ADMIN_ROLE_KEY;
  if (subjectMatches(subject, promotions.admins)) return ADMIN_ROLE_KEY;
  if (isCustomerLegacyRole(subject.legacyRole)) return null;
  return resolveLegacyRoleToRbacRoleKey(subject.legacyRole) ?? EMPLOYEE_ROLE_KEY;
}
