import { describe, expect, it } from "vitest";
import { portalRoleDisplayLabel } from "@/lib/staff-role";

describe("portalRoleDisplayLabel", () => {
  it("shows Employee for the stored Personnel role", () => {
    expect(portalRoleDisplayLabel("Personnel")).toBe("Employee");
    expect(portalRoleDisplayLabel("agent")).toBe("Employee");
    expect(portalRoleDisplayLabel("Personnel-Guard")).toBe("Employee (Guard)");
  });

  it("labels the other roles and passes unknown values through", () => {
    expect(portalRoleDisplayLabel("SuperAdmin")).toBe("Super Admin");
    expect(portalRoleDisplayLabel("HighAdmin")).toBe("High Admin");
    expect(portalRoleDisplayLabel("Admin")).toBe("Admin");
    expect(portalRoleDisplayLabel("Customer")).toBe("Customer");
    expect(portalRoleDisplayLabel("Mystery")).toBe("Mystery");
    expect(portalRoleDisplayLabel(null)).toBe("");
  });
});
