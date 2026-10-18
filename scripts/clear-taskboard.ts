/**
 * Remove all Task Board rows (KpiMaintenance + period snapshots) and legacy TaskItem rows.
 * Usage: npx tsx scripts/clear-taskboard.ts
 */
import { prisma } from "../src/modules/platform/db/prisma";

async function main() {
  const kpi = await prisma.kpiMaintenance.deleteMany();
  const tasks = await prisma.taskItem.deleteMany();
  console.log(`Removed ${kpi.count} KPI task(s) from the Task Board.`);
  console.log(`Removed ${tasks.count} TaskItem row(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
