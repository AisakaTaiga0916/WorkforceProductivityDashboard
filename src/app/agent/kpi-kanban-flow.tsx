"use client";

import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, GripVertical, ListChecks, Maximize2, Pencil, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { AgentAssigneeSearch, AssigneeAvatar, type AssigneeSearchAgent } from "@/components/agent-assignee-search";
import { normalizePersonName } from "@/lib/person-name";
import { PointerDragGhostLayer, usePointerColumnDrag } from "@/lib/pointer-column-drag";
import {
  incompletePastDeadlineDelayMs,
  nonRecurringDeadline,
  nonRecurringTaskDelayDeadline,
  recurringDeadlineExclusive,
  recurringIncompleteRolloverEligibleAt,
  recurringIncompleteRolloverHoldDays,
  taskKanbanDerivedStatus,
} from "@/lib/kpi-cycle-state";
import { DEFAULT_TIME_ZONE, type KpiFrequencyCode } from "@/lib/kpi-recurrence";
import {
  donutKeyForTaskMetricsRow,
  FIELD_ASSIGNMENT_DONUT_KEY,
  PROJECTS_DONUT_KEY,
  TASK_FREQUENCY_DONUT_KEYS,
} from "@/lib/task-metrics-task-type";
import {
  IT_PROJECT_PRIORITY_OPTIONS,
  IT_PROJECT_STATUS_OPTIONS,
  isItProjectSubTaskDelayed,
  isTimelineProjectKpi,
  itProjectStatusProgress,
  itProjectAggregatedProgressFromRaw,
  itProjectChecklistItems,
  parseItProjectSubKpis,
  resolvePhaseEffectiveTargetDate,
  setItProjectSubKpiLifecycle,
  usesProjectTimelineTracker,
  type ItProjectPhase,
} from "@/lib/it-project-subkpis";
import { ProjectTimelineKanban } from "@/components/task-board/ProjectTimelineKanban";
import { kpiHasDistinctMainTask, kpiMainTaskLabel } from "@/lib/kpi-main-task";
import { isItProjectImplementationPillar } from "@/lib/it-task-pillar-titles";
import {
  kpiChecklistMetricView,
  kpiChecklistProgress,
  archivedNumericalEntriesForSubKpi,
  canAdjustNumericalTarget,
  collectAllSubKpiItems,
  collectChecklistProgressItems,
  listPendingVerificationSubKpiItems,
  getPillarScreenshots,
  getPillarCompletionRequirements,
  getTaskPriority,
  getTaskTargetDueDate,
  isPillarOnlyTask,
  isMainTaskOnlyRecord,
  mainTaskCheckboxItem,
  isFieldAssignmentTask,
  isProjectTask,
  hasSubKpiAssignedTo,
  normalizeSubKpis,
  pillarScreenshotUploadEnabled,
  pillarScreenshotsEnabled,
  subKpiAssignedAgentId,
  subKpiAssignedToOperator,
  subKpiHasCustomDueDate,
  subKpiDueDateRollsWithCycle,
  subKpiProgressMismatchWarning,
  taskDailyPenaltyAmountFromSubKpis,
  taskDelayPenaltyFrequencyFromSubKpis,
  taskUsesInvertedRecording,
  SUB_KPI_PROGRESS_MISMATCH_WARNING,
  canMutateSubKpiAssignee,
  isSubKpiAssigneeUnlocked,
  PILLAR_ONLY_VIRTUAL_SUBKPI_ID,
  UNSEGMENTED_SEGMENT_ID,
  UNSEGMENTED_SEGMENT_LABEL,
  isUnsegmentedSegmentId,
  type SubKpiItem,
} from "@/lib/kpi-subkpis";
import {
  subKpiAccruedPenalty,
  subKpiPenaltyDays,
  resolveSubKpiDailyPenaltyAmount,
  resolveSubKpiDelayPenaltyFrequency,
  type SubKpiPenaltyContext,
} from "@/lib/task-delay-penalty";
import {
  DELAY_PENALTY_FREQUENCIES,
  delayPenaltyFrequencyLabel,
  type DelayPenaltyFrequency,
} from "@/lib/delay-penalty-frequency";
import {
  hasBeforeAndAfterScreenshots,
  hasNumericalRecord,
  hasScreenshotUpload,
  numericalRecordProgressPercent,
  resolveSubKpiCompletionRequirements,
  subKpiRequiresCheckbox,
  subKpiRequiresNumerical,
  subKpiRequiresScreenshots,
  subKpiRequiresScreenshotUpload,
  subKpiRequirementsMet,
  type SubKpiCompletionMode,
  type SubKpiCompletionRequirements,
} from "@/lib/sub-kpi-completion-mode";
import { hasValidActualDate } from "@/lib/us-date-format";
import {
  MAX_TASK_SCREENSHOT_BYTES,
  MAX_TASK_SCREENSHOTS_PER_SLOT,
  TASK_SCREENSHOT_ACCEPT,
} from "@/lib/task-screenshot-constants";
import type { TaskScreenshotSlot } from "@/lib/task-screenshot-meta";
import { parseTaskScreenshotMetaList } from "@/lib/task-screenshot-meta";
import { KpiDefinitionConsole } from "@/components/KpiDefinitionConsole";
import { SeekAssistanceModal } from "@/components/task-board/SeekAssistanceModal";
import { SubTasksManagerPopup } from "@/components/task-board/SubTasksManagerPopup";
import { TravelOrderSummaryPanel } from "@/components/task-board/TravelOrderSummaryPanel";
import { TravelOrderRequestModal } from "@/components/task-board/TravelOrderRequestModal";
import { TravelOrderApprovalModal } from "@/components/task-board/TravelOrderApprovalModal";
import { TravelOrderRfpEditModal } from "@/components/task-board/TravelOrderRfpEditModal";
import { TravelOrderOfflineBanner } from "@/components/offline/TravelOrderOfflineBanner";
import { TaskBoardPopup } from "@/components/task-board/TaskBoardPopup";
import type { TravelOrderDto } from "@/lib/travel-order";
import { isWorkPlanOrder } from "@/lib/work-plan";
import {
  cacheTravelOrders,
  deleteOfflineDraft,
  listAllCachedTravelOrders,
  listOfflineDrafts,
  offlineDraftAsListItem,
} from "@/lib/offline/travel-order-offline-db";
import { isElevatedPlatformRole, isPlatformSuperAdminPortalRole } from "@/lib/staff-role";
import { isBrowserOnline, fetchTravelOrderWithTimeout, isTravelOrderNetworkFailure, flushTravelOrderPendingQueue, subscribeTravelOrderConnectivity } from "@/lib/offline/travel-order-sync";
import { DatePickerField } from "@/components/ui/DatePickerField";
import {
  COMPLETION_VERIFICATION,
  isCompletionEffectivelyVerified,
  isSubKpiEffectivelyVerified,
  isSubKpiPendingVerification,
  isSubKpiVerificationRejected,
  laneStatusLabel,
  type KpiBoardLaneStatus,
} from "@/lib/task-completion-verification";

type KpiBoardStatus = KpiBoardLaneStatus;

function taskApprovalSeenIdsKey(operatorKey: string) {
  return `task-approval-seen-ids:${operatorKey}`;
}

function readTaskApprovalSeenIds(operatorKey: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(taskApprovalSeenIdsKey(operatorKey));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === "string" && id.trim().length > 0));
  } catch {
    return new Set();
  }
}

function writeTaskApprovalSeenIds(operatorKey: string, ids: Set<string>) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(taskApprovalSeenIdsKey(operatorKey), JSON.stringify([...ids]));
}

const ASSIGNMENT_NO_COMPANY = "__NO_COMPANY__";

function subTaskStatusLabel(s: SubKpiItem, nowMs: number, timeZone: string): string {
  if (isItProjectSubTaskDelayed(s, nowMs, timeZone)) return "Delayed";
  if (hasValidActualDate(s)) return "On time";
  return "Pending";
}

/** Thin-line icon: travel ticket + map pin (matches board outline iconography). */
function TravelOrdersIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M3.75 8.25a1.75 1.75 0 0 1 1.75-1.75h8.5a1.75 1.75 0 0 1 1.75 1.75v1.1a1.15 1.15 0 1 0 0 2.3v1.1a1.75 1.75 0 0 1-1.75 1.75h-8.5a1.75 1.75 0 0 1-1.75-1.75v-1.1a1.15 1.15 0 1 0 0-2.3v-1.1Z" />
      <path d="M7 9.25h4.25M7 12h3" />
      <path d="M18.25 6.75c0 2.35-2.75 5.25-2.75 5.25S12.75 9.1 12.75 6.75a2.75 2.75 0 1 1 5.5 0Z" />
      <circle cx="15.5" cy="6.75" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function ChecklistProgressRing({
  percent,
  strokeClassName,
  size = 52,
}: {
  percent: number;
  strokeClassName: string;
  size?: number;
}) {
  const clamped = Math.min(100, Math.max(0, percent));
  const stroke = 3.25;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (clamped / 100) * c;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} aria-hidden>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          className="stroke-zinc-200 dark:stroke-zinc-700/90"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          className={cn("transition-[stroke-dashoffset] duration-300", strokeClassName)}
          style={{ strokeDasharray: c, strokeDashoffset: offset }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-[11px] font-bold tabular-nums leading-none text-zinc-900 dark:text-zinc-50">
          {Math.round(clamped)}%
        </span>
      </div>
    </div>
  );
}

function laneProgressStrokeClass(col: KpiBoardStatus, itProject: boolean): string {
  if (col === "DONE") return "stroke-emerald-500 dark:stroke-emerald-400";
  if (col === "PENDING_VERIFICATION") return "stroke-violet-500 dark:stroke-violet-400";
  if (col === "DELAYED") return "stroke-rose-500 dark:stroke-rose-400";
  if (itProject) return "stroke-orange-500 dark:stroke-orange-400";
  return "stroke-blue-500 dark:stroke-blue-400";
}

type KpiRecord = {
  id: string;
  title: string;
  mainTask?: string | null;
  isRecurring?: boolean;
  nonRecurringStartAt?: string | null;
  nonRecurringEndAt?: string | null;
  frequency: KpiFrequencyCode;
  subKpis: unknown;
  createdAt: string;
  updatedAt: string;
  recurrenceWeekday?: number | null;
  recurrenceMonthDay?: number | null;
  /** Active cycle anchor (UTC); backlog rows may be null until first GET normalizes */
  periodCycleStartAt?: string | null;
  lastFullCompletionAt?: string | null;
  completionVerificationStatus?: string | null;
  verifierAgentId?: string | null;
  pendingVerificationAt?: string | null;
  verifiedAt?: string | null;
  verificationRejectionComment?: string | null;
  createdBy?: string | null;
  /** Server: current viewer is org-chart head (or elevated) for this pending task. */
  viewerCanVerifyCompletion?: boolean;
  assignedAgent?: { id: string; name: string; team?: { id?: string | null; name?: string | null } | null } | null;
  itProjectName?: string | null;
  itProjectPhase?: string | null;
  enableSubtaskAssignees?: boolean;
  /** True when this card has a linked Request for Travel Order. */
  isFieldAssignment?: boolean;
  /** Purpose + travelers from the latest linked travel order (Field Assignment cards). */
  travelOrderSummary?: {
    orderRequest: string;
    travelers: string[];
    personInCharge?: string | null;
    isWorkPlan?: boolean;
  } | null;
  /** Job Orders linked to this Task Board project. */
  linkedJobOrders?: Array<{ id: string; ticketNumber: string; title: string }>;
};

function isFieldAssignmentRecord(r: KpiRecord): boolean {
  return Boolean(r.isFieldAssignment) || isFieldAssignmentTask(r.subKpis);
}

function isProjectRecord(r: KpiRecord): boolean {
  return isItProjectImplementationPillar(r.title) || isProjectTask(r.subKpis);
}

type TaskBoardCategory = "all" | "task" | "project" | "field";

function taskBoardCategoryOf(r: KpiRecord): Exclude<TaskBoardCategory, "all"> {
  if (isFieldAssignmentRecord(r)) return "field";
  if (isProjectRecord(r)) return "project";
  return "task";
}

/** Same buckets as Task Metrics company-view donuts (frequency / Projects / Field). */
function boardLayoutSectionKey(r: KpiRecord): string {
  const cat = taskBoardCategoryOf(r);
  if (cat === "field") return donutKeyForTaskMetricsRow(r, "field") ?? FIELD_ASSIGNMENT_DONUT_KEY;
  if (cat === "project") return donutKeyForTaskMetricsRow(r, "project") ?? PROJECTS_DONUT_KEY;
  return donutKeyForTaskMetricsRow(r, "task") ?? "ONE-OFF";
}

const BOARD_LAYOUT_SECTION_ORDER: string[] = [
  ...TASK_FREQUENCY_DONUT_KEYS,
  PROJECTS_DONUT_KEY,
  FIELD_ASSIGNMENT_DONUT_KEY,
];

function boardLayoutSectionLabel(key: string): string {
  switch (key) {
    case "ONE-OFF":
      return "One-off";
    case "DAILY":
      return "Daily";
    case "WEEKLY":
      return "Weekly";
    case "MONTHLY":
      return "Monthly";
    case "QUARTERLY":
      return "Quarterly";
    case "SEMI_ANNUAL":
      return "Semi Annual";
    case "YEARLY":
      return "Annualy";
    case PROJECTS_DONUT_KEY:
      return "Projects";
    case FIELD_ASSIGNMENT_DONUT_KEY:
      return "Field Assignment";
    default:
      return key;
  }
}

function groupRowsByBoardLayoutSection(
  rows: KpiRecord[],
): Array<{ key: string; label: string; rows: KpiRecord[] }> {
  const byKey = new Map<string, KpiRecord[]>();
  for (const row of rows) {
    const key = boardLayoutSectionKey(row);
    const list = byKey.get(key);
    if (list) list.push(row);
    else byKey.set(key, [row]);
  }
  const sections: Array<{ key: string; label: string; rows: KpiRecord[] }> = [];
  for (const key of BOARD_LAYOUT_SECTION_ORDER) {
    const sectionRows = byKey.get(key);
    if (sectionRows?.length) {
      sections.push({ key, label: boardLayoutSectionLabel(key), rows: sectionRows });
      byKey.delete(key);
    }
  }
  for (const [key, sectionRows] of byKey) {
    if (sectionRows.length) {
      sections.push({ key, label: boardLayoutSectionLabel(key), rows: sectionRows });
    }
  }
  return sections;
}

function nonRecurringTaskKindLabel(r: KpiRecord): string {
  if (isFieldAssignmentRecord(r)) return "Field Assignment";
  if (isProjectRecord(r)) return "Project";
  return "TASK";
}

function taskTypeBadgeLabel(r: KpiRecord, itProject: boolean): string {
  if (isFieldAssignmentRecord(r)) return "Field Assignment";
  if (itProject || isProjectTask(r.subKpis)) return "Project";
  if (r.isRecurring === false) return "TASK";
  return `${String(r.frequency || "DAILY").toUpperCase()} TASK`;
}

function isTimelineProjectRecord(r: Pick<KpiRecord, "title" | "subKpis">): boolean {
  return isTimelineProjectKpi(r.title, r.subKpis);
}

function nonRecurringCycleHint(r: KpiRecord): string {
  return `${nonRecurringTaskKindLabel(r)} — based on main task target and actual dates`;
}

type AssignRosterScopePayload = {
  elevated: boolean;
  companies: { id: string; name: string }[];
  departments: { value: string; label: string }[];
  lockedCompanyId: string | null;
  lockedCompanyName: string | null;
  lockedAgentIds: string[];
};

type AssignPickerMode = "company" | "department";

type AssignableAgent = {
  id: string;
  name: string;
  email?: string | null;
  portalRole?: string | null;
  headPrivileges?: boolean;
  team?: { id?: string | null; name?: string | null } | null;
  assignmentCompany?: { id?: string | null; name?: string | null } | null;
  /** From merged DB clock-in today (Asia/Manila). */
  isOnDuty?: boolean;
  dutyStatus?: "ON_DUTY" | "OFFLINE";
  profileImage?: string | null;
  profileImageZoom?: number | null;
  profileImagePosX?: number | null;
  profileImagePosY?: number | null;
};

function agentIsOnDuty(agent: AssignableAgent): boolean {
  if (typeof agent.isOnDuty === "boolean") return agent.isOnDuty;
  return agent.dutyStatus === "ON_DUTY";
}

type TaskScheduleDraft = {
  isRecurring: boolean;
  frequency: KpiFrequencyCode;
  recurrenceWeekday: number;
  recurrenceMonthDay: number;
  nonRecurringStartDate: string;
  nonRecurringEndDate: string;
};

