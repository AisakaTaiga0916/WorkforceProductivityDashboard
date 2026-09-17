import bcrypt from "bcryptjs";
import { PrismaClient as PrismaClientSecondary } from "@prisma/client/secondary";
import { prismaSecondary, withPoolLimit } from "@/lib/prisma";
import { resolveHrisSourceTags } from "@/lib/merged-database-sources";

import type { PortalRole } from "@/lib/staff-role";
import { mapHrisToPortalRole } from "@/lib/auth/role-mapping";

export type MergedAuthUser = {
  sourceUserId: bigint;
  sourceDatabase: string;
  employeeCode: string | null;
  username: string | null;
  passwordHash: string;
  name: string;
  email: string | null;
  role: string;
  companyName: string | null;
  isActive: boolean;
};

type MergedUserRow = {
  source_user_id: bigint;
  source_database: string;
  employee_code: string | null;
  username: string | null;
  password_hash: string | null;
  name: string;
  email: string | null;
  role: string;
  company_name: string | null;
  is_active: number | boolean;
};

/** Cached after first denied SELECT on live HRIS.users (e.g. local merge_app). */
let liveHrisUsersJoinAvailable: boolean | null = null;
let resolvedLiveHrisDb: string | null = null;
let privilegedSecondary: PrismaClientSecondary | null | undefined;

function isLiveHrisAccessError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error ?? "");
  return (
    msg.includes("1142") ||
    msg.includes("1049") ||
    /SELECT command denied/i.test(msg) ||
    /TABLEACCESS_DENIED/i.test(msg) ||
    /Unknown database/i.test(msg) ||
    /doesn't exist/i.test(msg)
  );
}

function markLiveHrisJoinUnavailable(error: unknown): void {
  if (liveHrisUsersJoinAvailable === false) return;
  liveHrisUsersJoinAvailable = false;
  console.warn(
    "[merged-credentials] live HRIS.users join unavailable on merge app user; falling back",
    error instanceof Error ? error.message : error,
  );
}

/**
 * Prefer DATABASE_URL_SECONDARY_SYNC for live HRIS.users reads when merge_app
 * lacks cross-schema SELECT (common local setup).
 */
function liveHrisPrisma(): PrismaClientSecondary {
  const syncUrl = process.env.DATABASE_URL_SECONDARY_SYNC?.trim();
  if (!syncUrl) return prismaSecondary;
  if (privilegedSecondary === undefined) {
    try {
      privilegedSecondary = new PrismaClientSecondary({
        log: ["error"],
        datasources: { db: { url: withPoolLimit(syncUrl, 5) } },
      });
    } catch (e) {
      console.warn("[merged-credentials] could not open SECONDARY_SYNC client", e);
      privilegedSecondary = null;
    }
  }
  return privilegedSecondary ?? prismaSecondary;
}

async function queryMergedUserRows(
  sqlWithLiveJoin: string,
  sqlMergedOnly: string,
  paramsWithJoin: unknown[],
  paramsMergedOnly: unknown[],
): Promise<MergedUserRow[]> {
  if (liveHrisUsersJoinAvailable === false) {
    return prismaSecondary.$queryRawUnsafe<MergedUserRow[]>(sqlMergedOnly, ...paramsMergedOnly);
  }

  // Try privileged sync client first (can often read live HRIS), then merge_app.
  const clients: PrismaClientSecondary[] = [liveHrisPrisma()];
  if (clients[0] !== prismaSecondary) clients.push(prismaSecondary);

  let lastError: unknown;
  for (const client of clients) {
    try {
      const rows = await client.$queryRawUnsafe<MergedUserRow[]>(
        sqlWithLiveJoin,
        ...paramsWithJoin,
      );
      liveHrisUsersJoinAvailable = true;
      return rows;
    } catch (error) {
      lastError = error;
      if (!isLiveHrisAccessError(error)) throw error;
    }
  }

  markLiveHrisJoinUnavailable(lastError);
  return prismaSecondary.$queryRawUnsafe<MergedUserRow[]>(sqlMergedOnly, ...paramsMergedOnly);
}

