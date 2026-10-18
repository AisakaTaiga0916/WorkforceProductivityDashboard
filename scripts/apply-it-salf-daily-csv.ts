/**
 * Import IT SALF pillar CSVs (daily date rows or monthly summary rows) into Task Board snapshots.
 *
 * Usage:
 *   npm run db:apply-it-salf-daily -- "C:\Users\tk\Downloads\IT SALF - DATA BACKUP.csv" ...
 *   npm run db:apply-it-salf-daily -- --from=2026-03-01 --to=2026-04-30
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

const DEFAULT_DOWNLOADS = [
  "IT SALF - SYSTEM AVAILABILITY.csv",
  "IT SALF - DATA BACKUP.csv",
  "IT SALF - CYBERSECURITY.csv",
  "IT SALF - NETWORK PERFORMANCE.csv",
  "IT SALF - SYSTEM MAINTENANCE.csv",
];

function parseArgs(argv: string[]) {
  const flags = new Map<string, string>();
  const paths: string[] = [];
  for (const a of argv) {
    if (a.startsWith("--")) {
      const [k, v] = a.replace(/^--/, "").split("=", 2);
      flags.set(k, v ?? "1");
    } else {
      paths.push(a);
    }
  }
  return { paths, flags };
}

async function main() {
  const { paths: argPaths, flags } = parseArgs(process.argv.slice(2));
  const fromYmd = flags.get("from") ?? "2026-03-01";
  const toYmd = flags.get("to") ?? "2026-04-30";
  const timeZone = normalizeTimeZone(flags.get("tz") ?? process.env.KPI_SNAPSHOT_TZ ?? "Asia/Manila");

  const paths =
    argPaths.length > 0
      ? argPaths.map((p) => resolve(p))
      : DEFAULT_DOWNLOADS.map((f) => resolve(process.env.USERPROFILE ?? "", "Downloads", f));

  console.log(`Importing IT SALF pillar CSVs (${fromYmd} → ${toYmd}, tz=${timeZone})`);

  let totalApplied = 0;
  for (const filePath of paths) {
    const pillar = pillarFromItSalfDailyFilename(filePath);
    if (!pillar) {
      console.warn(`Skip (unknown pillar): ${filePath}`);
      continue;
    }
    let content: string;
    try {
      content = readFileSync(filePath, "utf8");
    } catch {
      console.warn(`Skip (file not found): ${filePath}`);
      continue;
    }

    const days = parseItSalfPillarCsv(content, timeZone).filter(
      (d) => d.ymd >= fromYmd && d.ymd <= toYmd,
    );
    if (days.length === 0) {
      console.warn(`  ${pillar}: no rows in range from ${filePath}`);
      continue;
    }

    const { applied, skipped } = await applyDailyPillarPercentSnapshots({
      pillar,
      timeZone,
      days,
    });
    totalApplied += applied;
    console.log(`  ${pillar}: ${applied} snapshot(s) from ${days.length} working day(s)`);
    if (skipped.length) {
      for (const s of skipped) {
        console.warn(`    skip: ${s.reason}${s.detail ? ` (${s.detail})` : ""}`);
      }
    }
  }

  console.log(`Done. ${totalApplied} snapshot row(s) written.`);
  console.log("Tip: also run npm run db:apply-kpi-sheet for KPI tab headline months.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
