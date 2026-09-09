import { PrismaClient } from "@prisma/client/primary";
import {
  collectChecklistProgressItems,
  kpiChecklistProgress,
  progressWithInvertedRecording,
  taskUsesInvertedRecording,
} from "../src/lib/kpi-subkpis";
import { kpiMainTaskLabel } from "../src/lib/kpi-main-task";
import { totalRecordedDataPercent } from "../src/lib/sub-kpi-completion-mode";
import {
  alternateGmt8PeriodKey,
  enumeratePeriodKeysForKpiInRange,
  indexSnapshotsByKpiPeriod,
  periodKeysWithGmt8Aliases,
  resolvePeriodKeyForKpi,
  snapshotToProgress,
} from "../src/lib/kpi-period-snapshots";
import { DateTime } from "luxon";

const prisma = new PrismaClient();

function weighted(rows: { total: number; done: number }[]) {
  const withData = rows.filter((r) => r.total > 0);
  if (!withData.length) return null;
  const total = withData.reduce((s, r) => s + r.total, 0);
  const done = withData.reduce((s, r) => s + r.done, 0);
  return total > 0 ? Math.round((done / total) * 100) : null;
}

async function main() {
  const zone = "Asia/Manila";
  const now = DateTime.now().setZone(zone);
  const fromYmd = now.startOf("month").toISODate()!;
  const toYmd = now.toISODate()!;

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
    const cadence: { key: string; total: number; done: number; percent: number; source: string }[] = [];

    for (const key of periodKeys) {
      const snap = byKey.get(`${r.id}:${key}`);
      if (snap) {
        const p = snapshotToProgress(snap);
        const d = progressWithInvertedRecording(p, invert);
        cadence.push({ key, ...d, source: "snap" });
      } else if (key === nowKey) {
        cadence.push({ key, ...live, source: "live" });
      }
    }

    const totalRecorded = weighted(cadence.map((c) => ({ total: c.total, done: c.done })));

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
          cadenceSample: cadence.slice(-10),
          snapCount: snaps.length,
          nowKey,
          altNow: alternateGmt8PeriodKey(nowKey),
        },
        null,
        2,
      ),
    );
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
