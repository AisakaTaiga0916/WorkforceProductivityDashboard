/** Client-safe project status constants (shared by API/service and board UI). */

export const PROJECT_STATUSES = ["PENDING", "ON_GOING", "FINALIZING", "DONE"] as const;
export type ProjectStatusValue = (typeof PROJECT_STATUSES)[number];

export const PROJECT_STATUS_LABELS: Record<ProjectStatusValue, string> = {
  PENDING: "Pending",
  ON_GOING: "On Going",
  FINALIZING: "Finalizing",
  DONE: "Done",
};

export function isProjectStatusValue(value: unknown): value is ProjectStatusValue {
  return typeof value === "string" && (PROJECT_STATUSES as readonly string[]).includes(value);
}
