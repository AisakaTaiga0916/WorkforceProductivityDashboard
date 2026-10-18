import { DateTime } from "luxon";
import { parseCsvLine } from "@/lib/csv-parse";
import { normalizeTimeZone } from "@/modules/tasks/kpi-recurrence";
import { prisma } from "@/modules/platform/db/prisma";

/** Matches app ticket status grouping for USER SUPPORT pillar. */
export const HELPDESK_CSV_FOR_CONFIRMATION = "FOR_CONFIRMATION";
export const HELPDESK_CSV_CLOSED = "CLOSED";
/** Open / in-progress on the sheet (everything else we do not count in the donut). */
export const HELPDESK_CSV_PIPELINE = "PIPELINE";

export type HelpdeskCsvNormalizedBucket =
  | typeof HELPDESK_CSV_FOR_CONFIRMATION
  | typeof HELPDESK_CSV_CLOSED
  | typeof HELPDESK_CSV_PIPELINE;

type WorkingDayInterval = { start: Date; end: Date };

function normalizeStatusCell(raw: string): HelpdeskCsvNormalizedBucket {
  const s = raw.trim().toLowerCase();
  if (s === "completed") return HELPDESK_CSV_FOR_CONFIRMATION;
  if (s === "closed") return HELPDESK_CSV_CLOSED;
  return HELPDESK_CSV_PIPELINE;
}

/** Reject bogus STAMP dates (e.g. Excel epoch / year 1899) so we fall back to Timestamp. */
function isTrustworthyResolvedAt(d: Date): boolean {
  const y = d.getFullYear();
  return y >= 2000 && y <= 2100;
}

/**
 * Parse common cells from IT SALF helpdesk export / Google Form download.
 * Supports: "Thursday, March 12, 2026, 2:15:07 PM", "3/18/2026 8:45:48", M/D/YYYY / D/M/YYYY variants.
 */
export function parseHelpdeskExportDate(raw: string | undefined, timeZone: string): Date | null {
  const z = normalizeTimeZone(timeZone);
  const t = (raw ?? "").trim().replace(/^"|"$/g, "").replace(/\u00a0/g, " ");
  if (!t) return null;

  const tryJs = Date.parse(t);
  if (!Number.isNaN(tryJs)) {
    const d = new Date(tryJs);
    if (isTrustworthyResolvedAt(d)) return d;
  }

  const formats = [
    "cccc, MMMM d, yyyy, h:mm:ss a",
    "EEEE, MMMM d, yyyy, h:mm:ss a",
    "MMMM d, yyyy, h:mm:ss a",
    "M/d/yyyy h:mm:ss",
    "M/d/yyyy H:mm",
    "d/M/yyyy H:mm:ss",
    "d/M/yyyy H:mm",
    "M/d/yyyy",
    "yyyy-M-d H:mm:ss",
    "yyyy-M-d",
  ];
  for (const fmt of formats) {
    const dt = DateTime.fromFormat(t, fmt, { zone: z, locale: "en" });
    if (dt.isValid) {
      const d = dt.toJSDate();
      if (isTrustworthyResolvedAt(d)) return d;
    }
  }
  return null;
}

function headerIndex(headerCells: string[], name: string): number {
  const needle = name.trim().toUpperCase();
  const idx = headerCells.findIndex((c) => c.trim().replace(/\s+/g, " ").toUpperCase() === needle);
  return idx;
}

export type ParsedHelpdeskCsvRow = {
  sheetRowId: string;
  reportedAt: Date;
  resolvedAt: Date | null;
  statusRaw: string;
  normalizedBucket: HelpdeskCsvNormalizedBucket;
  userEmail: string | null;
};

/**
 * Parse HELPDESK export CSV. **Completed** → `FOR_CONFIRMATION` bucket; **Closed** → `CLOSED`.
 */
