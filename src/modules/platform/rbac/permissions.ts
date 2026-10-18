/**
 * Server-side RBAC authorization helpers (main database only).
 *
 * These answer a single question: *what may this user do?* Effective
 * permissions come from the user's one primary role (`portal_accounts.role_id`)
 * and its grants. They deliberately do **not** implement company scope or
 * workflow/seat eligibility — callers apply those as separate checks.
 *
 * Fail-closed guarantees:
 * - Missing/inactive user, missing role, archived role → no permissions.
 * - Unknown permission keys → denied.
 */

import type { Session } from "next-auth";
import { NextResponse } from "next/server";
import { prismaPrimary } from "@/modules/platform/db/prisma";
import { safeGetServerSession } from "@/lib/server-session";
import { accountStatusIsActive } from "./account-status";
import {
  allPermissionKeys,
  permissionKeyIsKnown,
  type PermissionKey,
} from "./permission-catalog";
import { SUPER_ADMIN_ROLE_KEY } from "./rbac-seed";

/**
 * A user we can resolve a primary role for: `roleId` (already resolved),
 * `userId` (portal account id = session `user.id`), or `email`.
 */
export type PermissionSubject = {
  roleId?: string | null;
  userId?: string | null;
  email?: string | null;
};

export type ResolvedRole = {
  id: string;
  key: string;
  name: string;
};

export function permissionSubjectFromSession(
  session: Session | null | undefined,
): PermissionSubject {
  return {
    userId: session?.user?.id ?? null,
    email: session?.user?.email ?? null,
  };
}

const userSelect = { id: true, roleId: true, accountStatus: true } as const;

async function findUserForSubject(subject: PermissionSubject) {
  if (subject.userId) {
    return prismaPrimary.portalAccount.findUnique({
      where: { id: subject.userId },
      select: userSelect,
    });
  }
  const email = subject.email?.trim().toLowerCase();
  if (email) {
    return prismaPrimary.portalAccount.findUnique({
      where: { email },
      select: userSelect,
    });
  }
  return null;
}

/** The subject's primary role id, or `null` when unknown/inactive. */
export async function resolveRoleIdForSubject(
  subject: PermissionSubject,
): Promise<string | null> {
  if (subject.roleId) return subject.roleId;
  const user = await findUserForSubject(subject);
  if (!user || !accountStatusIsActive(user.accountStatus)) return null;
  return user.roleId ?? null;
}

type RoleWithGrants = ResolvedRole & { permissions: Set<PermissionKey> };

async function loadRoleWithGrants(roleId: string): Promise<RoleWithGrants | null> {
  const role = await prismaPrimary.role.findUnique({
    where: { id: roleId },
    select: {
      id: true,
      key: true,
      name: true,
      archivedAt: true,
      permissions: { select: { permission: { select: { key: true } } } },
    },
  });
  if (!role || role.archivedAt) return null;

  if (role.key === SUPER_ADMIN_ROLE_KEY) {
    // A bad grant row must never lock out global administration.
    return { id: role.id, key: role.key, name: role.name, permissions: new Set(allPermissionKeys()) };
  }

  const permissions = new Set<PermissionKey>();
  for (const grant of role.permissions) {
    const key = grant.permission.key;
    if (permissionKeyIsKnown(key)) permissions.add(key);
  }
  return { id: role.id, key: role.key, name: role.name, permissions };
}

/** Primary role + effective permissions; `role` is null when nothing resolves. */
export async function getEffectiveAccess(
  subject: PermissionSubject,
): Promise<{ role: ResolvedRole | null; permissions: Set<PermissionKey> }> {
  const roleId = await resolveRoleIdForSubject(subject);
  const role = roleId ? await loadRoleWithGrants(roleId) : null;
  if (!role) return { role: null, permissions: new Set<PermissionKey>() };
  const { permissions, ...resolved } = role;
  return { role: resolved, permissions };
}

export async function getEffectivePermissions(
  subject: PermissionSubject,
): Promise<Set<PermissionKey>> {
  return (await getEffectiveAccess(subject)).permissions;
}

/** True when the subject holds the named permission. Unknown keys are denied. */
export async function hasPermission(
  subject: PermissionSubject,
  permissionKey: string,
): Promise<boolean> {
  if (!permissionKeyIsKnown(permissionKey)) return false;
  const permissions = await getEffectivePermissions(subject);
  return permissions.has(permissionKey);
}

function forbiddenResponse(role: ResolvedRole | null, missing: readonly string[]) {
  return NextResponse.json(
    {
      error: role
        ? `Forbidden: your role (${role.name}) lacks ${missing.join(", ")}.`
        : "Forbidden: your account has no role assigned. Ask a Super Admin to assign one.",
      code: "PERMISSION_DENIED",
      missing,
    },
    { status: 403 },
  );
}

/**
 * For handlers that already resolved a session: `null` when the user holds
 * every key, otherwise a 403 response. Callers still apply company scope and
 * workflow-seat checks separately.
 */
export async function permissionDenied(
  session: Session,
  ...permissionKeys: [string, ...string[]]
): Promise<NextResponse | null> {
  const { role, permissions } = await getEffectiveAccess(permissionSubjectFromSession(session));
  const missing = permissionKeys.filter(
    (key) => !permissionKeyIsKnown(key) || !permissions.has(key),
  );
  return missing.length > 0 ? forbiddenResponse(role, missing) : null;
}

export type PermissionGuardResult = {
  session: Session | null;
  role: ResolvedRole | null;
  permissions: Set<PermissionKey> | null;
  unauthorized: NextResponse | null;
};

/**
 * API authorization guard. Reads the session, resolves effective permissions,
 * and returns a 401/403 `NextResponse` unless the caller holds **every** key.
 *
 * Usage:
 *   const { session, unauthorized } = await requirePermission("tasks.verify");
 *   if (unauthorized) return unauthorized;
 */
export async function requirePermission(
  ...permissionKeys: [string, ...string[]]
): Promise<PermissionGuardResult> {
  const session = await safeGetServerSession();
  if (!session?.user) {
    return {
      session: null,
      role: null,
      permissions: null,
      unauthorized: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const { role, permissions } = await getEffectiveAccess(permissionSubjectFromSession(session));
  const missing = permissionKeys.filter(
    (key) => !permissionKeyIsKnown(key) || !permissions.has(key),
  );
  if (missing.length > 0) {
    return { session, role, permissions, unauthorized: forbiddenResponse(role, missing) };
  }

  return { session, role, permissions, unauthorized: null };
}
