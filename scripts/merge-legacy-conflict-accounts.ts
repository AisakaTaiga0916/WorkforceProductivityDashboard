#!/usr/bin/env npx tsx
/**
 * Merge LEGACY_CONFLICT portal accounts into canonical HRIS-linked portals
 * and mergedatabase-demo users (login aliases + work attribution).
 *
 * Usage:
 *   npx tsx scripts/merge-legacy-conflict-accounts.ts
 *   npx tsx scripts/merge-legacy-conflict-accounts.ts --apply
 */
import { mergeLegacyConflictPortals } from "../src/lib/sync/merge-legacy-conflict-portals";
import { prismaAuth, prismaPrimary, prismaSecondary } from "../src/modules/platform/db/prisma";

async function main() {
  const apply = process.argv.includes("--apply");
  const result = await mergeLegacyConflictPortals({ dryRun: !apply });

  console.log(
    apply ? "=== Applied legacy conflict merge ===" : "=== Dry run (pass --apply to write) ===",
  );
  console.log(`Source tag: ${result.sourceTag}`);
  console.log(`Matched pairs: ${result.pairs.length}`);
  for (const pair of result.pairs) {
    console.log(
      `  [${pair.score}] ${pair.legacy.name} (${pair.legacy.email})`,
      `→ ${pair.canonical.name} (${pair.canonical.email})`,
      `[merged #${pair.merged.source_user_id}]`,
    );
  }
  if (result.unmatched.length > 0) {
    console.log(`Unmatched LEGACY_CONFLICT: ${result.unmatched.length}`);
    for (const row of result.unmatched) {
      console.log(`  - ${row.name} (${row.email})`);
    }
  }
  console.log(
    JSON.stringify(
      {
        portalAliasesRegistered: result.portalAliasesRegistered,
        mergedAliasesRegistered: result.mergedAliasesRegistered,
        ticketsUpdated: result.ticketsUpdated,
        kpisUpdated: result.kpisUpdated,
        tasksUpdated: result.tasksUpdated,
        kpiSubAssigneeRowsUpdated: result.kpiSubAssigneeRowsUpdated,
        snapshotRowsUpdated: result.snapshotRowsUpdated,
        actionRequestsUpdated: result.actionRequestsUpdated,
        createdByEmailsUpdated: result.createdByEmailsUpdated,
        staffCompanyCopied: result.staffCompanyCopied,
        authPortalRelinked: result.authPortalRelinked,
        mergeMappingsUpdated: result.mergeMappingsUpdated,
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
    await prismaPrimary.$disconnect();
    await prismaSecondary.$disconnect();
    await prismaAuth.$disconnect();
  });
