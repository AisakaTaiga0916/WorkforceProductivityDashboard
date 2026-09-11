import type { OrgChartNode } from "@prisma/client/primary";

/** Virtual drill id for org-chart members with no department membership. */
export const ORG_CHART_OUTSIDE_SECTIONS_ID = "__outside_sections__";

export type OrgChartLayerNode = Pick<OrgChartNode, "id" | "parentId">;

export type OrgChartOutlineNode = Pick<
  OrgChartNode,
  "id" | "parentId" | "sortOrder" | "personName" | "sectionId"
> & {
  sectionMemberships?: Array<{ sectionId: string }>;
};

export type OrgChartLayoutOptions = {
  /** When viewing a department subtree, only consider these section memberships. */
  sectionIdsInScope?: Set<string>;
  /** Root department being viewed — peer sort follows its sub-department chart order. */
  scopeRootSectionId?: string;
  /** Full chart members — preserves dept-head outline prefix (1.n) in scoped views. */
  allNodesForOutline?: OrgChartOutlineNode[];
};

const SECTION_PERSON_PARENT_PREFIX = "person:";

type PrimarySectionOptions = OrgChartLayoutOptions & {
  sectionDepthById?: Map<string, number>;
  headSectionByNodeId?: Map<string, string>;
  sectionSortPathById?: Map<string, number[]>;
  /** Top-level chart roots: people outside all departments sort before dept members. */
  preferUnassignedFirst?: boolean;
  /** Heads of departments that report to the current manager — sorted first as 1.1, 1.2, … */
  majorHeadSectionByNodeId?: Map<string, string>;
};

/** Primary department for layout ordering — prefers the deepest section membership. */
export function primarySectionIdForNode(
  node: {
    id?: string;
    sectionId?: string | null;
    sectionMemberships?: Array<{ sectionId: string }>;
  },
  options?: PrimarySectionOptions,
): string | null {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const add = (id: string | null | undefined) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    candidates.push(id);
  };
  add(node.sectionId);
  for (const m of node.sectionMemberships ?? []) add(m.sectionId);
  if (node.id) {
    const headSection = options?.headSectionByNodeId?.get(node.id);
    if (headSection) add(headSection);
  }

  let pool = options?.sectionIdsInScope
    ? candidates.filter((id) => options.sectionIdsInScope!.has(id))
    : candidates;
  if (pool.length === 0) return null;

  if (options?.sectionDepthById) {
    pool = [...pool].sort(
      (a, b) =>
        (options.sectionDepthById!.get(b) ?? 0) - (options.sectionDepthById!.get(a) ?? 0),
    );
  }
  return pool[0] ?? null;
}

/** Department-chart sort path for a node — uses deepest in-scope section (and head role). */
function effectiveSectionSortPath(
  node: {
    id?: string;
    sectionId?: string | null;
    sectionMemberships?: Array<{ sectionId: string }>;
  },
  options?: PrimarySectionOptions,
): number[] {
  if (node.id && options?.majorHeadSectionByNodeId && options.sectionSortPathById) {
    const majorSec = options.majorHeadSectionByNodeId.get(node.id);
    if (majorSec) return options.sectionSortPathById.get(majorSec) ?? [];
  }
  const sec = primarySectionIdForNode(node, options);
  if (!sec || !options?.sectionSortPathById) return [];
  return options.sectionSortPathById.get(sec) ?? [];
}

/**
 * Map department head → section for peers that should get 1.n under this manager.
 *
 * Driven by Manage departments **Reports to** (`reportsToNodeId`) and dept chart order.
 * Scoped department view: direct sub-department heads under the opened department.
 */
