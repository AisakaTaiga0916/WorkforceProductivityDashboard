/** Shared report chrome helpers: date range parsing, time buckets, stats, CSV (pure). */

import { DateTime } from "luxon";
import { DEFAULT_TIME_ZONE } from "@/modules/tasks/kpi-recurrence";

export const REPORT_DEFAULT_DAYS = 30;
export const REPORT_MAX_DAYS = 366;
/** Ranges up to this many days chart per day; longer ranges chart per week. */
export const REPORT_DAILY_BUCKET_MAX_DAYS = 62;

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

export const REPORT_RANGE_PRESETS = [
  { id: "7d", label: "Last 7 days" },
  { id: "30d", label: "Last 30 days" },
  { id: "month", label: "This month" },
  { id: "quarter", label: "This quarter" },
  { id: "custom", label: "Custom" },
] as const;
export type ReportRangePreset = (typeof REPORT_RANGE_PRESETS)[number]["id"];
export const DEFAULT_REPORT_RANGE_PRESET: ReportRangePreset = "30d";

function isRangePreset(value: string | null | undefined): value is ReportRangePreset {
  return REPORT_RANGE_PRESETS.some((p) => p.id === value);
}

export type ReportRange = {
  preset: ReportRangePreset;
  fromYmd: string;
  toYmd: string;
  /** Inclusive start (start of `fromYmd` in `timeZone`). */
  start: Date;
  /** Exclusive end (start of the day after `toYmd`). */
  endExclusive: Date;
  days: number;
  timeZone: string;
};

function parseYmd(raw: string | null | undefined, timeZone: string): DateTime | null {
  const value = raw?.trim();
  if (!value || !YMD_RE.test(value)) return null;
  const dt = DateTime.fromISO(value, { zone: timeZone });
  return dt.isValid ? dt.startOf("day") : null;
}

/**
 * `?range=7d|30d|month|quarter` (calendar periods end today), or
 * `?range=custom&from=YYYY-MM-DD&to=YYYY-MM-DD`. Bare `from`/`to` count as custom;
 * nothing at all = last 30 days.
 */
export function parseReportRange(
  input: { range?: string | null; from?: string | null; to?: string | null },
  now: Date = new Date(),
  timeZone: string = DEFAULT_TIME_ZONE,
): ReportRange {
  const today = DateTime.fromJSDate(now, { zone: timeZone }).startOf("day");
  const hasDates = Boolean(input.from?.trim() || input.to?.trim());
  const preset: ReportRangePreset = isRangePreset(input.range)
    ? input.range
    : hasDates
      ? "custom"
      : DEFAULT_REPORT_RANGE_PRESET;

  let from: DateTime;
  let to = today;
  if (preset === "7d") from = today.minus({ days: 6 });
  else if (preset === "30d") from = today.minus({ days: REPORT_DEFAULT_DAYS - 1 });
  else if (preset === "month") from = today.startOf("month");
  else if (preset === "quarter") from = today.startOf("quarter");
  else {
    to = parseYmd(input.to, timeZone) ?? today;
    from = parseYmd(input.from, timeZone) ?? to.minus({ days: REPORT_DEFAULT_DAYS - 1 });
  }
  if (from > to) [from, to] = [to, from];
  const span = Math.round(to.diff(from, "days").days) + 1;
  if (span > REPORT_MAX_DAYS) from = to.minus({ days: REPORT_MAX_DAYS - 1 });
  const days = Math.round(to.diff(from, "days").days) + 1;
  return {
    preset,
    fromYmd: from.toISODate()!,
    toYmd: to.toISODate()!,
    start: from.toJSDate(),
    endExclusive: to.plus({ days: 1 }).toJSDate(),
    days,
    timeZone,
  };
}

export type ReportBucket = {
  key: string;
  label: string;
  start: Date;
  endExclusive: Date;
};

/** Daily buckets for short ranges, Monday-start weekly buckets (clipped to the range) otherwise. */
export function reportBuckets(range: ReportRange): ReportBucket[] {
  const zone = range.timeZone;
  const first = DateTime.fromJSDate(range.start, { zone });
  const end = DateTime.fromJSDate(range.endExclusive, { zone });
  const buckets: ReportBucket[] = [];
  if (range.days <= REPORT_DAILY_BUCKET_MAX_DAYS) {
    for (let cursor = first; cursor < end; cursor = cursor.plus({ days: 1 })) {
      buckets.push({
        key: cursor.toISODate()!,
        label: cursor.toFormat("MMM d"),
        start: cursor.toJSDate(),
        endExclusive: cursor.plus({ days: 1 }).toJSDate(),
      });
    }
    return buckets;
  }
  let cursor = first;
  while (cursor < end) {
    const weekEnd = cursor.startOf("week").plus({ weeks: 1 });
    const next = weekEnd < end ? weekEnd : end;
    buckets.push({
      key: cursor.toISODate()!,
      label: `Wk of ${cursor.toFormat("MMM d")}`,
      start: cursor.toJSDate(),
      endExclusive: next.toJSDate(),
    });
    cursor = next;
  }
  return buckets;
}

/** Index of the bucket containing `date`, or -1 when outside every bucket. */
export function bucketIndexFor(buckets: ReportBucket[], date: Date | null | undefined): number {
  if (!date) return -1;
  const ms = date.getTime();
  let lo = 0;
  let hi = buckets.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const b = buckets[mid]!;
    if (ms < b.start.getTime()) hi = mid - 1;
    else if (ms >= b.endExclusive.getTime()) lo = mid + 1;
    else return mid;
  }
  return -1;
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function hoursBetween(later: Date, earlier: Date): number {
  return Math.max(0, (later.getTime() - earlier.getTime()) / 3_600_000);
}

/** "45m", "6.5h", "3.2d"; em dash when unknown. */
export function formatDurationHours(hours: number | null | undefined): string {
  if (hours == null || !Number.isFinite(hours)) return "—";
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 48) return `${Math.round(hours * 10) / 10}h`;
  return `${Math.round((hours / 24) * 10) / 10}d`;
}

export function percent(part: number, whole: number): number | null {
  if (whole <= 0) return null;
  return Math.round((part / whole) * 1000) / 10;
}

function csvCell(value: string | number | null | undefined): string {
  if (value == null) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

/** Attachment response for report CSV downloads (BOM so Excel reads UTF-8). */
export function csvDownloadResponse(filename: string, csv: string): Response {
  return new Response(`\uFEFF${csv}`, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename.replace(/"/g, "")}"`,
      "Cache-Control": "no-store",
    },
  });
}
