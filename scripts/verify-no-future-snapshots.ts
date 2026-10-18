/** READ-ONLY: confirm no future-dated snapshots remain after cleanup. */
import { prismaPrimary } from "../src/modules/platform/db/prisma";

async function main() {
  const snaps = await prismaPrimary.kpiMaintenancePeriodSnapshot.findMany({
    select: { periodKey: true, kpiMaintenanceId: true },
  });
  const future = snaps.filter((s) => {
    const m = s.periodKey.match(/(\d{4})-(\d{2})/);
    return !!m && m[0] >= "2026-09";
  });
  console.log("total snapshots:", snaps.length);
  console.log("future-dated remaining:", future.length);
  for (const s of future) console.log(" ", s.periodKey, s.kpiMaintenanceId);
  await prismaPrimary.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
