import { DateTime } from "luxon";
import type { KpiFrequencyCode } from "@/modules/tasks/kpi-recurrence";
import { normalizeTimeZone } from "@/modules/tasks/kpi-recurrence";
import { isItProjectImplementationPillar } from "@/modules/tasks/it-task-pillar-titles";
import {
  findItProjectPhaseForSubKpi,
  isItProjectEnvelope,
  isItProjectSubTaskDelayed,
  itProjectChecklistItems,
  parseItProjectSubKpis,
  resolvePhaseEffectiveTargetDate,
} from "@/modules/tasks/it-project-subkpis";
import {
  isNonRecurringSubKpiDelayed,
  nonRecurringDelayStartExclusive,
  recurringDeadlineExclusive,
} from "@/modules/tasks/kpi-cycle-state";
import { kpiMainTaskLabel } from "@/modules/tasks/kpi-main-task";
import {
  collectChecklistProgressItems,
  getTaskTargetDueDate,
  resolveEffectiveSubKpiDueDate,
  subKpiProgressOwner,
  taskDailyPenaltyAmountFromSubKpis,
  taskDelayPenaltyFrequencyFromSubKpis,
  type SubKpiItem,
} from "@/modules/tasks/kpi-subkpis";
import {
  normalizeDelayPenaltyFrequency,
  penaltyAccrualUnits,
  type DelayPenaltyFrequency,
} from "@/modules/tasks/delay-penalty-frequency";
import { subKpiRequirementsMet } from "@/modules/tasks/sub-kpi-completion-mode";

export type { DelayPenaltyFrequency };
export { penaltyAccrualUnits, normalizeDelayPenaltyFrequency };

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export type SubKpiPenaltyContext = {
  nowMs: number;
  timeZone: string;
  frequency: KpiFrequencyCode;
  isRecurring: boolean;
  title: string;
  taskDailyPenaltyAmount?: number | null;
  /** Task-level accrual cadence; item.delayPenaltyFrequency overrides when set. */
  taskDelayPenaltyFrequency?: DelayPenaltyFrequency | null;
  /** Optional phase due (YYYY-MM-DD) when subtask due is missing (IT projects). */
  phaseDueDate?: string | null;
  /** Main-task target date used when a subtask inherits (non-IT). */
  taskDueDate?: string | null;
  /**
   * Recurring cycle deadline (exclusive). Used when a sub-task has no custom due date —
   * delay / penalty starts at this instant.
   */
  recurringDeadlineMs?: number | null;
};

function parseSubKpiYmd(value: unknown, timeZone: string): DateTime | null {
  if (typeof value !== "string" || !YMD.test(value.trim())) return null;
  const dt = DateTime.fromISO(value.trim(), { zone: normalizeTimeZone(timeZone) }).startOf("day");
  return dt.isValid ? dt : null;
}

/** Inclusive calendar days from delay start day through end day. */
export function penaltyAccrualDays(delayStartMs: number, endMs: number, timeZone: string): number {
  const zone = normalizeTimeZone(timeZone);
  const startDay = DateTime.fromMillis(delayStartMs, { zone }).startOf("day");
  const endDay = DateTime.fromMillis(endMs, { zone }).startOf("day");
  if (!startDay.isValid || !endDay.isValid || endDay < startDay) return 0;
  return Math.floor(endDay.diff(startDay, "days").days) + 1;
}

function usesTimelinePenalty(ctx: SubKpiPenaltyContext): boolean {
  return isItProjectImplementationPillar(ctx.title) || Boolean(ctx.phaseDueDate?.trim());
}

function effectiveDueYmd(item: SubKpiItem, ctx: SubKpiPenaltyContext): string | null {
  if (usesTimelinePenalty(ctx)) {
    const due = item.dueDate?.trim();
    if (due && YMD.test(due)) return due;
    const phaseDue = ctx.phaseDueDate?.trim();
    if (phaseDue && YMD.test(phaseDue)) return phaseDue;
    return null;
  }
  return resolveEffectiveSubKpiDueDate(item, ctx.taskDueDate).dueDate;
}

