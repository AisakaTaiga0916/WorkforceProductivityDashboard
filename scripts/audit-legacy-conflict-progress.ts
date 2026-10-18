#!/usr/bin/env npx tsx
/**
 * Audit legacy LEGACY_CONFLICT accounts: primary PG work + mergedatabase-demo mirror.
 */
import { pickCanonicalAgentForPortal } from "../src/lib/admin-roster";
import { mergeLegacyConflictPortals } from "../src/lib/sync/merge-legacy-conflict-portals";
import { prismaPrimary, prismaSecondary } from "../src/modules/platform/db/prisma";

const sourceTag = process.env.TICKETING_MERGE_SOURCE_TAG?.trim() || "ticketing_system";
const hrisTag = process.env.HRIS_MERGE_SOURCE_TAG?.trim() || "hrisdemo";

async function main() {
  const mergePreview = await mergeLegacyConflictPortals({ dryRun: true });
  const agents = await prismaPrimary.agent.findMany({ orderBy: { createdAt: "asc" } });

  console.log("=== Legacy conflict → merged user pairs ===\n");

  let totalTickets = 0;
  let totalKpis = 0;
  let totalTasks = 0;
  let totalActivities = 0;
  let totalCreatedBy = 0;

  for (const pair of mergePreview.pairs) {
    const legacyAgent = pickCanonicalAgentForPortal(pair.legacy, agents);
    const legacyEmail = pair.legacy.email.trim().toLowerCase();

    const [tickets, kpis, tasks, createdByTasks, createdByKpis, createdByActivities] =
      await Promise.all([
        prismaPrimary.ticket.count({ where: { assignedAgentId: legacyAgent?.id } }),
        prismaPrimary.kpiMaintenance.count({ where: { assignedAgentId: legacyAgent?.id } }),
        prismaPrimary.taskItem.count({ where: { assignedAgentId: legacyAgent?.id } }),
        prismaPrimary.taskItem.count({
          where: { createdBy: { equals: legacyEmail, mode: "insensitive" } },
        }),
        prismaPrimary.kpiMaintenance.count({
          where: { createdBy: { equals: legacyEmail, mode: "insensitive" } },
        }),
        prismaPrimary.taskActivity.count({
          where: { author: { equals: legacyEmail, mode: "insensitive" } },
        }),
      ]);

    totalTickets += tickets;
    totalKpis += kpis;
    totalTasks += tasks;
    totalCreatedBy += createdByTasks + createdByKpis + createdByActivities;

    const mergedKpis = await prismaSecondary.$queryRaw<Array<{ c: bigint }>>`
      SELECT COUNT(*) AS c FROM merged_kpi_maintenance
      WHERE source_database = ${sourceTag}
        AND assigned_merged_source_user_id = ${pair.merged.source_user_id}
    `;
    const mergedTasks = await prismaSecondary.$queryRaw<Array<{ c: bigint }>>`
      SELECT COUNT(*) AS c FROM merged_task_items
      WHERE source_database = ${sourceTag}
        AND assigned_merged_source_user_id = ${pair.merged.source_user_id}
    `;
    const mergedKpiAvg = await prismaSecondary.$queryRaw<Array<{ c: bigint }>>`
      SELECT COUNT(*) AS c FROM merged_kpi_user_averages
      WHERE source_database = ${sourceTag}
        AND source_user_id = ${pair.merged.source_user_id}
    `;

    console.log(`${pair.legacy.name}`);
    console.log(`  legacy email: ${pair.legacy.email}`);
    console.log(`  merged user: #${pair.merged.source_user_id} ${pair.merged.name}`);
    console.log(
      `  primary PG (legacy agent/email): tickets=${tickets} kpis=${kpis} tasks=${tasks} createdBy=${createdByTasks + createdByKpis + createdByActivities}`,
    );
    console.log(
      `  mergedatabase-demo (canonical user): kpis=${Number(mergedKpis[0]?.c ?? 0)} tasks=${Number(mergedTasks[0]?.c ?? 0)} kpi_avg=${Number(mergedKpiAvg[0]?.c ?? 0)}`,
    );
    console.log();
  }

  console.log("=== Totals on legacy identities in primary PG ===");
  console.log(`  assigned tickets: ${totalTickets}`);
  console.log(`  assigned kpis: ${totalKpis}`);
  console.log(`  assigned tasks: ${totalTasks}`);
  console.log(`  created-by references: ${totalCreatedBy}`);

  const mergedTotals = await prismaSecondary.$queryRaw<
    Array<{ kpis: bigint; tasks: bigint; snapshots: bigint; averages: bigint }>
  >`
    SELECT
      (SELECT COUNT(*) FROM merged_kpi_maintenance WHERE source_database = ${sourceTag}) AS kpis,
      (SELECT COUNT(*) FROM merged_task_items WHERE source_database = ${sourceTag}) AS tasks,
      (SELECT COUNT(*) FROM merged_kpi_period_snapshots WHERE source_database = ${sourceTag}) AS snapshots,
      (SELECT COUNT(*) FROM merged_kpi_user_averages WHERE source_database = ${sourceTag}) AS averages
  `;
  console.log("\n=== mergedatabase-demo mirror totals (ticketing_system tag) ===");
  console.log(JSON.stringify(mergedTotals[0], (k, v) => (typeof v === "bigint" ? v.toString() : v)));

  const legacyEmails = mergePreview.pairs.map((p) => p.legacy.email.trim().toLowerCase());
  if (legacyEmails.length > 0) {
    const stillOnLegacyEmail = await prismaSecondary.$queryRaw<Array<{ c: bigint }>>`
      SELECT COUNT(*) AS c FROM merged_kpi_maintenance
      WHERE source_database = ${sourceTag}
        AND LOWER(assigned_agent_email) IN (${legacyEmails.join(",")})
    `.catch(() => [{ c: 0n }]);

    // Use per-email check instead
    let legacyEmailInMerged = 0;
    for (const email of legacyEmails) {
      const rows = await prismaSecondary.$queryRaw<Array<{ c: bigint }>>`
        SELECT COUNT(*) AS c FROM merged_kpi_maintenance
        WHERE source_database = ${sourceTag} AND LOWER(assigned_agent_email) = ${email}
      `;
      legacyEmailInMerged += Number(rows[0]?.c ?? 0);
      const taskRows = await prismaSecondary.$queryRaw<Array<{ c: bigint }>>`
        SELECT COUNT(*) AS c FROM merged_task_items
        WHERE source_database = ${sourceTag} AND LOWER(assigned_agent_email) = ${email}
      `;
      legacyEmailInMerged += Number(taskRows[0]?.c ?? 0);
    }
    console.log(`\n  merged rows still keyed to legacy work emails: ${legacyEmailInMerged}`);
  }

  console.log("\n=== Canonical portal accounts (HRIS-linked) work in primary PG ===");
  let canonTickets = 0;
  let canonKpis = 0;
  let canonTasks = 0;
  let canonCreated = 0;
  for (const pair of mergePreview.pairs) {
    const agent = pickCanonicalAgentForPortal(pair.canonical, agents);
    const email = pair.canonical.email.trim().toLowerCase();
    const [t, k, ti, ct, ck, ca] = await Promise.all([
      prismaPrimary.ticket.count({ where: { assignedAgentId: agent?.id } }),
      prismaPrimary.kpiMaintenance.count({ where: { assignedAgentId: agent?.id } }),
      prismaPrimary.taskItem.count({ where: { assignedAgentId: agent?.id } }),
      prismaPrimary.taskItem.count({
        where: { createdBy: { equals: email, mode: "insensitive" } },
      }),
      prismaPrimary.kpiMaintenance.count({
        where: { createdBy: { equals: email, mode: "insensitive" } },
      }),
      prismaPrimary.taskActivity.count({
        where: { author: { equals: email, mode: "insensitive" } },
      }),
    ]);
    canonTickets += t;
    canonKpis += k;
    canonTasks += ti;
    canonCreated += ct + ck + ca;
    if (t + k + ti + ct + ck + ca > 0) {
      console.log(
        `  ${pair.canonical.name}: tickets=${t} kpis=${k} tasks=${ti} createdBy=${ct + ck + ca}`,
      );
    }
  }
  console.log(
    `  totals: tickets=${canonTickets} kpis=${canonKpis} tasks=${canonTasks} createdBy=${canonCreated}`,
  );

  const [allTickets, allKpis, allTasks] = await Promise.all([
    prismaPrimary.ticket.count(),
    prismaPrimary.kpiMaintenance.count(),
    prismaPrimary.taskItem.count(),
  ]);
  console.log("\n=== Entire primary PostgreSQL database ===");
  console.log(`  tickets=${allTickets} kpis=${allKpis} tasks=${allTasks}`);
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
