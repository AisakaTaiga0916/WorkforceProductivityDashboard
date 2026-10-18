/**
 * Shared delay-penalty frequency (TaskItem column + KPI/IT JSON).
 * WEEKLY/MONTHLY use ceil buckets: rate × ceil(days / periodDays).
 */

export const DELAY_PENALTY_FREQUENCIES = ["DAILY", "WEEKLY", "MONTHLY"] as const;

export type DelayPenaltyFrequency = (typeof DELAY_PENALTY_FREQUENCIES)[number];

export function isDelayPenaltyFrequency(value: unknown): value is DelayPenaltyFrequency {
  return (
    typeof value === "string" &&
    (DELAY_PENALTY_FREQUENCIES as readonly string[]).includes(value)
  );
}

export function normalizeDelayPenaltyFrequency(value: unknown): DelayPenaltyFrequency {
  return isDelayPenaltyFrequency(value) ? value : "DAILY";
}

/**
 * Convert inclusive overdue calendar days into accrual units for the chosen frequency.
 * DAILY → days; WEEKLY → ceil(days/7); MONTHLY → ceil(days/30).
 */
export function penaltyAccrualUnits(days: number, frequency: DelayPenaltyFrequency): number {
  if (!Number.isFinite(days) || days <= 0) return 0;
  if (frequency === "WEEKLY") return Math.ceil(days / 7);
  if (frequency === "MONTHLY") return Math.ceil(days / 30);
  return Math.floor(days);
}

export function delayPenaltyFrequencyLabel(frequency: DelayPenaltyFrequency): string {
  switch (frequency) {
    case "WEEKLY":
      return "week";
    case "MONTHLY":
      return "month";
    default:
      return "day";
  }
}
