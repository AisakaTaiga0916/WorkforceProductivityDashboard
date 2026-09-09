import type { Prisma } from "@prisma/client/primary";
import { DateTime } from "luxon";
import { normalizeDelayPenaltyFrequency } from "@/lib/delay-penalty-frequency";
import {
  collectAllSubKpiItems,
  isUnsegmentedSegmentId,
  kpiChecklistProgress,
  normalizeSubKpis,
  type KpiChecklistProgress,
  type SubKpiItem,
} from "@/lib/kpi-subkpis";
import { normalizeTimeZone } from "@/lib/kpi-recurrence";
import { isItProjectImplementationPillar } from "@/lib/it-task-pillar-titles";
import { parseTaskScreenshotMetaList } from "@/lib/task-screenshot-meta";
import { hasValidActualDate, normalizeOptionalUsDate } from "@/lib/us-date-format";

export type ItProjectPhase = {
  id: string;
  name: string;
  /**
   * Phase target / due date (YYYY-MM-DD).
   * Auto-derived as the latest subtask due date when subtasks have due dates.
   */
  dueDate?: string | null;
  assignedAgentId?: string | null;
  assignedAgentName?: string | null;
  /** Calendar day (YYYY-MM-DD) when a delay notification was last sent for this phase. */
  lastDelayNotifiedOn?: string | null;
  items: SubKpiItem[];
};

export type ItProjectData = {
  activePhaseId: string;
  phases: ItProjectPhase[];
};

export const IT_PROJECT_ENVELOPE_KIND = "it_project" as const;
export const IT_PROJECT_PRIORITY_OPTIONS = ["High", "Medium", "Low"] as const;
export const IT_PROJECT_STATUS_OPTIONS = ["Pending", "On Going", "Finalizing", "Done"] as const;

export type ItProjectPriority = (typeof IT_PROJECT_PRIORITY_OPTIONS)[number];
export type ItProjectStatus = (typeof IT_PROJECT_STATUS_OPTIONS)[number];

export function normalizeItProjectPriority(value: unknown): ItProjectPriority | null {
  return IT_PROJECT_PRIORITY_OPTIONS.find((option) => option === value) ?? null;
}

export function normalizeItProjectStatus(value: unknown): ItProjectStatus | null {
  return IT_PROJECT_STATUS_OPTIONS.find((option) => option === value) ?? null;
}

export function itProjectStatusProgress(item: SubKpiItem): number {
  const status = normalizeItProjectStatus(item.projectStatus);
  if (status === "Done") return 100;
  if (status === "Finalizing") return 75;
  if (status === "On Going") return 50;
  if (item.assignedAgentId) return 25;
  return 0;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function itemFromRaw(r: Record<string, unknown>): SubKpiItem {
  const id = String(r?.id ?? "").trim() || crypto.randomUUID();
  const title = String(r?.title ?? "").trim();
  const assignedAgentId = typeof r?.assignedAgentId === "string" ? r.assignedAgentId.trim() : "";
  const assignedAgentName = typeof r?.assignedAgentName === "string" ? r.assignedAgentName.trim() : "";
  const projectPriority = normalizeItProjectPriority(r?.projectPriority);
  const projectStatus = normalizeItProjectStatus(r?.projectStatus);
  const beforeScreenshot = parseTaskScreenshotMetaList(r?.beforeScreenshot);
  const afterScreenshot = parseTaskScreenshotMetaList(r?.afterScreenshot);
  const startDate = normalizeOptionalUsDate(r?.startDate);
  const dueDate = normalizeOptionalUsDate(r?.dueDate ?? r?.endDate);
  const actualDate = normalizeOptionalUsDate(r?.actualDate);
  const done = hasValidActualDate({ actualDate });
  const assistanceRequested = r?.assistanceRequested === true;
  const assistanceRequestedAt =
    typeof r?.assistanceRequestedAt === "string" ? r.assistanceRequestedAt.trim() : "";
  const assistanceRequestedBy =
    typeof r?.assistanceRequestedBy === "string" ? r.assistanceRequestedBy.trim() : "";
  const dailyPenaltyRaw = r?.dailyPenaltyAmount;
  const dailyPenaltyAmount =
    typeof dailyPenaltyRaw === "number" && Number.isFinite(dailyPenaltyRaw) && dailyPenaltyRaw >= 0
      ? dailyPenaltyRaw
      : null;
  const delayPenaltyFrequency = r?.delayPenaltyFrequency
    ? normalizeDelayPenaltyFrequency(r.delayPenaltyFrequency)
    : null;
  const startedAt = typeof r?.startedAt === "string" && r.startedAt.trim() ? r.startedAt.trim() : "";
  const endedAt = typeof r?.endedAt === "string" && r.endedAt.trim() ? r.endedAt.trim() : "";
  const startedLatitude = parseOptionalCoord(r?.startedLatitude, -90, 90);
  const startedLongitude = parseOptionalCoord(r?.startedLongitude, -180, 180);
  const endedLatitude = parseOptionalCoord(r?.endedLatitude, -90, 90);
  const endedLongitude = parseOptionalCoord(r?.endedLongitude, -180, 180);
  return {
    id,
    title,
    done,
    ...(assignedAgentId ? { assignedAgentId } : {}),
    ...(assignedAgentName ? { assignedAgentName } : {}),
    ...(projectPriority ? { projectPriority } : {}),
    ...(projectStatus ? { projectStatus } : {}),
    ...(beforeScreenshot.length > 0 ? { beforeScreenshot } : {}),
    ...(afterScreenshot.length > 0 ? { afterScreenshot } : {}),
    ...(startDate ? { startDate } : {}),
    ...(dueDate ? { dueDate } : {}),
    ...(actualDate ? { actualDate } : {}),
    ...(startedAt ? { startedAt } : {}),
    ...(endedAt ? { endedAt } : {}),
    ...(startedLatitude != null ? { startedLatitude } : {}),
    ...(startedLongitude != null ? { startedLongitude } : {}),
    ...(endedLatitude != null ? { endedLatitude } : {}),
    ...(endedLongitude != null ? { endedLongitude } : {}),
    ...(dailyPenaltyAmount != null ? { dailyPenaltyAmount } : {}),
    ...(delayPenaltyFrequency ? { delayPenaltyFrequency } : {}),
    ...(assistanceRequested ? { assistanceRequested: true } : {}),
    ...(assistanceRequestedAt ? { assistanceRequestedAt } : {}),
    ...(assistanceRequestedBy ? { assistanceRequestedBy } : {}),
  };
}

function parseOptionalCoord(value: unknown, min: number, max: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < min || value > max) return null;
  return value;
}

