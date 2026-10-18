/**
 * Calendar recurrence for KPI maintenance in a specific IANA timezone
 * (typically the browser's `Intl.DateTimeFormat().resolvedOptions().timeZone`).
 */

import { DateTime } from "luxon";

export type KpiFrequencyCode =
  | "DAILY"
  | "WEEKLY"
  | "MONTHLY"
  | "QUARTERLY"
  | "SEMI_ANNUAL"
  | "YEARLY";

/** Fallback IANA zone: GMT+8 Taiwan. */
const FALLBACK_TIME_ZONE = "Asia/Taipei";

export function normalizeTimeZone(tz: string | null | undefined): string {
  const raw = (tz ?? "").trim();
  if (!raw) return FALLBACK_TIME_ZONE;
  const probe = DateTime.now().setZone(raw);
  return probe.isValid ? raw : FALLBACK_TIME_ZONE;
}

/**
 * App-wide calendar timezone (sessions, Activities duty day, KPI reporting).
 * Prefer APP_TIME_ZONE, then REPORT_TZ / KPI_SNAPSHOT_TZ from env.
 */
export const DEFAULT_TIME_ZONE = normalizeTimeZone(
  process.env.APP_TIME_ZONE ?? process.env.REPORT_TZ ?? process.env.KPI_SNAPSHOT_TZ,
);

/** @returns true for keys from the pre-timezone format, e.g. `D:2026-04-29`. */
export function isLegacyPeriodKey(key: string | null | undefined): boolean {
  if (!key) return false;
  return /^(D|W|M|Q|S):\d{4}-\d{2}-\d{2}$/.test(key);
}

function atZone(now: Date, timeZone: string): DateTime {
  return DateTime.fromMillis(now.getTime(), { zone: timeZone });
}

/** Luxon weekday 7 = Sunday — excluded from daily KPI task metrics and snapshots. */
export function isKpiMetricsWorkingDay(dt: DateTime): boolean {
  return dt.weekday !== 7;
}

export function isKpiMetricsWorkingYmd(ymd: string, timeZone: string): boolean {
  const zone = normalizeTimeZone(timeZone);
  const dt = DateTime.fromISO(ymd, { zone }).startOf("day");
  return dt.isValid && isKpiMetricsWorkingDay(dt);
}

export function getDailyPeriodStartDt(now: Date, timeZone: string): DateTime {
  const dt = atZone(now, timeZone).startOf("day");
  return isKpiMetricsWorkingDay(dt) ? dt : dt.minus({ days: 1 });
}

export function getNextDailyPeriodStartDt(periodStart: DateTime): DateTime {
  let next = periodStart.startOf("day").plus({ days: 1 });
  while (!isKpiMetricsWorkingDay(next)) {
    next = next.plus({ days: 1 });
  }
  return next;
}

/** Luxon weekday 1=Mon … 7=Sun; input is JS getDay() 0=Sun … 6=Sat. */
function jsWeekdayToLuxon(js: number): number {
  return js === 0 ? 7 : js;
}

export function getDailyPeriodKey(now: Date, timeZone: string): string {
  const dt = getDailyPeriodStartDt(now, timeZone);
  return `D:${timeZone}:${dt.toISODate()}`;
}

export function getWeeklyPeriodStartDt(now: Date, anchorJsWeekday: number, timeZone: string): DateTime {
  const dt = atZone(now, timeZone).startOf("day");
  const anchorLuxon = jsWeekdayToLuxon(anchorJsWeekday);
  const w = dt.weekday;
  const diff = (w - anchorLuxon + 7) % 7;
  return dt.minus({ days: diff });
}

export function getWeeklyPeriodKey(now: Date, anchorJsWeekday: number, timeZone: string): string {
  const start = getWeeklyPeriodStartDt(now, anchorJsWeekday, timeZone);
  return `W:${timeZone}:${start.toISODate()}`;
}

export function getMonthlyPeriodStartDt(now: Date, anchorDay: number, timeZone: string): DateTime {
  const dt = atZone(now, timeZone);
  const y = dt.year;
  const mo = dt.month;
  const dim = DateTime.fromObject({ year: y, month: mo, day: 1 }, { zone: timeZone }).daysInMonth ?? 28;
  const dom = Math.min(Math.max(1, anchorDay), dim);
  const candidate = DateTime.fromObject({ year: y, month: mo, day: dom }, { zone: timeZone }).startOf("day");
  if (dt.startOf("day") < candidate) {
    const prev = dt.minus({ months: 1 });
    const py = prev.year;
    const pm = prev.month;
    const dimP = DateTime.fromObject({ year: py, month: pm, day: 1 }, { zone: timeZone }).daysInMonth ?? 28;
    const domP = Math.min(Math.max(1, anchorDay), dimP);
    return DateTime.fromObject({ year: py, month: pm, day: domP }, { zone: timeZone }).startOf("day");
  }
  return candidate;
}

