import { PrismaClient } from "@prisma/client/primary";
import { DateTime } from "luxon";
import {
  collectChecklistProgressItems,
  kpiChecklistProgress,
  progressWithInvertedRecording,
  taskUsesInvertedRecording,
} from "@/modules/tasks/kpi-subkpis";
import { kpiMainTaskLabel } from "@/modules/tasks/kpi-main-task";
import { totalRecordedDataPercent } from "@/modules/tasks/sub-kpi-completion-mode";
import {
  alternateGmt8PeriodKey,
  enumeratePeriodKeysForKpiInRange,
  indexSnapshotsByKpiPeriod,
  periodKeysWithGmt8Aliases,
  resolvePeriodKeyForKpi,
} from "@/modules/tasks/kpi-period-snapshots";

const prisma = new PrismaClient();

function snapshotToProgress(s: {
  total: number;
  done: number;
  missing: number;
  percent: number;
}) {
  return {
    total: s.total,
    done: s.done,
    missing: s.missing,
    percent: s.percent,
  };
}

function weighted(rows: { total: number; done: number }[]) {
  const withData = rows.filter((r) => r.total > 0);
  if (!withData.length) return null;
  const total = withData.reduce((sum, r) => sum + r.total, 0);
  const done = withData.reduce((sum, r) => sum + r.done, 0);
  return total > 0 ? Math.round((done / total) * 100) : null;
}

async function main() {
  for (const zone of ["Asia/Manila", "Asia/Taipei"] as const) {
  const now = DateTime.now().setZone(zone);
  const fromYmd = now.startOf("month").toISODate()!;
  const toYmd = now.toISODate()!;
  console.log(`\n======== ZONE ${zone} ========`);

  const rows = await prisma.kpiMaintenance.findMany({
    where: {
      OR: [
        { title: { contains: "MONITOR", mode: "insensitive" } },
        { mainTask: { contains: "MONITOR", mode: "insensitive" } },
      ],
    },
    select: {
      id: true,
      title: true,
      mainTask: true,
      frequency: true,
      isRecurring: true,
      subKpis: true,
      periodKey: true,
      recurrenceWeekday: true,
      recurrenceMonthDay: true,
      periodCycleStartAt: true,
      assignedAgent: { select: { name: true } },
    },
    take: 30,
  });

  console.log(`Found ${rows.length} MONITOR* rows; range ${fromYmd}..${toYmd} (${zone})`);

  for (const r of rows) {
    const allSnaps = await prisma.kpiMaintenancePeriodSnapshot.findMany({
      where: { kpiMaintenanceId: r.id, periodKey: { contains: "2026-08" } },
      orderBy: { periodKey: "asc" },
      select: { periodKey: true, total: true, done: true, missing: true, percent: true },
    });
    console.log("augustSnaps", JSON.stringify(allSnaps, null, 2));

    const label = kpiMainTaskLabel(r);
    const invert = taskUsesInvertedRecording({ title: r.title, subKpis: r.subKpis });
    const raw = kpiChecklistProgress(r.subKpis, label);
    const live = progressWithInvertedRecording(raw, invert);
    const items = collectChecklistProgressItems(r.subKpis, label);
    const numerical = totalRecordedDataPercent(items);

    const periodKeys = enumeratePeriodKeysForKpiInRange(r, fromYmd, toYmd, zone);
    const queryKeys = periodKeysWithGmt8Aliases(periodKeys);
    const snaps = await prisma.kpiMaintenancePeriodSnapshot.findMany({
      where: { kpiMaintenanceId: r.id, periodKey: { in: queryKeys } },
    });
    const byKey = indexSnapshotsByKpiPeriod(snaps);
    const nowKey = resolvePeriodKeyForKpi(r, new Date(), zone);
    const cadence: Array<{
      key: string;
      total: number;
      done: number;
      percent: number;
      source: string;
    }> = [];

    for (const key of periodKeys) {
      const snap = byKey.get(`${r.id}:${key}`);
      if (snap) {
        const p = snapshotToProgress(snap);
        const d = progressWithInvertedRecording(p, invert);
        cadence.push({ key, total: d.total, done: d.done, percent: d.percent, source: "snap" });
      } else if (key === nowKey) {
        cadence.push({
          key,
          total: live.total,
          done: live.done,
          percent: live.percent,
          source: "live",
        });
      }
    }

    const totalRecorded = weighted(cadence.map((c) => ({ total: c.total, done: c.done })));
    const zeroDays = cadence.filter((c) => c.percent === 0).length;
    const hundredDays = cadence.filter((c) => c.percent === 100).length;
    const midDays = cadence.filter((c) => c.percent > 0 && c.percent < 100);

    console.log(
      JSON.stringify(
        {
          id: r.id,
          title: r.title,
          mainTask: r.mainTask,
          frequency: r.frequency,
          assignee: r.assignedAgent?.name ?? null,
          invert,
          liveRaw: raw,
          liveDisplay: live,
          numericalLive: numerical,
          recordedData: numerical != null && !invert ? numerical : live.percent,
          totalDataRecorded: totalRecorded,
          periodsInRange: periodKeys.length,
          snapCount: snaps.length,
          cadenceDays: cadence.length,
          zeroDays,
          hundredDays,
          midDays: midDays.slice(0, 8),
          cadenceTail: cadence.slice(-8),
          nowKey,
          altNow: alternateGmt8PeriodKey(nowKey),
        },
        null,
        2,
      ),
    );
  }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