export function buildMajorHeadSectionByNodeId(
  sections: OrgChartSectionOutlineNode[],
  managerNodeId: string,
  scopeRootSectionId?: string,
): Map<string, string> {
  const out = new Map<string, string>();
  const { byParent } = buildSectionTreeChildrenOf(sections);

  // Inside a department view — sub-department heads (HR, IT, …) are the major peers.
  if (scopeRootSectionId) {
    for (const child of byParent.get(scopeRootSectionId) ?? []) {
      if (child.headNodeId) out.set(child.headNodeId, child.id);
    }
    return out;
  }

  const personKey = `${SECTION_PERSON_PARENT_PREFIX}${managerNodeId}`;
  const directUnderPerson = byParent.get(personKey) ?? [];

  // Primary: every section whose Manage departments Reports to is this manager.
  for (const section of sections) {
    if (section.reportsToNodeId === managerNodeId && section.headNodeId) {
      out.set(section.headNodeId, section.id);
    }
  }

  if (directUnderPerson.length === 1) {
    // One umbrella department — major peers are nested sub-depts (not the wrapper head).
    const umbrella = directUnderPerson[0]!;
    for (const child of byParent.get(umbrella.id) ?? []) {
      if (child.headNodeId) out.set(child.headNodeId, child.id);
    }
    if (umbrella.headNodeId && umbrella.reportsToNodeId === managerNodeId) {
      out.delete(umbrella.headNodeId);
    }
  } else if (out.size === 0) {
    for (const section of directUnderPerson) {
      if (section.headNodeId) out.set(section.headNodeId, section.id);
    }
  }

  return out;
}

/** Layout parent for a node — department heads follow Manage departments Reports to. */
function buildEffectiveParentByNodeId(
  nodes: OrgChartOutlineNode[],
  sections: OrgChartSectionOutlineNode[],
  idSet: Set<string>,
): Map<string, string | null> {
  const reportsToByHeadNodeId = new Map<string, string>();
  for (const section of sections) {
    if (
      section.headNodeId &&
      section.reportsToNodeId &&
      idSet.has(section.reportsToNodeId)
    ) {
      reportsToByHeadNodeId.set(section.headNodeId, section.reportsToNodeId);
    }
  }

  const out = new Map<string, string | null>();
  for (const n of nodes) {
    const deptReportsTo = reportsToByHeadNodeId.get(n.id);
    if (deptReportsTo) {
      out.set(n.id, deptReportsTo);
    } else {
      out.set(n.id, n.parentId && idSet.has(n.parentId) ? n.parentId : null);
    }
  }
  return out;
}

function sectionDepthByIdFromOutlines(
  sections: OrgChartSectionOutlineNode[],
  sectionOutlineById: Map<string, string>,
): Map<string, number> {
  const depths = new Map<string, number>();
  for (const section of sections) {
    const outline = sectionOutlineById.get(section.id) ?? "";
    depths.set(
      section.id,
      outline ? outline.split(".").filter(Boolean).length : 1,
    );
  }
  return depths;
}

/** Sort peers by department chart order, then member sortOrder, then name. */
export function compareNodesByDepartmentLayout<
  T extends Pick<OrgChartNode, "id" | "sortOrder" | "personName" | "sectionId"> & {
    sectionMemberships?: Array<{ sectionId: string }>;
  },
