import { readFile } from "fs/promises";
import { basename, resolve } from "path";
import type { KpiFrequency } from "@prisma/client/primary";
import { DateTime } from "luxon";
import { IT_TASK_PILLAR_TITLES, type ItTaskPillarTitle } from "@/modules/tasks/it-task-pillar-titles";
import {
  computePeriodKey,
  getDailyPeriodKey,
  getMonthlyPeriodKey,
  getQuarterlyPeriodKey,
  getSemiAnnualPeriodKey,
  getWeeklyPeriodKey,
  getYearlyPeriodKey,
  isKpiMetricsWorkingDay,
  normalizeTimeZone,
  type KpiFrequencyCode,
} from "@/modules/tasks/kpi-recurrence";
import { parseCsvLine } from "@/lib/csv-parse";
import { getPeriodStartInclusive } from "@/modules/tasks/kpi-period-window";
import { prisma } from "@/modules/platform/db/prisma";

export { parseCsvLine };

/** Pillars imported from the IT SALF KPI spreadsheet into Task metrics. */
export const KPI_SHEET_IMPORT_PILLARS: ItTaskPillarTitle[] = [
  "DATA BACKUP",
  "SYSTEM MAINTENANCE",
  "MONITORING",
  "DOCUMENTATION",
];

/** Map KPI sheet labels (any case/spacing) to canonical pillar titles. */
const PILLAR_LOOKUP: Array<{ match: RegExp; pillar: ItTaskPillarTitle }> = [
  { match: /^\s*(data|database)\s+backup\s*$/i, pillar: "DATA BACKUP" },
  { match: /^\s*system\s+maintenance\s*$/i, pillar: "SYSTEM MAINTENANCE" },
  { match: /^\s*monitoring\s*$/i, pillar: "MONITORING" },
  { match: /^\s*documentations?\s*$/i, pillar: "DOCUMENTATION" },
];

export function matchPillarFromSheetLabel(raw: string): ItTaskPillarTitle | null {
  const s = raw.trim().replace(/\s*\*+\s*$/u, "").trim();
  if (!s) return null;
  for (const { match, pillar } of PILLAR_LOOKUP) {
    if (match.test(s)) return pillar;
  }
  const squish = s.toUpperCase().replace(/\s+/g, " ");
  if ((IT_TASK_PILLAR_TITLES as readonly string[]).includes(squish)) {
    return squish as ItTaskPillarTitle;
  }
  return null;
}

/** Map a `KpiMaintenance.title` (any casing / legacy wording) to a canonical pillar. */
export function pillarFromKpiTitle(title: string): ItTaskPillarTitle | null {
  return matchPillarFromSheetLabel(title);
}

const EMPTY_SUB_KPIS = { segmented: false as const, items: [] as { id: string; title: string; done: boolean }[] };

/** Create missing pillar KPI rows and normalize legacy titles (e.g. Database Backup → DATA BACKUP). */
export async function ensureKpisForSheetImport(
  pillars: ItTaskPillarTitle[],
  timeZone: string,
): Promise<{ created: number; renamed: number }> {
  const zone = normalizeTimeZone(timeZone);
  const freq: KpiFrequency = "MONTHLY";
  const recurrenceMonthDay = 1;
  const at = new Date();
  const periodKey = computePeriodKey(freq, null, recurrenceMonthDay, at, zone);
  const periodCycleStartAt = getPeriodStartInclusive(freq, null, recurrenceMonthDay, at, zone);

  const existing = await prisma.kpiMaintenance.findMany({
    where: { isRecurring: true },
    select: { id: true, title: true },
  });

  let created = 0;
  let renamed = 0;

  for (const pillar of pillars) {
    const matches = existing.filter((k) => pillarFromKpiTitle(k.title) === pillar);
    if (matches.length === 0) {
      await prisma.kpiMaintenance.create({
        data: {
          title: pillar,
          isRecurring: true,
          frequency: freq,
          recurrenceMonthDay,
          subKpis: EMPTY_SUB_KPIS,
          periodKey,
          periodCycleStartAt,
          createdBy: "kpi-sheet-import",
          createdByRole: "SuperAdmin",
        },
      });
      created += 1;
      continue;
    }
    for (const row of matches) {
      if (row.title !== pillar) {
        await prisma.kpiMaintenance.update({
          where: { id: row.id },
          data: { title: pillar },
        });
        renamed += 1;
      }
    }
  }

  return { created, renamed };
}