function phaseFromRaw(raw: unknown, fallbackName: string): ItProjectPhase | null {
  if (!isPlainObject(raw)) return null;
  const name = String(raw.name ?? "").trim() || fallbackName;
  const id = String(raw.id ?? "").trim() || crypto.randomUUID();
  const dueDate = normalizeOptionalUsDate(raw.dueDate);
  const assignedAgentId =
    typeof raw.assignedAgentId === "string" ? raw.assignedAgentId.trim() : "";
  const assignedAgentName =
    typeof raw.assignedAgentName === "string" ? raw.assignedAgentName.trim() : "";
  const lastDelayNotifiedOn = normalizeOptionalUsDate(raw.lastDelayNotifiedOn);
  const items = Array.isArray(raw.items)
    ? (raw.items as unknown[])
        .map((it) => (isPlainObject(it) ? itemFromRaw(it) : null))
        .filter((x): x is SubKpiItem => x != null && x.title.length > 0)
    : [];
  return {
    id,
    name,
    ...(dueDate ? { dueDate } : {}),
    ...(assignedAgentId ? { assignedAgentId } : {}),
    ...(assignedAgentName ? { assignedAgentName } : {}),
    ...(lastDelayNotifiedOn ? { lastDelayNotifiedOn } : {}),
    items,
  };
}

export type ItProjectStoredEnvelope = {
  kind: typeof IT_PROJECT_ENVELOPE_KIND;
  activePhaseId?: string;
  phases: unknown[];
};

export function isItProjectEnvelope(raw: unknown): raw is ItProjectStoredEnvelope {
  return isPlainObject(raw) && raw.kind === IT_PROJECT_ENVELOPE_KIND && Array.isArray(raw.phases);
}

/** Parse stored JSON for IT Project Implementation (migrates legacy flat checklists). */
export function parseItProjectSubKpis(raw: unknown, fallbackPhaseLabel?: string | null): ItProjectData {
  if (isItProjectEnvelope(raw)) {
    const phases = (raw.phases as unknown[])
      .map((p, i) => phaseFromRaw(p, `Phase ${i + 1}`))
      .filter((p): p is ItProjectPhase => p != null);
    const activePhaseId = String(raw.activePhaseId ?? "").trim();
    if (phases.length > 0) {
      const active = phases.find((p) => p.id === activePhaseId) ?? phases[0]!;
      return { activePhaseId: active.id, phases };
    }
  }

  const legacyFlat = collectAllSubKpiItems(normalizeSubKpis(raw));
  const phaseName = (fallbackPhaseLabel ?? "").trim() || "Phase 1";
  const id = crypto.randomUUID();
  return {
    activePhaseId: id,
    phases: [{ id, name: phaseName, items: legacyFlat }],
  };
}

export function wrapItProjectSubKpis(data: ItProjectData): Prisma.InputJsonValue {
  return {
    kind: IT_PROJECT_ENVELOPE_KIND,
    activePhaseId: data.activePhaseId,
    phases: data.phases.map((p) => ({
      id: p.id,
      name: p.name,
      ...(p.dueDate ? { dueDate: p.dueDate } : {}),
      ...(p.assignedAgentId ? { assignedAgentId: p.assignedAgentId } : {}),
      ...(p.assignedAgentName ? { assignedAgentName: p.assignedAgentName } : {}),
      ...(p.lastDelayNotifiedOn ? { lastDelayNotifiedOn: p.lastDelayNotifiedOn } : {}),
      items: p.items.map((it) => ({
        id: it.id,
        title: it.title,
        done: hasValidActualDate(it),
        ...(it.assignedAgentId ? { assignedAgentId: it.assignedAgentId } : {}),
        ...(it.assignedAgentName ? { assignedAgentName: it.assignedAgentName } : {}),
        ...(it.projectPriority ? { projectPriority: it.projectPriority } : {}),
        ...(it.projectStatus ? { projectStatus: it.projectStatus } : {}),
        ...(it.beforeScreenshot ? { beforeScreenshot: it.beforeScreenshot } : {}),
        ...(it.afterScreenshot ? { afterScreenshot: it.afterScreenshot } : {}),
        ...(it.startDate ? { startDate: it.startDate } : {}),
        ...(it.dueDate ? { dueDate: it.dueDate } : {}),
        ...(it.actualDate ? { actualDate: it.actualDate } : {}),
        ...(it.startedAt ? { startedAt: it.startedAt } : {}),
        ...(it.endedAt ? { endedAt: it.endedAt } : {}),
        ...(typeof it.startedLatitude === "number" ? { startedLatitude: it.startedLatitude } : {}),
        ...(typeof it.startedLongitude === "number" ? { startedLongitude: it.startedLongitude } : {}),
        ...(typeof it.endedLatitude === "number" ? { endedLatitude: it.endedLatitude } : {}),
        ...(typeof it.endedLongitude === "number" ? { endedLongitude: it.endedLongitude } : {}),
        ...(typeof it.dailyPenaltyAmount === "number" ? { dailyPenaltyAmount: it.dailyPenaltyAmount } : {}),
        ...(it.delayPenaltyFrequency ? { delayPenaltyFrequency: it.delayPenaltyFrequency } : {}),
        ...(it.assistanceRequested ? { assistanceRequested: true } : {}),
        ...(it.assistanceRequestedAt ? { assistanceRequestedAt: it.assistanceRequestedAt } : {}),
        ...(it.assistanceRequestedBy ? { assistanceRequestedBy: it.assistanceRequestedBy } : {}),
      })),
    })),
  } as Prisma.InputJsonValue;
}

