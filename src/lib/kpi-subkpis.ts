import type { Prisma } from "@prisma/client/primary";
import {
  normalizeDelayPenaltyFrequency,
  type DelayPenaltyFrequency,
} from "@/lib/delay-penalty-frequency";
import { normalizePersonName } from "@/lib/person-name";
import { DateTime } from "luxon";
import {
  itProjectAllItems,
  isItProjectEnvelope,
  parseItProjectSubKpis,
  wrapItProjectSubKpis,
} from "@/lib/it-project-subkpis";
import {
  kpiHasDistinctMainTask,
  kpiMainTaskLabel,
  type KpiMainTaskRecord,
} from "@/lib/kpi-main-task";
import {
  parseTaskScreenshotMetaList,
  type TaskScreenshotMetaItem,
  type TaskScreenshotSlot,
} from "@/lib/task-screenshot-meta";
import {
  advanceDueDateYmdForFrequency,
  countRecurrencePeriodsBetween,
  normalizeTimeZone,
  type KpiFrequencyCode,
} from "./kpi-recurrence";
import {
  applySubKpiClearVerification,
  applySubKpiSubmitForVerification,
  coerceSubKpiItemVerificationStatus,
  isSubKpiEffectivelyVerified,
  isSubKpiPendingVerification,
  type SubKpiVerificationFields,
} from "@/lib/task-completion-verification";
import {
  applySubKpiCompletionMode,
  applySubKpiCompletionRequirements,
  completionRequirementsFromLegacyMode,
  hasBeforeAndAfterScreenshots,
  isSubKpiCompletionMode,
  normalizeCompletionRequirements,
  resolveSubKpiCompletionMode,
  resolveSubKpiCompletionRequirements,
  subKpiItemProgressFraction,
  subKpiRequirementsMet,
  subKpiRequiresScreenshotsFromMode,
  subKpiRequiresNumerical,
  subKpiStoredCompletionRequirements,
  type SubKpiCompletionMode,
  type SubKpiCompletionRequirements,
} from "@/lib/sub-kpi-completion-mode";

/** Synthetic sub-task id when completion applies on the pillar card (no checklist rows). */
export const PILLAR_ONLY_VIRTUAL_SUBKPI_ID = "__pillar__";

/** Optional schedule fields are calendar days `YYYY-MM-DD` (IT Project Implementation sub-tasks). */
export type SubKpiItem = {
  id: string;
  title: string;
  /** Optional free-text details shown in the Sub Tasks manager. */
  description?: string | null;
  /** Optional free-text remarks / notes for the sub-task (never required). */
  remarks?: string | null;
  done?: boolean;
  assignedAgentId?: string | null;
  assignedAgentName?: string | null;
  projectPriority?: "High" | "Medium" | "Low" | null;
  projectStatus?: "Pending" | "On Going" | "Finalizing" | "Done" | null;
  /** How assignees complete this sub-task (checkbox, screenshots, numerical, or combinations). */
  completionMode?: SubKpiCompletionMode;
  completionRequirements?: SubKpiCompletionRequirements;
  screenshotsEnabled?: boolean;
  beforeScreenshot?: TaskScreenshotMetaItem[];
  afterScreenshot?: TaskScreenshotMetaItem[];
  /** Generic proof uploads when screenshot-upload completion is enabled. */
  uploadScreenshot?: TaskScreenshotMetaItem[];
  location?: string | null;
  startDate?: string | null;
  /** End date (stored as dueDate for backward compatibility). */
  dueDate?: string | null;
  /**
   * When true with a custom `dueDate`, advance that date by one recurrence period
   * on each cycle rollover (e.g. monthly Aug 15 → Sep 15).
   */
  dueDateRollsWithCycle?: boolean;
  actualDate?: string | null;
  /** ISO timestamp when Start was pressed (GPS lifecycle). */
  startedAt?: string | null;
  /** ISO timestamp when End was pressed (GPS lifecycle). */
  endedAt?: string | null;
  startedLatitude?: number | null;
  startedLongitude?: number | null;
  endedLatitude?: number | null;
  endedLongitude?: number | null;
  numericalValue?: number | null;
  /** Target number admins set when numerical record completion is enabled. */
  numericalTarget?: number | null;
  /** Penalty amount when this sub-task is delayed (overrides task default; per frequency period). */
  dailyPenaltyAmount?: number | null;
  /** Accrual cadence for dailyPenaltyAmount (inherits task envelope when omitted). */
  delayPenaltyFrequency?: DelayPenaltyFrequency | null;
  /** Main assignee unlocked helper assignment via Seek Assistance. */
  assistanceRequested?: boolean;
  assistanceRequestedAt?: string | null;
  assistanceRequestedBy?: string | null;
  /** Department-head gate after assignee marks the sub-task done. */
  completionVerificationStatus?: SubKpiVerificationFields["completionVerificationStatus"];
  pendingVerificationAt?: string | null;
  verifiedAt?: string | null;
  verifiedByAgentId?: string | null;
  verifiedByAgentName?: string | null;
  verificationRejectionComment?: string | null;
};

/** Subtask assignee UI/API unlocked when parent flag is on or Seek Assistance was used. */
export function isSubKpiAssigneeUnlocked(
  enableSubtaskAssignees: boolean,
  item: Pick<SubKpiItem, "assistanceRequested">,
): boolean {
  return enableSubtaskAssignees === true || item.assistanceRequested === true;
}

/**
 * Who may set a subtask assignee once unlocked.
 * When `enableSubtaskAssignees` is OFF, only assign-work roles (admins) may use the
 * dropdown after Seek Assistance — assigned personnel never see assignee controls.
 */
export function canMutateSubKpiAssignee(opts: {
  enableSubtaskAssignees: boolean;
  item: Pick<SubKpiItem, "assistanceRequested">;
  canAssignWork: boolean;
  isMainAssignee: boolean;
}): boolean {
  if (!isSubKpiAssigneeUnlocked(opts.enableSubtaskAssignees, opts.item)) return false;
  // Flag ON: admins or the main assignee can set helpers.
  if (opts.enableSubtaskAssignees === true) {
    return opts.canAssignWork || opts.isMainAssignee;
  }
  // Flag OFF (Seek Assistance unlock only): admins assign helpers; hide dropdown from personnel.
  return opts.canAssignWork === true;
}

const SUB_KPI_PRIORITY_OPTIONS = ["High", "Medium", "Low"] as const;

function normalizeSubKpiPriority(value: unknown): SubKpiItem["projectPriority"] {
  return SUB_KPI_PRIORITY_OPTIONS.find((option) => option === value) ?? null;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export function normalizeOptionalSubKpiYmd(v: unknown): string | null {
  if (v == null) return null;
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) return null;
  return YMD.test(s) ? s : null;
}

const SUB_KPI_DESCRIPTION_MAX = 600;
const SUB_KPI_REMARKS_MAX = 1000;

function normalizeSubKpiDescription(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, SUB_KPI_DESCRIPTION_MAX) : "";
}

function normalizeSubKpiRemarks(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, SUB_KPI_REMARKS_MAX) : "";
}

function itemFromRaw(r: Record<string, unknown>): SubKpiItem {
  const id = String(r?.id ?? "");
  const title = String(r?.title ?? "");
  const description = normalizeSubKpiDescription(r?.description);
  const remarks = normalizeSubKpiRemarks(r?.remarks);
  const done = Boolean(r?.done);
  const assignedAgentId = typeof r?.assignedAgentId === "string" ? r.assignedAgentId.trim() : "";
  const assignedAgentName = typeof r?.assignedAgentName === "string" ? r.assignedAgentName.trim() : "";
  const projectPriority = normalizeSubKpiPriority(r?.projectPriority);
  const projectStatus =
    r?.projectStatus === "Pending" ||
    r?.projectStatus === "On Going" ||
    r?.projectStatus === "Finalizing" ||
    r?.projectStatus === "Done"
      ? r.projectStatus
      : null;
  const beforeScreenshot = parseTaskScreenshotMetaList(r?.beforeScreenshot);
  const afterScreenshot = parseTaskScreenshotMetaList(r?.afterScreenshot);
  const uploadScreenshot = parseTaskScreenshotMetaList(r?.uploadScreenshot);
  const completionRequirements = normalizeCompletionRequirements(r?.completionRequirements);
  const completionMode = isSubKpiCompletionMode(r?.completionMode)
    ? r.completionMode
    : resolveSubKpiCompletionMode({
        completionMode: undefined,
        screenshotsEnabled: r?.screenshotsEnabled === true,
        beforeScreenshot,
        afterScreenshot,
      });
  const resolvedRequirements =
    completionRequirements ?? completionRequirementsFromLegacyMode(completionMode);
  const screenshotsEnabled =
    r?.screenshotsEnabled === true || subKpiRequiresScreenshotsFromMode(completionMode);
  const startDate = normalizeOptionalSubKpiYmd(r?.startDate);
  const dueDate = normalizeOptionalSubKpiYmd(r?.dueDate);
  const dueDateRollsWithCycle = r?.dueDateRollsWithCycle === true && Boolean(dueDate);
  const actualDate = normalizeOptionalSubKpiYmd(r?.actualDate);
  const numericalRaw = r?.numericalValue;
  const numericalValue =
    typeof numericalRaw === "number" && Number.isFinite(numericalRaw) ? numericalRaw : null;
  const numericalTargetRaw = r?.numericalTarget;
  const numericalTarget =
    typeof numericalTargetRaw === "number" && Number.isFinite(numericalTargetRaw)
      ? numericalTargetRaw
      : null;
  const dailyPenaltyRaw = r?.dailyPenaltyAmount;
  const dailyPenaltyAmount =
    typeof dailyPenaltyRaw === "number" && Number.isFinite(dailyPenaltyRaw) && dailyPenaltyRaw >= 0
      ? dailyPenaltyRaw
      : null;
  const delayPenaltyFrequency = r?.delayPenaltyFrequency
    ? normalizeDelayPenaltyFrequency(r.delayPenaltyFrequency)
    : null;
  const assistanceRequested = r?.assistanceRequested === true;
  const assistanceRequestedAt =
    typeof r?.assistanceRequestedAt === "string" ? r.assistanceRequestedAt.trim() : "";
  const assistanceRequestedBy =
    typeof r?.assistanceRequestedBy === "string" ? r.assistanceRequestedBy.trim() : "";
  const completionVerificationStatus =
    typeof r?.completionVerificationStatus === "string"
      ? r.completionVerificationStatus.trim()
      : "";
  const pendingVerificationAt =
    typeof r?.pendingVerificationAt === "string" ? r.pendingVerificationAt.trim() : "";
  const verifiedAt = typeof r?.verifiedAt === "string" ? r.verifiedAt.trim() : "";
  const verifiedByAgentId =
    typeof r?.verifiedByAgentId === "string" ? r.verifiedByAgentId.trim() : "";
  const verifiedByAgentName =
    typeof r?.verifiedByAgentName === "string" ? r.verifiedByAgentName.trim() : "";
  const verificationRejectionComment =
    typeof r?.verificationRejectionComment === "string"
      ? r.verificationRejectionComment.trim().slice(0, 1000)
      : "";
  return {
    id,
    title,
    ...(description ? { description } : {}),
    ...(remarks ? { remarks } : {}),
    done,
    ...(assignedAgentId ? { assignedAgentId } : {}),
    ...(assignedAgentName ? { assignedAgentName } : {}),
    ...(projectPriority ? { projectPriority } : {}),
    ...(projectStatus ? { projectStatus } : {}),
    ...(completionRequirements ? { completionRequirements: resolvedRequirements } : {}),
    ...(completionMode !== "checkbox" && !completionRequirements ? { completionMode } : {}),
    ...(screenshotsEnabled ? { screenshotsEnabled: true } : {}),
    ...(beforeScreenshot.length > 0 ? { beforeScreenshot } : {}),
    ...(afterScreenshot.length > 0 ? { afterScreenshot } : {}),
    ...(uploadScreenshot.length > 0 ? { uploadScreenshot } : {}),
    ...(startDate ? { startDate } : {}),
    ...(dueDate ? { dueDate } : {}),
    ...(dueDateRollsWithCycle ? { dueDateRollsWithCycle: true } : {}),
    ...(actualDate ? { actualDate } : {}),
    ...(numericalValue != null ? { numericalValue } : {}),
    ...(numericalTarget != null ? { numericalTarget } : {}),
    ...(dailyPenaltyAmount != null ? { dailyPenaltyAmount } : {}),
    ...(delayPenaltyFrequency ? { delayPenaltyFrequency } : {}),
    ...(assistanceRequested ? { assistanceRequested: true } : {}),
    ...(assistanceRequestedAt ? { assistanceRequestedAt } : {}),
    ...(assistanceRequestedBy ? { assistanceRequestedBy } : {}),
    ...(completionVerificationStatus
      ? { completionVerificationStatus }
      : {}),
    ...(pendingVerificationAt ? { pendingVerificationAt } : {}),
    ...(verifiedAt ? { verifiedAt } : {}),
    ...(verifiedByAgentId ? { verifiedByAgentId } : {}),
    ...(verifiedByAgentName ? { verifiedByAgentName } : {}),
    ...(verificationRejectionComment ? { verificationRejectionComment } : {}),
  };
}

export type SubKpiSegment = {
  id: string;
  label: string;
  items: SubKpiItem[];
  /** Optional phase / segment target date (YYYY-MM-DD). Used for Project Make Phases. */
  dueDate?: string | null;
};

/** Reserved segment id for the General / Unsegmented Kanban board. */
export const UNSEGMENTED_SEGMENT_ID = "__unsegmented__";
/** Pool column for subtasks not yet assigned to a named segment (Trello "Unassigned"). */
export const UNSEGMENTED_SEGMENT_LABEL = "Unassigned";

export function isUnsegmentedSegmentId(id: string | null | undefined): boolean {
  return (id ?? "").trim() === UNSEGMENTED_SEGMENT_ID;
}

/** Sub-tasks still waiting on the Unassigned column (segmented checklists only). */
export function getUnassignedSegmentItems(raw: unknown): SubKpiItem[] {
  const n = normalizeSubKpis(raw);
  if (!n.segmented) return [];
  const general = n.segments.find((seg) => isUnsegmentedSegmentId(seg.id));
  return general?.items ?? [];
}

/** True when Unassigned still has cards — blocks create/finalize until they are moved into a segment. */
export function hasItemsInUnassignedSegment(raw: unknown): boolean {
  return getUnassignedSegmentItems(raw).length > 0;
}

export const UNASSIGNED_SEGMENT_BLOCK_MESSAGE =
  "Move all sub-tasks out of Unassigned into a segment before finalizing.";


