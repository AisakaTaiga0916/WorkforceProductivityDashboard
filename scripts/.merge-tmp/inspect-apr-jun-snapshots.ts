import { prisma } from "../../src/lib/prisma";

async function main() {
  const total = await prisma.kpiMaintenancePeriodSnapshot.count();
  const aprJun = await prisma.kpiMaintenancePeriodSnapshot.count({
    where: {
      OR: [
        { periodKey: { contains: "2026-04" } },
        { periodKey: { contains: "2026-05" } },
        { periodKey: { contains: "2026-06" } },
      ],
    },
  });
  const legacy = await prisma.kpiMaintenancePeriodSnapshot.count({
    where: {
      OR: [
        { periodKey: { startsWith: "D:2026-04" } },
        { periodKey: { startsWith: "D:2026-05" } },
        { periodKey: { startsWith: "D:2026-06" } },
        { periodKey: { startsWith: "W:2026-04" } },
        { periodKey: { startsWith: "W:2026-05" } },
        { periodKey: { startsWith: "W:2026-06" } },
        { periodKey: { startsWith: "M:2026-04" } },
        { periodKey: { startsWith: "M:2026-05" } },
        { periodKey: { startsWith: "M:2026-06" } },
      ],
    },
  });
  const withTz = await prisma.kpiMaintenancePeriodSnapshot.count({
    where: {
      OR: [
        { periodKey: { contains: "Asia/Manila:2026-04" } },
        { periodKey: { contains: "Asia/Manila:2026-05" } },
        { periodKey: { contains: "Asia/Manila:2026-06" } },
      ],
    },
  });
  const byPrefix = await prisma.$queryRawUnsafe<
    Array<{ prefix: string; n: bigint }>
  >(`
    SELECT
      CASE
        WHEN period_key LIKE 'D:Asia/Manila:%' THEN 'D:tz'
        WHEN period_key LIKE 'D:%' THEN 'D:legacy'
        WHEN period_key LIKE 'W:Asia/Manila:%' THEN 'W:tz'
        WHEN period_key LIKE 'W:%' THEN 'W:legacy'
        WHEN period_key LIKE 'M:Asia/Manila:%' THEN 'M:tz'
        WHEN period_key LIKE 'M:%' THEN 'M:legacy'
        ELSE 'other'
      END AS prefix,
      COUNT(*)::bigint AS n
    FROM kpi_maintenance_period_snapshots
    WHERE period_key LIKE '%2026-04%'
       OR period_key LIKE '%2026-05%'
       OR period_key LIKE '%2026-06%'
    GROUP BY 1
    ORDER BY 1
  `);
  const sample = await prisma.kpiMaintenancePeriodSnapshot.findMany({
    where: {
      OR: [
        { periodKey: { contains: "2026-04" } },
        { periodKey: { contains: "2026-05" } },
        { periodKey: { contains: "2026-06" } },
      ],
    },
    select: {
      periodKey: true,
      percent: true,
      frequency: true,
      kpiMaintenance: { select: { title: true } },
    },
    take: 25,
    orderBy: { periodKey: "asc" },
  });
  console.log(
    JSON.stringify(
      {
        total,
        aprJun,
        legacy,
        withTz,
        byPrefix: byPrefix.map((r) => ({ prefix: r.prefix, n: Number(r.n) })),
        sample,
      },
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
  .finally(async () => {
    await prisma.$disconnect();
  });
