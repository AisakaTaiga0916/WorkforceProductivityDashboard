import { prisma } from "../../src/lib/prisma";
import { getDailyPeriodKey } from "../../src/lib/kpi-recurrence";
import { DateTime } from "luxon";

async function main() {
  const kpi = await prisma.kpiMaintenance.findFirst({
    where: { title: "DATA BACKUP", frequency: "DAILY", isRecurring: true },
    select: { id: true },
  });
  if (!kpi) throw new Error("DATA BACKUP daily KPI missing");
  const zone = "Asia/Manila";
  const ymd = "2026-06-13";
  const neighbor = await prisma.kpiMaintenancePeriodSnapshot.findFirst({
    where: {
      kpiMaintenanceId: kpi.id,
      periodKey: { in: ["D:Asia/Manila:2026-06-12", "D:Asia/Manila:2026-06-14"] },
    },
    orderBy: { periodKey: "asc" },
    select: { percent: true, total: true, done: true, missing: true, fullyComplete: true },
  });
  const percent = neighbor?.percent ?? 80;
  const periodKey = getDailyPeriodKey(DateTime.fromISO(ymd, { zone }).toJSDate(), zone);
  await prisma.kpiMaintenancePeriodSnapshot.upsert({
    where: {
      kpiMaintenanceId_periodKey: { kpiMaintenanceId: kpi.id, periodKey },
    },
    create: {
      kpiMaintenanceId: kpi.id,
      periodKey,
      frequency: "DAILY",
      timeZone: zone,
      total: 100,
      done: percent,
      missing: 100 - percent,
      percent,
      fullyComplete: percent >= 100,
      capturedAt: DateTime.fromISO(ymd, { zone }).endOf("day").toJSDate(),
    },
    update: {},
  });
  console.log(`DATA BACKUP ${ymd}: ensured ${percent}% at ${periodKey}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
