#!/usr/bin/env npx tsx
/**
 * Phase 1: Migrate HRIS users + attendance → mergedatabase.
 *
 * Usage:
 *   npx tsx scripts/migrate-phase1-hris-to-merged.ts              # dry-run
 *   npx tsx scripts/migrate-phase1-hris-to-merged.ts --apply
 *   npx tsx scripts/migrate-phase1-hris-to-merged.ts --apply --link-portal
 *
 * Environment:
 *   HRIS_MERGE_SOURCE_DB=hrisdemo
 *   HRIS_MERGE_TARGET_DB=mergedatabase-demo
 *   HRIS_MERGE_SOURCE_TAG=hrisdemo
 */
import { runPhase1HrisToMerged } from "../src/lib/sync/phase1-hris-to-merged";
import { prismaPrimary, prismaSecondary } from "../src/modules/platform/db/prisma";

async function main() {
  const apply = process.argv.includes("--apply");
  const linkPortal = process.argv.includes("--link-portal");
  const dryRun = !apply;

  console.log(
    dryRun
      ? "=== PHASE 1 DRY RUN (pass --apply) ==="
      : "=== PHASE 1 APPLY: HRIS → mergedatabase ===",
  );

  const result = await runPhase1HrisToMerged({ dryRun, full: true });
  console.log(JSON.stringify(result, null, 2));

  if (linkPortal && apply) {
    console.log("\nLinking merged users → portal_accounts + auth…");
    const { execSync } = await import("node:child_process");
    execSync("npx tsx scripts/reconcile-portal-with-merged-users.ts", {
      stdio: "inherit",
      cwd: process.cwd(),
    });
    execSync("npx tsx scripts/sync-merged-roles.ts", { stdio: "inherit", cwd: process.cwd() });
  }

  if (result.conflicts.length > 0) process.exitCode = 1;
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
