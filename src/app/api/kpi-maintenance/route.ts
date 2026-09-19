import { isElevatedUserRole } from "@/lib/auth";
import { KpiFrequency, Prisma } from "@prisma/client/primary";
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/access";
import {
  nextRolloverEligibleAtUtc,
  recurringIncompleteRolloverEligibleAt,
  recurringIncompleteRolloverHoldDays,
} from "@/lib/kpi-cycle-state";
import { getPeriodStartInclusive } from "@/lib/kpi-period-window";
import {
  computePeriodKey,
  getPeriodEndExclusiveFromCycleStart,
  isLegacyPeriodKey,
  normalizeTimeZone,
  type KpiFrequencyCode,
} from "@/lib/kpi-recurrence";
import {
  applyPillarOnlyTaskCreate,
  collectAllSubKpiItems,
  collectChecklistProgressItems,
  getPillarScreenshots,
  getPillarCompletionRequirements,
  hasSubKpiAssignedTo,
  isPillarOnlyTask,
  pillarScreenshotUploadEnabled,
  pillarScreenshotsEnabled,
  type NormalizedSubKpis,
  type SubKpiItem,
  markEverySubKpiDone,
  normalizeSubKpis,
  removePillarScreenshot,
  removeSubKpiItemScreenshot,
  resetAllSubKpiDone,
  setPillarScreenshots,
  setSubKpiItemAssignee,
  setSubKpiItemsAssistanceRequested,
  setSubKpiItemDone,
  setSubKpiItemScreenshots,
  setSubKpiItemWorkMeta,
  setTaskCount,
  setTaskDailyPenaltyAmount,
  setTaskDelayPenaltyFrequency,
  setTaskTargetDueDate,
  setTaskPriority,
  syncScreenshotOnlySubKpiDone,
  syncSubKpiDoneFromRequirements,
  syncPillarDoneFromRequirements,
  subKpiAssignedToOperator,
  appendSubKpiItem,
  removeSubKpiItem,
  updateSubKpiItem,
  stripSubKpiStartDates,
  validateSegmentStructureForPersist,
  validateStructuredUpdate,
  wrapForPersist,
  wrapForPersistWithExistingMeta,
  markProjectTask,
  setInvertedRecording,
  setLinkedJobOrderOnSubKpis,
  canAdjustNumericalTarget,
  canMutateSubKpiAssignee,
  hasItemsInUnassignedSegment,
  invertedRecordingPeriodClear,
  taskUsesInvertedRecording,
} from "@/lib/kpi-subkpis";
import {
  applyPhaseDelayNotifications,
  buildItProjectFromPhaseDrafts,
  isItProjectEnvelope,
  itProjectActivePhase,
  itProjectAllItems,
  itProjectChecklistItems,
  parseItProjectSubKpis,
  seedJoLinkedProjectTimeline,
  setItProjectActivePhase,
  setItProjectSubKpiAssignee,
  setItProjectSubKpiItemsAssistanceRequested,
  setItProjectSubKpiDone,
  setItProjectSubKpiLifecycle,
  setItProjectSubKpiPenalty,
  setItProjectSubKpiProjectMeta,
  setItProjectSubKpiSchedule,
  setItProjectSubKpiTitle,
  syncAllPhaseDueDates,
  updateItProjectPhases,
  usesProjectTimelineTracker,
  validateItProjectPhaseDueConstraints,
  wrapItProjectSubKpis,
  moveItProjectSubKpiToPhase,
  setItProjectPhaseDueDate,
  isTimelineProjectKpi,
  type ItProjectData,
} from "@/lib/it-project-subkpis";
import { isItProjectImplementationPillar } from "@/lib/it-task-pillar-titles";
import { kpiRowInCompanyScope } from "@/lib/kpi-company-board-scope";
import {
  kpiRowInSectionAgentScope,
  resolveViewerOrgChartSectionScope,
  roleUsesCompanyDepartmentTaskAssignScope,
} from "@/lib/org-chart-section-scope";
import { isValidLatLng } from "@/lib/travel-order";
import { normalizeDelayPenaltyFrequency } from "@/lib/delay-penalty-frequency";
import { triggerEfficiencyRecomputeBackground } from "@/lib/efficiency/trigger-efficiency-recompute";
import { inferKpiPatchAudit, logKpiActivity } from "@/lib/kpi-activity";
import { kpiMainTaskLabel } from "@/lib/kpi-main-task";
import { isAgentOnDutyFromMergedDb } from "@/lib/load-on-duty-snapshot";
import { isTaskAssignmentOnDutyRequired } from "@/lib/workforce-view-visibility-db";
import { prisma } from "@/lib/prisma";
import { rosterTeamNameFilter } from "@/lib/company-roster";
import { portalCompanyAdminPrivilegesForEmail } from "@/lib/portal-staff";
import { timeZoneFromPeriodKey, upsertKpiPeriodSnapshot } from "@/lib/kpi-period-snapshots";
import { resolveOpsPermissions } from "@/lib/ops-permissions";
import { isPlatformSuperAdminPortalRole } from "@/lib/staff-role";
import {
  loadAgentIdsForCompanyTeam,
  resolveAgentDesignatedCompanyId,
  resolveStaffCompanyTeamId,
} from "@/lib/staff-company-scope";
import {
  hasBeforeAndAfterScreenshots,
  hasNumericalRecord,
  hasScreenshotUpload,
  normalizeCompletionRequirements,
  numericalRecordProgressPercent,
  resolveSubKpiCompletionMode,
  resolveSubKpiCompletionRequirements,
  subKpiRequiresCheckbox,
  subKpiRequiresNumerical,
  subKpiRequiresScreenshots,
  subKpiRequiresScreenshotUpload,
  subKpiRequirementsMet,
  subKpiStoredCompletionRequirements,
  isSubKpiCompletionMode,
  type SubKpiCompletionMode,
  type SubKpiCompletionRequirements,
} from "@/lib/sub-kpi-completion-mode";
import { MAX_TASK_SCREENSHOTS_PER_SLOT } from "@/lib/task-screenshot-constants";
import type { TaskScreenshotMetaItem, TaskScreenshotSlot } from "@/lib/task-screenshot-meta";
import {
  deleteTaskScreenshotsDir,
  persistTaskScreenshot,
  validateTaskScreenshotFile,
} from "@/lib/task-screenshots";

const allowedFrequencies = new Set(Object.values(KpiFrequency));

function checklistFullyComplete(subKpis: unknown, taskTitle?: string): boolean {
  // Segmented tasks cannot finalize while cards remain on Unassigned.
  if (hasItemsInUnassignedSegment(subKpis)) return false;
  const items = isItProjectEnvelope(subKpis)
    ? itProjectAllItems(parseItProjectSubKpis(subKpis))
    : collectChecklistProgressItems(subKpis, taskTitle);
  if (items.length === 0) return false;
  return items.every((x) => subKpiRequirementsMet(x));
}

function subKpiScreenshotsRequired(
  item: Pick<SubKpiItem, "completionRequirements" | "completionMode" | "screenshotsEnabled" | "beforeScreenshot" | "afterScreenshot">,
): boolean {
  return subKpiRequiresScreenshots(resolveSubKpiCompletionRequirements(item));
}

function subKpiScreenshotUploadRequired(
  item: Pick<SubKpiItem, "completionRequirements" | "completionMode" | "screenshotsEnabled" | "beforeScreenshot" | "afterScreenshot">,
): boolean {
  return subKpiRequiresScreenshotUpload(resolveSubKpiCompletionRequirements(item));
}

function subKpiScreenshotList(item: SubKpiItem, slot: TaskScreenshotSlot): TaskScreenshotMetaItem[] {
  if (slot === "before") return item.beforeScreenshot ?? [];
  if (slot === "after") return item.afterScreenshot ?? [];
  return item.uploadScreenshot ?? [];
}

/** Visible when the agent is the main assignee or any sub-task assignee. */
function kpiRowVisibleToAgent(
  row: { assignedAgentId: string | null; subKpis: unknown },
  agentId: string | null | undefined,
): boolean {
  const id = agentId?.trim();
  if (!id) return false;
  return row.assignedAgentId === id || hasSubKpiAssignedTo(row.subKpis, id);
}

/** Assignee / sub-assignee visibility, plus Field Assignments where the agent is a traveler or JO co-worker. */
function filterKpiRowsForViewer<T extends { id: string; assignedAgentId: string | null; subKpis: unknown }>(
  rows: T[],
  agentId: string | null | undefined,
  travelerKpiIds: Set<string>,
  jobOrderWorkerKpiIds: Set<string>,
): T[] {
  return rows.filter(
    (row) =>
      kpiRowVisibleToAgent(row, agentId) ||
      travelerKpiIds.has(row.id) ||
      jobOrderWorkerKpiIds.has(row.id),
  );
}

