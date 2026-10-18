import { DateTime } from "luxon";
import { DEFAULT_TIME_ZONE, normalizeTimeZone } from "@/modules/tasks/kpi-recurrence";

/** @deprecated Idle timeout removed — all roles expire at local midnight. Kept for older imports/tests. */
export const SESSION_IDLE_MAX_AGE_SECONDS = 30 * 60;

/** JWT cookie upper bound (sessions run until next local midnight). */
export const SESSION_JWT_MAX_AGE_SECONDS = 24 * 60 * 60;

/** All authenticated roles end their session at local midnight. */
export function isMidnightLogoutRole(_role?: string | null | undefined): boolean {
  return true;
}

/** Next local midnight (start of tomorrow) in the app timezone, as Unix seconds. */
export function nextMidnightUnixSeconds(
  nowUnixSeconds: number,
  timeZone: string = DEFAULT_TIME_ZONE,
): number {
  const zone = normalizeTimeZone(timeZone);
  const now = DateTime.fromSeconds(nowUnixSeconds, { zone });
  return Math.floor(now.startOf("day").plus({ days: 1 }).toSeconds());
}

/**
 * Session lifetime ends at the next Asia/Taipei (GMT+8) midnight for every role.
 * Recomputed on each JWT refresh so the expiry stays pinned to that midnight.
 */
export function computeSessionExpiresAt(args: {
  role: string | null | undefined;
  nowUnixSeconds: number;
  existingSessionExpiresAt?: number;
  isNewLogin: boolean;
  timeZone?: string;
}): number {
  return nextMidnightUnixSeconds(args.nowUnixSeconds, args.timeZone);
}
