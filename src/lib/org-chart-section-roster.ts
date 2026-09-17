/**
 * Server-side org-chart section rosters for RFP intake and ticket routing.
 */
import { prisma } from "@/lib/prisma";
import { loadHrisAssignableStaff } from "@/lib/hris-staff-roster";
import { resolveExecutiveTitle } from "@/lib/org-chart-executive-titles";
import {
  expandOrgChartSectionsWithAncestors,
  orderOrgChartSectionsTree,
  type OrgChartSectionOption,
} from "@/lib/org-chart-section-display";

export type { OrgChartSectionOption } from "@/lib/org-chart-section-display";
export {
  expandOrgChartSectionsWithAncestors,
  orderOrgChartSectionsTree,
  orgChartSectionOptionText,
} from "@/lib/org-chart-section-display";

function collectDescendantIds(
  rootId: string,
  childrenByParent: Map<string | null, string[]>,
): Set<string> {
  const out = new Set<string>([rootId]);
  const stack = [...(childrenByParent.get(rootId) ?? [])];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (out.has(id)) continue;
    out.add(id);
    stack.push(...(childrenByParent.get(id) ?? []));
  }
  return out;
}

export async function listOrgChartSectionOptions(): Promise<OrgChartSectionOption[]> {
  const sections = await prisma.orgChartSection.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, parentId: true, companyTeamId: true, sortOrder: true },
  });
  return orderOrgChartSectionsTree(sections);
}

/**
 * Section roster = members (memberships + primary sectionId) plus org-chart heads.
 * Heads are often not listed as members of the section they head — RFP Noted By
 * still needs them in the picker and in submit validation.
 */
export function collectMergedIdsForSectionTree(
  treeIds: Iterable<string>,
  membersBySection: Map<string, Array<{ mergedSourceUserId: string }>>,
  headMergedBySection?: Map<string, string>,
): string[] {
  const mergedIds = new Set<string>();
  for (const sid of treeIds) {
    for (const member of membersBySection.get(sid) ?? []) {
      const merged = member.mergedSourceUserId?.trim();
      if (merged) mergedIds.add(merged);
    }
    const headMerged = headMergedBySection?.get(sid)?.trim();
    if (headMerged) mergedIds.add(headMerged);
  }
  return [...mergedIds];
}

async function loadSectionMemberGraph() {
  const [sections, memberships, primaryNodes, staff] = await Promise.all([
    prisma.orgChartSection.findMany({
      select: {
        id: true,
        parentId: true,
        companyTeamId: true,
        headNode: { select: { mergedSourceUserId: true } },
      },
    }),
    prisma.orgChartNodeSectionMembership.findMany({
      select: {
        sectionId: true,
        node: { select: { id: true, mergedSourceUserId: true } },
      },
    }),
    prisma.orgChartNode.findMany({
      where: { sectionId: { not: null } },
      select: { id: true, sectionId: true, mergedSourceUserId: true },
    }),
    loadHrisAssignableStaff({}),
  ]);

  const agentByMerged = new Map<string, string>();
  for (const row of staff) {
    if (row.mergedSourceUserId && row.agentId) {
      agentByMerged.set(row.mergedSourceUserId, row.agentId);
    }
  }

  const childrenByParent = new Map<string | null, string[]>();
  for (const s of sections) {
    const list = childrenByParent.get(s.parentId) ?? [];
    list.push(s.id);
    childrenByParent.set(s.parentId, list);
  }

  const membersBySection = new Map<string, Array<{ nodeId: string; mergedSourceUserId: string }>>();
  const addMember = (sectionId: string, nodeId: string, mergedSourceUserId: string) => {
    const list = membersBySection.get(sectionId) ?? [];
    if (list.some((m) => m.nodeId === nodeId)) return;
    list.push({ nodeId, mergedSourceUserId });
    membersBySection.set(sectionId, list);
  };
  for (const m of memberships) {
    addMember(m.sectionId, m.node.id, m.node.mergedSourceUserId);
  }
  for (const node of primaryNodes) {
    if (!node.sectionId) continue;
    addMember(node.sectionId, node.id, node.mergedSourceUserId);
  }

  const headMergedBySection = new Map<string, string>();
  for (const s of sections) {
    const merged = s.headNode?.mergedSourceUserId?.trim();
    if (merged) headMergedBySection.set(s.id, merged);
  }

  return { sections, childrenByParent, membersBySection, agentByMerged, headMergedBySection };
}

