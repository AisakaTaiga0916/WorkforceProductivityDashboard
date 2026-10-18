import { describe, expect, it } from "vitest";
import {
  customRoleKeyFromName,
  normalizeRoleName,
  roleArchiveError,
  roleGrantsEditError,
  sanitizePermissionKeys,
  userChangeError,
  type UserChangeCheck,
} from "@/modules/platform/rbac/rbac-policy";

const base: UserChangeCheck = {
  actorRoleKey: "super_admin",
  actorUserId: "actor",
  targetUserId: "target",
  targetCurrentRoleKey: "employee",
  targetCurrentlyActive: true,
  activeSuperAdminCount: 2,
};

describe("role policy", () => {
  it("locks Super Admin grants and protects system roles from archiving", () => {
    expect(roleGrantsEditError({ key: "super_admin", isSystem: true })).not.toBeNull();
    expect(roleGrantsEditError({ key: "admin", isSystem: true })).toBeNull();
    expect(roleArchiveError({ key: "employee", isSystem: true }, 0)).not.toBeNull();
    expect(roleArchiveError({ key: "custom_x", isSystem: false }, 3)).toMatch(/Reassign/);
    expect(roleArchiveError({ key: "custom_x", isSystem: false }, 0)).toBeNull();
  });

  it("sanitizes grant lists to known unique keys", () => {
    expect(sanitizePermissionKeys(["tasks.read", "tasks.read", "nope", 4])).toEqual(["tasks.read"]);
  });

  it("validates names and builds prefixed custom keys", () => {
    expect(normalizeRoleName("  Finance   Approver ")).toBe("Finance Approver");
    expect(normalizeRoleName("x")).toBeNull();
    expect(customRoleKeyFromName("Finance Approver!")).toBe("custom_finance_approver");
    expect(customRoleKeyFromName("***")).toBe("custom_role");
  });
});

describe("userChangeError", () => {
  it("allows ordinary changes", () => {
    expect(userChangeError({ ...base, nextRoleKey: "admin" })).toBeNull();
  });

  it("only lets a Super Admin grant or revoke Super Admin", () => {
    expect(userChangeError({ ...base, actorRoleKey: "admin", nextRoleKey: "super_admin" })).toMatch(
      /Only a Super Admin/,
    );
    expect(
      userChangeError({
        ...base,
        actorRoleKey: "admin",
        targetCurrentRoleKey: "super_admin",
        nextRoleKey: "employee",
      }),
    ).toMatch(/Only a Super Admin/);
  });

  it("protects the last active Super Admin from demotion and deactivation", () => {
    const last = { ...base, targetCurrentRoleKey: "super_admin", activeSuperAdminCount: 1 };
    expect(userChangeError({ ...last, nextRoleKey: "admin" })).toMatch(/last active Super Admin/);
    expect(userChangeError({ ...last, nextActive: false })).toMatch(/last active Super Admin/);
    expect(userChangeError({ ...last, activeSuperAdminCount: 2, nextRoleKey: "admin" })).toBeNull();
  });

  it("blocks self-deactivation", () => {
    expect(userChangeError({ ...base, targetUserId: "actor", nextActive: false })).toMatch(
      /your own account/,
    );
  });
});
