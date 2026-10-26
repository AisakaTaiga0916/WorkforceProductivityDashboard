import { isElevatedUserRole } from "@/modules/platform/auth";
import { DEFAULT_TIME_ZONE } from "@/modules/tasks/kpi-recurrence";
import { taskKanbanDerivedStatus } from "@/modules/tasks/kpi-cycle-state";
import { kpiMainTaskLabel } from "@/modules/tasks/kpi-main-task";
import {
  itProjectChecklistProgressFromRaw,
  usesProjectTimelineTracker,
} from "@/modules/tasks/it-project-subkpis";
import { isItProjectImplementationPillar } from "@/modules/tasks/it-task-pillar-titles";
import {
  hasSubKpiAssignedTo,
  isProjectTask,
  kpiChecklistProgress,
  taskUsesInvertedRecording,
} from "@/modules/tasks/kpi-subkpis";
import { prisma } from "@/modules/platform/db/prisma";
import { findSessionAgentId } from "@/lib/session-agent";
import { loadAgentIdsForCompanyTeam, resolveStaffCompanyTeamId } from "@/modules/platform/scope/staff-company-scope";
import {
  kpiRowInSectionAgentScope,
  resolveViewerOrgChartSectionScope,
  roleUsesOrgChartSectionBoardScope,
} from "@/modules/platform/scope/org-chart-section-scope";
import { isTaskCompletionVerificationEnabled } from "@/modules/platform/settings/task-verification-settings-db";
import { isCompletionEffectivelyVerified } from "@/modules/tasks/task-completion-verification";
import type { Prisma } from "@prisma/client/primary";

export type TaskBoardLaneCounts = {
  current: number;
  done: number;
  delayed: number;
};

function isTimelineBoardRecord(record: { title?: string | null; subKpis?: unknown }): boolean {
  return (
    isItProjectImplementationPillar(String(record.title ?? "")) ||
    usesProjectTimelineTracker(record.subKpis)
  );
}

function progressForRow(
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

export type TaskBoardLane = "CURRENT" | "DONE" | "DELAYED";

const LANE_ROW_SELECT = {
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
  scopedCompanyTeamId: true,
  createdAt: true,
} satisfies Prisma.KpiMaintenanceSelect;

export type TaskBoardLaneRow = Prisma.KpiMaintenanceGetPayload<{ select: typeof LANE_ROW_SELECT }> & {
  /** Task Board lane (PENDING_VERIFICATION folds into CURRENT, like the board). */
  lane: TaskBoardLane;
  /** Legacy project rows still on the task board until the projects cutover. */
  isTimelineProject: boolean;
};

async function companyScopeWhere(companyTeamId: string): Promise<Prisma.KpiMaintenanceWhereInput> {
  const agentIds = await loadAgentIdsForCompanyTeam(companyTeamId);
  const companyScopeOr: Prisma.KpiMaintenanceWhereInput[] = [
    { assignedAgentId: null, scopedCompanyTeamId: companyTeamId },
  ];
  if (agentIds.length > 0) {
    companyScopeOr.unshift({ assignedAgentId: { in: agentIds } });
  }
  return { OR: companyScopeOr };
}

/**
 * Task Board cards with their derived lane, scoped like the agent task board
 * for the signed-in role. Shared by lane counts and Work → Reports (Tasks).
 */
export async function loadTaskBoardLaneRows(input: {
  role: string;
  email: string | null | undefined;
  name: string | null | undefined;
  /** Viewer's current company (switcher); falls back to the person's default company. */
  companyTeamId?: string | null;
  /** Global viewers only: restrict to one company (report filter). */
  globalCompanyTeamId?: string | null;
  timeZone?: string;
}): Promise<TaskBoardLaneRow[]> {
  const isSuperAdmin = isElevatedUserRole(input.role);
  const isPersonnel = input.role === "Personnel";
  const operator = await findSessionAgentId({ email: input.email, name: input.name });
  const timeZone = input.timeZone?.trim() || DEFAULT_TIME_ZONE;
  const nowMs = Date.now();

  let where: Prisma.KpiMaintenanceWhereInput = {};
  let sectionAgentIdSet: Set<string> | null = null;

  if (roleUsesOrgChartSectionBoardScope(input.role) && !isPersonnel) {
    const sectionScope = await resolveViewerOrgChartSectionScope(input.email);
    if (sectionScope.agentIds.length === 0) return [];
    sectionAgentIdSet = new Set(sectionScope.agentIds);
    where = { assignedAgentId: { in: sectionScope.agentIds } };
  } else if (!isSuperAdmin && !isPersonnel) {
    const scopedCompanyTeamId =
      input.companyTeamId !== undefined
        ? input.companyTeamId
        : await resolveStaffCompanyTeamId(input.email);
    if (!scopedCompanyTeamId) return [];
    where = await companyScopeWhere(scopedCompanyTeamId);
  } else if (isSuperAdmin && input.globalCompanyTeamId) {
    where = await companyScopeWhere(input.globalCompanyTeamId);
  }

  let rows = await prisma.kpiMaintenance.findMany({ where, select: LANE_ROW_SELECT });

  if (sectionAgentIdSet) {
    rows = rows.filter((row) => kpiRowInSectionAgentScope(row, sectionAgentIdSet!));
  }

  if (isPersonnel) {
    if (!operator?.id) return [];
    const { kpiIdsWhereAgentIsTravelOrderTraveler } = await import("@/modules/work-plans/travel-order-db");
    const travelerKpiIds = await kpiIdsWhereAgentIsTravelOrderTraveler(operator.id);
    rows = rows.filter(
      (row) =>
        row.assignedAgentId === operator.id ||
        hasSubKpiAssignedTo(row.subKpis, operator.id) ||
        travelerKpiIds.has(row.id),
    );
  }

  const verificationEnabled = await isTaskCompletionVerificationEnabled();
  return rows.map((row) => {
    const p = progressForRow(row, verificationEnabled);
    const timeline = isTimelineBoardRecord(row);
    const inverted = taskUsesInvertedRecording({ title: row.title, subKpis: row.subKpis });
    // Inverted recording stays in Current (monitoring); only non-recurring delay can move it.
    const status =
      inverted && !timeline
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
    const lane: TaskBoardLane =
      status === "DONE" ? "DONE" : status === "DELAYED" ? "DELAYED" : "CURRENT";
    return { ...row, lane, isTimelineProject: timeline || isProjectTask(row.subKpis) };
  });
}

/**
 * Count Task Board cards in Current / Done / Delayed for the sidebar widget,
 * scoped like the agent task board for the signed-in role.
 */
export async function countTaskBoardLanes(input: {
  role: string;
  email: string | null | undefined;
  name: string | null | undefined;
  /** Viewer's current company (switcher); falls back to the person's default company. */
  companyTeamId?: string | null;
  timeZone?: string;
}): Promise<TaskBoardLaneCounts> {
  const rows = await loadTaskBoardLaneRows(input);
  const counts: TaskBoardLaneCounts = { current: 0, done: 0, delayed: 0 };
  for (const row of rows) {
    if (row.lane === "DONE") counts.done += 1;
    else if (row.lane === "DELAYED") counts.delayed += 1;
    else counts.current += 1;
  }
  return counts;
}
