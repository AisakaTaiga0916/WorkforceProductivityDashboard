import { describe, expect, it } from "vitest";
import {
  buildOrgChartChildrenOf,
  orgChartLayerById,
  orgChartOptionLabel,
  orgChartOutlineById,
  orgChartPersonOutlineFromLayout,
  orgChartReportingParentByNodeId,
  type OrgChartOutlineNode,
} from "@/app/admin/superadmin-settings/org-chart-layers";

type TestNode = {
  id: string;
  parentId: string | null;
  sortOrder: number;
  personName: string;
  companyName?: string | null;
  sectionId?: string | null;
  sectionMemberships?: Array<{ sectionId: string }>;
};

function asOutlineNodes(nodes: TestNode[]): OrgChartOutlineNode[] {
  return nodes.map((n) => ({ ...n, sectionId: n.sectionId ?? null }));
}

type TestSection = {
  id: string;
  parentId: string | null;
  sortOrder: number;
  name: string;
  headNodeId?: string | null;
  reportsToNodeId?: string | null;
};

function layoutOutline(
  nodes: TestNode[],
  sections: TestSection[],
  layout?: {
    sectionIdsInScope?: Set<string>;
    scopeRootSectionId?: string;
    allNodes?: TestNode[];
  },
) {
  const layoutOptions = layout
    ? {
        sectionIdsInScope: layout.sectionIdsInScope,
        scopeRootSectionId: layout.scopeRootSectionId,
        allNodesForOutline: asOutlineNodes(layout.allNodes ?? nodes),
      }
    : undefined;
  return orgChartOutlineById(asOutlineNodes(nodes), sections, layoutOptions);
}