export function getMonthlyPeriodKey(now: Date, anchorDay: number, timeZone: string): string {
  const start = getMonthlyPeriodStartDt(now, anchorDay, timeZone);
  return `M:${timeZone}:${start.toISODate()}`;
}

export function getQuarterlyPeriodStartDt(now: Date, anchorDay: number, timeZone: string): DateTime {
  const dt = atZone(now, timeZone);
  const quarterStartMonth = Math.floor((dt.month - 1) / 4) * 4 + 1;
  const startFor = (year: number, month: number) => {
    const dim = DateTime.fromObject({ year, month, day: 1 }, { zone: timeZone }).daysInMonth ?? 28;
    const dom = Math.min(Math.max(1, anchorDay), dim);
    return DateTime.fromObject({ year, month, day: dom }, { zone: timeZone }).startOf("day");
  };
  const candidate = startFor(dt.year, quarterStartMonth);
  if (dt.startOf("day") >= candidate) return candidate;
  const prev = candidate.minus({ months: 4 });
  return startFor(prev.year, prev.month);
}

export function getQuarterlyPeriodKey(now: Date, anchorDay: number, timeZone: string): string {
  const start = getQuarterlyPeriodStartDt(now, anchorDay, timeZone);
  return `Q:${timeZone}:${start.toISODate()}`;
}

/** Semi-annual = 6-month blocks starting Jan / Jul (mirrors 4-month quarterly). */
export function getSemiAnnualPeriodStartDt(now: Date, anchorDay: number, timeZone: string): DateTime {
  const dt = atZone(now, timeZone);
  const halfStartMonth = Math.floor((dt.month - 1) / 6) * 6 + 1;
  const startFor = (year: number, month: number) => {
    const dim = DateTime.fromObject({ year, month, day: 1 }, { zone: timeZone }).daysInMonth ?? 28;
    const dom = Math.min(Math.max(1, anchorDay), dim);
    return DateTime.fromObject({ year, month, day: dom }, { zone: timeZone }).startOf("day");
  };
  const candidate = startFor(dt.year, halfStartMonth);
  if (dt.startOf("day") >= candidate) return candidate;
  const prev = candidate.minus({ months: 6 });
  return startFor(prev.year, prev.month);
}

export function getSemiAnnualPeriodKey(now: Date, anchorDay: number, timeZone: string): string {
  const start = getSemiAnnualPeriodStartDt(now, anchorDay, timeZone);
  return `S:${timeZone}:${start.toISODate()}`;
}

/** Yearly = 12-month blocks starting on the anchor day in January (or prior year if before that day). */
export function getYearlyPeriodStartDt(now: Date, anchorDay: number, timeZone: string): DateTime {
  const dt = atZone(now, timeZone);
  const startFor = (year: number) => {
    const dim = DateTime.fromObject({ year, month: 1, day: 1 }, { zone: timeZone }).daysInMonth ?? 28;
    const dom = Math.min(Math.max(1, anchorDay), dim);
    return DateTime.fromObject({ year, month: 1, day: dom }, { zone: timeZone }).startOf("day");
  };
  const candidate = startFor(dt.year);
  if (dt.startOf("day") >= candidate) return candidate;
  return startFor(dt.year - 1);
}

export function getYearlyPeriodKey(now: Date, anchorDay: number, timeZone: string): string {
  const start = getYearlyPeriodStartDt(now, anchorDay, timeZone);
  return `Y:${timeZone}:${start.toISODate()}`;
}

export function computePeriodKey(
  frequency: KpiFrequencyCode,
  recurrenceWeekday: number | null | undefined,
  recurrenceMonthDay: number | null | undefined,
  now: Date,
  timeZone: string,
): string {
  const zone = normalizeTimeZone(timeZone);
  switch (frequency) {
    case "DAILY":
      return getDailyPeriodKey(now, zone);
    case "WEEKLY": {
      const wd = typeof recurrenceWeekday === "number" ? recurrenceWeekday : 1;
      return getWeeklyPeriodKey(now, wd, zone);
    }
    case "MONTHLY": {
      const dom = typeof recurrenceMonthDay === "number" ? recurrenceMonthDay : 1;
      return getMonthlyPeriodKey(now, dom, zone);
    }
    case "QUARTERLY": {
      const dom = typeof recurrenceMonthDay === "number" ? recurrenceMonthDay : 1;
      return getQuarterlyPeriodKey(now, dom, zone);
    }
    case "SEMI_ANNUAL": {
      const dom = typeof recurrenceMonthDay === "number" ? recurrenceMonthDay : 1;
      return getSemiAnnualPeriodKey(now, dom, zone);
    }
    case "YEARLY": {
      const dom = typeof recurrenceMonthDay === "number" ? recurrenceMonthDay : 1;
      return getYearlyPeriodKey(now, dom, zone);
    }
    default:
      return getDailyPeriodKey(now, zone);
  }
}