/** Ensure segmented checklists always include the Unassigned column (at the end). */
export function ensureUnsegmentedSegment(segments: SubKpiSegment[]): SubKpiSegment[] {
  const without = segments.filter((seg) => !isUnsegmentedSegmentId(seg.id));
  // Merge every reserved-id column (defensive) so items are never dropped.
  const existingItems = segments
    .filter((seg) => isUnsegmentedSegmentId(seg.id))
    .flatMap((seg) => seg.items);
  const existing = segments.find((seg) => isUnsegmentedSegmentId(seg.id));
  return [
    ...without,
    {
      id: UNSEGMENTED_SEGMENT_ID,
      label: existing?.label?.trim() || UNSEGMENTED_SEGMENT_LABEL,
      // Always copy so callers cannot accidentally share/mutate the same array.
      items: [...existingItems],
    },
  ];
}

/** Kanban column within a segment board. */
export type SubKpiBoardColumn = "todo" | "progress" | "done";

export function subKpiBoardColumn(item: Pick<SubKpiItem, "done" | "projectStatus">): SubKpiBoardColumn {
  if (item.done === true || item.projectStatus === "Done") return "done";
  if (item.projectStatus === "On Going" || item.projectStatus === "Finalizing") return "progress";
  return "todo";
}

export function applySubKpiBoardColumn(item: SubKpiItem, column: SubKpiBoardColumn): SubKpiItem {
  const next: SubKpiItem = { ...item };
  if (column === "done") {
    next.done = true;
    next.projectStatus = "Done";
  } else if (column === "progress") {
    next.done = false;
    next.projectStatus = "On Going";
  } else {
    next.done = false;
    next.projectStatus = "Pending";
  }
  return next;
}

/** Stored JSON: legacy flat array or wrapped envelope. */
export type SubKpisStoredEnvelope = {
  segmented: boolean;
  items?: SubKpiItem[];
  segments?: SubKpiSegment[];
  taskPriority?: SubKpiItem["projectPriority"];
  pillarScreenshotsEnabled?: boolean;
  pillarBeforeScreenshot?: TaskScreenshotMetaItem[];
  pillarAfterScreenshot?: TaskScreenshotMetaItem[];
  pillarScreenshotUploadEnabled?: boolean;
  pillarScreenshot?: TaskScreenshotMetaItem[];
  archivedTaskScreenshots?: ArchivedTaskScreenshotSet[];
  archivedNumericalRecords?: ArchivedNumericalRecordSet[];
  /** Default daily penalty for sub-tasks when delayed (sub-task value overrides). */
  taskDailyPenaltyAmount?: number | null;
  /** Total number of sub-tasks (checklist items) currently in this group. */
  taskCount?: number | null;
};

export type ArchivedTaskScreenshotSet = {
  archivedAt: string;
  subTasks: Array<{
    id: string;
    title: string;
    beforeScreenshot?: TaskScreenshotMetaItem[];
    afterScreenshot?: TaskScreenshotMetaItem[];
    uploadScreenshot?: TaskScreenshotMetaItem[];
  }>;
  pillarBeforeScreenshot?: TaskScreenshotMetaItem[];
  pillarAfterScreenshot?: TaskScreenshotMetaItem[];
  pillarScreenshot?: TaskScreenshotMetaItem[];
};

export type ArchivedNumericalRecordSet = {
  archivedAt: string;
  subTasks: Array<{
    id: string;
    title: string;
    numericalTarget?: number | null;
    numericalValue?: number | null;
  }>;
};

export type NormalizedSubKpis =
  | { segmented: false; flat: SubKpiItem[] }
  | { segmented: true; segments: SubKpiSegment[] };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

export function normalizeSubKpis(raw: unknown): NormalizedSubKpis {
  if (Array.isArray(raw)) {
    const flat = raw.map((x) =>
      isPlainObject(x) ? itemFromRaw(x as Record<string, unknown>) : { id: "", title: "", done: false },
    );
    return { segmented: false, flat };
  }
  if (isPlainObject(raw)) {
    if (raw.segmented === true && Array.isArray(raw.segments)) {
      const segments = (raw.segments as unknown[]).map((seg) => {
        const s = seg as SubKpiSegment & Record<string, unknown>;
        const id = String(s?.id ?? "");
        const label = String(s?.label ?? "");
        const items = Array.isArray(s?.items)
          ? (s.items as unknown[]).map((it) =>
              isPlainObject(it)
                ? itemFromRaw(it as Record<string, unknown>)
                : { id: "", title: "", done: false },
            )
          : [];
        const dueDate = normalizeOptionalSubKpiYmd(s?.dueDate);
        return {
          id,
          label,
          items,
          ...(dueDate ? { dueDate } : {}),
        };
      });
      return { segmented: true, segments: ensureUnsegmentedSegment(segments) };
    }
    if (Array.isArray(raw.items)) {
      const flat = (raw.items as unknown[]).map((x) =>
        isPlainObject(x) ? itemFromRaw(x as Record<string, unknown>) : { id: "", title: "", done: false },
      );
      return { segmented: false, flat };
    }
  }
  return { segmented: false, flat: [] };
}

export function collectAllSubKpiItems(norm: NormalizedSubKpis): SubKpiItem[] {
  if (norm.segmented) return norm.segments.flatMap((s) => s.items);
  return norm.flat;
}

/** IT Project tasks: all phases flattened (legacy segmented JSON is flattened for display). */
export function normalizeSubKpisForItProject(raw: unknown): NormalizedSubKpis {
  if (isItProjectEnvelope(raw)) {
    return { segmented: false, flat: itProjectAllItems(parseItProjectSubKpis(raw)) };
  }
  const n = normalizeSubKpis(raw);
  if (!n.segmented) return n;
  return { segmented: false, flat: collectAllSubKpiItems(n) };
}

/** Checklist completion: percent = (total − missing) / total, missing = unchecked items. */
export type KpiChecklistProgress = {
  total: number;
  done: number;
  missing: number;
  percent: number;
};

export function kpiChecklistProgress(
  raw: unknown,
  taskTitle?: string,
  opts?: { parentCardEffectivelyVerified?: boolean; verificationEnabled?: boolean },
): KpiChecklistProgress {
  const all = collectChecklistProgressItems(raw, taskTitle);
  const total = all.length;
  const parentVerified = Boolean(opts?.parentCardEffectivelyVerified);
  const verifyOpts = {
    parentCardEffectivelyVerified: parentVerified,
    verificationEnabled: opts?.verificationEnabled,
  };
  const done = all.filter(
    (s) =>
      subKpiRequirementsMet(s) &&
      isSubKpiEffectivelyVerified(s, verifyOpts),
  ).length;
  const missing = total - done;
  const progressSum = all.reduce((sum, item) => {
    const frac = subKpiItemProgressFraction(item);
    if (frac <= 0) return sum;
    // Submitted-but-unverified items should not fill the donut as finished.
    if (
      subKpiRequirementsMet(item) &&
      !isSubKpiEffectivelyVerified(item, verifyOpts)
    ) {
      return sum;
    }
    return sum + frac;
  }, 0);
  const percent = total > 0 ? Math.round((progressSum / total) * 100) : 0;
  return { total, done, missing, percent };
}

export function aggregateKpiChecklistProgress(
  records: ReadonlyArray<{ subKpis: unknown }>,
): KpiChecklistProgress {
  let total = 0;
  let done = 0;
  for (const r of records) {
    const p = kpiChecklistProgress(r.subKpis);
    total += p.total;
    done += p.done;
  }
  const missing = total - done;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  return { total, done, missing, percent };
}

/**
 * Cybersecurity / network: checked on the task board = breach or downtime;
 * unchecked items are neutral (safe / uptime), not counted as incidents.
 */
export const INVERTED_CHECKLIST_PILLARS = new Set<string>([
  "CYBERSECURITY",
  "NETWORK PERFORMANCE",
]);

/** @deprecated Use {@link isInvertedChecklistPillar} — frequency is ignored. */
export const DAILY_INVERTED_CHECKLIST_PILLARS = INVERTED_CHECKLIST_PILLARS;

export function isInvertedChecklistPillar(title: string): boolean {
  return INVERTED_CHECKLIST_PILLARS.has(title.trim());
}

export function isDailyInvertedChecklistPillar(title: string, frequency?: string): boolean {
  void frequency;
  return isInvertedChecklistPillar(title);
}

/** Donut/headline view: positive = good state, negative = bad state (may invert raw checklist). */
export type KpiChecklistMetricView = KpiChecklistProgress & {
  positive: number;
  negative: number;
  inverted: boolean;
};

export function kpiChecklistMetricView(
  agg: KpiChecklistProgress,
  invert: boolean,
): KpiChecklistMetricView {
  if (!invert) {
    return { ...agg, positive: agg.done, negative: agg.missing, inverted: false };
  }
  const positive = agg.missing;
  const negative = agg.done;
  const percent = agg.total > 0 ? Math.round((positive / agg.total) * 100) : 0;
  return { ...agg, percent, positive, negative, inverted: true };
}

/** Cybersecurity / network CSV + headline: unchecked = safe, checked = breached/downtime. */
export function incidentMetricPercents(agg: KpiChecklistProgress): {
  safePercent: number;
  breachedPercent: number;
  /** Null when there is no checklist data for the day/period. */
  effPercent: number | null;
} {
  if (agg.total <= 0) {
    return { safePercent: 0, breachedPercent: 0, effPercent: null };
  }
  const view = kpiChecklistMetricView(agg, true);
  const safePercent = view.percent;
  const breachedPercent = Math.round((view.negative / agg.total) * 100);
  const effPercent = breachedPercent >= 100 ? 0 : safePercent;
  return { safePercent, breachedPercent, effPercent };
}

export function wrapForPersist(norm: NormalizedSubKpis): Prisma.InputJsonValue {
  if (norm.segmented) {
    return {
      segmented: true,
      segments: ensureUnsegmentedSegment(norm.segments),
    } as Prisma.InputJsonValue;
  }
  return { segmented: false, items: norm.flat } as Prisma.InputJsonValue;
}

function rawEnvelopeMeta(raw: unknown) {
  if (!isPlainObject(raw)) {
    return {
      taskPriority: null as SubKpiItem["projectPriority"],
      pillarScreenshotsEnabled: false,
      pillarBeforeScreenshot: [] as TaskScreenshotMetaItem[],
      pillarAfterScreenshot: [] as TaskScreenshotMetaItem[],
      pillarScreenshotUploadEnabled: false,
      pillarScreenshot: [] as TaskScreenshotMetaItem[],
      archivedTaskScreenshots: [] as ArchivedTaskScreenshotSet[],
      archivedNumericalRecords: [] as ArchivedNumericalRecordSet[],
      taskDailyPenaltyAmount: null as number | null,
      taskDelayPenaltyFrequency: "DAILY" as DelayPenaltyFrequency,
      pillarCompletionRequirements: null as SubKpiCompletionRequirements | null,
      pillarDone: false,
      pillarNumericalTarget: null as number | null,
      pillarNumericalValue: null as number | null,
      pillarDueDate: null as string | null,
      pillarActualDate: null as string | null,
      taskCount: null as number | null,
      isFieldAssignment: false,
      isProject: false,
      invertedRecording: false,
      linkedJobOrderTicketId: null as string | null,
      linkedJobOrderTicketNumber: null as string | null,
    };
  }
  const pillarBeforeScreenshot = parseTaskScreenshotMetaList(raw.pillarBeforeScreenshot);
  const pillarAfterScreenshot = parseTaskScreenshotMetaList(raw.pillarAfterScreenshot);
  const pillarScreenshot = parseTaskScreenshotMetaList(raw.pillarScreenshot);
  const penaltyRaw = raw.taskDailyPenaltyAmount;
  const taskDailyPenaltyAmount =
    typeof penaltyRaw === "number" && Number.isFinite(penaltyRaw) && penaltyRaw >= 0 ? penaltyRaw : null;
  const taskDelayPenaltyFrequency = normalizeDelayPenaltyFrequency(raw.taskDelayPenaltyFrequency);
  const pillarTargetRaw = raw.pillarNumericalTarget;
  const pillarValueRaw = raw.pillarNumericalValue;
  return {
    taskPriority: normalizeSubKpiPriority(raw.taskPriority),
    pillarScreenshotsEnabled:
      raw.pillarScreenshotsEnabled === true ||
      pillarBeforeScreenshot.length > 0 ||
      pillarAfterScreenshot.length > 0,
    pillarBeforeScreenshot,
    pillarAfterScreenshot,
    pillarScreenshotUploadEnabled:
      raw.pillarScreenshotUploadEnabled === true || pillarScreenshot.length > 0,
    pillarScreenshot,
    archivedTaskScreenshots: parseArchivedTaskScreenshotSets(raw.archivedTaskScreenshots),
    archivedNumericalRecords: parseArchivedNumericalRecordSets(raw.archivedNumericalRecords),
    taskDailyPenaltyAmount,
    taskDelayPenaltyFrequency,
    pillarCompletionRequirements: normalizeCompletionRequirements(raw.pillarCompletionRequirements),
    pillarDone: raw.pillarDone === true,
    pillarNumericalTarget:
      typeof pillarTargetRaw === "number" && Number.isFinite(pillarTargetRaw) ? pillarTargetRaw : null,
    pillarNumericalValue:
      typeof pillarValueRaw === "number" && Number.isFinite(pillarValueRaw) ? pillarValueRaw : null,
    pillarDueDate: normalizeOptionalSubKpiYmd(raw.pillarDueDate),
    pillarActualDate: normalizeOptionalSubKpiYmd(raw.pillarActualDate),
    taskCount:
      typeof raw.taskCount === "number" && Number.isFinite(raw.taskCount) && Number.isInteger(raw.taskCount) && raw.taskCount >= 0
        ? raw.taskCount
        : null,
    isFieldAssignment: raw.isFieldAssignment === true,
    isProject: raw.isProject === true,
    invertedRecording: raw.invertedRecording === true,
    linkedJobOrderTicketId:
      typeof raw.linkedJobOrderTicketId === "string" && raw.linkedJobOrderTicketId.trim()
        ? raw.linkedJobOrderTicketId.trim()
        : null,
    linkedJobOrderTicketNumber:
      typeof raw.linkedJobOrderTicketNumber === "string" && raw.linkedJobOrderTicketNumber.trim()
        ? raw.linkedJobOrderTicketNumber.trim().slice(0, 64)
        : null,
  };
}

