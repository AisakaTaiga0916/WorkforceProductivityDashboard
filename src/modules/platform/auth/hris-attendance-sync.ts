import { MERGED_SOURCE_DATABASE } from "@/lib/merged-database-sources";
import { resolveLiveHrisDbAvailable } from "@/modules/platform/auth/merged-credentials";
import { prismaSecondary } from "@/modules/platform/db/prisma";

/**
 * Pull clock-in attendance from the live HRIS MySQL database into
 * `merged_attendance_clock_in`, so Activities / On Duty reflect *today's* clock-ins.
 *
 * `prismaSecondary` is connected to the merged database; the live HRIS schema
 * lives on the same MySQL server, so we read it with a cross-schema
 * `INSERT ... SELECT` (idempotent via the log id primary key).
 */

type SinceRow = { since: Date | null };

function resolveSourceTag(): string {
  return (
    process.env.HRIS_MERGE_SOURCE_TAG?.trim() ||
    process.env.HRIS_MERGE_SOURCE_DB?.trim() ||
    MERGED_SOURCE_DATABASE.HRIS_DEMO
  );
}

/** Backtick-quote a MySQL identifier after validating it. */
function sqlId(name: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(name)) {
    throw new Error(`Invalid SQL identifier: ${name}`);
  }
  return `\`${name}\``;
}

export type HrisAttendanceSyncResult = {
  sourceDb: string;
  since: string;
  upserted: number;
  durationMs: number;
  skipped?: string;
};

export async function runHrisAttendanceSync(): Promise<HrisAttendanceSyncResult> {
  const start = Date.now();
  // Prefer HRIS_LIVE_SOURCE_DB, then fall back to hris-dev → hrisdemo → hris.
  const sourceDb = await resolveLiveHrisDbAvailable();
  const sourceTag = resolveSourceTag();
  const source = sqlId(sourceDb);

  // Bail out cleanly when the live HRIS schema is not present (e.g. some envs).
  const exists = await prismaSecondary.$queryRawUnsafe<Array<{ n: bigint | number }>>(
    `SELECT COUNT(*) AS n FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?`,
    sourceDb,
  );
  if (Number(exists[0]?.n ?? 0) === 0) {
    return {
      sourceDb,
      since: "",
      upserted: 0,
      durationMs: Date.now() - start,
      skipped: `source database "${sourceDb}" not found`,
    };
  }

  // Watermark: last clock-in we already have. Re-pull a small overlap window so
  // late-verified rows update in place (idempotent on source_log_id).
  const sinceRows = await prismaSecondary.$queryRaw<SinceRow[]>`
    SELECT MAX(clock_in_at) AS since FROM merged_attendance_clock_in
  `;
  const watermark = sinceRows[0]?.since ?? new Date(Date.now() - 30 * 86_400_000);
  const since = new Date(watermark.getTime() - 24 * 3_600_000); // 24h overlap for late verifies
  const sinceStr = since.toISOString().slice(0, 19).replace("T", " ");

  const upserted = await prismaSecondary.$executeRawUnsafe(
    `
    INSERT INTO merged_attendance_clock_in (
      source_log_id, source_database, source_user_id, employee_code, employee_name, company_name,
      clock_in_at, verified_at, authentication_method, geofence_status,
      latitude, longitude, ip_address, created_at
    )
    SELECT
      al.id,
      '${sourceTag}',
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
      AND al.time_in_clicked_at >= ?
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
    `,
    sinceStr,
  );

  return {
    sourceDb,
    since: sinceStr,
    upserted: Number(upserted),
    durationMs: Date.now() - start,
  };
}
