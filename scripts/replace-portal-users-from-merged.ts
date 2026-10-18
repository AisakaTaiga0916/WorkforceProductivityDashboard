/**
 * Replace ticketing_system (primary PostgreSQL) portal/auth users from
 * mergeddatabase (MySQL DATABASE_URL_SECONDARY).
 *
 * - Upserts every active HRIS merged_users row into portal_accounts + auth
 * - Marks every portal account not linked to an active HRIS merge user as LEGACY_CONFLICT
 * - Clears portal password_hash on HRIS-linked rows (credentials stay in merged_users)
 *
 * Usage:
 *   npx tsx scripts/replace-portal-users-from-merged.ts
 *   npx tsx scripts/replace-portal-users-from-merged.ts --apply
 */
import {
  canonicalProfileFromMerged,
  syncPortalProfile,
} from "../src/modules/platform/auth/sync-portal-profile";
import { resolveHrisSourceTags } from "../src/lib/merged-database-sources";
import { prismaAuth, prismaPrimary, prismaSecondary } from "../src/modules/platform/db/prisma";

type MergedRow = {
  source_user_id: bigint;
  source_database: string;
  username: string | null;
  name: string;
  email: string | null;
  role: string;
  company_name: string | null;
  position: string | null;
  department: string | null;
};

async function main() {
  const apply = process.argv.includes("--apply");
  const sourceTags = resolveHrisSourceTags();
  const tagList = sourceTags.map(() => "?").join(",");

  const mergedRows = await prismaSecondary.$queryRawUnsafe<MergedRow[]>(
    `
    SELECT source_user_id, source_database, username, name, email, role,
           company_name, position, department
    FROM merged_users
    WHERE is_active = 1 AND source_database IN (${tagList})
    ORDER BY source_user_id
    `,
    ...sourceTags,
  );

  console.log(
    `[replace-portal-users-from-merged] ${apply ? "APPLY" : "DRY-RUN"}`,
  );
  console.log(`  merge tags: ${sourceTags.join(", ")}`);
  console.log(`  active HRIS merged users: ${mergedRows.length}`);

  const linkedPortalIds = new Set<string>();
  let synced = 0;
  let failed = 0;

  for (const row of mergedRows) {
    if (!apply) {
      synced++;
      continue;
    }
    try {
      const result = await syncPortalProfile(
        canonicalProfileFromMerged({
          sourceUserId: row.source_user_id,
          username: row.username,
          name: row.name,
          email: row.email,
          role: row.role,
          companyName: row.company_name,
          position: row.position,
          department: row.department,
        }),
        "hris",
        { forceRoleRefresh: true },
      );
      linkedPortalIds.add(result.portalAccountId);
      // Ensure ACTIVE after sync
      await prismaPrimary.portalAccount.update({
        where: { id: result.portalAccountId },
        data: {
          accountStatus: "ACTIVE",
          mergedSourceUserId: row.source_user_id,
        },
      });
      synced++;
    } catch (e) {
      failed++;
      console.warn(
        `  fail source_user_id=${row.source_user_id} username=${row.username}:`,
        e instanceof Error ? e.message : e,
      );
    }
  }

  // Re-load linked ids after apply (dry-run: estimate from existing links)
  if (apply) {
    const linked = await prismaPrimary.portalAccount.findMany({
      where: {
        mergedSourceUserId: { in: mergedRows.map((r) => r.source_user_id) },
        accountStatus: { not: "LEGACY_CONFLICT" },
      },
      select: { id: true },
    });
    for (const p of linked) linkedPortalIds.add(p.id);
  } else {
    const linked = await prismaPrimary.portalAccount.findMany({
      where: { mergedSourceUserId: { not: null } },
      select: { id: true },
    });
    for (const p of linked) linkedPortalIds.add(p.id);
  }

  const allPortals = await prismaPrimary.portalAccount.findMany({
    select: {
      id: true,
      email: true,
      username: true,
      accountStatus: true,
      mergedSourceUserId: true,
      role: true,
    },
  });

  const toLegacy = allPortals.filter(
    (p) =>
      p.accountStatus !== "LEGACY_CONFLICT" &&
      !linkedPortalIds.has(p.id) &&
      // Keep pure customers that were never HRIS-linked only if they have no merge link
      // — user asked to replace ticketing users with merge users, so mark all unlinked.
      true,
  );

  let legacyMarked = 0;
  if (apply) {
    for (const portal of toLegacy) {
      await prismaPrimary.portalAccount.update({
        where: { id: portal.id },
        data: {
          accountStatus: "LEGACY_CONFLICT",
          username: null,
          // Keep email for audit; clear merge link so they can't collide
          mergedSourceUserId: null,
        },
      });
      legacyMarked++;
    }
  } else {
    legacyMarked = toLegacy.length;
  }

  const activeAfter = apply
    ? await prismaPrimary.portalAccount.count({ where: { accountStatus: "ACTIVE" } })
    : null;
  const linkedAfter = apply
    ? await prismaPrimary.portalAccount.count({
        where: { mergedSourceUserId: { not: null }, accountStatus: "ACTIVE" },
      })
    : null;

  console.log(`  portal profiles synced: ${synced}`);
  console.log(`  sync failures: ${failed}`);
  console.log(`  portal rows → LEGACY_CONFLICT: ${legacyMarked}`);
  if (apply) {
    console.log(`  ACTIVE portals after: ${activeAfter}`);
    console.log(`  ACTIVE+linked portals after: ${linkedAfter}`);
  } else {
    console.log("  (dry-run — re-run with --apply to write)");
  }
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
