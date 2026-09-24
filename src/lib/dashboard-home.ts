import type { Session } from "next-auth";
import type { Prisma, TicketPriority, TicketStatus } from "@prisma/client/primary";
import { isElevatedUserRole } from "@/lib/auth";
import { ACTIVE_REQUEST_STATUSES, OPEN_PIPELINE_STATUSES } from "@/lib/active-request-statuses";
import { prisma } from "@/lib/prisma";
import { findSessionAgentId } from "@/lib/session-agent";
import { getTicketSlaState } from "@/lib/sla";
import {
  loadTicketBoardLaneEnteredAtMap,
  loadTicketForConfirmationEnteredAtMap,
  loadTicketLastActivityAtMap,
} from "@/lib/request-board-columns";
import { resolveStaffCompanyTeamId } from "@/lib/staff-company-scope";
import {
  resolveViewerDepartmentScopeLabel,
  sectionScopedTicketWhere,
} from "@/lib/org-chart-section-scope";
import { countTaskBoardLanes } from "@/lib/task-board-lane-counts";
import {
  listPendingTravelApprovalsForAgent,
  listPendingTravelConfirmationsForAgent,
} from "@/lib/travel-order-db";
import { requestTypeAcronym } from "@/lib/request-types";
import { formatTicketStatusLabel } from "@/lib/ticket-status-label";
import { formatTicketPriorityLabel } from "@/lib/ticket-priority-label";
import { DEFAULT_TIME_ZONE } from "@/lib/kpi-recurrence";
import { taskKanbanDerivedStatus } from "@/lib/kpi-cycle-state";
import { kpiMainTaskLabel } from "@/lib/kpi-main-task";
import {
  hasSubKpiAssignedTo,
  isFieldAssignmentTask,
  isProjectTask,
  kpiChecklistProgress,
  taskUsesInvertedRecording,
} from "@/lib/kpi-subkpis";
import {
  itProjectChecklistProgressFromRaw,
  usesProjectTimelineTracker,
} from "@/lib/it-project-subkpis";
import { isItProjectImplementationPillar } from "@/lib/it-task-pillar-titles";
import { isCompletionEffectivelyVerified } from "@/lib/task-completion-verification";

export type DashboardActionItem = {
  id: string;
  kind: "ticket" | "travel_order" | "task" | "approval";
  title: string;
  subtitle?: string;
  href: string;
  status?: string;
  badge?: string;
  slaState?: "ON_TRACK" | "AT_RISK" | "BREACHED";
  priority?: string;
  updatedAt: string;
};

export type DashboardActivityItem = {
  id: string;
  ticketNumber: string;
  title: string;
  summary: string;
  createdAt: string;
  href: string;
};

export type DashboardSummary = {
  open: number;
  inProgress: number;
  forConfirmation: number;
  closed: number;
  unassigned: number;
  slaBreached: number;
  slaAtRisk: number;
  tasksDelayed: number;
  pendingApprovals: number;
  escalated: number;
  avgResponseMinutes: number;
  resolutionRate: number;
};

export type StaffDashboardHome = {
  greeting: string;
  scopeLabel: string;
  isAdminView: boolean;
  isPersonnelView: boolean;
  summary: DashboardSummary;
  needsAction: DashboardActionItem[];
  assignedPreview: DashboardActionItem[];
  overdueItems: DashboardActionItem[];
  recentActivity: DashboardActivityItem[];
};

function minsBetween(a: Date, b: Date) {
  return Math.max(0, (a.getTime() - b.getTime()) / 60000);
}

