/**
 * RBAC permission catalog.
 *
 * Stable, human-readable permission keys of the form `<resource>.<action>`.
 * This module is the single source of truth for permission identifiers and is
 * shared by the IAM seed, the authorization helpers, and the Roles matrix UI.
 *
 * Locked decisions:
 * - Actions are CRUD plus `assign`, `approve`, `verify`, and `submit`
 *   (plus `export`, `archive`, `manage_permissions` where a real operation exists).
 * - Only combinations that correspond to real business operations are defined.
 * - Permissions answer *what* a user may do. Company scope and workflow/seat
 *   eligibility are enforced by separate layers.
 */

export const PERMISSION_RESOURCES = [
  "requests",
  "tasks",
  "work_plans",
  "hierarchy",
  "users",
  "settings",
  "reports",
  "rbac",
] as const;
export type PermissionResource = (typeof PERMISSION_RESOURCES)[number];

export const PERMISSION_RESOURCE_LABELS: Record<PermissionResource, string> = {
  requests: "Requests",
  tasks: "Tasks",
  work_plans: "Work Plans",
  hierarchy: "Hierarchy / Org Chart",
  users: "Users",
  settings: "System Settings",
  reports: "Reports",
  rbac: "Roles & Permissions",
};

export const PERMISSION_ACTIONS = [
  "create",
  "read",
  "update",
  "delete",
  "assign",
  "approve",
  "verify",
  "submit",
  "export",
  "archive",
  "manage_permissions",
] as const;
export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

export type PermissionDefinition = {
  key: string;
  resource: PermissionResource;
  action: PermissionAction;
  description: string;
};

