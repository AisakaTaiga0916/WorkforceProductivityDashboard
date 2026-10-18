import {
  getPlatformSettingJson,
  setPlatformSettingJson,
} from "@/lib/platform-settings";
import {
  INTAKE_REQUEST_TYPE_VISIBILITY_KEY,
  parseIntakeRequestTypeVisibility,
  type IntakeRequestTypeVisibility,
} from "@/modules/platform/settings/intake-request-type-visibility";
import { REQUEST_TYPES } from "@/modules/requests/request-types";

export async function getIntakeRequestTypeVisibility(): Promise<IntakeRequestTypeVisibility> {
  const raw = await getPlatformSettingJson(INTAKE_REQUEST_TYPE_VISIBILITY_KEY);
  return parseIntakeRequestTypeVisibility(raw);
}

export async function setIntakeRequestTypeVisibility(
  next: IntakeRequestTypeVisibility,
): Promise<IntakeRequestTypeVisibility> {
  const parsed = parseIntakeRequestTypeVisibility(next);
  const visibleCount = REQUEST_TYPES.length - parsed.hiddenTypeIds.length;
  if (visibleCount < 1) {
    throw new Error("At least one request type must remain visible on create request.");
  }
  await setPlatformSettingJson(INTAKE_REQUEST_TYPE_VISIBILITY_KEY, parsed);
  return parsed;
}
