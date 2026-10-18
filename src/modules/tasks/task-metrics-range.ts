import { DateTime } from "luxon";

/** Insights → Task Metrics reporting cadence (independent of task recurrence frequency). */
export type TaskMetricsCadence = "MONTHLY" | "YEARLY";

/** Local calendar YYYY-MM-DD (browser timezone). */
export function calendarYmd(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Local calendar YYYY-MM (browser timezone). */
export function calendarYm(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/** Local calendar YYYY (browser timezone). */
export function calendarYear(d: Date = new Date()): string {
  return String(d.getFullYear());
}

export function isYearMonthKey(value: string): boolean {
  return /^\d{4}-\d{2}$/.test(value.trim());
}

export function isYearKey(value: string): boolean {
  return /^\d{4}$/.test(value.trim());
}

/** Expand `YYYY-MM` start/end to inclusive first/last calendar day (local). */
export function expandYearMonthRangeToYmd(fromYm: string, toYm: string): { from: string; to: string } {
  let from = fromYm.trim();
  let to = toYm.trim();
  if (!isYearMonthKey(from)) from = calendarYm();
  if (!isYearMonthKey(to)) to = from;
  if (from > to) {
    const swap = from;
    from = to;
    to = swap;
  }
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  const fromYmd = `${fy}-${String(fm).padStart(2, "0")}-01`;
  const end = DateTime.fromObject({ year: ty, month: tm, day: 1 }).endOf("month");
  const toYmd = end.toISODate() ?? calendarYmd();
  return { from: fromYmd, to: toYmd };
}

/** Expand `YYYY` to inclusive calendar year. */
export function expandYearRangeToYmd(year: string): { from: string; to: string } {
  const y = isYearKey(year) ? year.trim() : calendarYear();
  return { from: `${y}-01-01`, to: `${y}-12-31` };
}

export function defaultTaskMetricsDailyDate(): string {
  return calendarYmd();
}

export function defaultTaskMetricsWeeklyRange(): { from: string; to: string } {
  const to = calendarYmd();
  const d = new Date();
  const weekday = d.getDay();
  const daysFromMonday = weekday === 0 ? 6 : weekday - 1;
  const start = new Date(d);
  start.setDate(d.getDate() - daysFromMonday);
  return { from: calendarYmd(start), to };
}

export function defaultTaskMetricsMonthlyRange(): { from: string; to: string } {
  const ym = calendarYm();
  return { from: ym, to: ym };
}

export function defaultTaskMetricsQuarterlyRange(): { from: string; to: string } {
  const now = new Date();
  const startMonth = Math.floor(now.getMonth() / 4) * 4;
  const start = new Date(now.getFullYear(), startMonth, 1);
  const end = new Date(now.getFullYear(), startMonth + 4, 0);
  return { from: calendarYmd(start), to: calendarYmd(end) };
}

export function defaultTaskMetricsSemiAnnualRange(): { from: string; to: string } {
  const now = new Date();
  const startMonth = Math.floor(now.getMonth() / 6) * 6;
  const start = new Date(now.getFullYear(), startMonth, 1);
  const end = new Date(now.getFullYear(), startMonth + 6, 0);
  return { from: calendarYmd(start), to: calendarYmd(end) };
}

export function defaultTaskMetricsYearlyRange(): { from: string; to: string } {
  const y = calendarYear();
  return { from: y, to: y };
}

export function defaultTaskMetricsRangeForCadence(
  cadence: TaskMetricsCadence,
): { dailyDate: string; from: string; to: string } {
  if (cadence === "YEARLY") {
    const { from, to } = defaultTaskMetricsYearlyRange();
    return { dailyDate: defaultTaskMetricsDailyDate(), from, to };
  }
  const { from, to } = defaultTaskMetricsMonthlyRange();
  return { dailyDate: defaultTaskMetricsDailyDate(), from, to };
}

/**
 * Merged-DB reporting period key for the Task Metrics panel state
 * (matches merged_user_efficiency_breakdowns: 2026-07 | 2026).
 */
export function taskMetricsMergedPeriod(
  cadence: TaskMetricsCadence,
  opts: { dailyDate: string; rangeFrom: string; rangeTo: string },
): { frequency: TaskMetricsCadence; periodKey: string } {
  if (cadence === "YEARLY") {
    const y = isYearKey(opts.rangeFrom)
      ? opts.rangeFrom.trim()
      : isYearKey(opts.rangeTo)
        ? opts.rangeTo.trim()
        : calendarYear();
    return { frequency: "YEARLY", periodKey: y };
  }
  const ym = isYearMonthKey(opts.rangeFrom) ? opts.rangeFrom.trim() : calendarYm();
  return { frequency: "MONTHLY", periodKey: ym };
}

/** Query `from` / `to` for `/api/kpis/task-metrics` from cadence + UI state. */
export function resolveTaskMetricsQueryRange(
  cadence: TaskMetricsCadence,
  dailyDate: string,
  rangeFrom: string,
  rangeTo: string,
): { from: string; to: string } {
  void dailyDate;
  if (cadence === "YEARLY") {
    const y = isYearKey(rangeFrom)
      ? rangeFrom.trim()
      : isYearKey(rangeTo)
        ? rangeTo.trim()
        : calendarYear();
    return expandYearRangeToYmd(y);
  }
  const ym = isYearMonthKey(rangeFrom)
    ? rangeFrom.trim()
    : isYearMonthKey(rangeTo)
      ? rangeTo.trim()
      : calendarYm();
  return expandYearMonthRangeToYmd(ym, ym);
}

/** Human-readable label for the active task-metrics reporting window. */
export function formatTaskMetricsPeriodLabel(
  cadence: TaskMetricsCadence,
  opts: { dailyDate: string; rangeFrom: string; rangeTo: string },
): string {
  const { rangeFrom } = opts;
  if (cadence === "YEARLY") {
    const y = isYearKey(rangeFrom) ? rangeFrom.trim() : calendarYear();
    return y;
  }
  const ym = isYearMonthKey(rangeFrom) ? rangeFrom.trim() : rangeFrom;
  const dt = DateTime.fromISO(`${ym}-01`);
  return dt.isValid ? dt.toFormat("MMMM yyyy") : ym;
}

export function parseTaskMetricsCadence(param: string | null | undefined): TaskMetricsCadence {
  const u = param?.trim().toUpperCase();
  if (u === "YEARLY" || u === "YEAR" || u === "ANNUAL") return "YEARLY";
  return "MONTHLY";
}
