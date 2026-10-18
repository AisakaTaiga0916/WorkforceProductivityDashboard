/**
 * Apply headline KPI % from a JSON or CSV file into `KpiMaintenancePeriodSnapshot`.
 *
 * The Google Sheet must be downloaded or exported as CSV, or copy values into the JSON template.
 *
 * JSON shape (see scripts/data/kpi-sheet-march-april.example.json):
 *   { "timeZone": "Asia/Manila", "pillars": { "System Availability": { "2026-03": 95, "2026-04": 97 } } }
 *
 * CSV: first column "KPI Area" (or similar), then one column per month with header `2026-03` or `March` (year from --year).
 *
 * Task metrics: use a reporting range that includes Mar–Apr. DAILY cadence uses daily
 * snapshots; MONTHLY cadence aggregates monthly KPI period keys (and still includes
 * DAILY/WEEKLY rows when their cadence matches the UI filter).
 *
 * Usage:
 *   npx tsx scripts/apply-kpi-sheet-snapshots.ts
 *   npx tsx scripts/apply-kpi-sheet-snapshots.ts path/to/data.csv --year=2026
 */
import { readFileSync } from "fs";
import { resolve } from "path";

import {
  applyPillarPercentSnapshots,
  matchPillarFromSheetLabel,
} from "../src/modules/tasks/kpi-sheet-import-snapshots";
import { prisma } from "../src/modules/platform/db/prisma";

const MONTH_ALIASES: Record<string, string> = {
  january: "01",
  jan: "01",
  february: "02",
  feb: "02",
  march: "03",
  mar: "03",
  april: "04",
  apr: "04",
  may: "05",
  june: "06",
  jun: "06",
  july: "07",
  jul: "07",
  august: "08",
  aug: "08",
  september: "09",
  sep: "09",
  sept: "09",
  october: "10",
  oct: "10",
  november: "11",
  nov: "11",
  december: "12",
  dec: "12",
};

function parseArgs(argv: string[]) {
  const flags = new Map<string, string>();
  const pos: string[] = [];
  for (const a of argv) {
    if (a.startsWith("--")) {
      const [k, v] = a.replace(/^--/, "").split("=", 2);
      flags.set(k, v ?? "1");
    } else {
      pos.push(a);
    }
  }
  return { pos, flags };
}

function splitCsvLine(line: string): string[] {
  return line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
}

function headerToYm(header: string, defaultYear: number): string | null {
  const t = header.trim();
  if (/^\d{4}-\d{2}$/.test(t)) return t;
  const lower = t.toLowerCase();
  if (MONTH_ALIASES[lower]) {
    return `${defaultYear}-${MONTH_ALIASES[lower]}`;
  }
  return null;
}

function loadJsonPillars(
  filePath: string,
): { timeZone: string; pillars: Record<string, Record<string, number>> } {
  const raw = readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw) as {
    timeZone?: string;
    pillars?: Record<string, Record<string, number | null>>;
  };
  const timeZone = parsed.timeZone ?? process.env.KPI_SNAPSHOT_TZ ?? "Asia/Manila";
  const pillars: Record<string, Record<string, number>> = {};
  for (const [label, months] of Object.entries(parsed.pillars ?? {})) {
    if (!months) continue;
    const out: Record<string, number> = {};
    for (const [ym, v] of Object.entries(months)) {
      if (v == null || Number.isNaN(Number(v))) continue;
      out[ym] = Number(v);
    }
    if (Object.keys(out).length > 0) pillars[label] = out;
  }
  return { timeZone, pillars };
}

function parsePercentCell(s: string): number | null {
  const t = s.trim().replace(/%/g, "");
  if (!t || t === "-") return null;
  const n = Number(t);
  return Number.isNaN(n) ? null : n;
}

/** First non-empty parseable % in cols starting at `from` (handles Excel CSV offset quirks). */
function percentNearColumn(cols: string[], from: number): number | null {
  for (let i = from; i < cols.length && i <= from + 2; i++) {
    const v = cols[i];
    if (v == null) continue;
    const n = parsePercentCell(v);
    if (n != null) return n;
  }
  return null;
}

/**
 * IT SALF–style export: row 1 `KPI AREA,...`, row 2 `,,MARCH,,APRIL,,...`, then blocks of data rows.
 * Month columns may be one index right of the MARCH/APRIL header cells.
 */
