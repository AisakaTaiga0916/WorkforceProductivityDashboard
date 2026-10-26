import { describe, expect, it } from "vitest";
import {
  DEFAULT_SYSTEM_MODULE_VISIBILITY,
  isHrefVisibleForModules,
  parseSystemModuleVisibility,
  systemModuleForHref,
} from "@/modules/platform/settings/system-modules";

describe("system module visibility", () => {
  it("defaults every module on and ignores junk", () => {
    expect(parseSystemModuleVisibility(null)).toEqual(DEFAULT_SYSTEM_MODULE_VISIBILITY);
    expect(parseSystemModuleVisibility({ modules: { tasks: "no", bogus: false } })).toEqual(
      DEFAULT_SYSTEM_MODULE_VISIBILITY,
    );
    expect(parseSystemModuleVisibility({ modules: { tasks: false } }).tasks).toBe(false);
  });

  it("maps nav hrefs to modules by exact path", () => {
    expect(systemModuleForHref("/agent")).toBe("requests");
    expect(systemModuleForHref("/agent?pane=mine")).toBe("requests");
    expect(systemModuleForHref("/work/tasks")).toBe("tasks");
    expect(systemModuleForHref("/agent/tasks")).toBe("tasks");
    expect(systemModuleForHref("/work/projects")).toBe("projects");
    expect(systemModuleForHref("/travel-orders")).toBe("work_plans");
    expect(systemModuleForHref("/work/work-plans")).toBe("work_plans");
    expect(systemModuleForHref("/admin/workforce")).toBeNull();
  });

  it("keeps the /work hub visible while any Work module is on", () => {
    const allWorkOff = {
      ...DEFAULT_SYSTEM_MODULE_VISIBILITY,
      tasks: false,
      projects: false,
      work_plans: false,
    };
    expect(isHrefVisibleForModules("/work", allWorkOff)).toBe(false);
    expect(isHrefVisibleForModules("/work", { ...allWorkOff, work_plans: true })).toBe(true);
    expect(isHrefVisibleForModules("/work/reports", allWorkOff)).toBe(false);
    expect(isHrefVisibleForModules("/work/reports", { ...allWorkOff, projects: true })).toBe(true);
  });

  it("gates Request Reports with the requests module", () => {
    expect(systemModuleForHref("/agent/reports")).toBe("requests");
    expect(
      isHrefVisibleForModules("/agent/reports", { ...DEFAULT_SYSTEM_MODULE_VISIBILITY, requests: false }),
    ).toBe(false);
  });

  it("hides links for disabled modules only", () => {
    const modules = { ...DEFAULT_SYSTEM_MODULE_VISIBILITY, tasks: false };
    expect(isHrefVisibleForModules("/work/tasks", modules)).toBe(false);
    expect(isHrefVisibleForModules("/work/projects", modules)).toBe(true);
    expect(isHrefVisibleForModules("/agent", modules)).toBe(true);
    expect(isHrefVisibleForModules("/admin/workforce", modules)).toBe(true);
  });

  it("parses the projects module toggle", () => {
    expect(parseSystemModuleVisibility({ modules: { projects: false } }).projects).toBe(false);
    expect(DEFAULT_SYSTEM_MODULE_VISIBILITY.projects).toBe(true);
  });
});