function withEnvelopeMeta(base: Prisma.InputJsonValue, meta: ReturnType<typeof rawEnvelopeMeta>): Prisma.InputJsonValue {
  if (!isPlainObject(base)) return base;
  const next: Record<string, unknown> = {
    ...(base as Record<string, unknown>),
    ...(meta.taskPriority ? { taskPriority: meta.taskPriority } : {}),
    ...(meta.pillarScreenshotsEnabled ? { pillarScreenshotsEnabled: true } : {}),
    ...(meta.pillarBeforeScreenshot.length > 0 ? { pillarBeforeScreenshot: meta.pillarBeforeScreenshot } : {}),
    ...(meta.pillarAfterScreenshot.length > 0 ? { pillarAfterScreenshot: meta.pillarAfterScreenshot } : {}),
    ...(meta.pillarScreenshotUploadEnabled ? { pillarScreenshotUploadEnabled: true } : {}),
    ...(meta.pillarScreenshot.length > 0 ? { pillarScreenshot: meta.pillarScreenshot } : {}),
    ...(meta.archivedTaskScreenshots.length > 0 ? { archivedTaskScreenshots: meta.archivedTaskScreenshots } : {}),
    ...(meta.archivedNumericalRecords.length > 0 ? { archivedNumericalRecords: meta.archivedNumericalRecords } : {}),
    ...(meta.taskDailyPenaltyAmount != null ? { taskDailyPenaltyAmount: meta.taskDailyPenaltyAmount } : {}),
    ...(meta.taskDelayPenaltyFrequency !== "DAILY"
      ? { taskDelayPenaltyFrequency: meta.taskDelayPenaltyFrequency }
      : {}),
    ...(meta.pillarCompletionRequirements
      ? { pillarCompletionRequirements: meta.pillarCompletionRequirements }
      : {}),
    ...(meta.pillarNumericalTarget != null ? { pillarNumericalTarget: meta.pillarNumericalTarget } : {}),
    ...(meta.pillarNumericalValue != null ? { pillarNumericalValue: meta.pillarNumericalValue } : {}),
    ...(meta.pillarDueDate ? { pillarDueDate: meta.pillarDueDate } : {}),
    ...(meta.pillarActualDate ? { pillarActualDate: meta.pillarActualDate } : {}),
    ...(meta.taskCount != null ? { taskCount: meta.taskCount } : {}),
    ...(meta.isFieldAssignment ? { isFieldAssignment: true } : {}),
    ...(meta.isProject ? { isProject: true } : {}),
    ...(meta.invertedRecording ? { invertedRecording: true } : {}),
    ...(meta.linkedJobOrderTicketId
      ? {
          linkedJobOrderTicketId: meta.linkedJobOrderTicketId,
          ...(meta.linkedJobOrderTicketNumber
            ? { linkedJobOrderTicketNumber: meta.linkedJobOrderTicketNumber }
            : {}),
        }
      : {}),
  };
  // Always apply pillarDone explicitly — omitting it left a prior `true` stuck on the envelope.
  if (meta.pillarDone) next.pillarDone = true;
  else delete next.pillarDone;
  return next as Prisma.InputJsonValue;
}

function stripLinkedJobOrderKeys(value: Prisma.InputJsonValue): Prisma.InputJsonValue {
  if (!isPlainObject(value)) return value;
  const next: Record<string, unknown> = { ...(value as Record<string, unknown>) };
  delete next.linkedJobOrderTicketId;
  delete next.linkedJobOrderTicketNumber;
  return next as Prisma.InputJsonValue;
}

export function getTaskTargetDueDate(raw: unknown): string | null {
  return rawEnvelopeMeta(raw).pillarDueDate;
}

/** Persist the main-task target date on the checklist envelope (used when subtasks inherit). */
export function setTaskTargetDueDate(raw: unknown, dueYmd: string | null | undefined): Prisma.InputJsonValue {
  const meta = rawEnvelopeMeta(raw);
  meta.pillarDueDate = dueYmd ? normalizeOptionalSubKpiYmd(dueYmd) : null;
  return withEnvelopeMeta(ensureEnvelope(raw), meta);
}

export function subKpiHasCustomDueDate(item: Pick<SubKpiItem, "dueDate">): boolean {
  const due = item.dueDate?.trim() ?? "";
  return Boolean(due && YMD.test(due));
}

export function subKpiDueDateRollsWithCycle(
  item: Pick<SubKpiItem, "dueDate" | "dueDateRollsWithCycle">,
): boolean {
  return item.dueDateRollsWithCycle === true && subKpiHasCustomDueDate(item);
}

/**
 * Effective target date for a sub-task:
 * - custom `dueDate` when set
 * - otherwise inherits the main task target (`pillarDueDate` / parentDueYmd)
 */
export function resolveEffectiveSubKpiDueDate(
  item: Pick<SubKpiItem, "dueDate">,
  parentDueYmd: string | null | undefined,
): { dueDate: string | null; inherits: boolean } {
  if (subKpiHasCustomDueDate(item)) {
    return { dueDate: (item.dueDate ?? "").trim(), inherits: false };
  }
  const parent = typeof parentDueYmd === "string" ? parentDueYmd.trim() : "";
  if (parent && YMD.test(parent)) {
    return { dueDate: parent, inherits: true };
  }
  return { dueDate: null, inherits: true };
}

export function taskDailyPenaltyAmountFromSubKpis(raw: unknown): number | null {
  return rawEnvelopeMeta(raw).taskDailyPenaltyAmount;
}

export function setTaskDailyPenaltyAmount(
  raw: unknown,
  amount: number | null,
): Prisma.InputJsonValue {
  const meta = rawEnvelopeMeta(raw);
  meta.taskDailyPenaltyAmount =
    typeof amount === "number" && Number.isFinite(amount) && amount >= 0 ? amount : null;
  return withEnvelopeMeta(ensureEnvelope(raw), meta);
}

export function taskDelayPenaltyFrequencyFromSubKpis(raw: unknown): DelayPenaltyFrequency {
  return rawEnvelopeMeta(raw).taskDelayPenaltyFrequency;
}

export function setTaskDelayPenaltyFrequency(
  raw: unknown,
  frequency: DelayPenaltyFrequency | null | undefined,
): Prisma.InputJsonValue {
  const meta = rawEnvelopeMeta(raw);
  meta.taskDelayPenaltyFrequency = normalizeDelayPenaltyFrequency(frequency);
  return withEnvelopeMeta(ensureEnvelope(raw), meta);
}

export function taskCountFromSubKpis(raw: unknown): number | null {
  return rawEnvelopeMeta(raw).taskCount;
}

export function setTaskCount(raw: unknown, count: number | null): Prisma.InputJsonValue {
  const meta = rawEnvelopeMeta(raw);
  meta.taskCount =
    typeof count === "number" && Number.isFinite(count) && Number.isInteger(count) && count >= 0
      ? count
      : null;
  return withEnvelopeMeta(ensureEnvelope(raw), meta);
}

export function isFieldAssignmentTask(raw: unknown): boolean {
  return rawEnvelopeMeta(raw).isFieldAssignment;
}

export function markFieldAssignmentTask(raw: unknown): Prisma.InputJsonValue {
  const meta = rawEnvelopeMeta(raw);
  meta.isFieldAssignment = true;
  meta.isProject = false;
  return withEnvelopeMeta(ensureEnvelope(raw), meta);
}

export function isProjectTask(raw: unknown): boolean {
  return rawEnvelopeMeta(raw).isProject;
}

export function markProjectTask(raw: unknown): Prisma.InputJsonValue {
  const meta = rawEnvelopeMeta(raw);
  meta.isProject = true;
  meta.isFieldAssignment = false;
  return withEnvelopeMeta(ensureEnvelope(raw), meta);
}

/** When true, unchecked items count toward 100% and checked items reduce the percent. */
export function isInvertedRecordingTask(raw: unknown): boolean {
  return rawEnvelopeMeta(raw).invertedRecording === true;
}

export function setInvertedRecording(raw: unknown, inverted: boolean): Prisma.InputJsonValue {
  const meta = rawEnvelopeMeta(raw);
  meta.invertedRecording = inverted === true;
  return withEnvelopeMeta(ensureEnvelope(raw), meta);
}

/**
 * Task uses inverted recording when the create-time flag is set, or when the
 * legacy pillar title is in the inverted checklist set.
 */
export function taskUsesInvertedRecording(opts: {
  title?: string | null;
  subKpis: unknown;
}): boolean {
  if (isInvertedRecordingTask(opts.subKpis)) return true;
  const title = opts.title?.trim();
  return Boolean(title && isInvertedChecklistPillar(title));
}

/** Apply inverted recording to raw checklist progress for metrics / donut display. */
export function progressWithInvertedRecording(
  progress: KpiChecklistProgress,
  invert: boolean,
): KpiChecklistProgress {
  if (!invert) return progress;
  const view = kpiChecklistMetricView(progress, true);
  return {
    total: view.total,
    done: view.positive,
    missing: view.negative,
    percent: view.percent,
  };
}

/** Inverted monitoring: unchecked checkbox items count as credited (safe / uptime). */
export function invertedContributorItemCredited(
  item: Pick<
    SubKpiItem,
    | "done"
    | "completionRequirements"
    | "completionMode"
    | "screenshotsEnabled"
    | "beforeScreenshot"
    | "afterScreenshot"
    | "uploadScreenshot"
    | "numericalValue"
    | "numericalTarget"
  >,
): boolean {
  const req = resolveSubKpiCompletionRequirements(item);
  if (req.checkbox) return !item.done;
  return !subKpiRequirementsMet(item);
}

/** Raw flagged/clear counts for inverted monitoring before display flip. */
export function kpiInvertedRawProgress(raw: unknown, taskTitle?: string): KpiChecklistProgress {
  const items = collectChecklistProgressItems(raw, taskTitle);
  const total = items.length;
  const flagged = items.filter((item) => Boolean(item.done)).length;
  const clear = total - flagged;
  return {
    total,
    done: flagged,
    missing: clear,
    percent: total > 0 ? Math.round((flagged / total) * 100) : 0,
  };
}

/** Checklist progress stored on period snapshots (inverted-aware). */
export function kpiSnapshotProgress(
  row: { title: string; mainTask?: string | null; subKpis: unknown },
  taskTitle?: string,
): KpiChecklistProgress {
  const label = taskTitle ?? kpiMainTaskLabel(row);
  const invert = taskUsesInvertedRecording({ title: row.title, subKpis: row.subKpis });
  if (invert) {
    return progressWithInvertedRecording(kpiInvertedRawProgress(row.subKpis, label), true);
  }
  return kpiChecklistProgress(row.subKpis, label);
}

/** True when an inverted-recording period has no flagged incidents (all clear). */
export function invertedRecordingPeriodClear(
  row: { title: string; mainTask?: string | null; subKpis: unknown },
  taskTitle?: string,
): boolean {
  if (!taskUsesInvertedRecording(row)) return false;
  const progress = kpiSnapshotProgress(row, taskTitle);
  return progress.total > 0 && progress.missing === 0;
}

export function getLinkedJobOrderFromSubKpis(
  raw: unknown,
): { ticketId: string; ticketNumber: string | null } | null {
  const meta = rawEnvelopeMeta(raw);
  if (!meta.linkedJobOrderTicketId) return null;
  return {
    ticketId: meta.linkedJobOrderTicketId,
    ticketNumber: meta.linkedJobOrderTicketNumber,
  };
}

export function setLinkedJobOrderOnSubKpis(
  raw: unknown,
  link: { ticketId: string; ticketNumber?: string | null } | null,
): Prisma.InputJsonValue {
  const meta = rawEnvelopeMeta(raw);
  if (!link?.ticketId?.trim()) {
    meta.linkedJobOrderTicketId = null;
    meta.linkedJobOrderTicketNumber = null;
    return stripLinkedJobOrderKeys(withEnvelopeMeta(ensureEnvelope(raw), meta));
  }
  meta.linkedJobOrderTicketId = link.ticketId.trim();
  meta.linkedJobOrderTicketNumber = link.ticketNumber?.trim()?.slice(0, 64) || null;
  return withEnvelopeMeta(ensureEnvelope(raw), meta);
}

export function wrapForPersistWithExistingMeta(norm: NormalizedSubKpis, raw: unknown): Prisma.InputJsonValue {
  return withEnvelopeMeta(wrapForPersist(norm), rawEnvelopeMeta(raw));
}

export function getTaskPriority(raw: unknown): SubKpiItem["projectPriority"] {
  return rawEnvelopeMeta(raw).taskPriority;
}

export function setTaskPriority(raw: unknown, priority: unknown): Prisma.InputJsonValue {
  const meta = rawEnvelopeMeta(raw);
  meta.taskPriority = normalizeSubKpiPriority(priority);
  return withEnvelopeMeta(ensureEnvelope(raw), meta);
}

export function enablePillarScreenshotUpload(raw: unknown): Prisma.InputJsonValue {
  const meta = rawEnvelopeMeta(raw);
  meta.pillarScreenshotUploadEnabled = true;
  return withEnvelopeMeta(ensureEnvelope(raw), meta);
}

export function pillarScreenshotUploadEnabled(raw: unknown): boolean {
  return rawEnvelopeMeta(raw).pillarScreenshotUploadEnabled;
}

export function getPillarScreenshotUploads(raw: unknown): TaskScreenshotMetaItem[] {
  return rawEnvelopeMeta(raw).pillarScreenshot;
}

export function setPillarScreenshotUploads(
  raw: unknown,
  screenshots: TaskScreenshotMetaItem[],
): Prisma.InputJsonValue {
  const meta = rawEnvelopeMeta(raw);
  meta.pillarScreenshotUploadEnabled = true;
  meta.pillarScreenshot = screenshots;
  return withEnvelopeMeta(ensureEnvelope(raw), meta);
}

export function removePillarScreenshotUpload(
  raw: unknown,
  storedFileName: string,
): Prisma.InputJsonValue {
  const meta = rawEnvelopeMeta(raw);
  meta.pillarScreenshot = meta.pillarScreenshot.filter((item) => item.storedFileName !== storedFileName);
  meta.pillarScreenshotUploadEnabled = true;
  return withEnvelopeMeta(ensureEnvelope(raw), meta);
}

export function getPillarCompletionRequirements(raw: unknown): SubKpiCompletionRequirements | null {
  return rawEnvelopeMeta(raw).pillarCompletionRequirements;
}

export function isPillarOnlyTask(raw: unknown): boolean {
  if (collectAllSubKpiItems(normalizeSubKpis(raw)).length > 0) return false;
  return getPillarCompletionRequirements(raw) != null;
}

/** Task completion is a single main-task row (pillar envelope or one legacy sub-task). */
export function isMainTaskOnlyRecord(
  raw: unknown,
  opts: Pick<KpiMainTaskRecord, "title" | "mainTask"> = { title: "", mainTask: null },
): boolean {
  if (isPillarOnlyTask(raw)) return true;
  const norm = normalizeSubKpis(raw);
  if (norm.segmented) return false;
  const items = collectAllSubKpiItems(norm);
  if (items.length !== 1) return false;
  if (!kpiHasDistinctMainTask(opts)) return true;
  const label = kpiMainTaskLabel(opts).trim().toLowerCase();
  return items[0].title.trim().toLowerCase() === label;
}

