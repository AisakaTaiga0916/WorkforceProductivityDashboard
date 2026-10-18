/**
 * Reconcile portal_accounts with merged_users (merge DB = source of truth).
 * - Resolves username conflicts on portal rows
 * - Links every active merged HRIS user via merged_source_user_id
 * - Marks portal-only duplicates as LEGACY_CONFLICT
 * - Clears portal password_hash on HRIS-linked rows (credentials live in merged_users)
 *
 * Usage: npm run db:reconcile:merged-users
 */
import {
  canonicalProfileFromMerged,
  syncPortalProfile,
} from "../src/modules/platform/auth/sync-portal-profile";
import { resolveHrisSourceTags } from "../src/lib/merged-database-sources";
import { prismaPrimary, prismaSecondary } from "../src/modules/platform/db/prisma";

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

function normEmail(v: string | null | undefined): string | null {
  const e = v?.trim().toLowerCase();
  return e || null;
}

function normUsername(v: string | null | undefined): string | null {
  const u = v?.trim().toLowerCase();
  return u || null;
}

async function mergedHasLogin(username: string | null, email: string | null): Promise<boolean> {
  if (username) {
    const rows = await prismaSecondary.$queryRaw<{ c: bigint }[]>`
      SELECT COUNT(*) AS c FROM merged_users
      WHERE is_active = 1 AND LOWER(username) = ${username}
    `;
    if (Number(rows[0]?.c ?? 0) > 0) return true;
  }
  if (email) {
    const rows = await prismaSecondary.$queryRaw<{ c: bigint }[]>`
      SELECT COUNT(*) AS c FROM merged_users
      WHERE is_active = 1 AND LOWER(email) = ${email}
    `;
    if (Number(rows[0]?.c ?? 0) > 0) return true;
  }
  return false;
}

async function main() {
  const sourceTags = resolveHrisSourceTags();
  const tagList = sourceTags.map(() => "?").join(",");
  const orderCases = sourceTags.map((_, i) => `WHEN ? THEN ${i}`).join("\n        ");
  const mergedRows = await prismaSecondary.$queryRawUnsafe<MergedRow[]>(
    `
    SELECT source_user_id, source_database, username, name, email, role, company_name, position, department
    FROM merged_users
    WHERE is_active = 1 AND source_database IN (${tagList})
    ORDER BY
      CASE source_database
        ${orderCases}
        ELSE 99
      END,
      source_user_id
    `,
    ...sourceTags,
    ...sourceTags,
  );

  let synced = 0;
  let conflictsCleared = 0;
  let legacyMarked = 0;
  const claimedPortalIds = new Set<string>();

  for (const row of mergedRows) {
    const username = normUsername(row.username);
    const email = normEmail(row.email);
    const sourceUserId = row.source_user_id;

    const bySourceId = await prismaPrimary.portalAccount.findFirst({
      where: { mergedSourceUserId: sourceUserId },
    });
    const byEmail = email
      ? await prismaPrimary.portalAccount.findFirst({
          where: { email: { equals: email, mode: "insensitive" } },
        })
      : null;
    const byUsername = username
      ? await prismaPrimary.portalAccount.findMany({
          where: { username: { equals: username, mode: "insensitive" } },
          orderBy: { createdAt: "asc" },
        })
      : [];

    const canonical =
      bySourceId ?? byEmail ?? (byUsername.length > 0 ? byUsername[0] : null);

    for (const dup of byUsername) {
      if (canonical && dup.id === canonical.id) continue;
      await prismaPrimary.portalAccount.update({
        where: { id: dup.id },
        data: {
          username: null,
          accountStatus: "LEGACY_CONFLICT",
          mergedSourceUserId: null,
        },
      });
      conflictsCleared++;
    }

    await syncPortalProfile(
      canonicalProfileFromMerged({
        sourceUserId,
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
    synced++;

    const linked = await prismaPrimary.portalAccount.findFirst({
      where: {
        OR: [
          { mergedSourceUserId: sourceUserId },
          ...(username ? [{ username: { equals: username, mode: "insensitive" as const } }] : []),
        ],
      },
      select: { id: true },
    });
    if (linked) claimedPortalIds.add(linked.id);
  }

  // portal_accounts.password_hash is the only credential store; never cleared here.

  const unlinkedPortals = await prismaPrimary.portalAccount.findMany({
    where: {
      mergedSourceUserId: null,
      accountStatus: { not: "LEGACY_CONFLICT" },
    },
    select: { id: true, username: true, email: true },
  });

  for (const portal of unlinkedPortals) {
    if (claimedPortalIds.has(portal.id)) continue;
    const hit = await mergedHasLogin(normUsername(portal.username), normEmail(portal.email));
    if (hit) {
      await prismaPrimary.portalAccount.update({
        where: { id: portal.id },
        data: { username: null, accountStatus: "LEGACY_CONFLICT" },
      });
      legacyMarked++;
    }
  }

  console.log("[reconcile-portal-with-merged-users] done");
  console.log(`  source tags: ${sourceTags.join(", ")}`);
  console.log(`  merged users: ${mergedRows.length}`);
  console.log(`  portal profiles synced: ${synced}`);
  console.log(`  username conflicts cleared: ${conflictsCleared}`);
  console.log(`  portal-only rows marked LEGACY_CONFLICT: ${legacyMarked}`);
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
