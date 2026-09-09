import { prisma } from "../../src/lib/prisma";

async function main() {
  const rows = await prisma.$queryRawUnsafe<
    Array<{ tz_kind: string; n: bigint }>
  >(`
    SELECT
      CASE
        WHEN period_key LIKE '%Asia/Manila%' THEN 'Manila'
        WHEN period_key LIKE '%Asia/Taipei%' THEN 'Taipei'
        ELSE 'other'
      END AS tz_kind,
      COUNT(*)::bigint AS n
    FROM kpi_maintenance_period_snapshots
    WHERE period_key LIKE '%2026-04%'
       OR period_key LIKE '%2026-05%'
       OR period_key LIKE '%2026-06%'
    GROUP BY 1
  `);
  console.log(rows.map((r) => ({ tz: r.tz_kind, n: Number(r.n) })));

  const taipei = await prisma.kpiMaintenancePeriodSnapshot.findMany({
    where: { periodKey: { contains: "Asia/Taipei:2026-" } },
    select: {
      id: true,
      periodKey: true,
      percent: true,
      kpiMaintenance: { select: { title: true } },
    },
    take: 40,
  });
  console.log("taipei sample", taipei);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
