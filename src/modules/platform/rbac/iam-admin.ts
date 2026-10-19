/**
 * Server helpers for SuperAdmin Settings → Roles / User Management.
 * Authorization (`requirePermission`) is the caller's job.
 */

import type { Prisma } from "@prisma/client/primary";
import { prismaPrimary } from "@/modules/platform/db/prisma";
import {
  ACCOUNT_STATUS_ACTIVE,
  ACCOUNT_STATUS_INACTIVE,
  ACCOUNT_STATUS_LEGACY_CONFLICT,
} from "./account-status";
import {
  PERMISSION_RESOURCE_LABELS,
  allPermissionKeys,
  permissionCatalogByResource,
  type PermissionKey,
} from "./permission-catalog";
import { SUPER_ADMIN_ROLE_KEY } from "./rbac-seed";

export type IamRole = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  archived: boolean;
  userCount: number;
  permissionKeys: string[];
};

export async function listIamRoles(includeArchived = false): Promise<IamRole[]> {
  const roles = await prismaPrimary.role.findMany({
    where: includeArchived ? {} : { archivedAt: null },
    orderBy: [{ isSystem: "desc" }, { createdAt: "asc" }],
    select: {
      id: true,
      key: true,
      name: true,
      description: true,
      isSystem: true,
      archivedAt: true,
      permissions: { select: { permission: { select: { key: true } } } },
      _count: { select: { users: true } },
    },
  });
  return roles.map((r) => ({
    id: r.id,
    key: r.key,
    name: r.name,
    description: r.description,
    isSystem: r.isSystem,
    archived: r.archivedAt != null,
    userCount: r._count.users,
    permissionKeys:
      r.key === SUPER_ADMIN_ROLE_KEY
        ? allPermissionKeys()
        : r.permissions.map((p) => p.permission.key),
  }));
}

export type IamPermissionGroup = {
  resource: string;
  label: string;
  permissions: Array<{ key: string; action: string; description: string }>;
};

export function permissionCatalogForUi(): IamPermissionGroup[] {
  return permissionCatalogByResource().map((group) => ({
    resource: group.resource,
    label: PERMISSION_RESOURCE_LABELS[group.resource],
    permissions: group.permissions.map((p) => ({
      key: p.key,
      action: p.action,
      description: p.description,
    })),
  }));
}

/** Replace a role's grants (row presence = allow). */
export async function replaceRoleGrants(roleId: string, keys: readonly PermissionKey[]) {
  const permissions = await prismaPrimary.permission.findMany({
    where: { key: { in: [...keys] } },
    select: { id: true },
  });
  await prismaPrimary.$transaction([
    prismaPrimary.rolePermission.deleteMany({ where: { roleId } }),
    prismaPrimary.rolePermission.createMany({
      data: permissions.map((p) => ({ roleId, permissionId: p.id })),
    }),
  ]);
}

export async function countActiveSuperAdmins(): Promise<number> {
  return prismaPrimary.portalAccount.count({
    where: { rbacRole: { key: SUPER_ADMIN_ROLE_KEY }, accountStatus: ACCOUNT_STATUS_ACTIVE },
  });
}

export const IAM_USER_STATUS_FILTERS = ["active", "inactive", "conflict", "all"] as const;
export type IamUserStatusFilter = (typeof IAM_USER_STATUS_FILTERS)[number];

export type IamUserQuery = {
  q?: string;
  /** Role id, or `"none"` for users without a role. */
  roleId?: string;
  /** Company id (any membership), or `"none"` for users without company access. */
  companyId?: string;
  status?: IamUserStatusFilter;
  includeCustomers?: boolean;
  /** Restrict to users sharing one of these companies (company-scoped actors). */
  scopeCompanyIds?: readonly string[];
  page?: number;
  pageSize?: number;
};

export const iamUserSelect = {
  id: true,
  name: true,
  email: true,
  username: true,
  role: true,
  roleId: true,
  accountStatus: true,
  passwordHash: true,
  mergedSourceUserId: true,
  rbacRole: { select: { key: true, name: true } },
  companyMemberships: {
    select: { companyId: true, isDefault: true, company: { select: { name: true, isActive: true } } },
  },
} as const;

