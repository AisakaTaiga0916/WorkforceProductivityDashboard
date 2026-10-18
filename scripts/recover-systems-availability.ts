/**
 * Recover SYSTEMS / SYSTEM AVAILABILITY period snapshots from the IT SALF KPI sheet
 * (March & April 2026 headline % in scripts/data/kpi-sheet-march-april.json).
 *
 * Expands each monthly % onto working-day daily snapshots for the Task Board row.
 *
 * Usage:
 *   npx tsx scripts/recover-systems-availability.ts
 *   npx tsx scripts/recover-systems-availability.ts --from=2026-03-01 --to=2026-04-30 --tz=Asia/Manila
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import { DateTime } from "luxon";

import {
  applyDailyPercentSnapshotsByTitle,
  enumerateYmdDaysInMonth,
  type DailyPillarPercentRow,
} from "../src/modules/tasks/kpi-sheet-import-snapshots";
import { getMonthlyPeriodKey, normalizeTimeZone } from "../src/modules/tasks/kpi-recurrence";
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

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const fromYmd = flags.get("from") ?? "2026-03-01";
  const toYmd = flags.get("to") ?? "2026-04-30";
  const timeZone = normalizeTimeZone(
    flags.get("tz") ?? process.env.KPI_SNAPSHOT_TZ ?? process.env.REPORT_TZ ?? "Asia/Manila",
  );

  const sheetPath = resolve(process.cwd(), "scripts/data/kpi-sheet-march-april.json");
  const raw = JSON.parse(readFileSync(sheetPath, "utf8")) as {
    timeZone?: string;
    pillars?: Record<string, Record<string, number>>;
  };
  const zone = normalizeTimeZone(raw.timeZone ?? timeZone);

  const monthPercents =
    raw.pillars?.["SYSTEM AVAILABILITY"] ??
    raw.pillars?.["SYSTEMS AVAILABILITY"] ??
    raw.pillars?.["System Availability"] ??
    null;
  if (!monthPercents) {
    throw new Error(`No SYSTEM AVAILABILITY months in ${sheetPath}`);
  }

  const kpi = await prisma.kpiMaintenance.findFirst({
    where: {
      isRecurring: true,
      OR: [
        { title: { equals: "SYSTEMS AVAILABILITY", mode: "insensitive" } },
        { title: { equals: "SYSTEM AVAILABILITY", mode: "insensitive" } },
      ],
    },
    select: {
      id: true,
      title: true,
      frequency: true,
      recurrenceMonthDay: true,
    },
  });
  if (!kpi) {
    throw new Error("No SYSTEMS AVAILABILITY / SYSTEM AVAILABILITY KPI row on the Task Board.");
  }

  // Keep daily cadence so recovered days land in the DAILY Task Type donut.
  if (kpi.frequency !== "DAILY") {
    await prisma.kpiMaintenance.update({
      where: { id: kpi.id },
      data: { frequency: "DAILY", recurrenceWeekday: null, recurrenceMonthDay: null },
    });
    console.log(`Updated ${kpi.title} frequency → DAILY`);
  }

  const days: DailyPillarPercentRow[] = [];
  for (const [ym, pct] of Object.entries(monthPercents)) {
    if (pct == null || Number.isNaN(Number(pct))) continue;
    const percent = Math.round(Math.min(100, Math.max(0, Number(pct))));
    for (const ymd of enumerateYmdDaysInMonth(ym, zone)) {
      if (ymd < fromYmd || ymd > toYmd) continue;
      days.push({ ymd, percent });
    }

    // Also store the monthly headline key for cadence/history.
    const parts = ym.split("-");
    const year = Number(parts[0]);
    const month = Number(parts[1]);
    const mid = DateTime.fromObject({ year, month, day: 15 }, { zone }).toJSDate();
    const monthKey = getMonthlyPeriodKey(mid, 1, zone);
    const total = 100;
    const done = percent;
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
        total,
        done,
        missing: total - done,
        percent,
        fullyComplete: percent >= 100,
        capturedAt: DateTime.fromObject({ year, month, day: 1 }, { zone }).endOf("month").toJSDate(),
      },
      update: {
        total,
        done,
        missing: total - done,
        percent,
        fullyComplete: percent >= 100,
        frequency: "MONTHLY",
        timeZone: zone,
        capturedAt: new Date(),
      },
    });
    console.log(`Monthly ${ym}: ${percent}% → ${monthKey}`);
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
        dailyApplied: applied,
        skipped,
        dayCount: days.length,
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
