/**
 * On Duty / Offline from mergeddatabase attendance (HRIS clock-in).
 *
 * Source of truth: `merged_attendance_clock_in` via `prismaSecondary`.
 * There is no clock-out table in the merge schema today — On Duty means the
 * employee has at least one clock-in whose `clock_in_at` falls on the current
 * Asia/Taipei (GMT+8) calendar day. Offline otherwise.
 *
 * Important: HRIS/MySQL stores `clock_in_at` as a naive DATETIME in **UTC**
 * (e.g. 00:29 UTC = 08:29 GMT+8). Prisma exposes those UTC components as a JS
 * Date. Day filters must use the app timezone's midnight converted to UTC
 * DATETIME strings; display must format in Asia/Taipei (not UTC / wall-clock).
 */

import { DateTime } from "luxon";
import { Prisma } from "@prisma/client/secondary";
import { DEFAULT_TIME_ZONE } from "@/lib/kpi-recurrence";
import { prismaSecondary } from "@/lib/prisma";
import { withTtlCache } from "@/lib/ttl-cache";

export type DutyStatus = "ON_DUTY" | "OFFLINE";

export type MergedDutyClockIn = {
  sourceUserId: bigint;
  clockInAt: Date;
};

/** Inclusive start / exclusive end of "today" in the app zone as real UTC instants. */
export function philippineDayBounds(now: Date = new Date(), timeZone = DEFAULT_TIME_ZONE): {
  start: Date;
  endExclusive: Date;
  ymd: string;
} {
  const day = DateTime.fromJSDate(now, { zone: timeZone }).startOf("day");
  return {
    start: day.toJSDate(),
    endExclusive: day.plus({ days: 1 }).toJSDate(),
    ymd: day.toISODate() ?? "",
  };
}

/**
 * MySQL DATETIME strings for "today" in `timeZone`, when `clock_in_at` stores UTC.
 * Example (Asia/Taipei): start `YYYY-MM-DD 16:00:00` previous day → end next 16:00:00.
 */
export function philippineMysqlDayBounds(
  now: Date = new Date(),
  timeZone = DEFAULT_TIME_ZONE,
): {
  start: string;
  endExclusive: string;
  ymd: string;
} {
  const day = DateTime.fromJSDate(now, { zone: timeZone }).startOf("day");
  return {
    start: day.toUTC().toFormat("yyyy-MM-dd HH:mm:ss"),
    endExclusive: day.plus({ days: 1 }).toUTC().toFormat("yyyy-MM-dd HH:mm:ss"),
    ymd: day.toISODate() ?? "",
  };
}

/** App-zone calendar YMD for a UTC-stored HRIS/MySQL DATETIME (Prisma Date). */
export function mysqlDatetimeAppZoneYmd(value: Date, timeZone = DEFAULT_TIME_ZONE): string {
  return DateTime.fromJSDate(value, { zone: "utc" }).setZone(timeZone).toISODate() ?? "";
}

/** @deprecated Use mysqlDatetimeAppZoneYmd — kept for older imports. */
export function mysqlDatetimeWallClockYmd(value: Date): string {
  return mysqlDatetimeAppZoneYmd(value);
}

/** Format a UTC-stored clock-in for display in the app timezone (GMT+8). */
export function formatClockInLocalTime(
  value: Date,
  timeZone = DEFAULT_TIME_ZONE,
  options?: Intl.DateTimeFormatOptions,
): string {
  return value.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
    ...options,
  });
}

/** @deprecated Use formatClockInLocalTime. */
export function formatMysqlDatetimeWallClockTime(
  value: Date,
  options?: Intl.DateTimeFormatOptions,
): string {
  return formatClockInLocalTime(value, DEFAULT_TIME_ZONE, options);
}

export function dutyStatusFromLatestClockIn(
  latestClockInAt: Date | null | undefined,
  now: Date = new Date(),
  timeZone = DEFAULT_TIME_ZONE,
): DutyStatus {
  if (!latestClockInAt) return "OFFLINE";
  const { start, endExclusive } = philippineDayBounds(now, timeZone);
  const t = latestClockInAt.getTime();
  if (t >= start.getTime() && t < endExclusive.getTime()) return "ON_DUTY";
  return "OFFLINE";
}

export function isOnDutyStatus(status: DutyStatus): boolean {
  return status === "ON_DUTY";
}

/**
 * Company name per `source_user_id` from merged_users (the personnel-tab source
 * of truth). Keys are decimal string forms of BigInt ids for Map lookups.
 */