export function itProjectAllItems(data: ItProjectData): SubKpiItem[] {
  return data.phases.flatMap((p) => p.items);
}

export function itProjectChecklistItems(subKpis: unknown): SubKpiItem[] {
  return isItProjectEnvelope(subKpis)
    ? itProjectAllItems(parseItProjectSubKpis(subKpis))
    : collectAllSubKpiItems(normalizeSubKpis(subKpis));
}

function endOfDueDayMs(dueYmd: string, timeZone: string): number | null {
  const dt = DateTime.fromISO(dueYmd, { zone: normalizeTimeZone(timeZone) }).endOf("day");
  if (!dt.isValid) return null;
  return dt.toMillis();
}

/** Sub-task is delayed when actual completion is after due, or work is incomplete past due. */
export function isItProjectSubTaskComplete(item: SubKpiItem): boolean {
  return hasValidActualDate(item);
}

export function isItProjectSubTaskDelayed(
  item: SubKpiItem,
  nowMs: number,
  timeZone: string,
): boolean {
  const due = normalizeOptionalUsDate(item.dueDate);
  if (!due) return false;
  const actual = normalizeOptionalUsDate(item.actualDate);
  if (actual) return actual > due;
  if (item.done) return false;
  const endMs = endOfDueDayMs(due, timeZone);
  if (endMs == null) return false;
  return nowMs > endMs;
}

export function itProjectHasAnyDelay(subKpis: unknown, nowMs: number, timeZone: string): boolean {
  return itProjectChecklistItems(subKpis).some((it) => isItProjectSubTaskDelayed(it, nowMs, timeZone));
}

export function itProjectMaxDelayMs(subKpis: unknown, nowMs: number, timeZone: string): number {
  let maxDelay = 0;
  for (const it of itProjectChecklistItems(subKpis)) {
    const due = normalizeOptionalUsDate(it.dueDate);
    if (!due) continue;
    const endMs = endOfDueDayMs(due, timeZone);
    if (endMs == null) continue;
    const actual = normalizeOptionalUsDate(it.actualDate);
    if (actual && actual > due) {
      const actualStart = DateTime.fromISO(actual, { zone: normalizeTimeZone(timeZone) })
        .startOf("day")
        .toMillis();
      maxDelay = Math.max(maxDelay, Math.max(0, actualStart - endMs));
    } else if (!it.done && nowMs > endMs) {
      maxDelay = Math.max(maxDelay, nowMs - endMs);
    }
  }
  return maxDelay;
}

export type ItProjectSubKpiStatusCounts = {
  total: number;
  completedOnTime: number;
  delayed: number;
  pending: number;
};

/** Per sub-task: on-time complete vs delayed (includes late actual date or overdue incomplete). */
export function countItProjectSubKpiStatus(
  subKpis: unknown,
  nowMs: number,
  timeZone: string,
): ItProjectSubKpiStatusCounts {
  const items = itProjectChecklistItems(subKpis);
  let completedOnTime = 0;
  let delayed = 0;
  let pending = 0;
  for (const it of items) {
    if (isItProjectSubTaskDelayed(it, nowMs, timeZone)) {
      delayed += 1;
    } else if (hasValidActualDate(it)) {
      completedOnTime += 1;
    } else {
      pending += 1;
    }
  }
  return { total: items.length, completedOnTime, delayed, pending };
}

export function itProjectActivePhase(data: ItProjectData): ItProjectPhase {
  return data.phases.find((p) => p.id === data.activePhaseId) ?? data.phases[0]!;
}

export function itProjectChecklistProgressFromRaw(raw: unknown): KpiChecklistProgress {
  const data = parseItProjectSubKpis(raw);
  return kpiChecklistProgress(wrapItProjectSubKpis(data));
}

export type ItProjectPhaseProgress = {
  phaseId: string;
  phaseName: string;
  total: number;
  done: number;
  percent: number;
};

export type ItProjectAggregatedProgress = {
  phases: ItProjectPhaseProgress[];
  /** Mean of each phase's completion % (phases with sub-tasks only). */
  averagePercent: number;
  totalDone: number;
  totalItems: number;
};

export function itProjectPhaseProgressFromItems(phase: ItProjectPhase): ItProjectPhaseProgress {
  const total = phase.items.length;
  const done = phase.items.filter((it) => isItProjectSubTaskComplete(it)).length;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  return { phaseId: phase.id, phaseName: phase.name, total, done, percent };
}

export function itProjectAggregatedProgressFromRaw(
  raw: unknown,
  fallbackPhaseLabel?: string | null,
): ItProjectAggregatedProgress {
  const data = parseItProjectSubKpis(raw, fallbackPhaseLabel);
  const phases = data.phases.map(itProjectPhaseProgressFromItems);
  const withTasks = phases.filter((ph) => ph.total > 0);
  const averagePercent =
    withTasks.length > 0
      ? Math.round(withTasks.reduce((sum, ph) => sum + ph.percent, 0) / withTasks.length)
      : 0;
  const totalDone = phases.reduce((sum, ph) => sum + ph.done, 0);
  const totalItems = phases.reduce((sum, ph) => sum + ph.total, 0);
  return { phases, averagePercent, totalDone, totalItems };
}

export type ItProjectPhaseDraft = {
  name: string;
  dueDate?: string;
  items: Array<{ title: string; dueDate: string }>;
};

