import { describe, expect, it } from "vitest";
import {
  EMPTY_PERSONNEL_REQUEST_KPI,
  aggregatePersonnelKpi,
  blendPersonnelKpi,
  buildPersonnelKpiContributions,
  personnelRequestKpi,
  buildPersonnelKpiFrequencyBreakdown,
  buildPersonnelKpiPeriodBreakdown,
  personnelKpiPeriodLabel,
  personnelKpiTaskCounts,
  sortPersonnelKpiSummaries,
  type PersonnelKpiSummary,
} from "@/modules/workforce/personnel-kpi";
import { parsePersonnelKpiRange } from "@/modules/workforce/personnel-kpi-range";

const TZ = "Asia/Manila";
const NOW = new Date("2026-10-26T04:00:00.000Z"); // Oct 26, 2026 noon in Manila

describe("buildPersonnelKpiContributions", () => {
  const task = (kpiId: string, totalItems: number, doneItems: number) => ({
    kpiId,
    title: kpiId,
    pillar: "",
    frequency: "DAILY",
    status: "CURRENT" as const,
    kpiPercent: null,
    totalItems,
    doneItems,
    periodCount: 1,
    lastPeriodKey: "",
  });

  it("splits the weighted average into per-task earned and lost points", () => {
    const parts = buildPersonnelKpiContributions([task("a", 10, 9), task("b", 10, 5)]);
    const totals = aggregatePersonnelKpi([
      { kpiId: "a", periodKey: "p", total: 10, done: 9 },
      { kpiId: "b", periodKey: "p", total: 10, done: 5 },
    ]);

    expect(parts.map((p) => p.weightPercent)).toEqual([50, 50]);
    expect(parts.map((p) => p.earnedPoints)).toEqual([45, 25]);
    expect(parts.map((p) => p.lostPoints)).toEqual([5, 25]);
    const earned = parts.reduce((sum, p) => sum + p.earnedPoints, 0);
    expect(Math.round(earned)).toBe(totals.kpiPercent);
  });

  it("weights tasks by item count, not equally", () => {
    const [big, small] = buildPersonnelKpiContributions([task("big", 30, 30), task("small", 10, 0)]);
    expect(big!.weightPercent).toBe(75);
    expect(small!.weightPercent).toBe(25);
    expect(small!.lostPoints).toBe(25);
  });

  it("returns nothing when there are no items", () => {
    expect(buildPersonnelKpiContributions([task("a", 0, 0)])).toEqual([]);
    expect(buildPersonnelKpiContributions([])).toEqual([]);
  });
});

describe("aggregatePersonnelKpi", () => {
  it("weights checklist items across periods instead of averaging percentages", () => {
    const totals = aggregatePersonnelKpi([
      { kpiId: "k1", periodKey: "D:Asia/Manila:2026-10-01", total: 9, done: 9 },
      { kpiId: "k1", periodKey: "D:Asia/Manila:2026-10-02", total: 1, done: 0 },
      { kpiId: "k2", periodKey: "M:Asia/Manila:2026-10-01", total: 10, done: 5 },
    ]);

    expect(totals).toMatchObject({
      kpiPercent: 70,
      totalItems: 20,
      doneItems: 14,
      kpiCount: 2,
      periodCount: 3,
    });
  });

  it("returns null, not zero, when there is no eligible data", () => {
    expect(aggregatePersonnelKpi([])).toEqual({
      kpiPercent: null,
      totalItems: 0,
      doneItems: 0,
      kpiCount: 0,
      periodCount: 0,
    });
    expect(
      aggregatePersonnelKpi([
        { kpiId: "k1", periodKey: "D:Asia/Manila:2026-10-01", total: 0, done: 0 },
      ]).kpiPercent,
    ).toBeNull();
  });

  it("clamps a malformed done count to the total", () => {
    expect(
      aggregatePersonnelKpi([
        { kpiId: "k1", periodKey: "M:Asia/Manila:2026-10-01", total: 2, done: 5 },
      ]),
    ).toMatchObject({ totalItems: 2, doneItems: 2, kpiPercent: 100 });
  });
});

describe("personnel KPI breakdowns", () => {
  it("groups by frequency and recent period", () => {
    const rows = [
      { kpiId: "k1", periodKey: "D:Asia/Manila:2026-10-25", frequency: "DAILY", total: 2, done: 2 },
      { kpiId: "k1", periodKey: "D:Asia/Manila:2026-10-26", frequency: "DAILY", total: 2, done: 1 },
      { kpiId: "k2", periodKey: "W:Asia/Manila:2026-10-19", frequency: "WEEKLY", total: 4, done: 1 },
    ];

    const frequencies = buildPersonnelKpiFrequencyBreakdown(rows);
    expect(frequencies.map((row) => [row.label, row.kpiPercent, row.totalItems])).toEqual([
      ["Daily", 75, 4],
      ["Weekly", 25, 4],
    ]);

    const periods = buildPersonnelKpiPeriodBreakdown(rows);
    expect(periods.map((row) => row.label)).toEqual([
      "Oct 26, 2026",
      "Oct 25, 2026",
      "Week of Oct 19",
    ]);
  });

  it("labels period keys", () => {
    expect(personnelKpiPeriodLabel("D:Asia/Manila:2026-10-26")).toBe("Oct 26, 2026");
    expect(personnelKpiPeriodLabel("M:Asia/Manila:2026-10-01")).toBe("Oct 2026");
    expect(personnelKpiPeriodLabel("Y:Asia/Manila:2026-01-01")).toBe("2026");
  });

  it("counts task statuses for cards", () => {
    expect(personnelKpiTaskCounts(["DONE", "DELAYED", "CURRENT", "PENDING_VERIFICATION"])).toEqual({
      taskCount: 4,
      doneTasks: 1,
      missedTasks: 1,
      openTasks: 2,
    });
  });
});

