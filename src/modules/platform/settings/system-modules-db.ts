import { NextResponse } from "next/server";
import { getPlatformSettingJson, setPlatformSettingJson } from "@/lib/platform-settings";
import {
  SYSTEM_MODULE_LABELS,
  SYSTEM_MODULES_SETTING_KEY,
  parseSystemModuleVisibility,
  type SystemModuleId,
  type SystemModuleVisibility,
} from "@/modules/platform/settings/system-modules";

/** Mutation APIs consult this on every request; a few seconds of staleness is fine. */
const CACHE_MS = 5_000;
let cache: { value: SystemModuleVisibility; expiresAt: number } | null = null;

/** Server-only: tenant-wide module visibility from platform_settings. */
export async function getSystemModuleVisibility(): Promise<SystemModuleVisibility> {
  if (cache && cache.expiresAt > Date.now()) return cache.value;
  const value = parseSystemModuleVisibility(
    await getPlatformSettingJson(SYSTEM_MODULES_SETTING_KEY),
  );
  cache = { value, expiresAt: Date.now() + CACHE_MS };
  return value;
}

export async function setSystemModuleVisibility(
  next: SystemModuleVisibility,
): Promise<SystemModuleVisibility> {
  const parsed = parseSystemModuleVisibility({ modules: next });
  await setPlatformSettingJson(SYSTEM_MODULES_SETTING_KEY, { modules: parsed });
  cache = { value: parsed, expiresAt: Date.now() + CACHE_MS };
  return parsed;
}

export async function isSystemModuleEnabled(id: SystemModuleId): Promise<boolean> {
  return (await getSystemModuleVisibility())[id];
}

/** 403 for mutation APIs of a module turned off in System Settings; `null` when on. */
export async function moduleDisabledResponse(id: SystemModuleId): Promise<NextResponse | null> {
  if (await isSystemModuleEnabled(id)) return null;
  return NextResponse.json(
    {
      error: `${SYSTEM_MODULE_LABELS[id]} is turned off in System Settings.`,
      code: "MODULE_DISABLED",
      module: id,
    },
    { status: 403 },
  );
}
