import { describe, expect, it } from "vitest";
import {
  importEmailForMergedUser,
  importPasswordHash,
  rbacRoleKeyForHrisRole,
  resolveImportCompanyId,
  selectCanonicalMergedUsers,
  type MergedDumpUser,
} from "@/modules/platform/auth/merged-user-import-plan";

function row(overrides: Partial<MergedDumpUser>): MergedDumpUser {
  return {
    sourceUserId: 1n,
    sourceDatabase: "hris-dev",
    employeeCode: null,
    username: "jane",
    passwordHash: "$2y$10$abc",
    name: "Jane",
    email: "jane@example.com",
    role: "employee",
    companyId: null,
    companyName: null,
    isActive: true,
    ...overrides,
  };
}

describe("selectCanonicalMergedUsers", () => {
  it("keeps one row per person, preferring HRIS-tagged, active, password-bearing rows", () => {
    const portalCopy = row({ sourceUserId: 9000000001n, sourceDatabase: "portal_ticketing" });
    const inactive = row({ sourceUserId: 2n, isActive: false });
    const best = row({ sourceUserId: 3n });
    const { selected, duplicates } = selectCanonicalMergedUsers(
      [portalCopy, inactive, best],
      ["hris-dev"],
    );
    expect(selected.map((r) => r.sourceUserId)).toEqual([3n]);
    expect(duplicates).toHaveLength(2);
  });

  it("treats a shared username as the same person even with different emails", () => {
    const a = row({ sourceUserId: 1n, email: "a@example.com" });
    const b = row({ sourceUserId: 2n, email: "b@example.com" });
    expect(selectCanonicalMergedUsers([b, a], ["hris-dev"]).selected).toHaveLength(1);
  });

  it("reports rows with no email or username", () => {
    const result = selectCanonicalMergedUsers([row({ email: null, username: null })], ["hris-dev"]);
    expect(result.unidentifiable).toHaveLength(1);
    expect(result.selected).toHaveLength(0);
  });
});

describe("import field rules", () => {
  it("falls back to a username email and normalizes Laravel hashes", () => {
    expect(importEmailForMergedUser({ email: " Jane@Example.com ", username: "x" })).toBe(
      "jane@example.com",
    );
    expect(importEmailForMergedUser({ email: null, username: "Jdoe" })).toBe("jdoe@hris.merged");
    expect(importPasswordHash("$2y$10$abc")).toBe("$2a$10$abc");
    expect(importPasswordHash("  ")).toBeNull();
  });

  it("maps HRIS roles: only super_admin / high_admin elevate", () => {
    expect(rbacRoleKeyForHrisRole("super_admin")).toBe("super_admin");
    expect(rbacRoleKeyForHrisRole("high_admin")).toBe("admin");
    expect(rbacRoleKeyForHrisRole("admin")).toBe("employee");
    expect(rbacRoleKeyForHrisRole("employee")).toBe("employee");
  });

  it("resolves companies by HRIS id, then roster alias, then exact name", () => {
    const companies = [
      { id: "t1", name: "ACI", hrisCompanyId: 10n },
      { id: "t2", name: "Lending", hrisCompanyId: null },
    ];
    expect(resolveImportCompanyId({ companyId: 10n, companyName: "x" }, companies, null)).toBe("t1");
    expect(resolveImportCompanyId({ companyId: null, companyName: "LENDING" }, companies, null)).toBe(
      "t2",
    );
    expect(resolveImportCompanyId({ companyId: null, companyName: "Lending Corp" }, companies, "Lending")).toBe(
      "t2",
    );
    expect(resolveImportCompanyId({ companyId: null, companyName: "Unknown" }, companies, null)).toBeNull();
  });
});