async function resolveTicketScope(session: Session): Promise<{
  ticketScope: Prisma.TicketWhereInput;
  scopedCompanyTeamId: string | null;
  scopedCompanyName: string | null;
  departmentScopeLabel: string | null;
  personnelAgentId: string | null;
  isSuperAdmin: boolean;
  isPersonnel: boolean;
  isAdminView: boolean;
}> {
  const user = session.user;
  const isElevated = isElevatedUserRole(user.role);
  const isPersonnel = user.role === "Personnel";
  const isAdminView = isElevated || user.role === "Admin";
  const usesSectionBoardScope =
    user.role === "Admin" || user.role === "HighAdmin" || user.role === "Personnel";
  const personnelAgent = usesSectionBoardScope
    ? await findSessionAgentId({ email: user.email, name: user.name })
    : null;

  let ticketScope: Prisma.TicketWhereInput;
  let scopedCompanyTeamId: string | null = null;
  let departmentScopeLabel: string | null = null;

  if (user.role === "SuperAdmin") {
    ticketScope = {};
  } else if (usesSectionBoardScope) {
    ticketScope = await sectionScopedTicketWhere({
      email: user.email,
      agentId: personnelAgent?.id,
    });
    departmentScopeLabel = await resolveViewerDepartmentScopeLabel(user.email);
    scopedCompanyTeamId = await resolveStaffCompanyTeamId(user.email);
  } else {
    scopedCompanyTeamId = await resolveStaffCompanyTeamId(user.email);
    ticketScope = { teamId: scopedCompanyTeamId ?? "__none__" };
  }

  const scopedCompanyName =
    user.role !== "SuperAdmin" && scopedCompanyTeamId
      ? (
          await prisma.team.findUnique({
            where: { id: scopedCompanyTeamId },
            select: { name: true },
          })
        )?.name ?? null
      : null;

  return {
    ticketScope,
    scopedCompanyTeamId,
    scopedCompanyName,
    departmentScopeLabel,
    personnelAgentId: personnelAgent?.id ?? null,
    isSuperAdmin: isElevated,
    isPersonnel,
    isAdminView,
  };
}