describe("org chart outline consistency", () => {
  it("layout outline map matches orgChartOutlineById for the same nodes", () => {
    const sections: TestSection[] = [
      { id: "corp", parentId: null, sortOrder: 0, name: "Corporate Services" },
      { id: "hr", parentId: "corp", sortOrder: 0, name: "HR" },
      { id: "it", parentId: "corp", sortOrder: 1, name: "IT" },
    ];
    const nodes: TestNode[] = [
      { id: "ceo", parentId: null, sortOrder: 0, personName: "CEO", sectionMemberships: [{ sectionId: "corp" }] },
      { id: "hr-head", parentId: "ceo", sortOrder: 0, personName: "HR Head", sectionMemberships: [{ sectionId: "hr" }] },
      { id: "it-head", parentId: "ceo", sortOrder: 0, personName: "IT Head", sectionMemberships: [{ sectionId: "it" }] },
      { id: "hr-a", parentId: "hr-head", sortOrder: 0, personName: "HR A", sectionMemberships: [{ sectionId: "hr" }] },
      { id: "it-a", parentId: "it-head", sortOrder: 0, personName: "IT A", sectionMemberships: [{ sectionId: "it" }] },
    ];

    const fromLayout = layoutOutline(nodes, sections);
    const fromHelper = orgChartOutlineById(asOutlineNodes(nodes), sections);

    for (const n of nodes) {
      expect(fromLayout.get(n.id)).toBe(fromHelper.get(n.id));
    }
  });

  it("card badge outline matches reports-to dropdown label prefix", () => {
    const nodes: TestNode[] = [
      { id: "a", parentId: null, sortOrder: 0, personName: "Alpha" },
      { id: "b", parentId: "a", sortOrder: 0, personName: "Beta" },
      { id: "c", parentId: "a", sortOrder: 1, personName: "Gamma" },
    ];
    const outlineById = layoutOutline(nodes, []);

    for (const n of nodes) {
      const cardOutline = outlineById.get(n.id)!;
      const dropdownLabel = orgChartOptionLabel(
        { ...n, companyName: n.companyName ?? null },
        outlineById.get(n.id) ?? "?",
        outlineById,
      );
      expect(dropdownLabel.startsWith(`${cardOutline} · `)).toBe(true);
    }
  });

  it("scoped department view orders roots by sub-department chart arrangement", () => {
    const sections: TestSection[] = [
      { id: "corp", parentId: null, sortOrder: 0, name: "Corporate Services" },
      { id: "hr", parentId: "corp", sortOrder: 0, name: "HR" },
      { id: "it", parentId: "corp", sortOrder: 1, name: "IT" },
    ];
    const nodes: TestNode[] = [
      {
        id: "it-person",
        parentId: null,
        sortOrder: 0,
        personName: "IT Person",
        sectionMemberships: [{ sectionId: "corp" }, { sectionId: "it" }],
      },
      {
        id: "hr-person",
        parentId: null,
        sortOrder: 0,
        personName: "HR Person",
        sectionMemberships: [{ sectionId: "corp" }, { sectionId: "hr" }],
      },
    ];
    const scope = new Set(["corp", "hr", "it"]);
    const childrenOf = buildOrgChartChildrenOf(asOutlineNodes(nodes), sections, {
      sectionIdsInScope: scope,
      scopeRootSectionId: "corp",
    });
    const roots = (childrenOf.get(null) ?? []).map((n) => n.id);

    expect(roots).toEqual(["hr-person", "it-person"]);
  });

  it("orders department heads by sub-dept chart when assigned only to parent dept", () => {
    const sections: TestSection[] = [
      {
        id: "corp",
        parentId: null,
        sortOrder: 0,
        name: "CORPORATE SERVICES",
        headNodeId: "ceo",
      },
      { id: "hr", parentId: "corp", sortOrder: 0, name: "HR TEAM", headNodeId: "hr-head" },
      { id: "gs", parentId: "corp", sortOrder: 1, name: "GENERAL SERVICES", headNodeId: "gs-head" },
      { id: "it", parentId: "corp", sortOrder: 2, name: "IT TEAM", headNodeId: "it-head" },
      { id: "mkt", parentId: "corp", sortOrder: 3, name: "MARKETING", headNodeId: "mkt-head" },
    ];
    const nodes: TestNode[] = [
      {
        id: "ceo",
        parentId: null,
        sortOrder: 0,
        personName: "CEO",
        sectionMemberships: [{ sectionId: "corp" }],
      },
      {
        id: "it-head",
        parentId: "ceo",
        sortOrder: 0,
        personName: "IT Head",
        sectionMemberships: [{ sectionId: "corp" }],
      },
      {
        id: "hr-head",
        parentId: "ceo",
        sortOrder: 0,
        personName: "HR Head",
        sectionMemberships: [{ sectionId: "corp" }],
      },
      {
        id: "gs-head",
        parentId: "ceo",
        sortOrder: 0,
        personName: "GS Head",
        sectionMemberships: [{ sectionId: "corp" }],
      },
      {
        id: "mkt-head",
        parentId: "ceo",
        sortOrder: 0,
        personName: "Marketing Head",
        sectionMemberships: [{ sectionId: "corp" }],
      },
    ];
    const scope = new Set(["corp", "hr", "gs", "it", "mkt"]);
    const childrenOf = buildOrgChartChildrenOf(asOutlineNodes(nodes), sections, {
      sectionIdsInScope: scope,
      scopeRootSectionId: "corp",
    });
    const peers = (childrenOf.get("ceo") ?? []).map((n) => n.id);

    expect(peers).toEqual(["hr-head", "gs-head", "it-head", "mkt-head"]);
  });

  it("updates user outlines when department sortOrder changes in Manage departments", () => {
    const baseSections: TestSection[] = [
      { id: "corp", parentId: null, sortOrder: 0, name: "CORPORATE SERVICES", headNodeId: "ceo" },
      { id: "hr", parentId: "corp", sortOrder: 0, name: "HR TEAM", headNodeId: "hr-head" },
      { id: "it", parentId: "corp", sortOrder: 1, name: "IT TEAM", headNodeId: "it-head" },
    ];
    const nodes: TestNode[] = [
      {
        id: "ceo",
        parentId: null,
        sortOrder: 0,
        personName: "CEO",
        sectionMemberships: [{ sectionId: "corp" }],
      },
      {
        id: "hr-head",
        parentId: "ceo",
        sortOrder: 0,
        personName: "HR Head",
        sectionMemberships: [{ sectionId: "corp" }],
      },
      {
        id: "it-head",
        parentId: "ceo",
        sortOrder: 0,
        personName: "IT Head",
        sectionMemberships: [{ sectionId: "corp" }],
      },
    ];
    const scope = new Set(["corp", "hr", "it"]);
    const layout = {
      sectionIdsInScope: scope,
      scopeRootSectionId: "corp",
    };

    const before = layoutOutline(nodes, baseSections, layout);
    expect(before.get("hr-head")).toBe("1.1");
    expect(before.get("it-head")).toBe("1.2");

    const swappedSections = baseSections.map((s) =>
      s.id === "hr" ? { ...s, sortOrder: 1 } : s.id === "it" ? { ...s, sortOrder: 0 } : s,
    );
    const after = layoutOutline(nodes, swappedSections, layout);
    expect(after.get("it-head")).toBe("1.1");
    expect(after.get("hr-head")).toBe("1.2");
  });

  it("orders cross-department peers by top-level department chart arrangement", () => {
    const sections: TestSection[] = [
      { id: "agoc", parentId: null, sortOrder: 0, name: "AGOC", headNodeId: "ceo" },
      {
        id: "corp",
        parentId: "agoc",
        sortOrder: 0,
        name: "CORPORATE SERVICES",
        headNodeId: "corp-head",
        reportsToNodeId: "ceo",
      },
      { id: "hr", parentId: "corp", sortOrder: 0, name: "HR TEAM", headNodeId: "hr-head" },
      { id: "gs", parentId: "corp", sortOrder: 1, name: "GENERAL SERVICES", headNodeId: "gs-head" },
      {
        id: "fin",
        parentId: "agoc",
        sortOrder: 1,
        name: "FINANCE",
        headNodeId: "fin-head",
        reportsToNodeId: "ceo",
      },
      {
        id: "fp",
        parentId: "agoc",
        sortOrder: 2,
        name: "FINANCIAL PLANNING",
        headNodeId: "fp-head",
        reportsToNodeId: "ceo",
      },
    ];
    const nodes: TestNode[] = [
      { id: "ceo", parentId: null, sortOrder: 0, personName: "CEO", sectionMemberships: [{ sectionId: "agoc" }] },
      { id: "corp-head", parentId: "ceo", sortOrder: 0, personName: "Corp Head", sectionMemberships: [{ sectionId: "corp" }] },
      { id: "hr-head", parentId: "corp-head", sortOrder: 0, personName: "HR Head", sectionMemberships: [{ sectionId: "corp" }] },
      { id: "gs-head", parentId: "corp-head", sortOrder: 0, personName: "GS Head", sectionMemberships: [{ sectionId: "corp" }] },
      { id: "fin-head", parentId: "ceo", sortOrder: 0, personName: "Finance Head", sectionMemberships: [{ sectionId: "fin" }] },
      { id: "fp-head", parentId: "ceo", sortOrder: 0, personName: "FP Head", sectionMemberships: [{ sectionId: "fp" }] },
    ];
    const scope = new Set(["agoc", "corp", "hr", "gs", "fin", "fp"]);
    const childrenOf = buildOrgChartChildrenOf(asOutlineNodes(nodes), sections, {
      sectionIdsInScope: scope,
      scopeRootSectionId: "agoc",
    });
    const peers = (childrenOf.get("ceo") ?? []).map((n) => n.id);
    const outlineById = layoutOutline(nodes, sections, {
      sectionIdsInScope: scope,
      scopeRootSectionId: "agoc",
    });

    expect(peers).toEqual(["corp-head", "fin-head", "fp-head"]);
    expect(outlineById.get("corp-head")).toBe("1.1");
    expect(outlineById.get("fin-head")).toBe("1.2");
    expect(outlineById.get("fp-head")).toBe("1.3");
  });

  it("gives top-level users outside departments outline 1 before dept members", () => {
    const sections: TestSection[] = [
      { id: "corp", parentId: null, sortOrder: 0, name: "CORPORATE SERVICES", headNodeId: "corp-head" },
      { id: "fin", parentId: null, sortOrder: 1, name: "FINANCE", headNodeId: "fin-head" },
    ];
    const nodes: TestNode[] = [
      {
        id: "manuel",
        parentId: null,
        sortOrder: 5,
        personName: "Manuel Uykimpang",
      },
      {
        id: "corp-head",
        parentId: null,
        sortOrder: 0,
        personName: "Corp Head",
        sectionMemberships: [{ sectionId: "corp" }],
      },
      {
        id: "fin-head",
        parentId: null,
        sortOrder: 1,
        personName: "Finance Head",
        sectionMemberships: [{ sectionId: "fin" }],
      },
    ];
    const outlineById = layoutOutline(nodes, sections);
    const childrenOf = buildOrgChartChildrenOf(asOutlineNodes(nodes), sections);
    const roots = (childrenOf.get(null) ?? []).map((n) => n.id);

    expect(roots[0]).toBe("manuel");
    expect(outlineById.get("manuel")).toBe("1");
    expect(outlineById.get("corp-head")).toBe("2");
    expect(outlineById.get("fin-head")).toBe("3");
  });

  it("numbers major department heads 1.1, 1.2 under their manager in dept chart order", () => {
    const sections: TestSection[] = [
      {
        id: "corp",
        parentId: null,
        sortOrder: 0,
        name: "CORPORATE SERVICES",
        headNodeId: "corp-head",
        reportsToNodeId: "manuel",
      },
      {
        id: "fin",
        parentId: null,
        sortOrder: 1,
        name: "FINANCE",
        headNodeId: "fin-head",
        reportsToNodeId: "manuel",
      },
      {
        id: "fp",
        parentId: null,
        sortOrder: 2,
        name: "FINANCIAL PLANNING",
        headNodeId: "fp-head",
        reportsToNodeId: "manuel",
      },
    ];
    const nodes: TestNode[] = [
      { id: "manuel", parentId: null, sortOrder: 0, personName: "Manuel Uykimpang" },
      {
        id: "staff",
        parentId: "manuel",
        sortOrder: 0,
        personName: "Staff Member",
        sectionMemberships: [{ sectionId: "corp" }],
      },
      {
        id: "corp-head",
        parentId: "manuel",
        sortOrder: 1,
        personName: "Corp Head",
        sectionMemberships: [{ sectionId: "corp" }],
      },
      {
        id: "fin-head",
        parentId: "manuel",
        sortOrder: 2,
        personName: "Finance Head",
        sectionMemberships: [{ sectionId: "fin" }],
      },
      {
        id: "fp-head",
        parentId: "manuel",
        sortOrder: 3,
        personName: "FP Head",
        sectionMemberships: [{ sectionId: "fp" }],
      },
    ];
    const outlineById = layoutOutline(nodes, sections);
    const peers = (buildOrgChartChildrenOf(asOutlineNodes(nodes), sections).get("manuel") ?? []).map((n) => n.id);

    expect(outlineById.get("manuel")).toBe("1");
    expect(outlineById.get("corp-head")).toBe("1.1");
    expect(outlineById.get("fin-head")).toBe("1.2");
    expect(outlineById.get("fp-head")).toBe("1.3");
    expect(outlineById.get("staff")).toBe("1.4");
    expect(peers.slice(0, 3)).toEqual(["corp-head", "fin-head", "fp-head"]);
  });

  it("numbers major heads under a single umbrella department on the dept chart", () => {
    const sections: TestSection[] = [
      {
        id: "agoc",
        parentId: null,
        sortOrder: 0,
        name: "AGOC",
        headNodeId: "agoc-head",
        reportsToNodeId: "manuel",
      },
      { id: "corp", parentId: "agoc", sortOrder: 0, name: "CORPORATE SERVICES", headNodeId: "corp-head" },
      { id: "fin", parentId: "agoc", sortOrder: 1, name: "FINANCE", headNodeId: "fin-head" },
    ];
    const nodes: TestNode[] = [
      { id: "manuel", parentId: null, sortOrder: 0, personName: "Manuel" },
      {
        id: "staff",
        parentId: "manuel",
        sortOrder: 0,
        personName: "Staff",
        sectionMemberships: [{ sectionId: "corp" }],
      },
      { id: "corp-head", parentId: "manuel", sortOrder: 1, personName: "Corp Head" },
      { id: "fin-head", parentId: "manuel", sortOrder: 2, personName: "Finance Head" },
    ];
    const outlineById = layoutOutline(nodes, sections);

    expect(outlineById.get("manuel")).toBe("1");
    expect(outlineById.get("corp-head")).toBe("1.1");
    expect(outlineById.get("fin-head")).toBe("1.2");
    expect(outlineById.get("staff")).toBe("1.3");
  });

  it("major department heads are 1.n when they report to a top-level chart person", () => {
    const sections: TestSection[] = [
      {
        id: "corp",
        parentId: null,
        sortOrder: 0,
        name: "CORPORATE SERVICES",
        headNodeId: "satorre",
        reportsToNodeId: "manuel",
      },
      {
        id: "fin",
        parentId: null,
        sortOrder: 1,
        name: "FINANCE",
        headNodeId: "fin-head",
        reportsToNodeId: "manuel",
      },
      { id: "hr", parentId: "corp", sortOrder: 0, name: "HR TEAM", headNodeId: "hr-head" },
    ];
    const nodes: TestNode[] = [
      { id: "manuel", parentId: null, sortOrder: 0, personName: "Manuel" },
      {
        id: "staff",
        parentId: "manuel",
        sortOrder: 0,
        personName: "Staff",
      },
      {
        id: "satorre",
        parentId: "manuel",
        sortOrder: 5,
        personName: "Satorre",
        sectionMemberships: [{ sectionId: "corp" }],
      },
      {
        id: "fin-head",
        parentId: "manuel",
        sortOrder: 6,
        personName: "Finance Head",
        sectionMemberships: [{ sectionId: "fin" }],
      },
      {
        id: "hr-head",
        parentId: "satorre",
        sortOrder: 0,
        personName: "HR Head",
        sectionMemberships: [{ sectionId: "hr" }],
      },
    ];
    const outlineById = layoutOutline(nodes, sections);

    expect(outlineById.get("manuel")).toBe("1");
    expect(outlineById.get("satorre")).toBe("1.1");
    expect(outlineById.get("fin-head")).toBe("1.2");
    expect(outlineById.get("staff")).toBe("1.3");
    expect(outlineById.get("hr-head")).toBe("1.1.1");
  });

  it("inside a major department, dept head keeps company 1.n and sub-dept heads are 1.n.n", () => {
    const sections: TestSection[] = [
      {
        id: "corp",
        parentId: null,
        sortOrder: 0,
        name: "CORPORATE SERVICES",
        headNodeId: "satorre",
        reportsToNodeId: "manuel",
      },
      { id: "hr", parentId: "corp", sortOrder: 0, name: "HR TEAM", headNodeId: "hr-head" },
      { id: "gs", parentId: "corp", sortOrder: 1, name: "GENERAL SERVICES", headNodeId: "gs-head" },
      { id: "it", parentId: "corp", sortOrder: 2, name: "IT TEAM", headNodeId: "it-head" },
    ];
    const allNodes: TestNode[] = [
      { id: "manuel", parentId: null, sortOrder: 0, personName: "Manuel" },
      {
        id: "satorre",
        parentId: "manuel",
        sortOrder: 0,
        personName: "Satorre",
        sectionMemberships: [{ sectionId: "corp" }],
      },
      {
        id: "staff",
        parentId: "satorre",
        sortOrder: 0,
        personName: "Staff Member",
        sectionMemberships: [{ sectionId: "corp" }],
      },
      {
        id: "gs-head",
        parentId: "satorre",
        sortOrder: 0,
        personName: "GS Head",
        sectionMemberships: [{ sectionId: "corp" }],
      },
      {
        id: "hr-head",
        parentId: "satorre",
        sortOrder: 0,
        personName: "HR Head",
        sectionMemberships: [{ sectionId: "corp" }],
      },
      {
        id: "it-head",
        parentId: "satorre",
        sortOrder: 0,
        personName: "IT Head",
        sectionMemberships: [{ sectionId: "corp" }],
      },
    ];
    const scopedNodes = allNodes.map((n) =>
      n.id === "satorre" ? { ...n, parentId: null } : n,
    );
    const scope = new Set(["corp", "hr", "gs", "it"]);
    const layout = {
      sectionIdsInScope: scope,
      scopeRootSectionId: "corp",
      allNodes,
    };
    const outlineById = layoutOutline(scopedNodes, sections, layout);
    const peers = (buildOrgChartChildrenOf(asOutlineNodes(scopedNodes), sections, layout).get("satorre") ?? []).map(
      (n) => n.id,
    );

    expect(outlineById.get("satorre")).toBe("1.1");
    expect(outlineById.get("hr-head")).toBe("1.1.1");
    expect(outlineById.get("gs-head")).toBe("1.1.2");
    expect(outlineById.get("it-head")).toBe("1.1.3");
    expect(outlineById.get("staff")).toBe("1.1.4");
    expect(peers.slice(0, 3)).toEqual(["hr-head", "gs-head", "it-head"]);
  });

  it("outline numbers follow left-to-right chart order among siblings", () => {
    const nodes: TestNode[] = [
      { id: "mgr", parentId: null, sortOrder: 0, personName: "Manager" },
      { id: "x", parentId: "mgr", sortOrder: 0, personName: "X" },
      { id: "y", parentId: "mgr", sortOrder: 1, personName: "Y" },
      { id: "z", parentId: "mgr", sortOrder: 2, personName: "Z" },
    ];
    const outlineById = layoutOutline(nodes, []);
    const childrenOf = buildOrgChartChildrenOf(asOutlineNodes(nodes), []);
    const siblings = childrenOf.get("mgr") ?? [];

    siblings.forEach((child, index) => {
      expect(outlineById.get(child.id)).toBe(`1.${index + 1}`);
    });
  });

  it("uses Manage departments Reports to for layout even when people-chart parentId differs", () => {
    const sections: TestSection[] = [
      {
        id: "corp",
        parentId: null,
        sortOrder: 0,
        name: "CORPORATE SERVICES",
        headNodeId: "satorre",
        reportsToNodeId: "manuel",
      },
      {
        id: "fin",
        parentId: null,
        sortOrder: 1,
        name: "FINANCE",
        headNodeId: "fin-head",
        reportsToNodeId: "manuel",
      },
    ];
    const nodes: TestNode[] = [
      { id: "manuel", parentId: null, sortOrder: 0, personName: "Manuel" },
      {
        id: "satorre",
        parentId: "other-mgr",
        sortOrder: 0,
        personName: "Satorre",
        sectionMemberships: [{ sectionId: "corp" }],
      },
      {
        id: "fin-head",
        parentId: "other-mgr",
        sortOrder: 0,
        personName: "Finance Head",
        sectionMemberships: [{ sectionId: "fin" }],
      },
      { id: "other-mgr", parentId: null, sortOrder: 1, personName: "Other Mgr" },
    ];
    const outlineById = layoutOutline(nodes, sections);
    const peers = (buildOrgChartChildrenOf(asOutlineNodes(nodes), sections).get("manuel") ?? []).map(
      (n) => n.id,
    );

    expect(outlineById.get("manuel")).toBe("1");
    expect(outlineById.get("satorre")).toBe("1.1");
    expect(outlineById.get("fin-head")).toBe("1.2");
    expect(peers).toEqual(["satorre", "fin-head"]);
    expect(outlineById.get("other-mgr")).toBe("2");
  });
});

describe("orgChartReportingParentByNodeId", () => {
  it("walks department Reports to for heads that are not nested", () => {
    const nodes = [
      { id: "ceo", parentId: null },
      { id: "coo", parentId: null },
      { id: "it-head", parentId: null },
      { id: "staff", parentId: "it-head" },
    ];
    const sections = [
      { headNodeId: "coo", reportsToNodeId: "ceo" },
      { headNodeId: "it-head", reportsToNodeId: "coo" },
    ];
    const parentById = orgChartReportingParentByNodeId(nodes, sections);
    expect(parentById.get("staff")).toBe("it-head");
    expect(parentById.get("it-head")).toBe("coo");
    expect(parentById.get("coo")).toBe("ceo");
    expect(parentById.get("ceo")).toBeNull();

    const layers = orgChartLayerById(nodes, parentById);
    expect(layers.get("ceo")).toBe(1);
    expect(layers.get("coo")).toBe(2);
    expect(layers.get("it-head")).toBe(3);
    expect(layers.get("staff")).toBe(4);
  });
});
