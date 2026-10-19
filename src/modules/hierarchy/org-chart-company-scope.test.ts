import { describe, expect, it, vi } from "vitest";

vi.mock("@/modules/platform/db/prisma", () => ({ prisma: {} }));

import { scopeOrgChartToCompany } from "./org-chart-company-scope";

/**
 * Group-wide chart: CEO (A) → COO (A) → S&M 2 (B) → LPG Area 1 (B); COO → IT (A).
 * People: ceo, coo, lead2 (S&M 2 head), rep (LPG Area 1), it (IT TEAM).
 */
const sections = [
  { id: "ceo", parentId: null, companyTeamId: "A", headNodeId: "n-ceo", reportsToNodeId: null },
  { id: "coo", parentId: "ceo", companyTeamId: "A", headNodeId: "n-coo", reportsToNodeId: null },
  { id: "sm2", parentId: "coo", companyTeamId: "B", headNodeId: "n-lead2", reportsToNodeId: null },
  { id: "lpg1", parentId: "sm2", companyTeamId: "B", headNodeId: null, reportsToNodeId: null },
  { id: "it", parentId: "coo", companyTeamId: "A", headNodeId: null, reportsToNodeId: null },
];

const nodes = [
  { id: "n-ceo", parentId: null, mergedSourceUserId: "1", sectionId: "ceo" },
  { id: "n-coo", parentId: "n-ceo", mergedSourceUserId: "2", sectionId: "coo" },
  { id: "n-lead2", parentId: "n-coo", mergedSourceUserId: "3", sectionId: "sm2" },
  { id: "n-rep", parentId: "n-lead2", mergedSourceUserId: "4", sectionId: null, sectionMemberships: [{ sectionId: "lpg1" }] },
  { id: "n-it", parentId: "n-coo", mergedSourceUserId: "5", sectionId: "it" },
];

describe("scopeOrgChartToCompany", () => {
  it("company B shows its teams plus the parent chain, not company A's other teams", () => {
    const scoped = scopeOrgChartToCompany({
      companyId: "B",
      sections,
      nodes,
      companyMemberMergedIds: new Set(),
    });
    expect([...scoped.sectionIds].sort()).toEqual(["ceo", "coo", "lpg1", "sm2"]);
    expect(scoped.sectionIds.has("it")).toBe(false);
    // People in B's teams plus their reports-to chain; the A-only IT member is hidden.
    expect([...scoped.nodeIds].sort()).toEqual(["n-ceo", "n-coo", "n-lead2", "n-rep"]);
  });

  it("company A shows its teams and people only", () => {
    const scoped = scopeOrgChartToCompany({
      companyId: "A",
      sections,
      nodes,
      companyMemberMergedIds: new Set(),
    });
    expect([...scoped.sectionIds].sort()).toEqual(["ceo", "coo", "it"]);
    expect([...scoped.nodeIds].sort()).toEqual(["n-ceo", "n-coo", "n-it"]);
  });

  it("includes company members who sit in another company's team", () => {
    const scoped = scopeOrgChartToCompany({
      companyId: "A",
      sections,
      nodes,
      companyMemberMergedIds: new Set(["4"]),
    });
    expect(scoped.nodeIds.has("n-rep")).toBe(true);
    expect(scoped.nodeIds.has("n-lead2")).toBe(true);
    expect(scoped.sectionIds.has("lpg1")).toBe(false);
  });
});
