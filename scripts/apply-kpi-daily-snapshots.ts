/**
 * Import IT SALF daily pillar CSVs (one file per KPI area) into daily period snapshots.
 *
 * Usage:
 *   npx tsx scripts/apply-kpi-daily-snapshots.ts "path/to/IT SALF - SYSTEM AVAILABILITY.csv" ...
 *   npx tsx scripts/apply-kpi-daily-snapshots.ts --dir="C:\Users\...\Downloads"
 */
import { readFileSync } from "fs";
import { resolve } from "path";

import {
  applyDailyPillarPercentSnapshots,
  parseItSalfPillarCsv,
  pillarFromItSalfDailyFilename,
} from "../src/modules/tasks/kpi-sheet-import-snapshots";
import { normalizeTimeZone } from "../src/modules/tasks/kpi-recurrence";
import { prisma } from "../src/modules/platform/db/prisma";

const DEFAULT_FILES = [
  "IT SALF - SYSTEM AVAILABILITY.csv",
  "IT SALF - DATA BACKUP.csv",
  "IT SALF - CYBERSECURITY.csv",
  "IT SALF - NETWORK PERFORMANCE.csv",
  "IT SALF - SYSTEM MAINTENANCE.csv",
];

function parseArgs(argv: string[]) {
  const flags = new Map<string, string>();
  const files: string[] = [];
  for (const a of argv) {
    if (a.startsWith("--")) {
      const [k, v] = a.replace(/^--/, "").split("=", 2);
      flags.set(k, v ?? "1");
    } else {
      files.push(a);
    }
  }
  return { flags, files };
}

async function main() {
  const timeZone = normalizeTimeZone(process.env.KPI_SNAPSHOT_TZ ?? "Asia/Manila");
  const { flags, files: fileArgs } = parseArgs(process.argv.slice(2));

  let paths = fileArgs.map((p) => resolve(p));
  if (paths.length === 0 && flags.has("dir")) {
    const dir = resolve(flags.get("dir")!);
    paths = DEFAULT_FILES.map((name) => resolve(dir, name)).filter((p) => {
      try {
        readFileSync(p);
        return true;
      } catch {
        return false;
      }
    });
  }

  if (paths.length === 0) {
    console.error("Pass CSV file path(s) or --dir=folder containing the IT SALF pillar CSV exports.");
    process.exit(1);
  }

  let totalApplied = 0;
  for (const filePath of paths) {
    const pillar = pillarFromItSalfDailyFilename(filePath);
    if (!pillar) {
      console.warn(`Skip (unknown pillar): ${filePath}`);
      continue;
    }
    const content = readFileSync(filePath, "utf8");
    const days = parseItSalfPillarCsv(content, timeZone);
    const { applied, skipped } = await applyDailyPillarPercentSnapshots({
      pillar,
      timeZone,
      days,
    });
    totalApplied += applied;
    console.log(`${pillar}: ${applied} snapshot(s) from ${days.length} working day(s) in ${filePath}`);
    if (skipped.length) {
      for (const s of skipped) {
        console.log(`  skip: ${s.reason}${s.detail ? ` (${s.detail})` : ""}`);
      }
    }
  }

  console.log(`Done. ${totalApplied} daily snapshot row(s) written (tz=${timeZone}). Sundays excluded.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
