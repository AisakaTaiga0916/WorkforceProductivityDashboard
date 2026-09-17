import {
  getPeriodEndExclusiveFromCycleStart,
  getRolloverEligibleAfterCompletion,
  normalizeTimeZone,
} from "@/lib/kpi-recurrence";
import { DateTime } from "luxon";
import type { KpiFrequencyCode } from "@/lib/kpi-recurrence";
import {
  itProjectHasAnyDelay,
  itProjectHasAnyPhaseDelay,
  itProjectMaxDelayMs,
  usesProjectTimelineTracker,
} from "@/lib/it-project-subkpis";
import { isItProjectImplementationPillar } from "@/lib/it-task-pillar-titles";
import {
  collectChecklistProgressItems,
  getTaskTargetDueDate,
  resolveEffectiveSubKpiDueDate,
  subKpiHasCustomDueDate,
  type SubKpiItem,
} from "@/lib/kpi-subkpis";
import { subKpiRequirementsMet } from "@/lib/sub-kpi-completion-mode";
import {
  boardStatusAfterChecklistComplete,
  type CompletionVerificationFields,
  type KpiBoardLaneStatus,
} from "@/lib/task-completion-verification";

const YMD = /^\d{4}-\d{2}-\d{2}$/;

function isTimelineBoardRecord(record: { title?: string | null; subKpis?: unknown }): boolean {
  return (
    isItProjectImplementationPillar(String(record.title ?? "")) ||
    usesProjectTimelineTracker(record.subKpis)
  );
}

function parseSubKpiYmd(value: unknown, timeZone: string): DateTime | null {
  if (typeof value !== "string" || !YMD.test(value.trim())) return null;
  const dt = DateTime.fromISO(value.trim(), { zone: normalizeTimeZone(timeZone) }).startOf("day");
  return dt.isValid ? dt : null;
}

/** When incomplete non-recurring work becomes delayed: midnight on the day after target date. */
export function nonRecurringDelayStartExclusive(dueDateYmd: string, timeZone: string): Date | null {
  const zone = normalizeTimeZone(timeZone);
  const due = DateTime.fromISO(dueDateYmd.trim(), { zone }).startOf("day");
  if (!due.isValid) return null;
  return due.plus({ days: 1 }).startOf("day").toJSDate();
}

export function isNonRecurringSubKpiDelayed(
  item: SubKpiItem,
  nowMs: number,
  timeZone: string,
  parentDueYmd?: string | null,
): boolean {
  const effective = resolveEffectiveSubKpiDueDate(item, parentDueYmd).dueDate;
  const due = parseSubKpiYmd(effective, timeZone);
  if (!due) return false;
  const delayStart = nonRecurringDelayStartExclusive(due.toISODate()!, timeZone);
  if (!delayStart) return false;
  const delayStartMs = delayStart.getTime();
  const actual = parseSubKpiYmd(item.actualDate, timeZone);
  const complete = subKpiRequirementsMet(item);
  if (actual) {
    return actual.toMillis() >= delayStartMs;
  }
  if (complete) return false;
  return nowMs >= delayStartMs;
}

export function nonRecurringTaskHasDelay(
  subKpis: unknown,
  nowMs: number,
  timeZone: string,
): boolean {
  const parentDue = getTaskTargetDueDate(subKpis);
  return collectChecklistProgressItems(subKpis).some((item) =>
    isNonRecurringSubKpiDelayed(item, nowMs, timeZone, parentDue),
  );
}

export function nonRecurringTaskMaxDelayMs(
  subKpis: unknown,
  nowMs: number,
  timeZone: string,
): number {
  const zone = normalizeTimeZone(timeZone);
  const parentDue = getTaskTargetDueDate(subKpis);
  let maxDelay = 0;
  for (const item of collectChecklistProgressItems(subKpis)) {
    const effective = resolveEffectiveSubKpiDueDate(item, parentDue).dueDate;
    const due = parseSubKpiYmd(effective, zone);
    if (!due) continue;
    const delayStart = nonRecurringDelayStartExclusive(due.toISODate()!, zone);
    if (!delayStart) continue;
    const delayStartMs = delayStart.getTime();
    const actual = parseSubKpiYmd(item.actualDate, zone);
    if (actual) {
      if (actual.toMillis() >= delayStartMs) {
        maxDelay = Math.max(maxDelay, actual.toMillis() - delayStartMs);
      }
    } else if (!subKpiRequirementsMet(item) && nowMs >= delayStartMs) {
      maxDelay = Math.max(maxDelay, nowMs - delayStartMs);
    }
  }
  return maxDelay;
}