/** Latest subtask due date (YYYY-MM-DD), or null when none are set. */
export function phaseTargetDateFromSubtasks(
  phase: Pick<ItProjectPhase, "items">,
): string | null {
  let max: string | null = null;
  for (const it of phase.items) {
    const due = normalizeOptionalUsDate(it.dueDate);
    if (!due) continue;
    if (!max || due > max) max = due;
  }
  return max;
}

/** Phase's own target date (ignores main project target). */
export function resolvePhaseOwnTargetDate(phase: ItProjectPhase): string | null {
  return normalizeOptionalUsDate(phase.dueDate) ?? phaseTargetDateFromSubtasks(phase);
}

/**
 * Effective phase target for delay tracking.
 * Main project target (pillarDueDate) overrides the phase's own target when set.
 */
export function resolvePhaseEffectiveTargetDate(
  phase: ItProjectPhase,
  mainProjectDueDate?: string | null,
): string | null {
  const main = normalizeOptionalUsDate(mainProjectDueDate);
  if (main) return main;
  return resolvePhaseOwnTargetDate(phase);
}

/** Apply max-subtask-due as phase.dueDate when present; never clear an explicit phase target. */
export function syncPhaseDueFromSubtasks(phase: ItProjectPhase): ItProjectPhase {
  const derived = phaseTargetDateFromSubtasks(phase);
  const explicit = normalizeOptionalUsDate(phase.dueDate);
  if (derived && explicit) {
    return { ...phase, dueDate: derived > explicit ? derived : explicit };
  }
  if (derived) return { ...phase, dueDate: derived };
  if (explicit) return { ...phase, dueDate: explicit };
  const next = { ...phase };
  delete (next as { dueDate?: string }).dueDate;
  return next;
}

export function syncAllPhaseDueDates(data: ItProjectData): ItProjectData {
  return {
    ...data,
    phases: data.phases.map(syncPhaseDueFromSubtasks),
  };
}

/**
 * @deprecated Phase due now tracks the latest subtask due; kept for callers that still
 * validate pairings. Always returns true when either side is missing.
 */
export function isSubtaskDueWithinPhaseDue(
  subtaskDue: string | null | undefined,
  phaseDue: string | null | undefined,
): boolean {
  const sub = normalizeOptionalUsDate(subtaskDue);
  const phase = normalizeOptionalUsDate(phaseDue);
  if (!sub || !phase) return true;
  return true;
}

/** Phase due is derived from subtasks — no pairwise constraint to enforce. */
export function validateItProjectPhaseDueConstraints(
  _data: ItProjectData,
): { ok: true } | { ok: false; error: string } {
  return { ok: true };
}

export function buildItProjectFromPhaseDrafts(
  phasesInput: ItProjectPhaseDraft[],
): { ok: true; data: ItProjectData } | { ok: false; error: string } {
  if (!phasesInput.length) {
    return { ok: false, error: "Add at least one phase with sub-tasks." };
  }
  const phases: ItProjectPhase[] = [];
  for (let i = 0; i < phasesInput.length; i++) {
    const row = phasesInput[i]!;
    const name = row.name.trim() || `Phase ${i + 1}`;
    const items: SubKpiItem[] = [];
    for (const it of row.items) {
      const title = it.title.trim();
      const dueDate = normalizeOptionalUsDate(it.dueDate);
      if (!title) continue;
      if (!dueDate) {
        return { ok: false, error: `Each sub-task in "${name}" needs a due date (MM/DD/YYYY).` };
      }
      items.push({ id: crypto.randomUUID(), title, done: false, dueDate });
    }
    if (items.length === 0) {
      return { ok: false, error: `Phase "${name}" needs at least one sub-task with a due date.` };
    }
    const derivedDue = phaseTargetDateFromSubtasks({ items });
    // Prefer explicit phase due when later than derived; otherwise track latest subtask.
    const explicitPhaseDue = normalizeOptionalUsDate(row.dueDate);
    const phaseDue =
      explicitPhaseDue && (!derivedDue || explicitPhaseDue >= derivedDue)
        ? explicitPhaseDue
        : derivedDue;
    phases.push({
      id: crypto.randomUUID(),
      name,
      ...(phaseDue ? { dueDate: phaseDue } : {}),
      items,
    });
  }
  return { ok: true, data: { activePhaseId: phases[0]!.id, phases } };
}

/** True when this KPI row should use the Kanban Timeline Tracker. */
export function usesProjectTimelineTracker(subKpis: unknown): boolean {
  return isItProjectEnvelope(subKpis);
}

/**
 * Timeline Tracker projects (IT Project Implementation pillar OR any `it_project` envelope).
 * Job Order → Project cards keep a custom `title` but still store phases under the IT envelope —
 * assignee / meta / seek-assistance writers must use the envelope path, not checklist normalize.
 */
export function isTimelineProjectKpi(title: string, subKpis: unknown): boolean {
  return isItProjectImplementationPillar(title) || usesProjectTimelineTracker(subKpis);
}

/**
 * Seed an it_project phase envelope for JO-linked Projects (keeps existing envelope meta).
 * Uses existing flat checklist items when present; otherwise starts with an empty Phase 1.
 * When `targetDueDate` is set, applies it as the main project target and to phases/items missing dues.
 */
