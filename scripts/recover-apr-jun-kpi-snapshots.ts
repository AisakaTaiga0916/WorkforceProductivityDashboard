/**
 * Recover Apr–Jun 2026 KPI period snapshots into the current (tz-prefixed) format.
 *
 * 1) Keep SYSTEM MAINTENANCE as MONTHLY (monthly snapshot history).
 * 2) Re-apply scripts/data/kpi-sheet-march-april.json (April headlines for allowlisted pillars).
 * 3) Expand any stored MONTHLY snapshots in Apr–Jun onto missing DAILY working days
 *    for DAILY KPIs only (fill-only — never overwrite an existing daily row).
 *
 * Usage:
 *   npx tsx scripts/recover-apr-jun-kpi-snapshots.ts
 *   npx tsx scripts/recover-apr-jun-kpi-snapshots.ts --from=2026-04-01 --to=2026-06-30
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import { DateTime } from "luxon";
import type { KpiFrequency } from "@prisma/client/primary";

import {
  applyPillarPercentSnapshots,
  ensureDailyKpiForPillar,
  KPI_SHEET_IMPORT_PILLARS,
} from "../src/modules/tasks/kpi-sheet-import-snapshots";
import {
  getDailyPeriodKey,
  isKpiMetricsWorkingDay,
  normalizeTimeZone,
} from "../src/modules/tasks/kpi-recurrence";
import { prisma } from "../src/modules/platform/db/prisma";

function parseArgs(argv: string[]) {
  const flags = new Map<string, string>();
  for (const a of argv) {
    if (!a.startsWith("--")) continue;
    const [k, v] = a.replace(/^--/, "").split("=", 2);
    flags.set(k, v ?? "1");
  }
  return flags;
}

async function expandMonthlyIntoMissingDaily(args: {
  fromYmd: string;
  toYmd: string;
  timeZone: string;
}): Promise<{ filled: number; skippedExisting: number }> {
  const zone = normalizeTimeZone(args.timeZone);
  const months = ["2026-04", "2026-05", "2026-06"].filter((ym) => {
    const monthStart = `${ym}-01`;
    const monthEnd = DateTime.fromISO(monthStart, { zone }).endOf("month").toISODate()!;
    return monthEnd >= args.fromYmd && monthStart <= args.toYmd;
  });

  let filled = 0;
  let skippedExisting = 0;

  const dailyKpis = await prisma.kpiMaintenance.findMany({
    where: { isRecurring: true, frequency: "DAILY" },
    select: { id: true, title: true, frequency: true },
  });

  for (const kpi of dailyKpis) {
    for (const ym of months) {
      const monthSnaps = await prisma.kpiMaintenancePeriodSnapshot.findMany({
        where: {
          kpiMaintenanceId: kpi.id,
          frequency: "MONTHLY",
          periodKey: { contains: ym },
        },
        select: { percent: true, periodKey: true },
        orderBy: { capturedAt: "desc" },
      });
      if (monthSnaps.length === 0) continue;
      const percent = Math.max(0, Math.min(100, Math.round(monthSnaps[0]!.percent)));
      if (percent <= 0) continue;

      const start = DateTime.fromISO(`${ym}-01`, { zone }).startOf("month");
      const end = start.endOf("month");
      for (let d = start; d <= end; d = d.plus({ days: 1 })) {
        if (!isKpiMetricsWorkingDay(d)) continue;
        const ymd = d.toISODate();
        if (!ymd || ymd < args.fromYmd || ymd > args.toYmd) continue;
        const periodKey = getDailyPeriodKey(d.toJSDate(), zone);
        const existing = await prisma.kpiMaintenancePeriodSnapshot.findUnique({
          where: {
            kpiMaintenanceId_periodKey: {
              kpiMaintenanceId: kpi.id,
              periodKey,
            },
          },
          select: { id: true },
        });
        if (existing) {
          skippedExisting += 1;
          continue;
        }
        const total = 100;
        const done = percent;
        const missing = total - done;
        await prisma.kpiMaintenancePeriodSnapshot.create({
          data: {
            kpiMaintenanceId: kpi.id,
            periodKey,
            frequency: "DAILY" as KpiFrequency,
            timeZone: zone,
            total,
            done,
            missing,
            percent,
            fullyComplete: missing === 0,
            capturedAt: d.endOf("day").toJSDate(),
          },
        });
        filled += 1;
      }
      console.log(
        `  ${kpi.title} ${ym}: filled missing daily from monthly ${percent}% (${monthSnaps[0]!.periodKey})`,
      );
    }
  }

  return { filled, skippedExisting };
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const fromYmd = flags.get("from") ?? "2026-04-01";
  const toYmd = flags.get("to") ?? "2026-06-30";
  const timeZone = normalizeTimeZone(
    flags.get("tz") ?? process.env.KPI_SNAPSHOT_TZ ?? process.env.REPORT_TZ ?? "Asia/Manila",
  );

  console.log(`Recovering KPI snapshots ${fromYmd} → ${toYmd} (tz=${timeZone})`);

  // 1) Prefer monthly sheet history for SYSTEM MAINTENANCE (keep frequency MONTHLY).
  //    Skip the daily CSV expand path so ensureDailyKpiForPillar does not flip it to DAILY.
  console.log("SYSTEM MAINTENANCE stays MONTHLY — using stored monthly snapshots / sheet cells.");

  // 2) March–April sheet JSON (April cells for allowlisted pillars)
  const sheetPath = resolve(process.cwd(), "scripts/data/kpi-sheet-march-april.json");
  try {
    const raw = JSON.parse(readFileSync(sheetPath, "utf8")) as {
      timeZone?: string;
      pillars?: Record<string, Record<string, number>>;
    };
    const pillarMonths: Record<string, Record<string, number>> = {};
    for (const [label, months] of Object.entries(raw.pillars ?? {})) {
      const filtered: Record<string, number> = {};
      for (const [ym, pct] of Object.entries(months ?? {})) {
        if (ym >= "2026-04" && ym <= "2026-06") filtered[ym] = pct;
      }
      if (Object.keys(filtered).length > 0) pillarMonths[label] = filtered;
    }
    const { applied, skipped } = await applyPillarPercentSnapshots({
      timeZone: raw.timeZone ?? timeZone,
      pillarMonths,
      ensureKpiRows: true,
    });
    console.log(`KPI sheet JSON (Apr–Jun cells): applied=${applied}, skipped=${skipped.length}`);
    for (const s of skipped.slice(0, 12)) console.warn(`  skip: ${s.reason} ${s.detail ?? ""}`);
    // Keep SYSTEM MAINTENANCE as MONTHLY so sheet/monthly history stays on the MONTHLY donut.
    for (const pillar of KPI_SHEET_IMPORT_PILLARS) {
      if (pillar === "SYSTEM MAINTENANCE") continue;
      await ensureDailyKpiForPillar(pillar);
    }
  } catch (e) {
    console.warn(`KPI sheet JSON unavailable: ${String(e)}`);
  }

  // 3) Expand stored monthly → missing daily for the new patch format
  console.log("Expanding stored monthly snapshots into missing daily rows…");
  const { filled, skippedExisting } = await expandMonthlyIntoMissingDaily({
    fromYmd,
    toYmd,
    timeZone,
  });
  console.log(`Monthly→daily fill: created=${filled}, already-present=${skippedExisting}`);
  console.log("Done.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