/** Calendar month `YYYY-MM` → monthly period key for a KPI with given anchor day. */
export function monthlyPeriodKeyForYMonth(
  ym: string,
  recurrenceMonthDay: number | null | undefined,
  timeZone: string,
): string {
  const zone = normalizeTimeZone(timeZone);
  const parts = ym.trim().split("-");
  if (parts.length !== 2) throw new Error(`Invalid month key "${ym}" (expected YYYY-MM)`);
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    throw new Error(`Invalid month key "${ym}"`);
  }
  const dom = typeof recurrenceMonthDay === "number" ? recurrenceMonthDay : 1;
  const mid = DateTime.fromObject({ year, month, day: 15 }, { zone }).toJSDate();
  return getMonthlyPeriodKey(mid, dom, zone);
}

/** Every local calendar day in `YYYY-MM` as `YYYY-MM-DD`. */
export function enumerateYmdDaysInMonth(ym: string, timeZone: string): string[] {
  const zone = normalizeTimeZone(timeZone);
  const parts = ym.trim().split("-");
  if (parts.length !== 2) throw new Error(`Invalid month key "${ym}"`);
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    throw new Error(`Invalid month key "${ym}"`);
  }
  const start = DateTime.fromObject({ year, month, day: 1 }, { zone }).startOf("day");
  const dim = start.daysInMonth ?? 28;
  const out: string[] = [];
  for (let d = 1; d <= dim; d++) {
    const dt = DateTime.fromObject({ year, month, day: d }, { zone });
    if (!isKpiMetricsWorkingDay(dt)) continue;
    const iso = dt.toISODate();
    if (iso) out.push(iso);
  }
  return out;
}

function periodKeysForImportedMonth(
  frequency: string,
  ym: string,
  recurrenceWeekday: number | null | undefined,
  recurrenceMonthDay: number | null | undefined,
  timeZone: string,
): string[] {
  const zone = normalizeTimeZone(timeZone);
  const days = enumerateYmdDaysInMonth(ym, zone);
  if (frequency === "MONTHLY") {
    return [monthlyPeriodKeyForYMonth(ym, recurrenceMonthDay, timeZone)];
  }
  if (frequency === "QUARTERLY") {
    const dom = typeof recurrenceMonthDay === "number" ? recurrenceMonthDay : 1;
    const keys = new Set<string>();
    for (const ymd of days) {
      keys.add(getQuarterlyPeriodKey(DateTime.fromISO(ymd, { zone }).toJSDate(), dom, zone));
    }
    return [...keys];
  }
  if (frequency === "SEMI_ANNUAL") {
    const dom = typeof recurrenceMonthDay === "number" ? recurrenceMonthDay : 1;
    const keys = new Set<string>();
    for (const ymd of days) {
      keys.add(getSemiAnnualPeriodKey(DateTime.fromISO(ymd, { zone }).toJSDate(), dom, zone));
    }
    return [...keys];
  }
  if (frequency === "YEARLY") {
    const dom = typeof recurrenceMonthDay === "number" ? recurrenceMonthDay : 1;
    const keys = new Set<string>();
    for (const ymd of days) {
      keys.add(getYearlyPeriodKey(DateTime.fromISO(ymd, { zone }).toJSDate(), dom, zone));
    }
    return [...keys];
  }
  if (frequency === "DAILY") {
    return days.map((ymd) => getDailyPeriodKey(DateTime.fromISO(ymd, { zone }).toJSDate(), zone));
  }
  if (frequency === "WEEKLY") {
    const wd = typeof recurrenceWeekday === "number" ? recurrenceWeekday : 1;
    const keys = new Set<string>();
    for (const ymd of days) {
      keys.add(getWeeklyPeriodKey(DateTime.fromISO(ymd, { zone }).toJSDate(), wd, zone));
    }
    return [...keys];
  }
  return [];
}