export function seedJoLinkedProjectTimeline(
  raw: unknown,
  opts?: { targetDueDate?: string | null },
): Prisma.InputJsonValue {
  const target = normalizeOptionalUsDate(opts?.targetDueDate);

  const applyTargetToPhases = (data: ItProjectData): ItProjectData => {
    if (!target) return data;
    // Fill missing phase targets from the main project date. Do not stamp the project
    // target onto every subtask — that would overwrite distinct phase dues via sync.
    return {
      ...data,
      phases: data.phases.map((phase) => ({
        ...phase,
        dueDate: normalizeOptionalUsDate(phase.dueDate) ?? target,
      })),
    };
  };

  const withMainTarget = (json: Prisma.InputJsonValue): Prisma.InputJsonValue => {
    if (!target || !isPlainObject(json)) return json;
    return { ...json, pillarDueDate: target } as Prisma.InputJsonValue;
  };

  if (isItProjectEnvelope(raw)) {
    const synced = applyTargetToPhases(parseItProjectSubKpis(raw));
    return withMainTarget(updateItProjectPhases(raw, synced));
  }

  // "Make Phases" create draft: named checklist segments → timeline phases.
  const norm = normalizeSubKpis(raw);
  if (norm.segmented) {
    const named = norm.segments.filter((seg) => !isUnsegmentedSegmentId(seg.id));
    const unassigned =
      norm.segments.find((seg) => isUnsegmentedSegmentId(seg.id))?.items.map((it) => ({ ...it })) ??
      [];
    if (named.length > 0 || unassigned.length > 0) {
      const phases: ItProjectPhase[] = [];
      if (named.length === 0) {
        let items = unassigned;
        if (target) {
          items = items.map((it) =>
            normalizeOptionalUsDate(it.dueDate) ? it : { ...it, dueDate: target },
          );
        }
        phases.push(
          items.length > 0
            ? syncPhaseDueFromSubtasks({
                id: crypto.randomUUID(),
                name: "Phase 1",
                ...(target ? { dueDate: target } : {}),
                items,
              })
            : {
                id: crypto.randomUUID(),
                name: "Phase 1",
                ...(target ? { dueDate: target } : {}),
                items,
              },
        );
      } else {
        for (let i = 0; i < named.length; i++) {
          const seg = named[i]!;
          let items = seg.items.map((it) => ({ ...it }));
          if (i === 0 && unassigned.length > 0) {
            items = [...unassigned, ...items];
          }
          const phaseDue = normalizeOptionalUsDate(seg.dueDate) ?? target;
          // Phase target is authoritative; do not wipe it when subtasks have no dues.
          phases.push({
            id: crypto.randomUUID(),
            name: seg.label.trim() || `Phase ${i + 1}`,
            ...(phaseDue ? { dueDate: phaseDue } : {}),
            items,
          });
        }
      }
      return withMainTarget(
        updateItProjectPhases(raw, {
          activePhaseId: phases[0]!.id,
          phases,
        }),
      );
    }
  }

  const flat = collectAllSubKpiItems(norm);
  let items: SubKpiItem[] = flat.length > 0 ? flat.map((it) => ({ ...it })) : [];
  if (target) {
    items = items.map((it) =>
      normalizeOptionalUsDate(it.dueDate) ? it : { ...it, dueDate: target },
    );
  }
  const phaseId = crypto.randomUUID();
  const phaseBase: ItProjectPhase = {
    id: phaseId,
    name: "Phase 1",
    ...(target ? { dueDate: target } : {}),
    items,
  };
  // Keep explicit JO target on empty phases; sync only when subtasks can derive a due.
  const phase =
    items.length > 0 ? syncPhaseDueFromSubtasks(phaseBase) : phaseBase;
  return withMainTarget(updateItProjectPhases(raw, { activePhaseId: phaseId, phases: [phase] }));
}

/** True when any timeline phase is past its target and still incomplete. */
export function itProjectHasAnyPhaseDelay(
  subKpis: unknown,
  nowMs: number,
  timeZone: string,
  mainProjectDueDate?: string | null,
): boolean {
  if (!isItProjectEnvelope(subKpis)) return false;
  return parseItProjectSubKpis(subKpis).phases.some((phase) =>
    isItProjectPhaseDelayed(phase, timeZone, nowMs, mainProjectDueDate),
  );
}

export function isItProjectPhaseComplete(phase: ItProjectPhase): boolean {
  if (phase.items.length === 0) return false;
  return phase.items.every((it) => isItProjectSubTaskComplete(it));
}

/** Phase is delayed when target date is before today and phase is incomplete. */
export function isItProjectPhaseDelayed(
  phase: ItProjectPhase,
  timeZone = "Asia/Manila",
  nowMs: number = Date.now(),
  mainProjectDueDate?: string | null,
): boolean {
  if (isItProjectPhaseComplete(phase)) return false;
  const target = resolvePhaseEffectiveTargetDate(phase, mainProjectDueDate);
  if (!target) return false;
  const today = DateTime.fromMillis(nowMs)
    .setZone(normalizeTimeZone(timeZone))
    .toFormat("yyyy-MM-dd");
  return target < today;
}

export function phaseDelayNotifyAssignees(
  phase: ItProjectPhase,
  cardAssignedAgentId?: string | null,
): string[] {
  if (phase.assignedAgentId?.trim()) {
    return [phase.assignedAgentId.trim()];
  }
  const fromItems = phase.items
    .filter((it) => !isItProjectSubTaskComplete(it))
    .map((it) => it.assignedAgentId?.trim())
    .filter((id): id is string => Boolean(id));
  if (fromItems.length > 0) return [...new Set(fromItems)];
  const card = cardAssignedAgentId?.trim();
  return card ? [card] : [];
}

export type PhaseDelayNotification = {
  phaseId: string;
  phaseName: string;
  targetDate: string;
  agentIds: string[];
};

/**
 * Mark delayed phases as notified for today (dedupe). Returns updated JSON + new alerts.
 */
