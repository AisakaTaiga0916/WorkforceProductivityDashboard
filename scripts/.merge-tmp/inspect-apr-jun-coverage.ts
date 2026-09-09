import { prisma } from "../../src/lib/prisma";

async function main() {
  const rows = await prisma.$queryRawUnsafe<
    Array<{ title: string; ym: string; freq: string; n: bigint; avg_pct: number }>
  >(`
    SELECT
      k.title AS title,
      CASE
        WHEN s.period_key ~ '2026-04' THEN '2026-04'
        WHEN s.period_key ~ '2026-05' THEN '2026-05'
        WHEN s.period_key ~ '2026-06' THEN '2026-06'
        ELSE 'other'
      END AS ym,
      s.frequency::text AS freq,
      COUNT(*)::bigint AS n,
      ROUND(AVG(s.percent)::numeric, 1)::float AS avg_pct
    FROM kpi_maintenance_period_snapshots s
    JOIN kpi_maintenance k ON k.id = s.kpi_maintenance_id
    WHERE s.period_key LIKE '%2026-04%'
       OR s.period_key LIKE '%2026-05%'
       OR s.period_key LIKE '%2026-06%'
    GROUP BY 1, 2, 3
    ORDER BY 1, 2, 3
  `);

  const kpis = await prisma.kpiMaintenance.findMany({
    where: { isRecurring: true },
    select: {
      id: true,
      title: true,
      frequency: true,
      mainTask: true,
      assignedAgent: { select: { name: true } },
      _count: { select: { periodSnapshots: true } },
    },
    orderBy: { title: "asc" },
  });

  const legacyMonthly = await prisma.kpiMaintenancePeriodSnapshot.findMany({
    where: {
      OR: [
        { periodKey: { startsWith: "M:2026-" } },
        { periodKey: { startsWith: "D:2026-" } },
        { periodKey: { startsWith: "W:2026-" } },
      ],
    },
    select: {
      periodKey: true,
      percent: true,
      kpiMaintenance: { select: { title: true } },
    },
  });

  console.log(
    JSON.stringify(
      {
        coverage: rows.map((r) => ({
          title: r.title,
          ym: r.ym,
          freq: r.freq,
          n: Number(r.n),
          avg_pct: r.avg_pct,
        })),
        recurringKpis: kpis.map((k) => ({
          title: k.title,
          frequency: k.frequency,
          mainTask: k.mainTask,
          assignee: k.assignedAgent?.name ?? null,
          snapshots: k._count.periodSnapshots,
        })),
        legacyKeys: legacyMonthly,
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
