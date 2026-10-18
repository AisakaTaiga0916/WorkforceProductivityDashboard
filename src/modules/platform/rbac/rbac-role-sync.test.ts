import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/modules/platform/db/prisma", () => ({
  prismaPrimary: {
    role: { findUnique: vi.fn() },
    portalAccount: { findUnique: vi.fn() },
  },
}));

import {
  rbacRoleIdForLegacyChange,
  rbacRoleIdForLegacyRole,
  rbacRoleRelationWrite,
  roleIdPatchForLegacyChange,
} from "@/modules/platform/rbac/rbac-role-sync";
import { prismaPrimary } from "@/modules/platform/db/prisma";

const roleFindUnique = vi.mocked(prismaPrimary.role.findUnique);
const userFindUnique = vi.mocked(prismaPrimary.portalAccount.findUnique);

const SYSTEM_IDS: Record<string, string> = {
  super_admin: "r-super",
  admin: "r-admin",
  employee: "r-employee",
};

beforeEach(() => {
  vi.clearAllMocks();
  roleFindUnique.mockImplementation((async (args: { where: { key?: string; id?: string } }) => {
    if (args.where.key) return SYSTEM_IDS[args.where.key] ? { id: SYSTEM_IDS[args.where.key] } : null;
    if (args.where.id === "r-custom") return { isSystem: false, archivedAt: null };
    if (args.where.id === "r-archived") return { isSystem: false, archivedAt: new Date() };
    return { isSystem: true, archivedAt: null };
  }) as never);
});

describe("rbacRoleIdForLegacyRole", () => {
  it("maps legacy labels onto system roles", async () => {
    expect(await rbacRoleIdForLegacyRole("Personnel")).toBe("r-employee");
    expect(await rbacRoleIdForLegacyRole("HighAdmin")).toBe("r-admin");
    expect(await rbacRoleIdForLegacyRole("SuperAdmin")).toBe("r-super");
  });

  it("clears the role for customers and leaves unknown labels alone", async () => {
    expect(await rbacRoleIdForLegacyRole("Customer")).toBeNull();
    expect(await rbacRoleIdForLegacyRole("Mystery")).toBeUndefined();
  });
});

describe("rbacRoleIdForLegacyChange", () => {
  it("follows the label for system-role users", async () => {
    expect(await rbacRoleIdForLegacyChange("r-employee", "Admin")).toBe("r-admin");
    expect(await rbacRoleIdForLegacyChange(null, "Personnel")).toBe("r-employee");
  });

  it("keeps an active custom role", async () => {
    expect(await rbacRoleIdForLegacyChange("r-custom", "Admin")).toBeUndefined();
  });

  it("replaces an archived custom role", async () => {
    expect(await rbacRoleIdForLegacyChange("r-archived", "Admin")).toBe("r-admin");
  });

  it("builds a scalar patch from the stored role", async () => {
    userFindUnique.mockResolvedValue({ roleId: "r-custom" } as never);
    expect(await roleIdPatchForLegacyChange("u1", "Admin")).toEqual({});
    userFindUnique.mockResolvedValue({ roleId: "r-employee" } as never);
    expect(await roleIdPatchForLegacyChange("u1", "Admin")).toEqual({ roleId: "r-admin" });
  });
});

describe("rbacRoleRelationWrite", () => {
  it("produces connect / disconnect / no-op relation writes", () => {
    expect(rbacRoleRelationWrite("r1")).toEqual({ rbacRole: { connect: { id: "r1" } } });
    expect(rbacRoleRelationWrite(null)).toEqual({ rbacRole: { disconnect: true } });
    expect(rbacRoleRelationWrite(undefined)).toEqual({});
  });
});