/** Earliest delay boundary among incomplete sub-tasks (for board cycle copy). */
export function nonRecurringTaskDelayDeadline(subKpis: unknown, timeZone: string): Date | null {
  const parentDue = getTaskTargetDueDate(subKpis);
  let earliestMs: number | null = null;
  for (const item of collectChecklistProgressItems(subKpis)) {
    if (subKpiRequirementsMet(item)) continue;
    const effective = resolveEffectiveSubKpiDueDate(item, parentDue).dueDate;
    const due = parseSubKpiYmd(effective, timeZone);
    if (!due) continue;
    const delayStart = nonRecurringDelayStartExclusive(due.toISODate()!, timeZone);
    if (!delayStart) continue;
    const ms = delayStart.getTime();
    if (earliestMs == null || ms < earliestMs) earliestMs = ms;
  }
  return earliestMs != null ? new Date(earliestMs) : null;
}

export type KpiMaintenanceLike = {
  isRecurring?: boolean | null;
  frequency: KpiFrequencyCode;
  recurrenceWeekday?: number | null;
  recurrenceMonthDay?: number | null;
  nonRecurringStartAt?: unknown;
  nonRecurringEndAt?: unknown;
  periodCycleStartAt?: unknown;
  /** Pillar title — overdue → Delayed applies only to IT Project Implementation. */
  title?: string | null;
};

export function toJsDateMaybe(v: unknown): Date | null {
  if (v == null) return null;
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v : null;
  const d = new Date(typeof v === "string" ? v : String(v));
  return Number.isFinite(d.getTime()) ? d : null;
}

/** Active recurring cycle deadline — after this instant, incomplete work is overdue / Delayed column. */
export function recurringDeadlineExclusive(record: KpiMaintenanceLike, timeZone: string): Date | null {
  const start = toJsDateMaybe(record.periodCycleStartAt);
  if (!start) return null;
  return getPeriodEndExclusiveFromCycleStart(
    start,
    record.frequency,
    record.recurrenceWeekday,
    record.recurrenceMonthDay,
    normalizeTimeZone(timeZone),
  );
}

export function nonRecurringDeadline(record: Pick<KpiMaintenanceLike, "nonRecurringEndAt">): Date | null {
  return toJsDateMaybe(record.nonRecurringEndAt);
}

/** Max overdue ms for IT Project (incomplete past due or actual date after due). */
export function itProjectIncompleteOverdueMs(
  subKpis: unknown,
  nowMs: number,
  timeZone: string,
): number {
  return itProjectMaxDelayMs(subKpis, nowMs, timeZone);
}

export function incompletePastDeadlineDelayMs(
  record: KpiMaintenanceLike & { subKpis?: unknown },
  nowMs: number,
  timeZone: string,
): number {
  if (isTimelineBoardRecord(record)) {
    return itProjectIncompleteOverdueMs(record.subKpis, nowMs, timeZone);
  }
  if (record.isRecurring === false) {
    return nonRecurringTaskMaxDelayMs(record.subKpis, nowMs, timeZone);
  }
  const deadline = recurringDeadlineExclusive(record, timeZone);
  if (!deadline) return 0;
  const end = deadline.getTime();
  if (!Number.isFinite(end) || nowMs < end) return 0;
  return Math.max(0, nowMs - end);
}

export function recurringDoneDelayedMs(
  record: KpiMaintenanceLike & { subKpis?: unknown },
  timeZone: string,
  doneAtMs: number,
): number {
  if (isTimelineBoardRecord(record)) {
    return itProjectMaxDelayMs(record.subKpis, doneAtMs, timeZone);
  }
  const deadline =
    record.isRecurring === false
      ? nonRecurringDeadline(record)
      : recurringDeadlineExclusive(record, timeZone);
  if (!deadline) return 0;
  const end = deadline.getTime();
  if (!Number.isFinite(end) || doneAtMs <= end) return 0;
  return Math.max(0, doneAtMs - end);
}

