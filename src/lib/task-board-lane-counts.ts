import { isElevatedUserRole } from "@/lib/auth";
import { DEFAULT_TIME_ZONE } from "@/lib/kpi-recurrence";
import { taskKanbanDerivedStatus } from "@/lib/kpi-cycle-state";
import { kpiMainTaskLabel } from "@/lib/kpi-main-task";
import {
  itProjectChecklistProgressFromRaw,
  usesProjectTimelineTracker,
} from "@/lib/it-project-subkpis";
import { isItProjectImplementationPillar } from "@/lib/it-task-pillar-titles";
import {
  hasSubKpiAssignedTo,
  kpiChecklistProgress,
  taskUsesInvertedRecording,
} from "@/lib/kpi-subkpis";
import { prisma } from "@/lib/prisma";
import { findSessionAgentId } from "@/lib/session-agent";
import { loadAgentIdsForCompanyTeam, resolveStaffCompanyTeamId } from "@/lib/staff-company-scope";
import {
  kpiRowInSectionAgentScope,
  resolveViewerOrgChartSectionScope,
  roleUsesOrgChartSectionBoardScope,
} from "@/lib/org-chart-section-scope";
import { isTaskCompletionVerificationEnabled } from "@/lib/task-verification-settings-db";
import { isCompletionEffectivelyVerified } from "@/lib/task-completion-verification";
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

/**
 * Count Task Board cards in Current / Done / Delayed for the sidebar widget,
 * scoped like the agent task board for the signed-in role.
 */
export async function countTaskBoardLanes(input: {
  role: string;
  email: string | null | undefined;
  name: string | null | undefined;
  timeZone?: string;
}): Promise<TaskBoardLaneCounts> {
  const isSuperAdmin = isElevatedUserRole(input.role);
  const isPersonnel = input.role === "Personnel";
  const operator = await findSessionAgentId({ email: input.email, name: input.name });
  const timeZone = input.timeZone?.trim() || DEFAULT_TIME_ZONE;
  const nowMs = Date.now();

  let where: Prisma.KpiMaintenanceWhereInput = {};
  let sectionAgentIdSet: Set<string> | null = null;

  if (roleUsesOrgChartSectionBoardScope(input.role) && !isPersonnel) {
    const sectionScope = await resolveViewerOrgChartSectionScope(input.email);
    if (sectionScope.agentIds.length === 0) {
      return { current: 0, done: 0, delayed: 0 };
    }
    sectionAgentIdSet = new Set(sectionScope.agentIds);
    where = { assignedAgentId: { in: sectionScope.agentIds } };
  } else if (!isSuperAdmin && !isPersonnel) {
    const scopedCompanyTeamId = await resolveStaffCompanyTeamId(input.email);
    if (!scopedCompanyTeamId) {
      return { current: 0, done: 0, delayed: 0 };
    }
    const agentIds = await loadAgentIdsForCompanyTeam(scopedCompanyTeamId);
    const companyScopeOr: Prisma.KpiMaintenanceWhereInput[] = [
      { assignedAgentId: null, scopedCompanyTeamId },
    ];
    if (agentIds.length > 0) {
      companyScopeOr.unshift({ assignedAgentId: { in: agentIds } });
    }
    where = { OR: companyScopeOr };
  }

  let rows = await prisma.kpiMaintenance.findMany({
    where,
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
    },
  });

  if (sectionAgentIdSet) {
    rows = rows.filter((row) => kpiRowInSectionAgentScope(row, sectionAgentIdSet!));
  }

  if (isPersonnel) {
    if (!operator?.id) return { current: 0, done: 0, delayed: 0 };
    const { kpiIdsWhereAgentIsTravelOrderTraveler } = await import("@/lib/travel-order-db");
    const { kpiIdsWhereAgentIsJobOrderWorker } = await import("@/lib/job-order-workers-server");
    const travelerKpiIds = await kpiIdsWhereAgentIsTravelOrderTraveler(operator.id);
    const jobOrderWorkerKpiIds = await kpiIdsWhereAgentIsJobOrderWorker(operator.id);
    rows = rows.filter(
      (row) =>
        row.assignedAgentId === operator.id ||
        hasSubKpiAssignedTo(row.subKpis, operator.id) ||
        travelerKpiIds.has(row.id) ||
        jobOrderWorkerKpiIds.has(row.id),
    );
  }

  let current = 0;
  let done = 0;
  let delayed = 0;
  const verificationEnabled = await isTaskCompletionVerificationEnabled();
  for (const row of rows) {
    const p = progressForRow(row, verificationEnabled);
    const inverted = taskUsesInvertedRecording({ title: row.title, subKpis: row.subKpis });
    // Inverted recording stays in Current (monitoring); only non-recurring delay can move it.
    const status =
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
    if (status === "DONE") done += 1;
    else if (status === "DELAYED") delayed += 1;
    else current += 1; // CURRENT + PENDING_VERIFICATION
  }

  return { current, done, delayed };
}