export type SheetImportPillarPercents = Partial<Record<ItTaskPillarTitle, Record<string, number>>>;

export type ApplyKpiSheetSnapshotResult = {
  applied: number;
  skipped: Array<{ reason: string; detail?: string }>;
};

export type DailyPillarPercentRow = { ymd: string; percent: number };

const MONTH_NAME_TO_NUM: Record<string, number> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

function parseEffPercentCell(raw: string | undefined): number | null {
  const t = (raw ?? "").trim().replace(/%/g, "");
  if (!t || t === "-") return null;
  const n = Number(t);
  return Number.isNaN(n) ? null : Math.round(Math.min(100, Math.max(0, n)));
}

/** IT SALF daily export: `"Monday, March 2, 2026",MARCH,...,EFF %` */
export function parseItSalfDailyPillarCsv(content: string, timeZone: string): DailyPillarPercentRow[] {
  const zone = normalizeTimeZone(timeZone);
  const rows: DailyPillarPercentRow[] = [];
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cols = parseCsvLine(line);
    const dateCell = (cols[0] ?? "").replace(/^"|"$/g, "").trim();
    if (!/^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday),/i.test(dateCell)) continue;

    let dt = DateTime.fromFormat(dateCell, "cccc, MMMM d, yyyy", { zone, locale: "en" });
    if (!dt.isValid) {
      dt = DateTime.fromFormat(dateCell, "EEEE, MMMM d, yyyy", { zone, locale: "en" });
    }
    if (!dt.isValid || !isKpiMetricsWorkingDay(dt)) continue;

    const percent = parseEffPercentCell(cols[cols.length - 1]);
    if (percent == null) continue;
    const ymd = dt.toISODate();
    if (!ymd) continue;
    rows.push({ ymd, percent });
  }
  return rows;
}

/**
 * IT SALF monthly summary export: `2026,MARCH,...,80%` — expanded to each working day in that month.
 * Skips rows with 0% when `skipZeroPercent` (placeholder future months).
 */
export function parseItSalfMonthlySummaryPillarCsv(
  content: string,
  timeZone: string,
  opts?: { skipZeroPercent?: boolean },
): DailyPillarPercentRow[] {
  const zone = normalizeTimeZone(timeZone);
  const skipZero = opts?.skipZeroPercent !== false;
  const rows: DailyPillarPercentRow[] = [];
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cols = parseCsvLine(line);
    const year = Number((cols[0] ?? "").trim());
    const monthName = (cols[1] ?? "").trim().toLowerCase();
    if (!Number.isFinite(year) || year < 2000 || !monthName) continue;
    const month = MONTH_NAME_TO_NUM[monthName];
    if (!month) continue;
    const percent = parseEffPercentCell(cols[cols.length - 1]);
    if (percent == null || (skipZero && percent === 0)) continue;
    const ym = `${year}-${String(month).padStart(2, "0")}`;
    for (const ymd of enumerateYmdDaysInMonth(ym, zone)) {
      rows.push({ ymd, percent });
    }
  }
  return rows;
}

/** Daily per-row CSV, or monthly summary CSV — returns working-day rows ready for snapshot import. */
export function parseItSalfPillarCsv(content: string, timeZone: string): DailyPillarPercentRow[] {
  const daily = parseItSalfDailyPillarCsv(content, timeZone);
  if (daily.length > 0) return daily;
  return parseItSalfMonthlySummaryPillarCsv(content, timeZone, { skipZeroPercent: true });
}

const IT_SALF_DISPLAY_FILENAMES: Partial<Record<ItTaskPillarTitle, string>> = {
  "DATA BACKUP": "IT SALF - DATA BACKUP.csv",
};
const DAILY_ACTIVITY_MONITORING_FILENAME = "IT DAILY ACTIVITY - DAILY ACTIVITY ROBINA.csv";

function parseItSalfDisplayDateCell(raw: string, timeZone: string): { ymd: string; isWorkingDay: boolean } | null {
  const dateCell = raw.replace(/^"|"$/g, "").trim();
  let dt = DateTime.fromFormat(dateCell, "cccc, MMMM d, yyyy", { zone: timeZone, locale: "en" });
  if (!dt.isValid) {
    dt = DateTime.fromFormat(dateCell, "EEEE, MMMM d, yyyy", { zone: timeZone, locale: "en" });
  }
  const ymd = dt.isValid ? dt.toISODate() : null;
  return ymd ? { ymd, isWorkingDay: isKpiMetricsWorkingDay(dt) } : null;
}

