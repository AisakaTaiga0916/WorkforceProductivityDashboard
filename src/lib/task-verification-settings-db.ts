import {
  getPlatformSettingJson,
  setPlatformSettingJson,
} from "@/lib/platform-settings";
import { withTtlCache, invalidateTtlCache } from "@/lib/ttl-cache";
import {
  DEFAULT_TASK_VERIFICATION_SETTINGS,
  TASK_VERIFICATION_SETTING_KEY,
  parseTaskVerificationSettings,
  type TaskVerificationSettings,
} from "@/lib/task-verification-settings";

const CACHE_KEY = `platform-setting:${TASK_VERIFICATION_SETTING_KEY}:v1`;
const CACHE_TTL_MS = 30_000;

/** Server-only: read whether task completion verification is enabled. */
export async function getTaskVerificationSettings(): Promise<TaskVerificationSettings> {
  return withTtlCache(CACHE_KEY, CACHE_TTL_MS, async () => {
    const raw = await getPlatformSettingJson(TASK_VERIFICATION_SETTING_KEY);
    return parseTaskVerificationSettings(raw ?? DEFAULT_TASK_VERIFICATION_SETTINGS);
  });
}

export async function isTaskCompletionVerificationEnabled(): Promise<boolean> {
  const settings = await getTaskVerificationSettings();
  return settings.enabled !== false;
}

/** Server-only: persist SuperAdmin toggle. */
export async function setTaskVerificationSettings(
  next: TaskVerificationSettings,
): Promise<TaskVerificationSettings> {
  const parsed = parseTaskVerificationSettings(next);
  await setPlatformSettingJson(TASK_VERIFICATION_SETTING_KEY, parsed);
  invalidateTtlCache(CACHE_KEY);
  return parsed;
}
