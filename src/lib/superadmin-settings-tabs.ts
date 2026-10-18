/** SuperAdmin Settings tabs (`/admin/superadmin-settings?tab=`). Shared by server page + client nav. */

export const SUPERADMIN_SETTINGS_TABS = [
  { id: "roles", label: "Roles" },
  { id: "users", label: "User Management" },
  { id: "system", label: "System Settings" },
] as const;

export type SuperAdminSettingsTab = (typeof SUPERADMIN_SETTINGS_TABS)[number]["id"];

const TAB_IDS = new Set<string>(SUPERADMIN_SETTINGS_TABS.map((t) => t.id));

export function parseSuperAdminSettingsTab(
  value: string | null | undefined,
): SuperAdminSettingsTab {
  // Priority alerts and task verification live in System Settings.
  if (value === "alerts" || value === "tasks") return "system";
  if (value && TAB_IDS.has(value)) return value as SuperAdminSettingsTab;
  return "roles";
}

export function superAdminSettingsHref(tab: SuperAdminSettingsTab): string {
  return `/admin/superadmin-settings?tab=${tab}`;
}
