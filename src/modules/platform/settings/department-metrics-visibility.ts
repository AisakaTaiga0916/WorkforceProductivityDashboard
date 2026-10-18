import {
  getPlatformSettingJson,
  setPlatformSettingJson,
} from "@/lib/platform-settings";

export const DEPARTMENT_METRICS_VISIBILITY_KEY = "department_metrics_visibility";

export type DepartmentMetricsVisibility = {
  /** Org-chart section ids hidden from Task Metrics → Departments. */
  hiddenSectionIds: string[];
};

export function parseDepartmentMetricsVisibility(raw: unknown): DepartmentMetricsVisibility {
  const ids = new Set<string>();
  if (raw && typeof raw === "object" && Array.isArray((raw as { hiddenSectionIds?: unknown }).hiddenSectionIds)) {
    for (const id of (raw as { hiddenSectionIds: unknown[] }).hiddenSectionIds) {
      if (typeof id === "string" && id.trim()) ids.add(id.trim());
    }
  }
  return { hiddenSectionIds: [...ids] };
}

export async function getDepartmentMetricsVisibility(): Promise<DepartmentMetricsVisibility> {
  const raw = await getPlatformSettingJson(DEPARTMENT_METRICS_VISIBILITY_KEY);
  return parseDepartmentMetricsVisibility(raw);
}

export async function setDepartmentMetricsVisibility(
  next: DepartmentMetricsVisibility,
): Promise<DepartmentMetricsVisibility> {
  const parsed = parseDepartmentMetricsVisibility(next);
  await setPlatformSettingJson(DEPARTMENT_METRICS_VISIBILITY_KEY, parsed);
  return parsed;
}

/** Drop hidden sections anywhere in the tree (main or nested). */
export function filterHiddenDepartmentSections<
  T extends { id: string; subsections?: T[] },
>(sections: T[], hiddenIds: ReadonlySet<string> | readonly string[]): T[] {
  const hidden = hiddenIds instanceof Set ? hiddenIds : new Set(hiddenIds);
  if (hidden.size === 0) return sections;

  function mapNode(node: T): T | null {
    if (hidden.has(node.id)) return null;
    const children = (node.subsections ?? [])
      .map((child) => mapNode(child))
      .filter((child): child is T => child != null);
    return { ...node, subsections: children };
  }

  return sections.map((s) => mapNode(s)).filter((s): s is T => s != null);
}
