import { describe, expect, it } from "vitest";
import { hasRole } from "@/lib/access";
import { mapPortalRoleToMergedHrisRole } from "@/modules/platform/auth/portal-to-merged-role";
import { canBeAssignedStaffWork, canManageAllCompanies } from "@/modules/platform/auth/portal-permissions";
import {
  isElevatedPlatformRole,
  isPlatformSuperAdminPortalRole,
  isStaffPortalRole,
  normalizePortalRole,
  PORTAL_ROLES,
} from "@/lib/staff-role";

describe("HighAdmin role", () => {
  it("is a portal role and normalizes aliases", () => {
    expect(PORTAL_ROLES).toContain("HighAdmin");
    expect(normalizePortalRole("high_admin")).toBe("HighAdmin");
    expect(normalizePortalRole("HighAdmin")).toBe("HighAdmin");
  });

  it("shares SuperAdmin platform privileges but is not SuperAdmin", () => {
    expect(isElevatedPlatformRole("HighAdmin")).toBe(true);
    expect(isElevatedPlatformRole("SuperAdmin")).toBe(true);
    expect(isPlatformSuperAdminPortalRole("HighAdmin")).toBe(false);
    expect(hasRole("HighAdmin", ["SuperAdmin"])).toBe(true);
    expect(hasRole("HighAdmin", ["Admin"])).toBe(true);
    expect(hasRole("HighAdmin", ["Personnel"])).toBe(false);
  });

  it("maps to high_admin so agent pickers do not exclude them", () => {
    expect(mapPortalRoleToMergedHrisRole("HighAdmin")).toBe("high_admin");
    expect(mapPortalRoleToMergedHrisRole("SuperAdmin")).toBe("super_admin");
  });

  it("can be assigned staff work / selected as an approver", () => {
    expect(isStaffPortalRole("HighAdmin")).toBe(true);
    expect(isStaffPortalRole("SuperAdmin")).toBe(false);
    expect(
      canBeAssignedStaffWork({
        portalAccountId: "p1",
        role: "HighAdmin",
      }),
    ).toBe(true);
    expect(
      canBeAssignedStaffWork({
        portalAccountId: "p1",
        role: "SuperAdmin",
      }),
    ).toBe(false);
    expect(
      canManageAllCompanies({
        portalAccountId: "p1",
        role: "HighAdmin",
      }),
    ).toBe(true);
  });
});