type IamUserRow = Prisma.PortalAccountGetPayload<{ select: typeof iamUserSelect }>;

export type IamUserCompany = { id: string; name: string; isDefault: boolean; archived: boolean };

export type IamUser = {
  id: string;
  name: string;
  email: string;
  username: string | null;
  legacyRole: string;
  roleId: string | null;
  roleKey: string | null;
  roleName: string | null;
  status: string;
  /** Company access (memberships), default first. */
  companies: IamUserCompany[];
  defaultCompanyId: string | null;
  hrisLinked: boolean;
  hasPassword: boolean;
};

export function toIamUser(row: IamUserRow): IamUser {
  const companies = row.companyMemberships
    .map((m) => ({
      id: m.companyId,
      name: m.company.name,
      isDefault: m.isDefault,
      archived: !m.company.isActive,
    }))
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name));
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    username: row.username,
    legacyRole: row.role,
    roleId: row.roleId,
    roleKey: row.rbacRole?.key ?? null,
    roleName: row.rbacRole?.name ?? null,
    status: row.accountStatus,
    companies,
    defaultCompanyId: companies.find((c) => c.isDefault)?.id ?? null,
    hrisLinked: row.mergedSourceUserId != null,
    hasPassword: Boolean(row.passwordHash),
  };
}

function statusWhere(status: IamUserStatusFilter): Prisma.PortalAccountWhereInput {
  if (status === "active") return { accountStatus: ACCOUNT_STATUS_ACTIVE };
  if (status === "inactive") return { accountStatus: ACCOUNT_STATUS_INACTIVE };
  if (status === "conflict") return { accountStatus: ACCOUNT_STATUS_LEGACY_CONFLICT };
  return {};
}

export async function listIamUsers(query: IamUserQuery) {
  const pageSize = Math.min(Math.max(query.pageSize ?? 50, 1), 200);
  const page = Math.max(query.page ?? 1, 1);
  const q = query.q?.trim();

  const and: Prisma.PortalAccountWhereInput[] = [statusWhere(query.status ?? "active")];
  if (!query.includeCustomers) and.push({ NOT: { role: "Customer", roleId: null } });
  if (q) {
    and.push({
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { username: { contains: q, mode: "insensitive" } },
      ],
    });
  }
  if (query.roleId === "none") and.push({ roleId: null });
  else if (query.roleId) and.push({ roleId: query.roleId });
  if (query.companyId === "none") and.push({ companyMemberships: { none: {} } });
  else if (query.companyId) and.push({ companyMemberships: { some: { companyId: query.companyId } } });
  if (query.scopeCompanyIds !== undefined) {
    and.push({ companyMemberships: { some: { companyId: { in: [...query.scopeCompanyIds] } } } });
  }

  const where: Prisma.PortalAccountWhereInput = { AND: and };
  const [total, rows] = await Promise.all([
    prismaPrimary.portalAccount.count({ where }),
    prismaPrimary.portalAccount.findMany({
      where,
      orderBy: [{ name: "asc" }, { email: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: iamUserSelect,
    }),
  ]);
  return { total, page, pageSize, users: rows.map(toIamUser) };
}

/**
 * Company scope for user administration: Super Admin is global (`undefined`);
 * anyone else is limited to users who share one of their companies (`[]` = none).
 */
export async function actorCompanyScope(
  actorUserId: string,
  actorRoleKey: string | null,
): Promise<string[] | undefined> {
  if (actorRoleKey === SUPER_ADMIN_ROLE_KEY) return undefined;
  const rows = await prismaPrimary.userCompany.findMany({
    where: { portalAccountId: actorUserId, company: { isActive: true } },
    select: { companyId: true },
  });
  return rows.map((r) => r.companyId);
}

/** Active companies (display order) for User Management pickers. */
export async function listIamCompanies() {
  return prismaPrimary.company.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true },
  });
}