export async function loadCompanyNamesBySourceUserId(
  sourceUserIds: ReadonlyArray<bigint | number | string>,
): Promise<Map<string, string | null>> {
  const ids = [
    ...new Set(
      sourceUserIds
        .map((id) => {
          try {
            return BigInt(id);
          } catch {
            return null;
          }
        })
        .filter((id): id is bigint => id != null),
    ),
  ];
  if (ids.length === 0) return new Map();

  const cached = await withTtlCache(
    "merged-user-company-names:v1",
    60_000,
    async () => {
      const users = await prismaSecondary.mergedUser.findMany({
        select: { sourceUserId: true, companyName: true },
      });
      return users.map((row) => ({
        id: row.sourceUserId.toString(),
        companyName: row.companyName ?? null,
      }));
    },
  );

  const byId = new Map<string, string | null>(
    cached.map((row) => [row.id, row.companyName] as const),
  );
  const missing = ids.map((id) => id.toString()).filter((id) => !byId.has(id));
  if (missing.length > 0) {
    try {
      const extra = await prismaSecondary.mergedUser.findMany({
        where: { sourceUserId: { in: missing.map((id) => BigInt(id)) } },
        select: { sourceUserId: true, companyName: true },
      });
      for (const row of extra) {
        byId.set(row.sourceUserId.toString(), row.companyName ?? null);
      }
    } catch {
      /* keep cached names; missing ids stay absent */
    }
  }
  const out = new Map<string, string | null>();
  for (const id of ids) {
    const key = id.toString();
    out.set(key, byId.get(key) ?? null);
  }
  return out;
}

/**
 * Latest clock-in today per `source_user_id` from the merged DB.
 * Keys are decimal string forms of BigInt ids for easy Map lookups.
 */
export async function loadTodayClockInsBySourceUserId(
  sourceUserIds: ReadonlyArray<bigint | number | string>,
  now: Date = new Date(),
): Promise<Map<string, Date>> {
  // Keep merge attendance close to live HRIS (callers poll frequently).
  try {
    const { runHrisAttendanceSync } = await import("@/lib/auth/hris-attendance-sync");
    const { withTtlCache } = await import("@/lib/ttl-cache");
    await withTtlCache("hris-attendance-sync", 30_000, async () => {
      await runHrisAttendanceSync();
      return true as const;
    });
  } catch (e) {
    console.error("[merged-duty-status] attendance sync failed", e);
  }

  const ids = [
    ...new Set(
      sourceUserIds
        .map((id) => {
          try {
            return BigInt(id);
          } catch {
            return null;
          }
        })
        .filter((id): id is bigint => id != null),
    ),
  ];
  if (ids.length === 0) return new Map();

  // UTC DATETIME strings for the Asia/Taipei (GMT+8) calendar day.
  const { start, endExclusive } = philippineMysqlDayBounds(now);

  const rows = await prismaSecondary.$queryRaw<
    Array<{ source_user_id: bigint; clock_in_at: Date }>
  >`
    SELECT source_user_id, clock_in_at
    FROM merged_attendance_clock_in
    WHERE source_user_id IN (${Prisma.join(ids)})
      AND clock_in_at >= ${start}
      AND clock_in_at < ${endExclusive}
    ORDER BY clock_in_at DESC
  `;

  const latest = new Map<string, Date>();
  for (const row of rows) {
    const key = row.source_user_id.toString();
    if (!latest.has(key)) {
      latest.set(key, row.clock_in_at);
    }
  }
  return latest;
}

/**
 * Active merged personnel with today's duty status (pure merge-DB query).
 * Useful for tooling; Activities prefers portal-linked agents for assignment IDs.
 */
export async function listMergedPersonnelDutyStatuses(options?: {
  companyName?: string;
  now?: Date;
}) {
  const now = options?.now ?? new Date();
  const { start, endExclusive } = philippineMysqlDayBounds(now);

  const users = await prismaSecondary.mergedUser.findMany({
    where: {
      isActive: true,
      ...(options?.companyName ? { companyName: options.companyName } : {}),
    },
    orderBy: { name: "asc" },
    select: {
      sourceUserId: true,
      name: true,
      email: true,
      companyName: true,
      username: true,
      employeeCode: true,
    },
  });

  const clockIns =
    users.length === 0
      ? []
      : await prismaSecondary.$queryRaw<
          Array<{ source_user_id: bigint; clock_in_at: Date }>
        >`
          SELECT source_user_id, clock_in_at
          FROM merged_attendance_clock_in
          WHERE source_user_id IN (${Prisma.join(users.map((u) => u.sourceUserId))})
            AND clock_in_at >= ${start}
            AND clock_in_at < ${endExclusive}
          ORDER BY clock_in_at DESC
        `;

  const latestByUser = new Map<string, Date>();
  for (const row of clockIns) {
    const key = row.source_user_id.toString();
    if (!latestByUser.has(key)) latestByUser.set(key, row.clock_in_at);
  }

  return users.map((u) => {
    const lastClockInAt = latestByUser.get(u.sourceUserId.toString()) ?? null;
    const dutyStatus = dutyStatusFromLatestClockIn(lastClockInAt, now);
    return {
      sourceUserId: u.sourceUserId.toString(),
      name: u.name,
      email: u.email,
      companyName: u.companyName,
      username: u.username,
      employeeCode: u.employeeCode,
      dutyStatus,
      isOnDuty: isOnDutyStatus(dutyStatus),
      lastClockInAt,
    };
  });
}