/** Merged HRIS user ids for a section and all nested subsections (members + section heads). */
export async function resolveMergedSourceUserIdsForOrgChartSection(
  sectionId: string,
): Promise<string[]> {
  const id = sectionId.trim();
  if (!id) return [];
  const { childrenByParent, membersBySection, headMergedBySection } = await loadSectionMemberGraph();
  const treeIds = collectDescendantIds(id, childrenByParent);
  return collectMergedIdsForSectionTree(treeIds, membersBySection, headMergedBySection);
}

/** Agent ids for a section and all nested subsections. */
export async function resolveAgentIdsForOrgChartSection(
  sectionId: string,
): Promise<string[]> {
  const id = sectionId.trim();
  if (!id) return [];
  const { agentByMerged } = await loadSectionMemberGraph();
  const mergedIds = await resolveMergedSourceUserIdsForOrgChartSection(id);
  const agentIds: string[] = [];
  for (const mergedId of mergedIds) {
    const agentId = agentByMerged.get(mergedId);
    if (agentId) agentIds.push(agentId);
  }
  return [...new Set(agentIds)];
}

/** Sections the merged HRIS user belongs to (memberships + primary sectionId + headed sections). */
export async function resolveOrgChartSectionIdsForMergedUser(
  mergedSourceUserId: string | null | undefined,
): Promise<string[]> {
  const key = (mergedSourceUserId ?? "").trim();
  if (!key) return [];
  const [memberships, primary, headed] = await Promise.all([
    prisma.orgChartNodeSectionMembership.findMany({
      where: { node: { mergedSourceUserId: key } },
      select: { sectionId: true },
    }),
    prisma.orgChartNode.findFirst({
      where: { mergedSourceUserId: key, sectionId: { not: null } },
      select: { sectionId: true },
    }),
    prisma.orgChartSection.findMany({
      where: { headNode: { mergedSourceUserId: key } },
      select: { id: true },
    }),
  ]);
  const ids = new Set<string>();
  for (const m of memberships) ids.add(m.sectionId);
  if (primary?.sectionId) ids.add(primary.sectionId);
  for (const s of headed) ids.add(s.id);
  return [...ids];
}

/**
 * Prefer the deepest nested membership (most specific department), then stable id order.
 * Used when intake / travel omit an explicit requestor section.
 */
