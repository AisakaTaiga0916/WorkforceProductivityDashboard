import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/modules/platform/db/prisma", () => ({
  prismaPrimary: {
    portalAccount: { findUnique: vi.fn() },
    role: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/server-session", () => ({
  safeGetServerSession: vi.fn(),
}));

import {
  getEffectivePermissions,
  hasPermission,
  permissionDenied,
  requirePermission,
  resolveRoleIdForSubject,
} from "@/modules/platform/rbac/permissions";
import { accountStatusIsDisabled } from "@/modules/platform/rbac/account-status";
import { ALL_PERMISSION_KEYS } from "@/modules/platform/rbac/permission-catalog";
import { prismaPrimary } from "@/modules/platform/db/prisma";
import { safeGetServerSession } from "@/lib/server-session";

const userFindUnique = vi.mocked(prismaPrimary.portalAccount.findUnique);
const roleFindUnique = vi.mocked(prismaPrimary.role.findUnique);
const safeGetServerSessionMock = vi.mocked(safeGetServerSession);

function role(key: string, grants: string[], archivedAt: Date | null = null) {
  return {
    id: `role-${key}`,
    key,
    name: key,
    archivedAt,
    permissions: grants.map((k) => ({ permission: { key: k } })),
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getEffectivePermissions", () => {
  it("returns grants for the primary role and drops unknown keys", async () => {
    roleFindUnique.mockResolvedValue(role("employee", ["tasks.verify", "requests.read", "not.a.permission"]));
    const perms = await getEffectivePermissions({ roleId: "role-1" });
    expect(perms.has("tasks.verify")).toBe(true);
    expect(perms.has("requests.read")).toBe(true);
    expect([...perms]).not.toContain("not.a.permission");
  });

  it("grants every permission to Super Admin regardless of grant rows", async () => {
    roleFindUnique.mockResolvedValue(role("super_admin", []));
    const perms = await getEffectivePermissions({ roleId: "role-super" });
    expect(perms.size).toBe(ALL_PERMISSION_KEYS.length);
  });

  it("fails closed for an archived role", async () => {
    roleFindUnique.mockResolvedValue(role("custom_x", ["tasks.verify"], new Date()));
    expect((await getEffectivePermissions({ roleId: "role-1" })).size).toBe(0);
  });

  it("fails closed when the role is missing", async () => {
    roleFindUnique.mockResolvedValue(null as never);
    expect((await getEffectivePermissions({ roleId: "missing" })).size).toBe(0);
  });

  it("fails closed when the user cannot be resolved", async () => {
    userFindUnique.mockResolvedValue(null as never);
    expect((await getEffectivePermissions({ email: "nobody@example.com" })).size).toBe(0);
    expect(roleFindUnique).not.toHaveBeenCalled();
  });

  it("fails closed for inactive users", async () => {
    userFindUnique.mockResolvedValue({ id: "u1", roleId: "role-1", accountStatus: "INACTIVE" } as never);
    expect(await resolveRoleIdForSubject({ userId: "u1" })).toBeNull();
    expect(roleFindUnique).not.toHaveBeenCalled();
  });

  it("resolves the role from the main-DB user by id", async () => {
    userFindUnique.mockResolvedValue({ id: "u1", roleId: "role-1", accountStatus: "ACTIVE" } as never);
    expect(await resolveRoleIdForSubject({ userId: "u1" })).toBe("role-1");
    expect(userFindUnique).toHaveBeenCalledWith({
      where: { id: "u1" },
      select: { id: true, roleId: true, accountStatus: true },
    });
  });
});

describe("hasPermission", () => {
  it("denies unknown permission keys without a lookup", async () => {
    expect(await hasPermission({ roleId: "role-1" }, "made.up")).toBe(false);
    expect(roleFindUnique).not.toHaveBeenCalled();
  });

  it("allows a held permission and denies a non-held one", async () => {
    roleFindUnique.mockResolvedValue(role("employee", ["tasks.verify"]));
    expect(await hasPermission({ roleId: "role-1" }, "tasks.verify")).toBe(true);
    expect(await hasPermission({ roleId: "role-1" }, "rbac.manage_permissions")).toBe(false);
  });
});

