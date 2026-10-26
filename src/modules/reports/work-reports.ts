/**
 * Work → Reports: three segregated lenses (Tasks | Projects | Work Plans).
 * Each lens has its own query and metrics — there is no blended "work score".
 */

import type { Session } from "next-auth";
import { DateTime } from "luxon";
import { prisma } from "@/modules/platform/db/prisma";
import { resolveOpsPermissions } from "@/lib/ops-permissions";
import { loadTaskBoardLaneRows } from "@/modules/tasks/task-board-lane-counts";
import { kpiMainTaskLabel } from "@/modules/tasks/kpi-main-task";
import { listProjectsForViewer, resolveProjectViewer } from "@/modules/projects/project-service";
import {
  isProjectAtRisk,
  isProjectPhaseDelayed,
} from "@/modules/projects/project-metrics";
import { PROJECT_STATUSES, PROJECT_STATUS_LABELS } from "@/modules/projects/project-status";
import { findTravelOrdersVisibleToAgent } from "@/modules/work-plans/travel-order-db";
import { TRAVEL_ORDER_STATUS, parseApprovalLevels } from "@/modules/work-plans/travel-order";
import { median, hoursBetween, type ReportRange } from "@/modules/reports/report-range";
import type { ReportViewer } from "@/modules/reports/report-scope";

export const WORK_REPORT_LENSES = ["tasks", "projects", "work-plans"] as const;
export type WorkReportLens = (typeof WORK_REPORT_LENSES)[number];

export function parseWorkReportLens(raw: string | null | undefined): WorkReportLens | null {
  return WORK_REPORT_LENSES.includes(raw as WorkReportLens) ? (raw as WorkReportLens) : null;
}

type WorkReportInput = {
  session: Session;
  viewer: ReportViewer;
  range: ReportRange;
  /** Agent ids of the selected team (org-chart section), or null for no team filter. */
  teamAgentIds: Set<string> | null;
  /** Tasks lens only: requested assignee agent id. */
  assigneeParam?: string | null;
};

function inRange(date: Date | null | undefined, range: ReportRange): boolean {
  if (!date) return false;
  const ms = date.getTime();
  return ms >= range.start.getTime() && ms < range.endExclusive.getTime();
}

function todayYmd(timeZone: string): string {
  return DateTime.now().setZone(timeZone).toISODate()!;
}

async function agentNames(ids: Iterable<string>): Promise<Map<string, string>> {
  const list = [...new Set(ids)].filter(Boolean);
  if (list.length === 0) return new Map();
  const rows = await prisma.agent.findMany({
    where: { id: { in: list } },
    select: { id: true, name: true },
  });
  return new Map(rows.map((r) => [r.id, r.name]));
}

// ── Tasks ────────────────────────────────────────────────────────────────

const OVERDUE_AGING = [
  { label: "1–2 days late", maxDays: 3 },
  { label: "3–7 days late", maxDays: 8 },
  { label: "8–30 days late", maxDays: 31 },
  { label: "30+ days late", maxDays: Number.POSITIVE_INFINITY },
];

export type TaskWorkReport = {
  board: { current: number; done: number; delayed: number; total: number };
  dueInRange: number;
  completedOfDue: number;
  completedInRange: number;
  onTimeCompleted: number;
  onTimeBasis: number;
  overdueAging: Array<{ label: string; count: number }>;
  recurringDelayed: number;
  byAssignee: Array<{
    agentId: string | null;
    name: string;
    open: number;
    delayed: number;
    done: number;
  }>;
  delayedTasks: Array<{ id: string; title: string; assignee: string; targetYmd: string | null; daysLate: number | null }>;
  legacyProjectRowsExcluded: number;
  /** Assignees of the tasks in scope (before the assignee filter). */
  assigneeOptions: Array<{ value: string; label: string }>;
  /** `ALL` or the applied assignee id. */
  assigneeValue: string;
};