export function applyPhaseDelayNotifications(
  raw: unknown,
  opts: {
    timeZone?: string;
    nowMs?: number;
    cardAssignedAgentId?: string | null;
    mainProjectDueDate?: string | null;
  } = {},
): { json: Prisma.InputJsonValue; notifications: PhaseDelayNotification[] } {
  const timeZone = opts.timeZone ?? "Asia/Manila";
  const nowMs = opts.nowMs ?? Date.now();
  const today = DateTime.fromMillis(nowMs)
    .setZone(normalizeTimeZone(timeZone))
    .toFormat("yyyy-MM-dd");
  const data = syncAllPhaseDueDates(parseItProjectSubKpis(raw));
  const notifications: PhaseDelayNotification[] = [];
  const phases = data.phases.map((phase) => {
    if (!isItProjectPhaseDelayed(phase, timeZone, nowMs, opts.mainProjectDueDate)) return phase;
    const target = resolvePhaseEffectiveTargetDate(phase, opts.mainProjectDueDate) ?? "";
    if (!target) return phase;
    if (phase.lastDelayNotifiedOn === today) return phase;
    const agentIds = phaseDelayNotifyAssignees(phase, opts.cardAssignedAgentId);
    if (agentIds.length === 0) return phase;
    notifications.push({
      phaseId: phase.id,
      phaseName: phase.name,
      targetDate: target,
      agentIds,
    });
    return { ...phase, lastDelayNotifiedOn: today };
  });
  return {
    json: updateItProjectPhases(raw, { ...data, phases }),
    notifications,
  };
}

function mapPhases(
  data: ItProjectData,
  fn: (phase: ItProjectPhase) => ItProjectPhase,
): ItProjectData {
  const phases = data.phases.map(fn);
  const activeStill = phases.some((p) => p.id === data.activePhaseId);
  return {
    activePhaseId: activeStill ? data.activePhaseId : (phases[0]?.id ?? data.activePhaseId),
    phases,
  };
}

/** Keep task-level envelope fields (penalty rate/frequency, priority, etc.) across phase rewrites. */
function mergeItProjectEnvelopeMeta(
  raw: unknown,
  wrapped: Prisma.InputJsonValue,
): Prisma.InputJsonValue {
  if (!isPlainObject(raw)) return wrapped;
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === "kind" || key === "activePhaseId" || key === "phases") continue;
    rest[key] = value;
  }
  return { ...rest, ...(wrapped as Record<string, unknown>) } as Prisma.InputJsonValue;
}

export function setItProjectActivePhase(raw: unknown, phaseId: string): Prisma.InputJsonValue {
  const data = parseItProjectSubKpis(raw);
  if (!data.phases.some((p) => p.id === phaseId)) {
    return mergeItProjectEnvelopeMeta(raw, wrapItProjectSubKpis(data));
  }
  return mergeItProjectEnvelopeMeta(
    raw,
    wrapItProjectSubKpis({ ...data, activePhaseId: phaseId }),
  );
}

export function updateItProjectPhases(
  raw: unknown,
  next: ItProjectData,
): Prisma.InputJsonValue {
  if (!next.phases.length) {
    return mergeItProjectEnvelopeMeta(raw, wrapItProjectSubKpis(parseItProjectSubKpis(raw)));
  }
  const activeStill = next.phases.some((p) => p.id === next.activePhaseId);
  return mergeItProjectEnvelopeMeta(
    raw,
    wrapItProjectSubKpis({
      activePhaseId: activeStill ? next.activePhaseId : next.phases[0]!.id,
      phases: next.phases,
    }),
  );
}

/** Set or clear a phase's own target date (does not change subtask dues). */
export function setItProjectPhaseDueDate(
  raw: unknown,
  phaseId: string,
  dueDate: string | null,
): Prisma.InputJsonValue {
  const data = parseItProjectSubKpis(raw);
  const due = normalizeOptionalUsDate(dueDate);
  const phases = data.phases.map((phase) => {
    if (phase.id !== phaseId) return phase;
    if (due) return { ...phase, dueDate: due };
    const next = { ...phase };
    delete (next as { dueDate?: string }).dueDate;
    return next;
  });
  return updateItProjectPhases(raw, { ...data, phases });
}

export function setItProjectSubKpiSchedule(
  raw: unknown,
  subKpiId: string,
  meta: { dueDate?: string | null; actualDate?: string | null; startDate?: string | null },
): Prisma.InputJsonValue {
  const data = parseItProjectSubKpis(raw);
  const due = meta.dueDate === undefined ? undefined : normalizeOptionalUsDate(meta.dueDate);
  const act = meta.actualDate === undefined ? undefined : normalizeOptionalUsDate(meta.actualDate);
  const start = meta.startDate === undefined ? undefined : normalizeOptionalUsDate(meta.startDate);

  const touch = (it: SubKpiItem): SubKpiItem => {
    if (it.id !== subKpiId) return it;
    let next = { ...it };
    if (due !== undefined) {
      if (due) {
        next = { ...next, dueDate: due };
      } else delete (next as { dueDate?: string }).dueDate;
    }
    if (start !== undefined) {
      if (start) next = { ...next, startDate: start };
      else delete (next as { startDate?: string }).startDate;
    }
    if (act !== undefined) {
      if (act) {
        next = { ...next, actualDate: act, done: true };
      } else {
        delete (next as { actualDate?: string }).actualDate;
        next = { ...next, done: false };
      }
    }
    if (!hasValidActualDate(next)) {
      next = { ...next, done: false };
    } else if (!next.done) {
      next = { ...next, done: true };
    }
    return next;
  };

  const next = syncAllPhaseDueDates(
    mapPhases(data, (phase) => ({
      ...phase,
      items: phase.items.map(touch),
    })),
  );

  return updateItProjectPhases(raw, next);
}

export type SubKpiLifecycleGps = {
  latitude?: number | null;
  longitude?: number | null;
  capturedAt?: string | null;
};

