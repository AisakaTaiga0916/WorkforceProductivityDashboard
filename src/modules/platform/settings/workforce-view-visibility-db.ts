import {
  getPlatformSettingJson,
  setPlatformSettingJson,
} from "@/lib/platform-settings";
import {
  WORKFORCE_VIEW_VISIBILITY_KEY,
  isWorkforceViewVisible,
  normalizeWorkforceViewVisibility,
  parseWorkforceViewVisibility,
  type WorkforceViewVisibility,
} from "@/modules/platform/settings/workforce-view-visibility";

/** Server-only: read Workforce toggle visibility from platform_settings.
 *  Normalized on read so stale values (e.g. the removed `list` view, or an
 *  all-hidden state) can never hide every toggle. */
export async function getWorkforceViewVisibility(): Promise<WorkforceViewVisibility> {
  const raw = await getPlatformSettingJson(WORKFORCE_VIEW_VISIBILITY_KEY);
  return normalizeWorkforceViewVisibility(parseWorkforceViewVisibility(raw));
}

/** Server-only: persist Workforce toggle visibility. */
export async function setWorkforceViewVisibility(
  next: WorkforceViewVisibility,
): Promise<WorkforceViewVisibility> {
  const parsed = normalizeWorkforceViewVisibility(next);
  await setPlatformSettingJson(WORKFORCE_VIEW_VISIBILITY_KEY, parsed);
  return parsed;
}

/**
 * When Workforce → Activity is hidden, clock-in / On Duty is not tracked in-app,
 * so task assignment must not require assignees to be clocked in today.
 */
export async function isTaskAssignmentOnDutyRequired(): Promise<boolean> {
  const visibility = await getWorkforceViewVisibility();
  return isWorkforceViewVisible(visibility, "activity");
}
