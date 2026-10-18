import { readFileSync } from "fs";
import type { KpiFrequency, Prisma } from "@prisma/client/primary";
import { DateTime } from "luxon";
import type { ItTaskPillarTitle } from "@/modules/tasks/it-task-pillar-titles";
import { pillarFromKpiTitle, matchPillarFromSheetLabel } from "@/modules/tasks/kpi-sheet-import-snapshots";
import { getDailyPeriodKey, normalizeTimeZone } from "@/modules/tasks/kpi-recurrence";
import { getPeriodStartInclusive } from "@/modules/tasks/kpi-period-window";
import { wrapForPersist, type SubKpiItem } from "@/modules/tasks/kpi-subkpis";
import { computePeriodKey } from "@/modules/tasks/kpi-recurrence";
import { prisma } from "@/modules/platform/db/prisma";

export const IT_SALF_DAILY_COMPANY_COLUMNS = ["ALI", "ACI", "MCHISI LPG", "AWIC", "EASYGAS"] as const;

const PILLAR_FROM_FILENAME: Array<{ match: RegExp; pillar: ItTaskPillarTitle }> = [
  { match: /data\s*backup/i, pillar: "DATA BACKUP" },
  { match: /system\s*maintenance/i, pillar: "SYSTEM MAINTENANCE" },
  { match: /monitoring/i, pillar: "MONITORING" },
  { match: /documentation/i, pillar: "DOCUMENTATION" },
];

export type ItSalfDailyRow = {
  ymd: string;
  monthLabel: string;
  checks: Record<string, boolean>;
  effPercent: number | null;
};

export type ParsedItSalfDailyCsv = {
  pillar: ItTaskPillarTitle;
  companies: string[];
  rows: ItSalfDailyRow[];
};

/** Handles quoted fields (e.g. `"Sunday, March 1, 2026"`). */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function parseBoolCell(s: string): boolean {
  return s.trim().toUpperCase() === "TRUE";
}

function parsePercentCell(s: string): number | null {
  const t = s.trim().replace(/%/g, "");
  if (!t || t === "-") return null;
  const n = Number(t);
  return Number.isNaN(n) ? null : n;
}

export function pillarFromItSalfFilename(filePath: string): ItTaskPillarTitle | null {
  const base = filePath.replace(/\\/g, "/").split("/").pop() ?? filePath;
  for (const { match, pillar } of PILLAR_FROM_FILENAME) {
    if (match.test(base)) return pillar;
  }
  return matchPillarFromSheetLabel(base.replace(/\.csv$/i, ""));
}

export function parseItSalfDateCell(raw: string, zone: string): string | null {
  const t = raw.trim().replace(/^"|"$/g, "");
  if (!t || t === "C" || /^date$/i.test(t)) return null;
  const dt = DateTime.fromFormat(t, "EEEE, MMMM d, yyyy", { zone: normalizeTimeZone(zone) });
  if (!dt.isValid) return null;
  return dt.toISODate();
}

function findCompanyHeaderRow(lines: string[]): { rowIndex: number; companies: string[] } | null {
  for (let i = 0; i < Math.min(lines.length, 10); i++) {
    const cols = splitCsvLine(lines[i]!);
    const upper = cols.map((c) => c.toUpperCase());
    const aliIdx = upper.findIndex((c) => c === "ALI");
    if (aliIdx < 0) continue;
    const companies: string[] = [];
    for (let j = aliIdx; j < cols.length; j++) {
      const h = cols[j]?.trim() ?? "";
      if (!h || /^eff/i.test(h)) break;
      companies.push(h.toUpperCase() === "EASYGAS" ? "EASYGAS" : h.trim());
    }
    if (companies.length > 0) return { rowIndex: i, companies };
  }
  return null;
}

export function parseItSalfDailyCsvFile(
  filePath: string,
  zone: string,
  fromYmd: string,
  toYmd: string,
): ParsedItSalfDailyCsv {
  const pillar = pillarFromItSalfFilename(filePath);
  if (!pillar) {
    throw new Error(`Could not map CSV to a task pillar: ${filePath}`);
  }

  const raw = readFileSync(filePath, "utf8");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  const header = findCompanyHeaderRow(lines);
  if (!header) {
    throw new Error(`Could not find company columns (ALI, ACI, …) in ${filePath}`);
  }

  const { companies } = header;
  const effColHint = companies.length;
  const from = DateTime.fromISO(fromYmd, { zone });
  const to = DateTime.fromISO(toYmd, { zone });
  const rows: ItSalfDailyRow[] = [];

  for (let i = header.rowIndex + 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]!);
    const ymd = parseItSalfDateCell(cols[0] ?? "", zone);
    if (!ymd) continue;
    const dt = DateTime.fromISO(ymd, { zone });
    if (dt < from || dt > to) continue;

    const monthLabel = (cols[1] ?? "").trim().toUpperCase();
    if (monthLabel && monthLabel !== "MARCH" && monthLabel !== "APRIL") continue;

    const checks: Record<string, boolean> = {};
    for (let c = 0; c < companies.length; c++) {
      const company = companies[c]!;
      checks[company] = parseBoolCell(cols[2 + c] ?? "");
    }
    const effRaw = cols[2 + effColHint] ?? cols[cols.length - 1] ?? "";
    rows.push({
      ymd,
      monthLabel,
      checks,
      effPercent: parsePercentCell(effRaw),
    });
  }

  return { pillar, companies, rows };
}