function mapRow(row: MergedUserRow): MergedAuthUser | null {
  if (!row.password_hash) return null;
  return {
    sourceUserId: row.source_user_id,
    sourceDatabase: row.source_database,
    employeeCode: row.employee_code,
    username: row.username,
    passwordHash: row.password_hash,
    name: row.name,
    email: row.email,
    role: row.role,
    companyName: row.company_name,
    isActive: Boolean(row.is_active),
  };
}

/** Live HRIS MySQL schema used for credential truth (same server as merge DB). */
export function resolveLiveHrisDb(): string {
  const name = process.env.HRIS_LIVE_SOURCE_DB?.trim() || "hris-dev";
  if (!/^[A-Za-z0-9_-]+$/.test(name)) {
    throw new Error(`Invalid HRIS_LIVE_SOURCE_DB: ${name}`);
  }
  return name;
}

/**
 * Resolve an existing live HRIS schema. Defaults try hris-dev → hrisdemo → hris
 * so local demos work without requiring HRIS_LIVE_SOURCE_DB.
 */
export async function resolveLiveHrisDbAvailable(): Promise<string> {
  if (resolvedLiveHrisDb) return resolvedLiveHrisDb;
  const preferred = resolveLiveHrisDb();
  const candidates = [preferred, "hris-dev", "hrisdemo", "hris"].filter(
    (v, i, arr) => arr.indexOf(v) === i,
  );

  const client = liveHrisPrisma();
  for (const db of candidates) {
    try {
      const rows = await client.$queryRawUnsafe<Array<{ n: bigint | number }>>(
        `SELECT COUNT(*) AS n FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?`,
        db,
      );
      if (Number(rows[0]?.n ?? 0) > 0) {
        resolvedLiveHrisDb = db;
        return db;
      }
    } catch {
      /* try next */
    }
  }
  // Do not cache a miss — schemas may appear later (or env may change) in long-lived PM2.
  return preferred;
}

function isHrisTaggedSource(sourceDatabase: string): boolean {
  return resolveHrisSourceTags().includes(sourceDatabase);
}

/** Laravel/Hris bcrypt hashes use $2y$; bcryptjs may emit $2a$ / $2b$. */
export function normalizeBcryptHash(hash: string): string {
  if (hash.startsWith("$2y$")) return `$2a$${hash.slice(4)}`;
  if (hash.startsWith("$2b$")) return `$2a$${hash.slice(4)}`;
  return hash;
}

/** Store hashes in Laravel-compatible $2y$ form. */
export function toLaravelBcryptHash(hash: string): string {
  if (hash.startsWith("$2a$") || hash.startsWith("$2b$")) {
    return `$2y$${hash.slice(4)}`;
  }
  return hash;
}

export async function verifyMergedPassword(
  passwordHash: string,
  password: string,
): Promise<boolean> {
  if (!passwordHash || !password) return false;
  try {
    return await bcrypt.compare(password, normalizeBcryptHash(passwordHash));
  } catch {
    return false;
  }
}

/** Read live HRIS users.password when the live schema matches the merged source. */
export async function fetchLiveHrisPassword(
  sourceUserId: bigint,
  sourceDatabase?: string | null,
): Promise<string | null> {
  const db = await resolveLiveHrisDbAvailable();
  if (sourceDatabase?.trim() && sourceDatabase.trim() !== db) {
    // e.g. merged row is hrisdemo but only hris-dev exists locally — use merged hash.
    return null;
  }
  const clients: PrismaClientSecondary[] = [liveHrisPrisma()];
  if (clients[0] !== prismaSecondary) clients.push(prismaSecondary);

  for (const client of clients) {
    try {
      const rows = await client.$queryRawUnsafe<Array<{ password: string | null }>>(
        `SELECT password FROM \`${db}\`.users WHERE id = ? LIMIT 1`,
        sourceUserId,
      );
      liveHrisUsersJoinAvailable = true;
      const pw = rows[0]?.password?.trim();
      return pw || null;
    } catch (e) {
      if (!isLiveHrisAccessError(e)) {
        console.warn("[merged-credentials] live HRIS password lookup failed", e);
        return null;
      }
    }
  }
  markLiveHrisJoinUnavailable(new Error(`no client can SELECT ${db}.users`));
  return null;
}