/** Checklist item for the main-task checkbox (virtual pillar row or single legacy item). */
export function mainTaskCheckboxItem(raw: unknown, taskTitle?: string): SubKpiItem | null {
  const virtual = pillarVirtualSubKpiItem(raw, taskTitle);
  if (virtual) return virtual;
  const norm = normalizeSubKpis(raw);
  if (norm.segmented) return null;
  const items = collectAllSubKpiItems(norm);
  return items.length === 1 ? items[0] : null;
}

/** Virtual checklist row when completion is stored on the task pillar (no sub-tasks). */
export function pillarVirtualSubKpiItem(raw: unknown, taskTitle?: string): SubKpiItem | null {
  const requirements = getPillarCompletionRequirements(raw);
  if (!requirements) return null;
  const meta = rawEnvelopeMeta(raw);
  const item: SubKpiItem = {
    id: PILLAR_ONLY_VIRTUAL_SUBKPI_ID,
    title: taskTitle?.trim() || "Task",
    done: meta.pillarDone,
    completionRequirements: requirements,
  };
  if (requirements.screenshots || meta.pillarBeforeScreenshot.length > 0 || meta.pillarAfterScreenshot.length > 0) {
    item.screenshotsEnabled = true;
    if (meta.pillarBeforeScreenshot.length > 0) item.beforeScreenshot = meta.pillarBeforeScreenshot;
    if (meta.pillarAfterScreenshot.length > 0) item.afterScreenshot = meta.pillarAfterScreenshot;
  }
  if (requirements.screenshotUpload || meta.pillarScreenshot.length > 0) {
    if (meta.pillarScreenshot.length > 0) item.uploadScreenshot = meta.pillarScreenshot;
  }
  if (meta.pillarNumericalTarget != null) item.numericalTarget = meta.pillarNumericalTarget;
  if (meta.pillarNumericalValue != null) item.numericalValue = meta.pillarNumericalValue;
  if (meta.pillarDueDate) item.dueDate = meta.pillarDueDate;
  if (meta.pillarActualDate) item.actualDate = meta.pillarActualDate;
  return item;
}

/** Sub-tasks for progress, delay, and penalties — includes a virtual pillar row when applicable. */
export function collectChecklistProgressItems(raw: unknown, taskTitle?: string): SubKpiItem[] {
  const items = collectAllSubKpiItems(normalizeSubKpis(raw));
  if (items.length > 0) return items;
  const virtual = pillarVirtualSubKpiItem(raw, taskTitle);
  return virtual ? [virtual] : [];
}

export function applyPillarOnlyTaskCreate(
  raw: Prisma.InputJsonValue,
  requirements: SubKpiCompletionRequirements,
  opts: { numericalTarget?: number | null; dueDate?: string | null } = {},
): Prisma.InputJsonValue {
  const meta = rawEnvelopeMeta(raw);
  meta.pillarCompletionRequirements = subKpiStoredCompletionRequirements(requirements);
  meta.pillarDone = false;
  if (opts.numericalTarget != null) meta.pillarNumericalTarget = opts.numericalTarget;
  const dueYmd = opts.dueDate ? normalizeOptionalSubKpiYmd(opts.dueDate) : null;
  if (dueYmd) meta.pillarDueDate = dueYmd;
  let result = withEnvelopeMeta(ensureEnvelope(raw), meta);
  if (requirements.screenshots) result = enablePillarScreenshots(result);
  if (requirements.screenshotUpload) result = enablePillarScreenshotUpload(result);
  return result;
}

export function setPillarDone(raw: unknown, done: boolean): Prisma.InputJsonValue {
  const meta = rawEnvelopeMeta(raw);
  meta.pillarDone = done;
  return withEnvelopeMeta(ensureEnvelope(raw), meta);
}

export function setPillarWorkMeta(
  raw: unknown,
  patch: {
    dueDate?: string | null;
    actualDate?: string | null;
    numericalTarget?: number | null;
    numericalValue?: number | null;
  },
): Prisma.InputJsonValue {
  const meta = rawEnvelopeMeta(raw);
  if (patch.dueDate !== undefined) {
    meta.pillarDueDate = patch.dueDate ? normalizeOptionalSubKpiYmd(patch.dueDate) : null;
  }
  if (patch.actualDate !== undefined) {
    meta.pillarActualDate = patch.actualDate ? normalizeOptionalSubKpiYmd(patch.actualDate) : null;
  }
  if (patch.numericalTarget !== undefined) {
    meta.pillarNumericalTarget =
      patch.numericalTarget != null && Number.isFinite(patch.numericalTarget)
        ? patch.numericalTarget
        : null;
  }
  if (patch.numericalValue !== undefined) {
    meta.pillarNumericalValue =
      patch.numericalValue != null && Number.isFinite(patch.numericalValue)
        ? patch.numericalValue
        : null;
  }
  return withEnvelopeMeta(ensureEnvelope(raw), meta);
}

export function syncPillarDoneFromRequirements(raw: unknown): Prisma.InputJsonValue {
  const virtual = pillarVirtualSubKpiItem(raw);
  if (!virtual) return raw as Prisma.InputJsonValue;
  const shouldBeDone = subKpiRequirementsMet(virtual);
  const meta = rawEnvelopeMeta(raw);
  if (Boolean(meta.pillarDone) === shouldBeDone) return raw as Prisma.InputJsonValue;
  return setPillarDone(raw, shouldBeDone);
}

export function enablePillarScreenshots(raw: unknown): Prisma.InputJsonValue {
  const meta = rawEnvelopeMeta(raw);
  meta.pillarScreenshotsEnabled = true;
  return withEnvelopeMeta(ensureEnvelope(raw), meta);
}

export function pillarScreenshotsEnabled(raw: unknown): boolean {
  return rawEnvelopeMeta(raw).pillarScreenshotsEnabled;
}

export function getPillarScreenshots(raw: unknown, slot: TaskScreenshotSlot): TaskScreenshotMetaItem[] {
  const meta = rawEnvelopeMeta(raw);
  if (slot === "general") return meta.pillarScreenshot;
  return slot === "before" ? meta.pillarBeforeScreenshot : meta.pillarAfterScreenshot;
}

export function getArchivedTaskScreenshots(raw: unknown): ArchivedTaskScreenshotSet[] {
  return rawEnvelopeMeta(raw).archivedTaskScreenshots;
}

export function getArchivedNumericalRecords(raw: unknown): ArchivedNumericalRecordSet[] {
  return rawEnvelopeMeta(raw).archivedNumericalRecords;
}

/** Past-cycle numerical entries for one sub-task (newest archive last). */
export function archivedNumericalEntriesForSubKpi(
  raw: unknown,
  subKpiId: string,
): Array<{
  archivedAt: string;
  numericalTarget: number | null;
  numericalValue: number | null;
}> {
  const out: Array<{
    archivedAt: string;
    numericalTarget: number | null;
    numericalValue: number | null;
  }> = [];
  for (const archive of getArchivedNumericalRecords(raw)) {
    const row = archive.subTasks.find((it) => it.id === subKpiId);
    if (!row) continue;
    const target =
      typeof row.numericalTarget === "number" && Number.isFinite(row.numericalTarget)
        ? row.numericalTarget
        : null;
    const value =
      typeof row.numericalValue === "number" && Number.isFinite(row.numericalValue)
        ? row.numericalValue
        : null;
    if (target == null && value == null) continue;
    out.push({ archivedAt: archive.archivedAt, numericalTarget: target, numericalValue: value });
  }
  return out;
}

/**
 * True when this checklist has completed at least one prior numerical cycle
 * (archives written on rollover). Used to unlock target edits for the current period only.
 * Detection is task-level: any archive means the task has recurred.
 */
export function hasRecurredNumericalCycle(raw: unknown, _subKpiId?: string): boolean {
  return getArchivedNumericalRecords(raw).length > 0;
}

/**
 * Whether the numerical target may be set or changed for the active period
 * while the task is running. Edits apply to the current period only; prior
 * periods stay in archives after rollover.
 */
export function canAdjustNumericalTarget(_opts: {
  isRecurring: boolean;
  subKpisRaw: unknown;
  subKpiId?: string;
}): boolean {
  return true;
}

export function setPillarScreenshots(
  raw: unknown,
  slot: TaskScreenshotSlot,
  screenshots: TaskScreenshotMetaItem[],
): Prisma.InputJsonValue {
  const meta = rawEnvelopeMeta(raw);
  meta.pillarScreenshotsEnabled = true;
  if (slot === "general") {
    meta.pillarScreenshotUploadEnabled = true;
    meta.pillarScreenshot = screenshots;
  } else if (slot === "before") meta.pillarBeforeScreenshot = screenshots;
  else meta.pillarAfterScreenshot = screenshots;
  return withEnvelopeMeta(ensureEnvelope(raw), meta);
}

export function removePillarScreenshot(
  raw: unknown,
  slot: TaskScreenshotSlot,
  storedFileName: string,
): Prisma.InputJsonValue {
  const meta = rawEnvelopeMeta(raw);
  if (slot === "general") {
    meta.pillarScreenshot = meta.pillarScreenshot.filter((item) => item.storedFileName !== storedFileName);
    meta.pillarScreenshotUploadEnabled = true;
  } else {
    const next =
      slot === "before"
        ? meta.pillarBeforeScreenshot.filter((item) => item.storedFileName !== storedFileName)
        : meta.pillarAfterScreenshot.filter((item) => item.storedFileName !== storedFileName);
    if (slot === "before") meta.pillarBeforeScreenshot = next;
    else meta.pillarAfterScreenshot = next;
    meta.pillarScreenshotsEnabled = true;
  }
  return withEnvelopeMeta(ensureEnvelope(raw), meta);
}

/** Migrate legacy array to envelope (optional, for consistency). */
export function ensureEnvelope(raw: unknown): Prisma.InputJsonValue {
  // IT Project envelopes must keep kind/phases/items — normalizeSubKpis would wipe them.
  if (isItProjectEnvelope(raw)) {
    const wrapped = wrapItProjectSubKpisPreserve(raw);
    return withEnvelopeMeta(wrapped, rawEnvelopeMeta(raw));
  }
  const n = normalizeSubKpis(raw);
  return wrapForPersistWithExistingMeta(n, raw);
}

/** Re-wrap IT project JSON without going through checklist normalize (avoids circular import issues at call sites). */
function wrapItProjectSubKpisPreserve(raw: unknown): Prisma.InputJsonValue {
  return wrapItProjectSubKpis(parseItProjectSubKpis(raw));
}

function parseArchivedTaskScreenshotSets(raw: unknown): ArchivedTaskScreenshotSet[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry): ArchivedTaskScreenshotSet | null => {
      if (!isPlainObject(entry)) return null;
      const subTasks = Array.isArray(entry.subTasks)
        ? entry.subTasks
            .map((it): ArchivedTaskScreenshotSet["subTasks"][number] | null => {
              if (!isPlainObject(it)) return null;
              const id = typeof it.id === "string" ? it.id : "";
              const title = typeof it.title === "string" ? it.title : "";
              const beforeScreenshot = parseTaskScreenshotMetaList(it.beforeScreenshot);
              const afterScreenshot = parseTaskScreenshotMetaList(it.afterScreenshot);
              const uploadScreenshot = parseTaskScreenshotMetaList(it.uploadScreenshot);
              if (
                !id ||
                (beforeScreenshot.length === 0 &&
                  afterScreenshot.length === 0 &&
                  uploadScreenshot.length === 0)
              ) {
                return null;
              }
              return {
                id,
                title,
                ...(beforeScreenshot.length > 0 ? { beforeScreenshot } : {}),
                ...(afterScreenshot.length > 0 ? { afterScreenshot } : {}),
                ...(uploadScreenshot.length > 0 ? { uploadScreenshot } : {}),
              };
            })
            .filter((it): it is ArchivedTaskScreenshotSet["subTasks"][number] => it != null)
        : [];
      const pillarBeforeScreenshot = parseTaskScreenshotMetaList(entry.pillarBeforeScreenshot);
      const pillarAfterScreenshot = parseTaskScreenshotMetaList(entry.pillarAfterScreenshot);
      const pillarScreenshot = parseTaskScreenshotMetaList(entry.pillarScreenshot);
      if (
        subTasks.length === 0 &&
        pillarBeforeScreenshot.length === 0 &&
        pillarAfterScreenshot.length === 0 &&
        pillarScreenshot.length === 0
      ) {
        return null;
      }
      return {
        archivedAt: typeof entry.archivedAt === "string" ? entry.archivedAt : new Date().toISOString(),
        subTasks,
        ...(pillarBeforeScreenshot.length > 0 ? { pillarBeforeScreenshot } : {}),
        ...(pillarAfterScreenshot.length > 0 ? { pillarAfterScreenshot } : {}),
        ...(pillarScreenshot.length > 0 ? { pillarScreenshot } : {}),
      };
    })
    .filter((entry): entry is ArchivedTaskScreenshotSet => entry != null);
}

function parseArchivedNumericalRecordSets(raw: unknown): ArchivedNumericalRecordSet[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry): ArchivedNumericalRecordSet | null => {
      if (!isPlainObject(entry)) return null;
      const subTasks = Array.isArray(entry.subTasks)
        ? entry.subTasks
            .map((it): ArchivedNumericalRecordSet["subTasks"][number] | null => {
              if (!isPlainObject(it)) return null;
              const id = typeof it.id === "string" ? it.id : "";
              const title = typeof it.title === "string" ? it.title : "";
              const targetRaw = it.numericalTarget;
              const valueRaw = it.numericalValue;
              const numericalTarget =
                typeof targetRaw === "number" && Number.isFinite(targetRaw) ? targetRaw : null;
              const numericalValue =
                typeof valueRaw === "number" && Number.isFinite(valueRaw) ? valueRaw : null;
              if (!id || (numericalTarget == null && numericalValue == null)) return null;
              return {
                id,
                title,
                ...(numericalTarget != null ? { numericalTarget } : {}),
                ...(numericalValue != null ? { numericalValue } : {}),
              };
            })
            .filter((it): it is ArchivedNumericalRecordSet["subTasks"][number] => it != null)
        : [];
      if (subTasks.length === 0) return null;
      return {
        archivedAt: typeof entry.archivedAt === "string" ? entry.archivedAt : new Date().toISOString(),
        subTasks,
      };
    })
    .filter((entry): entry is ArchivedNumericalRecordSet => entry != null);
}

