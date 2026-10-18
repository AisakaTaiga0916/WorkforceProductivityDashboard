import { describe, expect, it } from "vitest";
import { isHrisHeadTitle, mapHrisToPortalRole } from "@/modules/platform/auth/role-mapping";

describe("mapHrisToPortalRole", () => {
  it("maps super_admin to SuperAdmin", () => {
    expect(mapHrisToPortalRole({ hrisRole: "super_admin" })).toEqual({
      portalRole: "SuperAdmin",
      headPrivileges: false,
    });
  });

  it("maps staff admin/employee to Personnel (Admin comes from org-chart heads)", () => {
    expect(mapHrisToPortalRole({ hrisRole: "admin" })).toEqual({
      portalRole: "Personnel",
      headPrivileges: false,
    });
    expect(
      mapHrisToPortalRole({ hrisRole: "admin", position: "HR Team Head" }),
    ).toEqual({
      portalRole: "Personnel",
      headPrivileges: false,
    });
    expect(mapHrisToPortalRole({ hrisRole: "employee" })).toEqual({
      portalRole: "Personnel",
      headPrivileges: false,
    });
  });

  it("does not elevate from head/leader titles alone", () => {
    expect(
      mapHrisToPortalRole({
        hrisRole: "employee",
        position: "IT & MIS UNIT TEAM LEADER",
        department: "IT DEPARTMENT",
      }),
    ).toEqual({
      portalRole: "Personnel",
      headPrivileges: false,
    });
    expect(
      mapHrisToPortalRole({ hrisRole: "employee", position: "IT Support Head" }),
    ).toEqual({
      portalRole: "Personnel",
      headPrivileges: false,
    });
  });

  it("still detects head titles for legacy callers", () => {
    expect(isHrisHeadTitle({ hrisRole: "employee", position: "Team Head" })).toBe(true);
    expect(isHrisHeadTitle({ hrisRole: "employee", position: "Analyst" })).toBe(false);
  });

  it("keeps elevated overrides; remaps staff Admin override to Personnel", () => {
    expect(
      mapHrisToPortalRole(
        { hrisRole: "employee" },
        { portalRole: "Customer", headPrivileges: false },
      ),
    ).toEqual({
      portalRole: "Customer",
      headPrivileges: false,
    });
    expect(
      mapHrisToPortalRole(
        { hrisRole: "employee" },
        { portalRole: "Admin", headPrivileges: true },
      ),
    ).toEqual({
      portalRole: "Personnel",
      headPrivileges: false,
    });
    expect(
      mapHrisToPortalRole(
        { hrisRole: "employee" },
        { portalRole: "SuperAdmin", headPrivileges: false },
      ),
    ).toEqual({
      portalRole: "SuperAdmin",
      headPrivileges: false,
    });
  });
});