export function parseItSalfDisplayCsvRows(
  content: string,
  timeZone: string,
  fromYmd: string,
  toYmd: string,
): string[][] {
  const rows: string[][] = [];
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cols = parseCsvLine(line);
    const parsedDate = parseItSalfDisplayDateCell(cols[0] ?? "", timeZone);
    if (!parsedDate || !parsedDate.isWorkingDay || parsedDate.ymd < fromYmd || parsedDate.ymd > toYmd) continue;
    rows.push([
      (cols[0] ?? "").replace(/^"|"$/g, "").trim(),
      (cols[1] ?? "").trim(),
      (cols[2] ?? "").trim(),
      (cols[3] ?? "").trim(),
      (cols[4] ?? "").trim(),
      (cols[5] ?? "").trim(),
      (cols[6] ?? "").trim(),
      (cols[7] ?? "").trim(),
    ]);
  }
  return rows;
}

function parseDailyActivityDate(raw: string, timeZone: string): { ymd: string; isWorkingDay: boolean } | null {
  const trimmed = raw.trim();
  const formats = ["M/d/yyyy", "M/d/yy", "yyyy-MM-dd"];
  for (const format of formats) {
    const dt = DateTime.fromFormat(trimmed, format, { zone: timeZone });
    const ymd = dt.isValid ? dt.toISODate() : null;
    if (ymd) return { ymd, isWorkingDay: isKpiMetricsWorkingDay(dt) };
  }
  const iso = DateTime.fromISO(trimmed, { zone: timeZone });
  const ymd = iso.isValid ? iso.toISODate() : null;
  return ymd ? { ymd, isWorkingDay: isKpiMetricsWorkingDay(iso) } : null;
}

export function parseMonitoringDisplayCsvRows(
  content: string,
  timeZone: string,
  fromYmd: string,
  toYmd: string,
): string[][] {
  const lines = content.split(/\r?\n/).filter((line) => line.trim());
  const header = parseCsvLine(lines[0] ?? "").map((h) => h.trim().toUpperCase());
  const dateIdx = header.indexOf("R");
  const issueIdx = header.indexOf("ISSUE / CONCERN / ACTIVY");
  const percentIdx = header.indexOf("%");
  const statusIdx = header.indexOf("STATUS");
  if (dateIdx < 0 || issueIdx < 0 || percentIdx < 0 || statusIdx < 0) return [];

  const rows: string[][] = [];
  for (const line of lines.slice(1)) {
    const cols = parseCsvLine(line);
    const issue = cols[issueIdx] ?? "";
    if (!/\bmonitoring\b/i.test(issue)) continue;

    const parsedDate = parseDailyActivityDate(cols[dateIdx] ?? "", timeZone);
    if (!parsedDate || !parsedDate.isWorkingDay || parsedDate.ymd < fromYmd || parsedDate.ymd > toYmd) continue;

    const status = (cols[statusIdx] ?? "").trim().toUpperCase();
    const eff = (cols[percentIdx] ?? "").trim();
    rows.push([
      status === "DONE" ? "DONE" : "",
      status === "ON GOING" || status === "ONGOING" ? "ON GOING" : "",
      status === "NOT STARTED" ? "NOT STARTED" : "",
      eff,
    ]);
  }
  return rows;
}

function displayCsvPathForPillar(pillar: ItTaskPillarTitle): string | null {
  const filename = pillar === "MONITORING" ? DAILY_ACTIVITY_MONITORING_FILENAME : IT_SALF_DISPLAY_FILENAMES[pillar];
  if (!filename) return null;
  const baseDir = process.env.IT_SALF_CSV_DIR ?? resolve(process.env.USERPROFILE ?? "", "Downloads");
  return resolve(baseDir, filename);
}

