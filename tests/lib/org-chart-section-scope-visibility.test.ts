import { describe, expect, it } from "vitest";
import {
  collectOrgChartDescendantIds,
  kpiRowInSectionAgentScope,
  roleUsesCompanyDepartmentTaskAssignScope,
  roleUsesOrgChartSectionBoardScope,
} from "@/lib/org-chart-section-scope";

const tree = [
  { id: "corp", parentId: null },
  { id: "gs", parentId: "corp" },
  { id: "hr", parentId: "corp" },
  { id: "it", parentId: "corp" },
  { id: "it-helpdesk", parentId: "it" },
  { id: "acct", parentId: null },
];

describe("collectOrgChartDescendantIds (request Departments filter)", () => {
  it("includes the selected department and nested sub-departments", () => {
    expect(collectOrgChartDescendantIds(["corp"], tree).sort()).toEqual(
      ["corp", "gs", "hr", "it", "it-helpdesk"].sort(),
    );
  });

  it("limits to a sub-department and its own children", () => {
    expect(collectOrgChartDescendantIds(["it"], tree).sort()).toEqual(
      ["it", "it-helpdesk"].sort(),
    );
    expect(collectOrgChartDescendantIds(["gs"], tree)).toEqual(["gs"]);
  });

  it("does not walk upward to the parent department", () => {
    const ids = collectOrgChartDescendantIds(["gs"], tree);
    expect(ids).not.toContain("corp");
    expect(ids).not.toContain("hr");
  });

  it("intersects cleanly when multiple roots are selected", () => {
    expect(collectOrgChartDescendantIds(["gs", "acct"], tree).sort()).toEqual(
      ["acct", "gs"].sort(),
    );
  });
});

describe("kpiRowInSectionAgentScope (task board visibility)", () => {
  const sectionAgents = new Set(["agent-gs", "agent-hr"]);

  it("shows tasks assigned to someone in the section tree", () => {
    expect(
      kpiRowInSectionAgentScope(
        { assignedAgentId: "agent-gs", subKpis: null },
        sectionAgents,
      ),
    ).toBe(true);
  });

  it("shows tasks with a sub-assignee in the section tree", () => {
    expect(
      kpiRowInSectionAgentScope(
        {
          assignedAgentId: "outsider",
          subKpis: {
            version: 1,
            items: [{ id: "1", assignedAgentId: "agent-hr" }],
          },
        },
        sectionAgents,
      ),
    ).toBe(true);
  });

  it("hides unassigned tasks and outsiders under section scope", () => {
    expect(
      kpiRowInSectionAgentScope({ assignedAgentId: null, subKpis: null }, sectionAgents),
    ).toBe(false);
    expect(
      kpiRowInSectionAgentScope(
        { assignedAgentId: "outsider", subKpis: null },
        sectionAgents,
      ),
    ).toBe(false);
    expect(
      kpiRowInSectionAgentScope({ assignedAgentId: "agent-gs", subKpis: null }, new Set()),
    ).toBe(false);
  });
});

describe("roleUsesOrgChartSectionBoardScope", () => {
  it("scopes Personnel only; elevates SuperAdmin / HighAdmin / Admin", () => {
    expect(roleUsesOrgChartSectionBoardScope("Admin")).toBe(false);
    expect(roleUsesOrgChartSectionBoardScope("Personnel")).toBe(true);
    expect(roleUsesOrgChartSectionBoardScope("SuperAdmin")).toBe(false);
    expect(roleUsesOrgChartSectionBoardScope("HighAdmin")).toBe(false);
    expect(roleUsesOrgChartSectionBoardScope("Customer")).toBe(false);
  });
});

describe("roleUsesCompanyDepartmentTaskAssignScope", () => {
  it("locks Admin and Personnel; elevates SuperAdmin / HighAdmin", () => {
    expect(roleUsesCompanyDepartmentTaskAssignScope("Admin")).toBe(true);
    expect(roleUsesCompanyDepartmentTaskAssignScope("Personnel")).toBe(true);
    expect(roleUsesCompanyDepartmentTaskAssignScope("SuperAdmin")).toBe(false);
    expect(roleUsesCompanyDepartmentTaskAssignScope("HighAdmin")).toBe(false);
    expect(roleUsesCompanyDepartmentTaskAssignScope("Customer")).toBe(false);
  });
});

describe("Departments filter intersection with viewer scope", () => {
  it("keeps only sub-departments the viewer can see", () => {
    const expanded = collectOrgChartDescendantIds(["corp"], tree);
    const viewerScope = new Set(["gs", "hr"]); // membership under corp, not whole corp
    const filtered = expanded.filter((id) => viewerScope.has(id));
    expect(filtered.sort()).toEqual(["gs", "hr"].sort());
    expect(filtered).not.toContain("corp");
    expect(filtered).not.toContain("it");
  });
});

describe("isViewerOrgChartHeadForSection (pure ancestor walk)", () => {
  it("matches head of the section or an ancestor", () => {
    const headedIds = new Set(["corp"]);
    const byId = new Map(tree.map((s) => [s.id, s]));
    function isHeadFor(sectionId: string): boolean {
      let current: string | null = sectionId;
      const seen = new Set<string>();
      while (current && !seen.has(current)) {
        seen.add(current);
        if (headedIds.has(current)) return true;
        current = byId.get(current)?.parentId ?? null;
      }
      return false;
    }
    expect(isHeadFor("corp")).toBe(true);
    expect(isHeadFor("it-helpdesk")).toBe(true);
    expect(isHeadFor("acct")).toBe(false);
  });
});