export function getNextMonthlyPeriodStartDt(periodStart: DateTime, anchorDay: number): DateTime {
  const z = periodStart.zone;
  const n = periodStart.plus({ months: 1 });
  const dim = DateTime.fromObject({ year: n.year, month: n.month, day: 1 }, { zone: z }).daysInMonth ?? 28;
  const dom = Math.min(Math.max(1, anchorDay), dim);
  return DateTime.fromObject({ year: n.year, month: n.month, day: dom }, { zone: z }).startOf("day");
}

export function getNextQuarterlyPeriodStartDt(periodStart: DateTime, anchorDay: number): DateTime {
  const z = periodStart.zone;
  const n = periodStart.plus({ months: 4 });
  const dim = DateTime.fromObject({ year: n.year, month: n.month, day: 1 }, { zone: z }).daysInMonth ?? 28;
  const dom = Math.min(Math.max(1, anchorDay), dim);
  return DateTime.fromObject({ year: n.year, month: n.month, day: dom }, { zone: z }).startOf("day");
}

export function getNextSemiAnnualPeriodStartDt(periodStart: DateTime, anchorDay: number): DateTime {
  const z = periodStart.zone;
  const n = periodStart.plus({ months: 6 });
  const dim = DateTime.fromObject({ year: n.year, month: n.month, day: 1 }, { zone: z }).daysInMonth ?? 28;
  const dom = Math.min(Math.max(1, anchorDay), dim);
  return DateTime.fromObject({ year: n.year, month: n.month, day: dom }, { zone: z }).startOf("day");
}

export function getNextYearlyPeriodStartDt(periodStart: DateTime, anchorDay: number): DateTime {
  const z = periodStart.zone;
  const n = periodStart.plus({ years: 1 });
  const dim = DateTime.fromObject({ year: n.year, month: 1, day: 1 }, { zone: z }).daysInMonth ?? 28;
  const dom = Math.min(Math.max(1, anchorDay), dim);
  return DateTime.fromObject({ year: n.year, month: 1, day: dom }, { zone: z }).startOf("day");
}

/** Instant when the current period ends (start of next period) as a JS Date (absolute instant). */
export function getPeriodEndExclusive(
  frequency: KpiFrequencyCode,
  recurrenceWeekday: number | null | undefined,
  recurrenceMonthDay: number | null | undefined,
  now: Date,
  timeZone: string,
): Date {
  const zone = normalizeTimeZone(timeZone);
  switch (frequency) {
    case "DAILY":
      return getNextDailyPeriodStartDt(getDailyPeriodStartDt(now, zone)).toJSDate();
    case "WEEKLY": {
      const wd = typeof recurrenceWeekday === "number" ? recurrenceWeekday : 1;
      return getWeeklyPeriodStartDt(now, wd, zone).plus({ weeks: 1 }).toJSDate();
    }
    case "MONTHLY": {
      const dom = typeof recurrenceMonthDay === "number" ? recurrenceMonthDay : 1;
      const start = getMonthlyPeriodStartDt(now, dom, zone);
      return getNextMonthlyPeriodStartDt(start, dom).toJSDate();
    }
    case "QUARTERLY": {
      const dom = typeof recurrenceMonthDay === "number" ? recurrenceMonthDay : 1;
      const start = getQuarterlyPeriodStartDt(now, dom, zone);
      return getNextQuarterlyPeriodStartDt(start, dom).toJSDate();
    }
    case "SEMI_ANNUAL": {
      const dom = typeof recurrenceMonthDay === "number" ? recurrenceMonthDay : 1;
      const start = getSemiAnnualPeriodStartDt(now, dom, zone);
      return getNextSemiAnnualPeriodStartDt(start, dom).toJSDate();
    }
    case "YEARLY": {
      const dom = typeof recurrenceMonthDay === "number" ? recurrenceMonthDay : 1;
      const start = getYearlyPeriodStartDt(now, dom, zone);
      return getNextYearlyPeriodStartDt(start, dom).toJSDate();
    }
    default:
      return atZone(now, zone).startOf("day").plus({ days: 1 }).toJSDate();
  }
}

/**
 * End instant (exclusive) of one recurrence cycle anchored at cycleStartUtc
 * (`cycleStartUtc` is interpreted in `timeZone` for day/week/month boundaries).
 */