export async function loadItSalfDisplayCsvRowsForTaskMetrics(args: {
  fromYmd: string;
  toYmd: string;
  timeZone: string;
}): Promise<Partial<Record<ItTaskPillarTitle, string[][]>>> {
  const zone = normalizeTimeZone(args.timeZone);
  const out: Partial<Record<ItTaskPillarTitle, string[][]>> = {};
  await Promise.all(
    KPI_SHEET_IMPORT_PILLARS.map(async (pillar) => {
      const filePath = displayCsvPathForPillar(pillar);
      if (!filePath) return;
      try {
        const content = await readFile(filePath, "utf8");
        const rows =
          pillar === "MONITORING"
            ? parseMonitoringDisplayCsvRows(content, zone, args.fromYmd, args.toYmd)
            : parseItSalfDisplayCsvRows(content, zone, args.fromYmd, args.toYmd);
        if (rows.length > 0) out[pillar] = rows;
      } catch {
        // The local CSV files are optional; imported snapshots still power the headline metrics.
      }
    }),
  );
  return out;
}

/** Map `IT SALF - DATA BACKUP.csv` style filenames to pillar titles. */
export function pillarFromItSalfDailyFilename(filePath: string): ItTaskPillarTitle | null {
  const name = basename(filePath).toUpperCase();
  if (name.includes("SYSTEM") && name.includes("MAINTENANCE")) return "SYSTEM MAINTENANCE";
  if (name.includes("MONITORING")) return "MONITORING";
  if (name.includes("DATA") && name.includes("BACKUP")) return "DATA BACKUP";
  if (name.includes("DOCUMENTATION")) return "DOCUMENTATION";
  return matchPillarFromSheetLabel(name.replace(/\.CSV$/i, "").replace(/^IT SALF\s*-\s*/i, ""));
}

/** Task metrics need a DAILY KPI row; upgrade MONTHLY-only pillar definitions when importing daily history. */
export async function ensureDailyKpiForPillar(pillar: ItTaskPillarTitle): Promise<boolean> {
  const existingDaily = await prisma.kpiMaintenance.findFirst({
    where: { title: pillar, isRecurring: true, frequency: "DAILY" },
    select: { id: true },
  });
  if (existingDaily) return true;

  const fallback = await prisma.kpiMaintenance.findFirst({
    where: { title: pillar, isRecurring: true },
    orderBy: { createdAt: "asc" },
    select: { id: true, frequency: true },
  });
  if (!fallback) return false;

  await prisma.kpiMaintenance.update({
    where: { id: fallback.id },
    data: {
      frequency: "DAILY",
      recurrenceWeekday: null,
      recurrenceMonthDay: null,
    },
  });
  return true;
}

async function upsertPercentSnapshotForKpi(args: {
  kpi: {
    id: string;
    frequency: string;
    recurrenceWeekday: number | null;
    recurrenceMonthDay: number | null;
  };
  zone: string;
  periodKey: string;
  at: Date;
  percent: number;
}): Promise<void> {
  const { kpi, zone, periodKey, percent } = args;
  const total = 100;
  const done = percent;
  const missing = total - done;
  const fullyComplete = missing === 0;
  await prisma.kpiMaintenancePeriodSnapshot.upsert({
    where: {
      kpiMaintenanceId_periodKey: {
        kpiMaintenanceId: kpi.id,
        periodKey,
      },
    },
    create: {
      kpiMaintenanceId: kpi.id,
      periodKey,
      frequency: kpi.frequency as KpiFrequencyCode,
      timeZone: zone,
      total,
      done,
      missing,
      percent,
      fullyComplete,
    },
    update: {
      total,
      done,
      missing,
      percent,
      fullyComplete,
      frequency: kpi.frequency as KpiFrequencyCode,
      timeZone: zone,
      capturedAt: new Date(),
    },
  });
}

/**
 * One row per working day from IT SALF daily CSVs → DAILY KPI period snapshots.
 * EFF % column is stored as checklist percent (total=100); inverted pillars flip at display time.
 */