export async function GET(req: Request) {
  const { session, unauthorized } = await requireRole(["Admin", "Personnel"]);
  if (unauthorized || !session) return unauthorized;

  const { searchParams } = new URL(req.url);
  const timeZone = normalizeTimeZone(searchParams.get("tz"));

  const perms = await resolveOpsPermissions(session);
  let where: Prisma.KpiMaintenanceWhereInput = perms.canAssignWork ? {} : {};

  const companyTeamId = searchParams.get("company")?.trim();
  /** When set, company membership is applied in memory so sub-task assignees are included. */
  let companyAgentIdSet: Set<string> | null = null;
  let companyFilterId: string | null = null;
  if (perms.canAssignWork && companyTeamId && companyTeamId !== "ALL") {
    companyFilterId = companyTeamId;
    const agentIds = await loadAgentIdsForCompanyTeam(companyTeamId);
    companyAgentIdSet = new Set(agentIds);
  }

  // Assigned filter is applied in memory so sub-task assignees are included
  // (sub-assignee ids live in JSON, not assigned_agent_id).
  const assignedFilterId = searchParams.get("assigned")?.trim();
  const filterByAssigned =
    perms.canAssignWork && assignedFilterId && assignedFilterId !== "ALL" ? assignedFilterId : null;

  let rows = await prisma.kpiMaintenance.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      assignedAgent: { select: { id: true, name: true, team: { select: { id: true, name: true } } } },
    },
  });
  if (companyFilterId && companyAgentIdSet) {
    rows = rows.filter((row) =>
      kpiRowInCompanyScope(row, companyFilterId, companyAgentIdSet),
    );
  }

  // Admin / Personnel: only tasks assigned within the viewer's org-chart section tree.
  if (roleUsesCompanyDepartmentTaskAssignScope(session.user.role)) {
    const sectionScope = await resolveViewerOrgChartSectionScope(session.user.email);
    const sectionAgentIds = new Set(sectionScope.agentIds);
    if (perms.canAssignWork) {
      rows = rows.filter((row) => kpiRowInSectionAgentScope(row, sectionAgentIds));
    }
    // Personnel already filtered to self below; section membership is enforced by
    // only seeing their own assignments (they must be in the section to be assigned).
  }

  const {
    kpiIdsWhereAgentIsTravelOrderTraveler,
    kpiIdsWithTravelOrders,
    travelOrderBoardSummariesByKpiIds,
  } = await import("@/lib/travel-order-db");
  const { kpiIdsWhereAgentIsJobOrderWorker } = await import("@/lib/job-order-workers-server");

  const viewerAgentId = !perms.canAssignWork
    ? (perms.operator?.id ?? null)
    : filterByAssigned;
  const travelerKpiIds = viewerAgentId
    ? await kpiIdsWhereAgentIsTravelOrderTraveler(viewerAgentId)
    : new Set<string>();
  const jobOrderWorkerKpiIds = viewerAgentId
    ? await kpiIdsWhereAgentIsJobOrderWorker(viewerAgentId)
    : new Set<string>();

  if (!perms.canAssignWork) {
    rows = filterKpiRowsForViewer(rows, viewerAgentId, travelerKpiIds, jobOrderWorkerKpiIds);
  } else if (filterByAssigned) {
    rows = filterKpiRowsForViewer(rows, filterByAssigned, travelerKpiIds, jobOrderWorkerKpiIds);
  }

  const now = new Date();
  const updates: Promise<unknown>[] = [];

  for (const row of rows) {
    if (!row.isRecurring || isItProjectImplementationPillar(row.title)) {
      continue;
    }

    const freq = row.frequency as KpiFrequencyCode;
    const currentCycleStart = getPeriodStartInclusive(
      freq,
      row.recurrenceWeekday,
      row.recurrenceMonthDay,
      now,
      timeZone,
    );
    const anchor =
      row.periodCycleStartAt ??
      getPeriodStartInclusive(
        freq,
        row.recurrenceWeekday,
        row.recurrenceMonthDay,
        row.createdAt,
        timeZone,
      );

    const patch: Prisma.KpiMaintenanceUpdateManyMutationInput = {};
    const expectedKey = computePeriodKey(freq, row.recurrenceWeekday, row.recurrenceMonthDay, now, timeZone);

    if (!row.periodCycleStartAt) {
      patch.periodCycleStartAt = currentCycleStart;
    }

    if (row.periodKey == null || isLegacyPeriodKey(row.periodKey) || row.periodKey !== expectedKey) {
      patch.periodKey = expectedKey;
      patch.rolledOverIncomplete = false;
    }

    const taskLabel = kpiMainTaskLabel(row);
    const invert = taskUsesInvertedRecording({ title: row.title, subKpis: row.subKpis });
    const complete = invert
      ? invertedRecordingPeriodClear(
          { title: row.title, mainTask: row.mainTask, subKpis: row.subKpis },
          taskLabel,
        )
      : checklistFullyComplete(row.subKpis, taskLabel);
    const staleCycle = currentCycleStart.getTime() > anchor.getTime();
    if (staleCycle) {
      // Incomplete work stays Delayed after the cycle deadline before resetting — the 10-day
      // hold applies only to MONTHLY / QUARTERLY / SEMI_ANNUAL / YEARLY; DAILY / WEEKLY roll over at once.
      if (!complete) {
        const cycleDeadline = getPeriodEndExclusiveFromCycleStart(
          anchor,
          freq,
          row.recurrenceWeekday,
          row.recurrenceMonthDay,
          timeZone,
        );
        const holdUntil = recurringIncompleteRolloverEligibleAt(
          cycleDeadline,
          timeZone,
          recurringIncompleteRolloverHoldDays(freq),
        );
        if (now.getTime() < holdUntil.getTime()) {
          // Keep the open cycle on Delayed; do not advance periodKey / reset checklist yet.
          continue;
        }
      }
      const snapshotPeriodKey =
        row.periodKey && !isLegacyPeriodKey(row.periodKey)
          ? row.periodKey
          : computePeriodKey(freq, row.recurrenceWeekday, row.recurrenceMonthDay, anchor, timeZone);
      await upsertKpiPeriodSnapshot(
        {
          id: row.id,
          title: row.title,
          frequency: row.frequency,
          subKpis: row.subKpis,
          periodKey: row.periodKey,
          recurrenceWeekday: row.recurrenceWeekday,
          recurrenceMonthDay: row.recurrenceMonthDay,
          periodCycleStartAt: row.periodCycleStartAt,
          isRecurring: row.isRecurring,
          assignedAgent: row.assignedAgent
            ? { id: row.assignedAgent.id, name: row.assignedAgent.name }
            : null,
        },
        timeZone,
        anchor,
        snapshotPeriodKey,
      );
      patch.subKpis = resetAllSubKpiDone(row.subKpis, {
        frequency: freq,
        recurrenceWeekday: row.recurrenceWeekday,
        recurrenceMonthDay: row.recurrenceMonthDay,
        timeZone,
        fromCycleStart: anchor,
        toCycleStart: currentCycleStart,
      });
      patch.periodCycleStartAt = currentCycleStart;
      patch.periodKey = expectedKey;
      patch.lastFullCompletionAt = null;
      patch.rolledOverIncomplete = !complete;
    }

    const lastFull = row.lastFullCompletionAt;
    if (!staleCycle && complete && lastFull) {
      // WEEKLY/MONTHLY/QUARTERLY: eligible immediately on DONE.
      // DAILY: still waits until the next calendar day (see getRolloverEligibleAfterCompletion).
      const eligible = nextRolloverEligibleAtUtc(lastFull, timeZone, freq);
      if (eligible && now.getTime() >= eligible.getTime()) {
        await upsertKpiPeriodSnapshot(
          {
            id: row.id,
            title: row.title,
            frequency: row.frequency,
            subKpis: row.subKpis,
            periodKey: row.periodKey,
            recurrenceWeekday: row.recurrenceWeekday,
            recurrenceMonthDay: row.recurrenceMonthDay,
            periodCycleStartAt: row.periodCycleStartAt,
            isRecurring: row.isRecurring,
            assignedAgent: row.assignedAgent
              ? { id: row.assignedAgent.id, name: row.assignedAgent.name }
              : null,
          },
          timeZone,
          now,
        );
        const nextCycleStart = getPeriodEndExclusiveFromCycleStart(
          anchor,
          freq,
          row.recurrenceWeekday,
          row.recurrenceMonthDay,
          timeZone,
        );
        patch.subKpis = resetAllSubKpiDone(row.subKpis, {
          frequency: freq,
          recurrenceWeekday: row.recurrenceWeekday,
          recurrenceMonthDay: row.recurrenceMonthDay,
          timeZone,
          fromCycleStart: anchor,
          toCycleStart: nextCycleStart,
        });
        patch.periodCycleStartAt = nextCycleStart;
        patch.lastFullCompletionAt = null;
        patch.rolledOverIncomplete = false;
        patch.periodKey = computePeriodKey(freq, row.recurrenceWeekday, row.recurrenceMonthDay, nextCycleStart, timeZone);
      }
    }

    if (Object.keys(patch).length > 0) {
      // Conditional update: skip if another concurrent GET already rolled this row.
      updates.push(
        prisma.kpiMaintenance.updateMany({
          where: {
            id: row.id,
            periodKey: row.periodKey,
            periodCycleStartAt: row.periodCycleStartAt,
            lastFullCompletionAt: row.lastFullCompletionAt,
          },
          data: patch,
        }),
      );
    }
  }

  if (updates.length > 0) {
    await Promise.all(updates);
    rows = await prisma.kpiMaintenance.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        assignedAgent: { select: { id: true, name: true, team: { select: { id: true, name: true } } } },
      },
    });
    if (companyFilterId && companyAgentIdSet) {
      rows = rows.filter((row) =>
        kpiRowInCompanyScope(row, companyFilterId, companyAgentIdSet),
      );
    }
    if (!perms.canAssignWork) {
      rows = filterKpiRowsForViewer(rows, viewerAgentId, travelerKpiIds, jobOrderWorkerKpiIds);
    } else if (filterByAssigned) {
      rows = filterKpiRowsForViewer(rows, filterByAssigned, travelerKpiIds, jobOrderWorkerKpiIds);
    }
  }

  // Archive completed non-recurring tasks when the next calendar day has passed
  const archivedRowIds = new Set<string>();
  for (const row of rows) {
    if (row.isRecurring !== false || isItProjectImplementationPillar(row.title)) continue;
    if (!row.assignedAgentId) continue;
    if (!row.lastFullCompletionAt) continue;
    const complete = checklistFullyComplete(row.subKpis, kpiMainTaskLabel(row));
    if (!complete) continue;
    const eligible = nextRolloverEligibleAtUtc(row.lastFullCompletionAt, timeZone);
    if (!eligible || now.getTime() < eligible.getTime()) continue;
    // Take a period snapshot to archive the completed state
    await upsertKpiPeriodSnapshot(
      {
        id: row.id,
        title: row.title,
        frequency: row.frequency,
        subKpis: row.subKpis,
        periodKey: row.periodKey,
        recurrenceWeekday: row.recurrenceWeekday,
        recurrenceMonthDay: row.recurrenceMonthDay,
        periodCycleStartAt: row.periodCycleStartAt,
        isRecurring: false,
        assignedAgent: row.assignedAgent
          ? { id: row.assignedAgent.id, name: row.assignedAgent.name }
          : null,
      },
      timeZone,
      row.lastFullCompletionAt,
    );
    archivedRowIds.add(row.id);
  }
  if (archivedRowIds.size > 0) {
    rows = rows.filter((r) => !archivedRowIds.has(r.id));
  }

  const { isFieldAssignmentTask, getLinkedJobOrderFromSubKpis } = await import("@/lib/kpi-subkpis");
  const { loadJobOrdersLinkedToProjects } = await import("@/lib/job-order-project");
  const kpiIdList = rows.map((r) => r.id);
  const [fieldAssignmentIds, travelSummaries] = await Promise.all([
    kpiIdsWithTravelOrders(kpiIdList),
    travelOrderBoardSummariesByKpiIds(kpiIdList),
  ]);

  const linkedJobOrders = await loadJobOrdersLinkedToProjects(rows.map((r) => r.id));
  const linkedByProjectId = new Map<string, Array<{ id: string; ticketNumber: string; title: string }>>();
  for (const jo of linkedJobOrders) {
    const projectId = jo.linkedKpiMaintenanceId;
    if (!projectId) continue;
    const list = linkedByProjectId.get(projectId) ?? [];
    list.push({ id: jo.id, ticketNumber: jo.ticketNumber, title: jo.title });
    linkedByProjectId.set(projectId, list);
  }

  return NextResponse.json({
    rows: rows.map((r) => {
      const fromDb = linkedByProjectId.get(r.id) ?? [];
      const fromEnvelope = getLinkedJobOrderFromSubKpis(r.subKpis);
      const linkedJobOrdersForRow =
        fromDb.length > 0
          ? fromDb
          : fromEnvelope
            ? [
                {
                  id: fromEnvelope.ticketId,
                  ticketNumber: fromEnvelope.ticketNumber ?? "J.O.",
                  title: "Linked Job Order",
                },
              ]
            : [];
      const travelSummary = travelSummaries.get(r.id) ?? null;
      return {
        ...r,
        isFieldAssignment: fieldAssignmentIds.has(r.id) || isFieldAssignmentTask(r.subKpis),
        linkedJobOrders: linkedJobOrdersForRow,
        travelOrderSummary: travelSummary,
      };
    }),
    canAssignWork: perms.canAssignWork,
    canUnassignWork: isElevatedUserRole(session.user.role),
    canCompleteUnassignedWork: isElevatedUserRole(session.user.role),
    canAssignOffline:
      isElevatedUserRole(session.user.role) || !(await isTaskAssignmentOnDutyRequired()),
    canDeleteTask: session.user.role === "SuperAdmin",
    /** SuperAdmin may edit the checklist of any running task, not just their own. */
    canEditRunningTasks: session.user.role === "SuperAdmin",
    operatorAgentId: perms.operator?.id ?? null,
    operatorAgentName: perms.operator?.name ?? null,
    rosterCompanies: perms.canAssignWork
      ? await prisma.team.findMany({
          where: rosterTeamNameFilter(),
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      : [],
  });
}

export async function POST(req: Request) {
  const { session, unauthorized } = await requireRole(["Admin", "Personnel"]);
  if (unauthorized || !session) return unauthorized;
  const perms = await resolveOpsPermissions(session);
  if (!perms.canAssignWork) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await req.json()) as {
    title?: string;
    frequency?: string;
    subKpisSegmented?: boolean;
    subKpis?: Array<{
      title?: string;
      description?: string | null;
      remarks?: string | null;
      startDate?: string;
      endDate?: string;
      dueDate?: string;
      dueDateRollsWithCycle?: boolean | null;
      projectPriority?: string | null;
      screenshotsEnabled?: boolean;
    }>;
    segments?: Array<{
      id?: string;
      label?: string;
      dueDate?: string | null;
      items?: Array<{
        title?: string;
        description?: string | null;
        remarks?: string | null;
        startDate?: string;
        endDate?: string;
        dueDate?: string;
        dueDateRollsWithCycle?: boolean | null;
        projectPriority?: string | null;
        screenshotsEnabled?: boolean;
      }>;
    }>;
    assignedAgentId?: string;
    recurrenceWeekday?: number;
    recurrenceMonthDay?: number;
    timeZone?: string;
    isRecurring?: boolean;
    nonRecurringStartAt?: string;
    nonRecurringEndAt?: string;
    itProjectName?: string;
    itProjectPhase?: string;
    itProjectPhases?: Array<{
      name?: string;
      dueDate?: string;
      items?: Array<{ title?: string; dueDate?: string }>;
    }>;
    itProjectState?: { activePhaseId?: string; phases?: ItProjectData["phases"] };
    scopedCompanyTeamId?: string | null;
    completionRequirements?: SubKpiCompletionRequirements;
    numericalTarget?: number;
    mainTask?: string;
    pillarDueDate?: string;
    taskDailyPenaltyAmount?: number | null;
    taskDelayPenaltyFrequency?: string | null;
    enableSubtaskAssignees?: boolean;
    isProject?: boolean;
    /** Unchecked = 100%; checked items reduce the recorded percent. */
    invertedRecording?: boolean;
    /** When creating a Project from a Job Order, auto-link after save. */
    linkedJobOrderTicketId?: string | null;
  };
  const mainTaskRaw = body.mainTask?.trim() ?? "";
  const requestedTitle = body.title?.trim() ?? "";
  const isItProject = isItProjectImplementationPillar(requestedTitle);
  /** Task groups removed: persist title from the work-item name (keep reserved IT pillar titles). */
  const title = isItProject
    ? requestedTitle
    : (mainTaskRaw.replace(/\s+/g, " ").toUpperCase() || requestedTitle);
  const frequency = (body.frequency?.toUpperCase() ?? "DAILY") as KpiFrequency;
  const enableSubtaskAssigneesFlag =
    typeof body.enableSubtaskAssignees === "boolean" ? body.enableSubtaskAssignees : true;
  if (!title || !allowedFrequencies.has(frequency)) {
    return NextResponse.json({ error: "title and frequency are required." }, { status: 400 });
  }
  if (!isItProject && !mainTaskRaw) {
    return NextResponse.json({ error: "mainTask is required." }, { status: 400 });
  }
  if (isItProject && body.subKpisSegmented === true) {
    return NextResponse.json(
      { error: "IT Project Implementation does not use segmented checklists." },
      { status: 400 },
    );
  }
  const isRecurring = isItProject ? false : body.isRecurring !== false;
  let nonRecurringStartAt: Date | null = null;
  let nonRecurringEndAt: Date | null = null;

  let recurrenceWeekday: number | null = null;
  let recurrenceMonthDay: number | null = null;
  if (!isItProject && isRecurring && frequency === "WEEKLY") {
    const wd = body.recurrenceWeekday;
    if (typeof wd !== "number" || wd < 0 || wd > 6 || !Number.isInteger(wd)) {
      return NextResponse.json(
        { error: "recurrenceWeekday is required for WEEKLY (0=Sunday … 6=Saturday)." },
        { status: 400 },
      );
    }
    recurrenceWeekday = wd;
  }
  if (!isItProject && isRecurring && (frequency === "MONTHLY" || frequency === "QUARTERLY" || frequency === "SEMI_ANNUAL" || frequency === "YEARLY")) {
    const dom = body.recurrenceMonthDay;
    if (typeof dom !== "number" || dom < 1 || dom > 31 || !Number.isInteger(dom)) {
      return NextResponse.json(
        { error: "recurrenceMonthDay is required for MONTHLY/QUARTERLY/SEMI_ANNUAL/YEARLY (1–31)." },
        { status: 400 },
      );
    }
    recurrenceMonthDay = dom;
  }

  const assigneeId = body.assignedAgentId?.trim() ?? "";
  const assignee = assigneeId
    ? await prisma.agent.findUnique({
        where: { id: assigneeId },
        include: { team: true },
      })
    : null;
  if (assigneeId && !assignee) {
    return NextResponse.json({ error: "Assignee not found." }, { status: 404 });
  }
  if (
    assigneeId &&
    !isElevatedUserRole(session.user.role) &&
    (await isTaskAssignmentOnDutyRequired()) &&
    !(await isAgentOnDutyFromMergedDb(assigneeId))
  ) {
    return NextResponse.json(
      { error: "Assignee is Offline (no merged DB clock-in today). Only On Duty personnel can be assigned." },
      { status: 400 },
    );
  }

  const scopedCompanyTeamIdRaw = body.scopedCompanyTeamId?.trim() ?? "";
  let scopedCompanyTeamId: string | null = null;
  if (scopedCompanyTeamIdRaw) {
    const companyTeam = await prisma.team.findFirst({
      where: { id: scopedCompanyTeamIdRaw, ...rosterTeamNameFilter() },
      select: { id: true },
    });
    if (!companyTeam) {
      return NextResponse.json({ error: "Company not found." }, { status: 404 });
    }
    scopedCompanyTeamId = companyTeam.id;
  }

  const taskCompletionRequirements =
    normalizeCompletionRequirements(body.completionRequirements) ?? {
      checkbox: true,
      screenshots: false,
      screenshotUpload: false,
      numerical: false,
    };
  const subTaskCompletionRequirements = subKpiStoredCompletionRequirements(taskCompletionRequirements);

  let numericalTarget: number | null = null;
  const willBePillarOnly =
    !isItProject &&
    body.subKpisSegmented !== true &&
    (!Array.isArray(body.subKpis) ||
      body.subKpis.map((s) => (s.title ?? "").trim()).filter(Boolean).length === 0);
  if (!isItProject && taskCompletionRequirements.numerical) {
    const rawTarget = body.numericalTarget;
    if (willBePillarOnly && isRecurring && rawTarget == null) {
      numericalTarget = null;
    } else if (typeof rawTarget !== "number" || !Number.isFinite(rawTarget)) {
      return NextResponse.json(
        { error: "numericalTarget is required when numerical record completion is enabled." },
        { status: 400 },
      );
    } else {
      numericalTarget = rawTarget;
    }
  }

  let built: { ok: true; norm: NormalizedSubKpis } | { ok: false; error: string };

  let itProjectPersist: Prisma.InputJsonValue | null = null;
  let itProjectPhaseLabel: string | null = null;

  if (isItProject) {
    const phaseDrafts = Array.isArray(body.itProjectPhases)
      ? body.itProjectPhases.map((p) => ({
          name: (p.name ?? "").trim(),
          dueDate: (p.dueDate ?? "").trim(),
          items: Array.isArray(p.items)
            ? p.items.map((it) => ({
                title: (it.title ?? "").trim(),
                dueDate: (it.dueDate ?? "").trim(),
              }))
            : [],
        }))
      : [];
    const projectBuilt = buildItProjectFromPhaseDrafts(phaseDrafts);
    if (!projectBuilt.ok) {
      return NextResponse.json({ error: projectBuilt.error }, { status: 400 });
    }
    itProjectPersist = wrapItProjectSubKpis(projectBuilt.data);
    itProjectPhaseLabel = itProjectActivePhase(projectBuilt.data).name;
    built = { ok: true, norm: { segmented: false, flat: [] } };
  } else {
    const subTaskScreenshots = subTaskCompletionRequirements.screenshots;
    const mapDraftItem = (s: {
      title?: string;
      description?: string | null;
      remarks?: string | null;
      startDate?: string;
      dueDate?: string;
      dueDateRollsWithCycle?: boolean | null;
      endDate?: string;
      actualDate?: string;
      projectPriority?: string | null;
      screenshotsEnabled?: boolean;
    }) => {
      const dueDate =
        isRecurring && frequency === "DAILY" ? "" : (s.dueDate ?? s.endDate ?? "").trim();
      return {
        title: (s.title ?? "").trim(),
        description: typeof s.description === "string" ? s.description : "",
        remarks: typeof s.remarks === "string" ? s.remarks : "",
        startDate: "",
        dueDate,
        dueDateRollsWithCycle:
          isRecurring &&
          frequency !== "DAILY" &&
          Boolean(dueDate) &&
          s.dueDateRollsWithCycle === true,
        actualDate: isRecurring ? "" : (s.actualDate ?? "").trim(),
        projectPriority: s.projectPriority ?? null,
        completionRequirements: subTaskCompletionRequirements,
        screenshotsEnabled: subTaskScreenshots,
        ...(numericalTarget != null ? { numericalTarget } : {}),
      };
    };
    const flatItems =
      Array.isArray(body.subKpis) && !body.subKpisSegmented
        ? body.subKpis.map(mapDraftItem).filter((s) => s.title.length > 0)
        : [];

    const segmentsInput =
      body.subKpisSegmented === true && Array.isArray(body.segments)
        ? body.segments.map((seg) => ({
            id: typeof seg.id === "string" ? seg.id.trim() : undefined,
            label: (seg.label ?? "").trim(),
            dueDate: typeof seg.dueDate === "string" ? seg.dueDate.trim() : null,
            items: Array.isArray(seg.items)
              ? seg.items.map(mapDraftItem).filter((i) => i.title.length > 0)
              : [],
          }))
        : undefined;

    built = validateSegmentStructureForPersist(
      body.subKpisSegmented === true,
      flatItems,
      segmentsInput,
      {
        allowPillarOnly:
          flatItems.length === 0 &&
          body.subKpisSegmented !== true &&
          (taskCompletionRequirements.checkbox ||
            taskCompletionRequirements.screenshots ||
            taskCompletionRequirements.screenshotUpload ||
            taskCompletionRequirements.numerical),
      },
    );
  }

  if (!built.ok) {
    return NextResponse.json({ error: built.error }, { status: 400 });
  }

  let subKpisPersist = (itProjectPersist ?? wrapForPersist(built.norm)) as Prisma.InputJsonValue;
  if (!isItProject && built.norm.segmented === false && built.norm.flat.length === 0) {
    subKpisPersist = applyPillarOnlyTaskCreate(subKpisPersist, taskCompletionRequirements, {
      numericalTarget,
      dueDate: !isRecurring ? (body.pillarDueDate?.trim() ?? "") : null,
    });
  } else if (!isItProject && !isRecurring && body.pillarDueDate?.trim()) {
    // Persist main-task target so subtasks can inherit when they have no custom due date.
    subKpisPersist = setTaskTargetDueDate(subKpisPersist, body.pillarDueDate.trim());
  }
  if (body.taskDailyPenaltyAmount !== undefined) {
    if (!isItProject && isRecurring) {
      return NextResponse.json(
        { error: "Daily delay penalty applies only to one-off (non-recurring) tasks." },
        { status: 400 },
      );
    }
    const rawPenalty = body.taskDailyPenaltyAmount;
    subKpisPersist = setTaskDailyPenaltyAmount(
      subKpisPersist,
      typeof rawPenalty === "number" && Number.isFinite(rawPenalty) ? Math.max(0, rawPenalty) : null,
    );
  }
  if (body.taskDelayPenaltyFrequency !== undefined) {
    if (!isItProject && isRecurring) {
      return NextResponse.json(
        { error: "Delay penalty frequency applies only to one-off (non-recurring) tasks." },
        { status: 400 },
      );
    }
    subKpisPersist = setTaskDelayPenaltyFrequency(
      subKpisPersist,
      body.taskDelayPenaltyFrequency == null
        ? null
        : normalizeDelayPenaltyFrequency(body.taskDelayPenaltyFrequency),
    );
  }
  if (!isItProject && body.isProject === true) {
    if (isRecurring) {
      return NextResponse.json({ error: "Projects must be one-off (non-recurring)." }, { status: 400 });
    }
    subKpisPersist = markProjectTask(subKpisPersist);
  }
  if (!isItProject && body.invertedRecording === true) {
    subKpisPersist = setInvertedRecording(subKpisPersist, true);
  }

  const linkedJobOrderTicketId =
    typeof body.linkedJobOrderTicketId === "string" ? body.linkedJobOrderTicketId.trim() : "";
  if (linkedJobOrderTicketId) {
    if (!(body.isProject === true || isItProject)) {
      return NextResponse.json(
        { error: "A Job Order can only be linked when creating a Project." },
        { status: 400 },
      );
    }
    // JO creates must use the Project + timeline path — not the IT PROJECT IMPLEMENTATION pillar.
    if (isItProject) {
      return NextResponse.json(
        {
          error:
            "Job Order projects use Project mode (not IT Project Implementation). Create them with a project name only.",
        },
        { status: 400 },
      );
    }
    const joTicket = await prisma.ticket.findUnique({
      where: { id: linkedJobOrderTicketId },
      select: {
        id: true,
        ticketNumber: true,
        requestType: true,
        description: true,
      },
    });
    if (!joTicket || joTicket.requestType !== "JOB_ORDER") {
      return NextResponse.json({ error: "Linked Job Order was not found." }, { status: 404 });
    }
    const { getTicketLinkedKpiMaintenanceId } = await import("@/lib/job-order-project");
    const alreadyLinked = await getTicketLinkedKpiMaintenanceId(joTicket.id);
    if (alreadyLinked) {
      return NextResponse.json(
        {
          error:
            "This Job Order is already linked to a project. Unlink it first before creating another related project.",
        },
        { status: 409 },
      );
    }
    const { setLinkedJobOrderOnSubKpis } = await import("@/lib/kpi-subkpis");
    const { parseJobOrderDescription } = await import("@/lib/job-order");
    subKpisPersist = setLinkedJobOrderOnSubKpis(subKpisPersist, {
      ticketId: joTicket.id,
      ticketNumber: joTicket.ticketNumber,
    });
    const joTarget =
      body.pillarDueDate?.trim() ||
      parseJobOrderDescription(joTicket.description)?.targetDate?.trim() ||
      null;
    subKpisPersist = seedJoLinkedProjectTimeline(subKpisPersist, { targetDueDate: joTarget });
  } else if (!isItProject && body.isProject === true) {
    // Non-JO projects still need the Timeline Tracker envelope so phase targets persist.
    subKpisPersist = seedJoLinkedProjectTimeline(subKpisPersist, {
      targetDueDate: body.pillarDueDate?.trim() || null,
    });
  }

  const timeZone = normalizeTimeZone(body.timeZone);
  const periodKey = isRecurring
    ? computePeriodKey(
        frequency as KpiFrequencyCode,
        recurrenceWeekday,
        recurrenceMonthDay,
        new Date(),
        timeZone,
      )
    : null;

  const periodCycleStartAt = isRecurring
    ? getPeriodStartInclusive(frequency as KpiFrequencyCode, recurrenceWeekday, recurrenceMonthDay, new Date(), timeZone)
    : null;

  const itProjectName =
    isItProjectImplementationPillar(title) && typeof body.itProjectName === "string"
      ? body.itProjectName.trim() || null
      : null;
  const itProjectPhase = isItProject
    ? itProjectPhaseLabel
    : isItProjectImplementationPillar(title) && typeof body.itProjectPhase === "string"
      ? body.itProjectPhase.trim() || null
      : null;

  // Names are unique per title+mainTask (title is derived from the work-item name).
  // Always create a fresh row; never merge/clone prior subtasks or state.
  if (!isItProject && mainTaskRaw) {
    const duplicateMainTask = await prisma.kpiMaintenance.findFirst({
      where: {
        title,
        mainTask: { equals: mainTaskRaw, mode: "insensitive" },
      },
      select: { id: true, mainTask: true },
    });
    if (duplicateMainTask) {
      return NextResponse.json(
        {
          error:
            body.isProject === true
              ? `A project named "${mainTaskRaw}" already exists. Use a different project name.`
              : `A task named "${mainTaskRaw}" already exists. Use a different name.`,
        },
        { status: 409 },
      );
    }
  }

  if (isItProject && itProjectName) {
    // Allow multiple IT projects under the same pillar title; block only duplicate project names.
    const existingProject = await prisma.kpiMaintenance.findFirst({
      where: {
        title,
        itProjectName: { equals: itProjectName, mode: "insensitive" },
      },
      select: { id: true },
    });
    if (existingProject) {
      return NextResponse.json(
        { error: `IT Project "${itProjectName}" already exists. Use a different project name.` },
        { status: 409 },
      );
    }
  }

  let created;
  try {
    // Preserve IT project envelopes; setTaskCount pass-throughs kind: it_project.
    const newItemCount = isItProject
      ? itProjectChecklistItems(subKpisPersist).length
      : collectAllSubKpiItems(normalizeSubKpis(subKpisPersist)).length;
    const initialJson = setTaskCount(subKpisPersist, newItemCount);

    created = await prisma.kpiMaintenance.create({
      data: {
        title,
        mainTask: isItProject ? null : mainTaskRaw,
        isRecurring,
        frequency,
        subKpis: initialJson,
        assignedAgentId: assignee?.id ?? null,
        scopedCompanyTeamId,
        recurrenceWeekday,
        recurrenceMonthDay,
        nonRecurringStartAt,
        nonRecurringEndAt,
        periodCycleStartAt,
        periodKey,
        assignedRole: assignee
          ? (await portalCompanyAdminPrivilegesForEmail(assignee.email))
            ? "Admin Role"
            : "Personnel"
          : null,
        createdBy: session.user.email ?? session.user.name ?? "unknown",
        createdByRole: session.user.role,
        itProjectName,
        itProjectPhase,
        enableSubtaskAssignees: enableSubtaskAssigneesFlag,
      },
    });
  } catch (e) {
    console.error("[kpi-maintenance POST]", e);
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === "P2002") {
        return NextResponse.json(
          {
            error: isItProject
              ? `Could not create project under '${title}' (duplicate name).`
              : body.isProject === true
                ? `A project named "${mainTaskRaw}" already exists. Use a different project name.`
                : `A task named "${mainTaskRaw}" already exists. Use a different name.`,
          },
          { status: 409 },
        );
      }
    }
    const msg = e instanceof Error ? e.message : "Could not create KPI.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
  const createdDate = new Date(created.createdAt).toISOString().slice(0, 10);
  const message = isItProject
    ? `New project '${itProjectName ?? created.title}' created on ${createdDate}.`
    : body.isProject === true
      ? `New project '${mainTaskRaw}' created on ${createdDate}.`
      : `New task '${mainTaskRaw}' created on ${createdDate}.`;

  if (linkedJobOrderTicketId) {
    const { attachCreatedProjectToJobOrder } = await import("@/lib/job-order-project");
    const linked = await attachCreatedProjectToJobOrder({
      ticketId: linkedJobOrderTicketId,
      kpiMaintenanceId: created.id,
    });
    if (!linked.ok) {
      // Project exists; surface the link failure so the operator can link manually.
      return NextResponse.json(
        {
          message: `${message} Could not auto-link Job Order: ${linked.error}`,
          taskGroup: created,
          linkedJobOrderError: linked.error,
        },
        { status: 201 },
      );
    }
  }

  try {
    await logKpiActivity({
      kpiMaintenanceId: created.id,
      author: session.user.name?.trim() || session.user.email?.trim() || "User",
      summary: isItProject ? "Project created" : "Task created",
      detail: message,
    });
  } catch (e) {
    console.error("[kpi-maintenance POST] audit log failed", e);
  }

  return NextResponse.json(
    {
      message: linkedJobOrderTicketId
        ? `${message} Linked to Job Order.`
        : message,
      taskGroup: created,
    },
    { status: 201 },
  );
}

