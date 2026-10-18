import { describe, expect, it } from "vitest";
import {
  accumulateAssigneeProgressAcrossPeriods,
  personnelAssigneeProgressAcrossPeriods,
} from "@/modules/tasks/kpi-period-snapshots";
import {
  aggregatePersonnelTaskMetrics,
  combinedPersonnelEfficiency,
  mergePersonnelMetricCards,
  normalizePersonnelTaskTotals,
  personnelEfficiencyBracket,
} from "@/modules/tasks/task-personnel-metrics";
import type { TaskChecklistPillarMetrics } from "@/modules/tasks/kpis";

describe("accumulateAssigneeProgressAcrossPeriods", () => {
  it("sums contributor totals across Mon–Sat periods instead of averaging", () => {
    const bundles = [
      {
        progress: { total: 2, done: 1, missing: 1, percent: 50 },
        contributors: [
          {
            id: "a1",
            name: "Alex",
            role: "Assignee",
            total: 2,
            done: 1,
            remaining: 1,
            percent: 50,
          },
        ],
      },
      {
        progress: { total: 2, done: 2, missing: 0, percent: 100 },
        contributors: [
          {
            id: "a1",
            name: "Alex",
            role: "Assignee",
            total: 2,
            done: 2,
            remaining: 0,
            percent: 100,
          },
        ],
      },
    ];

    const rows = accumulateAssigneeProgressAcrossPeriods(bundles);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "Alex",
      total: 4,
      done: 3,
      remaining: 1,
      percent: 75,
    });
  });
});

describe("personnelAssigneeProgressAcrossPeriods", () => {
  it("does not inflate assigned totals from historical snapshots after tasks are removed", () => {
    const bundles = [
      {
        progress: { total: 10, done: 5, missing: 5, percent: 50 },
        contributors: [
          {
            id: "m1",
            name: "Mark Anthony Robina",
            role: "Assignee",
            total: 10,
            done: 5,
            remaining: 5,
            percent: 50,
          },
        ],
      },
      {
        progress: { total: 10, done: 8, missing: 2, percent: 80 },
        contributors: [
          {
            id: "m1",
            name: "Mark Anthony Robina",
            role: "Assignee",
            total: 10,
            done: 8,
            remaining: 2,
            percent: 80,
          },
        ],
      },
    ];
    const roster = [
      {
        row: {
          title: "Server Monitoring",
          subKpis: {
            segmented: false,
            items: [{ id: "s1", title: "Monitoring", done: false, assignedAgentId: "m1" }],
          },
          assignedAgent: { id: "m1", name: "Mark Anthony Robina" },
        },
        periodCount: 2,
      },
    ];

    const rows = personnelAssigneeProgressAcrossPeriods(bundles, roster, (item) => Boolean(item.done));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "Mark Anthony Robina",
      total: 2,
      done: 2,
      remaining: 0,
      percent: 100,
    });
  });
});

describe("aggregatePersonnelTaskMetrics", () => {
  it("uses accumulated pillar contributor rows for monthly personnel rollups", () => {
    const pillars = {
      "SYSTEM MAINTENANCE": {
        total: 2,
        done: 1,
        missing: 1,
        percent: 50,
        periodsCounted: 2,
        periodsInRange: 2,
        assigneeProgress: [
          {
            id: "a1",
            name: "Alex",
            role: "Assignee",
            total: 2,
            done: 1,
            remaining: 1,
            percent: 50,
          },
        ],
        assigneeProgressAccumulated: [
          {
            id: "a1",
            name: "Alex",
            role: "Assignee",
            total: 4,
            done: 3,
            remaining: 1,
            percent: 75,
          },
        ],
      },
    } satisfies TaskChecklistPillarMetrics;

    const rows = aggregatePersonnelTaskMetrics(pillars);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "Alex",
      done: 3,
      remaining: 1,
      percent: 75,
      pillarsContributed: 1,
    });
  });
});

describe("normalizePersonnelTaskTotals", () => {
  it("caps closed and efficiency when historical completions exceed current assigned work", () => {
    expect(normalizePersonnelTaskTotals(26, 1606)).toEqual({
      pending: 0,
      closed: 26,
      efficiency: 100,
    });
  });

  it("computes efficiency as done divided by total assigned (company-view math)", () => {
    expect(normalizePersonnelTaskTotals(4, 3)).toEqual({
      pending: 1,
      closed: 3,
      efficiency: 75,
    });
    expect(normalizePersonnelTaskTotals(10, 3)).toEqual({
      pending: 7,
      closed: 3,
      efficiency: 30,
    });
  });
});