export async function loadTaskWorkReport(input: WorkReportInput): Promise<TaskWorkReport> {
  const { session, viewer, range, teamAgentIds, assigneeParam } = input;
  const zone = range.timeZone;
  const allRows = await loadTaskBoardLaneRows({
    role: session.user.role,
    email: session.user.email,
    name: session.user.name,
    companyTeamId: viewer.global ? undefined : viewer.companyFilterId,
    globalCompanyTeamId: viewer.global ? viewer.companyFilterId : null,
    timeZone: zone,
  });
  const legacyProjectRowsExcluded = allRows.filter((r) => r.isTimelineProject).length;
  const scopedRows = allRows.filter(
    (r) =>
      !r.isTimelineProject &&
      (!teamAgentIds || (r.assignedAgentId != null && teamAgentIds.has(r.assignedAgentId))),
  );
  const scopedAssigneeIds = [
    ...new Set(scopedRows.map((r) => r.assignedAgentId).filter((id): id is string => Boolean(id))),
  ];
  const scopedNames = await agentNames(scopedAssigneeIds);
  const assigneeOptions = scopedAssigneeIds
    .map((id) => ({ value: id, label: scopedNames.get(id) ?? "Unknown" }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const assigneeValue =
    assigneeParam && assigneeOptions.some((o) => o.value === assigneeParam) ? assigneeParam : "ALL";
  const rows =
    assigneeValue === "ALL" ? scopedRows : scopedRows.filter((r) => r.assignedAgentId === assigneeValue);

  const today = DateTime.now().setZone(zone).startOf("day");
  const board = { current: 0, done: 0, delayed: 0, total: rows.length };
  let dueInRange = 0;
  let completedOfDue = 0;
  let completedInRange = 0;
  let onTimeCompleted = 0;
  let onTimeBasis = 0;
  let recurringDelayed = 0;
  const overdueAging = OVERDUE_AGING.map((b) => ({ label: b.label, count: 0 }));
  const assignee = new Map<string, { open: number; delayed: number; done: number }>();
  const delayedTasks: TaskWorkReport["delayedTasks"] = [];

  for (const row of rows) {
    if (row.lane === "DONE") board.done += 1;
    else if (row.lane === "DELAYED") board.delayed += 1;
    else board.current += 1;

    const key = row.assignedAgentId ?? "";
    const acc = assignee.get(key) ?? { open: 0, delayed: 0, done: 0 };
    if (row.lane === "DONE") acc.done += 1;
    else acc.open += 1;
    if (row.lane === "DELAYED") acc.delayed += 1;
    assignee.set(key, acc);

    const target = !row.isRecurring && row.nonRecurringEndAt
      ? DateTime.fromJSDate(row.nonRecurringEndAt, { zone }).startOf("day")
      : null;
    // Target date semantics: delayed from the day after the target.
    const deadline = target ? target.plus({ days: 1 }).toJSDate() : null;
    const completed = row.lastFullCompletionAt;

    if (target && inRange(target.toJSDate(), range)) {
      dueInRange += 1;
      if (row.lane === "DONE") completedOfDue += 1;
    }
    if (completed && inRange(completed, range)) {
      completedInRange += 1;
      if (deadline) {
        onTimeBasis += 1;
        if (completed.getTime() < deadline.getTime()) onTimeCompleted += 1;
      }
    }
    if (row.lane === "DELAYED") {
      const daysLate = target ? Math.max(1, Math.floor(today.diff(target, "days").days)) : null;
      if (daysLate == null) {
        recurringDelayed += 1;
      } else {
        const idx = OVERDUE_AGING.findIndex((b) => daysLate < b.maxDays);
        overdueAging[idx >= 0 ? idx : overdueAging.length - 1]!.count += 1;
      }
      delayedTasks.push({
        id: row.id,
        title: kpiMainTaskLabel(row) || row.title,
        assignee: row.assignedAgentId ?? "",
        targetYmd: target?.toISODate() ?? null,
        daysLate,
      });
    }
  }

  const names = scopedNames;
  return {
    board,
    dueInRange,
    completedOfDue,
    completedInRange,
    onTimeCompleted,
    onTimeBasis,
    overdueAging,
    recurringDelayed,
    byAssignee: [...assignee.entries()]
      .map(([agentId, acc]) => ({
        agentId: agentId || null,
        name: agentId ? (names.get(agentId) ?? "Unknown") : "Unassigned",
        ...acc,
      }))
      .sort((a, b) => b.open - a.open || b.delayed - a.delayed || a.name.localeCompare(b.name)),
    delayedTasks: delayedTasks
      .map((t) => ({ ...t, assignee: t.assignee ? (names.get(t.assignee) ?? "Unknown") : "Unassigned" }))
      .sort((a, b) => (b.daysLate ?? 0) - (a.daysLate ?? 0))
      .slice(0, 15),
    legacyProjectRowsExcluded,
    assigneeOptions,
    assigneeValue,
  };
}

// ── Projects ─────────────────────────────────────────────────────────────

export type ProjectWorkReport = {
  total: number;
  open: number;
  atRisk: number;
  createdInRange: number;
  completedInRange: number;
  byStatus: Array<{ status: string; label: string; count: number }>;
  atRiskProjects: Array<{ id: string; title: string; status: string; dueDate: string | null; lead: string | null }>;
  delayedPhases: Array<{
    projectId: string;
    projectTitle: string;
    phaseName: string;
    dueDate: string;
    daysLate: number;
  }>;
};

export async function loadProjectWorkReport(input: WorkReportInput): Promise<ProjectWorkReport> {
  const { session, viewer, range, teamAgentIds } = input;
  const projectViewer = await resolveProjectViewer(session);
  const today = todayYmd(range.timeZone);
  const projects = (await listProjectsForViewer(projectViewer)).filter((p) => {
    if (viewer.companyFilterId && p.scopedCompanyTeamId !== viewer.companyFilterId) return false;
    if (!teamAgentIds) return true;
    const people = [
      p.leadAgentId,
      ...p.phases.flatMap((ph) => [ph.assignedAgentId, ...ph.items.map((it) => it.assignedAgentId)]),
    ];
    return people.some((id) => id != null && teamAgentIds.has(id));
  });

  const byStatus = new Map<string, number>();
  const atRiskProjects: ProjectWorkReport["atRiskProjects"] = [];
  const delayedPhases: ProjectWorkReport["delayedPhases"] = [];
  let createdInRange = 0;
  let completedInRange = 0;
  const todayDt = DateTime.fromISO(today);
  for (const p of projects) {
    byStatus.set(p.status, (byStatus.get(p.status) ?? 0) + 1);
    if (inRange(new Date(p.createdAt), range)) createdInRange += 1;
    if (p.status === "DONE" && inRange(new Date(p.updatedAt), range)) completedInRange += 1;
    if (isProjectAtRisk(p, today)) {
      atRiskProjects.push({
        id: p.id,
        title: p.title,
        status: p.status,
        dueDate: p.dueDate,
        lead: p.leadAgentName,
      });
    }
    if (p.status === "DONE") continue;
    for (const phase of p.phases) {
      if (!isProjectPhaseDelayed(phase, today) || !phase.dueDate) continue;
      delayedPhases.push({
        projectId: p.id,
        projectTitle: p.title,
        phaseName: phase.name,
        dueDate: phase.dueDate,
        daysLate: Math.max(1, Math.round(todayDt.diff(DateTime.fromISO(phase.dueDate), "days").days)),
      });
    }
  }

  return {
    total: projects.length,
    open: projects.filter((p) => p.status !== "DONE").length,
    atRisk: atRiskProjects.length,
    createdInRange,
    completedInRange,
    byStatus: PROJECT_STATUSES.map((status) => ({
      status,
      label: PROJECT_STATUS_LABELS[status],
      count: byStatus.get(status) ?? 0,
    })),
    atRiskProjects: atRiskProjects.slice(0, 15),
    delayedPhases: delayedPhases.sort((a, b) => b.daysLate - a.daysLate).slice(0, 15),
  };
}

// ── Work Plans ───────────────────────────────────────────────────────────

type PlanRow = {
  id: string;
  status: string;
  approvalLevels: unknown;
  createdAt: Date;
  companyTeamId: string | null;
  createdByAgentId: string | null;
};

export type WorkPlanWorkReport = {
  submittedInRange: number;
  outcomes: Array<{ status: string; label: string; count: number }>;
  pendingNow: number;
  pendingByLevel: Array<{ label: string; count: number }>;
  medianCycleHours: number | null;
  cycleBasis: number;
};

const PLAN_STATUS_LABELS: Record<string, string> = {
  [TRAVEL_ORDER_STATUS.SUBMITTED]: "Pending approval",
  [TRAVEL_ORDER_STATUS.APPROVED]: "Approved (running)",
  [TRAVEL_ORDER_STATUS.CONFIRMED]: "Confirmed",
  [TRAVEL_ORDER_STATUS.REJECTED]: "Declined",
  [TRAVEL_ORDER_STATUS.CANCELLED]: "Cancelled",
};

async function loadVisiblePlans(session: Session, viewer: ReportViewer): Promise<PlanRow[]> {
  const perms = await resolveOpsPermissions(session);
  const select = {
    id: true,
    status: true,
    approvalLevels: true,
    createdAt: true,
    companyTeamId: true,
    createdByAgentId: true,
  } as const;
  if (viewer.global) {
    return prisma.travelOrder.findMany({
      where: viewer.companyFilterId ? { companyTeamId: viewer.companyFilterId } : {},
      select,
    });
  }
  if (perms.canAssignWork) {
    // Company admins report on every plan in the current company.
    return prisma.travelOrder.findMany({
      where: { companyTeamId: viewer.companyFilterId ?? "__none__" },
      select,
    });
  }
  // Personnel: same stakeholder visibility as Work → Work Plans.
  const rows = await findTravelOrdersVisibleToAgent({
    companyTeamId: viewer.companyFilterId,
    agentId: perms.operator?.id ?? null,
  });
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    approvalLevels: r.approvalLevels,
    createdAt: r.createdAt,
    companyTeamId: r.companyTeamId,
    createdByAgentId: r.createdByAgentId,
  }));
}