/** Start / End lifecycle for an IT project sub-task (calendar day + optional GPS). */
export function setItProjectSubKpiLifecycle(
  raw: unknown,
  subKpiId: string,
  action: "start" | "end",
  timeZone = "Asia/Manila",
  gps?: SubKpiLifecycleGps | null,
): { ok: true; json: Prisma.InputJsonValue } | { ok: false; error: string } {
  const data = parseItProjectSubKpis(raw);
  const zone = normalizeTimeZone(timeZone);
  const now = DateTime.now().setZone(zone);
  const today = now.toFormat("yyyy-MM-dd");
  const capturedAt =
    typeof gps?.capturedAt === "string" && gps.capturedAt.trim()
      ? gps.capturedAt.trim()
      : now.toISO();
  const lat =
    typeof gps?.latitude === "number" && Number.isFinite(gps.latitude) ? gps.latitude : null;
  const lng =
    typeof gps?.longitude === "number" && Number.isFinite(gps.longitude) ? gps.longitude : null;
  let found = false;

  const touch = (it: SubKpiItem): SubKpiItem => {
    if (it.id !== subKpiId) return it;
    found = true;
    if (action === "start") {
      if (normalizeOptionalUsDate(it.startDate) || hasValidActualDate(it) || it.startedAt) {
        return it;
      }
      return {
        ...it,
        startDate: today,
        startedAt: capturedAt ?? now.toISO(),
        ...(lat != null ? { startedLatitude: lat } : {}),
        ...(lng != null ? { startedLongitude: lng } : {}),
        projectStatus: normalizeItProjectStatus(it.projectStatus) === "Done" ? "Done" : "On Going",
      };
    }
    // end
    if (!normalizeOptionalUsDate(it.startDate) && !it.startedAt && !hasValidActualDate(it)) {
      return it;
    }
    return {
      ...it,
      actualDate: today,
      done: true,
      endedAt: capturedAt ?? now.toISO(),
      ...(lat != null ? { endedLatitude: lat } : {}),
      ...(lng != null ? { endedLongitude: lng } : {}),
      projectStatus: "Done",
      ...(normalizeOptionalUsDate(it.startDate) || it.startedAt
        ? {}
        : { startDate: today, startedAt: capturedAt ?? now.toISO() }),
    };
  };

  const next = mapPhases(data, (phase) => ({
    ...phase,
    items: phase.items.map(touch),
  }));

  if (!found) return { ok: false, error: "Sub-task not found." };

  const target = itProjectAllItems(next).find((it) => it.id === subKpiId);
  if (action === "start" && target && !normalizeOptionalUsDate(target.startDate) && !target.startedAt) {
    return { ok: false, error: "Could not start this sub-task." };
  }
  if (action === "end") {
    const prev = itProjectAllItems(data).find((it) => it.id === subKpiId);
    if (
      prev &&
      !normalizeOptionalUsDate(prev.startDate) &&
      !prev.startedAt &&
      !hasValidActualDate(prev)
    ) {
      return { ok: false, error: "Start the sub-task before ending it." };
    }
    if (prev && (hasValidActualDate(prev) || prev.endedAt)) {
      return { ok: false, error: "Sub-task is already completed." };
    }
  }

  return { ok: true, json: updateItProjectPhases(raw, next) };
}

export function findItProjectPhaseForSubKpi(
  data: ItProjectData,
  subKpiId: string,
): ItProjectPhase | null {
  return data.phases.find((p) => p.items.some((it) => it.id === subKpiId)) ?? null;
}

/** Move a sub-task into another phase (Timeline Tracker). */
export function moveItProjectSubKpiToPhase(
  raw: unknown,
  subKpiId: string,
  targetPhaseId: string,
): { ok: true; json: Prisma.InputJsonValue } | { ok: false; error: string } {
  const id = String(subKpiId ?? "").trim();
  const phaseId = String(targetPhaseId ?? "").trim();
  if (!id) return { ok: false, error: "Sub-task id is required." };
  if (!phaseId) return { ok: false, error: "Phase id is required." };

  const data = parseItProjectSubKpis(raw);
  if (!data.phases.some((p) => p.id === phaseId)) {
    return { ok: false, error: "Phase not found." };
  }

  let moved: SubKpiItem | null = null;
  const stripped = data.phases.map((phase) => {
    const idx = phase.items.findIndex((it) => it.id === id);
    if (idx < 0) return phase;
    moved = phase.items[idx]!;
    return { ...phase, items: phase.items.filter((it) => it.id !== id) };
  });
  if (!moved) return { ok: false, error: "Sub-task not found." };

  const phases = stripped.map((phase) =>
    phase.id === phaseId ? { ...phase, items: [...phase.items, moved!] } : phase,
  );
  return {
    ok: true,
    json: updateItProjectPhases(raw, { ...data, phases }),
  };
}

export function setItProjectSubKpiAssignee(
  raw: unknown,
  subKpiId: string,
  assignee: { id: string; name: string } | null,
): Prisma.InputJsonValue {
  const data = parseItProjectSubKpis(raw);
  const touch = (it: SubKpiItem): SubKpiItem => {
    if (it.id !== subKpiId) return it;
    const next = { ...it };
    if (assignee) {
      next.assignedAgentId = assignee.id;
      next.assignedAgentName = assignee.name;
      next.projectStatus = normalizeItProjectStatus(next.projectStatus) ?? "Pending";
    } else {
      delete next.assignedAgentId;
      delete next.assignedAgentName;
      if (next.projectStatus === "Pending") delete next.projectStatus;
    }
    return next;
  };
  return updateItProjectPhases(
    raw,
    mapPhases(data, (phase) => ({
      ...phase,
      items: phase.items.map(touch),
    })),
  );
}

export function setItProjectSubKpiAssistanceRequested(
  raw: unknown,
  subKpiId: string,
  byAgentId: string,
  atIso: string = new Date().toISOString(),
): Prisma.InputJsonValue | null {
  return setItProjectSubKpiItemsAssistanceRequested(raw, [subKpiId], byAgentId, atIso);
}