function ticketToActionItem(row: {
  id: string;
  ticketNumber: string;
  title: string;
  status: TicketStatus;
  priority: TicketPriority;
  requestType: string | null;
  updatedAt: Date;
  contactName: string;
  boardLaneEnteredAt?: Date | null;
  resolutionDueAt: Date;
  firstResponseAt: Date | null;
  firstResponseDueAt: Date;
}): DashboardActionItem {
  const slaState = getTicketSlaState(row as Parameters<typeof getTicketSlaState>[0]);
  return {
    id: row.id,
    kind: "ticket",
    title: row.title?.trim() || row.ticketNumber,
    subtitle: `${row.ticketNumber} · ${row.contactName}`,
    href: `/agent/tickets/${row.id}`,
    status: formatTicketStatusLabel(row.status),
    badge: requestTypeAcronym(row.requestType),
    slaState,
    priority: formatTicketPriorityLabel(row.priority),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function isTimelineBoardRecord(record: { title?: string | null; subKpis?: unknown }): boolean {
  return (
    isItProjectImplementationPillar(String(record.title ?? "")) ||
    usesProjectTimelineTracker(record.subKpis)
  );
}

function taskProgressForDashboard(
  row: {
    title: string;
    mainTask: string | null;
    subKpis: unknown;
    completionVerificationStatus?: string | null;
    lastFullCompletionAt?: Date | string | null;
  },
  verificationEnabled: boolean,
): { total: number; done: number } {
  if (isTimelineBoardRecord(row)) {
    return itProjectChecklistProgressFromRaw(row.subKpis);
  }
  return kpiChecklistProgress(row.subKpis, kpiMainTaskLabel(row), {
    parentCardEffectivelyVerified: isCompletionEffectivelyVerified(row),
    verificationEnabled,
  });
}

/** Task Board cards assigned to (or visible as work for) this agent — Pending and Done. */
async function listTasksAssignedToAgent(
  agentId: string,
  take = 8,
): Promise<DashboardActionItem[]> {
  const { kpiIdsWhereAgentIsTravelOrderTraveler } = await import("@/lib/travel-order-db");
  const { kpiIdsWhereAgentIsJobOrderWorker } = await import("@/lib/job-order-workers-server");
  const { isTaskCompletionVerificationEnabled } = await import(
    "@/lib/task-verification-settings-db"
  );
  const [travelerKpiIds, jobOrderWorkerKpiIds, rows, verificationEnabled] = await Promise.all([
    kpiIdsWhereAgentIsTravelOrderTraveler(agentId),
    kpiIdsWhereAgentIsJobOrderWorker(agentId),
    prisma.kpiMaintenance.findMany({
      select: {
        id: true,
        title: true,
        mainTask: true,
        frequency: true,
        subKpis: true,
        isRecurring: true,
        recurrenceWeekday: true,
        recurrenceMonthDay: true,
        periodCycleStartAt: true,
        nonRecurringEndAt: true,
        assignedAgentId: true,
        completionVerificationStatus: true,
        lastFullCompletionAt: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: "desc" },
      take: 120,
    }),
    isTaskCompletionVerificationEnabled(),
  ]);

  const nowMs = Date.now();
  const timeZone = DEFAULT_TIME_ZONE;
  const pending: DashboardActionItem[] = [];
  const done: DashboardActionItem[] = [];

  for (const row of rows) {
    const assigned =
      row.assignedAgentId === agentId ||
      hasSubKpiAssignedTo(row.subKpis, agentId) ||
      travelerKpiIds.has(row.id) ||
      jobOrderWorkerKpiIds.has(row.id);
    if (!assigned) continue;

    const p = taskProgressForDashboard(row, verificationEnabled);
    const inverted = taskUsesInvertedRecording({ title: row.title, subKpis: row.subKpis });
    const lane =
      inverted && !isTimelineBoardRecord(row)
        ? taskKanbanDerivedStatus(row, {
            total: p.total,
            done: 0,
            nowMs,
            timeZone,
            verificationEnabled,
          }) === "DELAYED"
          ? "DELAYED"
          : "CURRENT"
        : taskKanbanDerivedStatus(row, {
            total: p.total,
            done: p.done,
            nowMs,
            timeZone,
            verificationEnabled,
          });

    const badge = isFieldAssignmentTask(row.subKpis)
      ? "Field"
      : isProjectTask(row.subKpis)
        ? "Project"
        : "Task";
    const label = kpiMainTaskLabel(row);
    const pillar = row.title.trim();
    const isDone = lane === "DONE";
    const item: DashboardActionItem = {
      id: row.id,
      kind: "task",
      title: label || pillar || "Task",
      subtitle: pillar && pillar.toLowerCase() !== label.toLowerCase() ? pillar : undefined,
      href: `/agent/tasks?task=${encodeURIComponent(row.id)}`,
      status: isDone ? "Done" : "Pending",
      badge,
      updatedAt: row.updatedAt.toISOString(),
    };
    if (isDone) done.push(item);
    else pending.push(item);
  }

  return [...pending, ...done].slice(0, take);
}

export async function loadStaffDashboardHome(session: Session): Promise<StaffDashboardHome> {
  const user = session.user;
  const now = new Date();
  const firstName = user.name?.split(" ")[0] ?? "there";

  const ctx = await resolveTicketScope(session);
  const {
    ticketScope,
    personnelAgentId,
    isSuperAdmin,
    isPersonnel,
    isAdminView,
    scopedCompanyName,
    departmentScopeLabel,
  } = ctx;

  const activeWhere: Prisma.TicketWhereInput = {
    status: { in: ACTIVE_REQUEST_STATUSES },
    ...ticketScope,
  };
  const pipelineWhere: Prisma.TicketWhereInput = {
    status: { in: [...OPEN_PIPELINE_STATUSES, "ESCALATED"] },
    ...ticketScope,
  };
  /** Overdue dwell applies to every Request Board lane, including For confirmation. */
  const boardLaneWhere: Prisma.TicketWhereInput = {
    status: { in: ACTIVE_REQUEST_STATUSES },
    ...ticketScope,
  };
  const unassignedWhere: Prisma.TicketWhereInput = isAdminView
    ? {
        assignedAgentId: null,
        status: { in: [...OPEN_PIPELINE_STATUSES, "ESCALATED"] },
        ...ticketScope,
      }
    : { id: "__none__" };

  const countStatus = (status: TicketStatus | TicketStatus[]) =>
    prisma.ticket.count({
      where: {
        status: Array.isArray(status) ? { in: status } : status,
        ...ticketScope,
      },
    });

  const [
    open,
    inProgress,
    forConfirmation,
    closed,
    unassigned,
    escalated,
    firstResponses,
    totalTickets,
    resolvedClosed,
    taskLanes,
    pipelineTicketsRaw,
    boardLaneCandidates,
    recentActivities,
    pendingTravelApprovals,
    pendingTravelConfirmations,
    accountRequestsPending,
    tasksAssignedToMe,
  ] = await Promise.all([
    countStatus("OPEN"),
    countStatus(["IN_PROGRESS", "PENDING_INFO", "ESCALATED"]),
    countStatus(["FOR_CONFIRMATION", "RESOLVED"]),
    countStatus("CLOSED"),
    prisma.ticket.count({ where: unassignedWhere }),
    countStatus("ESCALATED"),
    prisma.ticket.findMany({
      where: { firstResponseAt: { not: null }, ...ticketScope },
      select: { createdAt: true, firstResponseAt: true },
      take: 60,
      orderBy: { updatedAt: "desc" },
    }),
    prisma.ticket.count({ where: ticketScope }),
    prisma.ticket.count({
      where: { status: { in: ["FOR_CONFIRMATION", "RESOLVED", "CLOSED"] }, ...ticketScope },
    }),
    countTaskBoardLanes({
      role: user.role ?? "Personnel",
      email: user.email,
      name: user.name,
    }),
    prisma.ticket.findMany({
      where: pipelineWhere,
      orderBy: { updatedAt: "desc" },
      take: isPersonnel ? 12 : 8,
      select: {
        id: true,
        ticketNumber: true,
        title: true,
        status: true,
        priority: true,
        requestType: true,
        updatedAt: true,
        createdAt: true,
        resolvedAt: true,
        contactName: true,
        assignedAgentId: true,
        resolutionDueAt: true,
        firstResponseAt: true,
        firstResponseDueAt: true,
      },
    }),
    prisma.ticket.findMany({
      where: boardLaneWhere,
      select: {
        id: true,
        ticketNumber: true,
        title: true,
        status: true,
        priority: true,
        requestType: true,
        updatedAt: true,
        createdAt: true,
        resolvedAt: true,
        contactName: true,
        resolutionDueAt: true,
        firstResponseAt: true,
        firstResponseDueAt: true,
      },
      // Cap so we can evaluate 24h dwell without Prisma Client needing the new column.
      take: 500,
      orderBy: { updatedAt: "asc" },
    }),
    prisma.ticketActivity.findMany({
      where: { ticket: ticketScope },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: {
        id: true,
        summary: true,
        createdAt: true,
        ticket: { select: { id: true, ticketNumber: true, title: true } },
      },
    }),
    personnelAgentId
      ? listPendingTravelApprovalsForAgent(personnelAgentId).catch(() => [])
      : Promise.resolve([]),
    personnelAgentId
      ? listPendingTravelConfirmationsForAgent(personnelAgentId).catch(() => [])
      : Promise.resolve([]),
    isAdminView
      ? prisma.accountActionRequest.count({ where: { status: "PENDING" } })
      : Promise.resolve(0),
    isPersonnel && personnelAgentId
      ? listTasksAssignedToAgent(personnelAgentId, 8)
      : Promise.resolve([] as DashboardActionItem[]),
  ]);

  const candidateIds = [
    ...pipelineTicketsRaw.map((t) => t.id),
    ...boardLaneCandidates.map((t) => t.id),
  ];
  const [laneEnteredById, lastActivityById, forConfirmationById] = await Promise.all([
    loadTicketBoardLaneEnteredAtMap(candidateIds),
    loadTicketLastActivityAtMap(candidateIds),
    loadTicketForConfirmationEnteredAtMap(candidateIds),
  ]);

  const withOverdueFields = <
    T extends {
      id: string;
      status: TicketStatus;
      requestType?: string | null;
      updatedAt: Date;
      createdAt?: Date;
      resolvedAt?: Date | null;
    },
  >(
    row: T,
  ) => ({
    ...row,
    boardLaneEnteredAt: laneEnteredById.get(row.id) ?? row.updatedAt,
    lastActivityAt: lastActivityById.get(row.id) ?? null,
    forConfirmationAt:
      forConfirmationById.get(row.id) ??
      (row.status === "FOR_CONFIRMATION" ? (row.resolvedAt ?? laneEnteredById.get(row.id) ?? null) : null),
  });

  const pipelineTickets = pipelineTicketsRaw.map(withOverdueFields);

  let slaBreached = 0;
  let slaAtRisk = 0;
  const overdueCandidates: Array<{
    id: string;
    ticketNumber: string;
    title: string;
    status: TicketStatus;
    priority: TicketPriority;
    requestType: string | null;
    updatedAt: Date;
    createdAt: Date;
    resolvedAt: Date | null;
    contactName: string;
    resolutionDueAt: Date;
    firstResponseAt: Date | null;
    firstResponseDueAt: Date;
    boardLaneEnteredAt: Date;
    lastActivityAt: Date | null;
    forConfirmationAt: Date | null;
  }> = [];
  for (const row of boardLaneCandidates) {
    const enriched = withOverdueFields(row);
    const state = getTicketSlaState(enriched);
    if (state === "BREACHED") {
      slaBreached += 1;
      overdueCandidates.push(enriched);
    } else if (state === "AT_RISK") {
      slaAtRisk += 1;
      if (row.priority === "HIGH" || row.priority === "URGENT") {
        overdueCandidates.push(enriched);
      }
    }
  }
  overdueCandidates.sort((a, b) => {
    const aStart = (
      a.forConfirmationAt ??
      a.lastActivityAt ??
      a.boardLaneEnteredAt ??
      a.updatedAt
    ).getTime();
    const bStart = (
      b.forConfirmationAt ??
      b.lastActivityAt ??
      b.boardLaneEnteredAt ??
      b.updatedAt
    ).getTime();
    return aStart - bStart;
  });
  const overdueTickets = overdueCandidates.slice(0, 6);

  const avgResponseMinutes =
    firstResponses.length === 0
      ? 0
      : Math.round(
          firstResponses.reduce(
            (sum, row) => sum + minsBetween(row.firstResponseAt ?? row.createdAt, row.createdAt),
            0,
          ) / firstResponses.length,
        );

  const resolutionRate = totalTickets === 0 ? 0 : (resolvedClosed / totalTickets) * 100;
  const pendingApprovals =
    pendingTravelApprovals.length +
    pendingTravelConfirmations.length +
    (isAdminView ? accountRequestsPending : 0);

  const travelActions: DashboardActionItem[] = [
    ...pendingTravelApprovals.map((row) => ({
      id: `travel-approval-${row.id}`,
      kind: "travel_order" as const,
      title: row.orderRequest?.trim() || "Travel order approval",
      subtitle: row.kpiMainTask || row.kpiTitle || undefined,
      href: row.kpiMaintenanceId
        ? `/agent/tasks?task=${encodeURIComponent(row.kpiMaintenanceId)}`
        : "/agent/tasks",
      status: "Awaiting approval",
      badge: "T.O.",
      updatedAt: row.updatedAt?.toISOString?.() ?? now.toISOString(),
    })),
    ...pendingTravelConfirmations.map((row) => ({
      id: `travel-confirm-${row.id}`,
      kind: "travel_order" as const,
      title: row.orderRequest?.trim() || "Travel order confirmation",
      subtitle: row.kpiMainTask || row.kpiTitle || undefined,
      href: row.kpiMaintenanceId
        ? `/agent/tasks?task=${encodeURIComponent(row.kpiMaintenanceId)}`
        : "/agent/tasks",
      status: "Awaiting confirmation",
      badge: "T.O.",
      updatedAt: row.updatedAt?.toISOString?.() ?? now.toISOString(),
    })),
  ];

  const ticketActions = pipelineTickets.map(ticketToActionItem);
  const assignedPreview = isPersonnel
    ? ticketActions.filter((row) => pipelineTickets.find((t) => t.id === row.id)?.assignedAgentId === personnelAgentId)
    : ticketActions.slice(0, 5);

  const needsAction = [...travelActions, ...ticketActions]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 10);

  const scopeLabel = isPersonnel
    ? departmentScopeLabel
      ? `Your department · ${departmentScopeLabel}`
      : "Your assigned work"
    : isSuperAdmin
      ? "All companies"
      : departmentScopeLabel ?? scopedCompanyName ?? "Your assigned department";

  return {
    greeting: firstName,
    scopeLabel,
    isAdminView,
    isPersonnelView: isPersonnel,
    summary: {
      open,
      inProgress,
      forConfirmation,
      closed,
      unassigned,
      slaBreached,
      slaAtRisk,
      tasksDelayed: taskLanes.delayed,
      pendingApprovals,
      escalated,
      avgResponseMinutes,
      resolutionRate,
    },
    needsAction,
    assignedPreview: assignedPreview.slice(0, 6),
    overdueItems: isPersonnel ? tasksAssignedToMe : overdueTickets.map(ticketToActionItem),
    recentActivity: recentActivities.map((row) => ({
      id: row.id,
      ticketNumber: row.ticket.ticketNumber,
      title: row.ticket.title,
      summary: row.summary,
      createdAt: row.createdAt.toISOString(),
      href: `/agent/tickets/${row.ticket.id}`,
    })),
  };
}

export type CustomerStatusSummary = {
  open: number;
  inProgress: number;
  forConfirmation: number;
  closed: number;
};

export function summarizeCustomerTicketStatuses(
  statuses: TicketStatus[],
): CustomerStatusSummary {
  const summary: CustomerStatusSummary = {
    open: 0,
    inProgress: 0,
    forConfirmation: 0,
    closed: 0,
  };
  for (const status of statuses) {
    if (status === "OPEN") summary.open += 1;
    else if (status === "IN_PROGRESS" || status === "PENDING_INFO" || status === "ESCALATED") {
      summary.inProgress += 1;
    } else if (status === "FOR_CONFIRMATION" || status === "RESOLVED") {
      summary.forConfirmation += 1;
    } else if (status === "CLOSED") summary.closed += 1;
  }
  return summary;
}
