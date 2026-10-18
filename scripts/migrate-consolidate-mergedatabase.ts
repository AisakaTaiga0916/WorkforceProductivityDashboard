#!/usr/bin/env npx tsx
/**
 * Full mergedatabase consolidation: Phase 1 (HRIS) + Phase 2 (tasks/KPIs) + optional portal link.
 *
 * Usage:
 *   npx tsx scripts/migrate-consolidate-mergedatabase.ts
 *   npx tsx scripts/migrate-consolidate-mergedatabase.ts --apply
 *   npx tsx scripts/migrate-consolidate-mergedatabase.ts --apply --link-portal
 *   npx tsx scripts/migrate-consolidate-mergedatabase.ts --apply --phase1-only
 *   npx tsx scripts/migrate-consolidate-mergedatabase.ts --apply --phase2-only
 */
import { runPhase1HrisToMerged } from "../src/lib/sync/phase1-hris-to-merged";
import { runPortalWorkToMergedSync } from "../src/lib/sync/portal-work-to-merged";
import { prismaPrimary, prismaSecondary } from "../src/modules/platform/db/prisma";

async function main() {
  const apply = process.argv.includes("--apply");
  const dryRun = !apply;
  const linkPortal = process.argv.includes("--link-portal");
  const phase1Only = process.argv.includes("--phase1-only");
  const phase2Only = process.argv.includes("--phase2-only");

  console.log(
    dryRun
      ? "=== CONSOLIDATION DRY RUN (pass --apply) ==="
      : "=== CONSOLIDATION APPLY ===",
  );

  const report: Record<string, unknown> = { dryRun };

  if (!phase2Only) {
    console.log("\n--- Phase 1: HRIS users + attendance ---");
    report.phase1 = await runPhase1HrisToMerged({ dryRun, full: true });
    console.log(JSON.stringify(report.phase1, null, 2));
  }

  if (!phase1Only) {
    console.log("\n--- Phase 2: tasks + KPIs + per-user averages ---");
    report.phase2 = await runPortalWorkToMergedSync({ dryRun });
    console.log(JSON.stringify(report.phase2, null, 2));
  }

  if (linkPortal && apply) {
    console.log("\n--- Portal / auth link ---");
    const { execSync } = await import("node:child_process");
    execSync("npx tsx scripts/reconcile-portal-with-merged-users.ts", {
      stdio: "inherit",
      cwd: process.cwd(),
    });
    execSync("npx tsx scripts/sync-merged-roles.ts", { stdio: "inherit", cwd: process.cwd() });
    report.portalLinked = true;
  }

  console.log("\n=== Summary ===");
  console.log(JSON.stringify(report, null, 2));
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
