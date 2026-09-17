import { describe, expect, it } from "vitest";
import { isElevatedUserRole } from "@/lib/auth";

/**
 * Lightweight contract checks for the org-chart head verification policy.
 * DB-backed head resolution is covered by integration; here we lock the elevated override.
 */
describe("task completion verification — org chart head policy", () => {
  it("treats SuperAdmin / HighAdmin as elevated overrides", () => {
    expect(isElevatedUserRole("SuperAdmin")).toBe(true);
    expect(isElevatedUserRole("HighAdmin")).toBe(true);
    expect(isElevatedUserRole("Admin")).toBe(false);
    expect(isElevatedUserRole("Personnel")).toBe(false);
  });
});
