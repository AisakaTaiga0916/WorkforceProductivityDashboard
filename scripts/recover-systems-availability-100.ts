/**
 * Fill SYSTEMS AVAILABILITY daily + monthly snapshots at 100% for a date range.
 *
 * Usage:
 *   npx tsx scripts/recover-systems-availability-100.ts --from=2026-06-01 --to=2026-07-31 --tz=Asia/Manila
 */
import { DateTime } from "luxon";

import {
  applyDailyPercentSnapshotsByTitle,
  enumerateYmdDaysInMonth,
  type DailyPillarPercentRow,
} from "../src/modules/tasks/kpi-sheet-import-snapshots";
import {
  getMonthlyPeriodKey,
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

function monthsInRange(fromYmd: string, toYmd: string, zone: string): string[] {
  const out: string[] = [];
  let cursor = DateTime.fromISO(fromYmd, { zone }).startOf("month");
  const end = DateTime.fromISO(toYmd, { zone }).startOf("month");
  while (cursor <= end) {
    out.push(cursor.toFormat("yyyy-MM"));
    cursor = cursor.plus({ months: 1 });
  }
  return out;
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const fromYmd = flags.get("from") ?? "2026-06-01";
  const toYmd = flags.get("to") ?? "2026-07-31";
  const percent = Math.round(Math.min(100, Math.max(0, Number(flags.get("percent") ?? "100"))));
  const zone = normalizeTimeZone(
    flags.get("tz") ?? process.env.KPI_SNAPSHOT_TZ ?? process.env.REPORT_TZ ?? "Asia/Manila",
  );

  const kpi = await prisma.kpiMaintenance.findFirst({
    where: {
      isRecurring: true,
      OR: [
        { title: { equals: "SYSTEMS AVAILABILITY", mode: "insensitive" } },
        { title: { equals: "SYSTEM AVAILABILITY", mode: "insensitive" } },
      ],
    },
    select: { id: true, title: true, frequency: true },
  });
  if (!kpi) throw new Error("SYSTEMS AVAILABILITY KPI not found");

  if (kpi.frequency !== "DAILY") {
    await prisma.kpiMaintenance.update({
      where: { id: kpi.id },
      data: { frequency: "DAILY", recurrenceWeekday: null, recurrenceMonthDay: null },
    });
    console.log(`Updated ${kpi.title} → DAILY`);
  }

  const days: DailyPillarPercentRow[] = [];
  let cursor = DateTime.fromISO(fromYmd, { zone }).startOf("day");
  const end = DateTime.fromISO(toYmd, { zone }).startOf("day");
  while (cursor <= end) {
    if (isKpiMetricsWorkingDay(cursor)) {
      const ymd = cursor.toISODate();
      if (ymd) days.push({ ymd, percent });
    }
    cursor = cursor.plus({ days: 1 });
  }

  for (const ym of monthsInRange(fromYmd, toYmd, zone)) {
    const parts = ym.split("-");
    const year = Number(parts[0]);
    const month = Number(parts[1]);
    const mid = DateTime.fromObject({ year, month, day: 15 }, { zone }).toJSDate();
    const monthKey = getMonthlyPeriodKey(mid, 1, zone);
    await prisma.kpiMaintenancePeriodSnapshot.upsert({
      where: {
        kpiMaintenanceId_periodKey: {
          kpiMaintenanceId: kpi.id,
          periodKey: monthKey,
        },
      },
      create: {
        kpiMaintenanceId: kpi.id,
        periodKey: monthKey,
        frequency: "MONTHLY",
        timeZone: zone,
        total: 100,
        done: percent,
        missing: 100 - percent,
        percent,
        fullyComplete: percent >= 100,
        capturedAt: DateTime.fromObject({ year, month, day: 1 }, { zone }).endOf("month").toJSDate(),
      },
      update: {
        total: 100,
        done: percent,
        missing: 100 - percent,
        percent,
        fullyComplete: percent >= 100,
        frequency: "MONTHLY",
        timeZone: zone,
        capturedAt: new Date(),
      },
    });
    console.log(`Monthly ${ym}: ${percent}% → ${monthKey}`);
    // Ensure every working day in the month that falls in range is covered
    for (const ymd of enumerateYmdDaysInMonth(ym, zone)) {
      if (ymd < fromYmd || ymd > toYmd) continue;
      if (!days.some((d) => d.ymd === ymd)) days.push({ ymd, percent });
    }
  }

  const { applied, skipped } = await applyDailyPercentSnapshotsByTitle({
    title: kpi.title,
    titleAliases: ["SYSTEMS AVAILABILITY", "SYSTEM AVAILABILITY", "System Availability"],
    timeZone: zone,
    days,
  });

  console.log(
    JSON.stringify(
      {
        kpi: kpi.title,
        zone,
        range: `${fromYmd} → ${toYmd}`,
        percent,
        dailyApplied: applied,
        dayCount: days.length,
        skipped,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