/** Mark Seek Assistance on one or more IT Project sub-tasks. Returns null if any id is missing. */
export function setItProjectSubKpiItemsAssistanceRequested(
  raw: unknown,
  subKpiIds: string[],
  byAgentId: string,
  atIso: string = new Date().toISOString(),
): Prisma.InputJsonValue | null {
  const idSet = new Set(subKpiIds.map((id) => String(id ?? "").trim()).filter(Boolean));
  if (idSet.size === 0) return null;
  const data = parseItProjectSubKpis(raw);
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
  const next = updateItProjectPhases(
    raw,
    mapPhases(data, (phase) => ({
      ...phase,
      items: phase.items.map(touch),
    })),
  );
  return found.size === idSet.size ? next : null;
}

export function setItProjectSubKpiDone(
  raw: unknown,
  subKpiId: string,
  done: boolean,
): { ok: true; json: Prisma.InputJsonValue } | { ok: false; error: string } {
  const data = parseItProjectSubKpis(raw);
  let found = false;

  const touch = (it: SubKpiItem): SubKpiItem => {
    if (it.id !== subKpiId) return it;
    found = true;
    if (!done) {
      const cleared = { ...it, done: false };
      delete (cleared as { actualDate?: string }).actualDate;
      return cleared;
    }
    if (!hasValidActualDate(it)) {
      return it;
    }
    return { ...it, done: true };
  };

  const next = mapPhases(data, (phase) => ({
    ...phase,
    items: phase.items.map(touch),
  }));

  if (!found) return { ok: false, error: "Sub-task not found." };
  const target = itProjectAllItems(next).find((it) => it.id === subKpiId);
  if (done && target && !hasValidActualDate(target)) {
    return {
      ok: false,
      error: "Enter an actual date (MM/DD/YYYY) before marking this sub-task complete.",
    };
  }

  return { ok: true, json: updateItProjectPhases(raw, next) };
}

export function setItProjectSubKpiPenalty(
  raw: unknown,
  subKpiId: string,
  meta: {
    dailyPenaltyAmount?: number | null;
    delayPenaltyFrequency?: string | null;
  },
): { ok: true; json: Prisma.InputJsonValue } | { ok: false; error: string } {
  const data = parseItProjectSubKpis(raw);
  let found = false;
  const touch = (it: SubKpiItem): SubKpiItem => {
    if (it.id !== subKpiId) return it;
    found = true;
    let next = { ...it };
    if (meta.dailyPenaltyAmount !== undefined) {
      if (
        typeof meta.dailyPenaltyAmount === "number" &&
        Number.isFinite(meta.dailyPenaltyAmount) &&
        meta.dailyPenaltyAmount >= 0
      ) {
        next = { ...next, dailyPenaltyAmount: meta.dailyPenaltyAmount };
      } else {
        delete (next as { dailyPenaltyAmount?: number }).dailyPenaltyAmount;
      }
    }
    if (meta.delayPenaltyFrequency !== undefined) {
      if (meta.delayPenaltyFrequency == null || meta.delayPenaltyFrequency === "") {
        delete (next as { delayPenaltyFrequency?: string }).delayPenaltyFrequency;
      } else {
        next = {
          ...next,
          delayPenaltyFrequency: normalizeDelayPenaltyFrequency(meta.delayPenaltyFrequency),
        };
      }
    }
    return next;
  };
  const next = mapPhases(data, (phase) => ({
    ...phase,
    items: phase.items.map(touch),
  }));
  if (!found) return { ok: false, error: "Sub-task not found." };
  return { ok: true, json: updateItProjectPhases(raw, next) };
}

export function setItProjectSubKpiTitle(
  raw: unknown,
  subKpiId: string,
  title: string,
): { ok: true; json: Prisma.InputJsonValue } | { ok: false; error: string } {
  const nextTitle = title.trim();
  if (!nextTitle) {
    return { ok: false, error: "Sub-task title is required." };
  }
  const data = parseItProjectSubKpis(raw);
  let found = false;
  const touch = (it: SubKpiItem): SubKpiItem => {
    if (it.id !== subKpiId) return it;
    found = true;
    return { ...it, title: nextTitle };
  };
  const next = mapPhases(data, (phase) => ({
    ...phase,
    items: phase.items.map(touch),
  }));
  if (!found) return { ok: false, error: "Sub-task not found." };
  return { ok: true, json: updateItProjectPhases(raw, next) };
}

export function setItProjectSubKpiProjectMeta(
  raw: unknown,
  subKpiId: string,
  meta: { projectPriority?: unknown; projectStatus?: unknown },
): { ok: true; json: Prisma.InputJsonValue } | { ok: false; error: string } {
  const data = parseItProjectSubKpis(raw);
  const priority = meta.projectPriority === undefined ? undefined : normalizeItProjectPriority(meta.projectPriority);
  const status = meta.projectStatus === undefined ? undefined : normalizeItProjectStatus(meta.projectStatus);

  if (meta.projectPriority !== undefined && !priority) {
    return { ok: false, error: "Priority must be High, Medium, or Low." };
  }
  if (meta.projectStatus !== undefined && !status) {
    return { ok: false, error: "Completion status must be Pending, On Going, Finalizing, or Done." };
  }

  let found = false;
  const touch = (it: SubKpiItem): SubKpiItem => {
    if (it.id !== subKpiId) return it;
    found = true;
    let next = { ...it };
    if (priority !== undefined) next = { ...next, projectPriority: priority };
    if (status !== undefined) {
      next = { ...next, projectStatus: status, done: status === "Done" };
      if (status === "Done" && !hasValidActualDate(next)) {
        next.actualDate = DateTime.now().toFormat("yyyy-MM-dd");
      }
      if (status !== "Done" && next.actualDate && next.done) {
        delete (next as { actualDate?: string }).actualDate;
      }
    }
    return next;
  };

  const next = mapPhases(data, (phase) => ({
    ...phase,
    items: phase.items.map(touch),
  }));

  if (!found) return { ok: false, error: "Sub-task not found." };
  return { ok: true, json: updateItProjectPhases(raw, next) };
}