function loadItSalfKpiCsv(filePath: string, defaultYear: number): Record<string, Record<string, number>> {
  const raw = readFileSync(filePath, "utf8");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  let marchCol = -1;
  let aprilCol = -1;
  for (const line of lines.slice(0, 5)) {
    const cols = splitCsvLine(line);
    for (let i = 0; i < cols.length; i++) {
      const u = cols[i]?.trim().toUpperCase() ?? "";
      if (u === "MARCH") marchCol = i;
      if (u === "APRIL") aprilCol = i;
    }
  }
  if (marchCol < 0 || aprilCol < 0) {
    throw new Error("IT SALF CSV: could not find MARCH and APRIL columns in the first rows.");
  }
  const ymMarch = headerToYm("march", defaultYear)!;
  const ymApril = headerToYm("april", defaultYear)!;

  const pillars: Record<string, Record<string, number>> = {};
  for (const line of lines) {
    const cols = splitCsvLine(line);
    const area = cols[0]?.trim() ?? "";
    if (!area) continue;
    if (!matchPillarFromSheetLabel(area)) continue;

    const mPct = percentNearColumn(cols, marchCol);
    const aPct = percentNearColumn(cols, aprilCol);
    const months: Record<string, number> = {};
    if (mPct != null) months[ymMarch] = mPct;
    if (aPct != null) months[ymApril] = aPct;
    if (Object.keys(months).length > 0) {
      pillars[area] = { ...pillars[area], ...months };
    }
  }
  return pillars;
}

function isItSalfExport(lines: string[]): boolean {
  const l0 = (lines[0] ?? "").toUpperCase();
  const blob = lines.slice(0, 4).join("\n").toUpperCase();
  return l0.includes("KPI AREA") && blob.includes("MARCH") && blob.includes("APRIL");
}

function loadCsvPillars(filePath: string, defaultYear: number): Record<string, Record<string, number>> {
  const raw = readFileSync(filePath, "utf8");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) throw new Error("CSV must include a header row and one data row");

  if (isItSalfExport(raw.split(/\r?\n/))) {
    return loadItSalfKpiCsv(filePath, defaultYear);
  }

  const headers = splitCsvLine(lines[0]!);
  const monthKeys = headers
    .slice(1)
    .map((h) => headerToYm(h, defaultYear))
    .map((ym, i) => ({ ym, header: headers[i + 1] }));

  if (monthKeys.every((m) => m.ym == null)) {
    throw new Error(
      `Could not parse month columns from CSV headers: ${headers.slice(1).join(", ")}. Use YYYY-MM or month names with --year.`,
    );
  }

  const pillars: Record<string, Record<string, number>> = {};

  for (let r = 1; r < lines.length; r++) {
    const cols = splitCsvLine(lines[r]!);
    const area = cols[0]?.trim();
    if (!area) continue;
    if (!matchPillarFromSheetLabel(area)) continue;

    const months: Record<string, number> = {};
    for (let c = 1; c < cols.length && c - 1 < monthKeys.length; c++) {
      const { ym } = monthKeys[c - 1]!;
      if (!ym) continue;
      const cell = cols[c]?.trim() ?? "";
      if (!cell) continue;
      const n = Number(cell.replace(/%/g, ""));
      if (Number.isNaN(n)) continue;
      months[ym] = n;
    }
    if (Object.keys(months).length > 0) {
      pillars[area] = { ...pillars[area], ...months };
    }
  }

  return pillars;
}

async function main() {
  const argv = process.argv.slice(2);
  const { pos, flags } = parseArgs(argv);
  const defaultYear = Number(flags.get("year") ?? process.env.KPI_SHEET_YEAR ?? "2026");
  const agentFilter = flags.get("assignedAgentId") ?? process.env.KPI_IMPORT_ASSIGNED_AGENT_ID;

  const explicitPath = pos[0];
  const jsonPath = resolve(process.cwd(), explicitPath ?? "scripts/data/kpi-sheet-march-april.json");

  let timeZone = process.env.KPI_SNAPSHOT_TZ ?? "Asia/Manila";
  let pillars: Record<string, Record<string, number>>;

  if (explicitPath?.toLowerCase().endsWith(".csv")) {
    pillars = loadCsvPillars(jsonPath, defaultYear);
  } else {
    try {
      const j = loadJsonPillars(jsonPath);
      timeZone = j.timeZone;
      pillars = j.pillars;
    } catch (e) {
      if (!explicitPath) {
        console.error(
          `Missing or invalid ${jsonPath}. Copy scripts/data/kpi-sheet-march-april.example.json to scripts/data/kpi-sheet-march-april.json, replace figures with your Google Sheet, or pass a downloaded .csv as the first argument.`,
        );
      }
      throw e;
    }
  }

  if (Object.keys(pillars).length === 0) {
    console.error("No pillar/month values to apply. Check your file content.");
    process.exit(1);
  }

  const result = await applyPillarPercentSnapshots({
    timeZone,
    pillarMonths: pillars,
    assignedAgentId: agentFilter,
  });

  console.log(`Applied ${result.applied} snapshot row(s) (tz=${timeZone}).`);
  if (result.skipped.length) {
    console.log("Skipped:");
    for (const s of result.skipped) {
      console.log(`  - ${s.reason}${s.detail ? `: ${s.detail}` : ""}`);
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