>(a: T, b: T, sectionOutlineById: Map<string, string>, options?: PrimarySectionOptions): number {
  const unassignedFirst = options?.preferUnassignedFirst ?? false;
  const majorA = options?.majorHeadSectionByNodeId?.get(a.id);
  const majorB = options?.majorHeadSectionByNodeId?.get(b.id);
  if (majorA && !majorB) return -1;
  if (!majorA && majorB) return 1;
  if (majorA && majorB && options?.sectionSortPathById) {
    const cmp = compareSectionSortPaths(
      options.sectionSortPathById.get(majorA) ?? [],
      options.sectionSortPathById.get(majorB) ?? [],
    );
    if (cmp !== 0) return cmp;
  }

  const headSecA = options?.headSectionByNodeId?.get(a.id);
  const headSecB = options?.headSectionByNodeId?.get(b.id);
  if (!unassignedFirst) {
    if (headSecA && !headSecB && !majorB) return -1;
    if (!headSecA && headSecB && !majorA) return 1;
    if (headSecA && headSecB && !majorA && !majorB && options?.sectionSortPathById) {
      const cmp = compareSectionSortPaths(
        options.sectionSortPathById.get(headSecA) ?? [],
        options.sectionSortPathById.get(headSecB) ?? [],
      );
      if (cmp !== 0) return cmp;
    }
  }

  if (options?.sectionSortPathById) {
    const pathA = effectiveSectionSortPath(a, options);
    const pathB = effectiveSectionSortPath(b, options);
    if (pathA.length > 0 && pathB.length > 0) {
      const cmp = compareSectionSortPaths(pathA, pathB);
      if (cmp !== 0) return cmp;
    } else if (pathA.length > 0) {
      return unassignedFirst ? 1 : -1;
    } else if (pathB.length > 0) {
      return unassignedFirst ? -1 : 1;
    }
  } else {
    const secA = primarySectionIdForNode(a, options);
    const secB = primarySectionIdForNode(b, options);
    if (!secA && !secB) {
      // fall through to sortOrder
    } else if (!secA) {
      return unassignedFirst ? -1 : 1;
    } else if (!secB) {
      return unassignedFirst ? 1 : -1;
    } else if (secA !== secB) {
      const cmp = compareOutlineLabels(
        sectionOutlineById.get(secA) ?? "",
        sectionOutlineById.get(secB) ?? "",
      );
      if (cmp !== 0) return cmp;
    }
  }
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  return a.personName.localeCompare(b.personName, undefined, { sensitivity: "base" });
}

/** Depth on the chart: Level 1 = top-level (no parent), Level 2 = reports to L1, etc. */
export function orgChartLayerById(nodes: OrgChartLayerNode[]): Map<string, number> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const layers = new Map<string, number>();

  function layerOf(id: string, visiting = new Set<string>()): number {
    const cached = layers.get(id);
    if (cached != null) return cached;
    if (visiting.has(id)) return 1;
    visiting.add(id);
    const node = byId.get(id);
    if (!node?.parentId || !byId.has(node.parentId)) {
      layers.set(id, 1);
      return 1;
    }
    const depth = layerOf(node.parentId, visiting) + 1;
    layers.set(id, depth);
    return depth;
  }

  for (const n of nodes) layerOf(n.id);
  return layers;
}

/** Build sibling-sorted children map for the people chart (shared by layout + outline). */
export function buildOrgChartChildrenOf<
  T extends OrgChartOutlineNode,
>(
  nodes: T[],
  sections: OrgChartSectionOutlineNode[] = [],
  layoutOptions?: OrgChartLayoutOptions,
): Map<string | null, T[]> {
  const idSet = new Set(nodes.map((n) => n.id));
  const sectionOutlineById =
    sections.length > 0 ? orgChartSectionOutlineById(sections, nodes) : null;
  const headSectionByNodeId = new Map<string, string>();
  for (const section of sections) {
    if (section.headNodeId) headSectionByNodeId.set(section.headNodeId, section.id);
  }
  const sectionSortPathById =
    sections.length > 0
      ? buildSectionSortPathById(sections, layoutOptions?.scopeRootSectionId)
      : undefined;
  const departmentLayoutOptions: PrimarySectionOptions | undefined = sectionOutlineById
    ? {
        sectionIdsInScope: layoutOptions?.sectionIdsInScope,
        scopeRootSectionId: layoutOptions?.scopeRootSectionId,
        sectionDepthById: sectionDepthByIdFromOutlines(sections, sectionOutlineById),
        headSectionByNodeId,
        sectionSortPathById,
      }
    : undefined;

  const effectiveParentByNodeId =
    sections.length > 0 ? buildEffectiveParentByNodeId(nodes, sections, idSet) : null;

  const byParent = new Map<string | null, T[]>();
  for (const n of nodes) {
    const parentKey = effectiveParentByNodeId
      ? (effectiveParentByNodeId.get(n.id) ?? null)
      : n.parentId && idSet.has(n.parentId)
        ? n.parentId
        : null;
    const list = byParent.get(parentKey) ?? [];
    list.push(n);
    byParent.set(parentKey, list);
  }
  for (const [parentKey, list] of byParent.entries()) {
    const sortOptions: PrimarySectionOptions | undefined = departmentLayoutOptions
      ? {
          ...departmentLayoutOptions,
          preferUnassignedFirst: parentKey === null,
          majorHeadSectionByNodeId:
            parentKey != null
              ? buildMajorHeadSectionByNodeId(
                  sections,
                  parentKey,
                  layoutOptions?.scopeRootSectionId,
                )
              : undefined,
        }
      : undefined;
    list.sort((a, b) => {
      if (sectionOutlineById) {
        return compareNodesByDepartmentLayout(a, b, sectionOutlineById, sortOptions);
      }
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return a.personName.localeCompare(b.personName, undefined, { sensitivity: "base" });
    });
  }
  return byParent;
}

