import { prismaSecondary } from "@/modules/platform/db/prisma";

/** Employees with company from mergeddatabase-dev (HRIS ETL). */
export async function listMergedEmployees(options?: {
  companyName?: string;
  activeOnly?: boolean;
  limit?: number;
}) {
  return prismaSecondary.mergedUser.findMany({
    where: {
      ...(options?.companyName ? { companyName: options.companyName } : {}),
      ...(options?.activeOnly ? { isActive: true } : {}),
    },
    orderBy: { name: "asc" },
    take: options?.limit ?? 100,
    select: {
      sourceUserId: true,
      employeeCode: true,
      name: true,
      email: true,
      companyName: true,
      department: true,
      position: true,
      role: true,
      isActive: true,
    },
  });
}

/** Latest clock-in events from mergeddatabase-dev. */
export async function listRecentMergedClockIns(limit = 50) {
  return prismaSecondary.mergedAttendanceClockIn.findMany({
    orderBy: { clockInAt: "desc" },
    take: limit,
    select: {
      sourceLogId: true,
      employeeName: true,
      companyName: true,
      clockInAt: true,
      geofenceStatus: true,
    },
  });
}

/**
 * Today's clock-ins only (Asia/Manila day bounds) — preferred for On Duty checks.
 * Prefer `loadTodayClockInsBySourceUserId` / `listMergedPersonnelDutyStatuses` from
 * `@/lib/merged-duty-status` for bulk status maps.
 */
export async function listMergedClockInsToday(limit = 500) {
  const { philippineMysqlDayBounds } = await import("@/lib/merged-duty-status");
  const { Prisma } = await import("@prisma/client/secondary");
  const { start, endExclusive } = philippineMysqlDayBounds();
  const take = Math.min(2000, Math.max(1, limit));
  return prismaSecondary.$queryRaw<
    Array<{
      sourceLogId: bigint;
      sourceUserId: bigint;
      employeeName: string | null;
      companyName: string | null;
      clockInAt: Date;
      geofenceStatus: string | null;
    }>
  >`
    SELECT
      source_log_id AS sourceLogId,
      source_user_id AS sourceUserId,
      employee_name AS employeeName,
      company_name AS companyName,
      clock_in_at AS clockInAt,
      geofence_status AS geofenceStatus
    FROM merged_attendance_clock_in
    WHERE clock_in_at >= ${start}
      AND clock_in_at < ${endExclusive}
    ORDER BY clock_in_at DESC
    LIMIT ${Prisma.raw(String(take))}
  `;
}

/** Task/KPI rows synced from ticketing_system into mergeddatabase-dev. */
export async function listMergedTaskItems(limit = 50) {
  return prismaSecondary.mergedTaskItem.findMany({
    orderBy: { updatedAt: "desc" },
    take: limit,
    include: {
      activities: {
        orderBy: { createdAt: "desc" },
        take: 5,
      },
    },
  });
}