/** Keep merged_users.password_hash aligned with the hash that just authenticated. */
export async function healMergedPasswordHash(
  sourceUserId: bigint,
  passwordHash: string,
): Promise<void> {
  const hash = toLaravelBcryptHash(passwordHash);
  try {
    await prismaSecondary.$executeRaw`
      UPDATE merged_users
      SET password_hash = ${hash}, updated_at = CURRENT_TIMESTAMP
      WHERE source_user_id = ${sourceUserId}
        AND (password_hash IS NULL OR password_hash <> ${hash})
    `;
  } catch (e) {
    console.warn("[merged-credentials] healMergedPasswordHash failed", e);
  }
}

/**
 * Verify password for a merged user. Prefers live HRIS hash only when the live
 * schema matches the row's source_database. Otherwise uses merged_users.password_hash.
 */
export async function verifyMergedUserPassword(
  merged: MergedAuthUser,
  password: string,
): Promise<boolean> {
  if (!password) return false;

  if (isHrisTaggedSource(merged.sourceDatabase)) {
    const liveHash = await fetchLiveHrisPassword(merged.sourceUserId, merged.sourceDatabase);
    if (liveHash) {
      const liveOk = await verifyMergedPassword(liveHash, password);
      if (liveOk) {
        if (liveHash !== merged.passwordHash) {
          await healMergedPasswordHash(merged.sourceUserId, liveHash);
        }
        return true;
      }
      // Matching live schema rejected — do not fall through to a drifted merged hash.
      return false;
    }
  }

  return verifyMergedPassword(merged.passwordHash, password);
}

/**
 * Force-copy passwords (and basic identity fields) from live HRIS → merged_users.
 * Safe to call periodically; idempotent.
 */
export async function syncHrisPasswordsIntoMerged(): Promise<{ updated: number }> {
  const db = await resolveLiveHrisDbAvailable();
  const tags = resolveHrisSourceTags();
  const tagList = tags.map(() => "?").join(",");
  const client = liveHrisPrisma();
  const updated = await client.$executeRawUnsafe(
    `
    UPDATE merged_users m
    INNER JOIN \`${db}\`.users h ON h.id = m.source_user_id
    SET
      m.password_hash = h.password,
      m.username = COALESCE(NULLIF(TRIM(h.username), ''), m.username),
      m.email = COALESCE(NULLIF(TRIM(h.email), ''), m.email),
      m.name = COALESCE(NULLIF(TRIM(h.name), ''), m.name),
      m.is_active = IF(h.is_active IS NULL, m.is_active, IF(h.is_active, 1, 0)),
      m.updated_at = CURRENT_TIMESTAMP
    WHERE m.source_database IN (${tagList})
      AND h.password IS NOT NULL
      AND TRIM(h.password) <> ''
      AND (
        m.password_hash IS NULL
        OR m.password_hash <> h.password
      )
    `,
    ...tags,
  );

  await prismaSecondary.$executeRawUnsafe(
    `
    UPDATE merged_users pt
    INNER JOIN merged_users h
      ON h.source_database IN (${tagList})
     AND h.is_active = 1
     AND h.username IS NOT NULL
     AND TRIM(h.username) <> ''
     AND LOWER(h.username) = LOWER(pt.username)
    SET pt.is_active = 0, pt.updated_at = CURRENT_TIMESTAMP
    WHERE pt.source_database = 'portal_ticketing'
      AND pt.is_active = 1
    `,
    ...tags,
  );

  return { updated: Number(updated) };
}