const CATALOG = [
  // Requests (tickets)
  {
    key: "requests.create",
    resource: "requests",
    action: "create",
    description: "Create a new request within the user's permitted scope.",
  },
  {
    key: "requests.read",
    resource: "requests",
    action: "read",
    description: "View requests the user is authorized to access.",
  },
  {
    key: "requests.update",
    resource: "requests",
    action: "update",
    description: "Update the details of an authorized request.",
  },
  {
    key: "requests.delete",
    resource: "requests",
    action: "delete",
    description: "Delete a request. Reserved; not granted by default templates.",
  },
  {
    key: "requests.assign",
    resource: "requests",
    action: "assign",
    description: "Assign or reassign a request to an eligible employee.",
  },
  {
    key: "requests.approve",
    resource: "requests",
    action: "approve",
    description:
      "Approve a request when the workflow authorizes the user (seat and company scope still apply).",
  },
  {
    key: "requests.submit",
    resource: "requests",
    action: "submit",
    description: "Submit a request or advance it to the next workflow step.",
  },

  // Tasks (Task Board / KPI work items)
  {
    key: "tasks.create",
    resource: "tasks",
    action: "create",
    description: "Create a task or KPI work item.",
  },
  {
    key: "tasks.read",
    resource: "tasks",
    action: "read",
    description: "View tasks the user is authorized to access.",
  },
  {
    key: "tasks.update",
    resource: "tasks",
    action: "update",
    description: "Update task details, schedule, or progress.",
  },
  {
    key: "tasks.delete",
    resource: "tasks",
    action: "delete",
    description: "Delete a task. Reserved; not granted by default templates.",
  },
  {
    key: "tasks.assign",
    resource: "tasks",
    action: "assign",
    description: "Assign or reassign a task to an eligible employee.",
  },
  {
    key: "tasks.verify",
    resource: "tasks",
    action: "verify",
    description:
      "Verify task completion when the workflow authorizes the user (verifier or org-chart head).",
  },
  {
    key: "tasks.submit",
    resource: "tasks",
    action: "submit",
    description: "Mark assigned task work complete and submit it for verification.",
  },

  // Work Plans / Terms of Order
  {
    key: "work_plans.create",
    resource: "work_plans",
    action: "create",
    description: "Create a Work Plan or Travel Order.",
  },
  {
    key: "work_plans.read",
    resource: "work_plans",
    action: "read",
    description: "View Work Plans / Travel Orders the user is authorized to access.",
  },
  {
    key: "work_plans.update",
    resource: "work_plans",
    action: "update",
    description: "Update an authorized Work Plan / Travel Order.",
  },
  {
    key: "work_plans.delete",
    resource: "work_plans",
    action: "delete",
    description: "Delete a Work Plan. Reserved; not granted by default templates.",
  },
  {
    key: "work_plans.assign",
    resource: "work_plans",
    action: "assign",
    description: "Assign approvers or travelers to a Work Plan / Travel Order.",
  },
  {
    key: "work_plans.approve",
    resource: "work_plans",
    action: "approve",
    description:
      "Approve a Work Plan / Travel Order when the approval chain authorizes the user.",
  },
  {
    key: "work_plans.submit",
    resource: "work_plans",
    action: "submit",
    description: "Submit a Work Plan / Travel Order for approval or record field progress.",
  },

  // Hierarchy / org chart
  {
    key: "hierarchy.read",
    resource: "hierarchy",
    action: "read",
    description: "View the organization chart and reports-to relationships.",
  },
  {
    key: "hierarchy.update",
    resource: "hierarchy",
    action: "update",
    description: "Edit organization-chart nodes, sections, and reporting lines.",
  },

  // Users / portal accounts
  {
    key: "users.create",
    resource: "users",
    action: "create",
    description: "Create portal user accounts.",
  },
  {
    key: "users.read",
    resource: "users",
    action: "read",
    description: "View user accounts within the user's permitted scope.",
  },
  {
    key: "users.update",
    resource: "users",
    action: "update",
    description:
      "Update user information within the user's permitted scope. Target-user and company scope are enforced separately.",
  },
  {
    key: "users.delete",
    resource: "users",
    action: "delete",
    description: "Delete user accounts.",
  },
  {
    key: "users.assign",
    resource: "users",
    action: "assign",
    description: "Assign a primary role to a user within the user's permitted scope.",
  },

  // Platform settings
  {
    key: "settings.read",
    resource: "settings",
    action: "read",
    description: "View platform settings.",
  },
  {
    key: "settings.update",
    resource: "settings",
    action: "update",
    description:
      "Change system settings (module visibility, feature flags), triggers, and global configuration.",
  },

  // Reports / metrics
  {
    key: "reports.read",
    resource: "reports",
    action: "read",
    description: "View metrics and reports within the user's permitted scope.",
  },
  {
    key: "reports.export",
    resource: "reports",
    action: "export",
    description: "Export metrics and reports.",
  },

  // RBAC / role management
  {
    key: "rbac.read",
    resource: "rbac",
    action: "read",
    description: "View roles and their permission grants.",
  },
  {
    key: "rbac.create",
    resource: "rbac",
    action: "create",
    description: "Create custom roles, including from a template.",
  },
  {
    key: "rbac.update",
    resource: "rbac",
    action: "update",
    description: "Rename or edit custom roles.",
  },
  {
    key: "rbac.archive",
    resource: "rbac",
    action: "archive",
    description: "Archive eligible (non-system) roles.",
  },
  {
    key: "rbac.manage_permissions",
    resource: "rbac",
    action: "manage_permissions",
    description: "Change role permission grants in the permission matrix.",
  },
] as const satisfies readonly PermissionDefinition[];

export type PermissionKey = (typeof CATALOG)[number]["key"];

/** Full permission catalog, in stable display order. */
export const PERMISSION_CATALOG: readonly PermissionDefinition[] = CATALOG;

const PERMISSION_KEYS = CATALOG.map((p) => p.key);
const PERMISSION_KEY_SET: ReadonlySet<string> = new Set(PERMISSION_KEYS);

/** Every known permission key. */
export const ALL_PERMISSION_KEYS: readonly PermissionKey[] = PERMISSION_KEYS;

export function permissionKeyIsKnown(key: string): key is PermissionKey {
  return PERMISSION_KEY_SET.has(key);
}

export function allPermissionKeys(): PermissionKey[] {
  return [...ALL_PERMISSION_KEYS];
}

/** Group the catalog by resource for the matrix UI. */
export function permissionCatalogByResource(): Array<{
  resource: PermissionResource;
  permissions: PermissionDefinition[];
}> {
  const byResource = new Map<PermissionResource, PermissionDefinition[]>();
  for (const permission of PERMISSION_CATALOG) {
    const list = byResource.get(permission.resource) ?? [];
    list.push(permission);
    byResource.set(permission.resource, list);
  }
  return PERMISSION_RESOURCES.filter((r) => byResource.has(r)).map((resource) => ({
    resource,
    permissions: byResource.get(resource)!,
  }));
}
