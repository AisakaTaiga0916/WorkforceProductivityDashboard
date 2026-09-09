/**
 * Task metrics grouped by org-chart sections (Departments view).
 * Main sections → donuts; nested subsections drill in via extended view.
 */
import { prisma } from "@/lib/prisma";
import { loadHrisAssignableStaff } from "@/lib/hris-staff-roster";
import {
  computeTaskChecklistPillarMetrics,
  kpiMaintenanceWhereForTaskMetrics,
  snapshotTimeZoneForTaskMetrics,
} from "@/lib/kpi-period-snapshots";
import type { TaskChecklistPillarMetrics } from "@/lib/kpis";
import type { TaskChecklistIncludedTask } from "@/lib/kpi-period-snapshots";
import type { TaskMetricsCadence } from "@/lib/task-metrics-range";

export type DepartmentMetricRow = {
  id: string;
  name: string;
  parentId: string | null;
  memberCount: number;
  agentCount: number;
  total: number;
  done: number;
  missing: number;
  percent: number;
  /** Live Task Board rows for members in this section tree (extended / SegmentView). */
  includedTasks: TaskChecklistIncludedTask[];
  /** Direct child subsections (recursive). */
  subsections: DepartmentMetricRow[];
};

/** @deprecated Prefer DepartmentMetricRow — kept as alias for call sites. */
export type DepartmentMainMetric = DepartmentMetricRow;

export type DepartmentMetricsPayload = {
  sections: DepartmentMetricRow[];
};

function rollupChecklistPillars(pillars: TaskChecklistPillarMetrics): {
  total: number;
  done: number;
  missing: number;
  percent: number;
  includedTasks: TaskChecklistIncludedTask[];
} {
  let total = 0;
  let done = 0;
  const byId = new Map<string, TaskChecklistIncludedTask>();
  for (const pillar of Object.values(pillars)) {
    if (!pillar) continue;
    total += pillar.total;
    done += pillar.done;
    for (const task of pillar.includedTasks ?? []) {
      if (!byId.has(task.id)) byId.set(task.id, task);
    }
  }
  const missing = Math.max(0, total - done);
  const percent = total <= 0 ? 0 : Math.round((done / total) * 1000) / 10;
  const includedTasks = [...byId.values()].sort((a, b) => a.title.localeCompare(b.title));
  return { total, done, missing, percent, includedTasks };
}

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

async function metricForAgentIds(args: {
  agentIds: string[];
  fromYmd: string;
  toYmd: string;
  metricsCadence: TaskMetricsCadence;
  timeZone: string;
}): Promise<{
  total: number;
  done: number;
  missing: number;
  percent: number;
  includedTasks: TaskChecklistIncludedTask[];
}> {
  if (args.agentIds.length === 0) {
    return { total: 0, done: 0, missing: 0, percent: 0, includedTasks: [] };
  }
  const pillars = await computeTaskChecklistPillarMetrics({
    metricsCadence: args.metricsCadence,
    fromYmd: args.fromYmd,
    toYmd: args.toYmd,
    timeZone: args.timeZone,
    kpiWhere: kpiMaintenanceWhereForTaskMetrics(undefined, args.agentIds),
    taskType: "task",
  });
  return rollupChecklistPillars(pillars);
}

