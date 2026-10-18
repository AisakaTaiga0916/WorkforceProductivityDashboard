#!/usr/bin/env npx tsx
/**
 * Pull current clock-in attendance from the live HRIS MySQL database into
 * mergedatabase-demo.merged_attendance_clock_in (idempotent).
 *
 * Usage:
 *   npx tsx scripts/sync-hris-clockins.ts
 *   HRIS_LIVE_SOURCE_DB=hris npx tsx scripts/sync-hris-clockins.ts
 */
import { runHrisAttendanceSync } from "../src/modules/platform/auth/hris-attendance-sync";
import { prismaSecondary } from "../src/modules/platform/db/prisma";

async function main() {
  const result = await runHrisAttendanceSync();
  console.log(
    `[sync-hris-clockins] source=${result.sourceDb} since=${result.since} upserted=${result.upserted} duration=${result.durationMs}ms${
      result.skipped ? ` skipped=${result.skipped}` : ""
    }`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prismaSecondary.$disconnect();
  });
