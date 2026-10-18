/**
 * Import MONITORING rows from an IT DAILY ACTIVITY CSV into Task metrics snapshots.
 *
 * Usage:
 *   npx tsx scripts/apply-daily-activity-monitoring-csv.ts "C:\Users\tk\Downloads\IT DAILY ACTIVITY - DAILY ACTIVITY ROBINA.csv" --from=2026-04-21 --to=2026-05-21
 */
import { readFileSync } from "fs";
import { resolve } from "path";

import { DateTime } from "luxon";

import { parseCsvLine } from "../src/lib/csv-parse";
import { applyDailyPillarPercentSnapshots } from "../src/modules/tasks/kpi-sheet-import-snapshots";
import { normalizeTimeZone } from "../src/modules/tasks/kpi-recurrence";
import { prisma } from "../src/modules/platform/db/prisma";

type DailyActivityMonitoringRow = {
  ymd: string;
  percent: number;
};

function parseArgs(argv: string[]) {
  const flags = new Map<string, string>();
  const files: string[] = [];
  for (const arg of argv) {
    if (arg.startsWith("--")) {
      const [key, value] = arg.replace(/^--/, "").split("=", 2);
      flags.set(key, value ?? "1");
    } else {
      files.push(arg);
    }
  }
  return { flags, files };
}

function parseActivityDate(raw: string, zone: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const formats = ["M/d/yyyy", "M/d/yy", "yyyy-MM-dd"];
  for (const format of formats) {
    const dt = DateTime.fromFormat(trimmed, format, { zone });
    if (dt.isValid) return dt.toISODate();
  }

  const iso = DateTime.fromISO(trimmed, { zone });
  return iso.isValid ? iso.toISODate() : null;
}

function parsePercent(raw: string, status: string): number | null {
  const trimmed = raw.trim().replace(/%/g, "");
  if (trimmed) {
    const n = Number(trimmed);
    if (!Number.isNaN(n)) return Math.min(100, Math.max(0, Math.round(n)));
  }

  return /^done$/i.test(status.trim()) ? 100 : null;
}

function parseDailyActivityMonitoringCsv(
  content: string,
  zone: string,
  fromYmd: string,
  toYmd: string,
): DailyActivityMonitoringRow[] {
  const lines = content.split(/\r?\n/).filter((line) => line.trim());
  const header = parseCsvLine(lines[0] ?? "");
  const normalizedHeader = header.map((h) => h.trim().toUpperCase());

  const dateIdx = normalizedHeader.indexOf("R");
  const issueIdx = normalizedHeader.indexOf("ISSUE / CONCERN / ACTIVY");
  const percentIdx = normalizedHeader.indexOf("%");
  const statusIdx = normalizedHeader.indexOf("STATUS");
  if (dateIdx < 0 || issueIdx < 0 || percentIdx < 0 || statusIdx < 0) {
    throw new Error("CSV is missing one of the required columns: R, ISSUE / CONCERN / ACTIVY, %, STATUS");
  }

  const rowsByDate = new Map<string, DailyActivityMonitoringRow>();
  for (const line of lines.slice(1)) {
    const cols = parseCsvLine(line);
    const issue = cols[issueIdx] ?? "";
    if (!/\bmonitoring\b/i.test(issue)) continue;

    const ymd = parseActivityDate(cols[dateIdx] ?? "", zone);
    if (!ymd || ymd < fromYmd || ymd > toYmd) continue;

    const percent = parsePercent(cols[percentIdx] ?? "", cols[statusIdx] ?? "");
    if (percent == null) continue;

    rowsByDate.set(ymd, { ymd, percent });
  }

  return [...rowsByDate.values()].sort((a, b) => a.ymd.localeCompare(b.ymd));
}

async function main() {
  const { flags, files } = parseArgs(process.argv.slice(2));
  if (files.length === 0) {
    console.error("Pass the IT DAILY ACTIVITY CSV path.");
    process.exit(1);
  }

  const timeZone = normalizeTimeZone(flags.get("tz") ?? process.env.KPI_SNAPSHOT_TZ ?? "Asia/Manila");
  const fromYmd = flags.get("from") ?? "2026-04-21";
  const toYmd = flags.get("to") ?? "2026-05-21";
  const filePath = resolve(files[0]!);

  const rows = parseDailyActivityMonitoringCsv(readFileSync(filePath, "utf8"), timeZone, fromYmd, toYmd);
  const { applied, skipped } = await applyDailyPillarPercentSnapshots({
    pillar: "MONITORING",
    timeZone,
    days: rows,
  });

  console.log(`MONITORING: ${applied} snapshot(s) from ${rows.length} activity row(s) (${fromYmd} -> ${toYmd})`);
  if (skipped.length) {
    for (const s of skipped) {
      console.warn(`  skip: ${s.reason}${s.detail ? ` (${s.detail})` : ""}`);
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