export function getPeriodEndExclusiveFromCycleStart(
  cycleStartUtc: Date,
  frequency: KpiFrequencyCode,
  recurrenceWeekday: number | null | undefined,
  recurrenceMonthDay: number | null | undefined,
  timeZone: string,
): Date {
  const zone = normalizeTimeZone(timeZone);
  const start = DateTime.fromMillis(cycleStartUtc.getTime(), { zone }).startOf("day");
  switch (frequency) {
    case "DAILY":
      return getNextDailyPeriodStartDt(start).toJSDate();
    case "WEEKLY":
      void recurrenceWeekday;
      return start.plus({ weeks: 1 }).toJSDate();
    case "MONTHLY": {
      const dom = typeof recurrenceMonthDay === "number" ? recurrenceMonthDay : 1;
      return getNextMonthlyPeriodStartDt(start, dom).toJSDate();
    }
    case "QUARTERLY": {
      const dom = typeof recurrenceMonthDay === "number" ? recurrenceMonthDay : 1;
      return getNextQuarterlyPeriodStartDt(start, dom).toJSDate();
    }
    case "SEMI_ANNUAL": {
      const dom = typeof recurrenceMonthDay === "number" ? recurrenceMonthDay : 1;
      return getNextSemiAnnualPeriodStartDt(start, dom).toJSDate();
    }
    case "YEARLY": {
      const dom = typeof recurrenceMonthDay === "number" ? recurrenceMonthDay : 1;
      return getNextYearlyPeriodStartDt(start, dom).toJSDate();
    }
    default:
      return start.plus({ days: 1 }).toJSDate();
  }
}

/**
 * When a completed checklist may roll into the next recurrence cycle.
 *
 * - WEEKLY / MONTHLY / QUARTERLY / SEMI_ANNUAL / YEARLY: eligible immediately on full completion
 *   (no artificial +1 calendar-day wait before resetting to CURRENT).
 * - DAILY (and callers that omit frequency, e.g. one-off archive): still
 *   wait until the start of the next calendar day in `timeZone` so the
 *   completed day remains visible until midnight.
 */
export function getRolloverEligibleAfterCompletion(
  completedAtUtc: Date,
  timeZone: string,
  frequency?: KpiFrequencyCode | null,
): Date {
  // Multi-day cadences must recur as soon as the checklist hits DONE.
  if (
    frequency === "WEEKLY" ||
    frequency === "MONTHLY" ||
    frequency === "QUARTERLY" ||
    frequency === "SEMI_ANNUAL" ||
    frequency === "YEARLY"
  ) {
    return completedAtUtc;
  }
  const zone = normalizeTimeZone(timeZone);
  const completedDay = DateTime.fromMillis(completedAtUtc.getTime(), { zone }).startOf("day");
  return getNextDailyPeriodStartDt(completedDay).toJSDate();
}

/**
 * Advance a calendar target date by one recurrence period.
 * Monthly / quarterly / semi-annual / yearly preserve day-of-month (clamped to month length).
 */
export function advanceDueDateYmdForFrequency(
  dueYmd: string,
  frequency: KpiFrequencyCode,
  timeZone: string,
): string | null {
  const zone = normalizeTimeZone(timeZone);
  const dt = DateTime.fromISO(dueYmd.trim(), { zone }).startOf("day");
  if (!dt.isValid) return null;

  const withClampedDay = (base: DateTime, day: number): string | null => {
    const dim = base.daysInMonth ?? 28;
    const dom = Math.min(Math.max(1, day), dim);
    return DateTime.fromObject(
      { year: base.year, month: base.month, day: dom },
      { zone },
    )
      .startOf("day")
      .toISODate();
  };

  switch (frequency) {
    case "DAILY":
      return getNextDailyPeriodStartDt(dt).toISODate();
    case "WEEKLY":
      return dt.plus({ weeks: 1 }).toISODate();
    case "MONTHLY":
      return withClampedDay(dt.plus({ months: 1 }), dt.day);
    case "QUARTERLY":
      return withClampedDay(dt.plus({ months: 4 }), dt.day);
    case "SEMI_ANNUAL":
      return withClampedDay(dt.plus({ months: 6 }), dt.day);
    case "YEARLY":
      return withClampedDay(dt.plus({ years: 1 }), dt.day);
    default:
      return dt.plus({ days: 1 }).toISODate();
  }
}

/** How many full periods lie strictly between `fromCycleStart` and `toCycleStart`. */
export function countRecurrencePeriodsBetween(
  fromCycleStart: Date,
  toCycleStart: Date,
  frequency: KpiFrequencyCode,
  recurrenceWeekday: number | null | undefined,
  recurrenceMonthDay: number | null | undefined,
  timeZone: string,
): number {
  const fromMs = fromCycleStart.getTime();
  const toMs = toCycleStart.getTime();
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) return 0;
  let count = 0;
  let cursor = fromCycleStart;
  while (cursor.getTime() < toMs && count < 240) {
    cursor = getPeriodEndExclusiveFromCycleStart(
      cursor,
      frequency,
      recurrenceWeekday,
      recurrenceMonthDay,
      timeZone,
    );
    count += 1;
  }
  return count;
}
