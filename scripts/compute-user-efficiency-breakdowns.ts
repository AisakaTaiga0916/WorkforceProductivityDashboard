#!/usr/bin/env npx tsx
/**
 * Compute / refresh persistent user efficiency breakdowns in mergedatabase.
 *
 * Usage:
 *   npx tsx scripts/compute-user-efficiency-breakdowns.ts
 *   npx tsx scripts/compute-user-efficiency-breakdowns.ts --apply
 *   npx tsx scripts/compute-user-efficiency-breakdowns.ts --apply --freq MONTHLY,WEEKLY --lookback 4
 *
 * Default is dry-run. Pass --apply to write.
 */
import {
  runComputeUserEfficiencyBreakdowns,
  type EfficiencyFrequency,
} from "../src/modules/tasks/efficiency/user-efficiency-breakdown";
import { prismaPrimary } from "../src/modules/platform/db/prisma";

function parseFrequencies(): EfficiencyFrequency[] | undefined {
  const i = process.argv.indexOf("--freq");
  if (i < 0 || !process.argv[i + 1]) return undefined;
  const parts = process.argv[i + 1]
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  const allowed = new Set(["DAILY", "WEEKLY", "MONTHLY", "QUARTERLY"]);
  const out = parts.filter((p): p is EfficiencyFrequency => allowed.has(p));
  return out.length > 0 ? out : undefined;
}

function parseLookback(): number | undefined {
  const i = process.argv.indexOf("--lookback");
  if (i < 0 || !process.argv[i + 1]) return undefined;
  const n = Number(process.argv[i + 1]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const dryRun = !apply;
  console.log(
    dryRun
      ? "=== DRY RUN user efficiency breakdowns ==="
      : "=== APPLY user efficiency breakdowns ===",
  );

  const result = await runComputeUserEfficiencyBreakdowns({
    dryRun,
    frequencies: parseFrequencies(),
    lookbackPeriods: parseLookback(),
  });
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((e) => {
    console.error("Compute failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prismaPrimary.$disconnect();
  });
