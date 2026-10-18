#!/usr/bin/env npx tsx
/**
 * Sync HRIS roles → merged_users → portal_accounts + auth_users.
 *
 * Phase 1: Refresh role/position/department from HRIS source (hrisdemo) into merged_users.
 * Phase 2: Apply mapped portal roles from merged_users to linked portal + auth rows.
 *
 * Usage:
 *   npm run db:sync:merged-roles
 */
import { PrismaClient as PrismaClientSecondary } from "@prisma/client/secondary";
import {
  canonicalProfileFromMerged,
  syncPortalProfile,
} from "../src/modules/platform/auth/sync-portal-profile";
import { mapHrisToPortalRole } from "../src/modules/platform/auth/role-mapping";
import { prismaAuth, prismaPrimary, prismaSecondary } from "../src/modules/platform/db/prisma";
import { normalizePortalRole } from "../src/lib/staff-role";
import {
  bootstrapMysqlUrl,
  parseMysqlDatabaseName,
} from "./ensure-merged-task-kpi-tables";

type MergedRoleRow = {
  source_user_id: bigint;
  username: string | null;
  name: string;
  email: string | null;
  role: string;
  company_name: string | null;
  company_id: bigint | null;
  position: string | null;
  department: string | null;
};

function env(name: string, fallback: string): string {
  const v = process.env[name]?.trim();
  return v || fallback;
}

function sqlId(name: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(name)) {
    throw new Error(`Invalid SQL identifier: ${name}`);
  }
  return `\`${name}\``;
}

function resolveSourceDb(): string {
  return (
    process.env.HRIS_LIVE_SOURCE_DB?.trim() ||
    process.env.HRIS_MERGE_SOURCE_DB?.trim() ||
    "hris-dev"
  );
}

function resolveTargetDb(): string {
  return parseMysqlDatabaseName(
    process.env.DATABASE_URL_SECONDARY_SYNC?.trim() ||
      process.env.DATABASE_URL_SECONDARY?.trim() ||
      "mysql://root@localhost:3306/mergeddatabase-dev",
  ) ?? "mergeddatabase-dev";
}

function resolveSourceTag(): string {
  return (
    process.env.HRIS_MERGE_SOURCE_TAG?.trim() ||
    process.env.HRIS_MERGE_SOURCE_DB?.trim() ||
    "hrisdemo"
  );
}

async function schemaExists(db: PrismaClientSecondary, schema: string): Promise<boolean> {
  const rows = await db.$queryRawUnsafe<Array<{ n: bigint | number }>>(
    `SELECT COUNT(*) AS n FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?`,
    schema,
  );
  return Number(rows[0]?.n ?? 0) > 0;
}

async function refreshMergedRolesFromHris(
  db: PrismaClientSecondary,
  sourceDb: string,
  targetDb: string,
  sourceTag: string,
): Promise<number> {
  const source = sqlId(sourceDb);
  const target = sqlId(targetDb);

  const result = await db.$executeRawUnsafe(`
    UPDATE ${target}.merged_users mu
    INNER JOIN ${source}.users u ON u.id = mu.source_user_id
    LEFT JOIN ${source}.companies c ON c.id = u.company_id
    SET
      mu.role = u.role,
      mu.department = u.department,
      mu.position = u.position,
      mu.is_active = u.is_active,
      mu.company_id = u.company_id,
      mu.company_name = c.name,
      mu.updated_at = u.updated_at,
      mu.merged_at = CURRENT_TIMESTAMP
    WHERE mu.source_database = '${sourceTag}'
  `);

  return Number(result);
}

async function syncPortalRolesFromMerged(sourceTag: string) {
  const rows = await prismaSecondary.$queryRaw<MergedRoleRow[]>`
    SELECT
      source_user_id,
      username,
      name,
      email,
      role,
      company_name,
      company_id,
      position,
      department
    FROM merged_users
    WHERE is_active = 1 AND source_database = ${sourceTag}
    ORDER BY source_user_id
  `;

  let synced = 0;
  let failed = 0;
  let roleChanges = 0;

  for (const row of rows) {
    try {
      const before = await prismaPrimary.portalAccount.findFirst({
        where: { mergedSourceUserId: row.source_user_id },
        select: { role: true, headPrivileges: true },
      });

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

      if (before) {
        const expected = mapHrisToPortalRole({
          hrisRole: row.role,
          position: row.position,
          department: row.department,
        });
        const beforeRole = normalizePortalRole(before.role) ?? before.role;
        if (beforeRole !== expected.portalRole || before.headPrivileges !== expected.headPrivileges) {
          roleChanges++;
        }
      }
    } catch (e) {
      failed++;
      console.error(`[sync-merged-roles] failed source_user_id=${row.source_user_id}`, e);
    }
  }

  return { total: rows.length, synced, failed, roleChanges };
}

