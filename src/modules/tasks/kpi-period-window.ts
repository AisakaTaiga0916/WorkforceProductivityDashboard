import type { KpiFrequencyCode } from "@/modules/tasks/kpi-recurrence";
import {
  getDailyPeriodStartDt,
  getMonthlyPeriodStartDt,
  getPeriodEndExclusive,
  getQuarterlyPeriodStartDt,
  getSemiAnnualPeriodStartDt,
  getWeeklyPeriodStartDt,
  getYearlyPeriodStartDt,
  normalizeTimeZone,
} from "@/modules/tasks/kpi-recurrence";
import { DateTime } from "luxon";

/** Start of the KPI period that contains `now` (inclusive), in absolute time. */
export function getPeriodStartInclusive(
  frequency: KpiFrequencyCode,
  recurrenceWeekday: number | null | undefined,
  recurrenceMonthDay: number | null | undefined,
  now: Date,
  timeZone: string,
): Date {
  const zone = normalizeTimeZone(timeZone);
  switch (frequency) {
    case "DAILY":
      return getDailyPeriodStartDt(now, zone).toJSDate();
    case "WEEKLY": {
      const wd = typeof recurrenceWeekday === "number" ? recurrenceWeekday : 1;
      return getWeeklyPeriodStartDt(now, wd, zone).toJSDate();
    }
    case "MONTHLY": {
      const dom = typeof recurrenceMonthDay === "number" ? recurrenceMonthDay : 1;
      return getMonthlyPeriodStartDt(now, dom, zone).toJSDate();
    }
    case "QUARTERLY": {
      const dom = typeof recurrenceMonthDay === "number" ? recurrenceMonthDay : 1;
      return getQuarterlyPeriodStartDt(now, dom, zone).toJSDate();
    }
    case "SEMI_ANNUAL": {
      const dom = typeof recurrenceMonthDay === "number" ? recurrenceMonthDay : 1;
      return getSemiAnnualPeriodStartDt(now, dom, zone).toJSDate();
    }
    case "YEARLY": {
      const dom = typeof recurrenceMonthDay === "number" ? recurrenceMonthDay : 1;
      return getYearlyPeriodStartDt(now, dom, zone).toJSDate();
    }
    default:
      return DateTime.fromMillis(now.getTime(), { zone }).startOf("day").toJSDate();
  }
}

/** Same instant as the exclusive end of the prior period (start of the period that contains `now`). */
export function getCurrentPeriodBoundaryStart(
  frequency: KpiFrequencyCode,
  recurrenceWeekday: number | null | undefined,
  recurrenceMonthDay: number | null | undefined,
  now: Date,
  timeZone: string,
): Date {
  return getPeriodStartInclusive(frequency, recurrenceWeekday, recurrenceMonthDay, now, timeZone);
}

export function getIncompleteKpiOverdueDelayMs(
  frequency: KpiFrequencyCode,
  recurrenceWeekday: number | null | undefined,
  recurrenceMonthDay: number | null | undefined,
  nowMs: number,
  timeZone: string,
): number {
  const now = new Date(nowMs);
  const endExclusive = getPeriodEndExclusive(
    frequency,
    recurrenceWeekday,
    recurrenceMonthDay,
    now,
    timeZone,
  ).getTime();
  if (!Number.isFinite(endExclusive)) return 0;
  if (nowMs < endExclusive) return 0;
  return Math.max(0, nowMs - endExclusive);
}

/** After a rollover with incomplete work: delay since the period boundary (start of current period). */
export function getRolloverIncompleteDelayMs(
  frequency: KpiFrequencyCode,
  recurrenceWeekday: number | null | undefined,
  recurrenceMonthDay: number | null | undefined,
  nowMs: number,
  timeZone: string,
): number {
  const now = new Date(nowMs);
  const periodStart = getCurrentPeriodBoundaryStart(
    frequency,
    recurrenceWeekday,
    recurrenceMonthDay,
    now,
    timeZone,
  ).getTime();
  if (!Number.isFinite(periodStart)) return 0;
  return Math.max(0, nowMs - periodStart);
}
