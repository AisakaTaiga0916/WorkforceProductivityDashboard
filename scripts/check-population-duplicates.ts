#!/usr/bin/env npx tsx
/**
 * Audit merged HRIS population for duplicate keys across merge DB, portal, and auth.
 *
 * Usage: npx tsx scripts/check-population-duplicates.ts
 */
import { prismaAuth, prismaPrimary, prismaSecondary } from "../src/modules/platform/db/prisma";

const HRIS_TAG = process.env.HRIS_MERGE_SOURCE_TAG?.trim() || "hrisdemo";

type DupRow = { key_value: string; c: bigint };

function section(title: string) {
  console.log(`\n=== ${title} ===`);
}

function printDups(label: string, rows: DupRow[], limit = 10) {
  if (rows.length === 0) {
    console.log(`${label}: none`);
    return;
  }
  console.log(`${label}: ${rows.length} duplicate group(s)`);
  for (const row of rows.slice(0, limit)) {
    console.log(`  ${row.key_value} → ${row.c} rows`);
  }
  if (rows.length > limit) console.log(`  ... and ${rows.length - limit} more`);
}

async function checkMergedUsers() {
  section(`merged_users (tag: ${HRIS_TAG})`);

  const [total, active] = await Promise.all([
    prismaSecondary.$queryRaw<Array<{ c: bigint }>>`
      SELECT COUNT(*) AS c FROM merged_users WHERE source_database = ${HRIS_TAG}
    `,
    prismaSecondary.$queryRaw<Array<{ c: bigint }>>`
      SELECT COUNT(*) AS c FROM merged_users WHERE source_database = ${HRIS_TAG} AND is_active = 1
    `,
  ]);
  console.log(`Total: ${total[0]?.c ?? 0}, active: ${active[0]?.c ?? 0}`);

  const emailDups = await prismaSecondary.$queryRaw<DupRow[]>`
    SELECT LOWER(TRIM(email)) AS key_value, COUNT(*) AS c
    FROM merged_users
    WHERE source_database = ${HRIS_TAG}
      AND email IS NOT NULL AND TRIM(email) <> ''
    GROUP BY LOWER(TRIM(email))
    HAVING COUNT(*) > 1
    ORDER BY c DESC
  `;
  printDups("Duplicate emails", emailDups);

  const usernameDups = await prismaSecondary.$queryRaw<DupRow[]>`
    SELECT LOWER(TRIM(username)) AS key_value, COUNT(*) AS c
    FROM merged_users
    WHERE source_database = ${HRIS_TAG}
      AND username IS NOT NULL AND TRIM(username) <> ''
    GROUP BY LOWER(TRIM(username))
    HAVING COUNT(*) > 1
    ORDER BY c DESC
  `;
  printDups("Duplicate usernames", usernameDups);

  const employeeCodeDups = await prismaSecondary.$queryRaw<DupRow[]>`
    SELECT LOWER(TRIM(employee_code)) AS key_value, COUNT(*) AS c
    FROM merged_users
    WHERE source_database = ${HRIS_TAG}
      AND employee_code IS NOT NULL AND TRIM(employee_code) <> ''
    GROUP BY LOWER(TRIM(employee_code))
    HAVING COUNT(*) > 1
    ORDER BY c DESC
  `;
  printDups("Duplicate employee codes", employeeCodeDups);

  const sourceIdDups = await prismaSecondary.$queryRaw<DupRow[]>`
    SELECT CAST(source_user_id AS CHAR) AS key_value, COUNT(*) AS c
    FROM merged_users
    WHERE source_database = ${HRIS_TAG}
    GROUP BY source_user_id
    HAVING COUNT(*) > 1
  `;
  printDups("Duplicate source_user_id (should be impossible)", sourceIdDups);
}

async function checkPortalAccounts() {
  section("portal_accounts");

  const [total, linked] = await Promise.all([
    prismaPrimary.portalAccount.count(),
    prismaPrimary.portalAccount.count({ where: { mergedSourceUserId: { not: null } } }),
  ]);
  console.log(`Total: ${total}, HRIS-linked: ${linked}, unlinked: ${total - linked}`);

  const emailDups = await prismaPrimary.$queryRaw<DupRow[]>`
    SELECT LOWER(TRIM(email)) AS key_value, COUNT(*)::bigint AS c
    FROM portal_accounts
    GROUP BY LOWER(TRIM(email))
    HAVING COUNT(*) > 1
    ORDER BY c DESC
  `;
  printDups("Duplicate emails", emailDups);

  const usernameDups = await prismaPrimary.$queryRaw<DupRow[]>`
    SELECT LOWER(TRIM(username)) AS key_value, COUNT(*)::bigint AS c
    FROM portal_accounts
    WHERE username IS NOT NULL AND TRIM(username) <> ''
    GROUP BY LOWER(TRIM(username))
    HAVING COUNT(*) > 1
    ORDER BY c DESC
  `;
  printDups("Duplicate usernames", usernameDups);

  const mergedIdDups = await prismaPrimary.$queryRaw<DupRow[]>`
    SELECT merged_source_user_id::text AS key_value, COUNT(*)::bigint AS c
    FROM portal_accounts
    WHERE merged_source_user_id IS NOT NULL
    GROUP BY merged_source_user_id
    HAVING COUNT(*) > 1
    ORDER BY c DESC
  `;
  printDups("Duplicate merged_source_user_id", mergedIdDups);

  const authIdDups = await prismaPrimary.$queryRaw<DupRow[]>`
    SELECT auth_user_id AS key_value, COUNT(*)::bigint AS c
    FROM portal_accounts
    WHERE auth_user_id IS NOT NULL AND TRIM(auth_user_id) <> ''
    GROUP BY auth_user_id
    HAVING COUNT(*) > 1
    ORDER BY c DESC
  `;
  printDups("Duplicate auth_user_id", authIdDups);
}

