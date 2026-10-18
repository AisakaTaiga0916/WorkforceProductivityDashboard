#!/usr/bin/env npx tsx
/**
 * Migrate historical KPI snapshot + user-average data into the new
 * merged_user_efficiency_breakdowns tables.
 *
 * Usage:
 *   npx tsx scripts/migrate-kpi-to-efficiency-breakdowns.ts           # dry-run
 *   npx tsx scripts/migrate-kpi-to-efficiency-breakdowns.ts --apply
 */
import { runMigrateKpiToEfficiencyBreakdowns } from "../src/modules/tasks/efficiency/migrate-kpi-to-efficiency";
import { prismaPrimary } from "../src/modules/platform/db/prisma";

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(
    apply
      ? "=== APPLY migrate old KPI → MySQL efficiency breakdowns ==="
      : "=== DRY RUN migrate old KPI → MySQL efficiency breakdowns ===",
  );

  const result = await runMigrateKpiToEfficiencyBreakdowns({
    dryRun: !apply,
    deriveRollups: !process.argv.includes("--no-rollups"),
    includeLifetime: !process.argv.includes("--no-lifetime"),
  });
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((e) => {
    console.error("Migration failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prismaPrimary.$disconnect();
  });