function archiveScreenshotsForReset(raw: unknown, norm: NormalizedSubKpis): ReturnType<typeof rawEnvelopeMeta> {
  const meta = rawEnvelopeMeta(raw);
  const subTasks = collectAllSubKpiItems(norm)
    .map((it) => {
      const beforeScreenshot = it.beforeScreenshot ?? [];
      const afterScreenshot = it.afterScreenshot ?? [];
      const uploadScreenshot = it.uploadScreenshot ?? [];
      if (beforeScreenshot.length === 0 && afterScreenshot.length === 0 && uploadScreenshot.length === 0) {
        return null;
      }
      return {
        id: it.id,
        title: it.title,
        ...(beforeScreenshot.length > 0 ? { beforeScreenshot } : {}),
        ...(afterScreenshot.length > 0 ? { afterScreenshot } : {}),
        ...(uploadScreenshot.length > 0 ? { uploadScreenshot } : {}),
      };
    })
    .filter((it): it is ArchivedTaskScreenshotSet["subTasks"][number] => it != null);
  if (
    subTasks.length > 0 ||
    meta.pillarBeforeScreenshot.length > 0 ||
    meta.pillarAfterScreenshot.length > 0 ||
    meta.pillarScreenshot.length > 0
  ) {
    meta.archivedTaskScreenshots = [
      ...meta.archivedTaskScreenshots,
      {
        archivedAt: new Date().toISOString(),
        subTasks,
        ...(meta.pillarBeforeScreenshot.length > 0 ? { pillarBeforeScreenshot: meta.pillarBeforeScreenshot } : {}),
        ...(meta.pillarAfterScreenshot.length > 0 ? { pillarAfterScreenshot: meta.pillarAfterScreenshot } : {}),
        ...(meta.pillarScreenshot.length > 0 ? { pillarScreenshot: meta.pillarScreenshot } : {}),
      },
    ];
    meta.pillarBeforeScreenshot = [];
    meta.pillarAfterScreenshot = [];
    meta.pillarScreenshot = [];
  }
  return meta;
}

function archiveNumericalRecordsForReset(
  meta: ReturnType<typeof rawEnvelopeMeta>,
  norm: NormalizedSubKpis,
): ReturnType<typeof rawEnvelopeMeta> {
  const subTasks: ArchivedNumericalRecordSet["subTasks"] = [];
  for (const it of collectAllSubKpiItems(norm)) {
    const req = resolveSubKpiCompletionRequirements(it);
    if (!subKpiRequiresNumerical(req)) continue;
    const numericalTarget =
      typeof it.numericalTarget === "number" && Number.isFinite(it.numericalTarget)
        ? it.numericalTarget
        : null;
    const numericalValue =
      typeof it.numericalValue === "number" && Number.isFinite(it.numericalValue)
        ? it.numericalValue
        : null;
    if (numericalTarget == null && numericalValue == null) continue;
    subTasks.push({
      id: it.id,
      title: it.title,
      ...(numericalTarget != null ? { numericalTarget } : {}),
      ...(numericalValue != null ? { numericalValue } : {}),
    });
  }
  if (meta.pillarCompletionRequirements && subKpiRequiresNumerical(meta.pillarCompletionRequirements)) {
    const numericalTarget = meta.pillarNumericalTarget;
    const numericalValue = meta.pillarNumericalValue;
    if (numericalTarget != null || numericalValue != null) {
      subTasks.push({
        id: PILLAR_ONLY_VIRTUAL_SUBKPI_ID,
        title: "Task",
        ...(numericalTarget != null ? { numericalTarget } : {}),
        ...(numericalValue != null ? { numericalValue } : {}),
      });
    }
  }
  if (subTasks.length > 0) {
    meta.archivedNumericalRecords = [
      ...meta.archivedNumericalRecords,
      {
        archivedAt: new Date().toISOString(),
        subTasks,
      },
    ];
  }
  return meta;
}

function clearPillarForReset(meta: ReturnType<typeof rawEnvelopeMeta>): ReturnType<typeof rawEnvelopeMeta> {
  meta.pillarDone = false;
  meta.pillarNumericalValue = null;
  // Keep pillarNumericalTarget across cycles — it stays locked until post-recurrence admin adjust.
  return meta;
}

function clearActiveSubKpiForReset(
  it: SubKpiItem,
  opts?: {
    frequency?: KpiFrequencyCode | null;
    timeZone?: string;
    advanceSteps?: number;
  },
): SubKpiItem {
  let next = { ...it, done: false };
  delete next.beforeScreenshot;
  delete next.afterScreenshot;
  delete next.uploadScreenshot;
  const req = resolveSubKpiCompletionRequirements(it);
  if (subKpiRequiresNumerical(req)) {
    // Clear actual only; target carries into the next period (adjustable after ≥1 recurrence).
    delete next.numericalValue;
  }
  if (
    subKpiDueDateRollsWithCycle(next) &&
    opts?.frequency &&
    typeof opts.advanceSteps === "number" &&
    opts.advanceSteps > 0
  ) {
    const zone = normalizeTimeZone(opts.timeZone);
    let due = (next.dueDate ?? "").trim();
    for (let i = 0; i < opts.advanceSteps; i += 1) {
      const advanced = advanceDueDateYmdForFrequency(due, opts.frequency, zone);
      if (!advanced) break;
      due = advanced;
    }
    next = { ...next, dueDate: due, dueDateRollsWithCycle: true };
  }
  return next;
}

export type ResetSubKpiDoneOptions = {
  frequency?: KpiFrequencyCode | null;
  recurrenceWeekday?: number | null;
  recurrenceMonthDay?: number | null;
  timeZone?: string;
  /** Previous cycle start — used with `toCycleStart` to advance rolling due dates by N periods. */
  fromCycleStart?: Date | null;
  /** New cycle start after rollover. */
  toCycleStart?: Date | null;
};

export function resetAllSubKpiDone(
  raw: unknown,
  opts?: ResetSubKpiDoneOptions,
): Prisma.InputJsonValue {
  const frequency = opts?.frequency ?? null;
  const zone = normalizeTimeZone(opts?.timeZone);
  let advanceSteps = 0;
  if (
    frequency &&
    opts?.fromCycleStart &&
    opts?.toCycleStart &&
    Number.isFinite(opts.fromCycleStart.getTime()) &&
    Number.isFinite(opts.toCycleStart.getTime())
  ) {
    advanceSteps = countRecurrencePeriodsBetween(
      opts.fromCycleStart,
      opts.toCycleStart,
      frequency,
      opts.recurrenceWeekday,
      opts.recurrenceMonthDay,
      zone,
    );
  }
  const clearOpts =
    advanceSteps > 0 && frequency
      ? { frequency, timeZone: zone, advanceSteps }
      : undefined;

  const n = normalizeSubKpis(raw);
  let meta = archiveScreenshotsForReset(raw, n);
  meta = archiveNumericalRecordsForReset(meta, n);
  meta = clearPillarForReset(meta);
  if (n.segmented) {
    const segments = n.segments.map((seg) => ({
      ...seg,
      items: seg.items.map((it) => clearActiveSubKpiForReset(it, clearOpts)),
    }));
    return withEnvelopeMeta(wrapForPersist({ segmented: true, segments }), meta);
  }
  const flat = n.flat.map((it) => clearActiveSubKpiForReset(it, clearOpts));
  return withEnvelopeMeta(wrapForPersist({ segmented: false, flat }), meta);
}

export function setSubKpiItemDone(
  raw: unknown,
  subKpiId: string,
  done: boolean,
  opts?: { verificationEnabled?: boolean },
): Prisma.InputJsonValue {
  if (subKpiId === PILLAR_ONLY_VIRTUAL_SUBKPI_ID && isPillarOnlyTask(raw)) {
    // Pillar completion has no per-item verification fields; card-level patch
    // decides Done vs pending. When verification is off, mark done and rely on
    // checklistFullyComplete(verificationEnabled: false) + approveCompletionDbPatch.
    return setPillarDone(raw, done);
  }
  const n = normalizeSubKpis(raw);
  const touch = (it: SubKpiItem): SubKpiItem => {
    if (it.id !== subKpiId) return it;
    return done
      ? applySubKpiSubmitForVerification(it, { verificationEnabled: opts?.verificationEnabled })
      : applySubKpiClearVerification(it);
  };
  if (n.segmented) {
    const segments = n.segments.map((seg) => ({
      ...seg,
      items: seg.items.map(touch),
    }));
    return wrapForPersistWithExistingMeta({ segmented: true, segments }, raw);
  }
  const flat = n.flat.map(touch);
  return wrapForPersistWithExistingMeta({ segmented: false, flat }, raw);
}

export function subKpiAssignedAgentId(item: SubKpiItem): string | null {
  const id = item.assignedAgentId?.trim();
  return id ? id : null;
}

/** Match sub-task assignee to the signed-in operator by Agent id or display name. */
export function subKpiAssignedToOperator(
  item: SubKpiItem,
  operator: { id?: string | null; name?: string | null },
): boolean {
  const operatorId = operator.id?.trim();
  const subAssigneeId = subKpiAssignedAgentId(item);
  if (operatorId && subAssigneeId === operatorId) return true;
  const operatorName = (operator.name ?? "").trim();
  const subAssigneeName = (item.assignedAgentName ?? "").trim();
  if (!operatorName || !subAssigneeName) return false;
  return normalizePersonName(operatorName) === normalizePersonName(subAssigneeName);
}

export const SUB_KPI_PROGRESS_MISMATCH_WARNING =
  "If you check this it will not record to your own progress";

export type SubKpiProgressOwner = {
  id: string;
  name: string;
  role: "Assignee" | "Sub-assignee" | "Unassigned";
};

/** Single contributor credited for a sub-task in personal KPI metrics. */
export function subKpiProgressOwner(
  item: SubKpiItem,
  parentAssignee?: { id: string; name: string } | null,
): SubKpiProgressOwner {
  const subAssigneeId = subKpiAssignedAgentId(item);
  const parentAssigneeId = parentAssignee?.id?.trim() || "";
  if (subAssigneeId) {
    return {
      id: subAssigneeId,
      name: item.assignedAgentName?.trim() || parentAssignee?.name?.trim() || "Assigned user",
      role: subAssigneeId === parentAssigneeId ? "Assignee" : "Sub-assignee",
    };
  }
  if (parentAssigneeId) {
    return {
      id: parentAssigneeId,
      name: parentAssignee?.name?.trim() || "Assigned user",
      role: "Assignee",
    };
  }
  return { id: "__unassigned__", name: "Unassigned", role: "Unassigned" };
}

export function operatorIsMainKpiAssignee(
  parentAssignee: { id: string; name: string } | null | undefined,
  operator: { id?: string | null; name?: string | null },
): boolean {
  const parentId = parentAssignee?.id?.trim() || "";
  if (!parentId) return false;
  if (operator.id?.trim() === parentId) return true;
  const parentName = (parentAssignee?.name ?? "").trim();
  const operatorName = (operator.name ?? "").trim();
  if (!parentName || !operatorName) return false;
  return normalizePersonName(parentName) === normalizePersonName(operatorName);
}

export function operatorOwnsSubKpiProgress(
  item: SubKpiItem,
  parentAssignee: { id: string; name: string } | null | undefined,
  operator: { id?: string | null; name?: string | null },
): boolean {
  const owner = subKpiProgressOwner(item, parentAssignee);
  if (owner.id === "__unassigned__") return false;
  if (operator.id?.trim() && owner.id === operator.id.trim()) return true;
  const operatorName = (operator.name ?? "").trim();
  const ownerName = owner.name.trim();
  if (!operatorName || !ownerName) return false;
  return normalizePersonName(operatorName) === normalizePersonName(ownerName);
}

/** True when the signed-in operator can check the box but progress credits another assignee. */
export function subKpiProgressMismatchWarning(
  item: SubKpiItem,
  parentAssignee: { id: string; name: string } | null | undefined,
  operator: { id?: string | null; name?: string | null },
): boolean {
  if (!operator.id && !operator.name?.trim()) return false;
  return !operatorOwnsSubKpiProgress(item, parentAssignee, operator);
}

export function hasSubKpiAssignedTo(raw: unknown, agentId: string | null | undefined): boolean {
  const id = agentId?.trim();
  if (!id) return false;
  const items = isItProjectEnvelope(raw)
    ? itProjectAllItems(parseItProjectSubKpis(raw))
    : collectAllSubKpiItems(normalizeSubKpis(raw));
  return items.some((it) => subKpiAssignedAgentId(it) === id);
}

export function setSubKpiItemAssignee(
  raw: unknown,
  subKpiId: string,
  assignee: { id: string; name: string } | null,
): Prisma.InputJsonValue {
  const n = normalizeSubKpis(raw);
  const touch = (it: SubKpiItem): SubKpiItem => {
    if (it.id !== subKpiId) return it;
    const next = { ...it };
    if (assignee) {
      next.assignedAgentId = assignee.id;
      next.assignedAgentName = assignee.name;
    } else {
      delete next.assignedAgentId;
      delete next.assignedAgentName;
    }
    return next;
  };
  if (n.segmented) {
    const segments = n.segments.map((seg) => ({
      ...seg,
      items: seg.items.map(touch),
    }));
    return wrapForPersistWithExistingMeta({ segmented: true, segments }, raw);
  }
  const flat = n.flat.map(touch);
  return wrapForPersistWithExistingMeta({ segmented: false, flat }, raw);
}

export function setSubKpiItemAssistanceRequested(
  raw: unknown,
  subKpiId: string,
  byAgentId: string,
  atIso: string = new Date().toISOString(),
): Prisma.InputJsonValue | null {
  return setSubKpiItemsAssistanceRequested(raw, [subKpiId], byAgentId, atIso);
}

/** Mark Seek Assistance on one or more sub-tasks. Returns null if any id is missing. */
export function setSubKpiItemsAssistanceRequested(
  raw: unknown,
  subKpiIds: string[],
  byAgentId: string,
  atIso: string = new Date().toISOString(),
): Prisma.InputJsonValue | null {
  const idSet = new Set(subKpiIds.map((id) => String(id ?? "").trim()).filter(Boolean));
  if (idSet.size === 0) return null;
  const n = normalizeSubKpis(raw);
  const found = new Set<string>();
  const touch = (it: SubKpiItem): SubKpiItem => {
    if (!idSet.has(it.id)) return it;
    found.add(it.id);
    if (it.assistanceRequested) return it;
    return {
      ...it,
      assistanceRequested: true,
      assistanceRequestedAt: atIso,
      assistanceRequestedBy: byAgentId,
    };
  };
  if (n.segmented) {
    const segments = n.segments.map((seg) => ({
      ...seg,
      items: seg.items.map(touch),
    }));
    if (found.size !== idSet.size) return null;
    return wrapForPersistWithExistingMeta({ segmented: true, segments }, raw);
  }
  const flat = n.flat.map(touch);
  if (found.size !== idSet.size) return null;
  return wrapForPersistWithExistingMeta({ segmented: false, flat }, raw);
}

