import { isItProjectImplementationPillar } from "@/modules/tasks/it-task-pillar-titles";
import { isFieldAssignmentTask, isProjectTask } from "@/modules/tasks/kpi-subkpis";
import { usesProjectTimelineTracker } from "@/modules/tasks/it-project-subkpis";

/** Concrete task-type buckets for company Task Metrics. */
export type TaskMetricsTaskType = "task" | "project" | "field" | "requests";

/** Smart-filter value — `ALL` = every type on one page, sectioned. */
export type TaskMetricsTaskTypeFilter = TaskMetricsTaskType | "ALL";

export const TASK_METRICS_TASK_TYPE_OPTIONS: Array<{
  value: TaskMetricsTaskType;
  label: string;
}> = [
  { value: "task", label: "Task" },
  { value: "project", label: "Project" },
  { value: "field", label: "Field Assignment" },
  { value: "requests", label: "Requests" },
];

/** Section order when the Task filter is cleared (all types). */
export const TASK_METRICS_ALL_TYPE_SECTIONS: Array<{
  value: TaskMetricsTaskType;
  label: string;
}> = TASK_METRICS_TASK_TYPE_OPTIONS;

/** Fixed donut order when Task Type = Task. */
export const TASK_FREQUENCY_DONUT_KEYS = [
  "ONE-OFF",
  "DAILY",
  "WEEKLY",
  "MONTHLY",
  "QUARTERLY",
  "SEMI_ANNUAL",
  "YEARLY",
] as const;

export type TaskFrequencyDonutKey = (typeof TASK_FREQUENCY_DONUT_KEYS)[number];

export const FIELD_ASSIGNMENT_DONUT_KEY = "FIELD ASSIGNMENT";
/** Single company-view donut for every Project (extended view lists each project). */
export const PROJECTS_DONUT_KEY = "PROJECTS";

export function parseTaskMetricsTaskType(raw: string | null | undefined): TaskMetricsTaskType {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "project" || v === "field" || v === "requests") return v;
  return "task";
}

/** URL / smart-filter: missing, blank, or `all` → unscoped (all types). */
export function parseTaskMetricsTaskTypeFilter(
  raw: string | null | undefined,
): TaskMetricsTaskTypeFilter {
  const v = (raw ?? "").trim().toLowerCase();
  if (!v || v === "all") return "ALL";
  if (v === "project" || v === "field" || v === "requests" || v === "task") return v;
  return "ALL";
}

function isProjectLike(row: { title: string; subKpis: unknown }): boolean {
  return (
    isItProjectImplementationPillar(row.title) ||
    isProjectTask(row.subKpis) ||
    usesProjectTimelineTracker(row.subKpis)
  );
}

function isFieldLike(row: { subKpis: unknown }): boolean {
  return isFieldAssignmentTask(row.subKpis);
}

/** Classify a KPI row the same way the Task Board category filter does. */
export function taskMetricsCategoryOf(row: {
  title: string;
  subKpis: unknown;
}): Exclude<TaskMetricsTaskType, "requests"> {
  if (isFieldLike(row)) return "field";
  if (isProjectLike(row)) return "project";
  return "task";
}

export function kpiMatchesTaskMetricsType(
  row: { title: string; subKpis: unknown },
  taskType: TaskMetricsTaskType,
): boolean {
  // Requests is ticket-based (HELPDESK / USER SUPPORT), not KpiMaintenance rows.
  if (taskType === "requests") return false;
  return taskMetricsCategoryOf(row) === taskType;
}

/**
 * Donut key for the selected Task Type:
 * - Task → ONE-OFF / DAILY / WEEKLY / MONTHLY / QUARTERLY / SEMI_ANNUAL / YEARLY
 * - Project → single PROJECTS bucket (all projects)
 * - Field Assignment → single FIELD ASSIGNMENT bucket
 * - Requests → no checklist donuts (ticket HELPDESK / USER SUPPORT only)
 */
export function donutKeyForTaskMetricsRow(
  row: {
    title: string;
    mainTask?: string | null;
    itProjectName?: string | null;
    isRecurring?: boolean | null;
    frequency?: string | null;
    subKpis: unknown;
  },
  taskType: TaskMetricsTaskType,
): string | null {
  if (taskType === "requests") return null;
  if (!kpiMatchesTaskMetricsType(row, taskType)) return null;

  if (taskType === "field") return FIELD_ASSIGNMENT_DONUT_KEY;
  if (taskType === "project") return PROJECTS_DONUT_KEY;

  if (row.isRecurring === false) return "ONE-OFF";
  const frequency = String(row.frequency ?? "").trim().toUpperCase();
  if (
    frequency === "DAILY" ||
    frequency === "WEEKLY" ||
    frequency === "MONTHLY" ||
    frequency === "QUARTERLY" ||
    frequency === "SEMI_ANNUAL" ||
    frequency === "YEARLY"
  ) {
    return frequency;
  }
  return "ONE-OFF";
}
