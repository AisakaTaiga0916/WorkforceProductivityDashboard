/** One-shot Work URL params, shared by server links (dashboard) and client hooks. */
export const WORK_CREATE_PARAM = "create";
/** `/work/tasks?approvals=1` opens the For My Approval queue (linked from the dashboard). */
export const WORK_APPROVALS_PARAM = "approvals";

/** Work Plans create is a full-page wizard; `/work/work-plans?create=1` redirects here. */
export const NEW_WORK_PLAN_HREF = "/work/work-plans/new";

/** `/work/<tab>?create=1` opens that tab's own create modal (Add Task, Add Project). */
export function workCreateHref(tabHref: string): string {
  return `${tabHref}?${WORK_CREATE_PARAM}=1`;
}
