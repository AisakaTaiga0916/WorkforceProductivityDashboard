/**
 * Fix login for all accounts after a backup import:
 * - Reset portal + HRIS passwords to aci12345
 * - Ensure account_status ACTIVE
 * - Link merged_users to portal_accounts by username
 * - Sync HRIS profiles into existing portal rows
 *
 * Usage: npm run db:fix:logins
 */
import bcrypt from "bcryptjs";
import { canonicalProfileFromMerged, syncPortalProfile } from "../src/modules/platform/auth/sync-portal-profile";
import { prismaPrimary, prismaSecondary } from "../src/modules/platform/db/prisma";

const PASSWORD = process.env.RESET_ALL_LOGIN_PASSWORDS?.trim() || "aci12345";

async function main() {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const hrisHash = passwordHash.replace(/^\$2a\$/, "$2y$");

  const syncUrl = process.env.DATABASE_URL_SECONDARY_SYNC?.trim();
  if (!syncUrl) throw new Error("DATABASE_URL_SECONDARY_SYNC required");

  const prismaSecondarySync = new (await import("@prisma/client/secondary")).PrismaClient({
    datasources: { db: { url: syncUrl } },
  });

  const portalReset = await prismaPrimary.portalAccount.updateMany({
    data: { passwordHash, accountStatus: "ACTIVE" },
  });

  const mergedReset = await prismaSecondarySync.$executeRaw`
    UPDATE merged_users SET password_hash = ${hrisHash} WHERE is_active = 1
  `;

  let hrisReset = 0;
  try {
    hrisReset = await prismaSecondarySync.$executeRaw`
      UPDATE \`hris-dev\`.users u
      INNER JOIN merged_users mu ON mu.source_user_id = u.id
      SET u.password = ${hrisHash}
      WHERE mu.is_active = 1
    `;
  } catch (e) {
    console.warn("[fix-all-login-accounts] hris-dev.users skipped:", (e as Error).message);
  }

  type MergedRow = {
    source_user_id: bigint;
    username: string | null;
    name: string;
    email: string | null;
    role: string;
    company_name: string | null;
  };

  const mergedRows = await prismaSecondary.$queryRaw<MergedRow[]>`
    SELECT source_user_id, username, name, email, role, company_name
    FROM merged_users WHERE is_active = 1
  `;

  let linked = 0;
  let synced = 0;
  let failed = 0;

  for (const row of mergedRows) {
    const username = row.username?.trim().toLowerCase();
    if (!username) continue;

    const portal = await prismaPrimary.portalAccount.findFirst({
      where: { username: { equals: username, mode: "insensitive" } },
      select: { id: true },
    });
    if (!portal) continue;

    linked++;
    try {
      await syncPortalProfile(
        canonicalProfileFromMerged({
          sourceUserId: row.source_user_id,
          username: row.username,
          name: row.name,
          email: row.email,
          role: row.role,
          companyName: row.company_name,
        }),
        "hris",
      );
      synced++;
    } catch (e) {
      failed++;
      console.warn(`[fix-all-login-accounts] sync failed for ${username}:`, (e as Error).message);
    }
  }

  console.log(`Password for all accounts: ${PASSWORD}`);
  console.log(`  portal_accounts reset: ${portalReset.count}`);
  console.log(`  merged_users reset: ${mergedReset}`);
  console.log(`  hris-dev.users reset: ${hrisReset}`);
  console.log(`  HRIS username linked to portal: ${linked}`);
  console.log(`  HRIS profiles synced: ${synced} (failed: ${failed})`);
  console.log("Sign in with username or email + this password.");

  await prismaSecondarySync.$disconnect();
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