describe("permissionDenied", () => {
  const session = { user: { id: "portal-1", email: "emp@example.com" } } as never;

  it("returns null when every key is held", async () => {
    userFindUnique.mockResolvedValue({ id: "portal-1", roleId: "role-1", accountStatus: "ACTIVE" } as never);
    roleFindUnique.mockResolvedValue(role("employee", ["requests.approve"]));
    expect(await permissionDenied(session, "requests.approve")).toBeNull();
  });

  it("returns a 403 naming the missing keys", async () => {
    userFindUnique.mockResolvedValue({ id: "portal-1", roleId: "role-1", accountStatus: "ACTIVE" } as never);
    roleFindUnique.mockResolvedValue(role("employee", ["requests.read"]));
    const res = await permissionDenied(session, "requests.approve");
    expect(res?.status).toBe(403);
    expect(await res?.json()).toMatchObject({ code: "PERMISSION_DENIED", missing: ["requests.approve"] });
  });

  it("denies staff without a role", async () => {
    userFindUnique.mockResolvedValue({ id: "portal-1", roleId: null, accountStatus: "ACTIVE" } as never);
    const res = await permissionDenied(session, "tasks.verify");
    expect(res?.status).toBe(403);
    expect((await res?.json()).error).toMatch(/no role assigned/);
  });
});

describe("accountStatusIsDisabled", () => {
  it("flags administrator-disabled statuses but not legacy-conflict duplicates", () => {
    expect(accountStatusIsDisabled("INACTIVE")).toBe(true);
    expect(accountStatusIsDisabled("SUSPENDED")).toBe(true);
    expect(accountStatusIsDisabled("DELETED")).toBe(true);
    expect(accountStatusIsDisabled("LEGACY_CONFLICT")).toBe(false);
    expect(accountStatusIsDisabled("ACTIVE")).toBe(false);
  });
});

describe("requirePermission", () => {
  const session = { user: { id: "portal-1", email: "emp@example.com" } } as never;

  it("returns 401 when there is no session", async () => {
    safeGetServerSessionMock.mockResolvedValue(null as never);
    expect((await requirePermission("tasks.verify")).unauthorized?.status).toBe(401);
  });

  it("returns 403 when the caller lacks the permission", async () => {
    safeGetServerSessionMock.mockResolvedValue(session);
    userFindUnique.mockResolvedValue({ id: "portal-1", roleId: "role-1", accountStatus: "ACTIVE" } as never);
    roleFindUnique.mockResolvedValue(role("employee", ["requests.read"]));
    expect((await requirePermission("tasks.verify")).unauthorized?.status).toBe(403);
  });

  it("requires every listed permission", async () => {
    safeGetServerSessionMock.mockResolvedValue(session);
    userFindUnique.mockResolvedValue({ id: "portal-1", roleId: "role-1", accountStatus: "ACTIVE" } as never);
    roleFindUnique.mockResolvedValue(role("admin", ["users.update"]));
    expect((await requirePermission("users.update", "users.assign")).unauthorized?.status).toBe(403);
  });

  it("allows the caller and reports the role when held", async () => {
    safeGetServerSessionMock.mockResolvedValue(session);
    userFindUnique.mockResolvedValue({ id: "portal-1", roleId: "role-1", accountStatus: "ACTIVE" } as never);
    roleFindUnique.mockResolvedValue(role("employee", ["tasks.verify"]));
    const result = await requirePermission("tasks.verify");
    expect(result.unauthorized).toBeNull();
    expect(result.role?.key).toBe("employee");
    expect(result.permissions?.has("tasks.verify")).toBe(true);
  });
});