export function setSubKpiItemScreenshots(
  raw: unknown,
  subKpiId: string,
  slot: TaskScreenshotSlot,
  screenshots: TaskScreenshotMetaItem[],
): Prisma.InputJsonValue {
  const n = normalizeSubKpis(raw);
  const key =
    slot === "before" ? "beforeScreenshot" : slot === "after" ? "afterScreenshot" : "uploadScreenshot";
  const touch = (it: SubKpiItem): SubKpiItem =>
    it.id === subKpiId ? { ...it, [key]: screenshots } : it;
  if (n.segmented) {
    return wrapForPersistWithExistingMeta({
      segmented: true,
      segments: n.segments.map((seg) => ({ ...seg, items: seg.items.map(touch) })),
    }, raw);
  }
  return wrapForPersistWithExistingMeta({ segmented: false, flat: n.flat.map(touch) }, raw);
}

export function removeSubKpiItemScreenshot(
  raw: unknown,
  subKpiId: string,
  slot: TaskScreenshotSlot,
  storedFileName: string,
): Prisma.InputJsonValue {
  const n = normalizeSubKpis(raw);
  const key =
    slot === "before" ? "beforeScreenshot" : slot === "after" ? "afterScreenshot" : "uploadScreenshot";
  const touch = (it: SubKpiItem): SubKpiItem => {
    if (it.id !== subKpiId) return it;
    const nextScreenshots = (it[key] ?? []).filter((item) => item.storedFileName !== storedFileName);
    return { ...it, [key]: nextScreenshots };
  };
  if (n.segmented) {
    return wrapForPersistWithExistingMeta({
      segmented: true,
      segments: n.segments.map((seg) => ({ ...seg, items: seg.items.map(touch) })),
    }, raw);
  }
  return wrapForPersistWithExistingMeta({ segmented: false, flat: n.flat.map(touch) }, raw);
}

/** When marking an IT Project sub-task done, default actual date to today (timezone) if unset. Clears actual date when unchecked. */
export function applyItProjectSubTaskDoneMeta(
  raw: unknown,
  subKpiId: string,
  done: boolean,
  timeZone: string,
): Prisma.InputJsonValue {
  const n = normalizeSubKpis(raw);
  const zone = normalizeTimeZone(timeZone);
  const today =
    DateTime.now().setZone(zone).toISODate() ?? DateTime.utc().toISODate() ?? undefined;
  const touch = (it: SubKpiItem): SubKpiItem => {
    if (it.id !== subKpiId) return it;
    if (!done) {
      const next = { ...it, done: false };
      delete (next as { actualDate?: string }).actualDate;
      return next;
    }
    const hasActual = Boolean(it.actualDate?.trim());
    return {
      ...it,
      done: true,
      ...(!hasActual && today ? { actualDate: today } : {}),
    };
  };
  if (n.segmented) {
    const segments = n.segments.map((seg) => ({
      ...seg,
      items: seg.items.map(touch),
    }));
    return wrapForPersistWithExistingMeta({ segmented: true, segments }, raw);
  }
  const flat = n.flat.map(touch);
  return wrapForPersistWithExistingMeta({ segmented: false, flat }, raw);
}

export function setSubKpiItemScheduleMeta(
  raw: unknown,
  subKpiId: string,
  meta: { startDate?: string | null; dueDate?: string | null; actualDate?: string | null },
): Prisma.InputJsonValue {
  const n = normalizeSubKpis(raw);
  const start =
    meta.startDate === undefined ? undefined : normalizeOptionalSubKpiYmd(meta.startDate) ?? null;
  const due =
    meta.dueDate === undefined ? undefined : normalizeOptionalSubKpiYmd(meta.dueDate) ?? null;
  const act =
    meta.actualDate === undefined ? undefined : normalizeOptionalSubKpiYmd(meta.actualDate) ?? null;
  const touch = (it: SubKpiItem): SubKpiItem => {
    if (it.id !== subKpiId) return it;
    let next = { ...it };
    if (start !== undefined) {
      if (start) next = { ...next, startDate: start };
      else {
        delete (next as { startDate?: string }).startDate;
      }
    }
    if (due !== undefined) {
      if (due) next = { ...next, dueDate: due };
      else {
        delete (next as { dueDate?: string }).dueDate;
      }
    }
    if (act !== undefined) {
      if (act) next = { ...next, actualDate: act };
      else {
        delete (next as { actualDate?: string }).actualDate;
      }
    }
    return next;
  };
  if (n.segmented) {
    const segments = n.segments.map((seg) => ({
      ...seg,
      items: seg.items.map(touch),
    }));
    return wrapForPersistWithExistingMeta({ segmented: true, segments }, raw);
  }
  const flat = n.flat.map(touch);
  return wrapForPersistWithExistingMeta({ segmented: false, flat }, raw);
}

export function setSubKpiItemWorkMeta(
  raw: unknown,
  subKpiId: string,
  meta: {
    startDate?: string | null;
    dueDate?: string | null;
    actualDate?: string | null;
    location?: string | null;
    projectPriority?: string | null;
    numericalValue?: number | null;
    numericalTarget?: number | null;
    remarks?: string | null;
  },
): Prisma.InputJsonValue {
  if (subKpiId === PILLAR_ONLY_VIRTUAL_SUBKPI_ID && isPillarOnlyTask(raw)) {
    return setPillarWorkMeta(raw, {
      dueDate: meta.dueDate,
      actualDate: meta.actualDate,
      numericalValue: meta.numericalValue,
      numericalTarget: meta.numericalTarget,
    });
  }
  const n = normalizeSubKpis(raw);
  const start =
    meta.startDate === undefined ? undefined : normalizeOptionalSubKpiYmd(meta.startDate) ?? null;
  const due =
    meta.dueDate === undefined ? undefined : normalizeOptionalSubKpiYmd(meta.dueDate) ?? null;
  const act =
    meta.actualDate === undefined ? undefined : normalizeOptionalSubKpiYmd(meta.actualDate) ?? null;
  const location =
    meta.location === undefined
      ? undefined
      : typeof meta.location === "string" && meta.location.trim()
        ? meta.location.trim().slice(0, 160)
        : null;
  const projectPriority =
    meta.projectPriority === undefined ? undefined : normalizeSubKpiPriority(meta.projectPriority);
  const touch = (it: SubKpiItem): SubKpiItem => {
    if (it.id !== subKpiId) return it;
    let next = { ...it };
    if (start !== undefined) {
      if (start) next = { ...next, startDate: start };
      else delete (next as { startDate?: string }).startDate;
    }
    if (due !== undefined) {
      if (due) next = { ...next, dueDate: due };
      else delete (next as { dueDate?: string }).dueDate;
    }
    if (act !== undefined) {
      if (act) next = { ...next, actualDate: act };
      else delete (next as { actualDate?: string }).actualDate;
    }
    if (location !== undefined) {
      if (location) next = { ...next, location };
      else delete (next as { location?: string }).location;
    }
    if (projectPriority !== undefined) {
      if (projectPriority) next = { ...next, projectPriority };
      else delete (next as { projectPriority?: SubKpiItem["projectPriority"] }).projectPriority;
    }
    if (meta.numericalValue !== undefined) {
      if (meta.numericalValue != null && Number.isFinite(meta.numericalValue)) {
        next = { ...next, numericalValue: meta.numericalValue };
      } else {
        delete (next as { numericalValue?: number }).numericalValue;
      }
    }
    if (meta.numericalTarget !== undefined) {
      if (meta.numericalTarget != null && Number.isFinite(meta.numericalTarget)) {
        next = { ...next, numericalTarget: meta.numericalTarget };
      } else {
        delete (next as { numericalTarget?: number }).numericalTarget;
      }
    }
    if (meta.remarks !== undefined) {
      const remarks = normalizeSubKpiRemarks(meta.remarks);
      if (remarks) next = { ...next, remarks };
      else delete (next as { remarks?: string }).remarks;
    }
    return next;
  };
  if (n.segmented) {
    const segments = n.segments.map((seg) => ({
      ...seg,
      items: seg.items.map(touch),
    }));
    return wrapForPersistWithExistingMeta({ segmented: true, segments }, raw);
  }
  const flat = n.flat.map(touch);
  return wrapForPersistWithExistingMeta({ segmented: false, flat }, raw);
}

export function markEverySubKpiDone(
  raw: unknown,
  done: boolean,
  opts?: { verificationEnabled?: boolean },
): Prisma.InputJsonValue {
  if (isPillarOnlyTask(raw)) {
    return setPillarDone(raw, done);
  }
  const n = normalizeSubKpis(raw);
  const touch = (it: SubKpiItem): SubKpiItem =>
    done
      ? applySubKpiSubmitForVerification(it, { verificationEnabled: opts?.verificationEnabled })
      : applySubKpiClearVerification(it);
  if (n.segmented) {
    const segments = n.segments.map((seg) => ({
      ...seg,
      items: seg.items.map(touch),
    }));
    return wrapForPersistWithExistingMeta({ segmented: true, segments }, raw);
  }
  const flat = n.flat.map(touch);
  return wrapForPersistWithExistingMeta({ segmented: false, flat }, raw);
}

/** Persist verification fields for legacy done items (and return whether anything changed). */
export function coerceSubKpisVerificationJson(
  raw: unknown,
  opts?: { parentCardEffectivelyVerified?: boolean },
): { json: Prisma.InputJsonValue; changed: boolean; hasPending: boolean } {
  const parentVerified = Boolean(opts?.parentCardEffectivelyVerified);
  const n = normalizeSubKpis(raw);
  let changed = false;
  let hasPending = false;
  const touch = (it: SubKpiItem): SubKpiItem => {
    const coerced = coerceSubKpiItemVerificationStatus(it, {
      parentCardEffectivelyVerified: parentVerified,
    });
    if (coerced.changed) changed = true;
    const next = coerced.item;
    if (
      next.done &&
      (next.completionVerificationStatus === "PENDING_VERIFICATION" ||
        (!next.completionVerificationStatus && !parentVerified))
    ) {
      hasPending = true;
    } else if (next.completionVerificationStatus === "PENDING_VERIFICATION") {
      hasPending = true;
    }
    return next;
  };
  if (n.segmented) {
    const segments = n.segments.map((seg) => ({
      ...seg,
      items: seg.items.map(touch),
    }));
    return {
      json: wrapForPersistWithExistingMeta({ segmented: true, segments }, raw),
      changed,
      hasPending,
    };
  }
  const flat = n.flat.map(touch);
  return {
    json: wrapForPersistWithExistingMeta({ segmented: false, flat }, raw),
    changed,
    hasPending,
  };
}

export function mapSubKpiItems(
  raw: unknown,
  touch: (item: SubKpiItem) => SubKpiItem,
): Prisma.InputJsonValue {
  const n = normalizeSubKpis(raw);
  if (n.segmented) {
    const segments = n.segments.map((seg) => ({
      ...seg,
      items: seg.items.map(touch),
    }));
    return wrapForPersistWithExistingMeta({ segmented: true, segments }, raw);
  }
  return wrapForPersistWithExistingMeta({ segmented: false, flat: n.flat.map(touch) }, raw);
}

export function findSubKpiItem(raw: unknown, subKpiId: string): SubKpiItem | null {
  return collectAllSubKpiItems(normalizeSubKpis(raw)).find((it) => it.id === subKpiId) ?? null;
}

/** Sub-tasks waiting on department-head approval (client + server safe). */
export function listPendingVerificationSubKpiItems(
  raw: unknown,
  opts?: { taskTitle?: string; parentCardEffectivelyVerified?: boolean },
): SubKpiItem[] {
  const parentVerified = Boolean(opts?.parentCardEffectivelyVerified);
  return collectChecklistProgressItems(raw, opts?.taskTitle).filter((item) =>
    isSubKpiPendingVerification(item, { parentCardEffectivelyVerified: parentVerified }),
  );
}

function subKpiFromStructuredItem(it: Record<string, unknown>): SubKpiItem | null {
  const title = typeof it.title === "string" ? it.title.trim() : "";
  if (!title) return null;
  const id = typeof it.id === "string" && it.id.trim() ? it.id.trim() : crypto.randomUUID();
  const description = normalizeSubKpiDescription(it.description);
  const remarks = normalizeSubKpiRemarks(it.remarks);
  const assignedAgentId = typeof it.assignedAgentId === "string" ? it.assignedAgentId.trim() : "";
  const assignedAgentName = typeof it.assignedAgentName === "string" ? it.assignedAgentName.trim() : "";
  const beforeScreenshot = parseTaskScreenshotMetaList(it.beforeScreenshot);
  const afterScreenshot = parseTaskScreenshotMetaList(it.afterScreenshot);
  const completionMode = isSubKpiCompletionMode(it.completionMode)
    ? it.completionMode
    : resolveSubKpiCompletionMode({
        completionMode: undefined,
        screenshotsEnabled: it.screenshotsEnabled === true,
        beforeScreenshot,
        afterScreenshot,
      });
  const screenshotsEnabled = it.screenshotsEnabled === true || subKpiRequiresScreenshotsFromMode(completionMode);
  const startDate = normalizeOptionalSubKpiYmd(it.startDate);
  const dueDate = normalizeOptionalSubKpiYmd(it.dueDate);
  const actualDate = normalizeOptionalSubKpiYmd(it.actualDate);
  return {
    id,
    title,
    ...(description ? { description } : {}),
    ...(remarks ? { remarks } : {}),
    done: Boolean(it.done),
    ...(assignedAgentId ? { assignedAgentId } : {}),
    ...(assignedAgentName ? { assignedAgentName } : {}),
    ...(completionMode !== "checkbox" ? { completionMode } : {}),
    ...(screenshotsEnabled ? { screenshotsEnabled: true } : {}),
    ...(beforeScreenshot.length > 0 ? { beforeScreenshot } : {}),
    ...(afterScreenshot.length > 0 ? { afterScreenshot } : {}),
    ...(startDate ? { startDate } : {}),
    ...(dueDate ? { dueDate } : {}),
    ...(actualDate ? { actualDate } : {}),
  };
}

export type ItProjectSubKpiDraft = { title: string; startDate: string; endDate: string };

