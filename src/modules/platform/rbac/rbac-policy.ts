/**
 * Pure guard rules for role and user administration (lockout protection).
 * API routes call these after `requirePermission`; they never grant access.
 */

import { permissionKeyIsKnown, type PermissionKey } from "./permission-catalog";
import { SUPER_ADMIN_ROLE_KEY } from "./rbac-seed";

export type PolicyRole = { key: string; isSystem: boolean };

/** Keep only known, unique permission keys (stable catalog order is not required). */
export function sanitizePermissionKeys(keys: readonly unknown[]): PermissionKey[] {
  const out = new Set<PermissionKey>();
  for (const key of keys) {
    if (typeof key === "string" && permissionKeyIsKnown(key)) out.add(key);
  }
  return [...out];
}

export function roleGrantsEditError(role: PolicyRole): string | null {
  if (role.key === SUPER_ADMIN_ROLE_KEY) {
    return "Super Admin always holds every permission and cannot be edited.";
  }
  return null;
}

export function roleArchiveError(role: PolicyRole, assignedUserCount: number): string | null {
  if (role.isSystem) return "System roles cannot be archived.";
  if (assignedUserCount > 0) {
    return `Reassign the ${assignedUserCount} user(s) on this role before archiving it.`;
  }
  return null;
}

export function normalizeRoleName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 60) return null;
  return name;
}

/** Stable key for a custom role name; prefixed so it never collides with system keys. */
export function customRoleKeyFromName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return `custom_${slug || "role"}`;
}

export type UserChangeCheck = {
  actorRoleKey: string | null;
  actorUserId: string;
  targetUserId: string;
  targetCurrentRoleKey: string | null;
  targetCurrentlyActive: boolean;
  /** `undefined` = role unchanged. */
  nextRoleKey?: string | null;
  /** `undefined` = status unchanged. */
  nextActive?: boolean;
  /** Active Super Admin accounts right now (including the target). */
  activeSuperAdminCount: number;
};

/**
 * - Only a Super Admin can grant or revoke Super Admin.
 * - The last active Super Admin cannot be demoted or deactivated.
 * - Nobody can deactivate their own account.
 */
export function userChangeError(check: UserChangeCheck): string | null {
  const roleChanging =
    check.nextRoleKey !== undefined && check.nextRoleKey !== check.targetCurrentRoleKey;
  const touchesSuperAdmin =
    roleChanging &&
    (check.nextRoleKey === SUPER_ADMIN_ROLE_KEY ||
      check.targetCurrentRoleKey === SUPER_ADMIN_ROLE_KEY);
  if (touchesSuperAdmin && check.actorRoleKey !== SUPER_ADMIN_ROLE_KEY) {
    return "Only a Super Admin can grant or revoke the Super Admin role.";
  }

  if (check.nextActive === false && check.actorUserId === check.targetUserId) {
    return "You cannot deactivate your own account.";
  }

  const targetIsActiveSuperAdmin =
    check.targetCurrentRoleKey === SUPER_ADMIN_ROLE_KEY && check.targetCurrentlyActive;
  const losesSuperAdmin =
    (roleChanging && check.nextRoleKey !== SUPER_ADMIN_ROLE_KEY) || check.nextActive === false;
  if (targetIsActiveSuperAdmin && losesSuperAdmin && check.activeSuperAdminCount <= 1) {
    return "This is the last active Super Admin. Promote another Super Admin first.";
  }

  return null;
}