export async function computeDepartmentTaskMetrics(args: {
  fromYmd: string;
  toYmd: string;
  metricsCadence: TaskMetricsCadence;
  timeZone?: string;
  /** When set, only sections/members tied to this company team are included. */
  companyTeamId?: string | null;
  /**
   * When set (Admin / section-scoped viewers), only these section ids appear —
   * typically membership + headed sections + descendants. Roots are tops of this
   * set so a sub-department head sees their sub as a top-level card.
   */
  allowedSectionIds?: string[] | null;
  /** When set, only sections that include this merged user are included. */
  onlyMergedSourceUserId?: string | null;
}): Promise<DepartmentMetricsPayload> {
  const timeZone = snapshotTimeZoneForTaskMetrics(args.timeZone);
  const allowedSectionIdSet =
    args.allowedSectionIds && args.allowedSectionIds.length > 0
      ? new Set(args.allowedSectionIds)
      : null;
  const [sections, memberships, primaryNodes, staff] = await Promise.all([
    prisma.orgChartSection.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        parentId: true,
        companyTeamId: true,
        sortOrder: true,
      },
    }),
    prisma.orgChartNodeSectionMembership.findMany({
      select: {
        sectionId: true,
        node: { select: { id: true, mergedSourceUserId: true } },
      },
    }),
    // Primary sectionId may predate the membership join table — include both.
    prisma.orgChartNode.findMany({
      where: { sectionId: { not: null } },
      select: { id: true, sectionId: true, mergedSourceUserId: true },
    }),
    // Section-scoped viewers: load full roster so department members aren't dropped
    // when HRIS company_name doesn't match portal designated company.
    loadHrisAssignableStaff(
      allowedSectionIdSet
        ? {}
        : args.companyTeamId
          ? { companyTeamId: args.companyTeamId }
          : {},
    ),
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

  function agentsForSectionTree(sectionId: string): {
    memberCount: number;
    agentIds: string[];
  } {
    const treeIds = collectDescendantIds(sectionId, childrenByParent);
    const mergedIds = new Set<string>();
    for (const sid of treeIds) {
      if (allowedSectionIdSet && !allowedSectionIdSet.has(sid)) continue;
      for (const member of membersBySection.get(sid) ?? []) {
        mergedIds.add(member.mergedSourceUserId);
      }
    }
    const agentIds: string[] = [];
    for (const mergedId of mergedIds) {
      const agentId = agentByMerged.get(mergedId);
      if (agentId) agentIds.push(agentId);
    }
    return { memberCount: mergedIds.size, agentIds: [...new Set(agentIds)] };
  }

  async function buildNode(sectionId: string): Promise<DepartmentMetricRow | null> {
    const section = sections.find((s) => s.id === sectionId);
    if (!section) return null;
    if (allowedSectionIdSet && !allowedSectionIdSet.has(section.id)) return null;
    const scope = agentsForSectionTree(section.id);
    const metric = await metricForAgentIds({
      agentIds: scope.agentIds,
      fromYmd: args.fromYmd,
      toYmd: args.toYmd,
      metricsCadence: args.metricsCadence,
      timeZone,
    });
    const childIds = (childrenByParent.get(section.id) ?? []).filter((childId) => {
      if (allowedSectionIdSet && !allowedSectionIdSet.has(childId)) return false;
      if (!args.companyTeamId || allowedSectionIdSet) return true;
      const child = sections.find((s) => s.id === childId);
      if (!child) return false;
      // Same company, or inherit parent company when child has no company set.
      return !child.companyTeamId || child.companyTeamId === args.companyTeamId;
    });
    const subsections = (
      await Promise.all(childIds.map((childId) => buildNode(childId)))
    ).filter((s): s is DepartmentMetricRow => s != null);

    return {
      id: section.id,
      name: section.name,
      parentId: section.parentId,
      memberCount: scope.memberCount,
      agentCount: scope.agentIds.length,
      ...metric,
      subsections,
    };
  }

  let mainSections = sections.filter((s) => !s.parentId);
  if (allowedSectionIdSet) {
    const scoped = sections.filter((s) => allowedSectionIdSet.has(s.id));
    const scopedIds = new Set(scoped.map((s) => s.id));
    // Tops of the viewer tree (e.g. a sub-department head's section).
    mainSections = scoped.filter((s) => !s.parentId || !scopedIds.has(s.parentId));
  } else if (args.companyTeamId) {
    // Require an explicit company match — do not keep unscoped (null) sections.
    mainSections = mainSections.filter((s) => s.companyTeamId === args.companyTeamId);
  }
  if (args.onlyMergedSourceUserId) {
    const uid = args.onlyMergedSourceUserId;
    mainSections = mainSections.filter((s) => {
      const tree = collectDescendantIds(s.id, childrenByParent);
      for (const sid of tree) {
        if ((membersBySection.get(sid) ?? []).some((m) => m.mergedSourceUserId === uid)) {
          return true;
        }
      }
      return false;
    });
  }

  const results = (
    await Promise.all(mainSections.map((main) => buildNode(main.id)))
  ).filter((s): s is DepartmentMetricRow => s != null);

  return { sections: results };
}
