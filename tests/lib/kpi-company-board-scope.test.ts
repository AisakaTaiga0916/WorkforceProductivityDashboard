import { describe, expect, it } from "vitest";
import { kpiRowInCompanyScope } from "@/modules/tasks/kpi-company-board-scope";

describe("kpiRowInCompanyScope", () => {
  const companyId = "team-agc";
  const companyAgents = new Set(["agent-in-company", "agent-sub"]);

  it("includes main assignee in company", () => {
    expect(
      kpiRowInCompanyScope(
        { assignedAgentId: "agent-in-company", scopedCompanyTeamId: null, subKpis: [] },
        companyId,
        companyAgents,
      ),
    ).toBe(true);
  });

  it("includes unassigned cards scoped to the company", () => {
    expect(
      kpiRowInCompanyScope(
        { assignedAgentId: null, scopedCompanyTeamId: companyId, subKpis: [] },
        companyId,
        companyAgents,
      ),
    ).toBe(true);
    expect(
      kpiRowInCompanyScope(
        { assignedAgentId: null, scopedCompanyTeamId: "other-team", subKpis: [] },
        companyId,
        companyAgents,
      ),
    ).toBe(false);
  });

  it("includes projects where only a sub-task assignee is in the company", () => {
    expect(
      kpiRowInCompanyScope(
        {
          assignedAgentId: "agent-outside",
          scopedCompanyTeamId: null,
          subKpis: [
            { id: "s1", title: "Help", assignedAgentId: "agent-sub", done: false },
          ],
        },
        companyId,
        companyAgents,
      ),
    ).toBe(true);
  });

  it("excludes when neither main nor sub assignees are in company", () => {
    expect(
      kpiRowInCompanyScope(
        {
          assignedAgentId: "agent-outside",
          scopedCompanyTeamId: companyId,
          subKpis: [
            { id: "s1", title: "Help", assignedAgentId: "someone-else", done: false },
          ],
        },
        companyId,
        companyAgents,
      ),
    ).toBe(false);
  });
});