/**
 * HRIS merged_users login lookup: username, email, or employee_code (case-insensitive).
 * Uses raw SQL because MySQL Prisma client does not support `mode: "insensitive"`.
 *
 * Prefer HRIS credential rows over portal_ticketing duplicates that share the
 * same username/email. For HRIS-tagged rows, prefer live HRIS.users.password
 * when readable; otherwise use merged_users.password_hash.
 */
export async function findMergedUserByLogin(loginId: string): Promise<MergedAuthUser | null> {
  const trimmed = loginId.trim();
  if (!trimmed) return null;
  const needle = trimmed.toLowerCase();
  const hrisTags = resolveHrisSourceTags();
  const liveDb = await resolveLiveHrisDbAvailable();
  const tagList = hrisTags.map(() => "?").join(",");

  const rows = await queryMergedUserRows(
    `
    SELECT
      m.source_user_id,
      m.source_database,
      m.employee_code,
      m.username,
      COALESCE(NULLIF(TRIM(h.password), ''), m.password_hash) AS password_hash,
      m.name,
      m.email,
      m.role,
      m.company_name,
      m.is_active
    FROM merged_users m
    LEFT JOIN \`${liveDb}\`.users h
      ON h.id = m.source_user_id
     AND m.source_database = ?
    WHERE m.is_active = 1
      AND (
        LOWER(m.username) = ?
        OR LOWER(m.email) = ?
        OR LOWER(m.employee_code) = ?
      )
    ORDER BY
      CASE WHEN m.source_database = ? THEN 0 ELSE 1 END ASC,
      CASE WHEN m.source_database IN (${tagList}) THEN 0 ELSE 1 END ASC,
      CASE WHEN COALESCE(NULLIF(TRIM(h.password), ''), m.password_hash) IS NOT NULL
            AND TRIM(COALESCE(NULLIF(TRIM(h.password), ''), m.password_hash)) <> '' THEN 0 ELSE 1 END ASC,
      m.source_user_id ASC
    LIMIT 1
    `,
    `
    SELECT
      m.source_user_id,
      m.source_database,
      m.employee_code,
      m.username,
      m.password_hash,
      m.name,
      m.email,
      m.role,
      m.company_name,
      m.is_active
    FROM merged_users m
    WHERE m.is_active = 1
      AND (
        LOWER(m.username) = ?
        OR LOWER(m.email) = ?
        OR LOWER(m.employee_code) = ?
      )
    ORDER BY
      CASE WHEN m.source_database = ? THEN 0 ELSE 1 END ASC,
      CASE WHEN m.source_database IN (${tagList}) THEN 0 ELSE 1 END ASC,
      CASE WHEN m.password_hash IS NOT NULL AND TRIM(m.password_hash) <> '' THEN 0 ELSE 1 END ASC,
      m.source_user_id ASC
    LIMIT 1
    `,
    [liveDb, needle, needle, needle, liveDb, ...hrisTags],
    [needle, needle, needle, liveDb, ...hrisTags],
  );

  const row = rows[0];
  if (row) return mapRow(row);

  const aliasRows = await queryMergedUserRows(
    `
    SELECT
      u.source_user_id,
      u.source_database,
      u.employee_code,
      u.username,
      COALESCE(NULLIF(TRIM(h.password), ''), u.password_hash) AS password_hash,
      u.name,
      u.email,
      u.role,
      u.company_name,
      u.is_active
    FROM merged_username_aliases a
    INNER JOIN merged_users u ON u.source_user_id = a.source_user_id
    LEFT JOIN \`${liveDb}\`.users h
      ON h.id = u.source_user_id
     AND u.source_database = ?
    WHERE u.is_active = 1
      AND LOWER(a.username) = ?
    ORDER BY
      CASE WHEN u.source_database IN (${tagList}) THEN 0 ELSE 1 END ASC,
      CASE WHEN COALESCE(NULLIF(TRIM(h.password), ''), u.password_hash) IS NOT NULL
            AND TRIM(COALESCE(NULLIF(TRIM(h.password), ''), u.password_hash)) <> '' THEN 0 ELSE 1 END ASC,
      u.source_user_id ASC
    LIMIT 1
    `,
    `
    SELECT
      u.source_user_id,
      u.source_database,
      u.employee_code,
      u.username,
      u.password_hash,
      u.name,
      u.email,
      u.role,
      u.company_name,
      u.is_active
    FROM merged_username_aliases a
    INNER JOIN merged_users u ON u.source_user_id = a.source_user_id
    WHERE u.is_active = 1
      AND LOWER(a.username) = ?
    ORDER BY
      CASE WHEN u.source_database IN (${tagList}) THEN 0 ELSE 1 END ASC,
      CASE WHEN u.password_hash IS NOT NULL AND TRIM(u.password_hash) <> '' THEN 0 ELSE 1 END ASC,
      u.source_user_id ASC
    LIMIT 1
    `,
    [liveDb, needle, ...hrisTags],
    [needle, ...hrisTags],
  );

  const aliasRow = aliasRows[0];
  if (!aliasRow) return null;
  return mapRow(aliasRow);
}

