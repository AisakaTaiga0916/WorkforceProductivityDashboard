/**
 * Backfill KPI period snapshots for each calendar day in a range (inclusive).
 * Default: fill missing days from 2026-05-15 through today, then refresh today.
 *
 * Usage:
 *   npx tsx scripts/backfill-kpi-period-snapshots-range.ts
 *   npx tsx scripts/backfill-kpi-period-snapshots-range.ts --from=2026-05-15 --to=2026-05-16
 *   npx tsx scripts/backfill-kpi-period-snapshots-range.ts --force
 */
import { DateTime } from "luxon";
import { backfillKpiPeriodSnapshotsForRange } from "../src/modules/tasks/kpi-period-snapshots";
import { normalizeTimeZone } from "../src/modules/tasks/kpi-recurrence";
import { prisma } from "../src/modules/platform/db/prisma";

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

async function main() {
  const timeZone = normalizeTimeZone(process.env.KPI_SNAPSHOT_TZ ?? "Asia/Manila");
  const todayYmd = DateTime.now().setZone(timeZone).toISODate()!;
  const fromYmd = parseArg("from") ?? "2026-05-15";
  const toYmd = parseArg("to") ?? todayYmd;
  const force = process.argv.includes("--force");

  const { applied, skipped } = await backfillKpiPeriodSnapshotsForRange({
    fromYmd,
    toYmd,
    timeZone,
    fillMissingOnly: !force,
  });

  let todayApplied = 0;
  if (!force && toYmd >= todayYmd && fromYmd <= todayYmd) {
    const todayRun = await backfillKpiPeriodSnapshotsForRange({
      fromYmd: todayYmd,
      toYmd: todayYmd,
      timeZone,
      fillMissingOnly: false,
    });
    todayApplied = todayRun.applied;
  }

  console.log(
    `Backfilled ${applied} snapshot(s), skipped ${skipped} existing (tz=${timeZone}, ${fromYmd}→${toYmd})` +
      (todayApplied > 0 ? `; refreshed ${todayApplied} for today.` : "."),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
