import { describe, expect, it } from "vitest";
import { ALL_PERMISSION_KEYS } from "@/modules/platform/rbac/permission-catalog";
import {
  ADMIN_ROLE_KEY,
  EMPLOYEE_ROLE_KEY,
  RBAC_ROLE_DEFINITIONS,
  SUPER_ADMIN_ROLE_KEY,
  defaultGrantsForRoleKey,
  grantsForRoleDefinition,
  legacyPortalRoleForRbacRoleKey,
  parseIdentifierList,
  planSeedRoleKey,
  resolveLegacyRoleToRbacRoleKey,
  roleDefinitionForKey,
} from "@/modules/platform/rbac/rbac-seed";

const noPromotions = { superAdmins: [], admins: [] };

describe("system role definitions", () => {
  it("ships exactly Super Admin, Admin, Employee as system roles", () => {
    expect(RBAC_ROLE_DEFINITIONS.map((d) => d.key)).toEqual([
      SUPER_ADMIN_ROLE_KEY,
      ADMIN_ROLE_KEY,
      EMPLOYEE_ROLE_KEY,
    ]);
    expect(RBAC_ROLE_DEFINITIONS.every((d) => d.isSystem)).toBe(true);
  });

  it("Super Admin holds the full catalog", () => {
    const grants = grantsForRoleDefinition(roleDefinitionForKey(SUPER_ADMIN_ROLE_KEY)!).sort();
    expect(grants).toEqual([...ALL_PERMISSION_KEYS].sort());
  });

  it("Admin cannot manage RBAC, system settings, hierarchy, or role assignment", () => {
    const grants = new Set(defaultGrantsForRoleKey(ADMIN_ROLE_KEY));
    expect(grants.has("users.update")).toBe(true);
    expect(grants.has("requests.assign")).toBe(true);
    for (const key of [
      "rbac.read",
      "rbac.manage_permissions",
      "settings.update",
      "hierarchy.update",
      "users.assign",
      "users.create",
      "users.delete",
    ]) {
      expect(grants.has(key as never)).toBe(false);
    }
  });

  it("Employee keeps legacy Personnel behaviour", () => {
    const grants = new Set(defaultGrantsForRoleKey(EMPLOYEE_ROLE_KEY));
    expect(grants.has("requests.create")).toBe(true);
    expect(grants.has("tasks.submit")).toBe(true);
    expect(grants.has("tasks.verify")).toBe(true);
    expect(grants.has("work_plans.approve")).toBe(true);
    expect(grants.has("users.read")).toBe(false);
    expect(grants.has("settings.read")).toBe(false);
  });

  it("returns fresh grant arrays and no defaults for custom roles", () => {
    const first = defaultGrantsForRoleKey(EMPLOYEE_ROLE_KEY)!;
    const before = first.length;
    first.pop();
    expect(defaultGrantsForRoleKey(EMPLOYEE_ROLE_KEY)!.length).toBe(before);
    expect(defaultGrantsForRoleKey("custom_finance")).toBeNull();
  });
});

describe("legacy role mapping", () => {
  it("collapses legacy roles into the three system roles", () => {
    expect(resolveLegacyRoleToRbacRoleKey("SuperAdmin")).toBe(SUPER_ADMIN_ROLE_KEY);
    expect(resolveLegacyRoleToRbacRoleKey("super_admin")).toBe(SUPER_ADMIN_ROLE_KEY);
    expect(resolveLegacyRoleToRbacRoleKey("HighAdmin")).toBe(ADMIN_ROLE_KEY);
    expect(resolveLegacyRoleToRbacRoleKey("Admin")).toBe(ADMIN_ROLE_KEY);
    expect(resolveLegacyRoleToRbacRoleKey("head")).toBe(ADMIN_ROLE_KEY);
    expect(resolveLegacyRoleToRbacRoleKey("Personnel")).toBe(EMPLOYEE_ROLE_KEY);
    expect(resolveLegacyRoleToRbacRoleKey("Personnel-Guard")).toBe(EMPLOYEE_ROLE_KEY);
    expect(resolveLegacyRoleToRbacRoleKey("Customer")).toBeNull();
    expect(resolveLegacyRoleToRbacRoleKey("MysteryTier")).toBeNull();
  });

  it("keeps a legacy label in sync for existing role-name checks", () => {
    expect(legacyPortalRoleForRbacRoleKey(SUPER_ADMIN_ROLE_KEY)).toBe("SuperAdmin");
    expect(legacyPortalRoleForRbacRoleKey(ADMIN_ROLE_KEY, "HighAdmin")).toBe("Admin");
    expect(legacyPortalRoleForRbacRoleKey(EMPLOYEE_ROLE_KEY, "Admin")).toBe("Personnel");
    expect(legacyPortalRoleForRbacRoleKey(EMPLOYEE_ROLE_KEY, "Personnel-Guard")).toBe(
      "Personnel-Guard",
    );
    expect(legacyPortalRoleForRbacRoleKey("custom_finance", "SuperAdmin")).toBe("Personnel");
  });
});

describe("planSeedRoleKey", () => {
  const user = (legacyRole: string | null, extra: Partial<{ email: string; username: string; accountStatus: string }> = {}) => ({
    email: extra.email ?? "jane@example.com",
    username: extra.username ?? "jane",
    legacyRole,
    accountStatus: extra.accountStatus ?? "ACTIVE",
  });

  it("defaults staff to Employee and maps elevated legacy roles", () => {
    expect(planSeedRoleKey(user("Personnel"), noPromotions)).toBe(EMPLOYEE_ROLE_KEY);
    expect(planSeedRoleKey(user("MysteryTier"), noPromotions)).toBe(EMPLOYEE_ROLE_KEY);
    expect(planSeedRoleKey(user("Admin"), noPromotions)).toBe(ADMIN_ROLE_KEY);
    expect(planSeedRoleKey(user("SuperAdmin"), noPromotions)).toBe(SUPER_ADMIN_ROLE_KEY);
  });

  it("leaves customers and legacy-conflict duplicates without a role", () => {
    expect(planSeedRoleKey(user("Customer"), noPromotions)).toBeNull();
    expect(planSeedRoleKey(user("SuperAdmin", { accountStatus: "LEGACY_CONFLICT" }), noPromotions)).toBeNull();
  });

  it("applies seed-config promotions by email or username", () => {
    const promotions = {
      superAdmins: parseIdentifierList("JANE@example.com"),
      admins: parseIdentifierList("bob, carol"),
    };
    expect(planSeedRoleKey(user("Personnel"), promotions)).toBe(SUPER_ADMIN_ROLE_KEY);
    expect(
      planSeedRoleKey(user("Customer", { email: "c@example.com", username: "carol" }), promotions),
    ).toBe(ADMIN_ROLE_KEY);
  });
});
