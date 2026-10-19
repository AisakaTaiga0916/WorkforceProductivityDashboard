import { NextResponse } from "next/server";
import {
  IAM_USER_STATUS_FILTERS,
  actorCompanyScope,
  listIamCompanies,
  listIamRoles,
  listIamUsers,
  type IamUserStatusFilter,
} from "@/modules/platform/rbac/iam-admin";
import { requirePermission } from "@/modules/platform/rbac/permissions";

/**
 * GET /api/admin/iam/users  (users.read)
 * Query: q, roleId (id | "none"), companyId (id | "none"; matches any membership),
 *        status (active|inactive|conflict|all), customers=1, page, pageSize.
 * Non–Super Admins only see users who share one of their companies.
 */
export async function GET(req: Request) {
  const { session, role, permissions, unauthorized } = await requirePermission("users.read");
  if (unauthorized) return unauthorized;
  const actorId = session?.user?.id;
  if (!actorId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sp = new URL(req.url).searchParams;
  const statusRaw = sp.get("status") ?? "active";
  const status = (IAM_USER_STATUS_FILTERS as readonly string[]).includes(statusRaw)
    ? (statusRaw as IamUserStatusFilter)
    : "active";
  const scopeCompanyIds = await actorCompanyScope(actorId, role?.key ?? null);

  const [result, roles, companies] = await Promise.all([
    listIamUsers({
      q: sp.get("q") ?? undefined,
      roleId: sp.get("roleId") ?? undefined,
      companyId: sp.get("companyId") ?? undefined,
      status,
      includeCustomers: sp.get("customers") === "1",
      scopeCompanyIds,
      page: Number(sp.get("page") ?? 1) || 1,
      pageSize: Number(sp.get("pageSize") ?? 50) || 50,
    }),
    listIamRoles(),
    listIamCompanies(),
  ]);

  return NextResponse.json({
    ...result,
    roles: roles.map((r) => ({ id: r.id, key: r.key, name: r.name, isSystem: r.isSystem })),
    companies:
      scopeCompanyIds === undefined
        ? companies
        : companies.filter((c) => scopeCompanyIds.includes(c.id)),
    viewer: {
      userId: actorId,
      roleKey: role?.key ?? null,
      companyScoped: scopeCompanyIds !== undefined,
      permissions: [...(permissions ?? [])],
    },
  });
}
