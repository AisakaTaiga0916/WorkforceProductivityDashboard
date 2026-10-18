import { NextResponse } from "next/server";
import { listIamRoles } from "@/modules/platform/rbac/iam-admin";
import { requirePermission } from "@/modules/platform/rbac/permissions";
import { normalizeRoleName, roleArchiveError } from "@/modules/platform/rbac/rbac-policy";
import { prismaPrimary } from "@/modules/platform/db/prisma";

type Ctx = { params: Promise<{ id: string }> };

/**
 * PATCH /api/admin/iam/roles/:id  (rbac.update)
 * Body: { name?: string, description?: string }. System role names are fixed.
 */
export async function PATCH(req: Request, ctx: Ctx) {
  const { unauthorized } = await requirePermission("rbac.update");
  if (unauthorized) return unauthorized;
  const { id } = await ctx.params;

  const role = await prismaPrimary.role.findUnique({
    where: { id },
    select: { id: true, isSystem: true, archivedAt: true },
  });
  if (!role || role.archivedAt) {
    return NextResponse.json({ error: "Role not found." }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as { name?: unknown; description?: unknown };
  const data: { name?: string; description?: string | null } = {};
  if (body.name !== undefined) {
    if (role.isSystem) {
      return NextResponse.json({ error: "System role names cannot be changed." }, { status: 400 });
    }
    const name = normalizeRoleName(body.name);
    if (!name) {
      return NextResponse.json({ error: "Role name must be 2–60 characters." }, { status: 400 });
    }
    const taken = await prismaPrimary.role.findFirst({
      where: { name: { equals: name, mode: "insensitive" }, archivedAt: null, NOT: { id } },
      select: { id: true },
    });
    if (taken) {
      return NextResponse.json({ error: "A role with that name already exists." }, { status: 409 });
    }
    data.name = name;
  }
  if (body.description !== undefined) {
    data.description =
      typeof body.description === "string" ? body.description.trim().slice(0, 300) || null : null;
  }

  await prismaPrimary.role.update({ where: { id }, data });
  return NextResponse.json({ roles: await listIamRoles() });
}

/**
 * DELETE /api/admin/iam/roles/:id  (rbac.archive)
 * Archives a custom role with no assigned users. System roles cannot be archived.
 */
export async function DELETE(_req: Request, ctx: Ctx) {
  const { unauthorized } = await requirePermission("rbac.archive");
  if (unauthorized) return unauthorized;
  const { id } = await ctx.params;

  const role = await prismaPrimary.role.findUnique({
    where: { id },
    select: { key: true, isSystem: true, archivedAt: true, _count: { select: { users: true } } },
  });
  if (!role || role.archivedAt) {
    return NextResponse.json({ error: "Role not found." }, { status: 404 });
  }
  const error = roleArchiveError(role, role._count.users);
  if (error) return NextResponse.json({ error }, { status: 409 });

  await prismaPrimary.role.update({ where: { id }, data: { archivedAt: new Date() } });
  return NextResponse.json({ roles: await listIamRoles() });
}
