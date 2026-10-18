/**
 * Clean up future-dated SYSTEM PATCHES AND BUG FIXES period snapshots.
 *
 * Context: a stray CSV import wrote snapshots with periodKeys dated 2026-09 →
 * 2027-03 for the SYSTEM PATCHES AND BUG FIXES KPI. These phantom future bars
 * skew the ChartView date-range finder counts. This script deletes ONLY those
 * snapshots (scoped to the matching KPI title + periodKey month >= the cutoff),
 * leaving every other KPI untouched.
 *
 * Usage:
 *   npx tsx scripts/cleanup-future-system-patches-snapshots.ts          # dry-run
 *   npx tsx scripts/cleanup-future-system-patches-snapshots.ts --apply  # delete
 *
 * Safe: dry-run performs no writes. In --apply mode the rows are written to a
 * JSON backup file before deletion and removed inside a transaction.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { prismaPrimary } from "../src/modules/platform/db/prisma";

/** Cutoff: anything on or after this YYYY-MM is considered future-dated. */
const CUTOFF = "2026-09";
const KPI_MATCH = "SYSTEM PATCHES";
const APPLY = process.argv.includes("--apply");

/** Extract YYYY-MM from a periodKey (e.g. "DAILY:Asia/Taipei:2026-10-05" → "2026-10"). */
function monthOfPeriodKey(key: string): string | null {
  const m = key.match(/(\d{4})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}` : null;
}

async function main() {
  const kpis = await prismaPrimary.kpiMaintenance.findMany({
    select: { id: true, title: true, mainTask: true },
    where: {
      OR: [
        { title: { contains: KPI_MATCH } },
        { mainTask: { contains: KPI_MATCH } },
      ],
    },
  });
  console.log(`=== Matched KPIs (${kpis.length}) ===`);
  for (const k of kpis) {
    console.log(`  ${k.id} · "${(k.mainTask || k.title).trim()}"`);
  }
  if (kpis.length === 0) {
    console.log("No SYSTEM PATCHES KPIs found — nothing to do.");
    return;
  }

  const ids = kpis.map((k) => k.id);
  const candidates = await prismaPrimary.kpiMaintenancePeriodSnapshot.findMany({
    where: { kpiMaintenanceId: { in: ids } },
    orderBy: { periodKey: "asc" },
  });

  const future = candidates.filter((s) => {
    const m = monthOfPeriodKey(s.periodKey);
    return m !== null && m >= CUTOFF;
  });

  console.log(`\n=== Snapshots for matched KPIs: ${candidates.length} total ===`);
  console.log(`Future-dated (periodKey month >= ${CUTOFF}): ${future.length}`);

  const byMonth = new Map<string, number>();
  for (const s of future) {
    const m = monthOfPeriodKey(s.periodKey)!;
    byMonth.set(m, (byMonth.get(m) ?? 0) + 1);
  }
  console.log("By month:");
  for (const [m, n] of [...byMonth.entries()].sort()) console.log(`  ${m}: ${n}`);

  console.log("\n=== Rows to delete (id · periodKey · capturedAt · total/done/missing · percent) ===");
  for (const s of future) {
    console.log(
      `  ${s.id} · ${s.periodKey} · ${s.capturedAt.toISOString()} · ${s.total}/${s.done}/${s.missing} · ${s.percent}%`,
    );
  }

  if (!APPLY) {
    console.log("\nDRY-RUN — no changes made. Re-run with --apply to delete these rows.");
    return;
  }

  if (future.length === 0) {
    console.log("\nNothing to delete.");
    return;
  }

  const backupPath = path.join(
    __dirname,
    "backup-deleted-future-system-patches-snapshots.json",
  );
  writeFileSync(
    backupPath,
    JSON.stringify(
      future.map((s) => ({
        id: s.id,
        kpiMaintenanceId: s.kpiMaintenanceId,
        periodKey: s.periodKey,
        frequency: s.frequency,
        timeZone: s.timeZone,
        total: s.total,
        done: s.done,
        missing: s.missing,
        percent: s.percent,
        fullyComplete: s.fullyComplete,
        contributorProgress: s.contributorProgress,
        capturedAt: s.capturedAt.toISOString(),
      })),
      null,
      2,
    ),
  );
  console.log(`\nBackup written to ${backupPath}`);

  const deleted = await prismaPrimary.$transaction(
    future.map((s) =>
      prismaPrimary.kpiMaintenancePeriodSnapshot.delete({ where: { id: s.id } }),
    ),
  );
  console.log(`\nDeleted ${deleted.length} future-dated snapshot(s).`);

  const remaining = await prismaPrimary.kpiMaintenancePeriodSnapshot.count({
    where: { kpiMaintenanceId: { in: ids } },
  });
  console.log(`Remaining snapshots for matched KPIs: ${remaining}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prismaPrimary.$disconnect());