export async function PATCH(req: Request) {
  const { session, unauthorized } = await requireRole(["Admin", "Personnel"]);
  if (unauthorized || !session) return unauthorized;
  const perms = await resolveOpsPermissions(session);
  const patchTz = normalizeTimeZone(new URL(req.url).searchParams.get("tz"));
  let screenshotFiles: File[] = [];
  let body: {
    id?: string;
    subKpiId?: string;
    done?: boolean;
    markAllDone?: boolean;
    structuredSubKpis?: unknown;
    assignedAgentId?: string;
    itProjectName?: string | null;
    itProjectPhase?: string | null;
    taskPriority?: string | null;
    taskDailyPenaltyAmount?: number | null;
    taskDelayPenaltyFrequency?: string | null;
    itProjectState?: { activePhaseId?: string; phases?: ItProjectData["phases"] };
    subKpiSchedule?: {
      subKpiId?: string;
      dueDate?: string | null;
      actualDate?: string | null;
      startDate?: string | null;
    };
    moveSubKpiPhase?: {
      subKpiId?: string;
      phaseId?: string;
    };
    phaseDueDate?: {
      phaseId?: string;
      dueDate?: string | null;
    };
    subKpiLifecycle?: {
      subKpiId?: string;
      action?: "start" | "end";
      latitude?: number | null;
      longitude?: number | null;
      capturedAt?: string | null;
    };
    subKpiWorkMeta?: {
      subKpiId?: string;
      startDate?: string | null;
      dueDate?: string | null;
      actualDate?: string | null;
      projectPriority?: string | null;
      numericalValue?: number | null;
      numericalTarget?: number | null;
      remarks?: string | null;
    };
    subKpiProjectMeta?: {
      subKpiId?: string;
      projectPriority?: string;
      projectStatus?: string;
    };
    subKpiAssignee?: {
      subKpiId?: string;
      assignedAgentId?: string | null;
    };
    seekAssistance?: {
      subKpiId?: string;
      subKpiIds?: string[];
    };
    subKpiScreenshot?: {
      subKpiId?: string;
      slot?: TaskScreenshotSlot;
    };
    subKpiScreenshotDelete?: {
      subKpiId?: string;
      slot?: TaskScreenshotSlot;
      storedFileName?: string;
    };
    pillarScreenshot?: {
      slot?: TaskScreenshotSlot;
    };
    pillarScreenshotDelete?: {
      slot?: TaskScreenshotSlot;
      storedFileName?: string;
    };
    addSubKpi?: {
      title?: string;
      description?: string | null;
      remarks?: string | null;
      segmentId?: string | null;
      startDate?: string | null;
      dueDate?: string | null;
      dueDateRollsWithCycle?: boolean | null;
      projectPriority?: string | null;
    };
    updateSubKpi?: {
      subKpiId?: string;
      title?: string;
      description?: string | null;
      remarks?: string | null;
      startDate?: string | null;
      dueDate?: string | null;
      dueDateRollsWithCycle?: boolean | null;
      projectPriority?: string | null;
      completionMode?: SubKpiCompletionMode;
      completionRequirements?: SubKpiCompletionRequirements | null;
      numericalTarget?: number | null;
      dailyPenaltyAmount?: number | null;
      delayPenaltyFrequency?: string | null;
    };
    removeSubKpi?: {
      subKpiId?: string;
    };
    deleteTask?: boolean;
    /** Move an assigned/running Project into another task group (updates `title`). */
    moveToTaskGroup?: string;
    taskSchedule?: {
      isRecurring?: boolean;
      frequency?: string;
      recurrenceWeekday?: number;
      recurrenceMonthDay?: number;
      nonRecurringStartAt?: string;
      nonRecurringEndAt?: string;
    };
  };
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const fd = await req.formData();
    screenshotFiles = fd
      .getAll("screenshot")
      .filter((file): file is File => file instanceof File && file.size > 0);
    body = {
      id: String(fd.get("id") ?? ""),
      ...(String(fd.get("pillarScreenshot") ?? "") === "1"
        ? { pillarScreenshot: { slot: String(fd.get("slot") ?? "") as TaskScreenshotSlot } }
        : {
            subKpiScreenshot: {
              subKpiId: String(fd.get("subKpiId") ?? ""),
              slot: String(fd.get("slot") ?? "") as TaskScreenshotSlot,
            },
          }),
    };
  } else {
    body = (await req.json()) as typeof body;
  }
  const id = body.id?.trim() ?? "";

  if (!id) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }

  const row = await prisma.kpiMaintenance.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      mainTask: true,
      assignedAgentId: true,
      assignedAgent: { select: { id: true, name: true, email: true } },
      subKpis: true,
      isRecurring: true,
      frequency: true,
      recurrenceWeekday: true,
      recurrenceMonthDay: true,
      periodCycleStartAt: true,
      periodKey: true,
      lastFullCompletionAt: true,
      itProjectName: true,
      itProjectPhase: true,
      enableSubtaskAssignees: true,
    },
  });
  if (!row) return NextResponse.json({ error: "KPI not found." }, { status: 404 });
  const kpiRow = row;
  const auditAuthor =
    session.user.name?.trim() || session.user.email?.trim() || "User";
  const respondUpdated = async (payload: unknown) => {
    const labelItems = isItProjectImplementationPillar(kpiRow.title)
      ? itProjectAllItems(parseItProjectSubKpis(kpiRow.subKpis, kpiRow.itProjectPhase))
      : collectChecklistProgressItems(kpiRow.subKpis, kpiMainTaskLabel(kpiRow));
    const audit = inferKpiPatchAudit(body, {
      subKpiTitle: (subKpiId) =>
        labelItems.find((it) => it.id === subKpiId)?.title?.trim() || undefined,
    });
    if (audit) {
      try {
        await logKpiActivity({
          kpiMaintenanceId: id,
          author: auditAuthor,
          summary: audit.summary,
          detail: audit.detail,
        });
      } catch (e) {
        console.error("[kpi-maintenance PATCH] audit log failed", e);
      }
    }
    return NextResponse.json(payload);
  };


  if (body.deleteTask === true) {
    if (session.user.role !== "SuperAdmin") {
      return NextResponse.json(
        { error: "Only SuperAdmin can remove tasks." },
        { status: 403 },
      );
    }
    await prisma.kpiMaintenance.delete({ where: { id } });
    await deleteTaskScreenshotsDir(id);
    triggerEfficiencyRecomputeBackground();
    return NextResponse.json({ ok: true, id });
  }

  if (typeof body.moveToTaskGroup === "string") {
    if (!perms.canAssignWork) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { isProjectTask } = await import("@/lib/kpi-subkpis");
    if (!isProjectTask(kpiRow.subKpis) && !isItProjectImplementationPillar(kpiRow.title)) {
      return NextResponse.json(
        { error: "Only Project cards can be moved to another task group." },
        { status: 400 },
      );
    }
    if (!kpiRow.assignedAgentId) {
      return NextResponse.json(
        { error: "Assign the project first, then move it into a task group." },
        { status: 400 },
      );
    }
    const nextTitle = body.moveToTaskGroup.trim().replace(/\s+/g, " ");
    if (!nextTitle) {
      return NextResponse.json({ error: "Task group name is required." }, { status: 400 });
    }
    if (isItProjectImplementationPillar(nextTitle)) {
      return NextResponse.json(
        { error: "Cannot move a Job Order project into IT Project Implementation." },
        { status: 400 },
      );
    }
    if (nextTitle.toLowerCase() === kpiRow.title.trim().toLowerCase()) {
      return NextResponse.json(kpiRow);
    }
    const mainTask = (kpiRow.mainTask ?? "").trim();
    if (mainTask) {
      const clash = await prisma.kpiMaintenance.findFirst({
        where: {
          title: { equals: nextTitle, mode: "insensitive" },
          mainTask: { equals: mainTask, mode: "insensitive" },
          NOT: { id: kpiRow.id },
        },
        select: { id: true },
      });
      if (clash) {
        return NextResponse.json(
          {
            error: `A task named "${mainTask}" already exists under group '${nextTitle}'. Rename the project or choose another group.`,
          },
          { status: 409 },
        );
      }
    }
    const updated = await prisma.kpiMaintenance.update({
      where: { id },
      data: { title: nextTitle },
    });
    return respondUpdated(updated);
  }

  const snapshotTz = timeZoneFromPeriodKey(kpiRow.periodKey) || patchTz;

  async function captureCurrentPeriodSnapshot(subKpis: unknown) {
    if (!kpiRow.isRecurring) return;
    await upsertKpiPeriodSnapshot(
      {
        id: kpiRow.id,
        title: kpiRow.title,
        frequency: kpiRow.frequency,
        subKpis,
        periodKey: kpiRow.periodKey,
        recurrenceWeekday: kpiRow.recurrenceWeekday,
        recurrenceMonthDay: kpiRow.recurrenceMonthDay,
        periodCycleStartAt: kpiRow.periodCycleStartAt,
        isRecurring: kpiRow.isRecurring,
        assignedAgent: kpiRow.assignedAgent
          ? { id: kpiRow.assignedAgent.id, name: kpiRow.assignedAgent.name }
          : null,
      },
      snapshotTz,
    );
  }

  /** Primary owns the update; dump overall KPI to merged for Personnel fetch. */
  function dumpOverallKpiToMerged() {
    triggerEfficiencyRecomputeBackground();
  }

  async function afterProgressAffectingUpdate(subKpis: unknown) {
    await captureCurrentPeriodSnapshot(subKpis);
    dumpOverallKpiToMerged();
  }
  const isAssignee = !!perms.operator && perms.operator.id === kpiRow.assignedAgentId;
  const timelineProject = isTimelineProjectKpi(kpiRow.title, kpiRow.subKpis);
  const subKpiItems = timelineProject
    ? itProjectAllItems(parseItProjectSubKpis(kpiRow.subKpis, kpiRow.itProjectPhase))
    : collectChecklistProgressItems(kpiRow.subKpis, kpiMainTaskLabel(kpiRow));
  const canEditSubKpi = (subKpiId: string) => {
    if (isAssignee) return true;
    const item = subKpiItems.find((it) => it.id === subKpiId);
    if (!item) return false;
    if (
      subKpiAssignedToOperator(item, {
        id: perms.operator?.id,
        name: perms.operator?.name ?? session.user.name,
      })
    ) {
      return true;
    }
    // SuperAdmin / HighAdmin may edit sub-task work on any running task,
    // including tasks assigned to other personnel.
    return isElevatedUserRole(session.user.role);
  };
  const canCompleteSubKpi = (subKpiId: string) => {
    const item = subKpiItems.find((it) => it.id === subKpiId);
    if (!item) return false;
    const req = resolveSubKpiCompletionRequirements(item);
    if (!req.checkbox) return false;
    if (!canEditSubKpi(subKpiId)) {
      return Boolean(perms.canAssignWork && req.screenshots && hasBeforeAndAfterScreenshots(item));
    }
    if (req.screenshots && !hasBeforeAndAfterScreenshots(item)) return false;
    if (req.screenshotUpload && !hasScreenshotUpload(item)) return false;
    if (req.numerical && !hasNumericalRecord(item)) return false;
    if (req.numerical) {
      const pct = numericalRecordProgressPercent(item.numericalValue, item.numericalTarget);
      if (pct != null && pct < 100) return false;
    }
    return true;
  };

  if (body.itProjectName !== undefined || body.itProjectPhase !== undefined) {
    if (!isAssignee && !isElevatedUserRole(session.user.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (!isItProjectImplementationPillar(kpiRow.title)) {
      return NextResponse.json({ error: "Project fields apply only to IT Project Implementation tasks." }, { status: 400 });
    }
    const data: { itProjectName?: string | null; itProjectPhase?: string | null } = {};
    if (body.itProjectName !== undefined) {
      data.itProjectName =
        typeof body.itProjectName === "string" ? body.itProjectName.trim() || null : null;
    }
    if (body.itProjectPhase !== undefined) {
      data.itProjectPhase =
        typeof body.itProjectPhase === "string" ? body.itProjectPhase.trim() || null : null;
    }
    const updated = await prisma.kpiMaintenance.update({ where: { id }, data });
    return respondUpdated(updated);
  }

  if (body.itProjectState != null && typeof body.itProjectState === "object") {
    if (!isAssignee && !isElevatedUserRole(session.user.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (!usesProjectTimelineTracker(kpiRow.subKpis) && !isItProjectImplementationPillar(kpiRow.title)) {
      return NextResponse.json({ error: "Phase updates apply only to Timeline Tracker projects." }, { status: 400 });
    }
    let wrapped: Prisma.InputJsonValue;
    if (Array.isArray(body.itProjectState.phases) && body.itProjectState.phases.length > 0) {
      const parsed = parseItProjectSubKpis(kpiRow.subKpis, kpiRow.itProjectPhase);
      const activePhaseId =
        typeof body.itProjectState.activePhaseId === "string" && body.itProjectState.activePhaseId.trim()
          ? body.itProjectState.activePhaseId.trim()
          : parsed.activePhaseId;
      const nextState = syncAllPhaseDueDates({
        activePhaseId,
        phases: body.itProjectState.phases as ItProjectData["phases"],
      });
      const dueCheck = validateItProjectPhaseDueConstraints(nextState);
      if (!dueCheck.ok) {
        return NextResponse.json({ error: dueCheck.error }, { status: 400 });
      }
      wrapped = updateItProjectPhases(kpiRow.subKpis, nextState);
    } else if (typeof body.itProjectState.activePhaseId === "string" && body.itProjectState.activePhaseId.trim()) {
      wrapped = setItProjectActivePhase(kpiRow.subKpis, body.itProjectState.activePhaseId.trim());
    } else {
      return NextResponse.json({ error: "Provide activePhaseId or phases." }, { status: 400 });
    }
    const active = itProjectActivePhase(parseItProjectSubKpis(wrapped, kpiRow.itProjectPhase));
    const updated = await prisma.kpiMaintenance.update({
      where: { id },
      data: { subKpis: wrapped, itProjectPhase: active.name },
    });
    return respondUpdated(updated);
  }

  if (body.taskPriority !== undefined) {
    if (isItProjectImplementationPillar(kpiRow.title)) {
      return NextResponse.json({ error: "Task priority applies only to regular tasks." }, { status: 400 });
    }
    if (!perms.canAssignWork && !isAssignee) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const updatedJson = setTaskPriority(kpiRow.subKpis, body.taskPriority);
    const updated = await prisma.kpiMaintenance.update({
      where: { id },
      data: { subKpis: updatedJson },
    });
    return respondUpdated(updated);
  }

  if (body.taskDailyPenaltyAmount !== undefined) {
    if (kpiRow.isRecurring && !isItProjectImplementationPillar(kpiRow.title)) {
      return NextResponse.json(
        { error: "Daily delay penalty applies only to one-off (non-recurring) tasks." },
        { status: 400 },
      );
    }
    if (!perms.isAdminRole) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const rawPenalty = body.taskDailyPenaltyAmount;
    const updatedJson = setTaskDailyPenaltyAmount(
      kpiRow.subKpis,
      typeof rawPenalty === "number" && Number.isFinite(rawPenalty) ? Math.max(0, rawPenalty) : null,
    );
    const updated = await prisma.kpiMaintenance.update({
      where: { id },
      data: { subKpis: updatedJson },
    });
    triggerEfficiencyRecomputeBackground();
    return respondUpdated(updated);
  }

  if (body.taskDelayPenaltyFrequency !== undefined) {
    if (kpiRow.isRecurring && !isItProjectImplementationPillar(kpiRow.title)) {
      return NextResponse.json(
        { error: "Delay penalty frequency applies only to one-off (non-recurring) tasks." },
        { status: 400 },
      );
    }
    if (!perms.isAdminRole) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const updatedJson = setTaskDelayPenaltyFrequency(
      kpiRow.subKpis,
      body.taskDelayPenaltyFrequency == null
        ? null
        : normalizeDelayPenaltyFrequency(body.taskDelayPenaltyFrequency),
    );
    const updated = await prisma.kpiMaintenance.update({
      where: { id },
      data: { subKpis: updatedJson },
    });
    triggerEfficiencyRecomputeBackground();
    return respondUpdated(updated);
  }

  if (body.subKpiWorkMeta != null && typeof body.subKpiWorkMeta === "object") {
    if (isItProjectImplementationPillar(kpiRow.title)) {
      return NextResponse.json(
        { error: "Task work details are not available for IT Project Implementation tasks." },
        { status: 400 },
      );
    }
    const subKpiIdMeta = String(body.subKpiWorkMeta.subKpiId ?? "").trim();
    if (!subKpiIdMeta) {
      return NextResponse.json({ error: "subKpiWorkMeta.subKpiId is required." }, { status: 400 });
    }
    if (!perms.canAssignWork && !canEditSubKpi(subKpiIdMeta)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const target = subKpiItems.find((it) => it.id === subKpiIdMeta);
    if (!target) {
      return NextResponse.json({ error: "Sub-task not found." }, { status: 404 });
    }
    const meta = body.subKpiWorkMeta;
    const recurring = kpiRow.isRecurring !== false;
    if (meta.numericalTarget !== undefined) {
      const req = resolveSubKpiCompletionRequirements(target);
      if (!subKpiRequiresNumerical(req)) {
        return NextResponse.json({ error: "This sub-task does not use numerical records." }, { status: 400 });
      }
      // Target may be set/adjusted for the active period while the task is running.
      if (
        !canAdjustNumericalTarget({
          isRecurring: recurring,
          subKpisRaw: kpiRow.subKpis,
          subKpiId: subKpiIdMeta,
        })
      ) {
        return NextResponse.json(
          { error: "Target number cannot be changed for this task." },
          { status: 403 },
        );
      }
      if (!perms.isAdminRole && !perms.canAssignWork) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      if (
        meta.numericalTarget != null &&
        (!Number.isFinite(meta.numericalTarget) || meta.numericalTarget <= 0)
      ) {
        return NextResponse.json({ error: "numericalTarget must be a positive number." }, { status: 400 });
      }
    }
    if (
      meta.numericalValue !== undefined &&
      meta.numericalValue != null &&
      target.numericalTarget == null
    ) {
      return NextResponse.json(
        { error: "Set a target number for this cycle before entering the actual record." },
        { status: 400 },
      );
    }
    if (meta.startDate !== undefined) {
      return NextResponse.json(
        { error: "Sub-task schedule dates are not used for maintenance tasks." },
        { status: 400 },
      );
    }
    let updatedJson = setSubKpiItemWorkMeta(kpiRow.subKpis, subKpiIdMeta, {
      dueDate: recurring ? undefined : meta.dueDate,
      actualDate: recurring ? undefined : meta.actualDate,
      projectPriority: meta.projectPriority,
      numericalValue: meta.numericalValue,
      numericalTarget: meta.numericalTarget,
      remarks: meta.remarks,
    });
    updatedJson = syncSubKpiDoneFromRequirements(updatedJson, subKpiIdMeta);
    const prevComplete = checklistFullyComplete(kpiRow.subKpis, kpiMainTaskLabel(kpiRow));
    const nextComplete = checklistFullyComplete(updatedJson, kpiMainTaskLabel(kpiRow));
    let lastFullCompletionAt: Date | null | undefined;
    if (!prevComplete && nextComplete) lastFullCompletionAt = new Date();
    else if (prevComplete && !nextComplete) lastFullCompletionAt = null;
    if (nextComplete) await afterProgressAffectingUpdate(updatedJson);
    else dumpOverallKpiToMerged();

    const updated = await prisma.kpiMaintenance.update({
      where: { id },
      data: {
        subKpis: updatedJson,
        ...(nextComplete ? { rolledOverIncomplete: false } : {}),
        ...(lastFullCompletionAt !== undefined ? { lastFullCompletionAt } : {}),
      },
    });
    return respondUpdated(updated);
  }

  if (body.moveSubKpiPhase != null && typeof body.moveSubKpiPhase === "object") {
    if (!usesProjectTimelineTracker(kpiRow.subKpis) && !isItProjectImplementationPillar(kpiRow.title)) {
      return NextResponse.json(
        { error: "Moving between phases applies only to Timeline Tracker projects." },
        { status: 400 },
      );
    }
    const subKpiIdMove = String(body.moveSubKpiPhase.subKpiId ?? "").trim();
    const phaseIdMove = String(body.moveSubKpiPhase.phaseId ?? "").trim();
    if (!subKpiIdMove) {
      return NextResponse.json({ error: "moveSubKpiPhase.subKpiId is required." }, { status: 400 });
    }
    if (!phaseIdMove) {
      return NextResponse.json({ error: "moveSubKpiPhase.phaseId is required." }, { status: 400 });
    }
    if (!canEditSubKpi(subKpiIdMove) && !perms.canAssignWork) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const result = moveItProjectSubKpiToPhase(kpiRow.subKpis, subKpiIdMove, phaseIdMove);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    const updated = await prisma.kpiMaintenance.update({
      where: { id },
      data: { subKpis: result.json },
    });
    return respondUpdated(updated);
  }

  if (body.phaseDueDate != null && typeof body.phaseDueDate === "object") {
    if (!usesProjectTimelineTracker(kpiRow.subKpis) && !isItProjectImplementationPillar(kpiRow.title)) {
      return NextResponse.json(
        { error: "Phase target dates apply only to Timeline Tracker projects." },
        { status: 400 },
      );
    }
    if (!perms.canAssignWork && !isAssignee) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const phaseIdDue = String(body.phaseDueDate.phaseId ?? "").trim();
    if (!phaseIdDue) {
      return NextResponse.json({ error: "phaseDueDate.phaseId is required." }, { status: 400 });
    }
    const dueRaw = body.phaseDueDate.dueDate;
    const dueValue =
      dueRaw == null || (typeof dueRaw === "string" && !dueRaw.trim())
        ? null
        : String(dueRaw).trim();
    const data = parseItProjectSubKpis(kpiRow.subKpis, kpiRow.itProjectPhase);
    if (!data.phases.some((p) => p.id === phaseIdDue)) {
      return NextResponse.json({ error: "Phase not found." }, { status: 404 });
    }
    const nextJson = setItProjectPhaseDueDate(kpiRow.subKpis, phaseIdDue, dueValue);
    const updated = await prisma.kpiMaintenance.update({
      where: { id },
      data: { subKpis: nextJson },
    });
    return respondUpdated(updated);
  }

  if (body.subKpiSchedule != null && typeof body.subKpiSchedule === "object") {
    if (!usesProjectTimelineTracker(kpiRow.subKpis) && !isItProjectImplementationPillar(kpiRow.title)) {
      return NextResponse.json(
        { error: "Per sub-task scheduling applies only to Timeline Tracker projects." },
        { status: 400 },
      );
    }
    const subKpiIdSched = String(body.subKpiSchedule.subKpiId ?? "").trim();
    if (!subKpiIdSched) {
      return NextResponse.json({ error: "subKpiSchedule.subKpiId is required." }, { status: 400 });
    }
    if (!canEditSubKpi(subKpiIdSched)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const sched = body.subKpiSchedule;
    let updatedJson = setItProjectSubKpiSchedule(kpiRow.subKpis, subKpiIdSched, {
      dueDate: sched.dueDate,
      actualDate: sched.actualDate,
      startDate: sched.startDate,
    });
    const delayPass = applyPhaseDelayNotifications(updatedJson, {
      timeZone: patchTz,
      cardAssignedAgentId: kpiRow.assignedAgentId,
    });
    updatedJson = delayPass.json;
    const prevComplete = checklistFullyComplete(kpiRow.subKpis, kpiMainTaskLabel(kpiRow));
    const nextComplete = checklistFullyComplete(updatedJson, kpiMainTaskLabel(kpiRow));
    let lastFullCompletionAt: Date | null | undefined;
    if (!prevComplete && nextComplete) lastFullCompletionAt = new Date();
    else if (prevComplete && !nextComplete) lastFullCompletionAt = null;

    const updated = await prisma.kpiMaintenance.update({
      where: { id },
      data: {
        subKpis: updatedJson,
        ...(nextComplete ? { rolledOverIncomplete: false } : {}),
        ...(lastFullCompletionAt !== undefined ? { lastFullCompletionAt } : {}),
      },
    });
    dumpOverallKpiToMerged();
    return respondUpdated({
      ...updated,
      phaseDelayNotifications: delayPass.notifications,
    });
  }

  if (body.subKpiLifecycle != null && typeof body.subKpiLifecycle === "object") {
    if (!usesProjectTimelineTracker(kpiRow.subKpis) && !isItProjectImplementationPillar(kpiRow.title)) {
      return NextResponse.json(
        { error: "Start/End lifecycle applies only to Timeline Tracker projects." },
        { status: 400 },
      );
    }
    const subKpiIdLife = String(body.subKpiLifecycle.subKpiId ?? "").trim();
    const action = body.subKpiLifecycle.action;
    if (!subKpiIdLife || (action !== "start" && action !== "end")) {
      return NextResponse.json(
        { error: "subKpiLifecycle.subKpiId and action ('start'|'end') are required." },
        { status: 400 },
      );
    }
    if (!canEditSubKpi(subKpiIdLife)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const lat = body.subKpiLifecycle.latitude;
    const lng = body.subKpiLifecycle.longitude;
    if ((lat != null || lng != null) && !isValidLatLng(lat, lng)) {
      return NextResponse.json({ error: "Invalid GPS coordinates." }, { status: 400 });
    }
    const life = setItProjectSubKpiLifecycle(kpiRow.subKpis, subKpiIdLife, action, patchTz, {
      latitude: typeof lat === "number" ? lat : null,
      longitude: typeof lng === "number" ? lng : null,
      capturedAt:
        typeof body.subKpiLifecycle.capturedAt === "string"
          ? body.subKpiLifecycle.capturedAt
          : null,
    });
    if (!life.ok) {
      return NextResponse.json({ error: life.error }, { status: 400 });
    }
    const prevComplete = checklistFullyComplete(kpiRow.subKpis, kpiMainTaskLabel(kpiRow));
    const nextComplete = checklistFullyComplete(life.json, kpiMainTaskLabel(kpiRow));
    let lastFullCompletionAt: Date | null | undefined;
    if (!prevComplete && nextComplete) lastFullCompletionAt = new Date();
    else if (prevComplete && !nextComplete) lastFullCompletionAt = null;

    const updated = await prisma.kpiMaintenance.update({
      where: { id },
      data: {
        subKpis: life.json,
        ...(nextComplete ? { rolledOverIncomplete: false } : {}),
        ...(lastFullCompletionAt !== undefined ? { lastFullCompletionAt } : {}),
      },
    });
    dumpOverallKpiToMerged();
    return respondUpdated(updated);
  }

  if (body.subKpiProjectMeta != null && typeof body.subKpiProjectMeta === "object") {
    if (!timelineProject) {
      return NextResponse.json({ error: "Project metadata applies only to Timeline Tracker projects." }, { status: 400 });
    }
    const subKpiIdMeta = String(body.subKpiProjectMeta.subKpiId ?? "").trim();
    if (!subKpiIdMeta) {
      return NextResponse.json({ error: "subKpiProjectMeta.subKpiId is required." }, { status: 400 });
    }
    if (!canEditSubKpi(subKpiIdMeta)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const result = setItProjectSubKpiProjectMeta(kpiRow.subKpis, subKpiIdMeta, {
      projectPriority: body.subKpiProjectMeta.projectPriority,
      projectStatus: body.subKpiProjectMeta.projectStatus,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

    const prevComplete = checklistFullyComplete(kpiRow.subKpis, kpiMainTaskLabel(kpiRow));
    const nextComplete = checklistFullyComplete(result.json, kpiMainTaskLabel(kpiRow));
    let lastFullCompletionAt: Date | null | undefined;
    if (!prevComplete && nextComplete) lastFullCompletionAt = new Date();
    else if (prevComplete && !nextComplete) lastFullCompletionAt = null;

    const updated = await prisma.kpiMaintenance.update({
      where: { id },
      data: {
        subKpis: result.json,
        ...(nextComplete ? { rolledOverIncomplete: false } : {}),
        ...(lastFullCompletionAt !== undefined ? { lastFullCompletionAt } : {}),
      },
    });
    dumpOverallKpiToMerged();
    return respondUpdated(updated);
  }

  if (body.subKpiAssignee != null && typeof body.subKpiAssignee === "object") {
    const subKpiIdAssign = String(body.subKpiAssignee.subKpiId ?? "").trim();
    if (!subKpiIdAssign) {
      return NextResponse.json({ error: "subKpiAssignee.subKpiId is required." }, { status: 400 });
    }
    const target = subKpiItems.find((it) => it.id === subKpiIdAssign);
    if (!target) {
      return NextResponse.json({ error: "Sub-task not found." }, { status: 404 });
    }
    if (
      !canMutateSubKpiAssignee({
        // Strict boolean: null/undefined must not unlock assignee controls.
        enableSubtaskAssignees: kpiRow.enableSubtaskAssignees === true,
        item: target,
        canAssignWork: perms.canAssignWork,
        isMainAssignee: isAssignee,
      })
    ) {
      return NextResponse.json(
        {
          error:
            kpiRow.enableSubtaskAssignees === true
              ? "Forbidden"
              : "Subtask assignees are locked. Seek Assistance first, then an admin can assign a helper.",
        },
        { status: 403 },
      );
    }
    const assignedAgentIdRaw = body.subKpiAssignee.assignedAgentId;
    const assignedAgentId =
      typeof assignedAgentIdRaw === "string" ? assignedAgentIdRaw.trim() : "";
    const assignee = assignedAgentId
      ? await prisma.agent.findUnique({
          where: { id: assignedAgentId },
          select: { id: true, name: true, email: true },
        })
      : null;
    if (assignedAgentId && !assignee) {
      return NextResponse.json({ error: "Assignee not found." }, { status: 404 });
    }
    if (
      assignedAgentId &&
      !isElevatedUserRole(session.user.role) &&
      (await isTaskAssignmentOnDutyRequired()) &&
      !(await isAgentOnDutyFromMergedDb(assignedAgentId))
    ) {
      return NextResponse.json(
        { error: "Assignee is Offline (no merged DB clock-in today). Only On Duty personnel can be assigned." },
        { status: 400 },
      );
    }
    if (assignedAgentId && assignedAgentId === kpiRow.assignedAgentId) {
      return NextResponse.json(
        { error: "Main assignee cannot also be assigned as a sub-task assignee." },
        { status: 400 },
      );
    }
    if (assignee) {
      if (!kpiRow.assignedAgentId) {
        return NextResponse.json(
          { error: "Assign the main task before assigning sub-tasks to personnel." },
          { status: 400 },
        );
      }
      const mainAssigneeCompanyId = await resolveAgentDesignatedCompanyId(kpiRow.assignedAgentId);
      const subAssigneeCompanyId = await resolveAgentDesignatedCompanyId(assignee.id);
      // Elevated roles may assign helpers cross-company; Admin/Personnel stay company-locked.
      if (!isElevatedUserRole(session.user.role)) {
        if (!mainAssigneeCompanyId || !subAssigneeCompanyId) {
          return NextResponse.json(
            { error: "Both main task and sub-task assignees must have a designated company." },
            { status: 400 },
          );
        }
        if (subAssigneeCompanyId !== mainAssigneeCompanyId) {
          return NextResponse.json(
            { error: "Sub-task assignee must belong to the same company as the main task assignee." },
            { status: 400 },
          );
        }
        if (roleUsesCompanyDepartmentTaskAssignScope(session.user.role)) {
          const scope = await resolveViewerOrgChartSectionScope(session.user.email);
          const allowed = new Set(scope.agentIds);
          const companyAgents = mainAssigneeCompanyId
            ? new Set(await loadAgentIdsForCompanyTeam(mainAssigneeCompanyId))
            : null;
          if (
            !allowed.has(assignee.id) ||
            (companyAgents && !companyAgents.has(assignee.id))
          ) {
            return NextResponse.json(
              {
                error:
                  "Sub-task assignee must be within your company and org-chart department scope.",
              },
              { status: 403 },
            );
          }
        }
      }
    }
    const updatedJson = timelineProject
      ? setItProjectSubKpiAssignee(kpiRow.subKpis, subKpiIdAssign, assignee)
      : setSubKpiItemAssignee(kpiRow.subKpis, subKpiIdAssign, assignee);
    const updated = await prisma.kpiMaintenance.update({
      where: { id },
      data: { subKpis: updatedJson },
    });
    return respondUpdated(updated);
  }

  if (body.seekAssistance != null && typeof body.seekAssistance === "object") {
    if (!isAssignee) {
      return NextResponse.json(
        { error: "Only the main assignee can seek assistance on subtasks." },
        { status: 403 },
      );
    }
    const fromArray = Array.isArray(body.seekAssistance.subKpiIds)
      ? body.seekAssistance.subKpiIds.map((x) => String(x ?? "").trim()).filter(Boolean)
      : [];
    const single = String(body.seekAssistance.subKpiId ?? "").trim();
    const seekIds = [...new Set([...fromArray, ...(single ? [single] : [])])];
    if (seekIds.length === 0) {
      return NextResponse.json(
        { error: "seekAssistance.subKpiId or seekAssistance.subKpiIds is required." },
        { status: 400 },
      );
    }
    for (const seekId of seekIds) {
      if (!subKpiItems.find((it) => it.id === seekId)) {
        return NextResponse.json({ error: "Sub-task not found." }, { status: 404 });
      }
    }
    if (kpiRow.enableSubtaskAssignees) {
      return NextResponse.json(
        { error: "Subtask assignees are already enabled for this task." },
        { status: 400 },
      );
    }
    const pendingIds = seekIds.filter((seekId) => {
      const target = subKpiItems.find((it) => it.id === seekId);
      return Boolean(target && !target.assistanceRequested);
    });
    if (pendingIds.length === 0) {
      const updated = await prisma.kpiMaintenance.findUnique({ where: { id } });
      return respondUpdated(updated);
    }
    const byAgentId = perms.operator!.id;
    const updatedJson = timelineProject
      ? setItProjectSubKpiItemsAssistanceRequested(kpiRow.subKpis, pendingIds, byAgentId)
      : setSubKpiItemsAssistanceRequested(kpiRow.subKpis, pendingIds, byAgentId);
    if (!updatedJson) {
      return NextResponse.json({ error: "Sub-task not found." }, { status: 404 });
    }
    const updated = await prisma.kpiMaintenance.update({
      where: { id },
      data: { subKpis: updatedJson },
    });
    return respondUpdated(updated);
  }

  if (body.pillarScreenshot != null && typeof body.pillarScreenshot === "object") {
    const slot = body.pillarScreenshot.slot;
    if (slot !== "before" && slot !== "after" && slot !== "general") {
      return NextResponse.json({ error: "Screenshot slot (before/after/general) is required." }, { status: 400 });
    }
    if (isItProjectImplementationPillar(kpiRow.title)) {
      return NextResponse.json(
        { error: "Pillar screenshots are not available for IT Project Implementation tasks." },
        { status: 400 },
      );
    }
    if (!perms.canAssignWork && !isAssignee) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (slot === "general") {
      if (
        !pillarScreenshotUploadEnabled(kpiRow.subKpis) &&
        !getPillarCompletionRequirements(kpiRow.subKpis)?.screenshotUpload
      ) {
        return NextResponse.json(
          { error: "Pillar screenshot uploads were not enabled when this task was created." },
          { status: 400 },
        );
      }
    } else if (
      !pillarScreenshotsEnabled(kpiRow.subKpis) &&
      !getPillarCompletionRequirements(kpiRow.subKpis)?.screenshots
    ) {
      return NextResponse.json(
        { error: "Pillar before/after screenshots were not enabled for this task." },
        { status: 400 },
      );
    }
    if (screenshotFiles.length === 0) {
      return NextResponse.json({ error: "Screenshot file is required." }, { status: 400 });
    }
    const existingScreenshots = getPillarScreenshots(kpiRow.subKpis, slot);
    if (existingScreenshots.length + screenshotFiles.length > MAX_TASK_SCREENSHOTS_PER_SLOT) {
      return NextResponse.json(
        { error: `You can upload up to ${MAX_TASK_SCREENSHOTS_PER_SLOT} ${slot} screenshots per pillar.` },
        { status: 400 },
      );
    }
    for (const file of screenshotFiles) {
      const fileCheck = validateTaskScreenshotFile(file);
      if (!fileCheck.ok) {
        return NextResponse.json({ error: fileCheck.error }, { status: 400 });
      }
    }
    const uploaded = await Promise.all(screenshotFiles.map((file) => persistTaskScreenshot(kpiRow.id, file)));
    let updatedJson = setPillarScreenshots(kpiRow.subKpis, slot, [
      ...existingScreenshots,
      ...uploaded,
    ]);
    if (isPillarOnlyTask(updatedJson)) {
      updatedJson = syncPillarDoneFromRequirements(updatedJson);
    }
    const prevComplete = checklistFullyComplete(kpiRow.subKpis, kpiMainTaskLabel(kpiRow));
    const nextComplete = checklistFullyComplete(updatedJson, kpiMainTaskLabel(kpiRow));
    let lastFullCompletionAt: Date | null | undefined;
    if (!prevComplete && nextComplete) lastFullCompletionAt = new Date();
    else if (prevComplete && !nextComplete) lastFullCompletionAt = null;
    const updated = await prisma.kpiMaintenance.update({
      where: { id },
      data: {
        subKpis: updatedJson,
        ...(lastFullCompletionAt !== undefined ? { lastFullCompletionAt } : {}),
      },
    });
    dumpOverallKpiToMerged();
    return respondUpdated(updated);
  }

  if (body.pillarScreenshotDelete != null && typeof body.pillarScreenshotDelete === "object") {
    const slot = body.pillarScreenshotDelete.slot;
    const storedFileName = String(body.pillarScreenshotDelete.storedFileName ?? "").trim();
    if (slot !== "before" && slot !== "after" && slot !== "general") {
      return NextResponse.json({ error: "Screenshot slot (before/after/general) is required." }, { status: 400 });
    }
    if (!storedFileName) {
      return NextResponse.json({ error: "storedFileName is required." }, { status: 400 });
    }
    if (isItProjectImplementationPillar(kpiRow.title)) {
      return NextResponse.json(
        { error: "Pillar screenshots are not available for IT Project Implementation tasks." },
        { status: 400 },
      );
    }
    if (!perms.canAssignWork && !isAssignee) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (checklistFullyComplete(kpiRow.subKpis, kpiMainTaskLabel(kpiRow))) {
      return NextResponse.json({ error: "Screenshots cannot be removed after the task card reaches Done." }, { status: 400 });
    }
    const existingScreenshots = getPillarScreenshots(kpiRow.subKpis, slot);
    if (!existingScreenshots.some((item) => item.storedFileName === storedFileName)) {
      return NextResponse.json({ error: "Screenshot not found." }, { status: 404 });
    }
    const updatedJson = removePillarScreenshot(kpiRow.subKpis, slot, storedFileName);
    let syncedJson = isPillarOnlyTask(updatedJson)
      ? syncPillarDoneFromRequirements(updatedJson)
      : updatedJson;
    const updated = await prisma.kpiMaintenance.update({
      where: { id },
      data: { subKpis: syncedJson },
    });
    return respondUpdated(updated);
  }

  if (body.subKpiScreenshot != null && typeof body.subKpiScreenshot === "object") {
    const subKpiIdShot = String(body.subKpiScreenshot.subKpiId ?? "").trim();
    const slot = body.subKpiScreenshot.slot;
    if (!subKpiIdShot || (slot !== "before" && slot !== "after" && slot !== "general")) {
      return NextResponse.json(
        { error: "subKpiId and screenshot slot (before/after/general) are required." },
        { status: 400 },
      );
    }
    if (isItProjectImplementationPillar(kpiRow.title)) {
      return NextResponse.json(
        { error: "Screenshots are not available for IT Project Implementation tasks." },
        { status: 400 },
      );
    }
    if (!perms.canAssignWork && !canEditSubKpi(subKpiIdShot)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const target = subKpiItems.find((it) => it.id === subKpiIdShot);
    if (!target) {
      return NextResponse.json({ error: "Sub-task not found." }, { status: 404 });
    }
    if (slot === "general") {
      if (!subKpiScreenshotUploadRequired(target)) {
        return NextResponse.json(
          { error: "Screenshot upload is not enabled for this sub-task." },
          { status: 400 },
        );
      }
    } else if (!subKpiScreenshotsRequired(target)) {
      return NextResponse.json(
        { error: "Before/after screenshots are not required for this sub-task." },
        { status: 400 },
      );
    }
    if (screenshotFiles.length === 0) {
      return NextResponse.json({ error: "Screenshot file is required." }, { status: 400 });
    }
    const existingScreenshots = subKpiScreenshotList(target, slot);
    if (existingScreenshots.length + screenshotFiles.length > MAX_TASK_SCREENSHOTS_PER_SLOT) {
      return NextResponse.json(
        { error: `You can upload up to ${MAX_TASK_SCREENSHOTS_PER_SLOT} ${slot} screenshots per sub-task.` },
        { status: 400 },
      );
    }
    for (const file of screenshotFiles) {
      const fileCheck = validateTaskScreenshotFile(file);
      if (!fileCheck.ok) {
        return NextResponse.json({ error: fileCheck.error }, { status: 400 });
      }
    }
    const uploaded = await Promise.all(screenshotFiles.map((file) => persistTaskScreenshot(kpiRow.id, file)));
    let updatedJson = setSubKpiItemScreenshots(kpiRow.subKpis, subKpiIdShot, slot, [
      ...existingScreenshots,
      ...uploaded,
    ]);
    updatedJson = syncScreenshotOnlySubKpiDone(updatedJson, subKpiIdShot);
    const prevComplete = checklistFullyComplete(kpiRow.subKpis, kpiMainTaskLabel(kpiRow));
    const nextComplete = checklistFullyComplete(updatedJson, kpiMainTaskLabel(kpiRow));
    let lastFullCompletionAt: Date | null | undefined;
    if (!prevComplete && nextComplete) lastFullCompletionAt = new Date();
    else if (prevComplete && !nextComplete) lastFullCompletionAt = null;
    const updated = await prisma.kpiMaintenance.update({
      where: { id },
      data: {
        subKpis: updatedJson,
        ...(nextComplete ? { rolledOverIncomplete: false } : {}),
        ...(lastFullCompletionAt !== undefined ? { lastFullCompletionAt } : {}),
      },
    });
    await afterProgressAffectingUpdate(updatedJson);
    return respondUpdated(updated);
  }

  if (body.subKpiScreenshotDelete != null && typeof body.subKpiScreenshotDelete === "object") {
    const subKpiIdShot = String(body.subKpiScreenshotDelete.subKpiId ?? "").trim();
    const slot = body.subKpiScreenshotDelete.slot;
    const storedFileName = String(body.subKpiScreenshotDelete.storedFileName ?? "").trim();
    if (!subKpiIdShot || (slot !== "before" && slot !== "after" && slot !== "general")) {
      return NextResponse.json(
        { error: "subKpiId and screenshot slot (before/after/general) are required." },
        { status: 400 },
      );
    }
    if (!storedFileName) {
      return NextResponse.json({ error: "storedFileName is required." }, { status: 400 });
    }
    if (isItProjectImplementationPillar(kpiRow.title)) {
      return NextResponse.json(
        { error: "Screenshots are not available for IT Project Implementation tasks." },
        { status: 400 },
      );
    }
    if (!perms.canAssignWork && !canEditSubKpi(subKpiIdShot)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (checklistFullyComplete(kpiRow.subKpis, kpiMainTaskLabel(kpiRow))) {
      return NextResponse.json({ error: "Screenshots cannot be removed after the task card reaches Done." }, { status: 400 });
    }
    const target = subKpiItems.find((it) => it.id === subKpiIdShot);
    if (!target) {
      return NextResponse.json({ error: "Sub-task not found." }, { status: 404 });
    }
    if (target.done) {
      return NextResponse.json({ error: "Screenshots cannot be removed after the sub-task is done." }, { status: 400 });
    }
    const existingScreenshots = subKpiScreenshotList(target, slot);
    if (!existingScreenshots.some((item) => item.storedFileName === storedFileName)) {
      return NextResponse.json({ error: "Screenshot not found." }, { status: 404 });
    }
    let updatedJson = removeSubKpiItemScreenshot(kpiRow.subKpis, subKpiIdShot, slot, storedFileName);
    updatedJson = syncScreenshotOnlySubKpiDone(updatedJson, subKpiIdShot);
    const prevComplete = checklistFullyComplete(kpiRow.subKpis, kpiMainTaskLabel(kpiRow));
    const nextComplete = checklistFullyComplete(updatedJson, kpiMainTaskLabel(kpiRow));
    let lastFullCompletionAt: Date | null | undefined;
    if (!prevComplete && nextComplete) lastFullCompletionAt = new Date();
    else if (prevComplete && !nextComplete) lastFullCompletionAt = null;
    const updated = await prisma.kpiMaintenance.update({
      where: { id },
      data: {
        subKpis: updatedJson,
        ...(nextComplete ? { rolledOverIncomplete: false } : {}),
        ...(lastFullCompletionAt !== undefined ? { lastFullCompletionAt } : {}),
      },
    });
    await afterProgressAffectingUpdate(updatedJson);
    return respondUpdated(updated);
  }

  if (Object.prototype.hasOwnProperty.call(body, "assignedAgentId")) {
    if (!perms.canAssignWork) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const reassignedAgentId = body.assignedAgentId?.trim() ?? "";
    if (!reassignedAgentId) {
      if (!isElevatedUserRole(session.user.role)) {
        return NextResponse.json({ error: "Only SuperAdmin can move tasks back to unassigned." }, { status: 403 });
      }
      const updated = await prisma.kpiMaintenance.update({
        where: { id },
        data: {
          assignedAgentId: null,
          assignedRole: null,
        },
      });
      return respondUpdated(updated);
    }
    const assignee = await prisma.agent.findUnique({
      where: { id: reassignedAgentId },
      include: { team: true },
    });
    if (!assignee) {
      return NextResponse.json({ error: "Assignee not found." }, { status: 404 });
    }
    if (
      !isElevatedUserRole(session.user.role) &&
      (await isTaskAssignmentOnDutyRequired()) &&
      !(await isAgentOnDutyFromMergedDb(assignee.id))
    ) {
      return NextResponse.json(
        { error: "Assignee is Offline (no merged DB clock-in today). Only On Duty personnel can be assigned." },
        { status: 400 },
      );
    }
    if (hasSubKpiAssignedTo(kpiRow.subKpis, assignee.id)) {
      return NextResponse.json(
        { error: "This person is already assigned as a sub-task assignee. Choose a different main assignee first." },
        { status: 400 },
      );
    }
    // Admin / Personnel: must stay within company ∩ org-chart department scope.
    if (roleUsesCompanyDepartmentTaskAssignScope(session.user.role)) {
      const companyId = await resolveStaffCompanyTeamId(session.user.email);
      const sectionScope = await resolveViewerOrgChartSectionScope(session.user.email);
      const sectionAgents = new Set(sectionScope.agentIds);
      const companyAgents = companyId
        ? new Set(await loadAgentIdsForCompanyTeam(companyId))
        : new Set<string>();
      const allowed =
        companyId && sectionAgents.size > 0
          ? [...sectionAgents].filter((id) => companyAgents.has(id))
          : companyId
            ? [...companyAgents]
            : [...sectionAgents];
      if (!allowed.includes(assignee.id)) {
        return NextResponse.json(
          {
            error:
              "Assignee must be within your company and org-chart department scope.",
          },
          { status: 403 },
        );
      }
    }
    const assignedRole = (await portalCompanyAdminPrivilegesForEmail(assignee.email))
      ? "Admin Role"
      : "Personnel";
    const updated = await prisma.kpiMaintenance.update({
      where: { id },
      data: {
        assignedAgentId: assignee.id,
        assignedRole,
      },
    });
    return respondUpdated(updated);
  }

  if (body.addSubKpi != null && typeof body.addSubKpi === "object") {
    if (!perms.isAdminRole) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (isItProjectImplementationPillar(kpiRow.title)) {
      return NextResponse.json(
        { error: "Use task management to edit IT Project Implementation checklists." },
        { status: 400 },
      );
    }
    const title = String(body.addSubKpi.title ?? "").trim();
    if (!title) {
      return NextResponse.json({ error: "Sub Task title is required." }, { status: 400 });
    }
    const result = appendSubKpiItem(kpiRow.subKpis, {
      title,
      description: body.addSubKpi.description,
      remarks: body.addSubKpi.remarks,
      segmentId: body.addSubKpi.segmentId,
      startDate: body.addSubKpi.startDate,
      dueDate: body.addSubKpi.dueDate,
      dueDateRollsWithCycle: body.addSubKpi.dueDateRollsWithCycle,
      projectPriority: body.addSubKpi.projectPriority,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    const prevComplete = checklistFullyComplete(kpiRow.subKpis, kpiMainTaskLabel(kpiRow));
    const nextComplete = checklistFullyComplete(result.json, kpiMainTaskLabel(kpiRow));
    let lastFullCompletionAt: Date | null | undefined;
    if (!prevComplete && nextComplete) lastFullCompletionAt = new Date();
    else if (prevComplete && !nextComplete) lastFullCompletionAt = null;

    const updated = await prisma.kpiMaintenance.update({
      where: { id },
      data: {
        subKpis: result.json,
        ...(nextComplete ? { rolledOverIncomplete: false } : {}),
        ...(lastFullCompletionAt !== undefined ? { lastFullCompletionAt } : {}),
      },
    });
    await afterProgressAffectingUpdate(result.json);
    return respondUpdated(updated);
  }

  if (body.updateSubKpi != null && typeof body.updateSubKpi === "object") {
    if (!perms.isAdminRole) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const subKpiIdUpdate = String(body.updateSubKpi.subKpiId ?? "").trim();
    if (!subKpiIdUpdate) {
      return NextResponse.json({ error: "updateSubKpi.subKpiId is required." }, { status: 400 });
    }
    const hasTitle = body.updateSubKpi.title !== undefined;
    const hasDescription = body.updateSubKpi.description !== undefined;
    const hasRemarks = body.updateSubKpi.remarks !== undefined;
    const hasStartDate = body.updateSubKpi.startDate !== undefined;
    const hasDueDate = body.updateSubKpi.dueDate !== undefined;
    const hasDueDateRollsWithCycle = body.updateSubKpi.dueDateRollsWithCycle !== undefined;
    const hasPriority = body.updateSubKpi.projectPriority !== undefined;
    const hasCompletionMode = body.updateSubKpi.completionMode !== undefined;
    const hasCompletionRequirements = body.updateSubKpi.completionRequirements !== undefined;
    const hasNumericalTarget = body.updateSubKpi.numericalTarget !== undefined;
    const hasDailyPenalty = body.updateSubKpi.dailyPenaltyAmount !== undefined;
    const hasDelayFrequency = body.updateSubKpi.delayPenaltyFrequency !== undefined;
    const isItProjectRow = isItProjectImplementationPillar(kpiRow.title);
    const isTimelineProject = isTimelineProjectKpi(kpiRow.title, kpiRow.subKpis);
    if (isTimelineProject || isItProjectRow) {
      const hasNonTitleNonPenalty =
        hasDescription ||
        hasRemarks ||
        hasStartDate ||
        hasDueDate ||
        hasPriority ||
        hasCompletionMode ||
        hasCompletionRequirements ||
        hasNumericalTarget ||
        hasDueDateRollsWithCycle;
      if (hasNonTitleNonPenalty) {
        return NextResponse.json(
          { error: "Use task management to edit project timeline checklists." },
          { status: 400 },
        );
      }
      if (hasTitle && !isPlatformSuperAdminPortalRole(session.user.role)) {
        return NextResponse.json(
          { error: "Only SuperAdmin can edit project subtask titles." },
          { status: 403 },
        );
      }
      if (!hasTitle && !hasDailyPenalty && !hasDelayFrequency) {
        return NextResponse.json(
          {
            error:
              "Provide title, dailyPenaltyAmount, and/or delayPenaltyFrequency to update a project Sub Task.",
          },
          { status: 400 },
        );
      }
      let nextJson: Prisma.InputJsonValue =
        (kpiRow.subKpis as Prisma.InputJsonValue | null) ?? [];
      if (hasTitle) {
        const titleResult = setItProjectSubKpiTitle(
          kpiRow.subKpis,
          subKpiIdUpdate,
          String(body.updateSubKpi.title ?? ""),
        );
        if (!titleResult.ok) {
          return NextResponse.json({ error: titleResult.error }, { status: 400 });
        }
        nextJson = titleResult.json;
      }
      if (hasDailyPenalty || hasDelayFrequency) {
        const penaltyResult = setItProjectSubKpiPenalty(nextJson, subKpiIdUpdate, {
          ...(hasDailyPenalty ? { dailyPenaltyAmount: body.updateSubKpi.dailyPenaltyAmount ?? null } : {}),
          ...(hasDelayFrequency
            ? { delayPenaltyFrequency: body.updateSubKpi.delayPenaltyFrequency ?? null }
            : {}),
        });
        if (!penaltyResult.ok) {
          return NextResponse.json({ error: penaltyResult.error }, { status: 400 });
        }
        nextJson = penaltyResult.json;
      }
      const updated = await prisma.kpiMaintenance.update({
        where: { id },
        data: { subKpis: nextJson },
      });
      triggerEfficiencyRecomputeBackground();
      return respondUpdated(updated);
    }
    if (
      !hasTitle &&
      !hasDescription &&
      !hasRemarks &&
      !hasStartDate &&
      !hasDueDate &&
      !hasDueDateRollsWithCycle &&
      !hasPriority &&
      !hasCompletionMode &&
      !hasCompletionRequirements &&
      !hasNumericalTarget &&
      !hasDailyPenalty &&
      !hasDelayFrequency
    ) {
      return NextResponse.json(
        {
          error:
            "Provide title, description, remarks, startDate, dueDate, dueDateRollsWithCycle, projectPriority, completionMode, completionRequirements, numericalTarget, dailyPenaltyAmount, and/or delayPenaltyFrequency to update a Sub Task.",
        },
        { status: 400 },
      );
    }
    // Per-subtask delay penalties apply to one-off and recurring tasks (custom due / cycle end).
    if (hasStartDate) {
      return NextResponse.json(
        { error: "Sub-task schedule dates are not used for maintenance tasks." },
        { status: 400 },
      );
    }
    if (
      hasCompletionMode &&
      !isSubKpiCompletionMode(body.updateSubKpi.completionMode)
    ) {
      return NextResponse.json({ error: "Invalid completionMode." }, { status: 400 });
    }
    // Numerical target: editable for the active period while the task is running.
    if (hasNumericalTarget) {
      if (
        !canAdjustNumericalTarget({
          isRecurring: kpiRow.isRecurring !== false,
          subKpisRaw: kpiRow.subKpis,
          subKpiId: subKpiIdUpdate,
        })
      ) {
        return NextResponse.json(
          { error: "Target number cannot be changed for this task." },
          { status: 403 },
        );
      }
      const nextTarget = body.updateSubKpi.numericalTarget;
      if (nextTarget != null && (!Number.isFinite(nextTarget) || nextTarget <= 0)) {
        return NextResponse.json({ error: "numericalTarget must be a positive number." }, { status: 400 });
      }
    }
    const result = updateSubKpiItem(kpiRow.subKpis, subKpiIdUpdate, {
      ...(hasTitle ? { title: body.updateSubKpi.title } : {}),
      ...(hasDescription ? { description: body.updateSubKpi.description ?? null } : {}),
      ...(hasRemarks ? { remarks: body.updateSubKpi.remarks ?? null } : {}),
      ...(hasStartDate ? { startDate: body.updateSubKpi.startDate } : {}),
      ...(hasDueDate ? { dueDate: body.updateSubKpi.dueDate } : {}),
      ...(hasDueDateRollsWithCycle
        ? { dueDateRollsWithCycle: body.updateSubKpi.dueDateRollsWithCycle === true }
        : {}),
      ...(hasPriority ? { projectPriority: body.updateSubKpi.projectPriority ?? null } : {}),
      ...(hasCompletionMode && !hasCompletionRequirements
        ? { completionMode: body.updateSubKpi.completionMode as SubKpiCompletionMode }
        : {}),
      ...(hasCompletionRequirements
        ? { completionRequirements: body.updateSubKpi.completionRequirements ?? null }
        : {}),
      ...(hasNumericalTarget ? { numericalTarget: body.updateSubKpi.numericalTarget ?? null } : {}),
      ...(hasDailyPenalty ? { dailyPenaltyAmount: body.updateSubKpi.dailyPenaltyAmount ?? null } : {}),
      ...(hasDelayFrequency
        ? {
            delayPenaltyFrequency:
              body.updateSubKpi.delayPenaltyFrequency == null
                ? null
                : (body.updateSubKpi.delayPenaltyFrequency as "DAILY" | "WEEKLY" | "MONTHLY"),
          }
        : {}),
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    const prevComplete = checklistFullyComplete(kpiRow.subKpis, kpiMainTaskLabel(kpiRow));
    const nextComplete = checklistFullyComplete(result.json, kpiMainTaskLabel(kpiRow));
    let lastFullCompletionAt: Date | null | undefined;
    if (!prevComplete && nextComplete) lastFullCompletionAt = new Date();
    else if (prevComplete && !nextComplete) lastFullCompletionAt = null;

    const updated = await prisma.kpiMaintenance.update({
      where: { id },
      data: {
        subKpis: result.json,
        ...(nextComplete ? { rolledOverIncomplete: false } : {}),
        ...(lastFullCompletionAt !== undefined ? { lastFullCompletionAt } : {}),
      },
    });
    await afterProgressAffectingUpdate(result.json);
    if (hasDailyPenalty || hasDelayFrequency) {
      triggerEfficiencyRecomputeBackground();
    }
    return respondUpdated(updated);
  }

  if (body.removeSubKpi != null && typeof body.removeSubKpi === "object") {
    if (!perms.isAdminRole) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (isItProjectImplementationPillar(kpiRow.title)) {
      return NextResponse.json(
        { error: "Use task management to edit IT Project Implementation checklists." },
        { status: 400 },
      );
    }
    const subKpiIdRemove = String(body.removeSubKpi.subKpiId ?? "").trim();
    if (!subKpiIdRemove) {
      return NextResponse.json({ error: "removeSubKpi.subKpiId is required." }, { status: 400 });
    }
    const result = removeSubKpiItem(kpiRow.subKpis, subKpiIdRemove);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    const prevComplete = checklistFullyComplete(kpiRow.subKpis, kpiMainTaskLabel(kpiRow));
    const nextComplete = checklistFullyComplete(result.json, kpiMainTaskLabel(kpiRow));
    let lastFullCompletionAt: Date | null | undefined;
    if (!prevComplete && nextComplete) lastFullCompletionAt = new Date();
    else if (prevComplete && !nextComplete) lastFullCompletionAt = null;

    const updated = await prisma.kpiMaintenance.update({
      where: { id },
      data: {
        subKpis: result.json,
        ...(nextComplete ? { rolledOverIncomplete: false } : {}),
        ...(lastFullCompletionAt !== undefined ? { lastFullCompletionAt } : {}),
      },
    });
    await afterProgressAffectingUpdate(result.json);
    return respondUpdated(updated);
  }

  if (body.taskSchedule != null && typeof body.taskSchedule === "object") {
    if (!perms.isAdminRole) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (isItProjectImplementationPillar(kpiRow.title)) {
      return NextResponse.json(
        { error: "IT Project Implementation tasks do not use task schedule types." },
        { status: 400 },
      );
    }

    const schedule = body.taskSchedule;
    const isRecurring = schedule.isRecurring !== false;
    const frequency = (schedule.frequency?.toUpperCase() ?? kpiRow.frequency) as KpiFrequency;
    if (!allowedFrequencies.has(frequency)) {
      return NextResponse.json({ error: "Invalid frequency." }, { status: 400 });
    }

    let recurrenceWeekday: number | null = null;
    let recurrenceMonthDay: number | null = null;
    if (isRecurring && frequency === "WEEKLY") {
      const wd = schedule.recurrenceWeekday ?? kpiRow.recurrenceWeekday ?? 1;
      if (typeof wd !== "number" || wd < 0 || wd > 6 || !Number.isInteger(wd)) {
        return NextResponse.json(
          { error: "recurrenceWeekday is required for WEEKLY (0=Sunday … 6=Saturday)." },
          { status: 400 },
        );
      }
      recurrenceWeekday = wd;
    }
    if (isRecurring && (frequency === "MONTHLY" || frequency === "QUARTERLY" || frequency === "SEMI_ANNUAL" || frequency === "YEARLY")) {
      const dom = schedule.recurrenceMonthDay ?? kpiRow.recurrenceMonthDay ?? 1;
      if (typeof dom !== "number" || dom < 1 || dom > 31 || !Number.isInteger(dom)) {
        return NextResponse.json(
          { error: "recurrenceMonthDay is required for MONTHLY/QUARTERLY/SEMI_ANNUAL/YEARLY (1–31)." },
          { status: 400 },
        );
      }
      recurrenceMonthDay = dom;
    }

    if (kpiRow.isRecurring) {
      await afterProgressAffectingUpdate(kpiRow.subKpis);
    }

    const now = new Date();
    const freqCode = frequency as KpiFrequencyCode;
    let subKpisUpdate: Prisma.InputJsonValue | undefined;
    if (isRecurring && freqCode === "DAILY" && kpiRow.frequency !== "DAILY") {
      subKpisUpdate = stripSubKpiStartDates(kpiRow.subKpis);
    }

    const data: Prisma.KpiMaintenanceUpdateInput = {
      isRecurring,
      frequency,
      ...(subKpisUpdate !== undefined ? { subKpis: subKpisUpdate } : {}),
    };

    if (isRecurring) {
      data.nonRecurringStartAt = null;
      data.nonRecurringEndAt = null;
      data.recurrenceWeekday = recurrenceWeekday;
      data.recurrenceMonthDay = recurrenceMonthDay;
      data.periodCycleStartAt = getPeriodStartInclusive(
        freqCode,
        recurrenceWeekday,
        recurrenceMonthDay,
        now,
        patchTz,
      );
      data.periodKey = computePeriodKey(freqCode, recurrenceWeekday, recurrenceMonthDay, now, patchTz);
      data.rolledOverIncomplete = false;
    } else {
      data.nonRecurringStartAt = null;
      data.nonRecurringEndAt = null;
      data.recurrenceWeekday = null;
      data.recurrenceMonthDay = null;
      data.periodCycleStartAt = null;
      data.periodKey = null;
      data.lastFullCompletionAt = null;
      data.rolledOverIncomplete = false;
    }

    const updated = await prisma.kpiMaintenance.update({
      where: { id },
      data,
    });
    if (isRecurring) {
      await upsertKpiPeriodSnapshot(
        {
          id: updated.id,
          title: updated.title,
          frequency: updated.frequency,
          subKpis: updated.subKpis,
          periodKey: updated.periodKey,
          recurrenceWeekday: updated.recurrenceWeekday,
          recurrenceMonthDay: updated.recurrenceMonthDay,
          periodCycleStartAt: updated.periodCycleStartAt,
          isRecurring: updated.isRecurring,
          assignedAgent: kpiRow.assignedAgent
            ? { id: kpiRow.assignedAgent.id, name: kpiRow.assignedAgent.name }
            : null,
        },
        patchTz,
      );
    }
    return respondUpdated(updated);
  }

  if (body.structuredSubKpis !== undefined) {
    if (!isAssignee) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const validated = validateStructuredUpdate(body.structuredSubKpis);
    if (!validated.ok) {
      return NextResponse.json({ error: validated.error }, { status: 400 });
    }
    if (isItProjectImplementationPillar(kpiRow.title)) {
      return NextResponse.json(
        { error: "Use phase controls to edit IT Project Implementation checklists." },
        { status: 400 },
      );
    }
    const wrapped = wrapForPersistWithExistingMeta(validated.norm, kpiRow.subKpis);
    const prevComplete = checklistFullyComplete(kpiRow.subKpis, kpiMainTaskLabel(kpiRow));
    const nextComplete = checklistFullyComplete(wrapped, kpiMainTaskLabel(kpiRow));
    let lastFullCompletionAt: Date | null | undefined;
    if (!prevComplete && nextComplete) lastFullCompletionAt = new Date();
    else if (prevComplete && !nextComplete) lastFullCompletionAt = null;

    const updated = await prisma.kpiMaintenance.update({
      where: { id },
      data: {
        subKpis: wrapped,
        ...(nextComplete ? { rolledOverIncomplete: false } : {}),
        ...(lastFullCompletionAt !== undefined ? { lastFullCompletionAt } : {}),
      },
    });
    await afterProgressAffectingUpdate(wrapped);
    return respondUpdated(updated);
  }

  const markAllDone = body.markAllDone;
  const subKpiId = body.subKpiId?.trim() ?? "";
  if (subKpiId && !canCompleteSubKpi(subKpiId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!subKpiId && !isAssignee && !isElevatedUserRole(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (typeof markAllDone !== "boolean" && (!subKpiId || typeof body.done !== "boolean")) {
    return NextResponse.json(
      { error: "Provide either markAllDone OR (subKpiId + done). Use structuredSubKpis to reorganize checklist." },
      { status: 400 },
    );
  }
  if (!isItProjectImplementationPillar(kpiRow.title) && subKpiId && body.done === true) {
    const target = subKpiItems.find((it) => it.id === subKpiId);
    if (target) {
      const mode = resolveSubKpiCompletionMode(target);
      if (mode === "screenshots") {
        return NextResponse.json(
          { error: "This sub-task completes when before and after screenshots are uploaded." },
          { status: 400 },
        );
      }
      if (mode === "both" && !hasBeforeAndAfterScreenshots(target)) {
        return NextResponse.json(
          { error: "Upload both before and after screenshots before marking this sub-task done." },
          { status: 400 },
        );
      }
    }
  }

  let updatedJson: Prisma.InputJsonValue;
  if (isItProjectImplementationPillar(kpiRow.title)) {
    if (typeof markAllDone === "boolean") {
      return NextResponse.json(
        { error: "Mark-all is not supported for IT Project Implementation. Complete each sub-task with an actual date." },
        { status: 400 },
      );
    }
    const toggled = setItProjectSubKpiDone(kpiRow.subKpis, subKpiId, body.done!);
    if (!toggled.ok) {
      return NextResponse.json({ error: toggled.error }, { status: 400 });
    }
    updatedJson = toggled.json;
  } else {
    updatedJson =
      typeof markAllDone === "boolean"
        ? markEverySubKpiDone(kpiRow.subKpis, markAllDone)
        : setSubKpiItemDone(kpiRow.subKpis, subKpiId, body.done!);
  }

  const prevComplete = checklistFullyComplete(kpiRow.subKpis, kpiMainTaskLabel(kpiRow));
  const nextComplete = checklistFullyComplete(updatedJson, kpiMainTaskLabel(kpiRow));
  let lastFullCompletionAt: Date | null | undefined;
  if (!prevComplete && nextComplete) lastFullCompletionAt = new Date();
  else if (prevComplete && !nextComplete) lastFullCompletionAt = null;

  const userResetProgress = typeof markAllDone === "boolean" && markAllDone === false;
  const updated = await prisma.kpiMaintenance.update({
    where: { id },
    data: {
      subKpis: updatedJson,
      ...(nextComplete ? { rolledOverIncomplete: false } : {}),
      ...(userResetProgress ? { rolledOverIncomplete: false } : {}),
      ...(lastFullCompletionAt !== undefined ? { lastFullCompletionAt } : {}),
    },
  });
  await afterProgressAffectingUpdate(updatedJson);
  return respondUpdated(updated);
}
