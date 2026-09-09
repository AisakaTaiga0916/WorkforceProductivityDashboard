import { prisma } from "../../src/lib/prisma.ts";
import {
  enumeratePeriodKeysForKpiInRange,
  periodKeysWithGmt8Aliases,
} from "../../src/lib/kpi-period-snapshots.ts";

void (async () => {
  const monthly = await prisma.kpiMaintenance.findMany({
    where: { frequency: "MONTHLY", isRecurring: true },
    select: {
      id: true,
      title: true,
      frequency: true,
      recurrenceMonthDay: true,
      periodKey: true,
      assignedAgentId: true,
    },
    take: 20,
  });
  console.log(
    "monthly kpis",
    monthly.map((k) => ({ id: k.id, title: k.title, day: k.recurrenceMonthDay, pk: k.periodKey })),
  );

  for (const kpi of monthly.slice(0, 5)) {
    const keysAug = enumeratePeriodKeysForKpiInRange(kpi, "2026-08-01", "2026-08-31", "Asia/Manila");
    const keysYear = enumeratePeriodKeysForKpiInRange(kpi, "2026-01-01", "2026-12-31", "Asia/Manila");
    const queryKeys = periodKeysWithGmt8Aliases(keysAug);
    const snaps = await prisma.kpiMaintenancePeriodSnapshot.findMany({
      where: { kpiMaintenanceId: kpi.id },
      select: { periodKey: true, total: true, done: true, percent: true },
      orderBy: { periodKey: "asc" },
      take: 30,
    });
    console.log(
      JSON.stringify(
        {
          title: kpi.title,
          keysAug,
          keysYearCount: keysYear.length,
          queryKeys,
          snaps,
        },
        null,
        2,
      ),
    );
  }
  process.exit(0);
})();
