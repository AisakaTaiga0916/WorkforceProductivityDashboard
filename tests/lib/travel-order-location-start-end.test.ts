import { describe, expect, it } from "vitest";
import {
  travelOrderLocationVisitStatus,
  travelOrderLocationVisitStatusLabel,
} from "@/modules/work-plans/travel-order";

describe("travel order location start/end status", () => {
  it("is pending before start", () => {
    expect(
      travelOrderLocationVisitStatus({
        startedAt: null,
        endedAt: null,
        checkedAt: null,
      }),
    ).toBe("pending");
    expect(travelOrderLocationVisitStatusLabel("pending")).toBe("Not started");
  });

  it("is in progress after start", () => {
    expect(
      travelOrderLocationVisitStatus({
        startedAt: "2026-07-24T01:00:00.000Z",
        endedAt: null,
        checkedAt: null,
      }),
    ).toBe("in_progress");
    expect(travelOrderLocationVisitStatusLabel("in_progress")).toBe("In Progress");
  });

  it("is completed after end (or legacy checkedAt)", () => {
    expect(
      travelOrderLocationVisitStatus({
        startedAt: "2026-07-24T01:00:00.000Z",
        endedAt: "2026-07-24T02:00:00.000Z",
        checkedAt: null,
      }),
    ).toBe("completed");
    expect(
      travelOrderLocationVisitStatus({
        startedAt: null,
        endedAt: null,
        checkedAt: "2026-07-24T02:00:00.000Z",
      }),
    ).toBe("completed");
    expect(travelOrderLocationVisitStatusLabel("completed")).toBe("Completed");
  });
});
