/**
 * Secondary DB is ETL-populated (mergeddatabase-dev). Run `npm run db:merge` to refresh data.
 * Usage: npx tsx prisma/seed-secondary.ts
 */
import { prismaSecondary } from "../src/modules/platform/db/prisma";

async function main() {
  console.log("Secondary database (mergeddatabase-dev) — ETL read model.\n");
  console.log("Refresh data with: npm run db:merge\n");

  const [users, clockIns, tasks, kpis] = await Promise.all([
    prismaSecondary.mergedUser.count(),
    prismaSecondary.mergedAttendanceClockIn.count(),
    prismaSecondary.mergedTaskItem.count(),
    prismaSecondary.mergedKpiMaintenance.count(),
  ]);

  console.log(
    JSON.stringify(
      { MergedUser: users, MergedAttendanceClockIn: clockIns, MergedTaskItem: tasks, MergedKpiMaintenance: kpis },
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
  .finally(() => {
    void prismaSecondary.$disconnect();
  });