export async function pickDeepestOrgChartSectionId(
  sectionIds: readonly string[],
): Promise<string | null> {
  const ids = [...new Set(sectionIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) return null;
  if (ids.length === 1) return ids[0] ?? null;

  // Full tree so depth counts ancestors outside the membership set.
  const allSections = await prisma.orgChartSection.findMany({
    select: { id: true, parentId: true },
  });
  const byId = new Map(allSections.map((s) => [s.id, s]));
  const present = ids.filter((id) => byId.has(id));
  if (present.length === 0) return ids[0] ?? null;

  function depthOf(sectionId: string): number {
    let depth = 0;
    let current: string | null = sectionId;
    const seen = new Set<string>();
    while (current && !seen.has(current)) {
      seen.add(current);
      const row = byId.get(current);
      if (!row?.parentId) break;
      depth += 1;
      current = row.parentId;
    }
    return depth;
  }

  const ranked = [...present].sort((a, b) => {
    const depthDiff = depthOf(b) - depthOf(a);
    if (depthDiff !== 0) return depthDiff;
    return a.localeCompare(b);
  });
  return ranked[0] ?? ids[0] ?? null;
}

/** Deepest org-chart section for a merged HRIS user, or null if none. */
export async function resolveDeepestOrgChartSectionIdForMergedUser(
  mergedSourceUserId: string | null | undefined,
): Promise<string | null> {
  const sectionIds = await resolveOrgChartSectionIdsForMergedUser(mergedSourceUserId);
  return pickDeepestOrgChartSectionId(sectionIds);
}

/** Walk section tree upward to find a company team for board routing. */
export async function resolveCompanyTeamIdForOrgChartSection(
  sectionId: string | null | undefined,
): Promise<string | null> {
  let current = (sectionId ?? "").trim() || null;
  const seen = new Set<string>();
  while (current && !seen.has(current)) {
    seen.add(current);
    const row = await prisma.orgChartSection.findUnique({
      where: { id: current },
      select: { companyTeamId: true, parentId: true },
    });
    if (!row) return null;
    if (row.companyTeamId) return row.companyTeamId;
    current = row.parentId;
  }
  return null;
}

export async function orgChartSectionExists(sectionId: string): Promise<boolean> {
  const id = sectionId.trim();
  if (!id) return false;
  const row = await prisma.orgChartSection.findUnique({
    where: { id },
    select: { id: true },
  });
  return Boolean(row);
}

type SectionRow = {
  id: string;
  name: string;
  parentId: string | null;
  headNodeId: string | null;
};

/** Root / main section for a section id (walks parentId upward). */
export async function resolveMainOrgChartSectionId(
  sectionId: string | null | undefined,
): Promise<string | null> {
  let current = (sectionId ?? "").trim() || null;
  let mainId: string | null = null;
  const seen = new Set<string>();
  while (current && !seen.has(current)) {
    seen.add(current);
    mainId = current;
    const row = await prisma.orgChartSection.findUnique({
      where: { id: current },
      select: { parentId: true },
    });
    if (!row) break;
    current = row.parentId;
  }
  return mainId;
}

/** Selected section plus its main (root) ancestor. */
export async function resolveOrgChartSectionContext(sectionId: string | null | undefined): Promise<{
  selected: SectionRow | null;
  main: SectionRow | null;
  isSubsection: boolean;
} | null> {
  const id = (sectionId ?? "").trim();
  if (!id) return null;

  const chain: SectionRow[] = [];
  let current: string | null = id;
  const seen = new Set<string>();
  while (current && !seen.has(current)) {
    seen.add(current);
    const row: SectionRow | null = await prisma.orgChartSection.findUnique({
      where: { id: current },
      select: { id: true, name: true, parentId: true, headNodeId: true },
    });
    if (!row) break;
    chain.push(row);
    current = row.parentId;
  }
  if (chain.length === 0) return null;

  const selected = chain[0]!;
  const main = chain[chain.length - 1]!;
  return {
    selected,
    main,
    isSubsection: chain.length > 1,
  };
}

export type OrgChartSectionHeadOption = {
  id: string;
  name: string;
  email: string;
  sectionId: string;
  sectionName: string;
  isSubsection: boolean;
  /** Major (root) department name — used for picker grouping. */
  group: string;
  /** e.g. "Sub-department head — IT TEAM" */
  subtitle: string;
};

/**
 * Cross-department org-chart section heads for intake / travel-style approver pickers.
 * One row per section that has a resolvable head (same person may appear under multiple sections).
 */
export async function listOrgChartSectionHeads(): Promise<OrgChartSectionHeadOption[]> {
  const [sections, staff] = await Promise.all([
    prisma.orgChartSection.findMany({
      select: { id: true, name: true, parentId: true, headNodeId: true, sortOrder: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    loadHrisAssignableStaff({}),
  ]);

  const agentByMerged = new Map<string, { agentId: string; name: string }>();
  for (const row of staff) {
    if (!row.mergedSourceUserId || !row.agentId) continue;
    agentByMerged.set(row.mergedSourceUserId, { agentId: row.agentId, name: row.name });
  }

  const headNodeIds = [
    ...new Set(
      sections
        .map((s) => s.headNodeId)
        .filter((id): id is string => Boolean(id?.trim())),
    ),
  ];
  if (headNodeIds.length === 0) return [];

  const nodes = await prisma.orgChartNode.findMany({
    where: { id: { in: headNodeIds } },
    select: { id: true, mergedSourceUserId: true, personName: true },
  });
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  const agentIds = new Set<string>();
  for (const section of sections) {
    if (!section.headNodeId) continue;
    const node = nodeById.get(section.headNodeId);
    if (!node?.mergedSourceUserId) continue;
    const staffRow = agentByMerged.get(node.mergedSourceUserId);
    if (staffRow?.agentId) agentIds.add(staffRow.agentId);
  }

  const agents =
    agentIds.size > 0
      ? await prisma.agent.findMany({
          where: { id: { in: [...agentIds] } },
          select: { id: true, name: true, email: true },
        })
      : [];
  const agentById = new Map(agents.map((a) => [a.id, a]));

  const sectionById = new Map(sections.map((s) => [s.id, s]));
  function majorSectionName(sectionId: string): string {
    let current = sectionById.get(sectionId);
    const seen = new Set<string>();
    while (current?.parentId && !seen.has(current.id)) {
      seen.add(current.id);
      current = sectionById.get(current.parentId);
    }
    return (current?.name ?? sectionById.get(sectionId)?.name ?? "Other").trim() || "Other";
  }

  const out: OrgChartSectionHeadOption[] = [];
  for (const section of sections) {
    if (!section.headNodeId) continue;
    const node = nodeById.get(section.headNodeId);
    if (!node?.mergedSourceUserId) continue;
    const staffRow = agentByMerged.get(node.mergedSourceUserId);
    if (!staffRow) continue;
    const agent = agentById.get(staffRow.agentId);
    if (!agent) continue;

    const isSubsection = Boolean(section.parentId);
    const group = majorSectionName(section.id);
    out.push({
      id: agent.id,
      name: agent.name || staffRow.name || node.personName || "Unknown",
      email: agent.email?.trim() || "",
      sectionId: section.id,
      sectionName: section.name,
      isSubsection,
      group,
      subtitle: isSubsection
        ? `Sub-department head — ${section.name}`
        : `Department head — ${section.name}`,
    });
  }

  out.sort((a, b) => {
    const g = a.group.localeCompare(b.group, undefined, { sensitivity: "base" });
    if (g !== 0) return g;
    const s = a.sectionName.localeCompare(b.sectionName, undefined, { sensitivity: "base" });
    if (s !== 0) return s;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });

  return out;
}

/** Department designation (executive title + deepest org-chart section) keyed by merged HRIS id. */
export async function resolveDepartmentDesignationsByMergedIds(
  mergedSourceUserIds: Iterable<string>,
): Promise<Map<string, string>> {
  const ids = [
    ...new Set(
      [...mergedSourceUserIds].map((id) => String(id ?? "").trim()).filter(Boolean),
    ),
  ];
  const out = new Map<string, string>();
  if (ids.length === 0) return out;

  const [nodes, headed] = await Promise.all([
    prisma.orgChartNode.findMany({
      where: { mergedSourceUserId: { in: ids } },
      select: {
        mergedSourceUserId: true,
        personName: true,
        personRole: true,
        sectionId: true,
        sectionMemberships: { select: { sectionId: true } },
      },
    }),
    prisma.orgChartSection.findMany({
      where: { headNode: { mergedSourceUserId: { in: ids } } },
      select: {
        id: true,
        headNode: { select: { mergedSourceUserId: true } },
      },
    }),
  ]);

  const sectionIdsByMerged = new Map<string, Set<string>>();
  const metaByMerged = new Map<
    string,
    { personName: string | null; personRole: string | null }
  >();

  function addSection(merged: string, sectionId: string | null | undefined) {
    const sid = sectionId?.trim();
    if (!sid) return;
    const set = sectionIdsByMerged.get(merged) ?? new Set<string>();
    set.add(sid);
    sectionIdsByMerged.set(merged, set);
  }

  for (const node of nodes) {
    const merged = node.mergedSourceUserId?.trim();
    if (!merged) continue;
    metaByMerged.set(merged, {
      personName: node.personName,
      personRole: node.personRole,
    });
    addSection(merged, node.sectionId);
    for (const membership of node.sectionMemberships) {
      addSection(merged, membership.sectionId);
    }
  }
  for (const section of headed) {
    const merged = section.headNode?.mergedSourceUserId?.trim();
    if (!merged) continue;
    addSection(merged, section.id);
  }

  const allSectionIds = [
    ...new Set([...sectionIdsByMerged.values()].flatMap((set) => [...set])),
  ];
  const sections =
    allSectionIds.length > 0
      ? await prisma.orgChartSection.findMany({
          where: { id: { in: allSectionIds } },
          select: { id: true, name: true, parentId: true },
        })
      : [];
  const sectionById = new Map(sections.map((section) => [section.id, section]));

  function deepestSectionName(sectionIds: Set<string>): string | null {
    const present = [...sectionIds].filter((id) => sectionById.has(id));
    if (present.length === 0) return null;
    function depthOf(sectionId: string): number {
      let depth = 0;
      let current: string | null = sectionId;
      const seen = new Set<string>();
      while (current && !seen.has(current)) {
        seen.add(current);
        const row = sectionById.get(current);
        if (!row?.parentId) break;
        depth += 1;
        current = row.parentId;
      }
      return depth;
    }
    present.sort((a, b) => depthOf(b) - depthOf(a) || a.localeCompare(b));
    return sectionById.get(present[0]!)?.name.trim() || null;
  }

  for (const merged of ids) {
    const meta = metaByMerged.get(merged);
    const exec = resolveExecutiveTitle({
      mergedSourceUserId: merged,
      personName: meta?.personName,
    });
    const sectionName = deepestSectionName(sectionIdsByMerged.get(merged) ?? new Set());
    const role = meta?.personRole?.trim() || null;
    const roleLooksLikeTitle =
      Boolean(role) &&
      (Boolean(exec && exec.toLowerCase() === role!.toLowerCase()) ||
        /^(ceo|coo|cfo|cto|president)$/i.test(role!));
    // Work-plan / picker label is the department, not "COO · COO".
    const department = sectionName || (roleLooksLikeTitle ? null : role);
    if (department) out.set(merged, department);
  }
  return out;
}