export async function loadWorkPlanWorkReport(input: WorkReportInput): Promise<WorkPlanWorkReport> {
  const { session, viewer, range, teamAgentIds } = input;
  const plans = (await loadVisiblePlans(session, viewer)).filter(
    (p) => !teamAgentIds || (p.createdByAgentId != null && teamAgentIds.has(p.createdByAgentId)),
  );

  const outcomeCounts = new Map<string, number>();
  const pendingByLevel = new Map<string, number>();
  const cycleHours: number[] = [];
  let submittedInRange = 0;
  let pendingNow = 0;

  for (const plan of plans) {
    const levels = parseApprovalLevels(plan.approvalLevels).sort((a, b) => a.level - b.level);
    if (plan.status === TRAVEL_ORDER_STATUS.SUBMITTED) {
      pendingNow += 1;
      const waiting = levels.find((l) => !l.approvedAt && !l.optional);
      const label = waiting
        ? waiting.label?.trim() || `Level ${waiting.level}`
        : levels.length === 0
          ? "Designated approvers"
          : "Final approval";
      pendingByLevel.set(label, (pendingByLevel.get(label) ?? 0) + 1);
    }
    if (!inRange(plan.createdAt, range)) continue;
    submittedInRange += 1;
    outcomeCounts.set(plan.status, (outcomeCounts.get(plan.status) ?? 0) + 1);
    const approved =
      plan.status === TRAVEL_ORDER_STATUS.APPROVED || plan.status === TRAVEL_ORDER_STATUS.CONFIRMED;
    const stamps = levels
      .map((l) => (l.approvedAt ? new Date(l.approvedAt) : null))
      .filter((d): d is Date => d != null && Number.isFinite(d.getTime()));
    if (approved && stamps.length > 0) {
      const finalApproval = new Date(Math.max(...stamps.map((d) => d.getTime())));
      cycleHours.push(hoursBetween(finalApproval, plan.createdAt));
    }
  }

  return {
    submittedInRange,
    outcomes: Object.values(TRAVEL_ORDER_STATUS).map((status) => ({
      status,
      label: PLAN_STATUS_LABELS[status] ?? status,
      count: outcomeCounts.get(status) ?? 0,
    })),
    pendingNow,
    pendingByLevel: [...pendingByLevel.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count),
    medianCycleHours: median(cycleHours),
    cycleBasis: cycleHours.length,
  };
}