async function checkAuthUsers() {
  section("auth_users");

  const total = await prismaAuth.user.count();
  console.log(`Total: ${total}`);

  const emailDups = await prismaAuth.$queryRaw<DupRow[]>`
    SELECT LOWER(TRIM(email)) AS key_value, COUNT(*)::bigint AS c
    FROM auth_users
    GROUP BY LOWER(TRIM(email))
    HAVING COUNT(*) > 1
    ORDER BY c DESC
  `;
  printDups("Duplicate emails", emailDups);

  const hrisIdDups = await prismaAuth.$queryRaw<DupRow[]>`
    SELECT hris_source_user_id::text AS key_value, COUNT(*)::bigint AS c
    FROM auth_users
    WHERE hris_source_user_id IS NOT NULL
    GROUP BY hris_source_user_id
    HAVING COUNT(*) > 1
    ORDER BY c DESC
  `;
  printDups("Duplicate hris_source_user_id", hrisIdDups);

  const portalIdDups = await prismaAuth.$queryRaw<DupRow[]>`
    SELECT portal_account_id AS key_value, COUNT(*)::bigint AS c
    FROM auth_users
    WHERE portal_account_id IS NOT NULL AND TRIM(portal_account_id) <> ''
    GROUP BY portal_account_id
    HAVING COUNT(*) > 1
    ORDER BY c DESC
  `;
  printDups("Duplicate portal_account_id", portalIdDups);
}

