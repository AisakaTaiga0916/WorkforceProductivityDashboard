import { describe, expect, it } from "vitest";
import {
  findOrgChartSectionByName,
  orgChartMajorDepartments,
  orgChartScopeRootDepartments,
  orgChartSubDepartments,
  resolveSendToDepartmentSelection,
  type OrgChartSectionOption,
} from "@/lib/org-chart-section-display";
import { recommendedSendToDepartmentName } from "@/lib/request-types";

const sections: OrgChartSectionOption[] = [
  {
    id: "corp",
    name: "CORPORATE SERVICES",
    parentId: null,
    companyTeamId: null,
    label: "CORPORATE SERVICES",
    depth: 0,
  },
  {
    id: "gs",
    name: "GENERAL SERVICES",
    parentId: "corp",
    companyTeamId: null,
    label: "GENERAL SERVICES",
    depth: 1,
  },
  {
    id: "hr",
    name: "HR TEAM",
    parentId: "corp",
    companyTeamId: null,
    label: "HR TEAM",
    depth: 1,
  },
  {
    id: "acct",
    name: "ACCOUNTING",
    parentId: null,
    companyTeamId: null,
    label: "ACCOUNTING",
    depth: 0,
  },
  {
    id: "fin",
    name: "FINANCE",
    parentId: null,
    companyTeamId: null,
    label: "FINANCE",
    depth: 0,
  },
  {
    id: "proc",
    name: "PROCUREMENT",
    parentId: null,
    companyTeamId: null,
    label: "PROCUREMENT",
    depth: 0,
  },
];

describe("intake send-to department helpers", () => {
  it("lists majors and subs separately", () => {
    expect(orgChartMajorDepartments(sections).map((s) => s.id)).toEqual([
      "corp",
      "acct",
      "fin",
      "proc",
    ]);
    expect(orgChartSubDepartments(sections, "corp").map((s) => s.id)).toEqual(["gs", "hr"]);
    expect(orgChartSubDepartments(sections, "acct")).toEqual([]);
  });

  it("shows sub-department as a scope root when major is outside the viewer set", () => {
    const scoped = sections.filter((s) => s.id === "gs" || s.id === "hr");
    expect(orgChartScopeRootDepartments(scoped).map((s) => s.id)).toEqual(["gs", "hr"]);
    expect(orgChartMajorDepartments(scoped)).toEqual([]);
  });

  it("resolves recommendation names to major + sub", () => {
    expect(recommendedSendToDepartmentName("REQUEST_FOR_PAYMENT")).toBe("ACCOUNTING");
    expect(recommendedSendToDepartmentName("ITEM_REQUISITION_SLIP")).toBe("PROCUREMENT");
    expect(recommendedSendToDepartmentName("FUND_TRANSFER_REQUEST")).toBe("FINANCE");
    expect(recommendedSendToDepartmentName("JOB_ORDER")).toBe("GENERAL SERVICES");

    const jo = findOrgChartSectionByName(sections, "GENERAL SERVICES")!;
    expect(resolveSendToDepartmentSelection(sections, jo.id)).toEqual({
      majorId: "corp",
      subId: "gs",
    });

    const rfp = findOrgChartSectionByName(sections, "ACCOUNTING")!;
    expect(resolveSendToDepartmentSelection(sections, rfp.id)).toEqual({
      majorId: "acct",
      subId: "",
    });
  });
});