/** Assign dotted outline labels from an already-sorted children map. */
export function orgChartOutlineFromChildrenOf<T extends { id: string }>(
  byParent: Map<string | null, T[]>,
): Map<string, string> {
  const out = new Map<string, string>();
  function walk(parentId: string | null, prefix: string) {
    const kids = byParent.get(parentId) ?? [];
    kids.forEach((kid, index) => {
      const num = prefix ? `${prefix}.${index + 1}` : String(index + 1);
      out.set(kid.id, num);
      walk(kid.id, num);
    });
  }
  walk(null, "");
  return out;
}

/**
 * Scoped department view: dept head keeps their full-company outline (1.n);
 * everyone under them in the view becomes 1.n.1, 1.n.2, …
 */
export function orgChartPersonOutlineFromScopedLayout<T extends { id: string }>(
  scopedChildrenOf: Map<string | null, T[]>,
  fullOutlineById: Map<string, string>,
  deptHeadNodeId: string | null | undefined,
): Map<string, string> {
  const out = new Map<string, string>();

  function walk(parentId: string | null, parentOutline: string | null) {
    const kids = scopedChildrenOf.get(parentId) ?? [];
    kids.forEach((kid, index) => {
      let num: string;
      if (deptHeadNodeId && kid.id === deptHeadNodeId) {
        num = fullOutlineById.get(deptHeadNodeId) ?? String(index + 1);
      } else if (parentOutline != null) {
        num = `${parentOutline}.${index + 1}`;
      } else {
        num = fullOutlineById.get(kid.id) ?? String(index + 1);
      }
      out.set(kid.id, num);
      walk(kid.id, num);
    });
  }

  walk(null, null);
  return out;
}

/**
 * Outline numbers from chart order:
 * top-level → 1, 2, 3; children of 1 → 1.1, 1.2; etc.
 * When sections are provided, sibling order (and thus outline numbers) follow
 * department chart arrangement.
 * Scoped views keep the dept head at their company-wide 1.n and nest sub-depts at 1.n.n.
 */
export function orgChartOutlineById(
  nodes: OrgChartOutlineNode[],
  sections: OrgChartSectionOutlineNode[] = [],
  layoutOptions?: OrgChartLayoutOptions,
): Map<string, string> {
  const childrenOf = buildOrgChartChildrenOf(nodes, sections, layoutOptions);

  if (layoutOptions?.scopeRootSectionId) {
    const fullNodes = layoutOptions.allNodesForOutline ?? nodes;
    const fullOutline = orgChartOutlineById(fullNodes, sections);
    const rootSection = sections.find((s) => s.id === layoutOptions.scopeRootSectionId);
    return orgChartPersonOutlineFromScopedLayout(
      childrenOf,
      fullOutline,
      rootSection?.headNodeId,
    );
  }

  return orgChartOutlineFromChildrenOf(childrenOf);
}