async function checkCrossDbLinkage() {
  section("cross-database linkage");

  const activeMerged = await prismaSecondary.$queryRaw<
    Array<{ source_user_id: bigint; email: string | null; username: string | null }>
  >`
    SELECT source_user_id, email, username
    FROM merged_users
    WHERE source_database = ${HRIS_TAG} AND is_active = 1
  `;

  const linkedPortals = await prismaPrimary.portalAccount.findMany({
    where: { mergedSourceUserId: { not: null } },
    select: {
      id: true,
      email: true,
      mergedSourceUserId: true,
    },
  });

  const portalByMergedId = new Map<string, typeof linkedPortals>();
  for (const portal of linkedPortals) {
    const key = portal.mergedSourceUserId!.toString();
    const list = portalByMergedId.get(key) ?? [];
    list.push(portal);
    portalByMergedId.set(key, list);
  }

  const mergedIds = new Set(activeMerged.map((m) => m.source_user_id.toString()));
  let mergedNoPortal = 0;
  for (const merged of activeMerged) {
    if (!portalByMergedId.has(merged.source_user_id.toString())) mergedNoPortal++;
  }
  console.log(`Active merged users without portal account: ${mergedNoPortal}`);

  let portalNoMerged = 0;
  const allMergedIds = new Set(
    (
      await prismaSecondary.$queryRaw<Array<{ source_user_id: bigint }>>`
        SELECT source_user_id FROM merged_users WHERE source_database = ${HRIS_TAG}
      `
    ).map((m) => m.source_user_id.toString()),
  );
  for (const portal of linkedPortals) {
    if (!allMergedIds.has(portal.mergedSourceUserId!.toString())) portalNoMerged++;
  }
  console.log(`Portal rows with missing merged_users row: ${portalNoMerged}`);

  const multiLink: Array<{ sourceUserId: string; count: number; emails: string[] }> = [];
  for (const [id, portals] of portalByMergedId) {
    if (portals.length > 1) {
      multiLink.push({
        sourceUserId: id,
        count: portals.length,
        emails: portals.map((p) => p.email),
      });
    }
  }
  if (multiLink.length === 0) {
    console.log("Merged users with multiple portal accounts: none");
  } else {
    console.log(`Merged users with multiple portal accounts: ${multiLink.length}`);
    for (const row of multiLink.slice(0, 10)) {
      console.log(`  source_user_id=${row.sourceUserId} portals=${row.count} emails=${row.emails.join(", ")}`);
    }
  }

  const mergedById = new Map(activeMerged.map((m) => [m.source_user_id.toString(), m]));
  const emailMismatch: Array<{ sourceUserId: string; portalEmail: string; mergedEmail: string }> = [];
  for (const portal of linkedPortals) {
    const merged = mergedById.get(portal.mergedSourceUserId!.toString());
    if (!merged?.email?.trim()) continue;
    const portalEmail = portal.email.trim().toLowerCase();
    const mergedEmail = merged.email.trim().toLowerCase();
    const fallback = merged.username?.trim()
      ? `${merged.username.trim().toLowerCase()}@hris.merged`
      : null;
    if (portalEmail !== mergedEmail && portalEmail !== fallback) {
      emailMismatch.push({
        sourceUserId: merged.source_user_id.toString(),
        portalEmail,
        mergedEmail,
      });
    }
  }
  if (emailMismatch.length === 0) {
    console.log("Linked portal/merged email mismatches: none");
  } else {
    console.log(`Linked portal/merged email mismatches: ${emailMismatch.length} (showing up to 10)`);
    for (const row of emailMismatch.slice(0, 10)) {
      console.log(`  id=${row.sourceUserId} portal=${row.portalEmail} merged=${row.mergedEmail}`);
    }
  }

  const emailToMergedIds = new Map<string, Set<string>>();
  for (const portal of linkedPortals) {
    const email = portal.email.trim().toLowerCase();
    const ids = emailToMergedIds.get(email) ?? new Set<string>();
    ids.add(portal.mergedSourceUserId!.toString());
    emailToMergedIds.set(email, ids);
  }
  const sameEmailDiffUser = [...emailToMergedIds.entries()].filter(([, ids]) => ids.size > 1);
  if (sameEmailDiffUser.length === 0) {
    console.log("Same portal email linked to different merged users: none");
  } else {
    console.log(`Same portal email linked to different merged users: ${sameEmailDiffUser.length}`);
    for (const [email, ids] of sameEmailDiffUser.slice(0, 10)) {
      console.log(`  ${email} merged_ids=[${[...ids].join(", ")}]`);
    }
  }

  const unlinkedPortals = await prismaPrimary.portalAccount.findMany({
    where: { mergedSourceUserId: null },
    select: { email: true, username: true, name: true },
  });
  const mergedEmails = new Set(
    activeMerged
      .map((m) => m.email?.trim().toLowerCase())
      .filter((e): e is string => Boolean(e)),
  );
  const mergedUsernames = new Set(
    activeMerged
      .map((m) => m.username?.trim().toLowerCase())
      .filter((u): u is string => Boolean(u)),
  );
  let emailOverlap = 0;
  let usernameOverlap = 0;
  const overlapSamples: Array<{ kind: string; email: string; username: string | null; name: string }> = [];
  for (const portal of unlinkedPortals) {
    const email = portal.email.trim().toLowerCase();
    const username = portal.username?.trim().toLowerCase() ?? null;
    if (mergedEmails.has(email)) {
      emailOverlap++;
      if (overlapSamples.length < 5) {
        overlapSamples.push({ kind: "email", email, username, name: portal.name });
      }
    }
    if (username && mergedUsernames.has(username)) {
      usernameOverlap++;
      if (overlapSamples.length < 5) {
        overlapSamples.push({ kind: "username", email, username, name: portal.name });
      }
    }
  }
  console.log(
    `Unlinked portal accounts overlapping HRIS merged email/username: email=${emailOverlap}, username=${usernameOverlap} (of ${unlinkedPortals.length} unlinked)`,
  );
  if (overlapSamples.length > 0) {
    for (const row of overlapSamples) {
      console.log(`  overlap by ${row.kind}: ${row.name} <${row.email}> username=${row.username ?? "—"}`);
    }
  }
}

async function checkAttendance() {
  section(`merged_attendance_clock_in (tag: ${HRIS_TAG})`);

  const total = await prismaSecondary.$queryRaw<Array<{ c: bigint }>>`
    SELECT COUNT(*) AS c FROM merged_attendance_clock_in WHERE source_database = ${HRIS_TAG}
  `;
  console.log(`Total rows: ${total[0]?.c ?? 0}`);

  const logIdDups = await prismaSecondary.$queryRaw<DupRow[]>`
    SELECT CAST(source_log_id AS CHAR) AS key_value, COUNT(*) AS c
    FROM merged_attendance_clock_in
    WHERE source_database = ${HRIS_TAG}
    GROUP BY source_log_id
    HAVING COUNT(*) > 1
  `;
  printDups("Duplicate source_log_id", logIdDups);

  const eventDups = await prismaSecondary.$queryRaw<DupRow[]>`
    SELECT CONCAT(source_user_id, '|', clock_in_at) AS key_value, COUNT(*) AS c
    FROM merged_attendance_clock_in
    WHERE source_database = ${HRIS_TAG}
    GROUP BY source_user_id, clock_in_at
    HAVING COUNT(*) > 1
    ORDER BY c DESC
    LIMIT 10
  `;
  printDups("Duplicate user+clock_in_at events", eventDups);
}

async function main() {
  console.log("Population duplicate audit");
  await checkMergedUsers();
  await checkPortalAccounts();
  await checkAuthUsers();
  await checkCrossDbLinkage();
  await checkAttendance();

  console.log("\nDone.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prismaSecondary.$disconnect();
    await prismaPrimary.$disconnect();
    await prismaAuth.$disconnect();
  });
