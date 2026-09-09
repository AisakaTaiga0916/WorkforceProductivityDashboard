/** Client-safe org-chart section helpers (no Prisma / Node imports). */

export type OrgChartSectionOption = {
  id: string;
  name: string;
  parentId: string | null;
  companyTeamId: string | null;
  /** Display name (same as `name`; kept for API compatibility). */
  label: string;
  depth: number;
};

export type OrgChartSectionRow = {
  id: string;
  name: string;
  parentId: string | null;
  companyTeamId: string | null;
  sortOrder: number;
};

function compareSectionRows(
  a: { sortOrder: number; name: string },
  b: { sortOrder: number; name: string },
): number {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

/** Depth-first tree order: parent, then children (by sortOrder, then name). */
export function orderOrgChartSectionsTree(
  sections: OrgChartSectionRow[],
): OrgChartSectionOption[] {
  const childrenByParent = new Map<string | null, OrgChartSectionRow[]>();
  for (const section of sections) {
    const list = childrenByParent.get(section.parentId) ?? [];
    list.push(section);
    childrenByParent.set(section.parentId, list);
  }
  for (const list of childrenByParent.values()) {
    list.sort(compareSectionRows);
  }

  const out: OrgChartSectionOption[] = [];
  function walk(parentId: string | null, depth: number) {
    for (const section of childrenByParent.get(parentId) ?? []) {
      out.push({
        id: section.id,
        name: section.name,
        parentId: section.parentId,
        companyTeamId: section.companyTeamId,
        label: section.name,
        depth,
      });
      walk(section.id, depth + 1);
    }
  }
  walk(null, 0);
  return out;
}

/** Keep ancestor rows so filtered member sections still appear under their parent chain. */
export function expandOrgChartSectionsWithAncestors(
  allSections: OrgChartSectionRow[],
  memberSectionIds: Iterable<string>,
): OrgChartSectionRow[] {
  const byId = new Map(allSections.map((s) => [s.id, s]));
  const needed = new Set<string>();
  for (const id of memberSectionIds) {
    let current: string | null = id;
    const trail = new Set<string>();
    while (current && !trail.has(current)) {
      trail.add(current);
      needed.add(current);
      current = byId.get(current)?.parentId ?? null;
    }
  }
  return allSections.filter((s) => needed.has(s.id));
}

/** Prefix indent for nested section names in `<select>` options. */
export function orgChartSectionOptionText(
  section: Pick<OrgChartSectionOption, "name" | "depth">,
): string {
  if (section.depth <= 0) return section.name;
  return `${"— ".repeat(section.depth)}${section.name}`;
}

/** Top-level departments (depth 0 / no parent). */
export function orgChartMajorDepartments(
  sections: OrgChartSectionOption[],
): OrgChartSectionOption[] {
  return sections.filter((s) => s.depth <= 0 || !s.parentId);
}

/**
 * Tops of a (possibly filtered) section list: no parent, or parent outside the set.
 * Used by Group Board so a sub-department head sees their sub as a column, not only majors.
 */
export function orgChartScopeRootDepartments(
  sections: OrgChartSectionOption[],
): OrgChartSectionOption[] {
  const idSet = new Set(sections.map((s) => s.id));
  return sections.filter((s) => !s.parentId || !idSet.has(s.parentId));
}

/** Resolve company team by walking parents (same rule as server routing). */
export function orgChartSectionCompanyTeamId(
  sections: Array<Pick<OrgChartSectionOption, "id" | "parentId" | "companyTeamId">>,
  sectionId: string,
): string | null {
  const byId = new Map(sections.map((s) => [s.id, s]));
  let current: string | null = sectionId.trim() || null;
  const seen = new Set<string>();
  while (current && !seen.has(current)) {
    seen.add(current);
    const row = byId.get(current);
    if (!row) return null;
    if (row.companyTeamId) return row.companyTeamId;
    current = row.parentId;
  }
  return null;
}

/** Keep sections belonging to a company team (via self or ancestor). */
export function filterOrgChartSectionsByCompanyTeam(
  sections: OrgChartSectionOption[],
  companyTeamId: string | null | undefined,
): OrgChartSectionOption[] {
  const team = (companyTeamId ?? "").trim();
  if (!team) return sections;
  return sections.filter((s) => orgChartSectionCompanyTeamId(sections, s.id) === team);
}

/** Smart-filter options: same labels/indent as org-chart ticket intake. */
export function buildOrgChartDepartmentFilterOptions(
  sections: OrgChartSectionOption[],
  companyTeamId?: string | null,
): Array<{ value: string; label: string }> {
  const scoped = filterOrgChartSectionsByCompanyTeam(sections, companyTeamId);
  return scoped.map((section) => ({
    value: section.id,
    label: orgChartSectionOptionText(section),
  }));
}

/** Section id plus all nested subsection ids. */
export function collectOrgChartSectionDescendantIds(
  rootId: string,
  sections: Array<Pick<OrgChartSectionOption, "id" | "parentId">>,
): Set<string> {
  const id = rootId.trim();
  const out = new Set<string>();
  if (!id) return out;
  const childrenByParent = new Map<string | null, string[]>();
  for (const section of sections) {
    const list = childrenByParent.get(section.parentId) ?? [];
    list.push(section.id);
    childrenByParent.set(section.parentId, list);
  }
  out.add(id);
  const stack = [...(childrenByParent.get(id) ?? [])];
  while (stack.length > 0) {
    const next = stack.pop()!;
    if (out.has(next)) continue;
    out.add(next);
    stack.push(...(childrenByParent.get(next) ?? []));
  }
  return out;
}

/** Merged HRIS user ids in a section tree (direct memberships only in the map). */
export function mergedSourceUserIdsForOrgChartSectionTree(
  sectionId: string,
  sections: Array<Pick<OrgChartSectionOption, "id" | "parentId">>,
  membersBySection: Record<string, string[]>,
): Set<string> {
  const treeIds = collectOrgChartSectionDescendantIds(sectionId, sections);
  const out = new Set<string>();
  for (const sid of treeIds) {
    for (const mergedId of membersBySection[sid] ?? []) {
      const key = mergedId.trim();
      if (key) out.add(key);
    }
  }
  return out;
}

/** Direct + nested sub-departments under a major department. */
export function orgChartSubDepartments(
  sections: OrgChartSectionOption[],
  majorId: string,
): OrgChartSectionOption[] {
  const id = majorId.trim();
  if (!id) return [];
  const byId = new Map(sections.map((s) => [s.id, s]));
  const major = byId.get(id);
  if (!major) return [];
  const majorDepth = major.depth;
  return sections.filter((s) => {
    if (s.id === id) return false;
    let cur: OrgChartSectionOption | undefined = s;
    const seen = new Set<string>();
    while (cur?.parentId && !seen.has(cur.id)) {
      seen.add(cur.id);
      if (cur.parentId === id) return true;
      cur = byId.get(cur.parentId);
    }
    return false;
  }).map((s) => ({
    ...s,
    /** Relative indent under the major for the sub-department dropdown. */
    depth: Math.max(0, s.depth - majorDepth - 1),
  }));
}

/** Walk to the top-level department for a section. */
export function orgChartRootSectionId(
  sections: Array<Pick<OrgChartSectionOption, "id" | "parentId">>,
  sectionId: string,
): string {
  const byId = new Map(sections.map((s) => [s.id, s]));
  let cur = byId.get(sectionId);
  const seen = new Set<string>();
  while (cur?.parentId && byId.has(cur.parentId) && !seen.has(cur.id)) {
    seen.add(cur.id);
    cur = byId.get(cur.parentId);
  }
  return cur?.id ?? sectionId;
}

/** Case-insensitive exact name match, then includes fallback. */
export function findOrgChartSectionByName(
  sections: OrgChartSectionOption[],
  name: string,
): OrgChartSectionOption | null {
  const needle = name.trim().toLowerCase();
  if (!needle) return null;
  const exact = sections.find((s) => s.name.trim().toLowerCase() === needle);
  if (exact) return exact;
  return (
    sections.find((s) => {
      const n = s.name.trim().toLowerCase();
      return n.includes(needle) || needle.includes(n);
    }) ?? null
  );
}

/**
 * Resolve major + optional sub selection for a target section id.
 * Sub is set when the target is nested under the major.
 */
export function resolveSendToDepartmentSelection(
  sections: OrgChartSectionOption[],
  sectionId: string,
): { majorId: string; subId: string } {
  const id = sectionId.trim();
  if (!id) return { majorId: "", subId: "" };
  const majorId = orgChartRootSectionId(sections, id);
  return {
    majorId,
    subId: id === majorId ? "" : id,
  };
}
