import { prisma } from "../../src/lib/prisma";
import { upsertKpiPeriodSnapshot } from "../../src/lib/kpi-period-snapshots";
import {
  kpiChecklistMetricView,
  kpiChecklistProgress,
  setPillarDone,
  taskUsesInvertedRecording,
} from "../../src/lib/kpi-subkpis";

const ID = "cmsfm27oe0007cv1hw25xgnnz";

async function main() {
  const row = await prisma.kpiMaintenance.findUniqueOrThrow({ where: { id: ID } });
  const beforeInvert = taskUsesInvertedRecording({ title: row.title, subKpis: row.subKpis });
  const beforeProg = kpiChecklistProgress(row.subKpis, row.title);
  const beforeView = kpiChecklistMetricView(beforeProg, beforeInvert);
  console.log("before", {
    pillarDone: (row.subKpis as { pillarDone?: boolean }).pillarDone === true,
    beforeProg,
    beforeView,
  });

  if (!beforeInvert) {
    throw new Error("CYBERSECURITY is not an inverted-recording task.");
  }
  if (beforeView.negative === 0) {
    console.log("Already clear (0 flagged). Nothing to undo.");
    return;
  }

  const nextSubKpis = setPillarDone(row.subKpis, false);
  const updated = await prisma.kpiMaintenance.update({
    where: { id: ID },
    data: {
      subKpis: nextSubKpis,
      lastFullCompletionAt: null,
    },
  });

  const zone = "Asia/Taipei";
  await upsertKpiPeriodSnapshot(updated, zone, new Date());

  await prisma.kpiMaintenanceActivity.create({
    data: {
      kpiMaintenanceId: ID,
      author: "System",
      summary: "Sub-task reopened",
      detail: "CYBERSECURITY flag cleared (admin undo)",
    },
  });

  const afterProg = kpiChecklistProgress(updated.subKpis, updated.title);
  const afterView = kpiChecklistMetricView(
    afterProg,
    taskUsesInvertedRecording({ title: updated.title, subKpis: updated.subKpis }),
  );
  const snaps = await prisma.kpiMaintenancePeriodSnapshot.findMany({
    where: { kpiMaintenanceId: ID, periodKey: { contains: "2026-08-06" } },
    orderBy: { capturedAt: "desc" },
  });

  console.log("after", {
    pillarDone: (updated.subKpis as { pillarDone?: boolean }).pillarDone === true,
    afterProg,
    afterView,
    snaps: snaps.map((s) => ({
      periodKey: s.periodKey,
      total: s.total,
      done: s.done,
      missing: s.missing,
      percent: s.percent,
      fullyComplete: s.fullyComplete,
    })),
  });
}

main().finally(() => prisma.$disconnect());
