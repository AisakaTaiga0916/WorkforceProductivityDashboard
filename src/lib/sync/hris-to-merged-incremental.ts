/**
 * Incremental HRIS → merged MySQL ETL (users + clock-in attendance only).
 *
 * Upserts recent rows from a source HRIS database into a target merged database.
 * Does not drop tables or touch Task/KPI merged tables.
 *
 * Watermarks (per source_database tag):
 *   - users:      MAX(updated_at) in merged_users, else lookback window
 *   - attendance: MAX(clock_in_at) in merged_attendance_clock_in, else lookback window
 *
 * Env:
 *   HRIS_MERGE_SOURCE_DB, HRIS_MERGE_TARGET_DB, HRIS_MERGE_SOURCE_TAG
 *   HRIS_MERGE_LOOKBACK_DAYS, HRIS_MERGE_USERS_SINCE, HRIS_MERGE_FORCE_USERS_LOOKBACK_DAYS
 *   DATABASE_URL_SECONDARY_SYNC / DATABASE_URL_SECONDARY
 */
import { PrismaClient as PrismaClientSecondary } from "@prisma/client/secondary";

type SinceRow = { since: Date | null };
type SummaryRow = { tbl: string; row_count: bigint | number };

export type HrisToMergedIncrementalResult = {
  sourceDb: string;
  targetDb: string;
  sourceTag: string;
  usersSince: Date;
  attendanceSince: Date;
  userChanges: number;
  attendanceChanges: number;
  durationMs: number;
};

function env(name: string, fallback: string): string {
  const v = process.env[name]?.trim();
  return v || fallback;
}

function lookbackDays(): number {
  const raw = Number(process.env.HRIS_MERGE_LOOKBACK_DAYS ?? "90");
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 90;
}

function sqlId(name: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(name)) {
    throw new Error(`Invalid SQL identifier: ${name}`);
  }
  return `\`${name}\``;
}

function resolveTargetWriteUrl(targetDb: string): string {
  const explicit = process.env.DATABASE_URL_SECONDARY_SYNC?.trim();
  if (explicit) {
    try {
      const url = new URL(explicit);
      url.pathname = `/${targetDb}`;
      return url.toString();
    } catch {
      return explicit;
    }
  }

  const appUrl = process.env.DATABASE_URL_SECONDARY?.trim();
  if (appUrl && !appUrl.includes("merge_app@")) {
    try {
      const url = new URL(appUrl);
      url.pathname = `/${targetDb}`;
      return url.toString();
    } catch {
      return appUrl;
    }
  }

  return `mysql://root@localhost:3306/${targetDb}`;
}

/** Prisma needs an existing schema at connect time — use the MySQL system DB. */
function bootstrapWriteUrl(targetDb: string): string {
  const url = new URL(resolveTargetWriteUrl(targetDb));
  url.pathname = "/mysql";
  return url.toString();
}