describe("combinedPersonnelEfficiency", () => {
  it("averages ticket and task efficiency when both are present", () => {
    expect(
      combinedPersonnelEfficiency({
        id: "a1",
        name: "Alex",
        role: "Assignee",
        tickets: { closed: 5, pending: 2, efficiency: 71 },
        rfpRequestor: null,
        rfpAccounting: null,
        rfpFinance: null,
        irsCanvass: null,
        ftrPrepared: null,
        tasks: { closed: 3, pending: 1, efficiency: 100, pillarsContributed: 1 },
      }),
    ).toBe(86);
  });

  it("never returns an average below the 50% floor", () => {
    expect(
      combinedPersonnelEfficiency({
        id: "a1",
        name: "Alex",
        role: "Assignee",
        tickets: { closed: 1, pending: 9, efficiency: 10 },
        rfpRequestor: null,
        rfpAccounting: null,
        rfpFinance: null,
        irsCanvass: null,
        ftrPrepared: null,
        tasks: { closed: 0, pending: 5, efficiency: 0, pillarsContributed: 1 },
      }),
    ).toBe(50);
  });

  it("folds request-type buckets into one Requests efficiency (RFP requestor excluded)", () => {
    // Requests: tickets 1/2 + accounting 3/4 = 4/6 → 67%; requestor 99 is ignored; with tasks 100% → avg 84
    expect(
      combinedPersonnelEfficiency({
        id: "a1",
        name: "Alex",
        role: "Assignee",
        tickets: { closed: 1, pending: 1, efficiency: 50 },
        rfpRequestor: { closed: 99, pending: 0, efficiency: 100 },
        rfpAccounting: { closed: 3, pending: 1, efficiency: 75 },
        rfpFinance: null,
        irsCanvass: null,
        ftrPrepared: null,
        tasks: { closed: 2, pending: 0, efficiency: 100, pillarsContributed: 1 },
      }),
    ).toBe(84);
  });
});

describe("mergePersonnelMetricCards", () => {
  it("combines ticket and task metrics for the same person into one card", () => {
    const rows = mergePersonnelMetricCards(
      [
        {
          id: "a1",
          name: "Alex",
          role: "Assignee",
          total: 4,
          done: 3,
          remaining: 1,
          percent: 75,
          pillarsContributed: 1,
        },
      ],
      [{ id: "a1", name: "Alex", closed: 5, pending: 2, efficiency: 71.4 }],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "Alex",
      tickets: { closed: 5, pending: 2, efficiency: 71 },
      tasks: { closed: 3, pending: 1, efficiency: 75, pillarsContributed: 1 },
    });
  });

  it("accumulates duplicate agent rows for the same person instead of overwriting", () => {
    const rows = mergePersonnelMetricCards(
      [
        {
          id: "m1",
          name: "Mark Anthony Robina",
          role: "Assignee",
          total: 13,
          done: 11,
          remaining: 2,
          percent: 85,
          pillarsContributed: 2,
        },
        {
          id: "m2",
          name: "Mark Anthony Robina",
          role: "Assignee",
          total: 13,
          done: 1,
          remaining: 12,
          percent: 8,
          pillarsContributed: 1,
        },
      ],
      [
        { id: "m1", name: "Mark Anthony Robina", closed: 5, pending: 0, efficiency: 100 },
        { id: "m2", name: "Mark Anthony Robina", closed: 1, pending: 0, efficiency: 100 },
      ],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tickets: { closed: 6, pending: 0, efficiency: 100 },
      // 12 done of 26 assigned = 46%
      tasks: { closed: 12, pending: 14, efficiency: 46, pillarsContributed: 2 },
    });
  });
});

describe("personnelEfficiencyBracket", () => {
  it("maps average efficiency to color-coded bracket labels", () => {
    expect(personnelEfficiencyBracket(95).label).toBe("Outstanding");
    expect(personnelEfficiencyBracket(100).label).toBe("Outstanding");
    expect(personnelEfficiencyBracket(94).label).toBe("Good");
    expect(personnelEfficiencyBracket(88).label).toBe("Good");
    expect(personnelEfficiencyBracket(87).label).toBe("Satisfactory");
    expect(personnelEfficiencyBracket(75).label).toBe("Satisfactory");
    expect(personnelEfficiencyBracket(74).label).toBe("Needs Improvement");
    expect(personnelEfficiencyBracket(0).label).toBe("Needs Improvement");
  });
});
