/** Canonical task / KPI pillar titles (Task management intake + task metrics grid). */
export const IT_TASK_PILLAR_TITLES = [
  "HELPDESK SUPPORT",
  "DATA BACKUP",
  "SYSTEM MAINTENANCE",
  "MONITORING",
  "DOCUMENTATION",
  "USER SUPPORT",
  "IT PROJECT IMPLEMENTATION",
] as const;

export const IT_PROJECT_IMPLEMENTATION_TITLE = "IT PROJECT IMPLEMENTATION" as const;

/**
 * Default task-group title for Job Order → Project creates.
 * Projects land here (tagged as project) until moved into another group while assigned/running.
 */
export const JOB_ORDER_REQUEST_PILLAR_TITLE = "JOB ORDER REQUEST" as const;

export function isItProjectImplementationPillar(title: string): boolean {
  return title.trim() === IT_PROJECT_IMPLEMENTATION_TITLE;
}

export function isJobOrderRequestPillar(title: string): boolean {
  return title.trim().toUpperCase() === JOB_ORDER_REQUEST_PILLAR_TITLE;
}

/** Task title dropdown — excludes pillars tracked outside KPI maintenance (helpdesk tickets, etc.). */
export const IT_TASK_PILLAR_SELECT_OPTIONS = [
  "DATA BACKUP",
  "SYSTEM MAINTENANCE",
  "MONITORING",
  "DOCUMENTATION",
  "IT PROJECT IMPLEMENTATION",
] as const;

export type ItTaskPillarTitle = (typeof IT_TASK_PILLAR_TITLES)[number];
export type ItTaskPillarSelectOption = (typeof IT_TASK_PILLAR_SELECT_OPTIONS)[number];

export function isItTaskPillarTitle(value: string): value is ItTaskPillarTitle {
  return (IT_TASK_PILLAR_TITLES as readonly string[]).includes(value);
}

export function isSelectableItTaskPillarTitle(value: string): value is ItTaskPillarSelectOption {
  return (IT_TASK_PILLAR_SELECT_OPTIONS as readonly string[]).includes(value);
}
