import { describe, expect, it } from "vitest";
import {
  combineHelpdeskCountsByBlend,
  resolveHelpdeskMetricBlend,
  yearMonthsBetween,
} from "@/modules/requests/helpdesk-csv";

describe("resolveHelpdeskMetricBlend", () => {
  it("uses csv-only for March and April 2026", () => {
    expect(resolveHelpdeskMetricBlend("2026-03-01", "2026-03-31")).toBe("csv-only");
    expect(resolveHelpdeskMetricBlend("2026-04-01", "2026-04-30")).toBe("csv-only");
  });

  it("uses csv-and-live for May 2026 onward", () => {
    expect(resolveHelpdeskMetricBlend("2026-05-01", "2026-05-31")).toBe("csv-and-live");
  });
});

describe("combineHelpdeskCountsByBlend", () => {
  const csv = {
    userSupport: { forConfirmation: 10, closed: 5 },
    closedInRange: 5,
    openTicketsInPeriod: 10,
    requestsInRange: 20,
  };
  const live = {
    userSupport: { forConfirmation: 1, closed: 2 },
    closedInRange: 2,
    openTicketsInPeriod: 1,
    requestsInRange: 3,
  };

  it("csv-only ignores live", () => {
    expect(combineHelpdeskCountsByBlend(csv, live, "csv-only")).toEqual(csv);
  });

  it("csv-and-live merges both", () => {
    expect(combineHelpdeskCountsByBlend(csv, live, "csv-and-live")?.closedInRange).toBe(7);
  });
});

describe("yearMonthsBetween", () => {
  it("spans multiple months", () => {
    expect(yearMonthsBetween("2026-03", "2026-05")).toEqual(["2026-03", "2026-04", "2026-05"]);
  });
});