/** Board column: timeline / IT project and non-recurring tasks land in Delayed from phase/sub-task targets. */
export function taskKanbanDerivedStatus(
  record: KpiMaintenanceLike & { subKpis?: unknown } & CompletionVerificationFields,
  args: { total: number; done: number; nowMs: number; timeZone: string },
): KpiBoardLaneStatus {
  const { total, done, nowMs, timeZone } = args;
  if (total === 0) return "CURRENT";
  if (isTimelineBoardRecord(record)) {
    if (
      itProjectHasAnyPhaseDelay(
        record.subKpis,
        nowMs,
        timeZone,
        getTaskTargetDueDate(record.subKpis),
      ) ||
      itProjectHasAnyDelay(record.subKpis, nowMs, timeZone)
    ) {
      return "DELAYED";
    }
    if (done === total) return boardStatusAfterChecklistComplete(record);
    return "CURRENT";
  }
  if (record.isRecurring === false && nonRecurringTaskHasDelay(record.subKpis, nowMs, timeZone)) {
    return "DELAYED";
  }
  if (record.isRecurring !== false && recurringTaskHasDelay(record, nowMs, timeZone)) {
    return "DELAYED";
  }
  if (done === total) return boardStatusAfterChecklistComplete(record);
  return "CURRENT";
}

export function nextRolloverEligibleAtUtc(
  lastFullCompletionAt: Date | null,
  timeZone: string,
  /** When set (recurring W/M/Q), completion can roll over immediately. Omit for Daily / one-off archive delay. */
  frequency?: KpiFrequencyCode | null,
): Date | null {
  if (!lastFullCompletionAt || !Number.isFinite(lastFullCompletionAt.getTime())) return null;
  return getRolloverEligibleAfterCompletion(lastFullCompletionAt, timeZone, frequency);
}

/**
 * Incomplete recurring checklists stay on the board (Delayed) for this many calendar days
 * after the cycle deadline before they may roll into the next period.
 */
export const RECURRING_INCOMPLETE_ROLLOVER_HOLD_DAYS = 10;

/**
 * The incomplete-cycle rollover hold applies only to MONTHLY / QUARTERLY / SEMI_ANNUAL / YEARLY
 * cadences. DAILY and WEEKLY cycles roll into the next period immediately once stale.
 */
export function recurringIncompleteRolloverHoldDays(
  frequency: KpiFrequencyCode | null | undefined,
): number {
  return frequency === "MONTHLY" ||
    frequency === "QUARTERLY" ||
    frequency === "SEMI_ANNUAL" ||
    frequency === "YEARLY"
    ? RECURRING_INCOMPLETE_ROLLOVER_HOLD_DAYS
    : 0;
}

/** Earliest instant an incomplete recurring cycle may reset after its period deadline. */
export function recurringIncompleteRolloverEligibleAt(
  cycleDeadlineExclusive: Date,
  timeZone: string,
  holdDays: number = RECURRING_INCOMPLETE_ROLLOVER_HOLD_DAYS,
): Date {
  const zone = normalizeTimeZone(timeZone);
  const deadline = DateTime.fromMillis(cycleDeadlineExclusive.getTime(), { zone }).startOf("day");
  const days = Math.max(0, Math.floor(holdDays));
  return deadline.plus({ days }).toJSDate();
}

/**
 * Recurring work is delayed when incomplete past a custom sub-task target, or past the
 * cycle deadline (when no custom due / still incomplete at period end).
 */
export function recurringTaskHasDelay(
  record: KpiMaintenanceLike & { subKpis?: unknown },
  nowMs: number,
  timeZone: string,
): boolean {
  if (record.isRecurring === false) return false;
  const zone = normalizeTimeZone(timeZone);
  const parentDue = getTaskTargetDueDate(record.subKpis);
  const items = collectChecklistProgressItems(record.subKpis);
  for (const item of items) {
    if (subKpiRequirementsMet(item)) continue;
    if (subKpiHasCustomDueDate(item) && isNonRecurringSubKpiDelayed(item, nowMs, zone, parentDue)) {
      return true;
    }
  }
  // DAILY / WEEKLY stale cycles roll into the next period immediately (no incomplete hold),
  // so a not-yet-rolled cycle must never sit in the Delayed column — it resets on next load.
  if (recurringIncompleteRolloverHoldDays(record.frequency) === 0) return false;
  const deadline = recurringDeadlineExclusive(record, timeZone);
  if (!deadline) return false;
  if (nowMs < deadline.getTime()) return false;
  return items.some((item) => !subKpiRequirementsMet(item));
}
