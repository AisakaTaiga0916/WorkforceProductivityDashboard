import { describe, expect, it } from "vitest";
import { helpdeskSupportPercent } from "@/modules/tasks/kpis";

describe("helpdeskSupportPercent", () => {
  it("is (closed in range ÷ (open in range + closed in range)) × 100", () => {
    expect(helpdeskSupportPercent(64, 5)).toBe(92.8);
    expect(helpdeskSupportPercent(16, 1)).toBe(94.1);
    expect(helpdeskSupportPercent(99, 100)).toBe(49.7);
  });

  it("caps at 100%", () => {
    expect(helpdeskSupportPercent(5, 0)).toBe(100);
    expect(helpdeskSupportPercent(50, 50)).toBe(50);
  });

  it("returns null when open + closed in range is zero", () => {
    expect(helpdeskSupportPercent(0, 0)).toBeNull();
  });
});