export async function applyDailyPillarPercentSnapshots(args: {
  pillar: ItTaskPillarTitle;
  timeZone: string;
  days: DailyPillarPercentRow[];
  assignedAgentId?: string;
}): Promise<ApplyKpiSheetSnapshotResult> {
  return applyDailyPercentSnapshotsByTitle({
    title: args.pillar,
    titleAliases: [args.pillar],
    timeZone: args.timeZone,
    days: args.days,
    assignedAgentId: args.assignedAgentId,
    ensureDaily: true,
    ensureDailyPillar: args.pillar,
  });
}

/**
 * Apply daily percent snapshots to a Task Board KPI matched by title (and optional aliases).
 * Used for legacy / dynamic titles such as SYSTEMS AVAILABILITY that are not in the IT pillar enum.
 */
export async function applyDailyPercentSnapshotsByTitle(args: {
  title: string;
  titleAliases?: string[];
  timeZone: string;
  days: DailyPillarPercentRow[];
  assignedAgentId?: string;
  ensureDaily?: boolean;
  ensureDailyPillar?: ItTaskPillarTitle;
}): Promise<ApplyKpiSheetSnapshotResult> {
  const zone = normalizeTimeZone(args.timeZone);
  const skipped: ApplyKpiSheetSnapshotResult["skipped"] = [];
  let applied = 0;

  const whereAgent =
    typeof args.assignedAgentId === "string" && args.assignedAgentId.length > 0
      ? { assignedAgentId: args.assignedAgentId }
      : {};

  const aliases = [
    args.title,
    ...(args.titleAliases ?? []),
  ]
    .map((t) => t.trim().replace(/\s+/g, " ").toUpperCase())
    .filter(Boolean);
  const aliasSet = new Set(aliases);

  const allRecurring = await prisma.kpiMaintenance.findMany({
    where: {
      isRecurring: true,
      frequency: { in: ["DAILY", "WEEKLY", "MONTHLY", "QUARTERLY", "SEMI_ANNUAL", "YEARLY"] },
      ...whereAgent,
    },
    select: {
      id: true,
      title: true,
      frequency: true,
      recurrenceWeekday: true,
      recurrenceMonthDay: true,
    },
  });

  let kpis = allRecurring.filter((k) =>
    aliasSet.has(k.title.trim().replace(/\s+/g, " ").toUpperCase()),
  );

  if (kpis.length === 0) {
    skipped.push({ reason: "no KPI row for title", detail: aliases.join(" | ") });
    return { applied, skipped };
  }

  let dailyKpis = kpis.filter((k) => k.frequency === "DAILY");
  if (dailyKpis.length === 0 && args.ensureDaily && args.ensureDailyPillar) {
    const ensured = await ensureDailyKpiForPillar(args.ensureDailyPillar);
    if (ensured) {
      const refreshed = await prisma.kpiMaintenance.findMany({
        where: {
          isRecurring: true,
          title: { in: [...aliasSet] },
          frequency: "DAILY",
          ...whereAgent,
        },
        select: {
          id: true,
          title: true,
          frequency: true,
          recurrenceWeekday: true,
          recurrenceMonthDay: true,
        },
      });
      dailyKpis = refreshed;
      kpis = refreshed;
    }
  }

  if (dailyKpis.length === 0) {
    // Prefer writing against the matched row even if still MONTHLY — caller can set frequency.
    dailyKpis = kpis;
  }

  for (const { ymd, percent } of args.days) {
    const at = DateTime.fromISO(ymd, { zone }).toJSDate();
    const periodKey = getDailyPeriodKey(at, zone);
    for (const kpi of dailyKpis) {
      await upsertPercentSnapshotForKpi({
        kpi: { ...kpi, frequency: "DAILY" },
        zone,
        periodKey,
        at,
        percent,
      });
      applied += 1;
    }
  }

  return { applied, skipped };
}

/**
 * Writes `KpiMaintenancePeriodSnapshot` rows from headline percentages (0–100).
 * Each snapshot uses total=100 so Task metrics math matches the target percent.
 * Supports DAILY / WEEKLY / MONTHLY / QUARTERLY KPI rows: a monthly spreadsheet cell is expanded
 * to every period key in that month (each day, each distinct week start in the month,
 * or the monthly anchor key) so Task metrics averages match the sheet headline %.
 */