async function ensureSchema(
  db: PrismaClientSecondary,
  targetDb: string,
  sourceTag: string,
) {
  const target = sqlId(targetDb);

  await db.$executeRawUnsafe(`
    CREATE DATABASE IF NOT EXISTS ${target}
      CHARACTER SET utf8mb4
      COLLATE utf8mb4_unicode_ci
  `);

  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ${target}.merged_users (
      source_user_id       BIGINT UNSIGNED NOT NULL,
      source_database      VARCHAR(64) NOT NULL DEFAULT '${sourceTag}',
      employee_code        VARCHAR(255) NULL,
      username             VARCHAR(255) NULL,
      password_hash        VARCHAR(255) NULL,
      name                 VARCHAR(255) NOT NULL,
      email                VARCHAR(255) NULL,
      phone_number         VARCHAR(20) NULL,
      role                 VARCHAR(20) NOT NULL,
      company_id           BIGINT UNSIGNED NULL,
      company_name         VARCHAR(255) NULL,
      department           VARCHAR(255) NULL,
      position             VARCHAR(255) NULL,
      employment_status    VARCHAR(255) NOT NULL,
      is_active            TINYINT(1) NOT NULL DEFAULT 1,
      hire_date            DATE NULL,
      profile_image        VARCHAR(255) NULL,
      face_image           LONGTEXT NULL,
      created_at           TIMESTAMP NULL,
      updated_at           TIMESTAMP NULL,
      merged_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (source_user_id),
      KEY idx_merged_users_source_db (source_database),
      KEY idx_merged_users_company (company_id),
      KEY idx_merged_users_email (email),
      KEY idx_merged_users_username (username)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ${target}.merged_attendance_clock_in (
      source_log_id          BIGINT UNSIGNED NOT NULL,
      source_database        VARCHAR(64) NOT NULL DEFAULT '${sourceTag}',
      source_user_id         BIGINT UNSIGNED NOT NULL,
      employee_code          VARCHAR(255) NULL,
      employee_name          VARCHAR(255) NULL,
      company_name           VARCHAR(255) NULL,
      clock_in_at            DATETIME NOT NULL,
      verified_at            DATETIME NULL,
      authentication_method  VARCHAR(50) NULL,
      geofence_status        VARCHAR(32) NULL,
      latitude               DECIMAL(10,8) NULL,
      longitude              DECIMAL(11,8) NULL,
      ip_address             VARCHAR(45) NULL,
      created_at             DATETIME NULL,
      merged_at              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (source_log_id),
      KEY idx_merged_attendance_source_db (source_database),
      KEY idx_merged_attendance_user (source_user_id),
      KEY idx_merged_attendance_clock_in (clock_in_at),
      KEY idx_merged_attendance_company (company_name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Existing DBs may predate profile/face columns (CREATE TABLE IF NOT EXISTS won't add them).
  for (const col of [
    { name: "profile_image", ddl: "VARCHAR(255) NULL AFTER hire_date" },
    { name: "face_image", ddl: "LONGTEXT NULL AFTER profile_image" },
  ] as const) {
    const cols = await db.$queryRawUnsafe<Array<{ Field: string }>>(
      `SHOW COLUMNS FROM ${target}.merged_users LIKE '${col.name}'`,
    );
    if (cols.length === 0) {
      await db.$executeRawUnsafe(
        `ALTER TABLE ${target}.merged_users ADD COLUMN ${col.name} ${col.ddl}`,
      );
    }
  }
}

async function resolveSince(
  db: PrismaClientSecondary,
  targetDb: string,
  sourceTag: string,
  table: "merged_users" | "merged_attendance_clock_in",
  column: "updated_at" | "clock_in_at",
): Promise<Date> {
  const target = sqlId(targetDb);
  const rows = await db.$queryRawUnsafe<SinceRow[]>(`
    SELECT MAX(${column}) AS since
    FROM ${target}.${table}
    WHERE source_database = '${sourceTag}'
  `);
  const since = rows[0]?.since;
  if (since) return since;

  const days = lookbackDays();
  const fallback = await db.$queryRawUnsafe<SinceRow[]>(`
    SELECT DATE_SUB(NOW(), INTERVAL ${days} DAY) AS since
  `);
  return fallback[0]?.since ?? new Date(Date.now() - days * 86_400_000);
}

async function mergeUsers(args: {
  db: PrismaClientSecondary;
  sourceDb: string;
  targetDb: string;
  sourceTag: string;
  usersSince: Date;
  attendanceSince: Date;
}) {
  const source = sqlId(args.sourceDb);
  const target = sqlId(args.targetDb);
  const usersSince = args.usersSince.toISOString().slice(0, 19).replace("T", " ");
  const attendanceSince = args.attendanceSince.toISOString().slice(0, 19).replace("T", " ");

  const result = await args.db.$executeRawUnsafe(`
    INSERT INTO ${target}.merged_users (
      source_user_id, source_database, employee_code, username, password_hash, name, email, phone_number, role,
      company_id, company_name, department, position, employment_status,
      is_active, hire_date, profile_image, face_image, created_at, updated_at
    )
    SELECT
      u.id,
      '${args.sourceTag}',
      u.employee_code,
      u.username,
      u.password,
      u.name,
      u.email,
      u.phone_number,
      u.role,
      u.company_id,
      c.name AS company_name,
      u.department,
      u.position,
      u.employment_status,
      u.is_active,
      u.hire_date,
      u.profile_image,
      u.face_image,
      u.created_at,
      u.updated_at
    FROM ${source}.users u
    LEFT JOIN ${source}.companies c ON c.id = u.company_id
    WHERE u.updated_at >= '${usersSince}'
       OR u.id IN (
         SELECT DISTINCT al.user_id
         FROM ${source}.attendance_logs al
         WHERE al.type = 'clock_in'
           AND al.time_in_clicked_at IS NOT NULL
           AND al.time_in_clicked_at >= '${attendanceSince}'
       )
    ON DUPLICATE KEY UPDATE
      employee_code = VALUES(employee_code),
      username = VALUES(username),
      password_hash = VALUES(password_hash),
      name = VALUES(name),
      email = VALUES(email),
      phone_number = VALUES(phone_number),
      role = VALUES(role),
      company_id = VALUES(company_id),
      company_name = VALUES(company_name),
      department = VALUES(department),
      position = VALUES(position),
      employment_status = VALUES(employment_status),
      is_active = VALUES(is_active),
      hire_date = VALUES(hire_date),
      profile_image = COALESCE(VALUES(profile_image), ${target}.merged_users.profile_image),
      face_image = COALESCE(VALUES(face_image), ${target}.merged_users.face_image),
      created_at = VALUES(created_at),
      updated_at = VALUES(updated_at),
      merged_at = CURRENT_TIMESTAMP
  `);

  return Number(result);
}

async function mergeAttendance(args: {
  db: PrismaClientSecondary;
  sourceDb: string;
  targetDb: string;
  sourceTag: string;
  attendanceSince: Date;
}) {
  const source = sqlId(args.sourceDb);
  const target = sqlId(args.targetDb);
  const attendanceSince = args.attendanceSince.toISOString().slice(0, 19).replace("T", " ");

  const result = await args.db.$executeRawUnsafe(`
    INSERT INTO ${target}.merged_attendance_clock_in (
      source_log_id, source_database, source_user_id, employee_code, employee_name, company_name,
      clock_in_at, verified_at, authentication_method, geofence_status,
      latitude, longitude, ip_address, created_at
    )
    SELECT
      al.id,
      '${args.sourceTag}',
      al.user_id,
      u.employee_code,
      u.name,
      c.name,
      al.time_in_clicked_at,
      al.verified_at,
      al.authentication_method,
      al.geofence_status,
      al.latitude,
      al.longitude,
      al.ip_address,
      al.created_at
    FROM ${source}.attendance_logs al
    INNER JOIN ${source}.users u ON u.id = al.user_id
    LEFT JOIN ${source}.companies c ON c.id = u.company_id
    WHERE al.type = 'clock_in'
      AND al.time_in_clicked_at IS NOT NULL
      AND al.time_in_clicked_at >= '${attendanceSince}'
    ON DUPLICATE KEY UPDATE
      source_user_id = VALUES(source_user_id),
      employee_code = VALUES(employee_code),
      employee_name = VALUES(employee_name),
      company_name = VALUES(company_name),
      clock_in_at = VALUES(clock_in_at),
      verified_at = VALUES(verified_at),
      authentication_method = VALUES(authentication_method),
      geofence_status = VALUES(geofence_status),
      latitude = VALUES(latitude),
      longitude = VALUES(longitude),
      ip_address = VALUES(ip_address),
      created_at = VALUES(created_at),
      merged_at = CURRENT_TIMESTAMP
  `);

  return Number(result);
}

async function printSummary(
  db: PrismaClientSecondary,
  targetDb: string,
  sourceTag: string,
  log: (msg: string) => void,
) {
  const target = sqlId(targetDb);
  const rows = await db.$queryRawUnsafe<SummaryRow[]>(`
    SELECT 'merged_users' AS tbl, COUNT(*) AS row_count
    FROM ${target}.merged_users
    WHERE source_database = '${sourceTag}'
    UNION ALL
    SELECT 'merged_attendance_clock_in', COUNT(*)
    FROM ${target}.merged_attendance_clock_in
    WHERE source_database = '${sourceTag}'
  `);

  log(`\n${targetDb} (${sourceTag}) row counts:\n`);
  for (const row of rows) {
    log(`  ${row.tbl}: ${row.row_count}`);
  }
}

export type RunHrisToMergedIncrementalOptions = {
  /** When true (default), log progress to console. */
  verbose?: boolean;
};

/**
 * Run watermarked HRIS → merged upsert for users + clock-in attendance.
 * Safe to call from scheduled jobs or CLI.
 */
export async function runHrisToMergedIncremental(
  options: RunHrisToMergedIncrementalOptions = {},
): Promise<HrisToMergedIncrementalResult> {
  const verbose = options.verbose !== false;
  const log = verbose ? console.log.bind(console) : () => {};

  const sourceDb = env("HRIS_MERGE_SOURCE_DB", "hrisdemo");
  const targetDb = env("HRIS_MERGE_TARGET_DB", "mergedatabase-demo");
  const sourceTag = env("HRIS_MERGE_SOURCE_TAG", sourceDb);
  const writeUrl = bootstrapWriteUrl(targetDb);
  const start = Date.now();

  const db = new PrismaClientSecondary({
    datasources: { db: { url: writeUrl } },
  });

  try {
    await db.$connect();
    log(`Incremental HRIS merge: ${sourceDb} → ${targetDb} (tag: ${sourceTag})`);
    log(`Lookback (first run): ${lookbackDays()} days`);

    await ensureSchema(db, targetDb, sourceTag);

    let usersSince = await resolveSince(db, targetDb, sourceTag, "merged_users", "updated_at");
    const attendanceSince = await resolveSince(
      db,
      targetDb,
      sourceTag,
      "merged_attendance_clock_in",
      "clock_in_at",
    );

    // Optional catch-up when watermark skipped newly created users (updated_at older than max).
    const forceUsersSince = process.env.HRIS_MERGE_USERS_SINCE?.trim();
    const forceLookbackDays = Number(process.env.HRIS_MERGE_FORCE_USERS_LOOKBACK_DAYS ?? "");
    if (forceUsersSince) {
      usersSince = new Date(forceUsersSince);
      log(`Users since overridden by HRIS_MERGE_USERS_SINCE`);
    } else if (Number.isFinite(forceLookbackDays) && forceLookbackDays > 0) {
      usersSince = new Date(Date.now() - forceLookbackDays * 86_400_000);
      log(`Users since overridden by ${forceLookbackDays}-day force lookback`);
    }

    log(`Users since:      ${usersSince.toISOString()}`);
    log(`Attendance since: ${attendanceSince.toISOString()}`);

    const userChanges = await mergeUsers({
      db,
      sourceDb,
      targetDb,
      sourceTag,
      usersSince,
      attendanceSince,
    });
    const attendanceChanges = await mergeAttendance({
      db,
      sourceDb,
      targetDb,
      sourceTag,
      attendanceSince,
    });

    log(`\nUpserted users rows affected:      ${userChanges}`);
    log(`Upserted attendance rows affected: ${attendanceChanges}`);

    if (verbose) {
      await printSummary(db, targetDb, sourceTag, log);
    }

    return {
      sourceDb,
      targetDb,
      sourceTag,
      usersSince,
      attendanceSince,
      userChanges,
      attendanceChanges,
      durationMs: Date.now() - start,
    };
  } finally {
    await db.$disconnect();
  }
}