export function parseHelpdeskExportCsv(content: string, timeZone: string): ParsedHelpdeskCsvRow[] {
  const z = normalizeTimeZone(timeZone);
  const lines = content.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  const header = parseCsvLine(lines[0]!);
  const iStatus = headerIndex(header, "STATUS");
  const iStamp = headerIndex(header, "STAMP");
  const iTs = headerIndex(header, "Timestamp");
  const iEmail = headerIndex(header, "userEmail");
  if (iStatus < 0 || iTs < 0) return [];

  const out: ParsedHelpdeskCsvRow[] = [];
  for (let L = 1; L < lines.length; L++) {
    const cols = parseCsvLine(lines[L]!);
    const sheetRowId = (cols[0] ?? "").trim();
    if (!sheetRowId) continue;

    const reportedAt = parseHelpdeskExportDate(cols[iTs], z);
    if (!reportedAt) continue;

    const statusRaw = (cols[iStatus] ?? "").trim();
    if (!statusRaw) continue;

    const normalizedBucket = normalizeStatusCell(statusRaw);
    let resolvedAt: Date | null = null;
    if (iStamp >= 0) {
      const st = parseHelpdeskExportDate(cols[iStamp], z);
      if (st) resolvedAt = st;
    }

    const userEmail = iEmail >= 0 ? (cols[iEmail] ?? "").trim() || null : null;

    out.push({
      sheetRowId,
      reportedAt,
      resolvedAt,
      statusRaw,
      normalizedBucket,
      userEmail,
    });
  }
  return out;
}

function dateInWorkingIntervals(d: Date, intervals: WorkingDayInterval[]): boolean {
  const t = d.getTime();
  for (const iv of intervals) {
    if (t >= iv.start.getTime() && t <= iv.end.getTime()) return true;
  }
  return false;
}

export type HelpdeskTaskMetricCounts = {
  userSupport: { forConfirmation: number; closed: number };
  closedInRange: number;
  openTicketsInPeriod: number;
  requestsInRange: number;
};

/** IT SALF sheet months: historical import only (no live ticket double-count). */
export const HELPDESK_CSV_ONLY_YEAR_MONTHS = new Set(["2026-03", "2026-04"]);

/** From this month onward: sheet rows in range + live system tickets (Asia/Manila months). */
export const HELPDESK_LIVE_BLEND_FROM_YM = "2026-05";

export type HelpdeskMetricBlend = "csv-only" | "csv-and-live" | "live-only";

export function reportingYearMonthFromYmd(ymd: string): string {
  return ymd.trim().slice(0, 7);
}

