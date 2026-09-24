#!/usr/bin/env npx tsx
/**
 * Incremental HRIS → merged MySQL ETL (users + clock-in attendance only).
 *
 * Thin CLI wrapper around runHrisToMergedIncremental().
 *
 * Usage:
 *   npx tsx scripts/merge-hris-incremental.ts
 *   HRIS_MERGE_SOURCE_DB=hrisdemo HRIS_MERGE_TARGET_DB=mergeddatabase-demo npx tsx scripts/merge-hris-incremental.ts
 *
 * Optional:
 *   HRIS_MERGE_SOURCE_TAG=hrisdemo          value stored in source_database column
 *   HRIS_MERGE_LOOKBACK_DAYS=90             first-run window when target is empty
 *   DATABASE_URL_SECONDARY_SYNC=mysql://... target DB write URL
 */
import { runHrisToMergedIncremental } from "../src/lib/sync/hris-to-merged-incremental";

async function main() {
  await runHrisToMergedIncremental({ verbose: true });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
