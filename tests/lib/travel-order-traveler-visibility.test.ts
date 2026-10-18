import { describe, expect, it } from "vitest";
import { isTravelOrderTraveler } from "@/modules/work-plans/travel-order";
import { hasSubKpiAssignedTo } from "@/modules/tasks/kpi-subkpis";

/** Mirrors board filter: assignee / sub-assignee / traveler kpi ids. */
function filterKpiRowsForViewer<T extends { id: string; assignedAgentId: string | null; subKpis: unknown }>(
  rows: T[],
  agentId: string | null | undefined,
  travelerKpiIds: Set<string>,
): T[] {
  const id = agentId?.trim();
  return rows.filter((row) => {
    if (!id) return false;
    const assignee =
      row.assignedAgentId === id || hasSubKpiAssignedTo(row.subKpis, id);
    return assignee || travelerKpiIds.has(row.id);
  });
}

describe("isTravelOrderTraveler", () => {
  it("uses the stored traveler list and excludes a creator who is not on it", () => {
    const order = {
      createdByAgentId: "creator-1",
      travelerAgentIds: ["traveler-a", "traveler-b"],
    };
    expect(isTravelOrderTraveler("creator-1", order)).toBe(false);
    expect(isTravelOrderTraveler("traveler-a", order)).toBe(true);
    expect(isTravelOrderTraveler("traveler-b", order)).toBe(true);
    expect(isTravelOrderTraveler("outsider", order)).toBe(false);
    expect(isTravelOrderTraveler(null, order)).toBe(false);
  });

  it("treats the creator as a traveler when they are on the stored list", () => {
    const order = {
      createdByAgentId: "creator-1",
      travelerAgentIds: ["creator-1", "traveler-a"],
    };
    expect(isTravelOrderTraveler("creator-1", order)).toBe(true);
  });

  it("treats missing traveler list as creator-only", () => {
    expect(
      isTravelOrderTraveler("creator-1", {
        createdByAgentId: "creator-1",
        travelerAgentIds: null,
      }),
    ).toBe(true);
    expect(
      isTravelOrderTraveler("other", {
        createdByAgentId: "creator-1",
        travelerAgentIds: null,
      }),
    ).toBe(false);
  });
});

describe("traveler board visibility after period refresh", () => {
  it("keeps traveler-only Field Assignments when traveler kpi ids are reapplied", () => {
    const travelerId = "agent-traveler";
    const rows = [
      {
        id: "kpi-assigned-elsewhere",
        assignedAgentId: "agent-creator",
        subKpis: [],
      },
      {
        id: "kpi-own",
        assignedAgentId: travelerId,
        subKpis: [],
      },
    ];
    const travelerKpiIds = new Set(["kpi-assigned-elsewhere"]);

    const filtered = filterKpiRowsForViewer(rows, travelerId, travelerKpiIds);
    expect(filtered.map((r) => r.id).sort()).toEqual([
      "kpi-assigned-elsewhere",
      "kpi-own",
    ]);

    // Regression: period refresh must not drop traveler ids (empty set = bug).
    const withoutTravelerIds = filterKpiRowsForViewer(rows, travelerId, new Set());
    expect(withoutTravelerIds.map((r) => r.id)).toEqual(["kpi-own"]);
  });
});
