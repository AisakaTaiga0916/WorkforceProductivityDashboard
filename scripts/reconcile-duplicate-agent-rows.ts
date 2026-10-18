/**
 * Merge duplicate Agent rows for portal staff into each user's canonical Agent record.
 *
 * Usage:
 *   npx tsx scripts/reconcile-duplicate-agent-rows.ts
 *   npx tsx scripts/reconcile-duplicate-agent-rows.ts --apply
 */
import { reconcileDuplicateAgentRows } from "../src/lib/reconcile-duplicate-agents";

async function main() {
  const apply = process.argv.includes("--apply");
  const result = await reconcileDuplicateAgentRows({ dryRun: !apply });

  console.log(apply ? "=== Applied duplicate agent reconciliation ===" : "=== Dry run (pass --apply to write) ===");
  console.log(JSON.stringify(result.mappings, null, 2));
  console.log(
    JSON.stringify(
      {
        ticketsUpdated: result.ticketsUpdated,
        kpisUpdated: result.kpisUpdated,
        tasksUpdated: result.tasksUpdated,
        kpiSubAssigneeRowsUpdated: result.kpiSubAssigneeRowsUpdated,
        staleAgentsDeleted: result.staleAgentsDeleted,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    const { prisma } = await import("../src/modules/platform/db/prisma");
    await prisma.$disconnect();
  });
