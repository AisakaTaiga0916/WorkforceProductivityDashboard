import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform-settings", () => ({
  getPlatformSettingJson: vi.fn(),
  setPlatformSettingJson: vi.fn(),
}));

import { getPlatformSettingJson } from "@/lib/platform-settings";
import { moduleDisabledResponse, setSystemModuleVisibility } from "@/modules/platform/settings/system-modules-db";

const getSetting = vi.mocked(getPlatformSettingJson);

beforeEach(async () => {
  vi.clearAllMocks();
  await setSystemModuleVisibility({ requests: true, tasks: true, work_plans: true });
});

describe("moduleDisabledResponse", () => {
  it("passes when the module is on", async () => {
    expect(await moduleDisabledResponse("tasks")).toBeNull();
  });

  it("returns a MODULE_DISABLED 403 when the module is off", async () => {
    await setSystemModuleVisibility({ requests: true, tasks: false, work_plans: true });
    const res = await moduleDisabledResponse("tasks");
    expect(res?.status).toBe(403);
    expect(await res?.json()).toMatchObject({ code: "MODULE_DISABLED", module: "tasks" });
    expect(await moduleDisabledResponse("work_plans")).toBeNull();
  });

  it("serves repeat checks from the short cache", async () => {
    await moduleDisabledResponse("requests");
    await moduleDisabledResponse("requests");
    expect(getSetting).not.toHaveBeenCalled();
  });
});