function isoToLocalYmd(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function taskToScheduleDraft(r: KpiRecord): TaskScheduleDraft {
  return {
    isRecurring: r.isRecurring !== false,
    frequency: r.frequency,
    recurrenceWeekday: typeof r.recurrenceWeekday === "number" ? r.recurrenceWeekday : 1,
    recurrenceMonthDay: typeof r.recurrenceMonthDay === "number" ? r.recurrenceMonthDay : 1,
    nonRecurringStartDate: isoToLocalYmd(r.nonRecurringStartAt),
    nonRecurringEndDate: isoToLocalYmd(r.nonRecurringEndAt),
  };
}

function assignmentCompanyKey(agent: AssignableAgent): string {
  return (
    agent.assignmentCompany?.id ??
    agent.team?.id ??
    (agent.assignmentCompany?.name
      ? `name:${agent.assignmentCompany.name.trim().toLowerCase()}`
      : agent.team?.name
        ? `name:${agent.team.name.trim().toLowerCase()}`
        : ASSIGNMENT_NO_COMPANY)
  );
}

function assignmentCompanyName(agent: AssignableAgent): string {
  return (
    agent.assignmentCompany?.name?.trim() ||
    agent.team?.name?.trim() ||
    "No assigned company"
  );
}

/** True when the agent belongs to the selected roster company (id or name). */
function agentMatchesCompanyScope(
  agent: AssignableAgent,
  companyId: string,
  companyName?: string | null,
): boolean {
  if (!companyId) return false;
  if (agent.assignmentCompany?.id === companyId) return true;
  if (agent.team?.id === companyId) return true;
  const want = (companyName ?? "").trim().toLowerCase();
  if (!want) return false;
  const names = [agent.assignmentCompany?.name, agent.team?.name]
    .map((n) => (n ?? "").trim().toLowerCase())
    .filter(Boolean);
  return names.includes(want);
}

function dedupeAssignableAgents(list: AssignableAgent[]): AssignableAgent[] {
  const seen = new Set<string>();
  const out: AssignableAgent[] = [];
  for (const agent of list) {
    const nameKey = agent.name.trim().toLowerCase().replace(/\s+/g, " ");
    const key = nameKey || agent.email?.trim().toLowerCase() || agent.id;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(agent);
  }
  return out;
}

export function AgentKpiKanbanFlow({
  companyFilterTeamId = null,
  orgChartSectionFilterId = null,
  assignedAgentFilterId = null,
  showAdminTaskManagement = false,
  focusTaskId = null,
  fromJobOrderTicketId = null,
  sessionRole = null,
  searchQuery = "",
  categoryFilter = "all",
  frequencyFilter = "all",
}: {
  /** When set, loads KPI rows and assignment lanes for this SBU only (personnel designated company). */
  companyFilterTeamId?: string | null;
  /** When set, keeps tasks whose main assignee is in this org-chart section (incl. subsections). */
  orgChartSectionFilterId?: string | null;
  /** When set, narrows the task board to this main assignee. */
  assignedAgentFilterId?: string | null;
  /** SuperAdmin / Admin: KPI definition form (moved from Request Metrics and Reports). */
  showAdminTaskManagement?: boolean;
  /** Open this task's details once rows are loaded (e.g. notification deep link). */
  focusTaskId?: string | null;
  /** Open Task management prefilled from a Job Order. */
  fromJobOrderTicketId?: string | null;
  /** Portal role of the signed-in user (SSR). SuperAdmin-only gates use this. */
  sessionRole?: string | null;
  /** Free-text search (matched against task title). */
  searchQuery?: string;
  /** Task Board category filter: all | task | project | field. */
  categoryFilter?: string;
  /** Frequency filter: all or a TASK_FREQUENCY_DONUT_KEYS value (ONE-OFF, DAILY, ...). */
  frequencyFilter?: string;
} = {}) {
  const isSuperAdmin = isPlatformSuperAdminPortalRole(sessionRole);
  const isElevatedAssign = isElevatedPlatformRole(sessionRole);
  const [rows, setRows] = useState<KpiRecord[]>([]);
  const [agents, setAgents] = useState<AssignableAgent[]>([]);
  const [allAssignableAgents, setAllAssignableAgents] = useState<AssignableAgent[]>([]);
  const [orgSectionAgentIds, setOrgSectionAgentIds] = useState<Set<string> | null>(null);
  const [assignRosterScope, setAssignRosterScope] = useState<AssignRosterScopePayload | null>(null);
  const [assignPickerMode, setAssignPickerMode] = useState<AssignPickerMode>("company");
  const [assignPickerCompanyId, setAssignPickerCompanyId] = useState("");
  const [assignPickerDepartmentId, setAssignPickerDepartmentId] = useState("");
  const [assignScopeAgents, setAssignScopeAgents] = useState<AssignableAgent[] | null>(null);
  const [canAssignWork, setCanAssignWork] = useState(false);
  const [canUnassignWork, setCanUnassignWork] = useState(false);
  const [canCompleteUnassignedWork, setCanCompleteUnassignedWork] = useState(false);
  const [canAssignOffline, setCanAssignOffline] = useState(false);
  const [canDeleteTask, setCanDeleteTask] = useState(false);
  const [canEditRunningTasks, setCanEditRunningTasks] = useState(false);
  const [operatorAgentId, setOperatorAgentId] = useState<string | null>(null);
  const [operatorAgentName, setOperatorAgentName] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  /** Screenshot up/down only — must not freeze board drag or unrelated controls. */
  const [mediaBusyId, setMediaBusyId] = useState<string | null>(null);
  /** Ignore modal-backdrop closes briefly after opening the OS file picker (ghost click). */
  const filePickerGuardUntilRef = useRef(0);
  const activeTaskSnapshotRef = useRef<KpiRecord | null>(null);
  /** Card id whose inline assignee search is open (toggled by clicking the assignee field). */
  const [editingAssigneeId, setEditingAssigneeId] = useState<string | null>(null);
  /** Sub-task key ("<recordId>:<subKpiId>") whose inline assignee search is open. */
  const [editingSubAssigneeKey, setEditingSubAssigneeKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tz, setTz] = useState(DEFAULT_TIME_ZONE);
  const [nowMs, setNowMs] = useState(0);
  const [openSubtaskDrawers, setOpenSubtaskDrawers] = useState<Set<string>>(() => new Set());
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  /** Segment filter in Full Task Details (`ALL` = every segment). */
  const [detailSegmentFilter, setDetailSegmentFilter] = useState<string>("ALL");
  const [taskAuditLog, setTaskAuditLog] = useState<
    Array<{ id: string; author: string; summary: string; detail: string | null; createdAt: string }>
  >([]);
  const [taskAuditLoading, setTaskAuditLoading] = useState(false);
  const [verificationRejectComment, setVerificationRejectComment] = useState("");
  const [verificationRejectOpen, setVerificationRejectOpen] = useState(false);
  /** Task id whose reject form is open inside the For My Approval modal. */
  const [approvalRejectTaskId, setApprovalRejectTaskId] = useState<string | null>(null);
  const [subTasksManagerTaskId, setSubTasksManagerTaskId] = useState<string | null>(null);
  const [seekAssistModal, setSeekAssistModal] = useState<{
    kpiId: string;
    taskTitle: string;
    segmentLabel?: string | null;
    candidates: { id: string; title: string }[];
  } | null>(null);
  const [taskManagementOpen, setTaskManagementOpen] = useState(false);
  const [forMyApprovalOpen, setForMyApprovalOpen] = useState(false);
  /** SuperAdmin platform toggle — when false, skip pending-verification UI. */
  const [taskVerificationEnabled, setTaskVerificationEnabled] = useState(true);
  /** Pending approval task ids the viewer has already opened in For My Approval. */
  const [approvalSeenIds, setApprovalSeenIds] = useState<Set<string>>(() => new Set());
  const [fromJobOrderId, setFromJobOrderId] = useState<string | null>(
    fromJobOrderTicketId?.trim() || null,
  );
  const [travelOrdersOpen, setTravelOrdersOpen] = useState(false);
  const [createTravelOrderOpen, setCreateTravelOrderOpen] = useState(false);
  const [resumeTravelOrderDraftId, setResumeTravelOrderDraftId] = useState<string | null>(null);
  const [companyTravelOrders, setCompanyTravelOrders] = useState<TravelOrderDto[]>([]);
  const [companyTravelOrdersLoading, setCompanyTravelOrdersLoading] = useState(false);
  const [companyTravelOrdersError, setCompanyTravelOrdersError] = useState<string | null>(null);
  /** Draft id awaiting a second tap to confirm removal (SuperAdmin only). */
  const [confirmRemoveDraftId, setConfirmRemoveDraftId] = useState<string | null>(null);
  const [viewTravelOrder, setViewTravelOrder] = useState<{
    taskId: string;
    travelOrderId: string | null;
    title: string;
  } | null>(null);
  const [editTravelOrderRfp, setEditTravelOrderRfp] = useState<{
    taskId: string;
    travelOrderId: string;
    linkedRfpTicketId?: string | null;
  } | null>(null);
  const [mobileLane, setMobileLane] = useState<KpiBoardStatus>("CURRENT");
  const [laneRegisterKey, setLaneRegisterKey] = useState(0);
  const [subAssigneePeersByMainId, setSubAssigneePeersByMainId] = useState<Record<string, AssignableAgent[]>>({});
  const subAssigneePeersFetchedRef = useRef(new Set<string>());
  const [addSubTaskById, setAddSubTaskById] = useState<
    Record<
      string,
      { title: string; dueDate: string; useCustomDueDate: boolean; dueDateRollsWithCycle: boolean }
    >
  >({});
  const [scheduleDraft, setScheduleDraft] = useState<TaskScheduleDraft | null>(null);
  /** Local text while typing numerical target/actual — commit on blur (avoids one-digit-per-save). */
  const [numericalDraftByKey, setNumericalDraftByKey] = useState<Record<string, string>>({});

  function numericalFieldKey(recordId: string, subKpiId: string, field: "target" | "value") {
    return `${recordId}:${subKpiId}:${field}`;
  }

  function numericalFieldDisplay(
    recordId: string,
    subKpiId: string,
    field: "target" | "value",
    stored: number | null | undefined,
  ) {
    const key = numericalFieldKey(recordId, subKpiId, field);
    if (Object.prototype.hasOwnProperty.call(numericalDraftByKey, key)) {
      return numericalDraftByKey[key] ?? "";
    }
    return stored == null ? "" : String(stored);
  }

  function setNumericalFieldDraft(
    recordId: string,
    subKpiId: string,
    field: "target" | "value",
    text: string,
  ) {
    const key = numericalFieldKey(recordId, subKpiId, field);
    setNumericalDraftByKey((prev) => ({ ...prev, [key]: text }));
  }

  function clearNumericalFieldDraft(recordId: string, subKpiId: string, field: "target" | "value") {
    const key = numericalFieldKey(recordId, subKpiId, field);
    setNumericalDraftByKey((prev) => {
      if (!Object.prototype.hasOwnProperty.call(prev, key)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  useEffect(() => {
    queueMicrotask(() => {
      try {
        setTz(DEFAULT_TIME_ZONE);
      } catch {
        setTz(DEFAULT_TIME_ZONE);
      }
    });
  }, []);

  useEffect(() => {
    queueMicrotask(() => setNowMs(Date.now()));
    const timer = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const companyQs =
    companyFilterTeamId && companyFilterTeamId !== "ALL"
      ? `&company=${encodeURIComponent(companyFilterTeamId)}`
      : "";
  const assignedQs =
    assignedAgentFilterId && assignedAgentFilterId !== "ALL"
      ? `&assigned=${encodeURIComponent(assignedAgentFilterId)}`
      : "";

  async function load() {
    const res = await fetch(
      `/api/kpi-maintenance?tz=${encodeURIComponent(tz)}${companyQs}${assignedQs}`,
      { cache: "no-store" },
    );
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "Could not load task board.");
      return;
    }
    setError(null);
    const payload = (await res.json()) as {
      rows?: KpiRecord[];
      canAssignWork?: boolean;
      canUnassignWork?: boolean;
      canCompleteUnassignedWork?: boolean;
      canAssignOffline?: boolean;
      canDeleteTask?: boolean;
      canEditRunningTasks?: boolean;
      operatorAgentId?: string | null;
      operatorAgentName?: string | null;
    };
    if (Array.isArray(payload.rows)) setRows(payload.rows);
    setCanAssignWork(Boolean(payload.canAssignWork));
    setCanUnassignWork(Boolean(payload.canUnassignWork));
    setCanCompleteUnassignedWork(Boolean(payload.canCompleteUnassignedWork));
    setCanAssignOffline(Boolean(payload.canAssignOffline));
    setCanDeleteTask(Boolean(payload.canDeleteTask));
    setCanEditRunningTasks(Boolean(payload.canEditRunningTasks));
    if (typeof payload.operatorAgentId === "string" && payload.operatorAgentId.trim()) {
      setOperatorAgentId(payload.operatorAgentId);
    }
    if (typeof payload.operatorAgentName === "string" && payload.operatorAgentName.trim()) {
      setOperatorAgentName(payload.operatorAgentName);
    }
    // Deduped phase-delay notify (once per phase per day); board already shows delay banners.
    void fetch(`/api/kpi-maintenance/phase-delay-alerts?tz=${encodeURIComponent(tz)}`, {
      cache: "no-store",
    }).catch(() => undefined);
  }

  async function loadContext() {
    try {
      const agentsUrl =
        companyFilterTeamId && companyFilterTeamId !== "ALL"
          ? `/api/agents?company=${encodeURIComponent(companyFilterTeamId)}`
          : isElevatedAssign
            ? "/api/agents?anyCompany=1"
            : "/api/agents";
      const [permRes, agentsRes, allAgentsRes, scopeRes] = await Promise.all([
        fetch("/api/me/permissions", { cache: "no-store" }),
        fetch(agentsUrl, { cache: "no-store" }),
        fetch(isElevatedAssign ? "/api/agents?anyCompany=1" : "/api/agents", { cache: "no-store" }),
        fetch("/api/me/assign-roster-scope", { cache: "no-store" }),
      ]);
      if (permRes.ok) {
        const p = (await permRes.json()) as {
          operatorAgentId?: string | null;
          operatorAgentName?: string | null;
        };
        if (typeof p.operatorAgentId === "string" && p.operatorAgentId.trim()) {
          setOperatorAgentId(p.operatorAgentId);
        }
        if (typeof p.operatorAgentName === "string" && p.operatorAgentName.trim()) {
          setOperatorAgentName(p.operatorAgentName);
        }
      }
      if (agentsRes.ok) {
        const a = (await agentsRes.json()) as AssignableAgent[];
        if (Array.isArray(a)) setAgents(dedupeAssignableAgents(a));
      }
      if (allAgentsRes.ok) {
        const a = (await allAgentsRes.json()) as AssignableAgent[];
        if (Array.isArray(a)) setAllAssignableAgents(dedupeAssignableAgents(a));
      }
      if (scopeRes.ok) {
        const scope = (await scopeRes.json()) as AssignRosterScopePayload;
        setAssignRosterScope({
          elevated: Boolean(scope.elevated),
          companies: Array.isArray(scope.companies) ? scope.companies : [],
          departments: Array.isArray(scope.departments) ? scope.departments : [],
          lockedCompanyId: scope.lockedCompanyId ?? null,
          lockedCompanyName: scope.lockedCompanyName ?? null,
          lockedAgentIds: Array.isArray(scope.lockedAgentIds) ? scope.lockedAgentIds : [],
        });
      }
    } catch {
      // Poll / HMR / brief disconnects — keep last good roster state.
    }
  }

  useEffect(() => {
    queueMicrotask(() => {
      void load();
      void loadContext();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tz, companyFilterTeamId, assignedAgentFilterId]);

  useEffect(() => {
    const elevated = Boolean(assignRosterScope?.elevated || isElevatedAssign);
    if (!elevated) {
      setAssignScopeAgents(null);
      return;
    }
    let cancelled = false;
    async function loadAssignScopeAgents() {
      if (assignPickerMode === "company") {
        if (!assignPickerCompanyId) {
          setAssignScopeAgents([]);
          return;
        }
        setAssignScopeAgents(null);
        const res = await fetch(
          `/api/agents?company=${encodeURIComponent(assignPickerCompanyId)}`,
          { cache: "no-store" },
        );
        if (cancelled) return;
        if (!res.ok) {
          setAssignScopeAgents([]);
          return;
        }
        const list = (await res.json()) as AssignableAgent[];
        if (!cancelled) setAssignScopeAgents(Array.isArray(list) ? dedupeAssignableAgents(list) : []);
        return;
      }
      if (!assignPickerDepartmentId) {
        setAssignScopeAgents([]);
        return;
      }
      setAssignScopeAgents(null);
      const qs = new URLSearchParams();
      qs.set("section", assignPickerDepartmentId);
      qs.set("anyCompany", "1");
      const res = await fetch(`/api/agents?${qs.toString()}`, { cache: "no-store" });
      if (cancelled) return;
      if (!res.ok) {
        setAssignScopeAgents([]);
        return;
      }
      const list = (await res.json()) as AssignableAgent[];
      if (!cancelled) setAssignScopeAgents(Array.isArray(list) ? dedupeAssignableAgents(list) : []);
    }
    void loadAssignScopeAgents();
    return () => {
      cancelled = true;
    };
  }, [
    assignRosterScope?.elevated,
    isElevatedAssign,
    assignPickerMode,
    assignPickerCompanyId,
    assignPickerDepartmentId,
  ]);

  useEffect(() => {
    const sectionId = (orgChartSectionFilterId ?? "").trim();
    if (!sectionId || sectionId === "ALL") {
      setOrgSectionAgentIds(null);
      return;
    }
    let cancelled = false;
    const qs = new URLSearchParams();
    qs.set("section", sectionId);
    if (companyFilterTeamId && companyFilterTeamId !== "ALL") {
      qs.set("company", companyFilterTeamId);
    } else {
      qs.set("anyCompany", "1");
    }
    void fetch(`/api/agents?${qs.toString()}`, {
      cache: "no-store",
    })
      .then((res) => (res.ok ? res.json() : []))
      .then((list: unknown) => {
        if (cancelled) return;
        const ids = new Set(
          Array.isArray(list)
            ? list
                .map((row) =>
                  row && typeof row === "object" && "id" in row
                    ? String((row as { id: string }).id)
                    : "",
                )
                .filter(Boolean)
            : [],
        );
        setOrgSectionAgentIds(ids);
      })
      .catch(() => {
        if (!cancelled) setOrgSectionAgentIds(new Set());
      });
    return () => {
      cancelled = true;
    };
  }, [orgChartSectionFilterId, companyFilterTeamId]);

  /** Refresh On Duty flags from merged clock-ins while the assignment board is open. */
  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadContext();
    }, 15_000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyFilterTeamId]);

  /** Close the inline assignee editors (main + sub-task) when clicking outside of them (or pressing Escape). */
  useEffect(() => {
    if (!editingAssigneeId && !editingSubAssigneeKey) return;
    function onDocMousedown(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      if (target?.closest("[data-assignee-editor]")) return;
      setEditingAssigneeId(null);
      setEditingSubAssigneeKey(null);
    }
    function onDocKeydown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setEditingAssigneeId(null);
        setEditingSubAssigneeKey(null);
      }
    }
    document.addEventListener("mousedown", onDocMousedown);
    document.addEventListener("keydown", onDocKeydown);
    return () => {
      document.removeEventListener("mousedown", onDocMousedown);
      document.removeEventListener("keydown", onDocKeydown);
    };
  }, [editingAssigneeId, editingSubAssigneeKey]);

  useEffect(() => {
    const mainIds = [...new Set(rows.map((row) => row.assignedAgent?.id).filter(Boolean))] as string[];
    for (const mainId of mainIds) {
      if (subAssigneePeersFetchedRef.current.has(mainId)) continue;
      subAssigneePeersFetchedRef.current.add(mainId);
      void fetch(`/api/agents?forMainAgentId=${encodeURIComponent(mainId)}`, { cache: "no-store" })
        .then((res) => (res.ok ? res.json() : []))
        .then((list: unknown) => {
          if (!Array.isArray(list)) return;
          const peers = dedupeAssignableAgents(list as AssignableAgent[]).filter((a) => a.id !== mainId);
          setSubAssigneePeersByMainId((prev) => (prev[mainId] ? prev : { ...prev, [mainId]: peers }));
        })
        .catch(() => {
          subAssigneePeersFetchedRef.current.delete(mainId);
        });
    }
  }, [rows]);

  const focusedTaskOpenedRef = useRef<string | null>(null);
  useEffect(() => {
    const id = focusTaskId?.trim() || null;
    if (!id || rows.length === 0) return;
    if (focusedTaskOpenedRef.current === id) return;
    if (!rows.some((row) => row.id === id)) return;
    focusedTaskOpenedRef.current = id;
    queueMicrotask(() => {
      setActiveTaskId(id);
      setDetailSegmentFilter("ALL");
      if (showAdminTaskManagement) {
        const task = rows.find((row) => row.id === id);
        setScheduleDraft(task ? taskToScheduleDraft(task) : null);
      } else {
        setScheduleDraft(null);
      }
    });
  }, [focusTaskId, rows, showAdminTaskManagement]);

  useEffect(() => {
    const joId = fromJobOrderTicketId?.trim() || null;
    queueMicrotask(() => {
      setFromJobOrderId(joId);
      if (joId && (showAdminTaskManagement || canAssignWork)) {
        setTaskManagementOpen(true);
      }
    });
  }, [fromJobOrderTicketId, showAdminTaskManagement, canAssignWork]);

  function openActiveTask(taskId: string) {
    setActiveTaskId(taskId);
    setDetailSegmentFilter("ALL");
    setEditingAssigneeId(null);
    setEditingSubAssigneeKey(null);
    if (!showAdminTaskManagement) {
      setScheduleDraft(null);
      return;
    }
    const task = rows.find((row) => row.id === taskId);
    setScheduleDraft(task ? taskToScheduleDraft(task) : null);
  }

  function closeActiveTask() {
    setActiveTaskId(null);
    activeTaskSnapshotRef.current = null;
    setVerificationRejectOpen(false);
    setVerificationRejectComment("");
    setDetailSegmentFilter("ALL");
    setScheduleDraft(null);
    setTaskAuditLog([]);
  }

  /** OS file dialogs often fire a synthetic click on the modal backdrop when they close. */
  function armFilePickerGuard(ms = 2000) {
    filePickerGuardUntilRef.current = Math.max(filePickerGuardUntilRef.current, Date.now() + ms);
  }

  function openTaskScreenshotPicker(inputId: string) {
    armFilePickerGuard(2500);
    const input = document.getElementById(inputId) as HTMLInputElement | null;
    input?.click();
    const onFocus = () => {
      armFilePickerGuard(1200);
      window.removeEventListener("focus", onFocus);
    };
    window.addEventListener("focus", onFocus);
  }

  useEffect(() => {
    if (!activeTaskId) {
      queueMicrotask(() => {
        setTaskAuditLog([]);
        setTaskAuditLoading(false);
      });
      return;
    }
    let cancelled = false;
    setTaskAuditLoading(true);
    void fetch(`/api/kpi-maintenance/${encodeURIComponent(activeTaskId)}/activity?take=40`, {
      cache: "no-store",
    })
      .then(async (res) => {
        if (!res.ok) throw new Error("audit");
        const data = (await res.json()) as {
          rows?: Array<{
            id: string;
            author: string;
            summary: string;
            detail: string | null;
            createdAt: string;
          }>;
        };
        if (!cancelled) setTaskAuditLog(Array.isArray(data.rows) ? data.rows : []);
      })
      .catch(() => {
        if (!cancelled) setTaskAuditLog([]);
      })
      .finally(() => {
        if (!cancelled) setTaskAuditLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTaskId]);

  function applyUpdatedKpiRow(updated: KpiRecord) {
    if (activeTaskSnapshotRef.current?.id === updated.id) {
      activeTaskSnapshotRef.current = {
        ...activeTaskSnapshotRef.current,
        ...updated,
        assignedAgent: updated.assignedAgent ?? activeTaskSnapshotRef.current.assignedAgent,
        isFieldAssignment:
          updated.isFieldAssignment ?? activeTaskSnapshotRef.current.isFieldAssignment,
        travelOrderSummary:
          updated.travelOrderSummary ?? activeTaskSnapshotRef.current.travelOrderSummary,
        linkedJobOrders: updated.linkedJobOrders ?? activeTaskSnapshotRef.current.linkedJobOrders,
      };
    }
    startTransition(() => {
      setRows((prev) =>
        prev.map((row) => {
          if (row.id !== updated.id) return row;
          return {
            ...row,
            ...updated,
            // PATCH returns the Prisma row; keep list-only enrichments from GET.
            assignedAgent: updated.assignedAgent ?? row.assignedAgent,
            isFieldAssignment: updated.isFieldAssignment ?? row.isFieldAssignment,
            travelOrderSummary: updated.travelOrderSummary ?? row.travelOrderSummary,
            linkedJobOrders: updated.linkedJobOrders ?? row.linkedJobOrders,
          };
        }),
      );
    });
  }

  function refreshActiveTaskAudit(taskId: string) {
    if (activeTaskId !== taskId) return;
    void fetch(`/api/kpi-maintenance/${encodeURIComponent(taskId)}/activity?take=40`, {
      cache: "no-store",
    })
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as {
          rows?: Array<{
            id: string;
            author: string;
            summary: string;
            detail: string | null;
            createdAt: string;
          }>;
        };
        if (Array.isArray(data.rows)) setTaskAuditLog(data.rows);
      })
      .catch(() => undefined);
  }

  function taskLabel(r: KpiRecord) {
    return kpiMainTaskLabel(r);
  }

  function progress(r: KpiRecord) {
    if (isTimelineProjectRecord(r)) {
      const agg = itProjectAggregatedProgressFromRaw(r.subKpis, r.itProjectPhase);
      const missing = Math.max(0, agg.totalItems - agg.totalDone);
      return {
        total: agg.totalItems,
        done: agg.totalDone,
        missing,
        pct: agg.averagePercent,
        inverted: false,
        positive: agg.totalDone,
        negative: missing,
      };
    }
    const p = kpiChecklistProgress(r.subKpis, taskLabel(r), {
      parentCardEffectivelyVerified: isCompletionEffectivelyVerified(r),
      verificationEnabled: taskVerificationEnabled,
    });
    const view = kpiChecklistMetricView(
      p,
      taskUsesInvertedRecording({ title: r.title, subKpis: r.subKpis }),
    );
    return {
      total: view.total,
      done: view.done,
      missing: view.missing,
      pct: view.percent,
      inverted: view.inverted,
      positive: view.positive,
      negative: view.negative,
    };
  }

  function tasksPendingCount(p: ReturnType<typeof progress>): number {
    if (p.inverted) return p.negative;
    return p.missing;
  }

  function shouldShowTasksPendingBadge(
    r: KpiRecord,
    p: ReturnType<typeof progress>,
    itProject: boolean,
    incLate: number,
  ): boolean {
    if (itProject && incLate > 0) return false;
    if (
      statusOf(r) === "DELAYED" &&
      r.isRecurring === false &&
      accruedPenaltyForRecord(r) > 0
    ) {
      return false;
    }
    if (p.total === 0) return false;
    if (p.inverted) return p.negative > 0;
    return p.missing > 0 && p.done < p.total;
  }

  function tasksPendingBadgeLabel(p: ReturnType<typeof progress>): string {
    const count = tasksPendingCount(p);
    return count === 1 ? "Tasks Pending" : `${count} Tasks Pending`;
  }

  function periodEnd(r: KpiRecord) {
    if (r.isRecurring === false) {
      return nonRecurringTaskDelayDeadline(r.subKpis, tz) ?? nonRecurringDeadline(r);
    }
    return recurringDeadlineExclusive(r, tz);
  }

  function incompleteOverdueMs(r: KpiRecord) {
    if (isTimelineProjectRecord(r)) {
      return incompletePastDeadlineDelayMs(r, nowMs, tz);
    }
    const p = progress(r);
    if (p.total === 0) return 0;
    const complete = p.inverted ? p.negative === 0 : p.done === p.total;
    if (complete) return 0;
    return incompletePastDeadlineDelayMs(r, nowMs, tz);
  }

  function fmtDelay(ms: number) {
    if (!Number.isFinite(ms) || ms <= 0) return "0d 0h";
    const hours = Math.floor(ms / 3_600_000);
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
  }

  function statusOf(r: KpiRecord): KpiBoardStatus {
    const p = progress(r);
    // Inverted recording is monitoring-style: all-clear stays Current, never Done via checkboxes.
    if (p.inverted && !isTimelineProjectRecord(r)) {
      if (r.isRecurring === false) {
        const delayed = taskKanbanDerivedStatus(r, {
          total: p.total,
          done: 0,
          nowMs,
          timeZone: tz,
          verificationEnabled: taskVerificationEnabled,
        });
        if (delayed === "DELAYED") return "DELAYED";
      }
      return "CURRENT";
    }
    const derived = taskKanbanDerivedStatus(r, {
      total: p.total,
      done: p.done,
      nowMs,
      timeZone: tz,
      verificationEnabled: taskVerificationEnabled,
    });
    // Pending verification stays on Current; approvals are handled via "For My Approval".
    if (derived === "PENDING_VERIFICATION") return "CURRENT";
    return derived;
  }

  function isAwaitingVerification(r: KpiRecord): boolean {
    if (!taskVerificationEnabled) return false;
    if (r.completionVerificationStatus === COMPLETION_VERIFICATION.PENDING) return true;
    return pendingApprovalSubtasks(r).length > 0;
  }

  function canEditChecklist(r: KpiRecord) {
    // SuperAdmin / HighAdmin may edit any running task, even when
    // the card is assigned to other personnel.
    if (canCompleteUnassignedWork) return true;
    if (canEditRunningTasks) return true;
    const main = r.assignedAgent;
    if (!main) return false;
    if (operatorAgentId && main.id === operatorAgentId) return true;
    const mainName = (main.name ?? "").trim();
    const operatorName = (operatorAgentName ?? "").trim();
    return Boolean(
      operatorName && mainName && normalizePersonName(operatorName) === normalizePersonName(mainName),
    );
  }

  function canEditSubKpi(r: KpiRecord, s: SubKpiItem) {
    if (canEditChecklist(r)) return true;
    if (
      subKpiAssignedToOperator(s, {
        id: operatorAgentId,
        name: operatorAgentName,
      })
    ) {
      return true;
    }
    // SuperAdmin / HighAdmin may update sub-task work on any running task.
    return canCompleteUnassignedWork;
  }

  function canCompleteSubKpi(r: KpiRecord, s: SubKpiItem) {
    const req = resolveSubKpiCompletionRequirements(s);
    if (!req.checkbox) return false;
    if (!canEditSubKpi(r, s)) {
      return canAssignWork && req.screenshots && hasBeforeAndAfterScreenshots(s);
    }
    if (req.screenshots && !hasBeforeAndAfterScreenshots(s)) return false;
    if (req.screenshotUpload && !hasScreenshotUpload(s)) return false;
    if (req.numerical && !hasNumericalRecord(s)) return false;
    if (req.numerical) {
      const pct = numericalRecordProgressPercent(s.numericalValue, s.numericalTarget);
      if (pct != null && pct < 100) return false;
    }
    return true;
  }

  function taskCardDone(r: KpiRecord) {
    const p = progress(r);
    if (p.total === 0) return false;
    // Inverted tasks are not "finished" when clear — they keep recording until flagged.
    if (p.inverted) return false;
    return p.done === p.total;
  }

  function taskWillFinishAfterToggle(r: KpiRecord, subKpiId: string, currentlyDone: boolean) {
    if (currentlyDone) return false;
    const items = isTimelineProjectRecord(r)
      ? parseItProjectSubKpis(r.subKpis, r.itProjectPhase).phases.flatMap((phase) => phase.items)
      : collectChecklistProgressItems(r.subKpis, taskLabel(r));
    if (items.length === 0) return false;
    return items.every((item) => (item.id === subKpiId ? true : item.done));
  }

  function canOpenSubtaskDrawer(r: KpiRecord, items: SubKpiItem[]) {
    if (canAssignWork || canEditChecklist(r)) return true;
    if (!operatorAgentId) return canCompleteUnassignedWork && !r.assignedAgent?.id;
    return items.some((item) =>
      subKpiAssignedToOperator(item, { id: operatorAgentId, name: operatorAgentName }),
    );
  }

  function toggleSubtaskDrawer(recordId: string) {
    setOpenSubtaskDrawers((prev) => {
      const next = new Set(prev);
      if (next.has(recordId)) next.delete(recordId);
      else next.add(recordId);
      return next;
    });
  }

  async function move(id: string, to: KpiBoardStatus) {
    if (to === "DELAYED") return;
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/kpi-maintenance?tz=${encodeURIComponent(tz)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, markAllDone: to === "DONE" }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Could not move KPI card.");
        return;
      }
      setMobileLane(to);
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function submitCompletionVerification(
    id: string,
    action: "approve" | "reject" | "resubmit",
    comment?: string,
    subKpiId?: string,
  ) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/kpi-maintenance?tz=${encodeURIComponent(tz)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id,
          completionVerification: { action, comment, ...(subKpiId ? { subKpiId } : {}) },
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Could not update verification.");
        return;
      }
      setVerificationRejectOpen(false);
      setVerificationRejectComment("");
      setApprovalRejectTaskId(null);
      await load();
    } finally {
      setBusyId(null);
    }
  }

  function canVerifyCompletion(r: KpiRecord): boolean {
    if (!taskVerificationEnabled) return false;
    // Server marks cards the viewer may approve (incl. pending sub-tasks under their department).
    if (r.viewerCanVerifyCompletion === true) return true;
    if (r.completionVerificationStatus !== COMPLETION_VERIFICATION.PENDING) return false;
    // Elevated platform roles can always verify pending completions.
    if (isElevatedAssign) return true;
    return false;
  }

  function pendingApprovalSubtasks(r: KpiRecord) {
    return listPendingVerificationSubKpiItems(r.subKpis, {
      taskTitle: taskLabel(r),
      parentCardEffectivelyVerified: isCompletionEffectivelyVerified(r),
    });
  }

  function canResubmitCompletion(r: KpiRecord): boolean {
    if (!taskVerificationEnabled) return false;
    if (r.completionVerificationStatus !== COMPLETION_VERIFICATION.REJECTED) return false;
    if (canAssignWork || isElevatedAssign) return true;
    return Boolean(operatorAgentId && r.assignedAgent?.id === operatorAgentId);
  }

  async function assignKpi(id: string, assignedAgentId: string) {
    if (!canAssignWork) return;
    const nextAssigneeId = assignedAgentId === "__UNASSIGNED__" ? "" : assignedAgentId;
    if (nextAssigneeId) {
      const target =
        agents.find((a) => a.id === nextAssigneeId) ??
        allAssignableAgents.find((a) => a.id === nextAssigneeId);
      if (target && !agentIsOnDuty(target) && !canAssignOffline) {
        window.alert(`${target.name} is Offline (no clock-in today). Only On Duty personnel can be assigned.`);
        return;
      }
    }
    if (!nextAssigneeId && !canUnassignWork) return;
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/kpi-maintenance?tz=${encodeURIComponent(tz)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, assignedAgentId: nextAssigneeId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Could not reassign KPI.");
        return;
      }
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function assignSubKpi(recordId: string, subKpiId: string, assignedAgentId: string) {
    const record = rows.find((r) => r.id === recordId);
    const items = record
      ? isTimelineProjectRecord(record)
        ? itProjectChecklistItems(record.subKpis)
        : collectAllSubKpiItems(normalizeSubKpis(record.subKpis))
      : [];
    const item = items.find((it) => it.id === subKpiId) ?? null;
    const isMainAssignee = Boolean(operatorAgentId && record?.assignedAgent?.id === operatorAgentId);
    if (
      !record ||
      !item ||
      !canMutateSubKpiAssignee({
        enableSubtaskAssignees: record.enableSubtaskAssignees === true,
        item,
        canAssignWork,
        isMainAssignee,
      })
    ) {
      return;
    }
    if (assignedAgentId) {
      const target =
        allAssignableAgents.find((a) => a.id === assignedAgentId) ??
        agents.find((a) => a.id === assignedAgentId) ??
        Object.values(subAssigneePeersByMainId)
          .flat()
          .find((a) => a.id === assignedAgentId);
      if (target && !agentIsOnDuty(target) && !canAssignOffline) {
        window.alert(`${target.name} is Offline (no clock-in today). Only On Duty personnel can be assigned.`);
        return;
      }
    }
    setBusyId(recordId);
    setError(null);
    try {
      const res = await fetch(`/api/kpi-maintenance?tz=${encodeURIComponent(tz)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: recordId,
          subKpiAssignee: { subKpiId, assignedAgentId: assignedAgentId || null },
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Could not assign sub-task.");
        return;
      }
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function seekAssistance(recordId: string, subKpiIds: string | string[]) {
    const ids = (Array.isArray(subKpiIds) ? subKpiIds : [subKpiIds])
      .map((id) => String(id ?? "").trim())
      .filter(Boolean);
    if (ids.length === 0) return;
    setBusyId(recordId);
    setError(null);
    try {
      const res = await fetch(`/api/kpi-maintenance?tz=${encodeURIComponent(tz)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: recordId,
          seekAssistance: ids.length === 1 ? { subKpiId: ids[0] } : { subKpiIds: ids },
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Could not seek assistance.");
        return;
      }
      setSeekAssistModal(null);
      await load();
    } finally {
      setBusyId(null);
    }
  }

  function validateTaskScreenshotFile(file: File): string | null {
    const type = (file.type || "").toLowerCase();
    const isAllowed = type === "image/jpeg" || type === "image/png" || /\.(jpe?g|png)$/i.test(file.name);
    if (!isAllowed) return "Only JPEG and PNG screenshots are allowed.";
    if (file.size > MAX_TASK_SCREENSHOT_BYTES) return "Screenshot must not exceed 10MB.";
    return null;
  }

  async function uploadSubKpiScreenshots(
    recordId: string,
    subKpiId: string,
    slot: TaskScreenshotSlot,
    files: File[],
    existingCount: number,
  ) {
    if (files.length === 0) return;
    if (existingCount + files.length > MAX_TASK_SCREENSHOTS_PER_SLOT) {
      setError(`You can upload up to ${MAX_TASK_SCREENSHOTS_PER_SLOT} ${slot} screenshots per sub-task.`);
      return;
    }
    for (const file of files) {
      const validationError = validateTaskScreenshotFile(file);
      if (validationError) {
        setError(validationError);
        return;
      }
    }
    setMediaBusyId(recordId);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("id", recordId);
      fd.append("subKpiId", subKpiId);
      fd.append("slot", slot);
      for (const file of files) {
        fd.append("screenshot", file);
      }
      const res = await fetch(`/api/kpi-maintenance?tz=${encodeURIComponent(tz)}`, {
        method: "PATCH",
        body: fd,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Could not upload task screenshot.");
        return;
      }
      const updated = (await res.json()) as KpiRecord;
      applyUpdatedKpiRow(updated);
      refreshActiveTaskAudit(recordId);
    } catch {
      setError("Could not upload task screenshot. Check your connection and try again.");
    } finally {
      setMediaBusyId(null);
    }
  }

  async function uploadPillarScreenshots(
    recordId: string,
    slot: TaskScreenshotSlot,
    files: File[],
    existingCount: number,
  ) {
    if (files.length === 0) return;
    if (existingCount + files.length > MAX_TASK_SCREENSHOTS_PER_SLOT) {
      setError(`You can upload up to ${MAX_TASK_SCREENSHOTS_PER_SLOT} ${slot} screenshots per pillar.`);
      return;
    }
    for (const file of files) {
      const validationError = validateTaskScreenshotFile(file);
      if (validationError) {
        setError(validationError);
        return;
      }
    }
    setMediaBusyId(recordId);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("id", recordId);
      fd.append("pillarScreenshot", "1");
      fd.append("slot", slot);
      for (const file of files) {
        fd.append("screenshot", file);
      }
      const res = await fetch(`/api/kpi-maintenance?tz=${encodeURIComponent(tz)}`, {
        method: "PATCH",
        body: fd,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Could not upload pillar screenshot.");
        return;
      }
      const updated = (await res.json()) as KpiRecord;
      applyUpdatedKpiRow(updated);
      refreshActiveTaskAudit(recordId);
    } catch {
      setError("Could not upload pillar screenshot. Check your connection and try again.");
    } finally {
      setMediaBusyId(null);
    }
  }

  async function removePillarScreenshot(recordId: string, slot: TaskScreenshotSlot, storedFileName: string) {
    setMediaBusyId(recordId);
    setError(null);
    try {
      const res = await fetch(`/api/kpi-maintenance?tz=${encodeURIComponent(tz)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: recordId,
          pillarScreenshotDelete: { slot, storedFileName },
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Could not remove pillar screenshot.");
        return;
      }
      const updated = (await res.json()) as KpiRecord;
      applyUpdatedKpiRow(updated);
      refreshActiveTaskAudit(recordId);
    } finally {
      setMediaBusyId(null);
    }
  }

  async function removeSubKpiScreenshot(
    recordId: string,
    subKpiId: string,
    slot: TaskScreenshotSlot,
    storedFileName: string,
  ) {
    setMediaBusyId(recordId);
    setError(null);
    try {
      const res = await fetch(`/api/kpi-maintenance?tz=${encodeURIComponent(tz)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: recordId,
          subKpiScreenshotDelete: { subKpiId, slot, storedFileName },
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Could not remove task screenshot.");
        return;
      }
      const updated = (await res.json()) as KpiRecord;
      applyUpdatedKpiRow(updated);
      refreshActiveTaskAudit(recordId);
    } finally {
      setMediaBusyId(null);
    }
  }

  async function patchItProjectMeta(
    recordId: string,
    data: { itProjectName?: string | null; itProjectPhase?: string | null },
  ) {
    setBusyId(recordId);
    setError(null);
    try {
      const res = await fetch(`/api/kpi-maintenance?tz=${encodeURIComponent(tz)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: recordId, ...data }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Could not update project details.");
        return;
      }
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function patchPhaseDueDate(recordId: string, phaseId: string, dueDate: string) {
    setBusyId(recordId);
    setError(null);
    try {
      const res = await fetch(`/api/kpi-maintenance?tz=${encodeURIComponent(tz)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: recordId,
          phaseDueDate: { phaseId, dueDate: dueDate.trim() || null },
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Could not update phase target date.");
        return;
      }
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function patchSubKpiLifecycle(recordId: string, subKpiId: string, action: "start" | "end") {
    setBusyId(recordId);
    setError(null);
    // GPS capture is reserved for Travel Order Start/End buttons.
    // Project sub-task Start/End should not prompt for device geolocation.
    const capturedAt = new Date().toISOString();
    setRows((prev) =>
      prev.map((row) => {
        if (row.id !== recordId) return row;
        if (!isItProjectImplementationPillar(row.title) && !usesProjectTimelineTracker(row.subKpis)) {
          return row;
        }
        const life = setItProjectSubKpiLifecycle(row.subKpis, subKpiId, action, tz, {
          latitude: null,
          longitude: null,
          capturedAt,
        });
        if (!life.ok) return row;
        return { ...row, subKpis: life.json };
      }),
    );
    try {
      const res = await fetch(`/api/kpi-maintenance?tz=${encodeURIComponent(tz)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: recordId,
          subKpiLifecycle: {
            subKpiId,
            action,
            latitude: null,
            longitude: null,
            capturedAt,
          },
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Could not update task lifecycle.");
        await load();
        return;
      }
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function patchSubKpiProjectMeta(
    recordId: string,
    subKpiId: string,
    meta: { projectPriority?: string; projectStatus?: string },
  ) {
    setBusyId(recordId);
    setError(null);
    try {
      const res = await fetch(`/api/kpi-maintenance?tz=${encodeURIComponent(tz)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: recordId, subKpiProjectMeta: { subKpiId, ...meta } }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Could not update project task details.");
        return;
      }
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function patchSubKpiWorkMeta(
    recordId: string,
    subKpiId: string,
    meta: {
      startDate?: string | null;
      dueDate?: string | null;
      actualDate?: string | null;
      projectPriority?: string | null;
      numericalValue?: number | null;
      numericalTarget?: number | null;
      remarks?: string | null;
    },
  ) {
    setBusyId(recordId);
    setError(null);
    try {
      const res = await fetch(`/api/kpi-maintenance?tz=${encodeURIComponent(tz)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: recordId, subKpiWorkMeta: { subKpiId, ...meta } }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Could not update sub-task details.");
        return;
      }
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function patchTaskPriority(recordId: string, taskPriority: string) {
    setBusyId(recordId);
    setError(null);
    try {
      const res = await fetch(`/api/kpi-maintenance?tz=${encodeURIComponent(tz)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: recordId, taskPriority }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Could not update task priority.");
        return;
      }
      const updated = (await res.json()) as KpiRecord;
      setRows((prev) => prev.map((row) => (row.id === updated.id ? updated : row)));
    } finally {
      setBusyId(null);
    }
  }

  async function patchTaskDailyPenalty(recordId: string, amount: number | null) {
    setBusyId(recordId);
    setError(null);
    try {
      const res = await fetch(`/api/kpi-maintenance?tz=${encodeURIComponent(tz)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: recordId, taskDailyPenaltyAmount: amount }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Could not update delay penalty.");
        return;
      }
      const updated = (await res.json()) as KpiRecord;
      setRows((prev) => prev.map((row) => (row.id === updated.id ? updated : row)));
    } finally {
      setBusyId(null);
    }
  }

  async function patchTaskDelayPenaltyFrequency(
    recordId: string,
    frequency: DelayPenaltyFrequency,
  ) {
    setBusyId(recordId);
    setError(null);
    try {
      const res = await fetch(`/api/kpi-maintenance?tz=${encodeURIComponent(tz)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: recordId, taskDelayPenaltyFrequency: frequency }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Could not update delay penalty frequency.");
        return;
      }
      const updated = (await res.json()) as KpiRecord;
      setRows((prev) => prev.map((row) => (row.id === updated.id ? updated : row)));
    } finally {
      setBusyId(null);
    }
  }

  function penaltyContextForRecord(r: KpiRecord): SubKpiPenaltyContext {
    const recurring = r.isRecurring !== false;
    return {
      nowMs,
      timeZone: tz,
      frequency: r.frequency,
      isRecurring: recurring,
      title: r.title,
      taskDailyPenaltyAmount: taskDailyPenaltyAmountFromSubKpis(r.subKpis),
      taskDelayPenaltyFrequency: taskDelayPenaltyFrequencyFromSubKpis(r.subKpis),
      taskDueDate: getTaskTargetDueDate(r.subKpis),
      recurringDeadlineMs: recurring ? periodEnd(r)?.getTime() ?? null : null,
    };
  }

  function accruedPenaltyForRecord(r: KpiRecord): number {
    const ctx = penaltyContextForRecord(r);
    return collectAllSubKpiItems(normalizeSubKpis(r.subKpis)).reduce(
      (sum, item) => sum + subKpiAccruedPenalty(item, ctx),
      0,
    );
  }

  async function toggleSubKpi(recordId: string, subKpiId: string, done: boolean) {
    const shouldCloseWhenSaved =
      activeTaskId === recordId &&
      rows.some((row) => row.id === recordId && taskWillFinishAfterToggle(row, subKpiId, done));
    setBusyId(recordId);
    setError(null);
    try {
      const res = await fetch(`/api/kpi-maintenance?tz=${encodeURIComponent(tz)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: recordId, subKpiId, done: !done }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Could not update checklist.");
        return;
      }
      await load();
      if (shouldCloseWhenSaved) {
        closeActiveTask();
      }
    } finally {
      setBusyId(null);
    }
  }

  function addSubTaskDraftFor(r: KpiRecord) {
    return (
      addSubTaskById[r.id] ?? {
        title: "",
        dueDate: "",
        useCustomDueDate: false,
        dueDateRollsWithCycle: false,
      }
    );
  }

  function patchAddSubTaskDraft(
    r: KpiRecord,
    patch: Partial<{
      title: string;
      dueDate: string;
      useCustomDueDate: boolean;
      dueDateRollsWithCycle: boolean;
    }>,
  ) {
    setAddSubTaskById((prev) => ({
      ...prev,
      [r.id]: { ...addSubTaskDraftFor(r), ...patch },
    }));
  }

  function hideAddSubTaskScheduleDate(r: KpiRecord) {
    return Boolean(r.isRecurring && r.frequency === "DAILY");
  }

  function allowAddSubTaskDueDateRoll(r: KpiRecord) {
    return Boolean(r.isRecurring && r.frequency !== "DAILY");
  }

  async function addSubTaskToRecord(r: KpiRecord) {
    if (!showAdminTaskManagement) return;
    const draft = addSubTaskDraftFor(r);
    const title = draft.title.trim();
    if (!title) {
      setError("Sub Task title is required.");
      return;
    }
    const normalized = normalizeSubKpis(r.subKpis);
    if (!hideAddSubTaskScheduleDate(r) && draft.useCustomDueDate && !draft.dueDate.trim()) {
      setError("Choose a custom target date, or uncheck the option to inherit the main task date.");
      return;
    }
    const dueDate =
      hideAddSubTaskScheduleDate(r) || !draft.useCustomDueDate ? null : draft.dueDate.trim() || null;
    const dueDateRollsWithCycle = Boolean(
      dueDate && allowAddSubTaskDueDateRoll(r) && draft.dueDateRollsWithCycle,
    );
    setBusyId(r.id);
    setError(null);
    try {
      const res = await fetch(`/api/kpi-maintenance?tz=${encodeURIComponent(tz)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: r.id,
          addSubKpi: {
            title,
            // Segmented checklists: always land on Unassigned (drag into a segment afterward).
            segmentId: normalized.segmented ? UNSEGMENTED_SEGMENT_ID : null,
            dueDate,
            dueDateRollsWithCycle,
          },
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Could not add Sub Task.");
        return;
      }
      const updated = (await res.json()) as KpiRecord;
      setRows((prev) => prev.map((row) => (row.id === updated.id ? updated : row)));
      setAddSubTaskById((prev) => {
        const next = { ...prev };
        delete next[r.id];
        return next;
      });
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function updateSubTask(
    recordId: string,
    subKpiId: string,
    patch: {
      title?: string;
      startDate?: string | null;
      dueDate?: string | null;
      dueDateRollsWithCycle?: boolean | null;
      completionMode?: SubKpiCompletionMode;
      completionRequirements?: SubKpiCompletionRequirements | null;
      numericalTarget?: number | null;
      dailyPenaltyAmount?: number | null;
      delayPenaltyFrequency?: DelayPenaltyFrequency | null;
    },
  ) {
    const titleOnlyAsSuperAdmin =
      Boolean(patch.title !== undefined) &&
      isSuperAdmin &&
      Object.keys(patch).every((k) => k === "title");
    if (!showAdminTaskManagement && !titleOnlyAsSuperAdmin) return;
    setBusyId(recordId);
    setError(null);
    try {
      const res = await fetch(`/api/kpi-maintenance?tz=${encodeURIComponent(tz)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: recordId, updateSubKpi: { subKpiId, ...patch } }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Could not update Sub Task.");
        return;
      }
      const updated = (await res.json()) as KpiRecord;
      setRows((prev) => prev.map((row) => (row.id === updated.id ? updated : row)));
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function removeSubTask(recordId: string, subKpiId: string, title: string) {
    if (!showAdminTaskManagement) return;
    if (!window.confirm(`Remove Sub Task "${title}"? This cannot be undone.`)) return;
    setBusyId(recordId);
    setError(null);
    try {
      const res = await fetch(`/api/kpi-maintenance?tz=${encodeURIComponent(tz)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: recordId, removeSubKpi: { subKpiId } }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Could not remove Sub Task.");
        return;
      }
      const updated = (await res.json()) as KpiRecord;
      setRows((prev) => prev.map((row) => (row.id === updated.id ? updated : row)));
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function removeTask(r: KpiRecord) {
    if (!showAdminTaskManagement) return;
    const label = taskLabel(r).trim() || "this task";
    if (
      !window.confirm(
        `Remove task "${label}" from the board? This permanently deletes the task and cannot be undone.`,
      )
    ) {
      return;
    }
    setBusyId(r.id);
    setError(null);
    try {
      const res = await fetch(`/api/kpi-maintenance?tz=${encodeURIComponent(tz)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: r.id, deleteTask: true }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Could not remove task.");
        return;
      }
      if (activeTaskId === r.id) closeActiveTask();
      setRows((prev) => prev.filter((row) => row.id !== r.id));
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function patchTaskSchedule(r: KpiRecord, draft: TaskScheduleDraft) {
    if (!showAdminTaskManagement) return;
    const taskSchedule: Record<string, unknown> = {
      isRecurring: draft.isRecurring,
    };
    if (draft.isRecurring) {
      taskSchedule.frequency = draft.frequency;
    }
    if (draft.isRecurring && draft.frequency === "WEEKLY") {
      taskSchedule.recurrenceWeekday = draft.recurrenceWeekday;
    }
    if (draft.isRecurring && (draft.frequency === "MONTHLY" || draft.frequency === "QUARTERLY" || draft.frequency === "SEMI_ANNUAL" || draft.frequency === "YEARLY")) {
      taskSchedule.recurrenceMonthDay = draft.recurrenceMonthDay;
    }

    setBusyId(r.id);
    setError(null);
    try {
      const res = await fetch(`/api/kpi-maintenance?tz=${encodeURIComponent(tz)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: r.id, taskSchedule }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Could not update task schedule.");
        return;
      }
      const updated = (await res.json()) as KpiRecord;
      setRows((prev) => prev.map((row) => (row.id === updated.id ? updated : row)));
      setScheduleDraft(taskToScheduleDraft(updated));
      await load();
    } finally {
      setBusyId(null);
    }
  }

  const boardRows = useMemo(() => {
    let list = rows;
    // Company scope is applied by /api/kpi-maintenance?company= — do not re-filter here.
    if (orgSectionAgentIds) {
      list = list.filter((row) => {
        const mainId = row.assignedAgent?.id ?? null;
        if (mainId && orgSectionAgentIds.has(mainId)) return true;
        for (const agentId of orgSectionAgentIds) {
          if (hasSubKpiAssignedTo(row.subKpis, agentId)) return true;
        }
        return false;
      });
    }
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter((row) => {
        const haystack = [
          row.title,
          row.mainTask,
          row.itProjectName,
          taskLabel(row),
          row.assignedAgent?.name,
        ]
          .filter((part): part is string => Boolean(part && String(part).trim()))
          .join(" ")
          .toLowerCase();
        return haystack.includes(q);
      });
    }
    if (categoryFilter !== "all") {
      list = list.filter((row) => taskBoardCategoryOf(row) === categoryFilter);
    }
    if (frequencyFilter !== "all") {
      // Align with card badge ("DAILY TASK") / one-off — not project/field section keys.
      list = list.filter((row) => {
        const cat = taskBoardCategoryOf(row);
        if (cat !== "task") return false;
        if (frequencyFilter === "ONE-OFF") return row.isRecurring === false;
        return (
          row.isRecurring !== false &&
          String(row.frequency ?? "").trim().toUpperCase() === frequencyFilter
        );
      });
    }
    return list;
  }, [
    rows,
    orgSectionAgentIds,
    searchQuery,
    categoryFilter,
    frequencyFilter,
    nowMs,
    tz,
  ]);
  const hasBoardRows = boardRows.length > 0;
  const laneCounts = useMemo(() => {
    const counts: Record<"CURRENT" | "DONE" | "DELAYED", number> = {
      CURRENT: 0,
      DONE: 0,
      DELAYED: 0,
    };
    for (const row of boardRows) {
      const lane = statusOf(row);
      if (lane === "DONE") counts.DONE += 1;
      else if (lane === "DELAYED") counts.DELAYED += 1;
      else counts.CURRENT += 1;
    }
    return counts;
  }, [boardRows, nowMs, tz]);

  const forMyApprovalTasks = useMemo(
    () => rows.filter((row) => canVerifyCompletion(row)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, isElevatedAssign],
  );

  const approvalOperatorKey = operatorAgentId?.trim() || "unknown";
  const forMyApprovalUnreadCount = useMemo(() => {
    let n = 0;
    for (const row of forMyApprovalTasks) {
      if (!approvalSeenIds.has(row.id)) n += 1;
    }
    return n;
  }, [forMyApprovalTasks, approvalSeenIds]);

  useEffect(() => {
    if (!operatorAgentId) return;
    queueMicrotask(() => {
      setApprovalSeenIds(readTaskApprovalSeenIds(operatorAgentId));
    });
  }, [operatorAgentId]);

  useEffect(() => {
    let cancelled = false;
    function refreshVerificationSetting() {
      void fetch("/api/admin/task-verification-settings", { cache: "no-store" })
        .then(async (res) => {
          if (!res.ok || cancelled) return;
          const body = (await res.json().catch(() => ({}))) as { enabled?: boolean };
          if (!cancelled) setTaskVerificationEnabled(body.enabled !== false);
        })
        .catch(() => undefined);
    }
    refreshVerificationSetting();
    window.addEventListener("task-verification-settings-changed", refreshVerificationSetting);
    return () => {
      cancelled = true;
      window.removeEventListener("task-verification-settings-changed", refreshVerificationSetting);
    };
  }, []);

  function openForMyApproval() {
    const pendingIds = new Set(forMyApprovalTasks.map((row) => row.id));
    // Drop stale ids (already verified / no longer pending) and mark current queue as seen.
    const nextSeen = new Set([...approvalSeenIds].filter((id) => pendingIds.has(id)));
    for (const id of pendingIds) nextSeen.add(id);
    setApprovalSeenIds(nextSeen);
    writeTaskApprovalSeenIds(approvalOperatorKey, nextSeen);
    setForMyApprovalOpen(true);
  }

  const loadLocalTravelOrderListItems = useCallback(async () => {
    // Only queued offline creates are listed — local "saved draft" rows are intentionally
    // excluded from the Travel Orders list so drafts don't clutter the modal.
    const pendingRows = await listOfflineDrafts("pending");
    return pendingRows
      .filter((d) => !d.serverTravelOrderId)
      .map(offlineDraftAsListItem);
  }, []);

  const loadSavedTravelOrderDraftItems = useCallback(async () => {
    // Saved drafts (syncStatus "draft") are appended last so they stay resumable
    // and removable without cluttering the active list.
    const draftRows = await listOfflineDrafts("draft");
    return draftRows
      .filter((d) => !d.serverTravelOrderId)
      .map(offlineDraftAsListItem);
  }, []);

  async function removeDraftTravelOrder(localId: string) {
    if (confirmRemoveDraftId !== localId) {
      setConfirmRemoveDraftId(localId);
      window.setTimeout(() => {
        setConfirmRemoveDraftId((prev) => (prev === localId ? null : prev));
      }, 4000);
      return;
    }
    setConfirmRemoveDraftId(null);
    try {
      await deleteOfflineDraft(localId);
    } catch {
      // Draft already gone — treat as removed.
    }
    void reloadCompanyTravelOrders();
  }

  const reloadCompanyTravelOrders = useCallback(async () => {
    setCompanyTravelOrdersLoading(true);
    setCompanyTravelOrdersError(null);

    const localItems = await loadLocalTravelOrderListItems().catch(() => []);
    const savedDrafts = await loadSavedTravelOrderDraftItems().catch(() => []);
    const cachedEarly = await listAllCachedTravelOrders().catch(() => []);
    // Paint cache immediately so the modal is never empty while the network hangs.
    if (localItems.length > 0 || cachedEarly.length > 0 || savedDrafts.length > 0) {
      setCompanyTravelOrders([...localItems, ...cachedEarly, ...savedDrafts]);
    }

    try {
      if (!isBrowserOnline()) {
        if (localItems.length === 0 && cachedEarly.length === 0 && savedDrafts.length === 0) {
          setCompanyTravelOrdersError(
            "You are offline and no cached travel orders are available yet.",
          );
        }
        return;
      }

      async function fetchListOnce(timeoutMs: number): Promise<TravelOrderDto[]> {
        const res = await fetchTravelOrderWithTimeout(
          "/api/travel-orders",
          { cache: "no-store", credentials: "same-origin" },
          timeoutMs,
        );
        const body = (await res.json().catch(() => ({}))) as {
          travelOrders?: TravelOrderDto[];
          error?: string;
        };
        if (!res.ok) {
          throw new Error(body.error ?? "Could not load travel orders.");
        }
        return Array.isArray(body.travelOrders) ? body.travelOrders : [];
      }

      let list: TravelOrderDto[];
      try {
        list = await fetchListOnce(45_000);
      } catch (firstErr) {
        // One automatic retry after a short pause (covers cold compile / transient abort).
        if (!isTravelOrderNetworkFailure(firstErr)) throw firstErr;
        await new Promise((r) => setTimeout(r, 1500));
        list = await fetchListOnce(90_000);
      }

      setCompanyTravelOrders([...localItems, ...list, ...savedDrafts]);
      setCompanyTravelOrdersError(null);
      void cacheTravelOrders(list);
    } catch (err: unknown) {
      const hasCache =
        localItems.length > 0 || cachedEarly.length > 0 || savedDrafts.length > 0;
      if (!hasCache) {
        setCompanyTravelOrders([]);
      }
      const offline = typeof navigator !== "undefined" && !navigator.onLine;
      if (offline) {
        setCompanyTravelOrdersError(
          hasCache
            ? "Showing cached travel orders (offline)."
            : "You are offline and no cached travel orders are available yet.",
        );
      } else if (isTravelOrderNetworkFailure(err)) {
        setCompanyTravelOrdersError(
          hasCache
            ? "Still refreshing from the server — showing cached travel orders."
            : "Could not reach the server for travel orders. Try again in a moment.",
        );
      } else {
        setCompanyTravelOrdersError(
          err instanceof Error
            ? hasCache
              ? `${err.message} Showing cached travel orders.`
              : err.message
            : "Could not load travel orders.",
        );
      }
    } finally {
      setCompanyTravelOrdersLoading(false);
    }
  }, [loadLocalTravelOrderListItems]);

  // Warm-compile travel-order APIs as soon as the tasks page mounts (cold compile can exceed 20s).
  useEffect(() => {
    if (!isBrowserOnline()) return;
    const ctrl = new AbortController();
    const warm = (url: string) =>
      fetch(url, {
        cache: "no-store",
        credentials: "same-origin",
        signal: ctrl.signal,
      }).catch(() => undefined);
    void warm("/api/travel-orders");
    void warm("/api/kpi-maintenance/field-assignment");
    return () => {
      ctrl.abort();
    };
  }, []);

  useEffect(() => {
    if (!travelOrdersOpen) return;
    let cancelled = false;
    // Do not wait for offline flush — load the list immediately.
    void reloadCompanyTravelOrders();
    void flushTravelOrderPendingQueue().catch(() => undefined);

    if (typeof navigator !== "undefined" && navigator.onLine) {
      const worker = navigator.serviceWorker?.controller;
      worker?.postMessage({
        type: "WARM_TRAVEL_ORDER_SHELL",
        urls: ["/offline-travel-orders.html", "/agent/tasks", window.location.pathname],
      });
    }
    const unsub = subscribeTravelOrderConnectivity(() => {
      if (!isBrowserOnline() || cancelled) return;
      void reloadCompanyTravelOrders();
      void flushTravelOrderPendingQueue().catch(() => undefined);
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [travelOrdersOpen, reloadCompanyTravelOrders]);
  const agentNameById = useMemo(() => {
    const all = [...agents, ...allAssignableAgents, ...Object.values(subAssigneePeersByMainId).flat()];
    return new Map(dedupeAssignableAgents(all).map((a) => [a.id, a.name] as const));
  }, [agents, allAssignableAgents, subAssigneePeersByMainId]);

  /** Search candidates: page-scoped list when a company filter is active, full roster otherwise. */
  const assigneeCandidates = useMemo(() => {
    if (companyFilterTeamId && companyFilterTeamId !== "ALL") {
      return dedupeAssignableAgents([
        ...agents,
        ...allAssignableAgents.filter((a) => a.assignmentCompany?.id === companyFilterTeamId),
        ...Object.values(subAssigneePeersByMainId)
          .flat()
          .filter((a) => a.assignmentCompany?.id === companyFilterTeamId),
      ]);
    }
    return dedupeAssignableAgents([...allAssignableAgents, ...agents, ...Object.values(subAssigneePeersByMainId).flat()]);
  }, [agents, allAssignableAgents, subAssigneePeersByMainId, companyFilterTeamId]);

  /**
   * Assignee roster for reassignment:
   * - Elevated: company or department (org chart) scope — may cross company/department.
   * - Admin/Personnel: locked to designated company âˆ© org-chart department.
   * - Fallback: lock to the current main assignee's company when present.
   */
  function companyLockedCandidatesFor(r: KpiRecord): {
    candidates: AssigneeSearchAgent[];
    lockNote: string | null;
    emptyHint: string | null;
    scopeReady: boolean;
  } {
    const mainId = r.assignedAgent?.id ?? null;
    const main =
      mainId != null
        ? (assigneeCandidates.find((a) => a.id === mainId) ??
          allAssignableAgents.find((a) => a.id === mainId) ??
          (r.assignedAgent
            ? ({
                id: r.assignedAgent.id,
                name: r.assignedAgent.name,
                assignmentCompany: r.assignedAgent.team
                  ? { id: r.assignedAgent.team.id ?? null, name: r.assignedAgent.team.name ?? null }
                  : null,
                team: r.assignedAgent.team ?? null,
                isOnDuty: true,
              } satisfies AssignableAgent)
            : null))
        : null;
    const elevated = Boolean(assignRosterScope?.elevated || isElevatedAssign);
    const lockedIds = assignRosterScope?.lockedAgentIds ?? [];

    let list: AssignableAgent[];
    let lockNote: string | null = null;
    let emptyHint: string | null = null;
    let scopeReady = true;

    if (elevated) {
      if (assignPickerMode === "company") {
        scopeReady = Boolean(assignPickerCompanyId);
        const companyName =
          assignRosterScope?.companies.find((c) => c.id === assignPickerCompanyId)?.name ?? null;
        // Trust the company-scoped /api/agents fetch when present; otherwise fall back to
        // the full roster matched by assignment company id, team id, or company name.
        if (!scopeReady) {
          list = [];
        } else if (assignScopeAgents != null) {
          list = [...assignScopeAgents];
        } else {
          list = allAssignableAgents.filter((a) =>
            agentMatchesCompanyScope(a, assignPickerCompanyId, companyName),
          );
        }
        if (scopeReady) {
          lockNote = `Company: ${companyName ?? "selected"} Â· ${list.length} personnel Â· cross-company assign allowed`;
        } else {
          lockNote = "Select a company to list assignees";
          emptyHint = "Select a company first.";
        }
      } else {
        scopeReady = Boolean(assignPickerDepartmentId);
        list = scopeReady && assignScopeAgents != null ? [...assignScopeAgents] : [];
        const deptLabel = assignRosterScope?.departments.find((d) => d.value === assignPickerDepartmentId)?.label;
        if (scopeReady) {
          lockNote = `Department: ${deptLabel ?? "selected"} Â· ${list.length} personnel Â· cross-company`;
          if (list.length === 0) {
            emptyHint = "No personnel in this org-chart department.";
          }
        } else {
          lockNote = "Select an org-chart department to list assignees";
          emptyHint = "Select a department first.";
        }
      }
    } else if (assignRosterScope && lockedIds.length > 0) {
      const allowed = new Set(lockedIds);
      list = assigneeCandidates.filter((a) => allowed.has(a.id));
      lockNote = assignRosterScope.lockedCompanyName
        ? `Locked to ${assignRosterScope.lockedCompanyName} Â· your org-chart department`
        : "Locked to your company and org-chart department";
    } else if (assignRosterScope && !assignRosterScope.elevated) {
      list = [];
      lockNote = assignRosterScope.lockedCompanyName
        ? `No assignable personnel in ${assignRosterScope.lockedCompanyName} Â· your org-chart department`
        : "No assignable personnel in your company / department scope";
      emptyHint = lockNote;
    } else {
      const mainCompany = main ? assignmentCompanyKey(main) : null;
      const locked = Boolean(main && mainCompany && mainCompany !== ASSIGNMENT_NO_COMPANY);
      list = locked
        ? assigneeCandidates.filter((a) => assignmentCompanyKey(a) === mainCompany)
        : [...assigneeCandidates];
      lockNote = locked && mainCompany ? `Locked to ${assignmentCompanyName(main!)} personnel` : null;
    }

    // Keep current assignee visible only after a scope is ready (avoid a one-person fake roster).
    if (scopeReady && mainId && !list.some((a) => a.id === mainId) && main) {
      list = [...list, main];
    }
    // Elevated SuperAdmin/HighAdmin may assign Offline personnel; never strip them here.
    if (!elevated && !canAssignOffline) {
      if (mainId) {
        const withCurrent = list.filter((a) => agentIsOnDuty(a) || a.id === mainId);
        if (withCurrent.length > 0) list = withCurrent;
      } else {
        list = list.filter((a) => agentIsOnDuty(a));
      }
    }
    return {
      candidates: list,
      lockNote,
      emptyHint,
      scopeReady,
    };
  }

  /** Prefill elevated company scope from the task's current assignee when opening the editor. */
  function seedAssignScopeFromRecord(r: KpiRecord) {
    if (!(assignRosterScope?.elevated || isElevatedAssign)) return;
    const mainId = r.assignedAgent?.id;
    if (!mainId) return;
    const main =
      assigneeCandidates.find((a) => a.id === mainId) ??
      allAssignableAgents.find((a) => a.id === mainId) ??
      null;
    const companyId =
      main?.assignmentCompany?.id?.trim() ||
      main?.team?.id?.trim() ||
      r.assignedAgent?.team?.id?.trim() ||
      "";
    if (
      companyId &&
      assignRosterScope?.companies.some((c) => c.id === companyId) &&
      !assignPickerCompanyId
    ) {
      setAssignPickerMode("company");
      setAssignPickerCompanyId(companyId);
    }
  }

  function renderAssignScopePicker() {
    const elevated = Boolean(assignRosterScope?.elevated || isElevatedAssign);
    if (!elevated || !assignRosterScope) return null;
    return (
      <div className="flex w-56 max-w-full min-w-0 flex-col gap-1">
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setAssignPickerMode("company")}
            className={cn(
              "flex-1 rounded-md px-1.5 py-1 text-[10px] font-bold uppercase tracking-wide transition",
              assignPickerMode === "company"
                ? "bg-orange-500 text-white"
                : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700",
            )}
          >
            Company
          </button>
          <button
            type="button"
            onClick={() => setAssignPickerMode("department")}
            className={cn(
              "flex-1 rounded-md px-1.5 py-1 text-[10px] font-bold uppercase tracking-wide transition",
              assignPickerMode === "department"
                ? "bg-orange-500 text-white"
                : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700",
            )}
          >
            Department
          </button>
        </div>
        {assignPickerMode === "company" ? (
          <select
            value={assignPickerCompanyId}
            onChange={(e) => setAssignPickerCompanyId(e.target.value)}
            className="h-7 w-full rounded-md border border-zinc-300 bg-white px-1.5 text-[11px] text-zinc-800 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
            aria-label="Assign by company"
          >
            <option value="">Select company…</option>
            {assignRosterScope.companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        ) : (
          <select
            value={assignPickerDepartmentId}
            onChange={(e) => setAssignPickerDepartmentId(e.target.value)}
            className="h-7 w-full rounded-md border border-zinc-300 bg-white px-1.5 text-[11px] text-zinc-800 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
            aria-label="Assign by department"
          >
            <option value="">Select department…</option>
            {assignRosterScope.departments.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        )}
      </div>
    );
  }

  function subKpiAssigneeLabel(s: SubKpiItem) {
    const id = subKpiAssignedAgentId(s);
    if (!id) return "Sub Task assignee: unassigned";
    return `Sub Task assignee: ${agentNameById.get(id) ?? s.assignedAgentName ?? "assigned personnel"}`;
  }

  function canSeekAssistanceOnTask(r: KpiRecord): boolean {
    if (isItProjectImplementationPillar(r.title)) return false;
    if (r.enableSubtaskAssignees === true) return false;
    if (!operatorAgentId || r.assignedAgent?.id !== operatorAgentId) return false;
    return true;
  }

  function realSubKpiItems(items: SubKpiItem[]): SubKpiItem[] {
    return items.filter((s) => s.id !== PILLAR_ONLY_VIRTUAL_SUBKPI_ID);
  }

  function lockedSeekCandidates(r: KpiRecord, items: SubKpiItem[]): SubKpiItem[] {
    const enableAssignees = r.enableSubtaskAssignees === true;
    return realSubKpiItems(items).filter((s) => !isSubKpiAssigneeUnlocked(enableAssignees, s));
  }

  function shouldShowTaskSeekAssistance(r: KpiRecord, scopeItems: SubKpiItem[]): boolean {
    if (!canSeekAssistanceOnTask(r)) return false;
    const real = realSubKpiItems(scopeItems);
    if (real.length === 0) return true;
    return lockedSeekCandidates(r, real).length > 0;
  }

  function openTaskSeekAssistance(r: KpiRecord, scopeItems: SubKpiItem[], segmentLabel?: string | null) {
    const locked = lockedSeekCandidates(r, scopeItems);
    setSeekAssistModal({
      kpiId: r.id,
      taskTitle: taskLabel(r),
      segmentLabel: segmentLabel ?? null,
      candidates: locked.map((s) => ({ id: s.id, title: s.title || "Untitled sub-task" })),
    });
  }

  function renderTaskSeekAssistanceButton(
    r: KpiRecord,
    scopeItems: SubKpiItem[],
    opts?: { segmentLabel?: string | null; stopPropagation?: boolean },
  ) {
    if (!shouldShowTaskSeekAssistance(r, scopeItems)) return null;
    return (
      <button
        type="button"
        disabled={busyId === r.id}
        onClick={(e) => {
          if (opts?.stopPropagation) e.stopPropagation();
          openTaskSeekAssistance(r, scopeItems, opts?.segmentLabel);
        }}
        onPointerDown={opts?.stopPropagation ? (e) => e.stopPropagation() : undefined}
        className="inline-flex items-center gap-1.5 rounded-lg border border-orange-500 bg-orange-500 px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Seek Assistance
      </button>
    );
  }

  function renderSubKpiAssignmentControl(r: KpiRecord, s: SubKpiItem) {
    const assignedId = subKpiAssignedAgentId(s) ?? "";
    // Only treat an explicit true as unlocked from the parent flag (false must hide dropdowns).
    const enableAssignees = r.enableSubtaskAssignees === true;
    const unlocked = isSubKpiAssigneeUnlocked(enableAssignees, s);
    const isMainAssignee = Boolean(operatorAgentId && r.assignedAgent?.id === operatorAgentId);
    const canMutate = canMutateSubKpiAssignee({
      enableSubtaskAssignees: enableAssignees,
      item: s,
      canAssignWork,
      isMainAssignee,
    });
    const perSubtaskSeek = isTimelineProjectRecord(r);

    const assistanceBadge = s.assistanceRequested ? (
      <span className="inline-flex items-center rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
        Assistance Requested
      </span>
    ) : null;

    // When the global flag is OFF, never show the Unassigned/assignee dropdown to personnel
    // (including the main assignee). Admins may assign only after Seek Assistance unlocks.
    if (!enableAssignees && !canAssignWork) {
      if (isMainAssignee && perSubtaskSeek && !unlocked) {
        return (
          <div className="mt-2 flex flex-col gap-1.5">
            {assistanceBadge}
            <button
              type="button"
              disabled={busyId === r.id || !r.assignedAgent?.id}
              onClick={() => void seekAssistance(r.id, s.id)}
              className="rounded-lg border border-orange-500 bg-orange-500 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Seek Assistance
            </button>
            <p className="text-[10px] font-medium text-zinc-500 dark:text-zinc-500">
              Unlock a helper assignee for this subtask.
            </p>
          </div>
        );
      }
      return assistanceBadge ? <div className="mt-1">{assistanceBadge}</div> : null;
    }

    if (!unlocked) {
      // Task Management: Seek Assistance lives on the main task / segment — not each sub-task row.
      // IT Project Implementation keeps the per-subtask Seek Assistance control.
      if (isMainAssignee && perSubtaskSeek) {
        return (
          <div className="mt-2 flex flex-col gap-1.5">
            {assistanceBadge}
            <button
              type="button"
              disabled={busyId === r.id || !r.assignedAgent?.id}
              onClick={() => void seekAssistance(r.id, s.id)}
              className="rounded-lg border border-orange-500 bg-orange-500 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Seek Assistance
            </button>
            <p className="text-[10px] font-medium text-zinc-500 dark:text-zinc-500">
              Unlock a helper assignee for this subtask.
            </p>
          </div>
        );
      }
      // Locked for everyone else (and Task main assignee): no assignee dropdown / label.
      return assistanceBadge ? <div className="mt-1">{assistanceBadge}</div> : null;
    }

    if (!canMutate) {
      return (
        <div className="mt-1 flex flex-col gap-1">
          {assistanceBadge}
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{subKpiAssigneeLabel(s)}</p>
        </div>
      );
    }

    const mainAssigneeId = r.assignedAgent?.id;
    const { candidates: companyScopedAgents, lockNote, emptyHint } = companyLockedCandidatesFor(r);
    const elevated = Boolean(assignRosterScope?.elevated || isElevatedAssign);
    const subTaskCandidates = companyScopedAgents.filter((a) => a.id !== mainAssigneeId);
    const assignedStillVisible = assignedId && !subTaskCandidates.some((a) => a.id === assignedId);
    const assignedAgentObj = assignedId
      ? assigneeCandidates.find((a) => a.id === assignedId) ??
        allAssignableAgents.find((a) => a.id === assignedId) ??
        null
      : null;
    const candidateList =
      assignedStillVisible && assignedAgentObj ? [...subTaskCandidates, assignedAgentObj] : subTaskCandidates;
    const editing = editingSubAssigneeKey === `${r.id}:${s.id}`;
    const assigneeName = s.assignedAgentName?.trim() || "Unassigned";
    return (
      <div className="mt-2 flex flex-col gap-1.5">
        {assistanceBadge}
        <div className="flex flex-col gap-1">
          <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-600 dark:text-zinc-500">
            Sub Task assignee
          </p>
          {editing ? (
            <div className="flex w-56 max-w-full min-w-0 flex-col gap-1" data-assignee-editor>
              {renderAssignScopePicker()}
              <AgentAssigneeSearch
                key={`sub-assignee-${r.id}-${s.id}-${assignPickerMode}-${assignPickerCompanyId}-${assignPickerDepartmentId}`}
                value={assignedId}
                agents={candidateList}
                placeholder="Search sub-task assignee…"
                selectedLabel={s.assignedAgentName?.trim() || null}
                emptyHint={emptyHint}
                allowClear
                disabled={busyId === r.id}
                autoFocus
                inputClassName="rounded-none border-0 border-b border-dashed border-zinc-400 bg-transparent pb-0.5 pt-0 pr-2 focus:border-orange-500 dark:border-zinc-500 dark:bg-transparent"
                onSelect={(agentId) => {
                  void assignSubKpi(r.id, s.id, agentId);
                  setEditingSubAssigneeKey(null);
                }}
              />
              {lockNote ? (
                <p
                  className={cn(
                    "text-[10px] font-medium",
                    elevated
                      ? "text-zinc-500 dark:text-zinc-400"
                      : "text-amber-800 dark:text-amber-200/90",
                  )}
                >
                  {lockNote}
                </p>
              ) : null}
            </div>
          ) : (
            <button
              type="button"
              data-assignee-editor
              onClick={(e) => {
                e.stopPropagation();
                seedAssignScopeFromRecord(r);
                setEditingAssigneeId(null);
                setEditingSubAssigneeKey(`${r.id}:${s.id}`);
              }}
              onPointerDown={(e) => e.stopPropagation()}
              className="group inline-flex max-w-full items-center gap-1.5 rounded-md px-1 py-0.5 text-left text-[11px] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400/70 focus-visible:ring-offset-1 focus-visible:ring-offset-white dark:focus-visible:ring-offset-zinc-900"
              title="Click to change sub-task assignee"
              aria-label="Change sub-task assignee"
            >
              {assignedAgentObj ? <AssigneeAvatar agent={assignedAgentObj} className="size-4" /> : null}
              <span
                className={cn(
                  "min-w-0 truncate font-semibold underline-offset-4 transition group-hover:underline group-hover:decoration-zinc-400 group-hover:decoration-dotted dark:group-hover:decoration-zinc-500",
                  assignedId ? "text-zinc-700 dark:text-zinc-300" : "text-zinc-400 dark:text-zinc-500",
                )}
              >
                {assigneeName}
              </span>
              <Pencil
                className="size-3 shrink-0 text-zinc-400 opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100 pointer-coarse:opacity-60 dark:text-zinc-500"
                aria-hidden
              />
            </button>
          )}
        </div>
      </div>
    );
  }

  function renderPillarScreenshotField(r: KpiRecord, slot: TaskScreenshotSlot, editable: boolean) {
    const screenshots = parseTaskScreenshotMetaList(getPillarScreenshots(r.subKpis, slot));
    const label =
      slot === "before" ? "Before screenshot" : slot === "after" ? "After screenshot" : "Screenshot";
    const canUpload = editable || canAssignWork;
    const canRemove = canUpload && !taskCardDone(r);
    const remainingSlots = Math.max(0, MAX_TASK_SCREENSHOTS_PER_SLOT - screenshots.length);
    const mediaBusy = mediaBusyId === r.id || busyId === r.id;
    const inputId = `pillar-shot-${r.id}-${slot}`;
    return (
      <div className="rounded-lg border border-orange-200 bg-orange-50/60 p-2 dark:border-orange-800/50 dark:bg-orange-950/20">
        <p className="text-[10px] font-bold uppercase tracking-wide text-orange-800 dark:text-orange-200">{label}</p>
        {screenshots.length > 0 ? (
          <div className="mt-1 space-y-1">
            {screenshots.map((meta, index) => (
              <div key={meta.storedFileName} className="flex items-center justify-between gap-2 text-[11px]">
                <a
                  href={`/api/kpi-maintenance/${r.id}/screenshots/${encodeURIComponent(meta.storedFileName)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-semibold text-orange-700 hover:underline dark:text-orange-300"
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  View {index + 1}
                </a>
                {canRemove ? (
                  <button
                    type="button"
                    disabled={mediaBusy}
                    onClick={(e) => {
                      e.stopPropagation();
                      void removePillarScreenshot(r.id, slot, meta.storedFileName);
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                    className="rounded-full border border-orange-300 px-2 py-0.5 font-semibold text-orange-800 hover:bg-orange-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-orange-800 dark:text-orange-200 dark:hover:bg-orange-950/50"
                    aria-label={`Remove ${label.toLowerCase()} ${index + 1}`}
                  >
                    Remove
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
        <button
          type="button"
          disabled={!canUpload || mediaBusy || remainingSlots === 0}
          onClick={(e) => {
            e.stopPropagation();
            openTaskScreenshotPicker(inputId);
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className={cn(
            "mt-2 inline-flex rounded-full bg-orange-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-orange-500",
            (!canUpload || mediaBusy || remainingSlots === 0) &&
              "cursor-not-allowed opacity-60 hover:bg-orange-600",
          )}
        >
          {mediaBusyId === r.id ? "Uploading…" : "Choose File"}
        </button>
        <input
          id={inputId}
          type="file"
          multiple
          accept={TASK_SCREENSHOT_ACCEPT}
          disabled={!canUpload || mediaBusy || remainingSlots === 0}
          onChange={(e) => {
            e.stopPropagation();
            armFilePickerGuard(1500);
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            void uploadPillarScreenshots(r.id, slot, files, screenshots.length);
          }}
          className="sr-only"
          aria-label={`Upload 1 to ${remainingSlots} ${label.toLowerCase()} images for ${taskLabel(r)}`}
        />
      </div>
    );
  }

  function taskUsesSubKpiScreenshotUpload(r: KpiRecord): boolean {
    if (isPillarOnlyTask(r.subKpis)) return false;
    return collectAllSubKpiItems(normalizeSubKpis(r.subKpis)).some((item) =>
      subKpiRequiresScreenshotUpload(resolveSubKpiCompletionRequirements(item)),
    );
  }

  function renderPillarScreenshotFields(r: KpiRecord, editable: boolean) {
    if (taskUsesSubKpiScreenshotUpload(r)) return null;
    const pillarReqs = getPillarCompletionRequirements(r.subKpis);
    const genericEnabled =
      pillarScreenshotUploadEnabled(r.subKpis) || Boolean(pillarReqs?.screenshotUpload);
    const legacyBeforeAfter =
      (pillarScreenshotsEnabled(r.subKpis) || Boolean(pillarReqs?.screenshots)) && !genericEnabled;
    if (!genericEnabled && !legacyBeforeAfter) return null;

    if (genericEnabled) {
      return (
        <div className="mt-3 rounded-lg border border-orange-300/60 bg-orange-50/60 p-3 dark:border-orange-800/60 dark:bg-orange-950/20">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-orange-800 dark:text-orange-200">
              Pillar screenshots
            </p>
            <p className="text-[10px] text-orange-700 dark:text-orange-300">
              {isPillarOnlyTask(r.subKpis)
                ? r.isRecurring !== false
                  ? "Upload proof on the task card to complete this cycle."
                  : "Upload proof on the task card to complete this item."
                : "Cached for recurring cycles; checkbox completion is unchanged."}
            </p>
          </div>
          <div className="mt-2">{renderPillarScreenshotField(r, "general", editable)}</div>
        </div>
      );
    }

    return (
      <div className="mt-3 rounded-lg border border-orange-300/60 bg-orange-50/60 p-3 dark:border-orange-800/60 dark:bg-orange-950/20">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-orange-800 dark:text-orange-200">
            Pillar screenshots
          </p>
          <p className="text-[10px] text-orange-700 dark:text-orange-300">
            {isPillarOnlyTask(r.subKpis)
              ? r.isRecurring !== false
                ? "Upload proof on the task card to complete this cycle. Screenshots archive when the task recurs."
                : "Upload proof on the task card to complete this item."
              : "Cached for recurring cycles; remove before Done if the proof is wrong."}
          </p>
        </div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {renderPillarScreenshotField(r, "before", editable)}
          {renderPillarScreenshotField(r, "after", editable)}
        </div>
      </div>
    );
  }

  function renderScreenshotField(r: KpiRecord, s: SubKpiItem, slot: TaskScreenshotSlot, editable: boolean) {
    const screenshots = parseTaskScreenshotMetaList(
      slot === "before"
        ? s.beforeScreenshot
        : slot === "after"
          ? s.afterScreenshot
          : s.uploadScreenshot,
    );
    const label =
      slot === "before"
        ? "Before screenshot"
        : slot === "after"
          ? "After screenshot"
          : "Screenshot upload";
    const canUpload = editable || canAssignWork;
    const canRemove = canUpload && !s.done && !taskCardDone(r);
    const remainingSlots = Math.max(0, MAX_TASK_SCREENSHOTS_PER_SLOT - screenshots.length);
    const mediaBusy = mediaBusyId === r.id || busyId === r.id;
    const inputId = `sub-shot-${r.id}-${s.id}-${slot}`;
    return (
      <div className="rounded-lg border border-zinc-200 bg-white/60 p-2 dark:border-zinc-700 dark:bg-zinc-950/40">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-600 dark:text-zinc-500">{label}</p>
        </div>
        {screenshots.length > 0 ? (
          <div className="mt-1 space-y-1">
            {screenshots.map((meta, index) => (
              <div key={meta.storedFileName} className="flex items-center justify-between gap-2 text-[11px]">
                <a
                  href={`/api/kpi-maintenance/${r.id}/screenshots/${encodeURIComponent(meta.storedFileName)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 font-semibold text-orange-700 hover:underline dark:text-orange-300"
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  View {index + 1}
                </a>
                {canRemove ? (
                  <button
                    type="button"
                    disabled={mediaBusy}
                    onClick={(e) => {
                      e.stopPropagation();
                      void removeSubKpiScreenshot(r.id, s.id, slot, meta.storedFileName);
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                    className="rounded-full border border-zinc-300 px-2 py-0.5 font-semibold text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
                    aria-label={`Remove ${label.toLowerCase()} ${index + 1} for ${s.title}`}
                  >
                    Remove
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
        <button
          type="button"
          disabled={!canUpload || mediaBusy || remainingSlots === 0}
          onClick={(e) => {
            e.stopPropagation();
            openTaskScreenshotPicker(inputId);
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className={cn(
            "mt-2 inline-flex rounded-full bg-orange-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-orange-500",
            (!canUpload || mediaBusy || remainingSlots === 0) &&
              "cursor-not-allowed opacity-60 hover:bg-orange-600",
          )}
        >
          {mediaBusyId === r.id ? "Uploading…" : "Choose File"}
        </button>
        <input
          id={inputId}
          type="file"
          multiple
          accept={TASK_SCREENSHOT_ACCEPT}
          disabled={!canUpload || mediaBusy || remainingSlots === 0}
          onChange={(e) => {
            e.stopPropagation();
            armFilePickerGuard(1500);
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            void uploadSubKpiScreenshots(r.id, s.id, slot, files, screenshots.length);
          }}
          className="sr-only"
          aria-label={`Upload 1 to ${remainingSlots} ${label.toLowerCase()} images for ${s.title}`}
        />
      </div>
    );
  }

  function renderSubKpiScreenshotUploadFields(r: KpiRecord, s: SubKpiItem, editable: boolean) {
    if (!subKpiRequiresScreenshotUpload(resolveSubKpiCompletionRequirements(s))) return null;
    const recurring = r.isRecurring !== false;
    return (
      <div className="mt-2">
        <p className="mb-1 text-[10px] text-zinc-500 dark:text-zinc-500">
          {recurring
            ? "Uploads are cached for recurring cycles. Remove before marking this sub-task done if needed."
            : "Attach proof images for this sub-task."}
        </p>
        {renderScreenshotField(r, s, "general", editable)}
      </div>
    );
  }

  function renderTaskScreenshotFields(r: KpiRecord, s: SubKpiItem, editable: boolean) {
    if (!subKpiRequiresScreenshots(resolveSubKpiCompletionRequirements(s))) return null;
    return (
      <div className="mt-2">
        <p className="mb-1 text-[10px] text-zinc-500 dark:text-zinc-500">
          Screenshots are cached for recurring cycles. Remove them before marking this sub-task Done if needed.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
        {renderScreenshotField(r, s, "before", editable)}
        {renderScreenshotField(r, s, "after", editable)}
        </div>
      </div>
    );
  }

  function renderNumericalRecordField(
    r: KpiRecord,
    s: SubKpiItem,
    editable: boolean,
    canManageSubTasks: boolean,
    pillarOnlyMode = false,
  ) {
    if (!subKpiRequiresNumerical(resolveSubKpiCompletionRequirements(s))) return null;
    const recurring = r.isRecurring !== false;
    const target = s.numericalTarget;
    const actual = s.numericalValue;
    const progressPercent = numericalRecordProgressPercent(actual, target);
    const targetMet = progressPercent != null && progressPercent >= 100;
    const archivedEntries = archivedNumericalEntriesForSubKpi(r.subKpis, s.id);
    // Target is set at create and locked. Admins may adjust only after at least one recurrence;
    // changes apply to the current period only (archives keep prior periods).
    const canEditTarget =
      canManageSubTasks &&
      canAdjustNumericalTarget({
        isRecurring: recurring,
        subKpisRaw: r.subKpis,
        subKpiId: s.id,
      });
    return (
      <div className="mt-2 space-y-2">
        {recurring ? (
          <p className="text-[10px] text-zinc-500 dark:text-zinc-500">
            {canEditTarget
              ? "You can set or change the target while this cycle is running. Prior cycles stay in the archive below."
              : "Ask an admin to set the target number for this cycle."}
          </p>
        ) : (
          <p className="text-[10px] text-zinc-500 dark:text-zinc-500">
            {canEditTarget
              ? "You can set or change the target while this task is running."
              : "Ask an admin to set the target number."}
          </p>
        )}
        {archivedEntries.length > 0 ? (
          <div className="rounded-lg border border-zinc-200 bg-zinc-50/80 p-2 dark:border-zinc-700 dark:bg-zinc-950/50">
            <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-500 dark:text-zinc-500">
              Previous cycles
            </p>
            <ul className="mt-1 space-y-1 text-[11px] text-zinc-700 dark:text-zinc-300">
              {archivedEntries.slice(-3).map((entry) => (
                <li key={entry.archivedAt} className="tabular-nums">
                  {new Date(entry.archivedAt).toLocaleDateString(undefined, { timeZone: tz })} Â· target{" "}
                  {entry.numericalTarget ?? "—"} Â· actual {entry.numericalValue ?? "—"}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="grid gap-2 sm:grid-cols-2">
          {canEditTarget ? (
            <label className="flex flex-col text-[10px] font-bold uppercase tracking-wide text-zinc-600 dark:text-zinc-500">
              Target number (this cycle)
              <input
                type="number"
                step="any"
                min={0}
                value={numericalFieldDisplay(r.id, s.id, "target", target)}
                disabled={busyId === r.id}
                onChange={(e) => setNumericalFieldDraft(r.id, s.id, "target", e.target.value)}
                onBlur={() => {
                  const raw = numericalFieldDisplay(r.id, s.id, "target", target).trim();
                  clearNumericalFieldDraft(r.id, s.id, "target");
                  if (raw === "") {
                    if (target == null) return;
                    if (canManageSubTasks && !pillarOnlyMode) {
                      void updateSubTask(r.id, s.id, { numericalTarget: null });
                      return;
                    }
                    void patchSubKpiWorkMeta(r.id, s.id, { numericalTarget: null });
                    return;
                  }
                  const nextTarget = Number(raw);
                  if (!Number.isFinite(nextTarget) || nextTarget <= 0) {
                    setError("Target number must be a positive number.");
                    return;
                  }
                  if (target != null && nextTarget === target) return;
                  if (canManageSubTasks && !pillarOnlyMode) {
                    void updateSubTask(r.id, s.id, { numericalTarget: nextTarget });
                    return;
                  }
                  void patchSubKpiWorkMeta(r.id, s.id, { numericalTarget: nextTarget });
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    (e.target as HTMLInputElement).blur();
                  }
                }}
                className="mt-1 rounded-lg border border-zinc-300 bg-white px-2 py-2 text-xs font-semibold text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                aria-label={`Target number for ${s.title}`}
              />
            </label>
          ) : target != null ? (
            <div className="flex flex-col text-[10px] font-bold uppercase tracking-wide text-zinc-600 dark:text-zinc-500">
              Target number
              <span className="mt-1 rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-2 text-xs font-semibold tabular-nums text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100">
                {target}
              </span>
            </div>
          ) : (
            <div className="flex flex-col text-[10px] font-bold uppercase tracking-wide text-zinc-600 dark:text-zinc-500">
              Target number
              <span className="mt-1 rounded-lg border border-dashed border-zinc-300 bg-zinc-50/50 px-2 py-2 text-xs font-medium text-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-400">
                Not set for this cycle
              </span>
            </div>
          )}
          <label className="flex flex-col text-[10px] font-bold uppercase tracking-wide text-zinc-600 dark:text-zinc-500">
            Actual record
            <input
              type="number"
              step="any"
              value={numericalFieldDisplay(r.id, s.id, "value", actual)}
              disabled={!editable || target == null}
              onChange={(e) => setNumericalFieldDraft(r.id, s.id, "value", e.target.value)}
              onBlur={() => {
                if (target == null) {
                  clearNumericalFieldDraft(r.id, s.id, "value");
                  return;
                }
                const raw = numericalFieldDisplay(r.id, s.id, "value", actual).trim();
                clearNumericalFieldDraft(r.id, s.id, "value");
                if (raw === "") {
                  if (actual == null) return;
                  void patchSubKpiWorkMeta(r.id, s.id, { numericalValue: null });
                  return;
                }
                const nextValue = Number(raw);
                if (!Number.isFinite(nextValue)) {
                  setError("Actual record must be a valid number.");
                  return;
                }
                if (actual != null && nextValue === actual) return;
                void patchSubKpiWorkMeta(r.id, s.id, { numericalValue: nextValue });
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  (e.target as HTMLInputElement).blur();
                }
              }}
              className={cn(
                "mt-1 rounded-lg border px-2 py-2 text-xs font-semibold tabular-nums dark:bg-zinc-900 dark:text-zinc-100",
                target != null && actual != null
                  ? targetMet
                    ? "border-emerald-400 bg-emerald-50 text-emerald-900 dark:border-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-200"
                    : "border-amber-400 bg-amber-50 text-amber-950 dark:border-amber-600 dark:bg-amber-950/40 dark:text-amber-200"
                  : "border-zinc-300 bg-white text-zinc-900 dark:border-zinc-700",
              )}
              aria-label={`Actual record for ${s.title}`}
            />
          </label>
        </div>
      </div>
    );
  }

  function renderDailyPenaltyField(
    r: KpiRecord,
    s: SubKpiItem,
    canManageSubTasks: boolean,
  ) {
    if (!canManageSubTasks) return null;
    const ctx = penaltyContextForRecord(r);
    const accrued = subKpiAccruedPenalty(s, ctx);
    const freq = resolveSubKpiDelayPenaltyFrequency(s, ctx);
    const unitLabel = delayPenaltyFrequencyLabel(freq);
    return (
      <div className="mt-2 space-y-1">
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex flex-col text-[10px] font-bold uppercase tracking-wide text-zinc-600 dark:text-zinc-500">
            Penalty frequency
            <select
              value={s.delayPenaltyFrequency ?? ""}
              disabled={busyId === r.id}
              onChange={(e) => {
                const raw = e.target.value;
                void updateSubTask(r.id, s.id, {
                  delayPenaltyFrequency: raw === "" ? null : (raw as DelayPenaltyFrequency),
                });
              }}
              className="mt-1 rounded-lg border border-zinc-300 bg-white px-2 py-2 text-xs font-semibold text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
              aria-label={`Delay penalty frequency for ${s.title}`}
            >
              <option value="">Task default ({taskDelayPenaltyFrequencyFromSubKpis(r.subKpis)})</option>
              {DELAY_PENALTY_FREQUENCIES.map((option) => (
                <option key={option} value={option}>
                  {option.charAt(0) + option.slice(1).toLowerCase()}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col text-[10px] font-bold uppercase tracking-wide text-zinc-600 dark:text-zinc-500">
            Penalty per {unitLabel}
            <input
              type="number"
              min={0}
              step="any"
              value={s.dailyPenaltyAmount ?? ""}
              disabled={busyId === r.id}
              placeholder={
                taskDailyPenaltyAmountFromSubKpis(r.subKpis) != null
                  ? String(taskDailyPenaltyAmountFromSubKpis(r.subKpis))
                  : "Task default"
              }
              onChange={(e) => {
                const raw = e.target.value.trim();
                void updateSubTask(r.id, s.id, {
                  dailyPenaltyAmount: raw === "" ? null : Number(raw),
                });
              }}
              className="mt-1 rounded-lg border border-zinc-300 bg-white px-2 py-2 text-xs font-semibold text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
              aria-label={`Delay penalty for ${s.title}`}
            />
          </label>
        </div>
        {accrued > 0 ? (
          <p className="text-[11px] font-semibold text-rose-700 dark:text-rose-300">
            Accrued penalty: {accrued} Â· {subKpiPenaltyDays(s, ctx)} day
            {subKpiPenaltyDays(s, ctx) === 1 ? "" : "s"} â†’ {freq.toLowerCase()} units Ã—{" "}
            {resolveSubKpiDailyPenaltyAmount(s, ctx)}/{unitLabel}
          </p>
        ) : null}
      </div>
    );
  }

  function renderTaskLevelDailyPenaltyField(r: KpiRecord) {
    const virtual = mainTaskCheckboxItem(r.subKpis, taskLabel(r));
    if (!virtual) return null;
    const ctx = penaltyContextForRecord(r);
    const accrued = subKpiAccruedPenalty(virtual, ctx);
    const freq = taskDelayPenaltyFrequencyFromSubKpis(r.subKpis);
    const unitLabel = delayPenaltyFrequencyLabel(freq);
    return (
      <div className="mt-2 space-y-1">
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex flex-col text-[10px] font-bold uppercase tracking-wide text-zinc-600 dark:text-zinc-500">
            Penalty frequency
            <select
              value={freq}
              disabled={busyId === r.id}
              onChange={(e) =>
                void patchTaskDelayPenaltyFrequency(r.id, e.target.value as DelayPenaltyFrequency)
              }
              className="mt-1 rounded-lg border border-zinc-300 bg-white px-2 py-2 text-xs font-semibold text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            >
              {DELAY_PENALTY_FREQUENCIES.map((option) => (
                <option key={option} value={option}>
                  {option.charAt(0) + option.slice(1).toLowerCase()}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col text-[10px] font-bold uppercase tracking-wide text-zinc-600 dark:text-zinc-500">
            Penalty per {unitLabel} (main task)
            <input
              type="number"
              min={0}
              step="any"
              value={taskDailyPenaltyAmountFromSubKpis(r.subKpis) ?? ""}
              disabled={busyId === r.id}
              onChange={(e) => {
                const raw = e.target.value.trim();
                void patchTaskDailyPenalty(r.id, raw === "" ? null : Math.max(0, Number(raw)));
              }}
              className="mt-1 rounded-lg border border-zinc-300 bg-white px-2 py-2 text-xs font-semibold text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
              aria-label={`Delay penalty for ${taskLabel(r)}`}
            />
          </label>
        </div>
        {accrued > 0 ? (
          <p className="text-[11px] font-semibold text-rose-700 dark:text-rose-300">
            Accrued penalty: {accrued} Â· {subKpiPenaltyDays(virtual, ctx)} day
            {subKpiPenaltyDays(virtual, ctx) === 1 ? "" : "s"} â†’ {freq.toLowerCase()} units Ã—{" "}
            {resolveSubKpiDailyPenaltyAmount(virtual, ctx)}/{unitLabel}
          </p>
        ) : null}
      </div>
    );
  }

  function renderPillarMainTaskCheckboxInline(
    r: KpiRecord,
    s: SubKpiItem,
    hidePendingStatusBadge = false,
  ) {
    const subEditable = canEditSubKpi(r, s);
    const subCompletable = canCompleteSubKpi(r, s);
    const completionRequirements = resolveSubKpiCompletionRequirements(s);
    const submitted = subKpiRequirementsMet(s);
    const parentVerified = isCompletionEffectivelyVerified(r);
    const pendingVerify = isSubKpiPendingVerification(s, {
      parentCardEffectivelyVerified: parentVerified,
      verificationEnabled: taskVerificationEnabled,
    });
    const verifiedFinished = isSubKpiEffectivelyVerified(s, {
      parentCardEffectivelyVerified: parentVerified,
      verificationEnabled: taskVerificationEnabled,
    });
    const rejectedVerify = isSubKpiVerificationRejected(s);
    const finished = submitted;
    const showCheckbox =
      subEditable && busyId !== r.id && subKpiRequiresCheckbox(completionRequirements);
    const invertedRecording = taskUsesInvertedRecording({ title: r.title, subKpis: r.subKpis });
    const statusBadge = invertedRecording
      ? finished && !hidePendingStatusBadge
        ? (
            <span
              className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300"
            >
              Flagged
            </span>
          )
        : null
      : finished || !hidePendingStatusBadge
        ? (
            <span
              className={cn(
                "rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                verifiedFinished
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                  : pendingVerify
                    ? "border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-300"
                    : rejectedVerify
                      ? "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300"
                      : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
              )}
            >
              {verifiedFinished
                ? "Finished"
                : pendingVerify
                  ? "For verification"
                  : rejectedVerify
                    ? "Returned"
                    : "Pending"}
            </span>
          )
        : null;

    if (!showCheckbox && !statusBadge) return null;

    return (
      <div className="flex shrink-0 items-center gap-2">
        {showCheckbox ? (
          <input
            type="checkbox"
            className="size-4 shrink-0"
            checked={finished}
            disabled={!subCompletable}
            onChange={() => void toggleSubKpi(r.id, s.id, finished)}
            aria-label={`Mark ${taskLabel(r)} as ${finished ? "pending" : "done"}`}
          />
        ) : null}
        {statusBadge}
      </div>
    );
  }

  function renderNonItSubKpiCard(
    r: KpiRecord,
    s: SubKpiItem,
    showPriority = true,
    pillarOnlyMode = false,
    hidePendingStatusBadge = false,
    skipPillarCheckbox = false,
  ) {
    const subEditable = canEditSubKpi(r, s);
    const subCompletable = canCompleteSubKpi(r, s);
    const canManageSubTasks = showAdminTaskManagement;
    const completionRequirements = resolveSubKpiCompletionRequirements(s);
    const needsScreenshotsForCheckbox =
      completionRequirements.screenshots && !hasBeforeAndAfterScreenshots(s);
    const needsScreenshotUploadForCheckbox =
      completionRequirements.screenshotUpload && !hasScreenshotUpload(s);
    const needsNumericalForCheckbox =
      completionRequirements.numerical &&
      (numericalRecordProgressPercent(s.numericalValue, s.numericalTarget) ?? 0) < 100;
    const canEditWorkDetails = subEditable || canAssignWork || canManageSubTasks;
    const recurring = r.isRecurring !== false;
    const showDueDateFields = !hideAddSubTaskScheduleDate(r);
    const submitted = subKpiRequirementsMet(s);
    const parentVerified = isCompletionEffectivelyVerified(r);
    const pendingVerify = isSubKpiPendingVerification(s, {
      parentCardEffectivelyVerified: parentVerified,
      verificationEnabled: taskVerificationEnabled,
    });
    const verifiedFinished = isSubKpiEffectivelyVerified(s, {
      parentCardEffectivelyVerified: parentVerified,
      verificationEnabled: taskVerificationEnabled,
    });
    const rejectedVerify = isSubKpiVerificationRejected(s);
    const finished = submitted;
    const showCheckbox =
      subEditable && busyId !== r.id && subKpiRequiresCheckbox(completionRequirements);
    const progressMismatchWarning =
      showCheckbox &&
      subKpiProgressMismatchWarning(s, r.assignedAgent, {
        id: operatorAgentId,
        name: operatorAgentName,
      });
    const hidePillarTitle = pillarOnlyMode && !kpiHasDistinctMainTask(r);
    const invertedRecording = taskUsesInvertedRecording({ title: r.title, subKpis: r.subKpis });
    const pillarOnlyExtras =
      needsScreenshotsForCheckbox ||
      needsNumericalForCheckbox ||
      needsScreenshotUploadForCheckbox ||
      progressMismatchWarning ||
      (!completionRequirements.checkbox && completionRequirements.screenshots && !finished) ||
      (!completionRequirements.checkbox && completionRequirements.screenshotUpload && !finished) ||
      (!completionRequirements.checkbox && completionRequirements.numerical && !finished) ||
      (pillarOnlyMode && !recurring && canManageSubTasks);
    if (pillarOnlyMode && skipPillarCheckbox && !pillarOnlyExtras) {
      return null;
    }
    return (
      <div
        key={s.id}
        className={cn(
          pillarOnlyMode
            ? pillarOnlyExtras
              ? "space-y-2"
              : "flex flex-wrap items-center justify-between gap-2"
            : "rounded-lg border border-zinc-200/80 bg-white/60 p-3 dark:border-zinc-700 dark:bg-zinc-950/40",
          !pillarOnlyMode &&
            finished &&
            "border-emerald-300/70 bg-emerald-50/60 dark:border-emerald-800/50 dark:bg-emerald-950/20",
        )}
      >
        {!(pillarOnlyMode && skipPillarCheckbox) ? (
        <div
          className={cn(
            "flex flex-wrap justify-between gap-2",
            pillarOnlyMode ? "items-center" : "items-start",
            pillarOnlyMode && !pillarOnlyExtras && "w-full",
          )}
        >
          <div
            className={cn(
              "flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100",
              !hidePillarTitle && "min-w-0 flex-1",
              !pillarOnlyMode && "items-start",
            )}
          >
            {showCheckbox ? (
              <input
                type="checkbox"
                className={cn("size-4 shrink-0", !pillarOnlyMode && "mt-1")}
                checked={finished}
                disabled={!subCompletable}
                onChange={() => void toggleSubKpi(r.id, s.id, finished)}
                aria-label={`Mark ${pillarOnlyMode ? taskLabel(r) : s.title} as ${finished ? "pending" : "done"}`}
              />
            ) : null}
            {canManageSubTasks && !pillarOnlyMode ? (
              <input
                key={`subtask-title-${r.id}-${s.id}-${s.title}`}
                type="text"
                defaultValue={s.title}
                disabled={busyId === r.id}
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                onBlur={(e) => {
                  const next = e.target.value.trim();
                  const prev = s.title.trim();
                  if (next && next !== prev) {
                    void updateSubTask(r.id, s.id, { title: next });
                  } else if (!next) {
                    e.target.value = prev;
                  }
                }}
                aria-label="Sub Task title"
                className={cn(
                  "min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-2 py-1 text-sm font-semibold normal-case tracking-normal text-zinc-900 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100",
                  finished && "line-through opacity-70",
                )}
              />
            ) : (
              <span
                className={cn(
                  "min-w-0",
                  finished && "line-through opacity-70",
                  hidePillarTitle && "sr-only",
                )}
              >
                {pillarOnlyMode ? taskLabel(r) : s.title}
              </span>
            )}
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            {canManageSubTasks && !pillarOnlyMode ? (
              <button
                type="button"
                disabled={busyId === r.id}
                onClick={(e) => {
                  e.stopPropagation();
                  void removeSubTask(r.id, s.id, s.title);
                }}
                onPointerDown={(e) => e.stopPropagation()}
                className="rounded-full border border-rose-400/60 px-2 py-0.5 text-[10px] font-semibold text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-500/40 dark:text-rose-300 dark:hover:bg-rose-950/40"
              >
                Remove
              </button>
            ) : null}
            {invertedRecording
              ? finished && !hidePendingStatusBadge
                ? (
                    <span
                      className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300"
                    >
                      Flagged
                    </span>
                  )
                : null
              : finished || !hidePendingStatusBadge
                ? (
                    <span
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                        verifiedFinished
                          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                          : pendingVerify
                            ? "border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-300"
                            : rejectedVerify
                              ? "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300"
                              : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
                      )}
                    >
                      {verifiedFinished
                        ? "Finished"
                        : pendingVerify
                          ? "For verification"
                          : rejectedVerify
                            ? "Returned"
                            : "Pending"}
                    </span>
                  )
                : null}
          </div>
        </div>
        ) : null}
        {!pillarOnlyMode && s.description ? (
          <p className="mt-1 whitespace-pre-wrap text-xs text-zinc-600 dark:text-zinc-400">
            {s.description}
          </p>
        ) : null}
        {!pillarOnlyMode ? (
          canEditWorkDetails ? (
            <label className="mt-2 flex flex-col text-[10px] font-bold uppercase tracking-wide text-zinc-600 dark:text-zinc-500">
              Remarks
              <span className="mt-0.5 text-[10px] font-normal normal-case tracking-normal text-zinc-500 dark:text-zinc-400">
                Optional
              </span>
              <textarea
                key={`remarks-${r.id}-${s.id}-${s.remarks ?? ""}`}
                defaultValue={s.remarks ?? ""}
                rows={2}
                disabled={busyId === r.id}
                placeholder="Optional remarks or notes"
                onBlur={(e) => {
                  const next = e.target.value.trim();
                  const prev = (s.remarks ?? "").trim();
                  if (next === prev) return;
                  void patchSubKpiWorkMeta(r.id, s.id, { remarks: next || null });
                }}
                onPointerDown={(e) => e.stopPropagation()}
                className="mt-1 resize-y rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-xs font-normal normal-case tracking-normal text-zinc-900 placeholder:text-zinc-400 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
              />
            </label>
          ) : s.remarks ? (
            <p className="mt-1 whitespace-pre-wrap text-xs text-zinc-500 dark:text-zinc-500">
              <span className="font-semibold text-zinc-600 dark:text-zinc-400">Remarks: </span>
              {s.remarks}
            </p>
          ) : null
        ) : null}
        {needsScreenshotsForCheckbox && completionRequirements.checkbox ? (
          <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">
            Upload both before and after screenshots before marking this sub-task done.
          </p>
        ) : null}
        {needsNumericalForCheckbox && completionRequirements.checkbox ? (
          <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">
            Reach 100% progress (actual ÷ target) before marking this sub-task done.
          </p>
        ) : null}
        {!completionRequirements.checkbox && completionRequirements.screenshots && !finished ? (
          <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">
            Upload before and after screenshots to complete this sub-task.
          </p>
        ) : null}
        {needsScreenshotUploadForCheckbox && completionRequirements.checkbox ? (
          <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">
            Upload at least one screenshot before marking this sub-task done.
          </p>
        ) : null}
        {!completionRequirements.checkbox && completionRequirements.screenshotUpload && !finished ? (
          <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">
            Upload at least one screenshot to complete this sub-task.
          </p>
        ) : null}
        {!completionRequirements.checkbox && completionRequirements.numerical && !finished ? (
          <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">
            Enter a numerical record to complete this sub-task.
          </p>
        ) : null}
        {progressMismatchWarning ? (
          <p
            className="mt-1 rounded-md border border-amber-500/35 bg-amber-500/10 px-2 py-1.5 text-[11px] font-semibold text-amber-800 dark:text-amber-200"
            role="status"
          >
            {SUB_KPI_PROGRESS_MISMATCH_WARNING}
          </p>
        ) : null}
        {pillarOnlyMode ? null : renderSubKpiAssignmentControl(r, s)}
        {canManageSubTasks && !pillarOnlyMode ? (
          <div className="mt-2 space-y-2 rounded-lg border border-zinc-200/80 bg-zinc-50/70 p-2.5 dark:border-zinc-700 dark:bg-zinc-950/50">
            <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-600 dark:text-zinc-500">
              Completion conditions
            </p>
            <p className="text-[10px] font-medium normal-case tracking-normal text-zinc-500 dark:text-zinc-400">
              Select one or more ways this sub-task can be completed.
            </p>
            {(
              [
                {
                  key: "checkbox" as const,
                  label: "Checklist checkbox",
                  checked: completionRequirements.checkbox,
                },
                {
                  key: "screenshots" as const,
                  label: "Before/after screenshot uploads",
                  checked: completionRequirements.screenshots,
                },
                {
                  key: "screenshotUpload" as const,
                  label: "Screenshot upload",
                  checked: completionRequirements.screenshotUpload,
                },
                {
                  key: "numerical" as const,
                  label: "Numerical record",
                  checked: completionRequirements.numerical,
                },
              ] as const
            ).map((option) => (
              <label
                key={option.key}
                className="flex cursor-pointer items-start gap-2 text-[11px] font-semibold text-zinc-700 dark:text-zinc-300"
              >
                <input
                  type="checkbox"
                  checked={option.checked}
                  disabled={busyId === r.id}
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                  onChange={(e) => {
                    const next: SubKpiCompletionRequirements = {
                      ...completionRequirements,
                      [option.key]: e.target.checked,
                    };
                    if (
                      !next.checkbox &&
                      !next.screenshots &&
                      !next.screenshotUpload &&
                      !next.numerical
                    ) {
                      setError("Select at least one completion condition.");
                      return;
                    }
                    setError(null);
                    void updateSubTask(r.id, s.id, { completionRequirements: next });
                  }}
                  className="mt-0.5 size-3.5 rounded border-zinc-300 text-orange-600 focus:ring-orange-500"
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        ) : null}
        {showPriority || showDueDateFields || !recurring ? (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {showPriority ? (
            <label className="flex flex-col text-[10px] font-bold uppercase tracking-wide text-zinc-600 dark:text-zinc-500">
              Priority
              <select
                value={s.projectPriority ?? "Medium"}
                disabled={!canEditWorkDetails || busyId === r.id}
                onChange={(e) =>
                  void patchSubKpiWorkMeta(r.id, s.id, {
                    projectPriority: e.target.value,
                  })
                }
                className="mt-1 rounded-lg border border-zinc-300 bg-white px-2 py-2 text-xs font-semibold text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
              >
                {IT_PROJECT_PRIORITY_OPTIONS.map((priority) => (
                  <option key={priority} value={priority}>
                    {priority}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {showDueDateFields ? (
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              {!pillarOnlyMode ? (
                <label className="flex cursor-pointer items-start gap-2 text-[11px] font-semibold text-zinc-700 dark:text-zinc-300">
                  <input
                    type="checkbox"
                    checked={subKpiHasCustomDueDate(s)}
                    disabled={!canEditWorkDetails || busyId === r.id}
                    onChange={(e) => {
                      if (!e.target.checked) {
                        if (canManageSubTasks) {
                          void updateSubTask(r.id, s.id, {
                            dueDate: null,
                            dueDateRollsWithCycle: false,
                          });
                          return;
                        }
                        void patchSubKpiWorkMeta(r.id, s.id, { dueDate: null });
                        return;
                      }
                      const seed =
                        getTaskTargetDueDate(r.subKpis) || new Date().toISOString().slice(0, 10);
                      if (canManageSubTasks) {
                        void updateSubTask(r.id, s.id, { dueDate: seed });
                        return;
                      }
                      void patchSubKpiWorkMeta(r.id, s.id, { dueDate: seed });
                    }}
                    className="mt-0.5 size-3.5 rounded border-zinc-300 text-orange-600 focus:ring-orange-500"
                  />
                  <span>
                    Use custom target date
                    {!subKpiHasCustomDueDate(s) ? (
                      <span className="mt-0.5 block text-[10px] font-medium text-zinc-500 dark:text-zinc-500">
                        {getTaskTargetDueDate(r.subKpis)
                          ? `Uses main task target (${getTaskTargetDueDate(r.subKpis)})`
                          : recurring
                            ? "Uses the recurring cycle deadline when unset"
                            : "Will use main task target date"}
                      </span>
                    ) : null}
                  </span>
                </label>
              ) : null}
              {pillarOnlyMode || subKpiHasCustomDueDate(s) ? (
                <div className="flex flex-col gap-2 sm:max-w-xs">
                  <label className="flex flex-col text-[10px] font-bold uppercase tracking-wide text-zinc-600 dark:text-zinc-500">
                    Target date
                    <DatePickerField
                      value={s.dueDate ?? ""}
                      disabled={!canEditWorkDetails || busyId === r.id}
                      onChange={(e) => {
                        const value = e.target.value || null;
                        if (canManageSubTasks && !pillarOnlyMode) {
                          void updateSubTask(r.id, s.id, {
                            dueDate: value,
                            ...(value ? {} : { dueDateRollsWithCycle: false }),
                          });
                          return;
                        }
                        void patchSubKpiWorkMeta(r.id, s.id, { dueDate: value });
                      }}
                      wrapperClassName="mt-1"
                      aria-label={`Target date for ${s.title}`}
                    />
                  </label>
                  {allowAddSubTaskDueDateRoll(r) &&
                  !pillarOnlyMode &&
                  subKpiHasCustomDueDate(s) &&
                  canManageSubTasks ? (
                    <label className="flex cursor-pointer items-start gap-2 text-[11px] font-semibold normal-case tracking-normal text-zinc-700 dark:text-zinc-300">
                      <input
                        type="checkbox"
                        checked={subKpiDueDateRollsWithCycle(s)}
                        disabled={busyId === r.id}
                        onChange={(e) =>
                          void updateSubTask(r.id, s.id, {
                            dueDateRollsWithCycle: e.target.checked,
                          })
                        }
                        className="mt-0.5 size-3.5 rounded border-zinc-300 text-orange-600 focus:ring-orange-500"
                      />
                      <span>
                        Adjust with each recurring cycle
                        <span className="mt-0.5 block text-[10px] font-medium text-zinc-500 dark:text-zinc-500">
                          e.g. Aug 15 becomes Sep 15 on the next monthly cycle
                        </span>
                      </span>
                    </label>
                  ) : allowAddSubTaskDueDateRoll(r) &&
                    !pillarOnlyMode &&
                    subKpiDueDateRollsWithCycle(s) ? (
                    <p className="text-[10px] font-medium text-zinc-500 dark:text-zinc-500">
                      Rolls with each recurring cycle
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
          {!recurring ? (
            <label className="flex flex-col text-[10px] font-bold uppercase tracking-wide text-zinc-600 dark:text-zinc-500">
              Date finished
              <DatePickerField
                value={s.actualDate ?? ""}
                disabled={!subEditable || busyId === r.id}
                onChange={(e) =>
                  void patchSubKpiWorkMeta(r.id, s.id, {
                    actualDate: e.target.value || null,
                  })
                }
                wrapperClassName="mt-1"
                aria-label={`Date finished for ${s.title}`}
              />
            </label>
          ) : null}
        </div>
        ) : null}
        {s.id === PILLAR_ONLY_VIRTUAL_SUBKPI_ID
          ? renderPillarScreenshotFields(r, subEditable || canAssignWork)
          : (
            <>
              {renderTaskScreenshotFields(r, s, subEditable)}
              {renderSubKpiScreenshotUploadFields(r, s, subEditable)}
            </>
          )}
        {renderNumericalRecordField(r, s, subEditable, canManageSubTasks, pillarOnlyMode)}
        {!pillarOnlyMode ? renderDailyPenaltyField(r, s, canManageSubTasks) : null}
        {pillarOnlyMode && !recurring && canManageSubTasks
          ? renderTaskLevelDailyPenaltyField(r)
          : null}
      </div>
    );
  }

  function renderItProjectSubKpiCard(
    r: KpiRecord,
    s: SubKpiItem,
    _parentEditable: boolean,
    phase: ItProjectPhase,
  ) {
    const subEditable = canEditSubKpi(r, s);
    const projectStatus = s.projectStatus ?? (s.assignedAgentId ? "Pending" : "");
    const projectProgress = itProjectStatusProgress(s);
    const started = Boolean(s.startDate?.trim() || s.startedAt?.trim());
    const ended = hasValidActualDate(s) || Boolean(s.endedAt?.trim());
    const canStart = subEditable && !started && !ended;
    const canEnd = subEditable && started && !ended;
    const mainDue = getTaskTargetDueDate(r.subKpis);
    const effectiveDue = resolvePhaseEffectiveTargetDate(phase, mainDue) ?? "";
    const selectClass =
      "mt-1 w-full rounded-lg border border-zinc-300 bg-white px-2.5 py-2 text-xs font-semibold text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100";

    return (
      <div
        key={s.id}
        className="rounded-lg border border-zinc-200/90 bg-zinc-50/80 p-3 dark:border-zinc-600 dark:bg-zinc-950/40"
      >
        <div className="flex items-start gap-2 text-xs text-zinc-800 dark:text-zinc-200">
          <span
            className={cn(
              "mt-0.5 size-2.5 shrink-0 rounded-full",
              projectProgress === 100
                ? "bg-emerald-500"
                : projectProgress >= 50
                  ? "bg-orange-500"
                  : "bg-amber-500",
            )}
            aria-hidden
          />
          {isSuperAdmin ? (
            <input
              key={`project-subtask-title-${r.id}-${s.id}-${s.title}`}
              type="text"
              defaultValue={s.title}
              disabled={busyId === r.id}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onBlur={(e) => {
                const next = e.target.value.trim();
                const prev = s.title.trim();
                if (next && next !== prev) {
                  void updateSubTask(r.id, s.id, { title: next });
                } else if (!next) {
                  e.target.value = prev;
                }
              }}
              aria-label="Project subtask title"
              title="SuperAdmin: edit subtask title"
              className={cn(
                "min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-2 py-1 text-xs font-semibold text-zinc-900 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100",
                projectProgress === 100 && "line-through opacity-70",
              )}
            />
          ) : (
            <span
              className={cn(
                "min-w-0 flex-1 font-semibold",
                projectProgress === 100 && "line-through opacity-70",
              )}
            >
              {s.title}
            </span>
          )}
        </div>

        {renderSubKpiAssignmentControl(r, s)}

        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!canStart || busyId === r.id}
            onClick={() => void patchSubKpiLifecycle(r.id, s.id, "start")}
            className={cn(
              "rounded-lg px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide",
              canStart
                ? "bg-emerald-600 text-white hover:bg-emerald-500"
                : "cursor-not-allowed bg-zinc-200 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500",
            )}
          >
            Start
          </button>
          <button
            type="button"
            disabled={!canEnd || busyId === r.id}
            onClick={() => void patchSubKpiLifecycle(r.id, s.id, "end")}
            className={cn(
              "rounded-lg px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide",
              canEnd
                ? "bg-orange-600 text-white hover:bg-orange-500"
                : "cursor-not-allowed bg-zinc-200 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500",
            )}
          >
            End
          </button>
        </div>

        {(started || ended) && (
          <div className="mt-1.5 space-y-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
            {started ? (
              <p>
                Started {s.startedAt ? new Date(s.startedAt).toLocaleString() : s.startDate}
                {typeof s.startedLatitude === "number" && typeof s.startedLongitude === "number"
                  ? ` Â· ${s.startedLatitude.toFixed(5)}, ${s.startedLongitude.toFixed(5)}`
                  : ""}
              </p>
            ) : null}
            {ended ? (
              <p>
                Ended {s.endedAt ? new Date(s.endedAt).toLocaleString() : s.actualDate}
                {typeof s.endedLatitude === "number" && typeof s.endedLongitude === "number"
                  ? ` Â· ${s.endedLatitude.toFixed(5)}, ${s.endedLongitude.toFixed(5)}`
                  : ""}
              </p>
            ) : null}
          </div>
        )}

        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <label className="flex min-w-0 flex-col text-[10px] font-bold uppercase tracking-wide text-zinc-600 dark:text-zinc-500">
            Priority
            <select
              value={s.projectPriority ?? "Medium"}
              disabled={!subEditable || busyId === r.id}
              onChange={(e) =>
                void patchSubKpiProjectMeta(r.id, s.id, {
                  projectPriority: e.target.value,
                })
              }
              className={selectClass}
            >
              {IT_PROJECT_PRIORITY_OPTIONS.map((priority) => (
                <option key={priority} value={priority}>
                  {priority}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-0 flex-col text-[10px] font-bold uppercase tracking-wide text-zinc-600 dark:text-zinc-500">
            Completion
            <select
              value={projectStatus}
              disabled={!subEditable || busyId === r.id || !s.assignedAgentId}
              onChange={(e) =>
                void patchSubKpiProjectMeta(r.id, s.id, {
                  projectStatus: e.target.value,
                })
              }
              className={selectClass}
            >
              {!projectStatus ? <option value="">Assign first</option> : null}
              {IT_PROJECT_STATUS_OPTIONS.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>
          <div className="flex min-w-0 flex-col justify-end rounded-lg border border-zinc-200 bg-white px-2.5 py-2 sm:col-span-2 dark:border-zinc-800 dark:bg-zinc-900/70">
            <div className="mb-1 flex items-center justify-between gap-2 text-[10px] font-bold uppercase tracking-wide text-zinc-500">
              <span>Progress</span>
              <span>{projectProgress}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
              <div
                className="h-full rounded-full bg-orange-500 transition-[width]"
                style={{ width: `${projectProgress}%` }}
              />
            </div>
          </div>
        </div>

        {!hasValidActualDate(s) ? (
          <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-300">
            Use End Task (or set Completion to Done) when finished.
          </p>
        ) : null}

        <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
          Status:{" "}
          <span
            className={cn(
              "font-semibold",
              isItProjectSubTaskDelayed(
                effectiveDue ? { ...s, dueDate: effectiveDue } : s,
                nowMs,
                tz,
              )
                ? "text-rose-700 dark:text-rose-400"
                : hasValidActualDate(s)
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-amber-700 dark:text-amber-300",
            )}
          >
            {subTaskStatusLabel(
              effectiveDue ? { ...s, dueDate: effectiveDue } : s,
              nowMs,
              tz,
            )}
          </span>
        </p>
        {(() => {
          const penaltyCtx = {
            nowMs,
            timeZone: tz,
            frequency: (r.frequency as KpiFrequencyCode) ?? "DAILY",
            isRecurring: false as const,
            title: r.title,
            taskDailyPenaltyAmount: taskDailyPenaltyAmountFromSubKpis(r.subKpis),
            taskDelayPenaltyFrequency: taskDelayPenaltyFrequencyFromSubKpis(r.subKpis),
            phaseDueDate: effectiveDue || null,
          };
          const penalty = subKpiAccruedPenalty(s, penaltyCtx);
          const canManagePenalty = showAdminTaskManagement;
          return (
            <div className="mt-2 space-y-1">
              {canManagePenalty ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="flex min-w-0 flex-col text-[10px] font-bold uppercase tracking-wide text-zinc-600 dark:text-zinc-500">
                    Penalty frequency
                    <select
                      value={s.delayPenaltyFrequency ?? ""}
                      disabled={busyId === r.id}
                      onChange={(e) => {
                        const raw = e.target.value;
                        void updateSubTask(r.id, s.id, {
                          delayPenaltyFrequency:
                            raw === "" ? null : (raw as DelayPenaltyFrequency),
                        });
                      }}
                      className={selectClass}
                    >
                      <option value="">
                        Task default ({taskDelayPenaltyFrequencyFromSubKpis(r.subKpis)})
                      </option>
                      {DELAY_PENALTY_FREQUENCIES.map((option) => (
                        <option key={option} value={option}>
                          {option.charAt(0) + option.slice(1).toLowerCase()}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex min-w-0 flex-col text-[10px] font-bold uppercase tracking-wide text-zinc-600 dark:text-zinc-500">
                    Penalty per{" "}
                    {delayPenaltyFrequencyLabel(
                      resolveSubKpiDelayPenaltyFrequency(s, penaltyCtx),
                    )}
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={s.dailyPenaltyAmount ?? ""}
                      disabled={busyId === r.id}
                      placeholder={
                        taskDailyPenaltyAmountFromSubKpis(r.subKpis) != null
                          ? String(taskDailyPenaltyAmountFromSubKpis(r.subKpis))
                          : "Task default"
                      }
                      onChange={(e) => {
                        const raw = e.target.value.trim();
                        void updateSubTask(r.id, s.id, {
                          dailyPenaltyAmount: raw === "" ? null : Number(raw),
                        });
                      }}
                      className={selectClass}
                    />
                  </label>
                </div>
              ) : null}
              {penalty > 0 ? (
                <p className="text-[11px] font-semibold text-rose-700 dark:text-rose-400">
                  Delay penalty: âˆ’{penalty} pts
                  {subKpiPenaltyDays(s, penaltyCtx) > 0
                    ? ` (${subKpiPenaltyDays(s, penaltyCtx)}d overdue)`
                    : ""}
                </p>
              ) : null}
            </div>
          );
        })()}
      </div>
    );
  }

  function renderAddSubTaskPanel(r: KpiRecord) {
    if (!showAdminTaskManagement || isItProjectImplementationPillar(r.title) || isMainTaskOnlyRecord(r.subKpis, { title: r.title, mainTask: r.mainTask })) {
      return null;
    }
    const normalized = normalizeSubKpis(r.subKpis);
    const draft = addSubTaskDraftFor(r);
    const hideSchedule = hideAddSubTaskScheduleDate(r);
    return (
      <div className="mt-3 rounded-lg border border-dashed border-orange-400/50 bg-orange-500/[0.04] p-3 dark:border-orange-500/35 dark:bg-orange-500/[0.07]">
        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-orange-800 dark:text-orange-200">
          Add Sub Task
        </p>
        <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
          {normalized.segmented ? (
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 sm:col-span-2">
              New sub-tasks land on Unassigned. Drag them into a segment — the task cannot finalize
              while Unassigned still has cards.
            </p>
          ) : null}
          <label className="flex flex-col text-[10px] font-bold uppercase tracking-wide text-zinc-600 dark:text-zinc-500">
            Title
            <input
              type="text"
              value={draft.title}
              disabled={busyId === r.id}
              placeholder="Sub Task title"
              onChange={(e) => patchAddSubTaskDraft(r, { title: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void addSubTaskToRecord(r);
                }
              }}
              className="mt-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
            />
          </label>
          {!hideSchedule ? (
            <div className="flex flex-col gap-2 sm:col-span-2">
              <label className="flex cursor-pointer items-start gap-2 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                <input
                  type="checkbox"
                  checked={draft.useCustomDueDate}
                  disabled={busyId === r.id}
                  onChange={(e) =>
                    patchAddSubTaskDraft(r, {
                      useCustomDueDate: e.target.checked,
                      ...(e.target.checked ? {} : { dueDate: "", dueDateRollsWithCycle: false }),
                    })
                  }
                  className="mt-0.5 size-3.5 rounded border-zinc-300 text-orange-600 focus:ring-orange-500"
                />
                <span>
                  Use custom target date for this subtask
                  {!draft.useCustomDueDate ? (
                    <span className="mt-0.5 block text-[11px] font-medium text-zinc-500 dark:text-zinc-500">
                      {getTaskTargetDueDate(r.subKpis)
                        ? `Will use main task target date (${getTaskTargetDueDate(r.subKpis)})`
                        : "Will use main task target date"}
                    </span>
                  ) : null}
                </span>
              </label>
              {draft.useCustomDueDate ? (
                <div className="flex max-w-xs flex-col gap-2">
                  <label className="flex flex-col text-[10px] font-bold uppercase tracking-wide text-zinc-600 dark:text-zinc-500">
                    Target date
                    <DatePickerField
                      value={draft.dueDate}
                      disabled={busyId === r.id}
                      onChange={(e) => patchAddSubTaskDraft(r, { dueDate: e.target.value })}
                      wrapperClassName="mt-1"
                      aria-label="Target date for new Sub Task"
                    />
                  </label>
                  {allowAddSubTaskDueDateRoll(r) ? (
                    <label className="flex cursor-pointer items-start gap-2 text-xs font-semibold normal-case tracking-normal text-zinc-700 dark:text-zinc-300">
                      <input
                        type="checkbox"
                        checked={draft.dueDateRollsWithCycle}
                        disabled={busyId === r.id}
                        onChange={(e) =>
                          patchAddSubTaskDraft(r, { dueDateRollsWithCycle: e.target.checked })
                        }
                        className="mt-0.5 size-3.5 rounded border-zinc-300 text-orange-600 focus:ring-orange-500"
                      />
                      <span>
                        Adjust with each recurring cycle
                        <span className="mt-0.5 block text-[11px] font-medium text-zinc-500 dark:text-zinc-500">
                          e.g. Aug 15 becomes Sep 15 on the next monthly cycle
                        </span>
                      </span>
                    </label>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="flex items-end sm:col-span-2">
            <button
              type="button"
              disabled={busyId === r.id || !draft.title.trim()}
              onClick={() => void addSubTaskToRecord(r)}
              className="rounded-lg bg-orange-600 px-4 py-2 text-xs font-semibold text-white hover:bg-orange-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Add Sub Task
            </button>
          </div>
        </div>
      </div>
    );
  }

  function renderTaskSubtaskContent(
    r: KpiRecord,
    opts?: {
      segmentFilter?: string;
      hideSubtaskPendingBadge?: boolean;
      hidePillarMainCheckbox?: boolean;
    },
  ) {
    const segmentFilter = opts?.segmentFilter?.trim() || "ALL";
    const hideSubtaskPendingBadge = opts?.hideSubtaskPendingBadge ?? false;
    const hidePillarMainCheckbox = opts?.hidePillarMainCheckbox ?? false;
    const itProject = isTimelineProjectRecord(r);
    const normalized = normalizeSubKpis(r.subKpis);
    const itProjectData = itProject ? parseItProjectSubKpis(r.subKpis, r.itProjectPhase) : null;
    if (!itProject && isMainTaskOnlyRecord(r.subKpis, { title: r.title, mainTask: r.mainTask })) {
      const checkboxItem = mainTaskCheckboxItem(r.subKpis, taskLabel(r));
      if (checkboxItem) {
        return (
          <div className="space-y-2">
            {renderTaskSeekAssistanceButton(r, [], { stopPropagation: true })}
            {renderNonItSubKpiCard(
              r,
              checkboxItem,
              false,
              true,
              hideSubtaskPendingBadge,
              hidePillarMainCheckbox,
            )}
          </div>
        );
      }
    }
    const checklistItems = collectAllSubKpiItems(normalized);
    const editable = canEditChecklist(r);
    const showSubtaskPriority = itProject || checklistItems.length <= 1;

    if (!itProject && normalized.segmented) {
      const visibleSegments =
        segmentFilter === "ALL"
          ? normalized.segments
          : normalized.segments.filter((seg) => seg.id === segmentFilter);
      if (visibleSegments.length === 0) {
        return (
          <p className="rounded-md border border-dashed border-zinc-300 bg-zinc-50/80 px-3 py-4 text-center text-xs text-zinc-500 dark:border-zinc-700 dark:bg-zinc-950/40 dark:text-zinc-400">
            No sub-tasks in this segment.
          </p>
        );
      }
      return visibleSegments.map((seg) => (
        <div
          key={seg.id}
          className="rounded-md border border-zinc-200/80 bg-white/60 p-2 dark:border-zinc-700 dark:bg-zinc-900/50"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-orange-700 dark:text-orange-400">
              {isUnsegmentedSegmentId(seg.id) ? UNSEGMENTED_SEGMENT_LABEL : seg.label}
              <span className="ml-1.5 font-semibold normal-case tracking-normal text-zinc-500 dark:text-zinc-400">
                ({seg.items.length})
              </span>
            </p>
            {renderTaskSeekAssistanceButton(r, seg.items, {
              segmentLabel: seg.label,
              stopPropagation: true,
            })}
          </div>
          <div className="mt-1 space-y-2">
            {seg.items.length === 0 ? (
              <p className="px-1 py-2 text-[11px] text-zinc-500 dark:text-zinc-400">No sub-tasks yet.</p>
            ) : (
              seg.items.map((s) =>
                renderNonItSubKpiCard(r, s, showSubtaskPriority, false, hideSubtaskPendingBadge),
              )
            )}
          </div>
        </div>
      ));
    }

    if (itProject && itProjectData) {
      return (
        <ProjectTimelineKanban
          phases={itProjectData.phases}
          mainProjectDueDate={getTaskTargetDueDate(r.subKpis)}
          timeZone={tz}
          busy={busyId === r.id}
          onEditPhaseDueDate={
            showAdminTaskManagement
              ? (phaseId, dueDate) => void patchPhaseDueDate(r.id, phaseId, dueDate)
              : undefined
          }
          renderSubtask={(phase, subtaskId) => {
            const s = phase.items.find((it) => it.id === subtaskId);
            if (!s) return null;
            return renderItProjectSubKpiCard(r, s, editable, phase);
          }}
        />
      );
    }

    return (
      <div className="space-y-2">
        {renderTaskSeekAssistanceButton(r, checklistItems, { stopPropagation: true })}
        {checklistItems.map((s: SubKpiItem) =>
          renderNonItSubKpiCard(r, s, showSubtaskPriority, false, hideSubtaskPendingBadge),
        )}
      </div>
    );
  }

  const kpiStatusDrag = usePointerColumnDrag<KpiBoardStatus>({
    onDrop: (id, col) => void move(id, col),
    disabled: busyId != null,
    activationDistance: 12,
    onDragEnd: () => setLaneRegisterKey((key) => key + 1),
  });

  /**
   * Inline assignee search rendered IN PLACE of the assignee field while editing:
   * an underline-style input showing the current assignee name. The roster dropdown
   * is portaled above the card, so it is never clipped by the card's overflow-hidden.
   */
  function assigneeSearchFor(r: KpiRecord) {
    const currentId = r.assignedAgent?.id ?? "";
    const { candidates, lockNote, emptyHint } = companyLockedCandidatesFor(r);
    const elevated = Boolean(assignRosterScope?.elevated || isElevatedAssign);
    return (
      <div className="flex w-56 max-w-full min-w-0 flex-col gap-1" data-assignee-editor>
        {renderAssignScopePicker()}
        <AgentAssigneeSearch
          key={`assignee-${r.id}-${assignPickerMode}-${assignPickerCompanyId}-${assignPickerDepartmentId}`}
          value={currentId}
          agents={candidates}
          placeholder="Search assignee…"
          selectedLabel={r.assignedAgent?.name ?? null}
          emptyHint={emptyHint}
          allowClear={canUnassignWork}
          disabled={busyId === r.id}
          autoFocus
          inputClassName="rounded-none border-0 border-b border-dashed border-zinc-400 bg-transparent pb-0.5 pt-0 pr-2 focus:border-orange-500 dark:border-zinc-500 dark:bg-transparent"
          onSelect={(agentId) => {
            void assignKpi(r.id, agentId);
            setEditingAssigneeId(null);
          }}
        />
        {lockNote ? (
          <p
            className={cn(
              "text-[10px] font-medium leading-snug",
              elevated
                ? "text-zinc-500 dark:text-zinc-400"
                : "text-amber-800 dark:text-amber-200/90",
            )}
          >
            {lockNote}
            {!elevated ? "." : null}
          </p>
        ) : null}
      </div>
    );
  }

  /**
   * Avatar shown in the card's Assignee line. Resolves the assigned agent from the
   * search roster so the profile photo (if any) renders next to the name.
   */
  function assigneeAvatarFor(r: KpiRecord) {
    const id = r.assignedAgent?.id;
    if (!id) return null;
    const agent = assigneeCandidates.find((a) => a.id === id) ?? null;
    if (!agent) return null;
    return <AssigneeAvatar agent={agent} className="size-5" />;
  }

  /**
   * Card assignee line: avatar + the assignee's full name. The name wraps instead of
   * truncating so it stays readable even on narrow board cards. When `canEdit` is set,
   * the whole field is clickable — there is no separate edit button — and clicking it
   * swaps the field for an inline assignee search (edit in place). The edit affordance
   * is a dotted underline under the name: revealed on hover / focus for mouse users,
   * always visible (subtle) on touch devices where hover does not exist.
   */
  function assigneeLine(r: KpiRecord, opts?: { canEdit?: boolean; editing?: boolean }) {
    const avatar = assigneeAvatarFor(r);
    const name = r.assignedAgent?.name?.trim() || "Unassigned";
    const canEdit = opts?.canEdit ?? false;
    const editing = opts?.editing ?? false;

    if (!canEdit) {
      return (
        <span className="inline-flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
          {avatar}
          <span className="min-w-0 font-semibold text-zinc-700 dark:text-zinc-300" title={name}>
            {name}
          </span>
        </span>
      );
    }

    // Edit in place: the search input replaces the field itself (no separate card below).
    if (editing) {
      return assigneeSearchFor(r);
    }

    return (
      <button
        type="button"
        data-assignee-editor
        onClick={(e) => {
          e.stopPropagation();
          setEditingSubAssigneeKey(null);
          setEditingAssigneeId((current) => {
            if (current === r.id) return null;
            seedAssignScopeFromRecord(r);
            return r.id;
          });
        }}
        onPointerDown={(e) => e.stopPropagation()}
        className="group inline-flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-md px-1 py-0.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400/70 focus-visible:ring-offset-1 focus-visible:ring-offset-white dark:focus-visible:ring-offset-zinc-900"
        title="Click to change assignee"
        aria-label="Change assignee"
      >
        {avatar}
        <span
          className="min-w-0 font-semibold text-zinc-700 underline-offset-4 transition group-hover:underline group-hover:decoration-zinc-400 group-hover:decoration-dotted dark:text-zinc-300 dark:group-hover:decoration-zinc-500"
          title={name}
        >
          {name}
        </span>
        <Pencil
          className="size-3 shrink-0 text-zinc-400 opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100 pointer-coarse:opacity-60 dark:text-zinc-500"
          aria-hidden
        />
      </button>
    );
  }

  const activeTaskFromRows = activeTaskId
    ? rows.find((row) => row.id === activeTaskId) ?? null
    : null;
  if (activeTaskFromRows) {
    activeTaskSnapshotRef.current = activeTaskFromRows;
  } else if (!activeTaskId) {
    activeTaskSnapshotRef.current = null;
  }
  // Keep the modal mounted across row refreshes (e.g. screenshot upload) so the
  // dimmed backdrop never shows alone without the panel.
  const activeTask =
    activeTaskFromRows ??
    (activeTaskId && activeTaskSnapshotRef.current?.id === activeTaskId
      ? activeTaskSnapshotRef.current
      : null);

  function renderTaskScheduleEditor(r: KpiRecord) {
    if (!showAdminTaskManagement || isItProjectImplementationPillar(r.title) || !scheduleDraft) return null;
    if (isFieldAssignmentRecord(r)) return null;
    const draft = scheduleDraft;
    return (
      <div className="space-y-2 rounded-lg border border-orange-400/35 bg-orange-500/[0.07] p-3 dark:border-orange-500/30 dark:bg-orange-500/10">
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-orange-800 dark:text-orange-200">
          Task schedule type
        </p>
        <label className="flex items-center gap-2 text-xs font-semibold normal-case tracking-normal text-zinc-800 dark:text-zinc-200">
          <input
            type="checkbox"
            checked={draft.isRecurring}
            disabled={busyId === r.id}
            onChange={(e) => {
              const nextRecurring = e.target.checked;
              setScheduleDraft((prev) => (prev ? { ...prev, isRecurring: nextRecurring } : prev));
            }}
          />
          Recurring task
        </label>
        {draft.isRecurring ? (
          <label className="flex flex-col text-[10px] font-bold uppercase tracking-wide text-zinc-600 dark:text-zinc-500">
            Frequency
            <select
              value={draft.frequency}
              disabled={busyId === r.id}
              onChange={(e) =>
                setScheduleDraft((prev) =>
                  prev ? { ...prev, frequency: e.target.value as KpiFrequencyCode } : prev,
                )
              }
              className="mt-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-zinc-900 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
            >
              <option value="DAILY">Daily</option>
              <option value="WEEKLY">Weekly</option>
              <option value="MONTHLY">Monthly</option>
              <option value="QUARTERLY">Quarterly</option>
              <option value="SEMI_ANNUAL">Semi Annual</option>
              <option value="YEARLY">Annualy</option>
            </select>
          </label>
        ) : (
          <p className="text-xs font-normal normal-case tracking-normal text-zinc-600 dark:text-zinc-400">
            Task — delay is based on each sub-task target and actual dates.
          </p>
        )}
        {draft.isRecurring && draft.frequency === "WEEKLY" ? (
          <label className="flex flex-col text-[10px] font-bold uppercase tracking-wide text-zinc-600 dark:text-zinc-500">
            Week starts on ({tz})
            <select
              value={draft.recurrenceWeekday}
              disabled={busyId === r.id}
              onChange={(e) =>
                setScheduleDraft((prev) =>
                  prev ? { ...prev, recurrenceWeekday: Number(e.target.value) } : prev,
                )
              }
              className="mt-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-zinc-900 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
            >
              <option value={0}>Sunday</option>
              <option value={1}>Monday</option>
              <option value={2}>Tuesday</option>
              <option value={3}>Wednesday</option>
              <option value={4}>Thursday</option>
              <option value={5}>Friday</option>
              <option value={6}>Saturday</option>
            </select>
          </label>
        ) : null}
        {draft.isRecurring &&
        (draft.frequency === "MONTHLY" ||
          draft.frequency === "QUARTERLY" ||
          draft.frequency === "SEMI_ANNUAL" ||
          draft.frequency === "YEARLY") ? (
          <label className="flex flex-col text-[10px] font-bold uppercase tracking-wide text-zinc-600 dark:text-zinc-500">
            {draft.frequency === "QUARTERLY"
              ? "4-month cycle"
              : draft.frequency === "SEMI_ANNUAL"
                ? "6-month cycle"
                : draft.frequency === "YEARLY"
                  ? "Annualy cycle"
                  : "Month cycle"}{" "}
            starts on day (1–31, {tz})
            <select
              value={draft.recurrenceMonthDay}
              disabled={busyId === r.id}
              onChange={(e) =>
                setScheduleDraft((prev) =>
                  prev ? { ...prev, recurrenceMonthDay: Number(e.target.value) } : prev,
                )
              }
              className="mt-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-zinc-900 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
            >
              {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <button
          type="button"
          disabled={busyId === r.id}
          onClick={() => void patchTaskSchedule(r, draft)}
          className="rounded-lg bg-orange-600 px-4 py-2 text-xs font-semibold text-white hover:bg-orange-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Save schedule
        </button>
      </div>
    );
  }


  function renderActiveTaskModal() {
    if (!activeTask) return null;
    const editable = canEditChecklist(activeTask);
    const p = progress(activeTask);
    const end = periodEnd(activeTask);
    const itProject = isTimelineProjectRecord(activeTask);
    const normalized = normalizeSubKpis(activeTask.subKpis);
    const mainTaskOnly = !itProject && isMainTaskOnlyRecord(activeTask.subKpis, { title: activeTask.title, mainTask: activeTask.mainTask });
    const fieldAssignment = isFieldAssignmentRecord(activeTask);
    const checklistItems = mainTaskOnly
      ? collectChecklistProgressItems(activeTask.subKpis, taskLabel(activeTask))
      : collectAllSubKpiItems(normalized);
    const auditLookupItems = itProject
      ? itProjectChecklistItems(activeTask.subKpis)
      : collectChecklistProgressItems(activeTask.subKpis, taskLabel(activeTask));
    const auditDetailLabel = (detail: string) => {
      const hit = auditLookupItems.find((it) => it.id === detail.trim());
      return hit?.title?.trim() || detail;
    };
    const usesTaskPriority = !itProject && checklistItems.length > 1;
    const itProjectProgress = itProject
      ? itProjectAggregatedProgressFromRaw(activeTask.subKpis, activeTask.itProjectPhase)
      : null;
    const mainBarPct = itProjectProgress ? itProjectProgress.averagePercent : p.pct;
    const activeLane = statusOf(activeTask);
    const mainRingStroke = laneProgressStrokeClass(activeLane, itProject);
    const incLate = incompleteOverdueMs(activeTask);
    const showPendingBadge = shouldShowTasksPendingBadge(activeTask, p, itProject, incLate);
    const mainTaskItem = mainTaskOnly
      ? mainTaskCheckboxItem(activeTask.subKpis, taskLabel(activeTask))
      : null;

    return createPortal(
      <div
        className="fixed inset-0 z-[300] flex items-center justify-center bg-black/50 px-3 py-6 backdrop-blur-sm"
        onClick={(e) => {
          // Only the dimmed backdrop closes the modal — not bubbled clicks from the panel.
          if (e.target !== e.currentTarget) return;
          // OS file pickers often synthesize a click on whatever is behind them when they
          // close; ignore that so screenshot upload doesn't leave a blank black overlay.
          if (Date.now() < filePickerGuardUntilRef.current) return;
          closeActiveTask();
        }}
        role="dialog"
        aria-modal="true"
        aria-label={`${taskLabel(activeTask)} full task details`}
      >
        <div
          className="max-h-[calc(100dvh-3rem)] w-full max-w-4xl overflow-y-auto rounded-2xl border border-zinc-200 bg-white p-4 shadow-2xl dark:border-zinc-800 dark:bg-zinc-950 sm:p-5"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="flex flex-col gap-3 border-b border-zinc-200 pb-4 dark:border-zinc-800 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-orange-700 dark:text-orange-400">
                Full Task Details
              </p>
              <h3 className="mt-1 flex min-w-0 items-center gap-x-2 text-xl font-bold text-zinc-950 dark:text-zinc-50">
                {fieldAssignment ? (
                  <span className="inline-flex max-w-full items-center rounded-md border border-orange-400/50 bg-orange-500/10 px-2.5 py-1 text-sm font-semibold text-orange-900 dark:border-orange-500/35 dark:bg-orange-500/15 dark:text-orange-100">
                    <span className="truncate">
                      {activeTask.travelOrderSummary?.orderRequest?.trim() ||
                        taskLabel(activeTask)}
                    </span>
                  </span>
                ) : (
                  <span className="min-w-0 truncate">{taskLabel(activeTask)}</span>
                )}
                {showPendingBadge ? (
                  <span className="shrink-0 rounded-full border border-amber-400/60 bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-800 dark:border-amber-500/40 dark:text-amber-200">
                    {tasksPendingBadgeLabel(p)}
                  </span>
                ) : null}
              </h3>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                {fieldAssignment ? (
                  <>
                    {activeTask.travelOrderSummary?.isWorkPlan
                      ? "Person-in-Charge: "
                      : "Travelers: "}
                    {activeTask.travelOrderSummary?.isWorkPlan
                      ? activeTask.travelOrderSummary.personInCharge?.trim() ||
                        activeTask.assignedAgent?.name ||
                        "—"
                      : activeTask.travelOrderSummary?.travelers?.length
                        ? activeTask.travelOrderSummary.travelers.join(", ")
                        : activeTask.assignedAgent?.name ?? "—"}
                  </>
                ) : (
                  <span className="inline-flex items-center gap-1.5">
                    {assigneeAvatarFor(activeTask)}
                    <span>Assigned to {activeTask.assignedAgent?.name ?? "Unassigned"}</span>
                  </span>
                )}{" "}
                · {taskTypeBadgeLabel(activeTask, itProject)}
              </p>
              {(activeTask.linkedJobOrders?.length ?? 0) > 0 ? (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">
                    Linked J.O.
                  </span>
                  {activeTask.linkedJobOrders!.map((jo) => (
                    <a
                      key={jo.id}
                      href={`/agent/tickets/${jo.id}`}
                      className="inline-flex rounded-md border border-orange-400/45 bg-orange-500/10 px-2 py-0.5 text-xs font-semibold text-orange-900 hover:underline dark:border-orange-500/35 dark:bg-orange-500/15 dark:text-orange-100"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {jo.ticketNumber}
                    </a>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="flex shrink-0 items-start gap-2">
              {canDeleteTask ? (
                <button
                  type="button"
                  disabled={busyId === activeTask.id}
                  onClick={() => void removeTask(activeTask)}
                  className="inline-flex items-center justify-center rounded-full border border-rose-400/60 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-800 hover:bg-rose-500/15 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-500/40 dark:text-rose-200 dark:hover:bg-rose-950/40"
                >
                  Remove task
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => closeActiveTask()}
                className="inline-flex items-center justify-center rounded-full border border-zinc-300 bg-white p-2 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                aria-label="Close task details"
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-[0.9fr_1.6fr]">
            <aside className="space-y-3 rounded-xl border border-zinc-200 bg-zinc-50/80 p-3 dark:border-zinc-800 dark:bg-zinc-950/40">
              {!fieldAssignment ? (
              <div className="flex items-center gap-3">
                <ChecklistProgressRing percent={mainBarPct} strokeClassName={mainRingStroke} size={56} />
                {mainTaskItem ? (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    {renderPillarMainTaskCheckboxInline(activeTask, mainTaskItem, showPendingBadge)}
                  </div>
                ) : null}
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">
                    {itProjectProgress ? "Project progress" : "Progress"}
                  </p>
                  <p className="mt-0.5 text-xs font-bold text-zinc-950 dark:text-zinc-50">
                    {itProjectProgress
                      ? `${itProjectProgress.averagePercent}% avg Â· ${itProjectProgress.totalDone}/${itProjectProgress.totalItems}`
                      : p.inverted
                        ? `${p.positive}/${p.total} clear Â· ${p.negative} flagged`
                        : `${p.done}/${p.total} finished`}
                  </p>
                </div>
              </div>
              ) : null}
              <dl className="space-y-2 text-xs">
                <div>
                  <dt className="font-bold uppercase tracking-wide text-zinc-500 dark:text-zinc-500">Status</dt>
                  <dd className="mt-0.5 text-zinc-800 dark:text-zinc-200">
                    {laneStatusLabel(statusOf(activeTask))}
                    {activeTask.completionVerificationStatus === COMPLETION_VERIFICATION.PENDING ? (
                      <span className="ml-2 inline-flex rounded-full border border-violet-400/60 bg-violet-500/15 px-2 py-0.5 text-[10px] font-semibold text-violet-800 dark:border-violet-500/40 dark:text-violet-200">
                        Pending verification
                      </span>
                    ) : null}
                    {activeTask.completionVerificationStatus === COMPLETION_VERIFICATION.REJECTED ? (
                      <span className="ml-2 inline-flex rounded-full border border-amber-400/60 bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-800 dark:border-amber-500/40 dark:text-amber-200">
                        Returned
                      </span>
                    ) : null}
                  </dd>
                </div>
                {activeTask.completionVerificationStatus === COMPLETION_VERIFICATION.REJECTED &&
                activeTask.verificationRejectionComment ? (
                  <div>
                    <dt className="font-bold uppercase tracking-wide text-zinc-500 dark:text-zinc-500">
                      Rejection reason
                    </dt>
                    <dd className="mt-0.5 text-zinc-800 dark:text-zinc-200">
                      {activeTask.verificationRejectionComment}
                    </dd>
                  </div>
                ) : null}
                <div>
                  <dt className="font-bold uppercase tracking-wide text-zinc-500 dark:text-zinc-500">Cycle</dt>
                  <dd className="mt-0.5 text-zinc-800 dark:text-zinc-200">
                    {fieldAssignment
                      ? "Field Assignment — tracked via Travel Order"
                      : mainTaskOnly
                      ? activeTask.isRecurring !== false
                        ? end
                          ? `Complete the main task this cycle. Next period starts ${end.toLocaleString(undefined, { timeZone: tz })}.`
                          : "Complete the main task for this recurring cycle."
                        : end
                          ? `Delayed after ${end.toLocaleString(undefined, { timeZone: tz })} if incomplete (day after target date).`
                          : nonRecurringCycleHint(activeTask)
                      : activeTask.isRecurring === false
                        ? end
                          ? `Delayed after ${end.toLocaleString(undefined, { timeZone: tz })} if incomplete (day after target date).`
                          : nonRecurringCycleHint(activeTask)
                        : end
                          ? (() => {
                              const progressNow = progress(activeTask);
                              const incomplete = progressNow.done < progressNow.total;
                              const pastDeadline = Date.now() >= end.getTime();
                              if (incomplete && pastDeadline) {
                                const holdDays = recurringIncompleteRolloverHoldDays(activeTask.frequency);
                                const holdUntil = recurringIncompleteRolloverEligibleAt(end, tz, holdDays);
                                return holdDays > 0
                                  ? `Delayed — next cycle can start after ${holdUntil.toLocaleString(undefined, { timeZone: tz })} (${holdDays}-day hold).`
                                  : `Delayed — next cycle can start after ${end.toLocaleString(undefined, { timeZone: tz })}.`;
                              }
                              return `Next period starts ${end.toLocaleString(undefined, { timeZone: tz })}`;
                            })()
                          : ""}
                  </dd>
                </div>
                {!itProject && normalized.segmented ? (
                  <div>
                    <dt className="font-bold uppercase tracking-wide text-zinc-500 dark:text-zinc-500">Format</dt>
                    <dd className="mt-0.5 text-zinc-800 dark:text-zinc-200">Segmented checklist</dd>
                  </div>
                ) : null}
              </dl>
              {renderTaskScheduleEditor(activeTask)}
              {canVerifyCompletion(activeTask) ? (
                <div className="space-y-2 rounded-lg border border-violet-400/45 bg-violet-500/10 p-3 dark:border-violet-500/35 dark:bg-violet-500/10">
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-violet-900 dark:text-violet-200">
                    Completion verification
                  </p>
                  <p className="text-xs text-zinc-700 dark:text-zinc-300">
                    Checklist is complete. As the department head, verify to mark Done, or reject with a comment to return the task to Current.
                  </p>
                  {!verificationRejectOpen ? (
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={busyId === activeTask.id}
                        onClick={() => void submitCompletionVerification(activeTask.id, "approve")}
                        className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                      >
                        Verify
                      </button>
                      <button
                        type="button"
                        disabled={busyId === activeTask.id}
                        onClick={() => setVerificationRejectOpen(true)}
                        className="rounded-lg border border-rose-400/60 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-800 hover:bg-rose-500/15 dark:text-rose-200"
                      >
                        Reject
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <textarea
                        value={verificationRejectComment}
                        onChange={(e) => setVerificationRejectComment(e.target.value)}
                        rows={3}
                        placeholder="Required: explain why this was returned…"
                        className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs text-zinc-900 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
                      />
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={busyId === activeTask.id || !verificationRejectComment.trim()}
                          onClick={() =>
                            void submitCompletionVerification(
                              activeTask.id,
                              "reject",
                              verificationRejectComment,
                            )
                          }
                          className="rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white hover:bg-rose-500 disabled:opacity-50"
                        >
                          Confirm reject
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setVerificationRejectOpen(false);
                            setVerificationRejectComment("");
                          }}
                          className="rounded-lg border border-zinc-300 px-3 py-2 text-xs font-semibold text-zinc-700 dark:border-zinc-600 dark:text-zinc-200"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : null}
              {canResubmitCompletion(activeTask) ? (
                <div className="space-y-2 rounded-lg border border-amber-400/45 bg-amber-500/10 p-3 dark:border-amber-500/35">
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-amber-900 dark:text-amber-200">
                    Returned for rework
                  </p>
                  <p className="text-xs text-zinc-700 dark:text-zinc-300">
                    Address the rejection feedback, then re-submit for verification.
                  </p>
                  <button
                    type="button"
                    disabled={busyId === activeTask.id}
                    onClick={() => void submitCompletionVerification(activeTask.id, "resubmit")}
                    className="rounded-lg bg-violet-600 px-3 py-2 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
                  >
                    Re-submit for verification
                  </button>
                </div>
              ) : null}
              {usesTaskPriority ? (
                <label className="block rounded-lg border border-zinc-200 bg-white p-3 text-[10px] font-bold uppercase tracking-wide text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950/70 dark:text-zinc-500">
                  Task priority
                  <select
                    value={getTaskPriority(activeTask.subKpis) ?? "Medium"}
                    disabled={(!editable && !canAssignWork) || busyId === activeTask.id}
                    onChange={(e) => void patchTaskPriority(activeTask.id, e.target.value)}
                    className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-2 py-2 text-xs font-semibold normal-case tracking-normal text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                  >
                    {IT_PROJECT_PRIORITY_OPTIONS.map((priority) => (
                      <option key={priority} value={priority}>
                        {priority}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950/70">
                <h4 className="text-[10px] font-bold uppercase tracking-wide text-zinc-600 dark:text-zinc-500">
                  Audit log
                </h4>
                {taskAuditLoading ? (
                  <p className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">Loading history…</p>
                ) : taskAuditLog.length === 0 ? (
                  <p className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                    No history yet. Changes to this task will appear here.
                  </p>
                ) : (
                  <ul className="mt-2 max-h-48 space-y-2 overflow-y-auto pr-0.5">
                    {taskAuditLog.map((entry) => (
                      <li
                        key={entry.id}
                        className="rounded-md border border-zinc-100 bg-zinc-50/80 px-2 py-1.5 dark:border-zinc-800 dark:bg-zinc-900/50"
                      >
                        <p className="text-[11px] font-semibold text-zinc-900 dark:text-zinc-100">
                          {entry.summary}
                        </p>
                        {entry.detail ? (
                          <p className="mt-0.5 break-words text-[10px] text-zinc-600 dark:text-zinc-400">
                            {auditDetailLabel(entry.detail)}
                          </p>
                        ) : null}
                        <p className="mt-0.5 text-[10px] text-zinc-500 dark:text-zinc-500">
                          {entry.author} Â· {new Date(entry.createdAt).toLocaleString()}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {showAdminTaskManagement && !fieldAssignment ? (
                <div className="block space-y-2 rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950/70">
                  <div className="grid items-end gap-2 sm:grid-cols-2">
                    <label className="flex min-w-0 flex-col text-[10px] font-bold uppercase tracking-wide text-zinc-600 dark:text-zinc-500">
                      <span className="leading-tight">Penalty frequency</span>
                      <select
                        value={taskDelayPenaltyFrequencyFromSubKpis(activeTask.subKpis)}
                        disabled={busyId === activeTask.id}
                        onChange={(e) =>
                          void patchTaskDelayPenaltyFrequency(
                            activeTask.id,
                            e.target.value as DelayPenaltyFrequency,
                          )
                        }
                        className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-2 py-2 text-xs font-semibold normal-case tracking-normal text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                      >
                        {DELAY_PENALTY_FREQUENCIES.map((option) => (
                          <option key={option} value={option}>
                            {option.charAt(0) + option.slice(1).toLowerCase()}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex min-w-0 flex-col text-[10px] font-bold uppercase tracking-wide text-zinc-600 dark:text-zinc-500">
                      <span className="leading-tight">
                        Penalty per{" "}
                        {delayPenaltyFrequencyLabel(
                          taskDelayPenaltyFrequencyFromSubKpis(activeTask.subKpis),
                        )}
                      </span>
                      <input
                        type="number"
                        min={0}
                        step="any"
                        value={taskDailyPenaltyAmountFromSubKpis(activeTask.subKpis) ?? ""}
                        disabled={busyId === activeTask.id}
                        placeholder="Task default amount"
                        onChange={(e) => {
                          const raw = e.target.value.trim();
                          void patchTaskDailyPenalty(
                            activeTask.id,
                            raw === "" ? null : Math.max(0, Number(raw)),
                          );
                        }}
                        className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-2 py-2 text-xs font-semibold normal-case tracking-normal text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                      />
                    </label>
                  </div>
                  {accruedPenaltyForRecord(activeTask) > 0 ? (
                    <span className="block text-[11px] font-semibold normal-case tracking-normal text-rose-700 dark:text-rose-300">
                      Total accrued on this task: {accruedPenaltyForRecord(activeTask)}
                    </span>
                  ) : null}
                </div>
              ) : null}
              {itProject ? (
                <div className="space-y-2 rounded-lg border border-orange-400/35 bg-orange-500/[0.07] p-3 dark:border-orange-500/30 dark:bg-orange-500/10">
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-orange-800 dark:text-orange-200">
                    Project details
                  </p>
                  <label className="block text-[10px] font-bold uppercase tracking-wide text-zinc-600 dark:text-zinc-500">
                    Project name
                    <input
                      key={`modal-ipn-${activeTask.id}-${activeTask.updatedAt}`}
                      type="text"
                      defaultValue={activeTask.itProjectName ?? ""}
                      disabled={!editable || busyId === activeTask.id}
                      placeholder="e.g. Intranet refresh"
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        const prev = (activeTask.itProjectName ?? "").trim();
                        if (v !== prev) void patchItProjectMeta(activeTask.id, { itProjectName: v || null });
                      }}
                      className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
                    />
                  </label>
                </div>
              ) : mainTaskOnly ? null : (
                renderPillarScreenshotFields(activeTask, editable)
              )}
            </aside>

            <section className="min-w-0 space-y-3">
              {fieldAssignment ? (
                <TravelOrderSummaryPanel
                  taskId={activeTask.id}
                  operatorAgentId={operatorAgentId}
                  canAssignWork={canAssignWork}
                  canCheckIn={editable || canAssignWork}
                  onKpiSubmitted={() => void load()}
                />
              ) : null}
              {!fieldAssignment ? (
                <>
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                    <h4 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                      {mainTaskOnly ? "Main task completion" : "Sub Tasks"}
                    </h4>
                    <div className="flex flex-wrap items-center gap-2">
                      {!itProject && normalized.segmented ? (
                        <label className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-600 dark:text-zinc-500">
                          <span className="shrink-0">Segment</span>
                          <select
                            value={
                              detailSegmentFilter !== "ALL" &&
                              normalized.segments.some(
                                (seg) =>
                                  seg.id === detailSegmentFilter && !isUnsegmentedSegmentId(seg.id),
                              )
                                ? detailSegmentFilter
                                : "ALL"
                            }
                            onChange={(e) => setDetailSegmentFilter(e.target.value)}
                            className="min-w-[9rem] rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-xs font-semibold normal-case tracking-normal text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                            aria-label="Filter sub-tasks by segment"
                          >
                            <option value="ALL">
                              All segments ({collectAllSubKpiItems(normalized).length})
                            </option>
                            {normalized.segments
                              .filter((seg) => !isUnsegmentedSegmentId(seg.id))
                              .map((seg) => (
                                <option key={seg.id} value={seg.id}>
                                  {seg.label} ({seg.items.length})
                                </option>
                              ))}
                          </select>
                        </label>
                      ) : null}
                      <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-semibold text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                        {(() => {
                          if (!itProject && normalized.segmented && detailSegmentFilter !== "ALL") {
                            const seg = normalized.segments.find((s) => s.id === detailSegmentFilter);
                            const count = seg?.items.length ?? 0;
                            return `${count} item${count === 1 ? "" : "s"}`;
                          }
                          const total = itProjectProgress?.totalItems ?? p.total;
                          return `${total} item${total === 1 ? "" : "s"}`;
                        })()}
                      </span>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {renderTaskSubtaskContent(activeTask, {
                      segmentFilter: detailSegmentFilter,
                      hideSubtaskPendingBadge: showPendingBadge,
                      hidePillarMainCheckbox: Boolean(mainTaskItem),
                    })}
                  </div>
                  {renderAddSubTaskPanel(activeTask)}
                </>
              ) : null}
            </section>
          </div>
        </div>
      </div>,
      document.body,
    );
  }



  return (
    <section className="mt-3 min-w-0 space-y-3 md:space-y-4">
      <PointerDragGhostLayer ghost={kpiStatusDrag.ghost} />
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-wrap gap-2">
          {showAdminTaskManagement ? (
            <button
              type="button"
              onClick={() => setTaskManagementOpen(true)}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs font-semibold text-zinc-800 transition hover:border-orange-500/40 hover:bg-orange-500/10 hover:text-orange-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:border-orange-500/40 dark:hover:bg-orange-500/10 dark:hover:text-orange-100 sm:px-4"
            >
              Add Task
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => openForMyApproval()}
            className="relative inline-flex items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs font-semibold text-zinc-800 transition hover:border-orange-500/40 hover:bg-orange-500/10 hover:text-orange-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:border-orange-500/40 dark:hover:bg-orange-500/10 dark:hover:text-orange-100 sm:px-4"
            aria-label={
              forMyApprovalUnreadCount > 0
                ? `For My Approval, ${forMyApprovalUnreadCount} new`
                : "For My Approval"
            }
          >
            For My Approval
            {forMyApprovalUnreadCount > 0 ? (
              <span className="absolute -right-1.5 -top-1.5 inline-flex min-w-[18px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold leading-[18px] text-white shadow-sm">
                {forMyApprovalUnreadCount > 9 ? "9+" : forMyApprovalUnreadCount}
              </span>
            ) : forMyApprovalTasks.length > 0 ? (
              <span className="rounded-full bg-orange-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                {forMyApprovalTasks.length}
              </span>
            ) : null}
          </button>
          <button
            type="button"
            onClick={() => setTravelOrdersOpen(true)}
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs font-semibold text-zinc-800 transition hover:border-orange-500/40 hover:bg-orange-500/10 hover:text-orange-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:border-orange-500/40 dark:hover:bg-orange-500/10 dark:hover:text-orange-100 sm:px-4"
          >
            <TravelOrdersIcon className="size-4 shrink-0" />
            Travel Orders
          </button>
        </div>
      </div>
      <div className="hidden md:block">
        <h3 className="text-[11px] font-bold uppercase tracking-[0.22em] text-zinc-600 dark:text-zinc-500">
          Task Kanban (drag to update)
        </h3>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Cards are grouped by schedule type (One-off / Daily / Weekly / Monthly / Quarterly), then
          Projects and Field Assignment — same layout as Task Metrics. Hold and slide a task to{" "}
          <strong>Done</strong> or <strong>Current</strong> (touch or mouse).{" "}
          <span className="text-zinc-500 dark:text-zinc-500">
            The <strong>Delayed</strong> column applies to <strong>IT Project Implementation</strong> tasks
            (sub-task past due or actual after due), and to <strong>one-off</strong> tasks the day after each
            sub-task target date if still incomplete (or when the actual date is on or after that boundary).
            Fully complete but late tasks stay in <strong>Delayed</strong>, not Done.
          </span>
        </p>
      </div>
      {hasBoardRows ? (
        <div
          role="tablist"
          aria-label="Task lane"
          className="grid grid-cols-3 gap-1 rounded-xl border border-zinc-200 bg-zinc-100/80 p-1 dark:border-zinc-800 dark:bg-zinc-900/70 md:hidden"
        >
          {(["CURRENT", "DONE", "DELAYED"] as const).map((col) => {
            const label = laneStatusLabel(col);
            const active = mobileLane === col;
            return (
              <button
                key={`lane-tab-${col}`}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setMobileLane(col)}
                className={cn(
                  "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-semibold transition",
                  active
                    ? col === "CURRENT"
                      ? "bg-white text-blue-800 shadow-sm dark:bg-zinc-800 dark:text-blue-200"
                      : col === "DONE"
                        ? "bg-white text-emerald-800 shadow-sm dark:bg-zinc-800 dark:text-emerald-200"
                        : "bg-white text-rose-800 shadow-sm dark:bg-zinc-800 dark:text-rose-200"
                    : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200",
                )}
              >
                <span>{label}</span>
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0.5 text-[10px] font-bold",
                    active
                      ? "bg-zinc-100 text-zinc-800 dark:bg-zinc-950 dark:text-zinc-100"
                      : "bg-zinc-200/80 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
                  )}
                >
                  {laneCounts[col]}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
      {kpiStatusDrag.draggingItemId ? (
        <div className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom,0px))] z-[70] grid grid-cols-3 gap-2 md:hidden">
          {(["CURRENT", "DONE", "DELAYED"] as const).map((col) => {
            const label = laneStatusLabel(col);
            const dropClass =
              col === "CURRENT"
                ? "border-blue-400/50 bg-blue-950/90 text-blue-100"
                : col === "DONE"
                  ? "border-emerald-400/50 bg-emerald-950/90 text-emerald-100"
                  : "border-rose-400/50 bg-rose-950/90 text-rose-100";
            return (
              <div
                key={`lane-drop-${col}`}
                ref={kpiStatusDrag.registerColumn(col)}
                className={cn(
                  "rounded-xl border px-2 py-3 text-center text-[11px] font-bold shadow-lg backdrop-blur-sm",
                  dropClass,
                  kpiStatusDrag.hoverColumn === col && "ring-2 ring-orange-400 ring-offset-2 ring-offset-zinc-950",
                )}
              >
                Drop â†’ {label}
              </div>
            );
          })}
        </div>
      ) : null}
      {error ? (
        <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-200">
          {error}
        </p>
      ) : null}
      {!hasBoardRows ? (
        <div className="rounded-xl border border-dashed border-zinc-300 px-4 py-10 text-center text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-500">
          {categoryFilter !== "all"
            ? `No ${
                categoryFilter === "field"
                  ? "Field Assignment"
                  : categoryFilter === "project"
                    ? "Project"
                    : "Task"
              } cards match this filter.`
            : companyFilterTeamId
              ? assignedAgentFilterId
                ? "No running tasks assigned to this person."
                : "No running tasks assigned to personnel in this company."
              : "No task cards available."}
        </div>
      ) : (
        <div className="grid min-w-0 gap-3 md:grid-cols-3">
          {(["CURRENT", "DONE", "DELAYED"] as const).map((col) => {
            const list = boardRows
              .filter((r) => statusOf(r) === col)
              .sort((a, b) => {
                if (col === "DONE") {
                  const aTime = a.lastFullCompletionAt ? new Date(a.lastFullCompletionAt).getTime() : 0;
                  const bTime = b.lastFullCompletionAt ? new Date(b.lastFullCompletionAt).getTime() : 0;
                  return bTime - aTime;
                }
                if (col !== "DELAYED") return 0;
                return incompleteOverdueMs(b) - incompleteOverdueMs(a);
              });
            const label = laneStatusLabel(col);
            const colClass =
              col === "CURRENT"
                ? "border-blue-300/80 bg-blue-50/40 dark:border-blue-500/35 dark:bg-[#0c1220]"
                : col === "DONE"
                  ? "border-emerald-300/80 bg-emerald-50/40 dark:border-emerald-500/35 dark:bg-[#0c1612]"
                  : "border-rose-300/80 bg-rose-50/40 dark:border-rose-500/35 dark:bg-[#160c10]";
            const headerClass =
              col === "CURRENT"
                ? "bg-blue-600 text-white shadow-[0_0_24px_-8px_rgba(37,99,235,0.85)]"
                : col === "DONE"
                  ? "bg-emerald-600 text-white shadow-[0_0_24px_-8px_rgba(5,150,105,0.85)]"
                  : "bg-rose-600 text-white shadow-[0_0_24px_-8px_rgba(225,29,72,0.85)]";
            const countBadgeClass =
              col === "CURRENT"
                ? "bg-blue-950/35 text-white"
                : col === "DONE"
                  ? "bg-emerald-950/35 text-white"
                  : "bg-rose-950/35 text-white";

            return (
              <article
                key={`${col}-${laneRegisterKey}`}
                ref={kpiStatusDrag.registerColumn(col)}
                className={cn(
                  "min-w-0 overflow-hidden rounded-xl border transition md:min-h-[300px]",
                  col !== mobileLane && "hidden md:block",
                  colClass,
                  kpiStatusDrag.hoverColumn === col && "ring-2 ring-inset ring-orange-500/60",
                )}
              >
                <div
                  className={cn(
                    "mb-3 hidden items-center justify-between gap-3 px-3 py-2.5 md:flex",
                    headerClass,
                  )}
                >
                  <h4 className="text-sm font-bold tracking-wide">{label}</h4>
                  <span className={cn("rounded-full px-2 py-0.5 text-xs font-bold tabular-nums", countBadgeClass)}>
                    {list.length}
                  </span>
                </div>
                <div className="space-y-3 px-3 pb-3 pt-3 md:pt-0">
                  {list.length === 0 ? (
                    <p className="px-2 py-8 text-center text-sm text-zinc-600 dark:text-zinc-400">No tasks here.</p>
                  ) : (
                    groupRowsByBoardLayoutSection(list).map((section) => (
                      <div key={`${col}-sec-${section.key}`} className="space-y-2.5">
                        <div className="flex items-center justify-between gap-2 border-b border-zinc-300/70 px-1 pb-1.5 dark:border-zinc-700/70">
                          <h5 className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-600 dark:text-zinc-400">
                            {section.label}
                          </h5>
                          <span className="rounded-full bg-white/70 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-600 dark:bg-zinc-900/50 dark:text-zinc-300">
                            {section.rows.length}
                          </span>
                        </div>
                        {section.rows.map((r) => {
                      const editable = canEditChecklist(r);
                      const p = progress(r);
                      const incLate = incompleteOverdueMs(r);
                      const end = periodEnd(r);
                      const itProject = isTimelineProjectRecord(r);
                      const normalized = normalizeSubKpis(r.subKpis);
                      const itProjectData = itProject
                        ? parseItProjectSubKpis(r.subKpis, r.itProjectPhase)
                        : null;
                      const itProjectProgress =
                        itProject && itProjectData
                          ? itProjectAggregatedProgressFromRaw(r.subKpis, r.itProjectPhase)
                          : null;
                      const checklistItems = isMainTaskOnlyRecord(r.subKpis, { title: r.title, mainTask: r.mainTask })
                        ? collectChecklistProgressItems(r.subKpis, taskLabel(r))
                        : collectAllSubKpiItems(normalized);
                      const mainTaskOnly =
                        !itProject &&
                        isMainTaskOnlyRecord(r.subKpis, { title: r.title, mainTask: r.mainTask });
                      const fieldAssignment = isFieldAssignmentRecord(r);
                      const mainTaskItem =
                        mainTaskOnly && !fieldAssignment
                          ? mainTaskCheckboxItem(r.subKpis, taskLabel(r))
                          : null;
                      // Pending indicator shown beside the task name (normal + inverted recording).
                      const showPendingBadge = shouldShowTasksPendingBadge(r, p, itProject, incLate);
                      const pendingBadgeLabel = tasksPendingBadgeLabel(p);
                      const pendingBadge = showPendingBadge ? (
                        <span className="shrink-0 rounded-full border border-amber-400/60 bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-800 dark:border-amber-500/40 dark:text-amber-200">
                          {pendingBadgeLabel}
                        </span>
                      ) : null;
                      const verificationBadge = isAwaitingVerification(r) ? (
                        <span className="shrink-0 rounded-full border border-violet-400/60 bg-violet-500/15 px-2 py-0.5 text-[10px] font-semibold text-violet-800 dark:border-violet-500/40 dark:text-violet-200">
                          For verification
                        </span>
                      ) : r.completionVerificationStatus === COMPLETION_VERIFICATION.REJECTED ? (
                        <span className="shrink-0 rounded-full border border-amber-400/60 bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-800 dark:border-amber-500/40 dark:text-amber-200">
                          Returned
                        </span>
                      ) : null;
                      const mainBarPct = itProjectProgress ? itProjectProgress.averagePercent : p.pct;
                      const mainRingStroke = laneProgressStrokeClass(col, itProject);
                      const drawerAllowed = canOpenSubtaskDrawer(r, checklistItems);
                      const showSubtaskDrawerToggle = drawerAllowed && !mainTaskOnly;
                      const drawerOpen = openSubtaskDrawers.has(r.id);
                      return (
                        <div
                          key={r.id}
                          {...(editable
                            ? kpiStatusDrag.getCardPointerProps(r.id, { getLabel: () => taskLabel(r) })
                            : {})}
                          className={cn(
                            "min-w-0 rounded-xl border border-zinc-200/90 bg-white p-2.5 shadow-sm transition hover:border-orange-300 hover:bg-white dark:border-zinc-700/90 dark:bg-[#1a1a1a] dark:hover:border-orange-700/70 dark:hover:bg-[#1f1f1f] md:p-3",
                            busyId === r.id && "opacity-50",
                            mediaBusyId === r.id && busyId !== r.id && "ring-1 ring-orange-300/50",
                            editable && kpiStatusDrag.draggingItemId === r.id && "ring-1 ring-orange-400/40",
                          )}
                          role="button"
                          tabIndex={0}
                          onClick={(e) => {
                            const target = e.target as HTMLElement;
                            if (target.closest("a,button,input,select,textarea,label")) return;
                            openActiveTask(r.id);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              openActiveTask(r.id);
                            }
                          }}
                        >
                          <div className="flex items-start gap-2">
                            {editable ? (
                              <GripVertical className="mt-0.5 hidden size-4 shrink-0 text-zinc-400 dark:text-zinc-500 md:block" aria-hidden />
                            ) : null}
                            <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              {fieldAssignment ? (
                                <>
                                  <p className="mt-0.5 inline-flex max-w-full items-center rounded-md border border-orange-400/45 bg-orange-500/10 px-2 py-0.5 text-xs font-semibold text-orange-900 dark:border-orange-500/35 dark:bg-orange-500/15 dark:text-orange-100">
                                    <span className="truncate">
                                      {r.travelOrderSummary?.orderRequest?.trim() ||
                                        taskLabel(r)}
                                    </span>
                                  </p>
                                  <p className="mt-1 line-clamp-2 text-xs text-zinc-600 dark:text-zinc-400">
                                    {r.travelOrderSummary?.isWorkPlan
                                      ? "Person-in-Charge: "
                                      : "Travelers: "}
                                    {r.travelOrderSummary?.isWorkPlan
                                      ? r.travelOrderSummary.personInCharge?.trim() ||
                                        r.assignedAgent?.name ||
                                        "—"
                                      : r.travelOrderSummary?.travelers?.length
                                        ? r.travelOrderSummary.travelers.join(", ")
                                        : r.assignedAgent?.name ?? "—"}
                                  </p>
                                  {canAssignWork ? (
                                    <div className="mt-1.5 inline-flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                                      {assigneeLine(r, { canEdit: canAssignWork, editing: editingAssigneeId === r.id })}
                                    </div>
                                  ) : null}
                                </>
                              ) : mainTaskOnly || kpiHasDistinctMainTask(r) ? (
                                <>
                                  <div className="flex min-w-0 items-center gap-x-1.5">
                                    <p className="min-w-0 truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                                      {taskLabel(r)}
                                    </p>
                                    {pendingBadge}
                                    {verificationBadge}
                                  </div>
                                  <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                                    {assigneeLine(r, { canEdit: canAssignWork, editing: editingAssigneeId === r.id })}
                                  </div>
                                </>
                              ) : (
                                <>
                                  <div className="flex min-w-0 items-center gap-x-1.5">
                                    <p className="min-w-0 truncate text-sm font-bold uppercase tracking-wide text-zinc-900 dark:text-zinc-50">
                                      {taskLabel(r)}
                                    </p>
                                    {pendingBadge}
                                    {verificationBadge}
                                  </div>
                                  <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                                    {assigneeLine(r, { canEdit: canAssignWork, editing: editingAssigneeId === r.id })}
                                  </div>
                                </>
                              )}
                              {(r.linkedJobOrders?.length ?? 0) > 0 ? (
                                <p className="mt-1 truncate text-[11px] font-medium text-orange-800 dark:text-orange-200">
                                  J.O.{" "}
                                  {r.linkedJobOrders!.map((jo) => jo.ticketNumber).join(", ")}
                                </p>
                              ) : null}
                            </div>
                            <span className="shrink-0 rounded-full border border-zinc-200 bg-zinc-100/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900/80 dark:text-zinc-300">
                              {taskTypeBadgeLabel(r, itProject)}
                            </span>
                          </div>
                          {!itProject && normalized.segmented ? (
                            <span className="mt-2 inline-flex rounded-full border border-orange-400/60 bg-orange-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-orange-900 dark:border-orange-500/35 dark:bg-orange-500/10 dark:text-orange-100">
                              Segmented
                            </span>
                          ) : null}
                          {canAssignWork && editingAssigneeId === r.id && !mainTaskOnly ? (
                            <p className="mt-2 hidden text-[11px] text-zinc-600 dark:text-zinc-400 md:block">
                              Pick the assignee above, or assign individual sub-tasks below.
                            </p>
                          ) : null}
                          {itProject && r.itProjectPhase?.trim() ? (
                            <p className="mt-2 truncate text-xs text-orange-800 dark:text-orange-200">
                              {r.itProjectPhase.trim()}
                            </p>
                          ) : null}
                          {fieldAssignment ? (
                            <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400 md:mt-3">
                              {(() => {
                                const items = collectChecklistProgressItems(r.subKpis, taskLabel(r));
                                const value = items[0]?.numericalValue;
                                const kpiSuffix =
                                  typeof value === "number" ? ` Â· KPI ${Math.round(value)}%` : "";
                                return (
                                  <>
                                    <span className="md:hidden">Via Travel Order{kpiSuffix}</span>
                                    <span className="hidden md:inline">
                                      Field Assignment — tracked via Travel Order{kpiSuffix}
                                    </span>
                                  </>
                                );
                              })()}
                            </p>
                          ) : (
                          <div className="mt-2 md:mt-3">
                            <div className="flex items-center gap-3">
                              <ChecklistProgressRing
                                percent={mainBarPct}
                                strokeClassName={mainRingStroke}
                              />
                              {mainTaskItem ? (
                                <div
                                  onClick={(e) => e.stopPropagation()}
                                  onPointerDown={(e) => e.stopPropagation()}
                                >
                                  {renderPillarMainTaskCheckboxInline(
                                    r,
                                    mainTaskItem,
                                    showPendingBadge,
                                  )}
                                </div>
                              ) : null}
                              <div className="min-w-0 flex-1">
                                <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">
                                  <span className="md:hidden">Progress</span>
                                  <span className="hidden md:inline">
                                    {itProjectProgress ? "Project progress (phase average)" : "Progress"}
                                  </span>
                                </p>
                                <p className="mt-0.5 text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                                  {itProjectProgress
                                    ? itProjectProgress.totalItems > 0
                                      ? (
                                          <>
                                            <span className="md:hidden">
                                              {itProjectProgress.totalDone}/{itProjectProgress.totalItems} sub-tasks
                                            </span>
                                            <span className="hidden md:inline">
                                              {itProjectProgress.totalDone}/{itProjectProgress.totalItems} sub-tasks
                                            </span>
                                          </>
                                        )
                                      : "0 sub-tasks"
                                    : p.total > 0
                                      ? p.inverted
                                        ? (
                                            <>
                                              <span className="md:hidden">
                                                {p.positive}/{p.total} clear Â· {p.negative} flagged
                                              </span>
                                              <span className="hidden md:inline">
                                                {p.positive}/{p.total} clear Â· {p.negative} flagged
                                              </span>
                                            </>
                                          )
                                        : (
                                            <>
                                              <span className="md:hidden">
                                                {p.done}/{p.total} finished
                                              </span>
                                              <span className="hidden md:inline">
                                                {p.done}/{p.total} finished
                                              </span>
                                            </>
                                          )
                                      : `${p.done}/${p.total}`}
                                </p>
                                {itProjectProgress && itProjectProgress.phases.filter((ph) => ph.total > 0).length > 1 ? (
                                  <p className="mt-1 hidden text-[10px] text-zinc-500 dark:text-zinc-400 md:block">
                                    Average of{" "}
                                    {itProjectProgress.phases
                                      .filter((ph) => ph.total > 0)
                                      .map((ph) => `${ph.phaseName} ${ph.percent}%`)
                                      .join(" Â· ")}
                                  </p>
                                ) : null}
                                <p className="mt-1 hidden text-[11px] leading-snug text-zinc-600 dark:text-zinc-400 md:block">
                                  {itProject
                                    ? "Choosing an actual date marks the sub-task complete and sets status to On time or Delayed based on the due date."
                                    : mainTaskOnly
                                      ? r.isRecurring !== false
                                        ? end
                                          ? `Complete the main task this cycle. Next period starts ${end.toLocaleString(undefined, { timeZone: tz })} (${tz}).`
                                          : "Complete the main task for this recurring cycle."
                                        : end
                                          ? `Delayed after ${end.toLocaleString(undefined, { timeZone: tz })} if incomplete (day after target date).`
                                          : nonRecurringCycleHint(r)
                                      : r.isRecurring === false
                                        ? end
                                          ? `Delayed after ${end.toLocaleString(undefined, { timeZone: tz })} if incomplete (day after target date).`
                                          : nonRecurringCycleHint(r)
                                        : end
                                          ? `Next period starts ${end.toLocaleString(undefined, { timeZone: tz })} (${tz})`
                                          : ""}
                                </p>
                              </div>
                            </div>
                            {itProject && incLate > 0 ? (
                              <p className="mt-2 text-xs font-semibold text-rose-700 dark:text-rose-300">
                                {p.done === p.total
                                  ? `All sub-tasks complete Â· delayed by ${fmtDelay(incLate)}`
                                  : `Delayed by ${fmtDelay(incLate)}`}
                              </p>
                            ) : statusOf(r) === "DELAYED" &&
                              r.isRecurring === false &&
                              accruedPenaltyForRecord(r) > 0 ? (
                              <p className="mt-2 text-xs font-semibold text-rose-700 dark:text-rose-300">
                                Delay penalty accrued: {accruedPenaltyForRecord(r)}
                              </p>
                            ) : p.inverted
                              ? !showPendingBadge && p.negative > 0 && p.positive < p.total ? (
                                  <p className="mt-2 text-xs font-semibold text-amber-700 dark:text-amber-300">
                                    {p.negative} flagged item{p.negative === 1 ? "" : "s"}
                                  </p>
                                ) : null
                              : null}
                          </div>
                          )}
                          {mainTaskOnly && !fieldAssignment ? (
                            <div
                              className="mt-2 space-y-2"
                              onClick={(e) => e.stopPropagation()}
                              onPointerDown={(e) => e.stopPropagation()}
                            >
                              {renderTaskSubtaskContent(r, {
                                hideSubtaskPendingBadge: showPendingBadge,
                                hidePillarMainCheckbox: Boolean(mainTaskItem),
                              })}
                            </div>
                          ) : null}
                          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                            <div className="flex flex-wrap items-center gap-2">
                            {showSubtaskDrawerToggle ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleSubtaskDrawer(r.id);
                                }}
                                className="inline-flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-[11px] font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800 sm:min-h-0 sm:flex-none sm:rounded-full"
                                aria-expanded={drawerOpen}
                              >
                                <ChevronDown
                                  className={cn("size-3.5 transition-transform", drawerOpen && "rotate-180")}
                                  aria-hidden
                                />
                                {drawerOpen ? "Close Sub Tasks" : "Open Sub Tasks"}
                              </button>
                            ) : null}
                            {!itProject && !mainTaskOnly && !drawerOpen
                              ? renderTaskSeekAssistanceButton(r, checklistItems, {
                                  stopPropagation: true,
                                })
                              : null}
                            {!itProject && !mainTaskOnly ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSubTasksManagerTaskId(r.id);
                                }}
                                onPointerDown={(e) => e.stopPropagation()}
                                className="inline-flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border border-orange-500/60 bg-orange-500/10 px-3 py-1.5 text-[11px] font-semibold text-orange-800 hover:bg-orange-500/20 dark:border-orange-500/40 dark:text-orange-200 dark:hover:bg-orange-950/40 sm:min-h-0 sm:flex-none sm:rounded-full"
                              >
                                <ListChecks className="size-3.5" aria-hidden />
                                Add Sub Tasks
                                <span className="rounded-full bg-orange-600 px-1.5 py-px text-[10px] font-bold text-white">
                                  {checklistItems.length}
                                </span>
                              </button>
                            ) : null}
                            {canDeleteTask ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void removeTask(r);
                                }}
                                disabled={busyId === r.id}
                                className="inline-flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border border-rose-400/60 bg-rose-500/10 px-3 py-1.5 text-[11px] font-semibold text-rose-800 hover:bg-rose-500/15 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-500/40 dark:text-rose-200 dark:hover:bg-rose-950/40 sm:min-h-0 sm:flex-none sm:rounded-full"
                              >
                                Remove task
                              </button>
                            ) : null}
                            </div>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                openActiveTask(r.id);
                              }}
                              className="inline-flex min-h-10 w-full items-center justify-center gap-1.5 rounded-lg bg-orange-600 px-3 py-2 text-[12px] font-semibold text-white hover:bg-orange-500 sm:min-h-0 sm:w-auto sm:rounded-full sm:py-1.5 sm:text-[11px]"
                            >
                              <Maximize2 className="size-3.5" aria-hidden />
                              Full details
                            </button>
                          </div>
                          {!mainTaskOnly && drawerOpen && !itProject ? renderPillarScreenshotFields(r, editable) : null}
                          {!mainTaskOnly && drawerOpen ? (
                            <div className="mt-3 space-y-2">
                              {renderTaskSubtaskContent(r, { hideSubtaskPendingBadge: showPendingBadge })}
                              {renderAddSubTaskPanel(r)}
                            </div>
                          ) : null}
                            </div>
                          </div>
                        </div>
                      );
                        })}
                      </div>
                    ))
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
      <TaskBoardPopup
        open={taskManagementOpen}
        title="Add Task"
        description="Create recurring tasks, pillars, and sub-task checklists for the Task Board."
        onClose={() => setTaskManagementOpen(false)}
        size="xl"
      >
        <KpiDefinitionConsole
          embedded
          fromJobOrderTicketId={fromJobOrderId}
          onFromJobOrderConsumed={() => {
            setFromJobOrderId(null);
            void load();
          }}
          onMaintenanceRecordsUpdated={() => void load()}
        />
      </TaskBoardPopup>
      <TaskBoardPopup
        open={forMyApprovalOpen}
        title="For My Approval"
        description="Sub-tasks awaiting verification by the org-chart head of each assignee's department."
        onClose={() => {
          setForMyApprovalOpen(false);
          setVerificationRejectOpen(false);
          setVerificationRejectComment("");
          setApprovalRejectTaskId(null);
        }}
        size="lg"
      >
        {forMyApprovalTasks.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-300 px-4 py-10 text-center text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-500">
            No tasks are waiting for your approval right now.
          </div>
        ) : (
          <ul className="space-y-2">
            {forMyApprovalTasks.map((r) => {
              const p = progress(r);
              const pendingSubs = pendingApprovalSubtasks(r);
              const rejectOpen = approvalRejectTaskId?.startsWith(`${r.id}::`) ?? false;
              const rejectSubId = approvalRejectTaskId?.startsWith(`${r.id}::`)
                ? approvalRejectTaskId.slice(`${r.id}::`.length)
                : "";
              return (
                <li
                  key={r.id}
                  className="rounded-xl border border-orange-300/50 bg-orange-500/[0.06] px-3 py-3 dark:border-orange-500/30 dark:bg-orange-500/10"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                        {taskLabel(r)}
                      </p>
                      <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">
                        {r.title}
                        {r.assignedAgent?.name ? ` Â· ${r.assignedAgent.name}` : ""}
                        {p.total > 0 ? ` Â· ${p.done}/${p.total} finished` : ""}
                      </p>
                      {r.pendingVerificationAt ? (
                        <p className="mt-1 text-[11px] text-zinc-500">
                          Submitted{" "}
                          {new Date(r.pendingVerificationAt).toLocaleString(undefined, {
                            timeZone: tz,
                          })}
                        </p>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setForMyApprovalOpen(false);
                        setApprovalRejectTaskId(null);
                        openActiveTask(r.id);
                      }}
                      className="shrink-0 rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200"
                    >
                      Full details
                    </button>
                  </div>
                  {pendingSubs.length > 0 ? (
                    <ul className="mt-3 space-y-2 border-t border-orange-300/40 pt-3 dark:border-orange-500/25">
                      {pendingSubs.map((sub) => {
                        const subRejectOpen = rejectOpen && rejectSubId === sub.id;
                        return (
                          <li
                            key={sub.id}
                            className="rounded-lg border border-zinc-200/80 bg-white/70 px-2.5 py-2 dark:border-zinc-700 dark:bg-zinc-950/40"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="min-w-0">
                                <p className="truncate text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                                  {sub.title || "Sub-task"}
                                </p>
                                {sub.assignedAgentName ? (
                                  <p className="text-[11px] text-zinc-500">{sub.assignedAgentName}</p>
                                ) : null}
                              </div>
                              {!subRejectOpen ? (
                                <div className="flex flex-wrap gap-2">
                                  <button
                                    type="button"
                                    disabled={busyId === r.id}
                                    onClick={() =>
                                      void submitCompletionVerification(r.id, "approve", undefined, sub.id)
                                    }
                                    className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                                  >
                                    Verify
                                  </button>
                                  <button
                                    type="button"
                                    disabled={busyId === r.id}
                                    onClick={() => {
                                      setApprovalRejectTaskId(`${r.id}::${sub.id}`);
                                      setVerificationRejectComment("");
                                    }}
                                    className="rounded-lg border border-rose-400/60 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-800 hover:bg-rose-500/15 dark:text-rose-200"
                                  >
                                    Reject
                                  </button>
                                </div>
                              ) : null}
                            </div>
                            {subRejectOpen ? (
                              <div className="mt-2 space-y-2">
                                <textarea
                                  value={verificationRejectComment}
                                  onChange={(e) => setVerificationRejectComment(e.target.value)}
                                  rows={3}
                                  placeholder="Required: explain why this was returned…"
                                  className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs text-zinc-900 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
                                />
                                <div className="flex flex-wrap gap-2">
                                  <button
                                    type="button"
                                    disabled={busyId === r.id || !verificationRejectComment.trim()}
                                    onClick={() =>
                                      void submitCompletionVerification(
                                        r.id,
                                        "reject",
                                        verificationRejectComment,
                                        sub.id,
                                      )
                                    }
                                    className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-500 disabled:opacity-50"
                                  >
                                    Confirm reject
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setApprovalRejectTaskId(null);
                                      setVerificationRejectComment("");
                                    }}
                                    className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-700 dark:border-zinc-600 dark:text-zinc-200"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <div className="mt-3 space-y-2 border-t border-orange-300/40 pt-3 dark:border-orange-500/25">
                      {!rejectOpen ? (
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={busyId === r.id}
                            onClick={() => void submitCompletionVerification(r.id, "approve")}
                            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                          >
                            Verify
                          </button>
                          <button
                            type="button"
                            disabled={busyId === r.id}
                            onClick={() => {
                              setApprovalRejectTaskId(`${r.id}::`);
                              setVerificationRejectComment("");
                            }}
                            className="rounded-lg border border-rose-400/60 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-800 hover:bg-rose-500/15 dark:text-rose-200"
                          >
                            Reject
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <textarea
                            value={verificationRejectComment}
                            onChange={(e) => setVerificationRejectComment(e.target.value)}
                            rows={3}
                            placeholder="Required: explain why this was returned…"
                            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs text-zinc-900 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
                          />
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              disabled={busyId === r.id || !verificationRejectComment.trim()}
                              onClick={() =>
                                void submitCompletionVerification(
                                  r.id,
                                  "reject",
                                  verificationRejectComment,
                                )
                              }
                              className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-500 disabled:opacity-50"
                            >
                              Confirm reject
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setApprovalRejectTaskId(null);
                                setVerificationRejectComment("");
                              }}
                              className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-700 dark:border-zinc-600 dark:text-zinc-200"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </TaskBoardPopup>
      <TaskBoardPopup
        open={travelOrdersOpen}
        title="Travel Orders"
        description="Travel orders for your company, plus any where you are an approver or the person-in-charge. Open a row to view details and approvals."
        onClose={() => setTravelOrdersOpen(false)}
        size="lg"
      >
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-zinc-600 dark:text-zinc-400">
            Includes company travel orders and ones you prepare or approve. Approved orders stay viewable here.
          </p>
          <button
            type="button"
            onClick={() => {
              setResumeTravelOrderDraftId(null);
              setCreateTravelOrderOpen(true);
            }}
            className="rounded-lg bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-500"
          >
            New Travel Order
          </button>
        </div>
        <TravelOrderOfflineBanner className="mb-3" />
        {companyTravelOrdersError ? (
          <div className="mb-3 flex items-start justify-between gap-3 rounded-lg border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-200">
            <p className="min-w-0 flex-1">{companyTravelOrdersError}</p>
            <button
              type="button"
              onClick={() => void reloadCompanyTravelOrders()}
              disabled={companyTravelOrdersLoading}
              className="shrink-0 rounded-md border border-rose-400/50 bg-rose-500/15 px-2.5 py-1 font-semibold text-rose-800 hover:bg-rose-500/25 disabled:opacity-60 dark:text-rose-100"
            >
              {companyTravelOrdersLoading ? "Retrying…" : "Retry"}
            </button>
          </div>
        ) : null}
        {companyTravelOrdersLoading && companyTravelOrders.length === 0 ? (
          <p className="rounded-xl border border-dashed border-zinc-300 px-4 py-10 text-center text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-500">
            Loading travel orders…
          </p>
        ) : companyTravelOrders.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-300 px-4 py-10 text-center text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-500">
            No travel orders for your company yet. Click <strong>New Travel Order</strong> to create one.
          </div>
        ) : (
          <ul className="space-y-2">
            {companyTravelOrders.map((order) => {
              const isDraft = order.status === "DRAFT";
              const pendingSync = order.status === "PENDING_SYNC";
              const workPlan = isWorkPlanOrder(order);
              const meta = workPlan ? order.workPlanMeta : null;
              const preparedBy = order.createdByAgent?.name?.trim() || null;
              const personInCharge =
                meta?.personInChargeName?.trim() ||
                meta?.requestingParty?.trim() ||
                null;
              const subtitleParts: string[] = [];
              if (preparedBy) subtitleParts.push(`Prepared by: ${preparedBy}`);
              if (personInCharge && personInCharge !== preparedBy) {
                subtitleParts.push(`Person-in-Charge: ${personInCharge}`);
              } else if (meta?.departmentBusinessUnit?.trim()) {
                subtitleParts.push(meta.departmentBusinessUnit.trim());
              }
              if (pendingSync) subtitleParts.push("Saved offline — will sync when online");
              return (
                <li key={order.id} className="flex items-stretch gap-1.5">
                  <button
                    type="button"
                    disabled={pendingSync}
                    onClick={() => {
                      if (pendingSync) return;
                      if (isDraft) {
                        setTravelOrdersOpen(false);
                        setResumeTravelOrderDraftId(order.id);
                        setCreateTravelOrderOpen(true);
                        return;
                      }
                      if (!order.kpiMaintenanceId) return;
                      const taskId = order.kpiMaintenanceId;
                      const onBoard = rows.some((row) => row.id === taskId);
                      setTravelOrdersOpen(false);
                      if (onBoard) {
                        openActiveTask(taskId);
                        return;
                      }
                      setViewTravelOrder({
                        taskId,
                        travelOrderId: order.id,
                        title:
                          order.orderRequest?.trim() ||
                          order.kpiMainTask ||
                          order.kpiTitle ||
                          "Travel Order",
                      });
                    }}
                    className="flex w-full items-start justify-between gap-3 rounded-xl border border-zinc-200 bg-zinc-50/80 px-3 py-3 text-left transition hover:border-orange-400/60 hover:bg-orange-50/50 disabled:cursor-default disabled:opacity-90 dark:border-zinc-700 dark:bg-zinc-950/50 dark:hover:border-orange-500/40 dark:hover:bg-orange-950/20"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[10px] font-bold uppercase tracking-[0.14em] text-orange-800 dark:text-orange-200">
                        Travel Order
                      </p>
                      <p className="mt-1 truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                        {order.orderRequest?.trim() ||
                          order.kpiMainTask ||
                          "Travel Order for Management Approval"}
                      </p>
                      <p className="mt-1 text-xs text-zinc-500">
                        {isDraft
                          ? "Saved draft — open to continue editing"
                          : subtitleParts.length > 0
                            ? subtitleParts.join(" Â· ")
                            : "Open to view details and approvals"}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">
                      {isDraft ? "DRAFT" : pendingSync ? "PENDING SYNC" : order.status}
                    </span>
                  </button>
                  {(isDraft || pendingSync) ? (
                    <button
                      type="button"
                      onClick={() => void removeDraftTravelOrder(order.id)}
                      className={
                        confirmRemoveDraftId === order.id
                          ? "shrink-0 self-center rounded-xl border border-rose-400 bg-rose-600 px-2.5 py-3 text-[11px] font-bold text-white hover:bg-rose-500"
                          : "shrink-0 self-center rounded-xl border border-rose-300 bg-white px-2.5 py-3 text-[11px] font-semibold text-rose-600 hover:bg-rose-50 dark:border-rose-500/40 dark:bg-zinc-950 dark:text-rose-300 dark:hover:bg-rose-950/30"
                      }
                      title={
                        pendingSync
                          ? "Discard this offline queue item (stored on this device)"
                          : "Remove this draft travel order (stored on this device)"
                      }
                    >
                      {confirmRemoveDraftId === order.id
                        ? "Confirm remove?"
                        : pendingSync
                          ? "Discard"
                          : "Remove draft"}
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </TaskBoardPopup>
      <TravelOrderRequestModal
        open={createTravelOrderOpen}
        mainTaskName=""
        allowEditDetails
        companyScopeAgentId={operatorAgentId}
        resumeLocalId={resumeTravelOrderDraftId}
        onClose={() => {
          setCreateTravelOrderOpen(false);
          setResumeTravelOrderDraftId(null);
        }}
        onDraftSaved={() => {
          setCreateTravelOrderOpen(false);
          setResumeTravelOrderDraftId(null);
          void reloadCompanyTravelOrders();
        }}
        onCreated={({ kpiId, travelOrderId, linkedRfpTicketId, offlineQueued }) => {
          setCreateTravelOrderOpen(false);
          setResumeTravelOrderDraftId(null);
          if (offlineQueued) {
            void reloadCompanyTravelOrders();
            return;
          }
          // After submit, open the linked RFP editor so the requestor can review/edit.
          if (travelOrderId) {
            setEditTravelOrderRfp({
              taskId: kpiId,
              travelOrderId,
              linkedRfpTicketId: linkedRfpTicketId ?? null,
            });
          } else {
            setViewTravelOrder({
              taskId: kpiId,
              travelOrderId: null,
              title: "Travel Order",
            });
          }
          queueMicrotask(() => {
            void reloadCompanyTravelOrders();
            void load();
          });
        }}
      />
      <TravelOrderRfpEditModal
        open={Boolean(editTravelOrderRfp)}
        taskId={editTravelOrderRfp?.taskId ?? null}
        travelOrderId={editTravelOrderRfp?.travelOrderId ?? null}
        initialTicketId={editTravelOrderRfp?.linkedRfpTicketId ?? null}
        onClose={() => setEditTravelOrderRfp(null)}
      />
      <TravelOrderApprovalModal
        open={Boolean(viewTravelOrder)}
        taskId={viewTravelOrder?.taskId ?? null}
        travelOrderId={viewTravelOrder?.travelOrderId ?? null}
        title={viewTravelOrder?.title}
        description="View details and management approvals for this travel order."
        operatorAgentId={operatorAgentId}
        canAssignWork={canAssignWork}
        canCheckIn
        onClose={() => setViewTravelOrder(null)}
        onUpdated={() => {
          void reloadCompanyTravelOrders();
          void load();
        }}
        onEditLinkedRfp={
          viewTravelOrder?.travelOrderId
            ? () => {
                const toId = viewTravelOrder.travelOrderId;
                if (!toId) return;
                const taskId = viewTravelOrder.taskId;
                setViewTravelOrder(null);
                setEditTravelOrderRfp({
                  taskId,
                  travelOrderId: toId,
                });
              }
            : undefined
        }
      />
      {(() => {
        return (
          <SubTasksManagerPopup
            open={Boolean(subTasksManagerTaskId)}
            taskId={subTasksManagerTaskId}
            taskLabel={
              subTasksManagerTaskId
                ? (() => {
                    const managerRecord = rows.find((r) => r.id === subTasksManagerTaskId);
                    return managerRecord ? taskLabel(managerRecord) : "";
                  })()
                : ""
            }
            canManage={showAdminTaskManagement}
            hideDueDate={
              subTasksManagerTaskId
                ? (() => {
                    const managerRecord = rows.find((r) => r.id === subTasksManagerTaskId);
                    return managerRecord ? hideAddSubTaskScheduleDate(managerRecord) : false;
                  })()
                : false
            }
            allowDueDateRollWithCycle={
              subTasksManagerTaskId
                ? (() => {
                    const managerRecord = rows.find((r) => r.id === subTasksManagerTaskId);
                    return Boolean(
                      managerRecord?.isRecurring && managerRecord.frequency !== "DAILY",
                    );
                  })()
                : false
            }
            tz={tz}
            onClose={() => setSubTasksManagerTaskId(null)}
            onChanged={() => void load()}
          />
        );
      })()}
      {renderActiveTaskModal()}
      <SeekAssistanceModal
        open={Boolean(seekAssistModal)}
        taskTitle={seekAssistModal?.taskTitle ?? ""}
        segmentLabel={seekAssistModal?.segmentLabel}
        candidates={seekAssistModal?.candidates ?? []}
        busy={Boolean(seekAssistModal && busyId === seekAssistModal.kpiId)}
        onClose={() => setSeekAssistModal(null)}
        onConfirm={(ids) => {
          if (!seekAssistModal) return;
          void seekAssistance(seekAssistModal.kpiId, ids);
        }}
      />
    </section>
  );
}