export async function applyPillarPercentSnapshots(args: {
  timeZone: string;
  pillarMonths: Record<string, Record<string, number> | undefined>;
  assignedAgentId?: string;
  ensureKpiRows?: boolean;
}): Promise<ApplyKpiSheetSnapshotResult> {
  const zone = normalizeTimeZone(args.timeZone);
  const skipped: ApplyKpiSheetSnapshotResult["skipped"] = [];
  let applied = 0;

  const whereAgent =
    typeof args.assignedAgentId === "string" && args.assignedAgentId.length > 0
      ? { assignedAgentId: args.assignedAgentId }
      : {};

  const normalizedPillars: SheetImportPillarPercents = {};
  for (const [rawLabel, byMonth] of Object.entries(args.pillarMonths)) {
    const pillar = matchPillarFromSheetLabel(rawLabel);
    if (!pillar) {
      skipped.push({ reason: "unknown pillar label", detail: rawLabel });
      continue;
    }
    if (!byMonth) continue;
    if (!(KPI_SHEET_IMPORT_PILLARS as readonly string[]).includes(pillar)) continue;
    normalizedPillars[pillar] = { ...normalizedPillars[pillar], ...byMonth };
  }

  const pillarsToEnsure = Object.keys(normalizedPillars) as ItTaskPillarTitle[];
  if (args.ensureKpiRows !== false && pillarsToEnsure.length > 0) {
    const ensured = await ensureKpisForSheetImport(pillarsToEnsure, zone);
    if (ensured.created > 0 || ensured.renamed > 0) {
      console.info(
        `[kpi-sheet-import] ensured KPI rows: created=${ensured.created}, renamed=${ensured.renamed}`,
      );
    }
  }

  const allRecurringKpis = await prisma.kpiMaintenance.findMany({
    where: {
      isRecurring: true,
      frequency: { in: ["DAILY", "WEEKLY", "MONTHLY", "QUARTERLY", "SEMI_ANNUAL", "YEARLY"] },
      ...whereAgent,
    },
    select: {
      id: true,
      title: true,
      frequency: true,
      recurrenceWeekday: true,
      recurrenceMonthDay: true,
    },
  });

  for (const [pillar, byMonth] of Object.entries(normalizedPillars)) {
    if (!byMonth || typeof byMonth !== "object") continue;

    const kpis = allRecurringKpis.filter((k) => pillarFromKpiTitle(k.title) === pillar);

    if (kpis.length === 0) {
      skipped.push({
        reason: "no KPI row for pillar",
        detail: `pillar=${pillar}`,
      });
      continue;
    }

    for (const [ym, rawPct] of Object.entries(byMonth)) {
      if (rawPct == null || Number.isNaN(rawPct)) {
        skipped.push({ reason: "missing percent", detail: `${pillar} ${ym}` });
        continue;
      }
      const percent = Math.round(Math.min(100, Math.max(0, Number(rawPct))));
      const total = 100;
      const done = percent;
      const missing = total - done;
      const fullyComplete = missing === 0;

      for (const kpi of kpis) {
        const freq = kpi.frequency as string;
        const periodKeys = periodKeysForImportedMonth(
          freq,
          ym,
          kpi.recurrenceWeekday,
          kpi.recurrenceMonthDay,
          zone,
        );
        if (periodKeys.length === 0) {
          skipped.push({ reason: "unsupported KPI frequency", detail: `${pillar} ${kpi.id} ${freq}` });
          continue;
        }
        for (const periodKey of periodKeys) {
          await prisma.kpiMaintenancePeriodSnapshot.upsert({
            where: {
              kpiMaintenanceId_periodKey: {
                kpiMaintenanceId: kpi.id,
                periodKey,
              },
            },
            create: {
              kpiMaintenanceId: kpi.id,
              periodKey,
              frequency: kpi.frequency,
              timeZone: zone,
              total,
              done,
              missing,
              percent,
              fullyComplete,
            },
            update: {
              total,
              done,
              missing,
              percent,
              fullyComplete,
              frequency: kpi.frequency,
              timeZone: zone,
              capturedAt: new Date(),
            },
          });
          applied += 1;
        }
      }
    }
  }

  return { applied, skipped };
}
