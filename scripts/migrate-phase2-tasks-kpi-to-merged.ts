#!/usr/bin/env npx tsx
/**
 * Phase 2: Migrate tasks + KPI monitoring → mergedatabase (source of truth for work progress).
 *
 * Tickets remain in primary PostgreSQL only.
 *
 * Usage:
 *   npx tsx scripts/migrate-phase2-tasks-kpi-to-merged.ts              # dry-run
 *   npx tsx scripts/migrate-phase2-tasks-kpi-to-merged.ts --apply
 */
import { runPortalWorkToMergedSync } from "../src/lib/sync/portal-work-to-merged";
import { prismaPrimary, prismaSecondary } from "../src/modules/platform/db/prisma";

async function main() {
  const dryRun = !process.argv.includes("--apply");

  console.log(
    dryRun
      ? "=== PHASE 2 DRY RUN (pass --apply) ==="
      : "=== PHASE 2 APPLY: tasks/KPIs → mergedatabase ===",
  );

  const result = await runPortalWorkToMergedSync({ dryRun });
  console.log(JSON.stringify(result, null, 2));
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