/** Build flat checklist for IT Project Implementation (no segments, no task-level dates). */
export function buildItProjectSubKpis(
  items: ItProjectSubKpiDraft[],
): { ok: true; norm: NormalizedSubKpis } | { ok: false; error: string } {
  const flat: SubKpiItem[] = [];
  for (const item of items) {
    const title = item.title.trim();
    const startDate = normalizeOptionalSubKpiYmd(item.startDate);
    const endDate = normalizeOptionalSubKpiYmd(item.endDate);
    if (!title) continue;
    if (!startDate || !endDate) {
      return { ok: false, error: "Each sub-task needs a start date and end date." };
    }
    if (endDate < startDate) {
      return { ok: false, error: `Sub-task "${title}": end date must be on or after start date.` };
    }
    flat.push({ id: crypto.randomUUID(), title, done: false, startDate, dueDate: endDate });
  }
  if (flat.length === 0) {
    return { ok: false, error: "Add at least one sub-task with start and end dates." };
  }
  return { ok: true, norm: { segmented: false, flat } };
}

/**
 * Minimum sub-tasks required to persist a segmented checklist.
 * Segment UI is available from the first sub-task; persist still needs at least one item.
 */
export const MIN_SEGMENTED_SUBKPIS_FOR_CREATE = 1;
const MIN_SEGMENTED_SUBKPIS = MIN_SEGMENTED_SUBKPIS_FOR_CREATE;

type SubKpiCreateDraft = string | {
  title?: string | null;
  description?: string | null;
  remarks?: string | null;
  startDate?: string | null;
  dueDate?: string | null;
  dueDateRollsWithCycle?: boolean | null;
  endDate?: string | null;
  actualDate?: string | null;
  projectPriority?: string | null;
  screenshotsEnabled?: boolean | null;
  completionRequirements?: SubKpiCompletionRequirements | null;
  numericalTarget?: number | null;
  dailyPenaltyAmount?: number | null;
  delayPenaltyFrequency?: DelayPenaltyFrequency | null;
};

function subKpiFromCreateDraft(input: SubKpiCreateDraft): SubKpiItem | null {
  const rawTitle = typeof input === "string" ? input : input.title;
  const title = typeof rawTitle === "string" ? rawTitle.trim() : "";
  if (!title) return null;
  const description = typeof input === "string" ? "" : normalizeSubKpiDescription(input.description);
  const remarks = typeof input === "string" ? "" : normalizeSubKpiRemarks(input.remarks);
  const projectPriority =
    typeof input === "string" ? null : normalizeSubKpiPriority(input.projectPriority);
  const startDate = typeof input === "string" ? null : normalizeOptionalSubKpiYmd(input.startDate);
  const dueDate = typeof input === "string" ? null : normalizeOptionalSubKpiYmd(input.dueDate ?? input.endDate);
  const dueDateRollsWithCycle =
    typeof input !== "string" && input.dueDateRollsWithCycle === true && Boolean(dueDate);
  const actualDate = typeof input === "string" ? null : normalizeOptionalSubKpiYmd(input.actualDate);
  const numericalTarget =
    typeof input !== "string" &&
    typeof input.numericalTarget === "number" &&
    Number.isFinite(input.numericalTarget)
      ? input.numericalTarget
      : null;
  let item: SubKpiItem = {
    id: crypto.randomUUID(),
    title,
    ...(description ? { description } : {}),
    ...(remarks ? { remarks } : {}),
    done: false,
    ...(projectPriority ? { projectPriority } : {}),
    ...(startDate ? { startDate } : {}),
    ...(dueDate ? { dueDate } : {}),
    ...(dueDateRollsWithCycle ? { dueDateRollsWithCycle: true } : {}),
    ...(actualDate ? { actualDate } : {}),
  };
  if (typeof input !== "string" && input.completionRequirements) {
    item = applySubKpiCompletionRequirements(item, input.completionRequirements);
  } else {
    const screenshotsEnabled = typeof input === "string" ? false : input.screenshotsEnabled === true;
    item = applySubKpiCompletionRequirements(
      item,
      completionRequirementsFromLegacyMode(screenshotsEnabled ? "both" : "checkbox"),
    );
  }
  if (numericalTarget != null) {
    item = { ...item, numericalTarget };
  }
  const dailyPenaltyAmount =
    typeof input !== "string" &&
    typeof input.dailyPenaltyAmount === "number" &&
    Number.isFinite(input.dailyPenaltyAmount) &&
    input.dailyPenaltyAmount >= 0
      ? input.dailyPenaltyAmount
      : null;
  if (dailyPenaltyAmount != null) {
    item = { ...item, dailyPenaltyAmount };
  }
  if (typeof input !== "string" && input.delayPenaltyFrequency) {
    item = {
      ...item,
      delayPenaltyFrequency: normalizeDelayPenaltyFrequency(input.delayPenaltyFrequency),
    };
  }
  return item;
}

export function validateSegmentStructureForPersist(
  segmented: boolean,
  flatInput: SubKpiCreateDraft[],
  segmentsInput: Array<{
    id?: string;
    label: string;
    dueDate?: string | null;
    items: SubKpiCreateDraft[];
  }> | undefined,
  options?: { allowPillarOnly?: boolean },
): { ok: true; norm: NormalizedSubKpis } | { ok: false; error: string } {
  if (!segmented) {
    const flat = flatInput
      .map(subKpiFromCreateDraft)
      .filter((item): item is SubKpiItem => item != null);
    if (flat.length === 0) {
      if (options?.allowPillarOnly) {
        return { ok: true, norm: { segmented: false, flat: [] } };
      }
      return { ok: false, error: "At least one sub-task is required." };
    }
    return { ok: true, norm: { segmented: false, flat } };
  }

  if (!segmentsInput || segmentsInput.length === 0) {
    return { ok: false, error: "Add at least one segment with a label before adding sub-tasks." };
  }

  const segments: SubKpiSegment[] = [];
  for (const seg of segmentsInput) {
    const rawId = typeof seg.id === "string" ? seg.id.trim() : "";
    const isGeneral = isUnsegmentedSegmentId(rawId);
    const label = isGeneral ? UNSEGMENTED_SEGMENT_LABEL : seg.label.trim();
    if (!label) {
      return { ok: false, error: "Each segment needs a label before saving." };
    }
    const items = seg.items
      .map(subKpiFromCreateDraft)
      .filter((item): item is SubKpiItem => item != null);
    // Empty named segments are allowed; Unassigned must be empty to finalize.
    if (isGeneral && items.length > 0) {
      return { ok: false, error: UNASSIGNED_SEGMENT_BLOCK_MESSAGE };
    }
    const dueDate = isGeneral ? null : normalizeOptionalSubKpiYmd(seg.dueDate);
    segments.push({
      id: isGeneral ? UNSEGMENTED_SEGMENT_ID : rawId || crypto.randomUUID(),
      label,
      items,
      ...(dueDate ? { dueDate } : {}),
    });
  }

  const ensured = ensureUnsegmentedSegment(segments);
  const unassignedCount =
    ensured.find((seg) => isUnsegmentedSegmentId(seg.id))?.items.length ?? 0;
  if (unassignedCount > 0) {
    return { ok: false, error: UNASSIGNED_SEGMENT_BLOCK_MESSAGE };
  }

  const namedItemCount = ensured
    .filter((seg) => !isUnsegmentedSegmentId(seg.id))
    .reduce((acc, seg) => acc + seg.items.length, 0);
  if (namedItemCount < MIN_SEGMENTED_SUBKPIS) {
    return {
      ok: false,
      error: `Assign at least ${MIN_SEGMENTED_SUBKPIS} sub-task${MIN_SEGMENTED_SUBKPIS === 1 ? "" : "s"} to a segment (Unassigned must be empty).`,
    };
  }

  return { ok: true, norm: { segmented: true, segments: ensured } };
}

export function validateStructuredUpdate(
  body: unknown,
): { ok: true; norm: NormalizedSubKpis } | { ok: false; error: string } {
  if (!isPlainObject(body)) return { ok: false, error: "Invalid sub-task payload." };
  const segmented = body.segmented === true;
  if (segmented) {
    const segs = body.segments;
    if (!Array.isArray(segs) || segs.length === 0) {
      return { ok: false, error: "segmented payloads require segments array." };
    }
    const segmentsOut: SubKpiSegment[] = [];
    let namedItemCount = 0;
    for (const s of segs) {
      if (!isPlainObject(s)) continue;
      const sid = typeof s.id === "string" && s.id.trim() ? s.id.trim() : crypto.randomUUID();
      const isGeneral = isUnsegmentedSegmentId(sid);
      const label = isGeneral
        ? UNSEGMENTED_SEGMENT_LABEL
        : typeof s.label === "string"
          ? s.label.trim()
          : "";
      if (!label) return { ok: false, error: "Each segment must have a label." };
      const rawItems = Array.isArray(s.items) ? s.items : [];
      const items: SubKpiItem[] = [];
      for (const it of rawItems) {
        if (!isPlainObject(it)) continue;
        const row = subKpiFromStructuredItem(it);
        if (row) items.push(row);
      }
      if (isGeneral && items.length > 0) {
        return { ok: false, error: UNASSIGNED_SEGMENT_BLOCK_MESSAGE };
      }
      if (!isGeneral) namedItemCount += items.length;
      segmentsOut.push({
        id: isGeneral ? UNSEGMENTED_SEGMENT_ID : sid,
        label,
        items,
      });
    }
    const ensured = ensureUnsegmentedSegment(segmentsOut);
    if ((ensured.find((seg) => isUnsegmentedSegmentId(seg.id))?.items.length ?? 0) > 0) {
      return { ok: false, error: UNASSIGNED_SEGMENT_BLOCK_MESSAGE };
    }
    if (namedItemCount < MIN_SEGMENTED_SUBKPIS) {
      return {
        ok: false,
        error: `Segmented tasks must keep at least ${MIN_SEGMENTED_SUBKPIS} sub-tasks assigned to segments.`,
      };
    }
    return { ok: true, norm: { segmented: true, segments: ensured } };
  }
  const rawItems = Array.isArray(body.items) ? body.items : [];
  const flat: SubKpiItem[] = [];
  for (const it of rawItems) {
    if (!isPlainObject(it)) continue;
    const row = subKpiFromStructuredItem(it);
    if (row) flat.push(row);
  }
  if (flat.length === 0) {
    return { ok: false, error: "Flat checklist needs at least one sub-task." };
  }
  return { ok: true, norm: { segmented: false, flat } };
}

export type AppendSubKpiInput = {
  title: string;
  description?: string | null;
  remarks?: string | null;
  segmentId?: string | null;
  startDate?: string | null;
  dueDate?: string | null;
  dueDateRollsWithCycle?: boolean | null;
  projectPriority?: string | null;
  screenshotsEnabled?: boolean;
};

/** Append one sub-task to an existing flat or segmented checklist (preserves envelope metadata). */
export function appendSubKpiItem(
  raw: unknown,
  input: AppendSubKpiInput,
): { ok: true; json: Prisma.InputJsonValue } | { ok: false; error: string } {
  const item = subKpiFromCreateDraft({
    title: input.title,
    description: input.description,
    remarks: input.remarks,
    startDate: input.startDate,
    dueDate: input.dueDate,
    dueDateRollsWithCycle: input.dueDateRollsWithCycle,
    projectPriority: input.projectPriority,
    screenshotsEnabled: input.screenshotsEnabled,
  });
  if (!item) return { ok: false, error: "Sub Task title is required." };

  const n = normalizeSubKpis(raw);
  if (n.segmented) {
    const segmentId = typeof input.segmentId === "string" ? input.segmentId.trim() : "";
    // New subtasks land on the Unsegmented board when no segment is chosen.
    const targetId = segmentId || UNSEGMENTED_SEGMENT_ID;
    let segments = ensureUnsegmentedSegment(n.segments);
    const segIdx = segments.findIndex((seg) => seg.id === targetId);
    if (segIdx < 0) return { ok: false, error: "Segment not found." };
    segments = segments.map((seg, idx) =>
      idx === segIdx ? { ...seg, items: [...seg.items, item] } : seg,
    );
    return { ok: true, json: wrapForPersistWithExistingMeta({ segmented: true, segments }, raw) };
  }

  return {
    ok: true,
    json: wrapForPersistWithExistingMeta({ segmented: false, flat: [...n.flat, item] }, raw),
  };
}

export type CopySubKpiToSegmentsInput = {
  sourceIds: string[];
  targetSegmentIds: string[];
  /** Keep due/start dates on copies (default true). */
  keepDueDate?: boolean;
  /** Keep assignee on copies (default false — new copies start unassigned). */
  keepAssignee?: boolean;
  /** Keep priority on copies (default true). */
  keepPriority?: boolean;
};

function cloneSubKpiItemForCopy(
  source: SubKpiItem,
  options: { keepDueDate: boolean; keepAssignee: boolean; keepPriority: boolean },
): SubKpiItem {
  const clone: SubKpiItem = {
    id: crypto.randomUUID(),
    title: source.title,
    done: false,
  };
  if (source.description?.trim()) clone.description = source.description.trim();
  if (options.keepPriority && source.projectPriority) clone.projectPriority = source.projectPriority;
  if (options.keepDueDate) {
    if (source.startDate) clone.startDate = source.startDate;
    if (source.dueDate) clone.dueDate = source.dueDate;
    if (source.dueDateRollsWithCycle === true && source.dueDate) {
      clone.dueDateRollsWithCycle = true;
    }
  }
  if (options.keepAssignee && source.assignedAgentId?.trim()) {
    clone.assignedAgentId = source.assignedAgentId.trim();
    if (source.assignedAgentName?.trim()) clone.assignedAgentName = source.assignedAgentName.trim();
  }
  if (source.completionMode) clone.completionMode = source.completionMode;
  if (source.completionRequirements) {
    clone.completionRequirements = { ...source.completionRequirements };
  }
  if (source.screenshotsEnabled != null) clone.screenshotsEnabled = source.screenshotsEnabled;
  if (source.numericalTarget != null) clone.numericalTarget = source.numericalTarget;
  if (source.dailyPenaltyAmount != null) clone.dailyPenaltyAmount = source.dailyPenaltyAmount;
  return clone;
}

/**
 * Copy one or more sub-tasks into other segments of the same segmented checklist.
 * Originals stay in place. Copies always start Pending (done: false) without screenshots/assistance.
 */
