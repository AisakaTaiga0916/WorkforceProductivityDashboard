import { describe, expect, it } from "vitest";
import {
  computeJobOrderDurationDays,
  formatJobOrderDescription,
  parseJobOrderDescription,
  validateJobOrderFields,
} from "@/modules/requests/job-order";

describe("job-order", () => {
  it("rejects target date before start date", () => {
    const result = validateJobOrderFields({
      natureOfConcern: ["Electrical"],
      building: "Main Building",
      startDate: "2026-07-20",
      targetDate: "2026-07-18",
      expectedDuration: "1 day",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Target Date/i);
  });

  it("computes inclusive duration days", () => {
    expect(computeJobOrderDurationDays("2026-07-18", "2026-07-20")).toBe(3);
    expect(computeJobOrderDurationDays("2026-07-18", "2026-07-18")).toBe(1);
  });

  it("round-trips description fields", () => {
    const fields = {
      natureOfConcern: ["Electrical", "Plumbing"],
      building: "Tower A",
      startDate: "2026-07-18",
      targetDate: "2026-07-21",
      expectedDuration: "4 days",
      notes: "Urgent access needed",
    };
    const parsed = parseJobOrderDescription(formatJobOrderDescription(fields));
    expect(parsed).toMatchObject(fields);
  });
});
