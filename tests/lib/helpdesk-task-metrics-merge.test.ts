import { describe, expect, it } from "vitest";
import { mergeHelpdeskTaskMetricCounts } from "@/modules/requests/helpdesk-csv";

describe("mergeHelpdeskTaskMetricCounts", () => {
  const csv = {
    userSupport: { forConfirmation: 10, closed: 20 },
    closedInRange: 20,
    openTicketsInPeriod: 10,
    requestsInRange: 100,
  };
  const live = {
    userSupport: { forConfirmation: 2, closed: 5 },
    closedInRange: 5,
    openTicketsInPeriod: 3,
    requestsInRange: 12,
  };

  it("returns null when both inputs are null", () => {
    expect(mergeHelpdeskTaskMetricCounts(null, null)).toBeNull();
  });

  it("sums CSV and live counts", () => {
    expect(mergeHelpdeskTaskMetricCounts(csv, live)).toEqual({
      userSupport: { forConfirmation: 12, closed: 25 },
      closedInRange: 25,
      openTicketsInPeriod: 13,
      requestsInRange: 112,
    });
  });

  it("passes through live-only when CSV is null", () => {
    expect(mergeHelpdeskTaskMetricCounts(null, live)).toEqual(live);
  });
});