/** User outline numbers from chart layout only — no department prefix. Updates when users move or departments reorder. */
export function orgChartPersonOutlineFromLayout<T extends { id: string }>(
  layoutChildrenOf: Map<string | null, T[]>,
): Map<string, string> {
  return orgChartOutlineFromChildrenOf(layoutChildrenOf);
}

export type OrgChartSectionOutlineNode = {
  id: string;
  parentId: string | null;
  reportsToNodeId?: string | null;
  headNodeId?: string | null;
  sortOrder: number;
  name: string;
};

function sectionTreeParentKey(
  section: OrgChartSectionOutlineNode,
  sectionIds: Set<string>,
): string | null {
  if (section.reportsToNodeId) {
    return `${SECTION_PERSON_PARENT_PREFIX}${section.reportsToNodeId}`;
  }
  if (section.parentId && sectionIds.has(section.parentId)) {
    return section.parentId;
  }
  return null;
}

/** Section tree grouped by parent (null, section id, or person:nodeId) — matches department chart layout. */
export function buildSectionTreeChildrenOf<T extends OrgChartSectionOutlineNode>(
  sections: T[],
): {
  byParent: Map<string | null, T[]>;
  personParentIds: Set<string>;
} {
  const sectionIds = new Set(sections.map((s) => s.id));
  const byParent = new Map<string | null, T[]>();
  const personParentIds = new Set<string>();

  for (const s of sections) {
    const parentKey = sectionTreeParentKey(s, sectionIds);
    if (s.reportsToNodeId) personParentIds.add(s.reportsToNodeId);
    const list = byParent.get(parentKey) ?? [];
    list.push(s);
    byParent.set(parentKey, list);
  }
  for (const list of byParent.values()) {
    list.sort(
      (a, b) =>
        a.sortOrder - b.sortOrder ||
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    );
  }
  return { byParent, personParentIds };
}

/** Lexicographic compare of department sibling indices (matches department chart walk). */
export function compareSectionSortPaths(a: number[], b: number[]): number {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    const da = a[i] ?? -1;
    const db = b[i] ?? -1;
    if (da !== db) return da - db;
  }
  return 0;
}

/** Sort path using department tree sibling indices (matches Manage departments order). */
export function buildSectionSortPathById(
  sections: OrgChartSectionOutlineNode[],
  scopeRootSectionId?: string,
): Map<string, number[]> {
  const sectionIds = new Set(sections.map((s) => s.id));
  const byId = new Map(sections.map((s) => [s.id, s]));
  const { byParent } = buildSectionTreeChildrenOf(sections);
  const siblingIndex = new Map<string, number>();
  for (const kids of byParent.values()) {
    kids.forEach((section, index) => siblingIndex.set(section.id, index));
  }

  function pathFor(sectionId: string): number[] {
    const path: number[] = [];
    let curId: string | null = sectionId;
    while (curId) {
      path.unshift(siblingIndex.get(curId) ?? 0);
      if (scopeRootSectionId && curId === scopeRootSectionId) break;
      const cur = byId.get(curId);
      if (!cur) break;
      const parentKey = sectionTreeParentKey(cur, sectionIds);
      if (!parentKey || parentKey.startsWith(SECTION_PERSON_PARENT_PREFIX)) break;
      curId = parentKey;
    }
    return path;
  }

  const out = new Map<string, number[]>();
  for (const section of sections) out.set(section.id, pathFor(section.id));
  return out;
}

/** Stable key for department layout inputs — changes when Manage departments reorders. */
export function orgChartSectionsLayoutKey(
  sections: OrgChartSectionOutlineNode[],
): string {
  return sections
    .map(
      (s) =>
        `${s.id}:${s.parentId ?? ""}:${s.reportsToNodeId ?? ""}:${s.sortOrder}:${s.headNodeId ?? ""}`,
    )
    .join("|");
}

