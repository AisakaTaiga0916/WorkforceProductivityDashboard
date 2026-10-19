import {
  getPlatformSettingJson,
  setPlatformSettingJson,
} from "@/lib/platform-settings";
import { withTtlCache, invalidateTtlCache } from "@/lib/ttl-cache";
import {
  DEFAULT_WORKING_DAYS,
  TASK_SCHEDULE_SETTING_KEY,
  normalizeWorkingDays,
  parseTaskScheduleSettings,
  workingDaysForCompany,
  type TaskScheduleSettings,
} from "@/modules/platform/settings/task-schedule-settings";

const CACHE_KEY = `platform-setting:${TASK_SCHEDULE_SETTING_KEY}:v1`;
const CACHE_TTL_MS = 30_000;

/** Server-only: read the full per-company task schedule map. */
export async function getTaskScheduleSettings(): Promise<TaskScheduleSettings> {
  return withTtlCache(CACHE_KEY, CACHE_TTL_MS, async () => {
    const raw = await getPlatformSettingJson(TASK_SCHEDULE_SETTING_KEY);
    return parseTaskScheduleSettings(raw);
  });
}

/** Server-only: resolved ISO working days (1=Mon…7=Sun) for a company. */
export async function getCompanyWorkingDays(
  companyId: string | null | undefined,
): Promise<number[]> {
  if (!companyId) return [...DEFAULT_WORKING_DAYS];
  const settings = await getTaskScheduleSettings();
  return workingDaysForCompany(settings, companyId);
}

/** Server-only: persist one company's working-day mask (SuperAdmin settings UI). */
export async function setCompanyWorkingDays(
  companyId: string,
  workingDays: unknown,
): Promise<TaskScheduleSettings> {
  const normalized = normalizeWorkingDays(workingDays);
  if (!normalized) {
    throw new Error("workingDays must be a non-empty list of ISO weekdays (1–7).");
  }
  const current = await getTaskScheduleSettings();
  const next: TaskScheduleSettings = {
    companies: { ...current.companies, [companyId]: { workingDays: normalized } },
  };
  await setPlatformSettingJson(TASK_SCHEDULE_SETTING_KEY, next);
  invalidateTtlCache(CACHE_KEY);
  return next;
}