/** List YYYY-MM from `fromYm` through `toYm` inclusive. */
export function yearMonthsBetween(fromYm: string, toYm: string): string[] {
  let from = fromYm;
  let to = toYm;
  if (from > to) {
    const swap = from;
    from = to;
    to = swap;
  }
  const out: string[] = [];
  let [y, m] = from.split("-").map(Number) as [number, number];
  const [ty, tm] = to.split("-").map(Number) as [number, number];
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/**
 * March–April 2026 → sheet only. May 2026+ → sheet rows for that month + live tickets.
 */
export function resolveHelpdeskMetricBlend(fromYmd: string, toYmd: string): HelpdeskMetricBlend {
  const months = yearMonthsBetween(
    reportingYearMonthFromYmd(fromYmd),
    reportingYearMonthFromYmd(toYmd),
  );
  if (months.length === 0) return "live-only";
  if (months.every((ym) => HELPDESK_CSV_ONLY_YEAR_MONTHS.has(ym))) return "csv-only";
  if (months.some((ym) => ym >= HELPDESK_LIVE_BLEND_FROM_YM)) return "csv-and-live";
  return "live-only";
}

export function combineHelpdeskCountsByBlend(
  csv: HelpdeskTaskMetricCounts | null,
  live: HelpdeskTaskMetricCounts | null,
  blend: HelpdeskMetricBlend,
): HelpdeskTaskMetricCounts | null {
  if (blend === "csv-only") return csv;
  if (blend === "csv-and-live") return mergeHelpdeskTaskMetricCounts(csv, live);
  return live;
}

/** Sum IT SALF sheet counts with live {@link Ticket} counts (global Insights scope). */
export function mergeHelpdeskTaskMetricCounts(
  csv: HelpdeskTaskMetricCounts | null,
  live: HelpdeskTaskMetricCounts | null,
): HelpdeskTaskMetricCounts | null {
  if (!csv && !live) return null;
  return {
    userSupport: {
      forConfirmation:
        (csv?.userSupport.forConfirmation ?? 0) + (live?.userSupport.forConfirmation ?? 0),
      closed: (csv?.userSupport.closed ?? 0) + (live?.userSupport.closed ?? 0),
    },
    closedInRange: (csv?.closedInRange ?? 0) + (live?.closedInRange ?? 0),
    openTicketsInPeriod: (csv?.openTicketsInPeriod ?? 0) + (live?.openTicketsInPeriod ?? 0),
    requestsInRange: (csv?.requestsInRange ?? 0) + (live?.requestsInRange ?? 0),
  };
}

/**
 * IT SALF helpdesk export rows (global scope). Returns null when the table is empty.
 * Pair with live ticket counts via {@link mergeHelpdeskTaskMetricCounts}.
 */
export async function loadHelpdeskCsvTaskMetricCounts(args: {
  workingDayIntervals: WorkingDayInterval[];
  /** Mon–Sat span containing all intervals */
  span: { from: Date; to: Date };
}): Promise<HelpdeskTaskMetricCounts | null> {
  const total = await prisma.helpdeskCsvTicket.count();
  if (total === 0) return null;

  const { workingDayIntervals, span } = args;
  if (workingDayIntervals.length === 0) return null;

  const rows = await prisma.helpdeskCsvTicket.findMany({
    where: {
      OR: [
        { reportedAt: { gte: span.from, lte: span.to } },
        { resolvedAt: { gte: span.from, lte: span.to } },
      ],
    },
    select: {
      normalizedBucket: true,
      reportedAt: true,
      resolvedAt: true,
    },
  });

  /** Event time for counting Completed/Closed in the reporting window */
  function bucketEffectiveAt(bucket: string, reportedAt: Date, resolvedAt: Date | null): Date {
    if (bucket === HELPDESK_CSV_CLOSED || bucket === HELPDESK_CSV_FOR_CONFIRMATION) {
      return resolvedAt ?? reportedAt;
    }
    return reportedAt;
  }

  let forConfirmation = 0;
  let closed = 0;
  let requestsInRange = 0;

  for (const r of rows) {
    if (dateInWorkingIntervals(r.reportedAt, workingDayIntervals)) {
      requestsInRange += 1;
    }

    const be = bucketEffectiveAt(r.normalizedBucket, r.reportedAt, r.resolvedAt ?? null);

    if (r.normalizedBucket === HELPDESK_CSV_FOR_CONFIRMATION) {
      if (dateInWorkingIntervals(be, workingDayIntervals)) forConfirmation += 1;
    } else if (r.normalizedBucket === HELPDESK_CSV_CLOSED) {
      if (dateInWorkingIntervals(be, workingDayIntervals)) closed += 1;
    }
  }

  return {
    userSupport: { forConfirmation, closed },
    closedInRange: closed,
    openTicketsInPeriod: forConfirmation,
    requestsInRange,
  };
}

export async function syncHelpdeskCsvToDatabase(csvContent: string, timeZone: string): Promise<{ upserted: number }> {
  const parsed = parseHelpdeskExportCsv(csvContent, timeZone);
  let upserted = 0;
  for (const r of parsed) {
    await prisma.helpdeskCsvTicket.upsert({
      where: { sheetRowId: r.sheetRowId },
      create: {
        sheetRowId: r.sheetRowId,
        reportedAt: r.reportedAt,
        resolvedAt: r.resolvedAt,
        statusRaw: r.statusRaw,
        normalizedBucket: r.normalizedBucket,
        userEmail: r.userEmail,
      },
      update: {
        reportedAt: r.reportedAt,
        resolvedAt: r.resolvedAt,
        statusRaw: r.statusRaw,
        normalizedBucket: r.normalizedBucket,
        userEmail: r.userEmail,
      },
    });
    upserted += 1;
  }
  return { upserted };
}