/** Assign department outline labels from a layout-sorted section tree. */
export function orgChartSectionOutlineFromChildrenOf<T extends { id: string }>(
  byParent: Map<string | null, T[]>,
  personOutlines: Map<string, string>,
): Map<string, string> {
  const out = new Map<string, string>();
  function walk(parentKey: string | null, prefix: string) {
    const kids = byParent.get(parentKey) ?? [];
    kids.forEach((kid, index) => {
      let num: string;
      if (parentKey?.startsWith(SECTION_PERSON_PARENT_PREFIX)) {
        const personId = parentKey.slice(SECTION_PERSON_PARENT_PREFIX.length);
        num = `${personOutlines.get(personId) ?? "?"}.${index + 1}`;
      } else {
        num = prefix ? `${prefix}.${index + 1}` : String(index + 1);
      }
      out.set(kid.id, num);
      walk(kid.id, num);
    });
  }
  walk(null, "");
  for (const key of byParent.keys()) {
    if (key?.startsWith(SECTION_PERSON_PARENT_PREFIX)) {
      walk(key, "");
    }
  }
  return out;
}

/** Compare dotted outline labels (1 < 1.2 < 1.10 < 2). */
export function compareOutlineLabels(a: string, b: string): number {
  const pa = a.split(".").map((x) => Number.parseInt(x, 10));
  const pb = b.split(".").map((x) => Number.parseInt(x, 10));
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da - db;
  }
  return 0;
}

/**
 * Outline numbers for departments — same dotted scheme as people, and aligned with
 * the department chart tree (section parentId OR reportsToNodeId).
 * Departments under person 1.2 become 1.2.1, 1.2.2, etc.
 */
export function orgChartSectionOutlineById(
  sections: OrgChartSectionOutlineNode[],
  people: OrgChartOutlineNode[] = [],
  personOutlineById?: Map<string, string>,
): Map<string, string> {
  const personOutlines = personOutlineById ?? orgChartOutlineById(people);
  const { byParent } = buildSectionTreeChildrenOf(sections);
  return orgChartSectionOutlineFromChildrenOf(byParent, personOutlines);
}

export function orgChartSectionOptionLabel(
  section: Pick<OrgChartSectionOutlineNode, "id" | "name">,
  outlineById: Map<string, string>,
): string {
  const outline = outlineById.get(section.id) ?? "?";
  return `${outline} · ${section.name}`;
}

/** Depth group label for dropdowns / access matrix (Level 1, Level 2, …). */
export function formatOrgChartLevelLabel(level: number): string {
  return `Level ${level}`;
}

/** @deprecated Use {@link formatOrgChartLevelLabel}. */
export const formatOrgChartLayerLabel = formatOrgChartLevelLabel;

/** Sort nodes by level (asc), outline order within level, then name. */
export function sortOrgNodesByLayer<
  T extends Pick<OrgChartNode, "id" | "personName" | "sortOrder">,
>(nodes: T[], layers: Map<string, number>, outlineById?: Map<string, string>): T[] {
  return [...nodes].sort((a, b) => {
    const la = layers.get(a.id) ?? 1;
    const lb = layers.get(b.id) ?? 1;
    if (la !== lb) return la - lb;
    if (outlineById) {
      const cmp = compareOutlineLabels(
        outlineById.get(a.id) ?? "",
        outlineById.get(b.id) ?? "",
      );
      if (cmp !== 0) return cmp;
    }
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.personName.localeCompare(b.personName, undefined, { sensitivity: "base" });
  });
}

export function orgChartOptionLabel(
  node: Pick<OrgChartNode, "id" | "personName" | "companyName">,
  outlineOrLevel: string | number,
  outlineById?: Map<string, string>,
): string {
  const outline =
    typeof outlineOrLevel === "string"
      ? outlineOrLevel
      : (outlineById?.get(node.id) ?? formatOrgChartLevelLabel(outlineOrLevel));
  const company = node.companyName?.trim();
  const base = `${outline} · ${node.personName}`;
  return company ? `${base} · ${company}` : base;
}

const EITHER_OR_PARENT_PREFIX = "eitherOr:";