export function copySubKpiItemsToSegments(
  raw: unknown,
  input: CopySubKpiToSegmentsInput,
): { ok: true; json: Prisma.InputJsonValue; copiedCount: number } | { ok: false; error: string } {
  const n = normalizeSubKpis(raw);
  if (!n.segmented) {
    return { ok: false, error: "Copy to segment is only available for segmented checklists." };
  }

  const sourceIds = [...new Set((input.sourceIds ?? []).map((id) => String(id ?? "").trim()).filter(Boolean))];
  if (sourceIds.length === 0) {
    return { ok: false, error: "Select at least one sub-task to copy." };
  }

  const requestedTargets = [
    ...new Set((input.targetSegmentIds ?? []).map((id) => String(id ?? "").trim()).filter(Boolean)),
  ];
  if (requestedTargets.length === 0) {
    return { ok: false, error: "Choose at least one target segment." };
  }

  const segmentById = new Map(n.segments.map((seg) => [seg.id, seg] as const));
  for (const targetId of requestedTargets) {
    if (!segmentById.has(targetId)) {
      return { ok: false, error: "Target segment not found." };
    }
  }

  type Located = { item: SubKpiItem; segmentId: string };
  const located: Located[] = [];
  for (const sourceId of sourceIds) {
    let hit: Located | null = null;
    for (const seg of n.segments) {
      const item = seg.items.find((it) => it.id === sourceId);
      if (item) {
        hit = { item, segmentId: seg.id };
        break;
      }
    }
    if (!hit) return { ok: false, error: "Sub-task not found." };
    located.push(hit);
  }

  const keepDueDate = input.keepDueDate !== false;
  const keepAssignee = input.keepAssignee === true;
  const keepPriority = input.keepPriority !== false;

  let segments = n.segments.map((seg) => ({ ...seg, items: [...seg.items] }));
  let copiedCount = 0;

  for (const { item, segmentId: sourceSegmentId } of located) {
    const targets = requestedTargets.filter((id) => id !== sourceSegmentId);
    for (const targetId of targets) {
      const clone = cloneSubKpiItemForCopy(item, { keepDueDate, keepAssignee, keepPriority });
      segments = segments.map((seg) =>
        seg.id === targetId ? { ...seg, items: [...seg.items, clone] } : seg,
      );
      copiedCount += 1;
    }
  }

  if (copiedCount === 0) {
    return {
      ok: false,
      error: "Choose a different segment — cannot copy a sub-task into its current segment.",
    };
  }

  return {
    ok: true,
    json: wrapForPersistWithExistingMeta({ segmented: true, segments }, raw),
    copiedCount,
  };
}

export type MoveSubKpiOnBoardInput = {
  /** Target segment id, or {@link UNSEGMENTED_SEGMENT_ID}. */
  targetSegmentId: string;
  /** Optional Kanban status column on the target board. */
  boardColumn?: SubKpiBoardColumn;
  /** Optional insert index within the target segment's item list (after column grouping apply). */
  index?: number | null;
};

/**
 * Move a sub-task to another segment (or Unsegmented) and optionally set its board column.
 * Preserves item identity and metadata. Empty source segments are allowed.
 */
export function moveSubKpiItemOnBoard(
  raw: unknown,
  subKpiId: string,
  input: MoveSubKpiOnBoardInput,
): { ok: true; json: Prisma.InputJsonValue } | { ok: false; error: string } {
  const id = subKpiId.trim();
  if (!id) return { ok: false, error: "Sub Task id is required." };

  const n = normalizeSubKpis(raw);
  if (!n.segmented) {
    // Flat checklist: only board-column changes apply (no segment move).
    if (input.boardColumn == null) {
      return { ok: false, error: "Segment moves require a segmented checklist." };
    }
    const flat = n.flat.map((item) =>
      item.id === id ? applySubKpiBoardColumn(item, input.boardColumn!) : item,
    );
    if (!n.flat.some((item) => item.id === id)) {
      return { ok: false, error: "Sub Task not found." };
    }
    return { ok: true, json: wrapForPersistWithExistingMeta({ segmented: false, flat }, raw) };
  }

  const targetSegmentId = String(input.targetSegmentId ?? "").trim() || UNSEGMENTED_SEGMENT_ID;
  let segments = ensureUnsegmentedSegment(n.segments.map((seg) => ({ ...seg, items: [...seg.items] })));
  if (!segments.some((seg) => seg.id === targetSegmentId)) {
    return { ok: false, error: "Target segment not found." };
  }

  let moved: SubKpiItem | null = null;
  segments = segments.map((seg) => {
    const idx = seg.items.findIndex((item) => item.id === id);
    if (idx < 0) return seg;
    moved = seg.items[idx]!;
    return { ...seg, items: seg.items.filter((item) => item.id !== id) };
  });
  if (!moved) return { ok: false, error: "Sub Task not found." };

  let item: SubKpiItem = moved;
  if (input.boardColumn) {
    item = applySubKpiBoardColumn(item, input.boardColumn);
  }

  segments = segments.map((seg) => {
    if (seg.id !== targetSegmentId) return seg;
    const nextItems = [...seg.items];
    const insertAt =
      typeof input.index === "number" && Number.isFinite(input.index)
        ? Math.max(0, Math.min(nextItems.length, Math.floor(input.index)))
        : nextItems.length;
    nextItems.splice(insertAt, 0, item);
    return { ...seg, items: nextItems };
  });

  return {
    ok: true,
    json: wrapForPersistWithExistingMeta({ segmented: true, segments: ensureUnsegmentedSegment(segments) }, raw),
  };
}

export type UpdateSubKpiItemInput = {
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
  delayPenaltyFrequency?: DelayPenaltyFrequency | null;
};

/** Update Sub Task title and/or schedule fields (preserves other item metadata). */
export function updateSubKpiItem(
  raw: unknown,
  subKpiId: string,
  input: UpdateSubKpiItemInput,
): { ok: true; json: Prisma.InputJsonValue } | { ok: false; error: string } {
  const id = subKpiId.trim();
  if (!id) return { ok: false, error: "Sub Task id is required." };

  const n = normalizeSubKpis(raw);
  const allItems = n.segmented ? n.segments.flatMap((seg) => seg.items) : n.flat;
  if (!allItems.some((item) => item.id === id)) {
    return { ok: false, error: "Sub Task not found." };
  }

  const title =
    input.title === undefined ? undefined : typeof input.title === "string" ? input.title.trim() : "";
  if (title !== undefined && !title) {
    return { ok: false, error: "Sub Task title is required." };
  }

  const description =
    input.description === undefined ? undefined : normalizeSubKpiDescription(input.description);
  const remarks =
    input.remarks === undefined ? undefined : normalizeSubKpiRemarks(input.remarks);
  const projectPriority =
    input.projectPriority === undefined ? undefined : normalizeSubKpiPriority(input.projectPriority);
  const startDate =
    input.startDate === undefined ? undefined : normalizeOptionalSubKpiYmd(input.startDate) ?? null;
  const dueDate =
    input.dueDate === undefined ? undefined : normalizeOptionalSubKpiYmd(input.dueDate) ?? null;
  const dueDateRollsWithCycle =
    input.dueDateRollsWithCycle === undefined ? undefined : input.dueDateRollsWithCycle === true;
  const completionMode =
    input.completionMode === undefined
      ? undefined
      : isSubKpiCompletionMode(input.completionMode)
        ? input.completionMode
        : undefined;
  let completionRequirements: SubKpiCompletionRequirements | null | undefined = undefined;
  if (input.completionRequirements !== undefined) {
    if (input.completionRequirements == null) {
      completionRequirements = null;
    } else {
      const normalized = normalizeCompletionRequirements(input.completionRequirements);
      if (!normalized) {
        return { ok: false, error: "Select at least one completion condition." };
      }
      completionRequirements = normalized;
    }
  }
  const numericalTarget =
    input.numericalTarget === undefined
      ? undefined
      : typeof input.numericalTarget === "number" && Number.isFinite(input.numericalTarget)
        ? input.numericalTarget
        : null;
  const dailyPenaltyAmount =
    input.dailyPenaltyAmount === undefined
      ? undefined
      : typeof input.dailyPenaltyAmount === "number" && Number.isFinite(input.dailyPenaltyAmount)
        ? Math.max(0, input.dailyPenaltyAmount)
        : null;
  const delayPenaltyFrequency =
    input.delayPenaltyFrequency === undefined
      ? undefined
      : input.delayPenaltyFrequency == null
        ? null
        : normalizeDelayPenaltyFrequency(input.delayPenaltyFrequency);

  const touch = (item: SubKpiItem): SubKpiItem => {
    if (item.id !== id) return item;
    let next = { ...item };
    if (title !== undefined) next = { ...next, title };
    if (description !== undefined) {
      if (description) next = { ...next, description };
      else delete (next as { description?: string }).description;
    }
    if (remarks !== undefined) {
      if (remarks) next = { ...next, remarks };
      else delete (next as { remarks?: string }).remarks;
    }
    if (projectPriority !== undefined) {
      if (projectPriority) next = { ...next, projectPriority };
      else delete (next as { projectPriority?: SubKpiItem["projectPriority"] }).projectPriority;
    }
    if (startDate !== undefined) {
      if (startDate) next = { ...next, startDate };
      else delete (next as { startDate?: string }).startDate;
    }
    if (dueDate !== undefined) {
      if (dueDate) next = { ...next, dueDate };
      else {
        delete (next as { dueDate?: string }).dueDate;
        delete (next as { dueDateRollsWithCycle?: boolean }).dueDateRollsWithCycle;
      }
    }
    if (dueDateRollsWithCycle !== undefined) {
      const hasDue = Boolean(
        dueDate !== undefined ? dueDate : normalizeOptionalSubKpiYmd(next.dueDate),
      );
      if (dueDateRollsWithCycle && hasDue) next = { ...next, dueDateRollsWithCycle: true };
      else delete (next as { dueDateRollsWithCycle?: boolean }).dueDateRollsWithCycle;
    }
    if (completionRequirements !== undefined) {
      if (completionRequirements) {
        next = applySubKpiCompletionRequirements(next, completionRequirements);
        delete (next as { completionMode?: SubKpiCompletionMode }).completionMode;
      } else {
        next = applySubKpiCompletionRequirements(next, {
          checkbox: true,
          screenshots: false,
          screenshotUpload: false,
          numerical: false,
        });
        delete (next as { completionMode?: SubKpiCompletionMode }).completionMode;
      }
    } else if (completionMode !== undefined) {
      next = applySubKpiCompletionMode(next, completionMode);
    }
    if (numericalTarget !== undefined) {
      if (numericalTarget != null) next = { ...next, numericalTarget };
      else delete (next as { numericalTarget?: number }).numericalTarget;
    }
    if (dailyPenaltyAmount !== undefined) {
      if (dailyPenaltyAmount != null) next = { ...next, dailyPenaltyAmount };
      else delete (next as { dailyPenaltyAmount?: number }).dailyPenaltyAmount;
    }
    if (delayPenaltyFrequency !== undefined) {
      if (delayPenaltyFrequency != null) next = { ...next, delayPenaltyFrequency };
      else delete (next as { delayPenaltyFrequency?: DelayPenaltyFrequency }).delayPenaltyFrequency;
    }
    return next;
  };

  if (n.segmented) {
    const segments = n.segments.map((seg) => ({
      ...seg,
      items: seg.items.map(touch),
    }));
    return { ok: true, json: wrapForPersistWithExistingMeta({ segmented: true, segments }, raw) };
  }

  return {
    ok: true,
    json: wrapForPersistWithExistingMeta({ segmented: false, flat: n.flat.map(touch) }, raw),
  };
}

/** Remove one Sub Task from a flat or segmented checklist (preserves envelope metadata). */
export function removeSubKpiItem(
  raw: unknown,
  subKpiId: string,
): { ok: true; json: Prisma.InputJsonValue } | { ok: false; error: string } {
  const id = subKpiId.trim();
  if (!id) return { ok: false, error: "Sub Task id is required." };

  const n = normalizeSubKpis(raw);
  if (n.segmented) {
    const targetSegment = n.segments.find((seg) => seg.items.some((item) => item.id === id));
    if (!targetSegment) return { ok: false, error: "Sub Task not found." };
    const totalAfter = collectAllSubKpiItems(n).length - 1;
    if (totalAfter < MIN_SEGMENTED_SUBKPIS) {
      return {
        ok: false,
        error: `Segmented checklists must keep at least ${MIN_SEGMENTED_SUBKPIS} Sub Tasks in total.`,
      };
    }
    // Empty segments are allowed (Kanban boards can be empty).
    const segments = ensureUnsegmentedSegment(
      n.segments.map((seg) => ({
        ...seg,
        items: seg.items.filter((item) => item.id !== id),
      })),
    );
    return { ok: true, json: wrapForPersistWithExistingMeta({ segmented: true, segments }, raw) };
  }

  if (n.flat.length <= 1) {
    return { ok: false, error: "Checklists must keep at least one Sub Task." };
  }
  const flat = n.flat.filter((item) => item.id !== id);
  return { ok: true, json: wrapForPersistWithExistingMeta({ segmented: false, flat }, raw) };
}

/** Remove schedule start dates from all sub-tasks (used when cadence becomes daily). */
export function stripSubKpiStartDates(raw: unknown): Prisma.InputJsonValue {
  const n = normalizeSubKpis(raw);
  const strip = (item: SubKpiItem): SubKpiItem => {
    const next = { ...item };
    delete (next as { startDate?: string }).startDate;
    return next;
  };
  if (n.segmented) {
    const segments = n.segments.map((seg) => ({
      ...seg,
      items: seg.items.map(strip),
    }));
    return wrapForPersistWithExistingMeta({ segmented: true, segments }, raw);
  }
  return wrapForPersistWithExistingMeta({ segmented: false, flat: n.flat.map(strip) }, raw);
}

/** Sub-tasks without a checkbox requirement auto-complete when other requirements are met. */
export function syncSubKpiDoneFromRequirements(
  raw: unknown,
  subKpiId: string,
  opts?: { verificationEnabled?: boolean },
): Prisma.InputJsonValue {
  if (subKpiId === PILLAR_ONLY_VIRTUAL_SUBKPI_ID && isPillarOnlyTask(raw)) {
    return syncPillarDoneFromRequirements(raw);
  }
  const n = normalizeSubKpis(raw);
  const items = n.segmented ? n.segments.flatMap((seg) => seg.items) : n.flat;
  const item = items.find((row) => row.id === subKpiId);
  if (!item) return raw as Prisma.InputJsonValue;
  const req = resolveSubKpiCompletionRequirements(item);
  if (req.checkbox) {
    if (resolveSubKpiCompletionMode(item) !== "screenshots") return raw as Prisma.InputJsonValue;
  }
  const shouldBeDone = subKpiRequirementsMet(item);
  if (Boolean(item.done) === shouldBeDone) return raw as Prisma.InputJsonValue;
  return setSubKpiItemDone(raw, subKpiId, shouldBeDone, opts);
}

/** @deprecated use syncSubKpiDoneFromRequirements */
export function syncScreenshotOnlySubKpiDone(
  raw: unknown,
  subKpiId: string,
  opts?: { verificationEnabled?: boolean },
): Prisma.InputJsonValue {
  return syncSubKpiDoneFromRequirements(raw, subKpiId, opts);
}
