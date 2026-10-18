import { NextResponse } from "next/server";
import { listIamRoles, replaceRoleGrants } from "@/modules/platform/rbac/iam-admin";
import { requirePermission } from "@/modules/platform/rbac/permissions";
import { roleGrantsEditError, sanitizePermissionKeys } from "@/modules/platform/rbac/rbac-policy";
import { defaultGrantsForRoleKey } from "@/modules/platform/rbac/rbac-seed";
import { prismaPrimary } from "@/modules/platform/db/prisma";

type Ctx = { params: Promise<{ id: string }> };

/**
 * PUT /api/admin/iam/roles/:id/permissions  (rbac.manage_permissions)
 * Body: { permissionKeys: string[] } or { restoreDefaults: true } (system roles only).
 * Super Admin grants are locked to the full catalog.
 */
export async function PUT(req: Request, ctx: Ctx) {
  const { unauthorized } = await requirePermission("rbac.manage_permissions");
  if (unauthorized) return unauthorized;
  const { id } = await ctx.params;

  const role = await prismaPrimary.role.findUnique({
    where: { id },
    select: { id: true, key: true, isSystem: true, archivedAt: true },
  });
  if (!role || role.archivedAt) {
    return NextResponse.json({ error: "Role not found." }, { status: 404 });
  }
  const lockError = roleGrantsEditError(role);
  if (lockError) return NextResponse.json({ error: lockError }, { status: 409 });

  const body = (await req.json().catch(() => ({}))) as {
    permissionKeys?: unknown;
    restoreDefaults?: unknown;
  };

  let keys;
  if (body.restoreDefaults === true) {
    const defaults = defaultGrantsForRoleKey(role.key);
    if (!defaults) {
      return NextResponse.json(
        { error: "Only system roles have defaults to restore." },
        { status: 400 },
      );
    }
    keys = defaults;
  } else if (Array.isArray(body.permissionKeys)) {
    keys = sanitizePermissionKeys(body.permissionKeys);
  } else {
    return NextResponse.json({ error: "permissionKeys array is required." }, { status: 400 });
  }

  await replaceRoleGrants(role.id, keys);
  return NextResponse.json({ roles: await listIamRoles() });
}
