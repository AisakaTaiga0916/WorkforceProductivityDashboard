/**
 * Batch sync merged_users (HRIS) → Auth DB → Primary portal_accounts.
 * Safe to run on a schedule (cron / PM2 / GitHub Action).
 *
 * Usage: npm run db:sync:hris-portal
 */
import {
  canonicalProfileFromMerged,
  syncPortalProfile,
} from "../src/modules/platform/auth/sync-portal-profile";
import { MERGED_SOURCE_DATABASE } from "../src/lib/merged-database-sources";
import { prismaAuth, prismaSecondary } from "../src/modules/platform/db/prisma";

function resolveSourceTag(): string {
  return (
    process.env.HRIS_MERGE_SOURCE_TAG?.trim() ||
    process.env.HRIS_MERGE_SOURCE_DB?.trim() ||
    MERGED_SOURCE_DATABASE.HRIS_DEMO
  );
}

type MergedRow = {
  source_user_id: bigint;
  username: string | null;
  name: string;
  email: string | null;
  role: string;
  company_name: string | null;
  company_id: bigint | null;
  position: string | null;
  department: string | null;
  updated_at: Date | null;
};

async function main() {
  const sourceTag = resolveSourceTag();
  const rows = await prismaSecondary.$queryRaw<MergedRow[]>`
    SELECT
      source_user_id,
      username,
      name,
      email,
      role,
      company_name,
      company_id,
      position,
      department,
      updated_at
    FROM merged_users
    WHERE is_active = 1 AND source_database = ${sourceTag}
    ORDER BY source_user_id
  `;

  let synced = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      const profile = canonicalProfileFromMerged({
        sourceUserId: row.source_user_id,
        username: row.username,
        name: row.name,
        email: row.email,
        role: row.role,
        companyName: row.company_name,
        companyId: row.company_id,
        position: row.position,
        department: row.department,
      });
      await syncPortalProfile(profile, "hris", { forceRoleRefresh: true });
      synced++;
    } catch (e) {
      failed++;
      console.error(`[sync-hris-portal] failed source_user_id=${row.source_user_id}`, e);
    }
  }

  console.log(`[sync-hris-portal] source=${sourceTag} total=${rows.length} synced=${synced} failed=${failed}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prismaAuth.$disconnect();
    await prismaSecondary.$disconnect();
  });
