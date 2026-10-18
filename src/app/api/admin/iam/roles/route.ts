import { NextResponse } from "next/server";
import {
  listIamRoles,
  permissionCatalogForUi,
  replaceRoleGrants,
} from "@/modules/platform/rbac/iam-admin";
import { allPermissionKeys } from "@/modules/platform/rbac/permission-catalog";
import { requirePermission } from "@/modules/platform/rbac/permissions";
import {
  customRoleKeyFromName,
  normalizeRoleName,
  sanitizePermissionKeys,
} from "@/modules/platform/rbac/rbac-policy";
import { SUPER_ADMIN_ROLE_KEY } from "@/modules/platform/rbac/rbac-seed";
import { prismaPrimary } from "@/modules/platform/db/prisma";

/**
 * GET /api/admin/iam/roles  (rbac.read)
 * Roles with grants + user counts, and the permission catalog grouped for the matrix.
 */
export async function GET(req: Request) {
  const { permissions, unauthorized } = await requirePermission("rbac.read");
  if (unauthorized) return unauthorized;

  const includeArchived = new URL(req.url).searchParams.get("archived") === "1";
  const roles = await listIamRoles(includeArchived);
  return NextResponse.json({
    roles,
    catalog: permissionCatalogForUi(),
    viewerPermissions: [...(permissions ?? [])],
  });
}

/**
 * POST /api/admin/iam/roles  (rbac.create)
 * Body: { name: string, description?: string, copyFromRoleId?: string }
 */
export async function POST(req: Request) {
  const { unauthorized } = await requirePermission("rbac.create");
  if (unauthorized) return unauthorized;

  const body = (await req.json().catch(() => ({}))) as {
    name?: unknown;
    description?: unknown;
    copyFromRoleId?: unknown;
  };
  const name = normalizeRoleName(body.name);
  if (!name) {
    return NextResponse.json({ error: "Role name must be 2–60 characters." }, { status: 400 });
  }
  const description =
    typeof body.description === "string" ? body.description.trim().slice(0, 300) || null : null;

  const nameTaken = await prismaPrimary.role.findFirst({
    where: { name: { equals: name, mode: "insensitive" }, archivedAt: null },
    select: { id: true },
  });
  if (nameTaken) {
    return NextResponse.json({ error: "A role with that name already exists." }, { status: 409 });
  }

  let grants: string[] = [];
  if (typeof body.copyFromRoleId === "string" && body.copyFromRoleId) {
    const source = await prismaPrimary.role.findUnique({
      where: { id: body.copyFromRoleId },
      select: { key: true, permissions: { select: { permission: { select: { key: true } } } } },
    });
    if (!source) return NextResponse.json({ error: "Template role not found." }, { status: 404 });
    grants =
      source.key === SUPER_ADMIN_ROLE_KEY
        ? allPermissionKeys()
        : source.permissions.map((p) => p.permission.key);
  }

  const baseKey = customRoleKeyFromName(name);
  let key = baseKey;
  for (let n = 2; await prismaPrimary.role.findUnique({ where: { key }, select: { id: true } }); n += 1) {
    key = `${baseKey}_${n}`;
  }

  const role = await prismaPrimary.role.create({
    data: { key, name, description, isSystem: false },
    select: { id: true },
  });
  const keys = sanitizePermissionKeys(grants);
  if (keys.length > 0) await replaceRoleGrants(role.id, keys);

  const roles = await listIamRoles();
  return NextResponse.json({ role: roles.find((r) => r.id === role.id), roles }, { status: 201 });
}