describe("parsePersonnelKpiRange", () => {
  it("defaults to this month through today", () => {
    expect(parsePersonnelKpiRange({}, NOW, TZ)).toMatchObject({
      preset: "month",
      fromYmd: "2026-10-01",
      toYmd: "2026-10-26",
      label: "This month",
    });
  });

  it("supports quarter, year, and custom windows", () => {
    expect(parsePersonnelKpiRange({ range: "quarter" }, NOW, TZ)).toMatchObject({
      fromYmd: "2026-10-01",
      toYmd: "2026-10-26",
    });
    expect(parsePersonnelKpiRange({ range: "year" }, NOW, TZ)).toMatchObject({
      fromYmd: "2026-01-01",
      toYmd: "2026-10-26",
    });
    expect(
      parsePersonnelKpiRange({ range: "custom", from: "2026-10-05", to: "2026-10-09" }, NOW, TZ),
    ).toMatchObject({
      preset: "custom",
      fromYmd: "2026-10-05",
      toYmd: "2026-10-09",
      label: "Oct 5, 2026 – Oct 9, 2026",
    });
  });

  it("swaps reversed custom bounds, caps future dates, and clamps long ranges", () => {
    expect(
      parsePersonnelKpiRange({ from: "2026-10-09", to: "2026-10-05" }, NOW, TZ),
    ).toMatchObject({ fromYmd: "2026-10-05", toYmd: "2026-10-09" });
    expect(
      parsePersonnelKpiRange({ range: "custom", from: "2026-10-01", to: "2027-12-31" }, NOW, TZ)
        .toYmd,
    ).toBe("2026-10-26");
    expect(
      parsePersonnelKpiRange({ range: "custom", from: "2020-01-01", to: "2026-10-26" }, NOW, TZ),
    ).toMatchObject({ fromYmd: "2025-10-26", toYmd: "2026-10-26" });
  });
});

describe("sortPersonnelKpiSummaries", () => {
  it("puts scored people first and leaves no-data people last", () => {
    const make = (name: string, kpiPercent: number | null): PersonnelKpiSummary => ({
      sourceUserId: name,
      agentId: null,
      name,
      email: `${name}@example.com`,
      teamName: "Team",
      staffRole: "Staff",
      staffAssignmentColor: null,
      kpiPercent,
      totalItems: kpiPercent == null ? 0 : 1,
      doneItems: 0,
      kpiCount: 0,
      periodCount: 0,
      taskCount: 0,
      doneTasks: 0,
      missedTasks: 0,
      openTasks: 0,
      requests: EMPTY_PERSONNEL_REQUEST_KPI,
      overallPercent: kpiPercent,
    });

    const sorted = sortPersonnelKpiSummaries([make("No Data", null), make("Low", 50), make("High", 100)]);
    expect(sorted.map((p) => p.name)).toEqual(["High", "Low", "No Data"]);
  });
});

describe("personnelRequestKpi", () => {
  it("rates resolved over assigned and derives open", () => {
    expect(personnelRequestKpi({ assigned: 4, resolved: 3, overdue: 1 })).toEqual({
      assigned: 4,
      resolved: 3,
      open: 1,
      overdue: 1,
      resolutionPercent: 75,
    });
  });

  it("returns null, not 0%, when nothing was assigned", () => {
    expect(personnelRequestKpi({ assigned: 0, resolved: 0, overdue: 0 }).resolutionPercent).toBeNull();
  });

  it("clamps inconsistent counts", () => {
    expect(personnelRequestKpi({ assigned: 2, resolved: 5, overdue: 9 })).toMatchObject({
      resolved: 2,
      open: 0,
      overdue: 0,
      resolutionPercent: 100,
    });
  });
});

describe("blendPersonnelKpi", () => {
  it("averages tasks and requests with equal weight", () => {
    const blend = blendPersonnelKpi(80, 60);
    expect(blend.overallPercent).toBe(70);
    expect(blend.parts.map((p) => [p.key, p.weightPercent, p.points])).toEqual([
      ["tasks", 50, 40],
      ["requests", 50, 30],
    ]);
  });

  it("uses the only part present instead of counting the missing one as 0", () => {
    expect(blendPersonnelKpi(80, null).overallPercent).toBe(80);
    expect(blendPersonnelKpi(null, 40).overallPercent).toBe(40);
    expect(blendPersonnelKpi(null, 40).parts[0]!.weightPercent).toBe(100);
  });

  it("is null when there is no data at all", () => {
    expect(blendPersonnelKpi(null, null)).toEqual({ overallPercent: null, parts: [] });
  });
});
