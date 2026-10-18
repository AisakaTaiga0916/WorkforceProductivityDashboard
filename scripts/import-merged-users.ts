/**
 * Import users from the merged / HRIS dump into the main database (`portal_accounts`).
 * One-way and batch: the dump is read once, then disconnected.
 *
 * Usage:
 *   npm run db:import:merged-users -- --dry-run
 *   npm run db:import:merged-users
 *
 * Flags:
 *   --dry-run               Plan only; no writes.
 *   --source-url=<mysql>    Dump database (default MERGED_IMPORT_DATABASE_URL, then secondary URLs).
 *   --include-non-hris      Also import non-HRIS rows (e.g. portal_ticketing copies).
 *   --overwrite-passwords   Replace existing main-DB password hashes with the dump's.
 *   --overwrite-company     Replace existing company assignments with the dump's.
 */
import { importMergedUsers, readMergedDump } from "../src/modules/platform/auth/merged-user-import";
import { prismaPrimary } from "../src/modules/platform/db/prisma";

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function flagValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

async function main() {
  const rows = await readMergedDump(flagValue("source-url"));
  console.log(`[import] read ${rows.length} merged_users rows from dump`);
  const summary = await importMergedUsers(rows, {
    dryRun: flag("dry-run"),
    includeNonHrisRows: flag("include-non-hris"),
    overwritePasswords: flag("overwrite-passwords"),
    overwriteCompany: flag("overwrite-company"),
    log: (m) => console.log(m),
  });
  console.log(JSON.stringify(summary, null, 2));
  if (summary.errors.length > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prismaPrimary.$disconnect();
  });
