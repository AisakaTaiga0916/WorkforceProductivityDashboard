#!/usr/bin/env npx tsx
import { prismaPrimary, prismaSecondary } from "../src/modules/platform/db/prisma";

async function main() {
  const snaps = await prismaPrimary.kpiMaintenancePeriodSnapshot.findMany({
    select: { contributorProgress: true, total: true, done: true, kpiMaintenanceId: true },
  });
  const names = new Map<string, { total: number; done: number; snaps: number }>();
  for (const s of snaps) {
    const raw = s.contributorProgress;
    if (!Array.isArray(raw)) continue;
    for (const entry of raw) {
      if (!entry || typeof entry !== "object") continue;
      const row = entry as Record<string, unknown>;
      const name = typeof row.name === "string" ? row.name.trim() : "";
      const total = Number(row.total);
      const done = Number(row.done);
      if (!name || !Number.isFinite(total) || total <= 0) continue;
      const cur = names.get(name) ?? { total: 0, done: 0, snaps: 0 };
      cur.total += Math.round(total);
      cur.done += Math.round(Math.min(done, total));
      cur.snaps += 1;
      names.set(name, cur);
    }
  }
  console.log("contributor names in PG snapshots:", names.size);
  console.log(
    [...names.entries()]
      .sort((a, b) => b[1].snaps - a[1].snaps)
      .slice(0, 20)
      .map(([n, v]) => ({ name: n, ...v, pct: Math.round((v.done / v.total) * 100) })),
  );

  const agents = await prismaPrimary.agent.findMany({ select: { id: true, name: true, email: true } });
  const portals = await prismaPrimary.portalAccount.findMany({
    where: { mergedSourceUserId: { not: null }, accountStatus: { not: "LEGACY_CONFLICT" } },
    select: { name: true, email: true, mergedSourceUserId: true },
  });
  console.log({ agents: agents.length, linkedPortals: portals.length });

  const avgs = await prismaSecondary.$queryRawUnsafe(`
    SELECT display_name, overall_percent, average_percent, snapshot_count, source_user_id
    FROM merged_kpi_user_averages ORDER BY overall_percent DESC
  `);
  console.log("current averages", avgs);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prismaPrimary.$disconnect();
    await prismaSecondary.$disconnect();
  });