export function subKpiPenaltyDelayStartMs(
  item: SubKpiItem,
  ctx: SubKpiPenaltyContext,
): number | null {
  const isTimeline = usesTimelinePenalty(ctx);
  const zone = normalizeTimeZone(ctx.timeZone);
  if (isTimeline) {
    const dueYmd = effectiveDueYmd(item, ctx);
    if (!dueYmd) return null;
    return nonRecurringDelayStartExclusive(dueYmd, zone)?.getTime() ?? null;
  }
  if (ctx.isRecurring !== false) {
    const customDue = item.dueDate?.trim();
    if (customDue && YMD.test(customDue)) {
      return nonRecurringDelayStartExclusive(customDue, zone)?.getTime() ?? null;
    }
    const deadlineMs = ctx.recurringDeadlineMs;
    if (typeof deadlineMs === "number" && Number.isFinite(deadlineMs)) {
      return deadlineMs;
    }
    return null;
  }
  const dueYmd = effectiveDueYmd(item, ctx);
  if (!dueYmd) return null;
  return nonRecurringDelayStartExclusive(dueYmd, zone)?.getTime() ?? null;
}

export function isSubKpiInDelayPenaltyScope(item: SubKpiItem, ctx: SubKpiPenaltyContext): boolean {
  if (usesTimelinePenalty(ctx)) {
    // Overdue incomplete or late actual — same semantics as board delay.
    const due = effectiveDueYmd(item, ctx);
    if (!due) return false;
    const withDue = { ...item, dueDate: due };
    return isItProjectSubTaskDelayed(withDue, ctx.nowMs, ctx.timeZone);
  }
  if (ctx.isRecurring !== false) {
    if (subKpiRequirementsMet(item)) return false;
    const delayStartMs = subKpiPenaltyDelayStartMs(item, ctx);
    if (delayStartMs == null) return false;
    return ctx.nowMs >= delayStartMs;
  }
  const zone = normalizeTimeZone(ctx.timeZone);
  return isNonRecurringSubKpiDelayed(item, ctx.nowMs, zone, ctx.taskDueDate);
}

export function subKpiPenaltyDays(item: SubKpiItem, ctx: SubKpiPenaltyContext): number {
  const zone = normalizeTimeZone(ctx.timeZone);
  const delayStartMs = subKpiPenaltyDelayStartMs(item, ctx);
  if (delayStartMs == null) return 0;

  const actual = parseSubKpiYmd(item.actualDate, zone);
  const complete = usesTimelinePenalty(ctx)
    ? Boolean(actual)
    : subKpiRequirementsMet(item);

  if (actual) {
    const actualMs = actual.toMillis();
    if (actualMs < delayStartMs) return 0;
    return penaltyAccrualDays(delayStartMs, actualMs, zone);
  }

  if (complete && !isSubKpiInDelayPenaltyScope(item, ctx)) return 0;
  if (!isSubKpiInDelayPenaltyScope(item, ctx)) return 0;

  return penaltyAccrualDays(delayStartMs, ctx.nowMs, zone);
}

export function resolveSubKpiDailyPenaltyAmount(
  item: SubKpiItem,
  ctx: Pick<SubKpiPenaltyContext, "taskDailyPenaltyAmount">,
): number {
  const itemAmount = item.dailyPenaltyAmount;
  if (typeof itemAmount === "number" && Number.isFinite(itemAmount) && itemAmount > 0) {
    return itemAmount;
  }
  const taskAmount = ctx.taskDailyPenaltyAmount;
  if (typeof taskAmount === "number" && Number.isFinite(taskAmount) && taskAmount > 0) {
    return taskAmount;
  }
  return 0;
}

export function resolveSubKpiDelayPenaltyFrequency(
  item: SubKpiItem,
  ctx: Pick<SubKpiPenaltyContext, "taskDelayPenaltyFrequency">,
): DelayPenaltyFrequency {
  if (item.delayPenaltyFrequency) {
    return normalizeDelayPenaltyFrequency(item.delayPenaltyFrequency);
  }
  return normalizeDelayPenaltyFrequency(ctx.taskDelayPenaltyFrequency);
}

export function subKpiAccruedPenalty(item: SubKpiItem, ctx: SubKpiPenaltyContext): number {
  const rate = resolveSubKpiDailyPenaltyAmount(item, ctx);
  if (rate <= 0) return 0;
  const days = subKpiPenaltyDays(item, ctx);
  if (days <= 0) return 0;
  const units = penaltyAccrualUnits(days, resolveSubKpiDelayPenaltyFrequency(item, ctx));
  if (units <= 0) return 0;
  return Math.round(rate * units * 100) / 100;
}