export async function findMergedUserByEmail(email: string): Promise<MergedAuthUser | null> {
  const e = email.trim().toLowerCase();
  if (!e) return null;
  const hrisTags = resolveHrisSourceTags();
  const liveDb = await resolveLiveHrisDbAvailable();
  const tagList = hrisTags.map(() => "?").join(",");

  const rows = await queryMergedUserRows(
    `
    SELECT
      m.source_user_id,
      m.source_database,
      m.employee_code,
      m.username,
      COALESCE(NULLIF(TRIM(h.password), ''), m.password_hash) AS password_hash,
      m.name,
      m.email,
      m.role,
      m.company_name,
      m.is_active
    FROM merged_users m
    LEFT JOIN \`${liveDb}\`.users h
      ON h.id = m.source_user_id
     AND m.source_database = ?
    WHERE m.is_active = 1 AND LOWER(m.email) = ?
    ORDER BY
      CASE WHEN m.source_database IN (${tagList}) THEN 0 ELSE 1 END ASC,
      CASE WHEN COALESCE(NULLIF(TRIM(h.password), ''), m.password_hash) IS NOT NULL
            AND TRIM(COALESCE(NULLIF(TRIM(h.password), ''), m.password_hash)) <> '' THEN 0 ELSE 1 END ASC,
      m.source_user_id ASC
    LIMIT 1
    `,
    `
    SELECT
      m.source_user_id,
      m.source_database,
      m.employee_code,
      m.username,
      m.password_hash,
      m.name,
      m.email,
      m.role,
      m.company_name,
      m.is_active
    FROM merged_users m
    WHERE m.is_active = 1 AND LOWER(m.email) = ?
    ORDER BY
      CASE WHEN m.source_database IN (${tagList}) THEN 0 ELSE 1 END ASC,
      CASE WHEN m.password_hash IS NOT NULL AND TRIM(m.password_hash) <> '' THEN 0 ELSE 1 END ASC,
      m.source_user_id ASC
    LIMIT 1
    `,
    [liveDb, e, ...hrisTags],
    [e, ...hrisTags],
  );

  const row = rows[0];
  if (!row) return null;
  return mapRow(row);
}

/** Map hris-dev.users.role → portal role string. */
export function mapMergedHrisRoleToPortal(hrisRole: string): PortalRole {
  return mapHrisToPortalRole({ hrisRole }).portalRole;
}

export function mergedPortalEmail(merged: Pick<MergedAuthUser, "email" | "username">): string {
  const email = merged.email?.trim().toLowerCase();
  if (email) return email;
  const username = merged.username?.trim().toLowerCase();
  if (username) return `${username}@hris.merged`;
  return "unknown@hris.merged";
}