async function countRoleMismatches(sourceTag: string): Promise<number> {
  const merged = await prismaSecondary.$queryRaw<
    Array<{ source_user_id: bigint; role: string; position: string | null; department: string | null }>
  >`
    SELECT source_user_id, role, position, department
    FROM merged_users
    WHERE is_active = 1 AND source_database = ${sourceTag}
  `;

  let mismatches = 0;
  for (const row of merged) {
    const portal = await prismaPrimary.portalAccount.findFirst({
      where: { mergedSourceUserId: row.source_user_id },
      select: { role: true, headPrivileges: true },
    });
    if (!portal) continue;

    const mapped = mapHrisToPortalRole({
      hrisRole: row.role,
      position: row.position,
      department: row.department,
    });
    const portalRole = normalizePortalRole(portal.role) ?? portal.role;
    if (portalRole !== mapped.portalRole || portal.headPrivileges !== mapped.headPrivileges) {
      mismatches++;
    }
  }
  return mismatches;
}

async function printRoleSummary(sourceTag: string) {
  const [mergedRoles, portalRoles] = await Promise.all([
    prismaSecondary.$queryRaw<Array<{ role: string; c: bigint }>>`
      SELECT role, COUNT(*) AS c
      FROM merged_users
      WHERE is_active = 1 AND source_database = ${sourceTag}
      GROUP BY role
      ORDER BY c DESC
    `,
    prismaPrimary.portalAccount.groupBy({
      by: ["role"],
      where: { mergedSourceUserId: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { role: "desc" } },
    }),
  ]);

  console.log("\nMerged HRIS roles:");
  for (const row of mergedRoles) {
    console.log(`  ${row.role}: ${row.c}`);
  }

  console.log("\nLinked portal roles:");
  for (const row of portalRoles) {
    console.log(`  ${row.role}: ${row._count._all}`);
  }
}

async function main() {
  const sourceDb = resolveSourceDb();
  const targetDb = resolveTargetDb();
  const sourceTag = resolveSourceTag();
  const writeUrl = bootstrapMysqlUrl(
    process.env.DATABASE_URL_SECONDARY_SYNC?.trim() ||
      process.env.DATABASE_URL_SECONDARY?.trim() ||
      `mysql://root@localhost:3306/${targetDb}`,
  );

  const db = new PrismaClientSecondary({ datasources: { db: { url: writeUrl } } });
  await db.$connect();

  try {
    console.log(`Role sync: ${sourceDb} → ${targetDb} (tag: ${sourceTag})`);

    if (await schemaExists(db, sourceDb)) {
      // Only refresh rows whose provenance tag matches the live schema we are reading.
      const refreshTag = sourceDb;
      const mergedUpdated = await refreshMergedRolesFromHris(db, sourceDb, targetDb, refreshTag);
      console.log(
        `Merged users refreshed from HRIS (${sourceDb} → tag ${refreshTag}): ${mergedUpdated} rows affected`,
      );
    } else {
      console.warn(
        `[sync-merged-roles] source schema "${sourceDb}" not found — skipping live HRIS refresh; syncing portal from existing merged_users.`,
      );
    }

    await prismaSecondary.$connect();
    // Portal sync still uses HRIS_MERGE_SOURCE_TAG (often hrisdemo for demo merges).
    const portal = await syncPortalRolesFromMerged(sourceTag);
    console.log(
      `[sync-merged-roles] portal total=${portal.total} synced=${portal.synced} failed=${portal.failed} roleChanges=${portal.roleChanges}`,
    );

    await printRoleSummary(sourceTag);

    const mismatches = await countRoleMismatches(sourceTag);
    if (mismatches > 0) {
      console.warn(`\nWarning: ${mismatches} linked portal role mismatch(es) remain.`);
      process.exitCode = 1;
    } else {
      console.log("\nAll linked portal roles match merged HRIS mapping.");
    }
  } finally {
    await db.$disconnect();
    await prismaSecondary.$disconnect();
    await prismaPrimary.$disconnect();
    await prismaAuth.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
