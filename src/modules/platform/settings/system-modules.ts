/** System setting: tenant-wide module visibility (SuperAdmin Settings → System Settings). */

export const SYSTEM_MODULES_SETTING_KEY = "system_module_visibility";

export const SYSTEM_MODULE_IDS = ["requests", "tasks", "projects", "work_plans"] as const;
export type SystemModuleId = (typeof SYSTEM_MODULE_IDS)[number];

export type SystemModuleVisibility = Record<SystemModuleId, boolean>;

export const DEFAULT_SYSTEM_MODULE_VISIBILITY: SystemModuleVisibility = {
  requests: true,
  tasks: true,
  projects: true,
  work_plans: true,
};

export const SYSTEM_MODULE_LABELS: Record<SystemModuleId, string> = {
  requests: "Requests",
  tasks: "Tasks",
  projects: "Projects",
  work_plans: "Work Plans",
};

export const SYSTEM_MODULE_BLURBS: Record<SystemModuleId, string> = {
  requests: "Request intake, My Requests, and the request boards.",
  tasks: "Task Board / KPI work items and verification.",
  projects: "Project status board and project delivery tracking.",
  work_plans: "Work → Work Plans (Travel Orders) and the gate-pass kiosk.",
};

/** Pages owned by each module (exact path match; `/work/tasks` is not `/work`). */
const MODULE_PATHS: Record<SystemModuleId, readonly string[]> = {
  requests: ["/agent", "/agent/reports", "/tickets/new"],
  tasks: ["/work/tasks", "/agent/tasks"],
  projects: ["/work/projects"],
  work_plans: ["/work/work-plans", "/travel-orders"],
};

/** Work area modules — `/work` and `/work/reports` stay visible while any of them is on. */
const WORK_AREA_MODULES: readonly SystemModuleId[] = ["tasks", "projects", "work_plans"];

export function parseSystemModuleVisibility(raw: unknown): SystemModuleVisibility {
  const next = { ...DEFAULT_SYSTEM_MODULE_VISIBILITY };
  const modules =
    raw && typeof raw === "object" ? (raw as { modules?: unknown }).modules : undefined;
  if (modules && typeof modules === "object") {
    for (const id of SYSTEM_MODULE_IDS) {
      const value = (modules as Record<string, unknown>)[id];
      if (typeof value === "boolean") next[id] = value;
    }
  }
  return next;
}

/** Module that owns a nav href (query string ignored), or null when always visible. */
export function systemModuleForHref(href: string): SystemModuleId | null {
  const path = href.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  for (const id of SYSTEM_MODULE_IDS) {
    if (MODULE_PATHS[id].includes(path)) return id;
  }
  return null;
}

export function isHrefVisibleForModules(href: string, modules: SystemModuleVisibility): boolean {
  const path = href.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  if (path === "/work" || path === "/work/reports") {
    return WORK_AREA_MODULES.some((id) => modules[id]);
  }
  const id = systemModuleForHref(href);
  return id === null || modules[id];
}
