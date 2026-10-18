#!/usr/bin/env npx tsx
/**
 * Sync portal-attributed tasks and KPI progress from primary PostgreSQL
 * into mergedatabase-demo with merged_users linkage.
 *
 * Tickets remain in the primary database only.
 *
 * Usage:
 *   npm run db:sync:tasks-kpi
 *   npm run db:sync:tasks-kpi -- --dry-run
 */
import { runPortalWorkToMergedSync } from "../src/lib/sync/portal-work-to-merged";
import { prismaPrimary } from "../src/modules/platform/db/prisma";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  console.log(
    dryRun
      ? "=== DRY RUN portal work → mergedatabase-demo ==="
      : "=== APPLY portal work → mergedatabase-demo ===",
  );

  const result = await runPortalWorkToMergedSync({ dryRun });
  console.log(JSON.stringify(result, null, 2));

  if (result.source.kpis === 0 && result.source.tasks === 0) {
    console.log("\nNote: Primary has no KPI/task rows yet. Re-run after data exists.");
  }
}

main()
  .catch((e) => {
    console.error("Sync failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prismaPrimary.$disconnect();
  });
