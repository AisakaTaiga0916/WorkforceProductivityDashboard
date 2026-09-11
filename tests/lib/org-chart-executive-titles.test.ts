import { describe, expect, it } from "vitest";
import {
  formatDepartmentDesignationWithExecutiveTitle,
  resolveExecutiveTitle,
} from "@/lib/org-chart-executive-titles";

describe("resolveExecutiveTitle", () => {
  it("resolves CEO / COO by merged HRIS id", () => {
    expect(resolveExecutiveTitle({ mergedSourceUserId: "1676" })).toBe("CEO");
    expect(resolveExecutiveTitle({ mergedSourceUserId: "1842" })).toBe("COO");
  });

  it("falls back to name matching", () => {
    expect(
      resolveExecutiveTitle({ personName: "Manuel Go Uykimpang Iii" }),
    ).toBe("CEO");
    expect(
      resolveExecutiveTitle({ personName: "Cortez, Rocelyn Gantilis" }),
    ).toBe("COO");
  });
});

describe("formatDepartmentDesignationWithExecutiveTitle", () => {
  it("prefixes scope with the executive title", () => {
    expect(
      formatDepartmentDesignationWithExecutiveTitle("CEO", "Audit Committee (+sub-departments)"),
    ).toBe("CEO · Audit Committee (+sub-departments)");
  });

  it("returns title alone when there is no department scope", () => {
    expect(formatDepartmentDesignationWithExecutiveTitle("COO", null)).toBe("COO");
  });
});
