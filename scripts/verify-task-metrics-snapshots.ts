/**
 * READ-ONLY verification of task-metrics snapshot data (primary PostgreSQL).
 *
 * Purpose: the ChartView date-range finder only filters the history that was
 * already loaded for the selected reporting period (e.g. the current month for
 * the Monthly cadence). This script shows how much recorded data actually
 * exists in the database, across which months, so we can confirm whether data
 * is missing from the picker or merely outside the loaded window.
 *
 * Safe: only SELECT / count / aggregate queries — no writes.
 */
import { prismaPrimary } from "../src/modules/platform/db/prisma";

/** Map a periodKey to its YYYY-MM bucket (e.g. "DAILY:Asia/Taipei:2026-07-15" → "2026-07"). */
function monthOfPeriodKey(key: string): string {
  const m = key.match(/(\d{4})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}`;
  return key;
}

async function main() {
  const total = await prismaPrimary.kpiMaintenancePeriodSnapshot.count();
  console.log("=== 1. Snapshot volume ===");
  console.log("total period snapshots:", total);

  const agg = await prismaPrimary.kpiMaintenancePeriodSnapshot.aggregate({
    _min: { capturedAt: true },
    _max: { capturedAt: true },
  });
  console.log(
    "capturedAt range:",
    agg._min.capturedAt?.toISOString(),
    "→",
    agg._max.capturedAt?.toISOString(),
  );

  const byFreq = await prismaPrimary.kpiMaintenancePeriodSnapshot.groupBy({
    by: ["frequency"],
    _count: { _all: true },
  });
  console.log("\n=== 2. Snapshots by frequency ===");
  for (const row of byFreq.sort((a, b) => b._count._all - a._count._all)) {
    console.log(`  ${row.frequency}: ${row._count._all}`);
  }

  const allKeys = await prismaPrimary.kpiMaintenancePeriodSnapshot.findMany({
    select: { periodKey: true },
  });
  const byMonth = new Map<string, number>();
  for (const { periodKey } of allKeys) {
    const m = monthOfPeriodKey(periodKey);
    byMonth.set(m, (byMonth.get(m) ?? 0) + 1);
  }
  console.log("\n=== 3. Snapshot months (bucket derived from periodKey) ===");
  for (const [m, n] of [...byMonth.entries()].sort()) {
    console.log(`  ${m}: ${n}`);
  }

  const now = new Date();
  const curYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const inCur = byMonth.get(curYm) ?? 0;
  console.log(
    `\n  → current reporting month ${curYm}: ${inCur} snapshots; other months: ${total - inCur}`,
  );

  console.log("\n=== 4. Per-KPI snapshot coverage ===");
  const kpis = await prismaPrimary.kpiMaintenance.findMany({
    select: {
      id: true,
      title: true,
      mainTask: true,
      frequency: true,
      isRecurring: true,
    },
    orderBy: { title: "asc" },
  });
  const snaps = await prismaPrimary.kpiMaintenancePeriodSnapshot.findMany({
    select: { kpiMaintenanceId: true, periodKey: true },
  });
  const byKpi = new Map<
    string,
    { count: number; min: string; max: string; months: Set<string> }
  >();
  for (const s of snaps) {
    const e = byKpi.get(s.kpiMaintenanceId) ?? {
      count: 0,
      min: s.periodKey,
      max: s.periodKey,
      months: new Set<string>(),
    };
    e.count += 1;
    if (s.periodKey < e.min) e.min = s.periodKey;
    if (s.periodKey > e.max) e.max = s.periodKey;
    e.months.add(monthOfPeriodKey(s.periodKey));
    byKpi.set(s.kpiMaintenanceId, e);
  }
  for (const k of kpis) {
    const e = byKpi.get(k.id);
    const label = (k.mainTask || k.title).trim();
    if (!e) {
      console.log(`  - [${k.frequency}${k.isRecurring ? " recurring" : " one-off"}] ${label}: NO snapshots`);
      continue;
    }
    const months = [...e.months].sort().join(", ");
    console.log(
      `  - [${k.frequency}${k.isRecurring ? " recurring" : " one-off"}] ${label}: ${e.count} snapshots · ${e.min} → ${e.max} · months: ${months}`,
    );
  }

  await prismaPrimary.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
