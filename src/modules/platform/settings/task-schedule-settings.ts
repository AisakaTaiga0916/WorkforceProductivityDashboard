/**
 * Platform setting: per-company Task Schedule Config.
 *
 * Working days are ISO/Luxon weekday numbers — 1 = Monday … 7 = Sunday.
 * Unconfigured companies inherit {@link DEFAULT_WORKING_DAYS} (Mon–Sat,
 * Sunday off) so behavior is unchanged until an admin saves a mask.
 */

export const TASK_SCHEDULE_SETTING_KEY = "task_schedule_config";

/** Mon–Sat; Sunday (7) is excluded — the long-standing default everywhere. */
export const DEFAULT_WORKING_DAYS: readonly number[] = [1, 2, 3, 4, 5, 6];

/** Index by ISO weekday (1–7); index 0 unused. */
export const WEEKDAY_SHORT_LABELS: readonly string[] = [
  "",
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
  "Sun",
];

export const WEEKDAY_ORDER: readonly number[] = [1, 2, 3, 4, 5, 6, 7];

export type CompanyTaskScheduleConfig = {
  /** ISO weekdays that count as working days (1 = Mon … 7 = Sun). Never empty. */
  workingDays: number[];
};

export type TaskScheduleSettings = {
  /** Keyed by Company.id. Missing entry ⇒ {@link DEFAULT_WORKING_DAYS}. */
  companies: Record<string, CompanyTaskScheduleConfig>;
};

export const DEFAULT_TASK_SCHEDULE_SETTINGS: TaskScheduleSettings = { companies: {} };

/** Coerce arbitrary input into a sorted, unique ISO-weekday list; null when invalid/empty. */
export function normalizeWorkingDays(input: unknown): number[] | null {
  if (!Array.isArray(input)) return null;
  const days = new Set<number>();
  for (const raw of input) {
    const n = typeof raw === "number" ? raw : Number.parseInt(String(raw), 10);
    if (!Number.isInteger(n) || n < 1 || n > 7) return null;
    days.add(n);
  }
  if (days.size === 0) return null;
  return [...days].sort((a, b) => a - b);
}

export function parseTaskScheduleSettings(raw: unknown): TaskScheduleSettings {
  if (!raw || typeof raw !== "object") return { companies: {} };
  const companiesRaw = (raw as { companies?: unknown }).companies;
  if (!companiesRaw || typeof companiesRaw !== "object") return { companies: {} };

  const companies: Record<string, CompanyTaskScheduleConfig> = {};
  for (const [companyId, value] of Object.entries(companiesRaw as Record<string, unknown>)) {
    if (!companyId.trim()) continue;
    const workingDays =
      value && typeof value === "object"
        ? normalizeWorkingDays((value as { workingDays?: unknown }).workingDays)
        : null;
    if (workingDays) companies[companyId] = { workingDays };
  }
  return { companies };
}

/** Resolved working days for a company — default Mon–Sat when unset/unknown. */
export function workingDaysForCompany(
  settings: TaskScheduleSettings,
  companyId: string | null | undefined,
): number[] {
  if (!companyId) return [...DEFAULT_WORKING_DAYS];
  const entry = settings.companies[companyId];
  return entry ? [...entry.workingDays] : [...DEFAULT_WORKING_DAYS];
}

/** Luxon weekday (1–7) check against a resolved mask. */
export function isWorkingWeekday(workingDays: readonly number[], luxonWeekday: number): boolean {
  return workingDays.includes(luxonWeekday);
}

/** Human label, e.g. `Mon–Sat` / `Mon, Wed, Fri`. */
export function formatWorkingDaysLabel(workingDays: readonly number[]): string {
  const days = normalizeWorkingDays([...workingDays]) ?? [...DEFAULT_WORKING_DAYS];
  if (days.length === 7) return "Every day";
  const isRange = days.every((day, idx) => idx === 0 || day === days[idx - 1]! + 1);
  if (isRange && days.length >= 3) {
    return `${WEEKDAY_SHORT_LABELS[days[0]!]}–${WEEKDAY_SHORT_LABELS[days[days.length - 1]!]}`;
  }
  return days.map((day) => WEEKDAY_SHORT_LABELS[day]).join(", ");
}
