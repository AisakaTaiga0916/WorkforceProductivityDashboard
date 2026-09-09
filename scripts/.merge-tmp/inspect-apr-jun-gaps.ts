import { prisma } from "../../src/lib/prisma";
import { DateTime } from "luxon";
import { isKpiMetricsWorkingDay } from "../../src/lib/kpi-recurrence";

async function main() {
  const titles = ["DATA BACKUP", "SYSTEM MAINTENANCE", "MONITORING", "IT TASKS"];
  const zone = "Asia/Manila";
  const from = DateTime.fromISO("2026-04-01", { zone });
  const to = DateTime.fromISO("2026-06-30", { zone });

  const kpis = await prisma.kpiMaintenance.findMany({
    where: { title: { in: titles }, isRecurring: true },
    select: {
      id: true,
      title: true,
      frequency: true,
      subKpis: true,
      periodSnapshots: {
        where: {
          OR: [
            { periodKey: { contains: "2026-04" } },
            { periodKey: { contains: "2026-05" } },
            { periodKey: { contains: "2026-06" } },
          ],
        },
        select: { periodKey: true, percent: true, frequency: true, contributorProgress: true },
      },
    },
  });

  const workingDays: string[] = [];
  for (let d = from; d <= to; d = d.plus({ days: 1 })) {
    if (isKpiMetricsWorkingDay(d)) workingDays.push(d.toISODate()!);
  }

  for (const kpi of kpis) {
    const dailyKeys = new Set(
      kpi.periodSnapshots
        .filter((s) => s.frequency === "DAILY")
        .map((s) => s.periodKey.replace(/^D:(?:Asia\/Manila:)?/, "")),
    );
    const missing = workingDays.filter((ymd) => !dailyKeys.has(ymd));
    const withContrib = kpi.periodSnapshots.filter(
      (s) => Array.isArray(s.contributorProgress) && (s.contributorProgress as unknown[]).length > 0,
    ).length;
    const meta =
      kpi.subKpis && typeof kpi.subKpis === "object" && !Array.isArray(kpi.subKpis)
        ? (kpi.subKpis as Record<string, unknown>)
        : {};
    const archivedNum = Array.isArray(meta.archivedNumericalRecords)
      ? meta.archivedNumericalRecords.length
      : 0;
    const archivedShot = Array.isArray(meta.archivedTaskScreenshots)
      ? meta.archivedTaskScreenshots.length
      : 0;

    console.log(
      JSON.stringify(
        {
          title: kpi.title,
          frequency: kpi.frequency,
          dailySnapshotsAprJun: dailyKeys.size,
          workingDaysAprJun: workingDays.length,
          missingDailyCount: missing.length,
          missingSample: missing.slice(0, 15),
          monthlySnapshots: kpi.periodSnapshots.filter((s) => s.frequency === "MONTHLY").length,
          withContributorProgress: withContrib,
          archivedNumericalSets: archivedNum,
          archivedScreenshotSets: archivedShot,
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
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