/** Select value for a person parent, shared either/or link, or top level. */
export function encodeReportsToValue(opts: {
  parentId?: string | null;
  parentEitherOrLinkId?: string | null;
}): string {
  if (opts.parentEitherOrLinkId) return `${EITHER_OR_PARENT_PREFIX}${opts.parentEitherOrLinkId}`;
  return opts.parentId ?? "";
}

export function parseReportsToValue(value: string): {
  parentId: string | null;
  parentEitherOrLinkId: string | null;
} {
  const raw = value.trim();
  if (!raw) return { parentId: null, parentEitherOrLinkId: null };
  if (raw.startsWith(EITHER_OR_PARENT_PREFIX)) {
    const linkId = raw.slice(EITHER_OR_PARENT_PREFIX.length).trim();
    return { parentId: null, parentEitherOrLinkId: linkId || null };
  }
  return { parentId: raw, parentEitherOrLinkId: null };
}

export function eitherOrLinkLabel(
  link: { id: string; nodeAId: string; nodeBId: string },
  byId: Map<string, Pick<OrgChartNode, "personName">>,
): string {
  const a = byId.get(link.nodeAId)?.personName ?? "Unknown";
  const b = byId.get(link.nodeBId)?.personName ?? "Unknown";
  return `${a} / ${b} (either/or)`;
}

/** Descendant ids for each node (direct + indirect reports). */
export function orgChartDescendantsById(nodes: OrgChartLayerNode[]): Map<string, Set<string>> {
  const childrenOf = new Map<string | null, string[]>();
  for (const n of nodes) {
    const list = childrenOf.get(n.parentId) ?? [];
    list.push(n.id);
    childrenOf.set(n.parentId, list);
  }
  const out = new Map<string, Set<string>>();
  function collect(id: string): Set<string> {
    const cached = out.get(id);
    if (cached) return cached;
    const set = new Set<string>();
    for (const child of childrenOf.get(id) ?? []) {
      set.add(child);
      for (const d of collect(child)) set.add(d);
    }
    out.set(id, set);
    return set;
  }
  for (const n of nodes) collect(n.id);
  return out;
}

/** Manager / either-or options valid for reparenting the given excluded node ids. */
export function orgChartReportsToOptions(
  nodes: OrgChartNode[],
  excludeNodeIds: string[],
  eitherOrLinks: Array<{ id: string; nodeAId: string; nodeBId: string }>,
  sections: OrgChartSectionOutlineNode[] = [],
): {
  managersByLayer: Array<[number, OrgChartNode[]]>;
  eitherOrParentOptions: Array<{ value: string; label: string }>;
  outlineById: Map<string, string>;
} {
  const layerById = orgChartLayerById(nodes);
  const outlineById = orgChartOutlineById(nodes, sections);
  const descendants = orgChartDescendantsById(nodes);
  const excluded = new Set(excludeNodeIds);
  for (const id of excludeNodeIds) {
    for (const d of descendants.get(id) ?? []) excluded.add(d);
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const managerOptions = nodes.filter((m) => !excluded.has(m.id));
  const eitherOrParentOptions = eitherOrLinks
    .filter((link) => {
      if (excluded.has(link.nodeAId) || excluded.has(link.nodeBId)) return false;
      return true;
    })
    .map((link) => ({
      value: encodeReportsToValue({ parentEitherOrLinkId: link.id }),
      label: eitherOrLinkLabel(link, byId),
    }));
  const sorted = sortOrgNodesByLayer(managerOptions, layerById, outlineById);
  const groups = new Map<number, OrgChartNode[]>();
  for (const m of sorted) {
    const layer = layerById.get(m.id) ?? 1;
    const list = groups.get(layer) ?? [];
    list.push(m);
    groups.set(layer, list);
  }
  return {
    managersByLayer: [...groups.entries()].sort(([a], [b]) => a - b),
    eitherOrParentOptions,
    outlineById,
  };
}