export type KpiPenaltySource = {
  subKpis: unknown;
  frequency: KpiFrequencyCode;
  isRecurring: boolean;
  title: string;
  mainTask?: string | null;
  assignedAgent?: { id: string; name: string } | null;
  recurrenceWeekday?: number | null;
  recurrenceMonthDay?: number | null;
  periodCycleStartAt?: Date | string | null;
  nonRecurringEndAt?: Date | string | null;
};

export function penaltyDeductionsForKpi(
  kpi: KpiPenaltySource,
  ctx: { nowMs: number; timeZone: string },
): Map<string, { id: string; name: string; deduction: number }> {
  const isIt = isItProjectImplementationPillar(kpi.title);

  const taskDailyPenaltyAmount = taskDailyPenaltyAmountFromSubKpis(kpi.subKpis);
  const taskDelayPenaltyFrequency = taskDelayPenaltyFrequencyFromSubKpis(kpi.subKpis);
  const byPerson = new Map<string, { id: string; name: string; deduction: number }>();

  if (isItProjectEnvelope(kpi.subKpis) || isIt) {
    const data = parseItProjectSubKpis(kpi.subKpis);
    const mainDue = getTaskTargetDueDate(kpi.subKpis);
    for (const item of itProjectChecklistItems(kpi.subKpis)) {
      if (!item.title.trim()) continue;
      const phase = findItProjectPhaseForSubKpi(data, item.id);
      const effectivePhaseDue = phase
        ? resolvePhaseEffectiveTargetDate(phase, mainDue)
        : null;
      const penaltyCtx: SubKpiPenaltyContext = {
        nowMs: ctx.nowMs,
        timeZone: ctx.timeZone,
        frequency: kpi.frequency,
        isRecurring: false,
        title: kpi.title,
        taskDailyPenaltyAmount,
        taskDelayPenaltyFrequency,
        phaseDueDate: effectivePhaseDue,
      };
      const deduction = subKpiAccruedPenalty(item, penaltyCtx);
      if (deduction <= 0) continue;
      const owner = subKpiProgressOwner(item, kpi.assignedAgent ?? null);
      if (owner.id === "__unassigned__") continue;
      const key = owner.id !== "__unassigned__" ? owner.id : owner.name.trim().toLowerCase();
      const current = byPerson.get(key) ?? { id: owner.id, name: owner.name, deduction: 0 };
      current.deduction += deduction;
      byPerson.set(key, current);
    }
    return byPerson;
  }

  const recurringDeadlineMs =
    kpi.isRecurring !== false
      ? recurringDeadlineExclusive(
          {
            isRecurring: kpi.isRecurring,
            frequency: kpi.frequency,
            recurrenceWeekday: kpi.recurrenceWeekday,
            recurrenceMonthDay: kpi.recurrenceMonthDay,
            periodCycleStartAt: kpi.periodCycleStartAt,
          },
          ctx.timeZone,
        )?.getTime() ?? null
      : null;

  const penaltyCtx: SubKpiPenaltyContext = {
    nowMs: ctx.nowMs,
    timeZone: ctx.timeZone,
    frequency: kpi.frequency,
    isRecurring: kpi.isRecurring,
    title: kpi.title,
    taskDailyPenaltyAmount,
    taskDelayPenaltyFrequency,
    taskDueDate: getTaskTargetDueDate(kpi.subKpis),
    recurringDeadlineMs,
  };

  const items = collectChecklistProgressItems(kpi.subKpis, kpiMainTaskLabel(kpi));
  for (const item of items) {
    if (!item.title.trim()) continue;
    const deduction = subKpiAccruedPenalty(item, penaltyCtx);
    if (deduction <= 0) continue;
    const owner = subKpiProgressOwner(item, kpi.assignedAgent ?? null);
    if (owner.id === "__unassigned__") continue;
    const key = owner.id !== "__unassigned__" ? owner.id : owner.name.trim().toLowerCase();
    const current = byPerson.get(key) ?? { id: owner.id, name: owner.name, deduction: 0 };
    current.deduction += deduction;
    byPerson.set(key, current);
  }
  return byPerson;
}

export function mergePenaltyDeductionMaps(
  maps: Iterable<Map<string, { id: string; name: string; deduction: number }>>,
): Map<string, { id: string; name: string; deduction: number }> {
  const merged = new Map<string, { id: string; name: string; deduction: number }>();
  for (const map of maps) {
    for (const [key, row] of map) {
      const current = merged.get(key) ?? { id: row.id, name: row.name, deduction: 0 };
      current.deduction += row.deduction;
      if (row.id !== "__unassigned__") current.id = row.id;
      merged.set(key, current);
    }
  }
  return merged;
}