function stableSubKpiId(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, "-");
}

export function buildSubKpisFromChecks(
  companies: readonly string[],
  checks: Record<string, boolean>,
): Prisma.InputJsonValue {
  const items: SubKpiItem[] = companies.map((title) => ({
    id: stableSubKpiId(title),
    title,
    done: Boolean(checks[title]),
  }));
  return wrapForPersist({ segmented: false, flat: items });
}

export function checklistProgressFromChecks(
  companies: readonly string[],
  checks: Record<string, boolean>,
  effPercent: number | null,
): { total: number; done: number; missing: number; percent: number; fullyComplete: boolean } {
  const total = companies.length;
  const done = companies.filter((c) => checks[c]).length;
  const missing = total - done;
  const computed = total > 0 ? Math.round((done / total) * 100) : 0;
  const percent =
    effPercent != null && !Number.isNaN(effPercent)
      ? Math.min(100, Math.max(0, Math.round(effPercent)))
      : computed;
  return {
    total,
    done,
    missing,
    percent,
    fullyComplete: total > 0 && missing === 0,
  };
}

export async function ensureDailyKpiForPillar(
  pillar: ItTaskPillarTitle,
  companies: readonly string[],
  timeZone: string,
): Promise<string> {
  const zone = normalizeTimeZone(timeZone);
  const existing = await prisma.kpiMaintenance.findMany({
    where: { isRecurring: true, frequency: "DAILY" },
    select: { id: true, title: true },
  });
  const matches = existing.filter((k) => pillarFromKpiTitle(k.title) === pillar);

  const templateChecks = Object.fromEntries(companies.map((c) => [c, false]));
  const subKpis = buildSubKpisFromChecks(companies, templateChecks);

  if (matches.length > 0) {
    const id = matches[0]!.id;
    await prisma.kpiMaintenance.update({
      where: { id },
      data: { title: pillar, subKpis },
    });
    return id;
  }

  const freq: KpiFrequency = "DAILY";
  const at = new Date();
  const periodKey = computePeriodKey(freq, null, null, at, zone);
  const periodCycleStartAt = getPeriodStartInclusive(freq, null, null, at, zone);

  const created = await prisma.kpiMaintenance.create({
    data: {
      title: pillar,
      isRecurring: true,
      frequency: freq,
      subKpis,
      periodKey,
      periodCycleStartAt,
      createdBy: "it-salf-daily-import",
      createdByRole: "SuperAdmin",
    },
    select: { id: true },
  });
  return created.id;
}

export type ApplyItSalfDailyResult = {
  pillar: ItTaskPillarTitle;
  kpiId: string;
  snapshots: number;
  days: number;
};

export async function applyItSalfDailyCsvToTaskBoard(args: {
  filePath: string;
  timeZone?: string;
  fromYmd?: string;
  toYmd?: string;
}): Promise<ApplyItSalfDailyResult> {
  const zone = normalizeTimeZone(args.timeZone ?? process.env.KPI_SNAPSHOT_TZ ?? "Asia/Manila");
  const fromYmd = args.fromYmd ?? "2026-03-01";
  const toYmd = args.toYmd ?? "2026-04-30";

  const parsed = parseItSalfDailyCsvFile(args.filePath, zone, fromYmd, toYmd);
  const companies =
    parsed.companies.length > 0 ? parsed.companies : [...IT_SALF_DAILY_COMPANY_COLUMNS];

  const kpiId = await ensureDailyKpiForPillar(parsed.pillar, companies, zone);

  let snapshots = 0;
  for (const row of parsed.rows) {
    const at = DateTime.fromISO(row.ymd, { zone }).toJSDate();
    const periodKey = getDailyPeriodKey(at, zone);
    const progress = checklistProgressFromChecks(companies, row.checks, row.effPercent);

    await prisma.kpiMaintenancePeriodSnapshot.upsert({
      where: {
        kpiMaintenanceId_periodKey: { kpiMaintenanceId: kpiId, periodKey },
      },
      create: {
        kpiMaintenanceId: kpiId,
        periodKey,
        frequency: "DAILY",
        timeZone: zone,
        total: progress.total,
        done: progress.done,
        missing: progress.missing,
        percent: progress.percent,
        fullyComplete: progress.fullyComplete,
      },
      update: {
        total: progress.total,
        done: progress.done,
        missing: progress.missing,
        percent: progress.percent,
        fullyComplete: progress.fullyComplete,
        capturedAt: new Date(),
      },
    });
    snapshots += 1;
  }

  const last = parsed.rows[parsed.rows.length - 1];
  if (last) {
    await prisma.kpiMaintenance.update({
      where: { id: kpiId },
      data: {
        subKpis: buildSubKpisFromChecks(companies, last.checks),
        periodKey: getDailyPeriodKey(DateTime.fromISO(last.ymd, { zone }).toJSDate(), zone),
        periodCycleStartAt: DateTime.fromISO(last.ymd, { zone }).startOf("day").toJSDate(),
      },
    });
  }

  return { pillar: parsed.pillar, kpiId, snapshots, days: parsed.rows.length };
}
