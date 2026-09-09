/**
 * Delete Apr–Jun daily snapshots incorrectly written under Asia/Taipei
 * (recovery run used the wrong default zone). Keeps monthly Taipei keys.
 */
import { prisma } from "../../src/lib/prisma";

async function main() {
  const result = await prisma.kpiMaintenancePeriodSnapshot.deleteMany({
    where: {
      AND: [
        { frequency: "DAILY" },
        { periodKey: { startsWith: "D:Asia/Taipei:2026-0" } },
        {
          OR: [
            { periodKey: { contains: "2026-04-" } },
            { periodKey: { contains: "2026-05-" } },
            { periodKey: { contains: "2026-06-" } },
          ],
        },
      ],
    },
  });
  console.log(`Deleted ${result.count} daily Asia/Taipei Apr–Jun snapshot(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
