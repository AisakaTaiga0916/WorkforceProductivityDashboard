/** Scroll targets for post-approval Job Order panels in Request controls. */
export const JOB_ORDER_TASK_BOARD_SECTION_ID = "jo-task-board-section";
export const JOB_ORDER_EXECUTION_TEAM_SECTION_ID = "jo-execution-team-section";
export const JOB_ORDER_ASSISTANCE_TEAM_SECTION_ID = "jo-assistance-team-section";

export type JobOrderScrollSection = "task-board" | "execution-team" | "assistance-team";

const SECTION_BY_KEY: Record<JobOrderScrollSection, string> = {
  "task-board": JOB_ORDER_TASK_BOARD_SECTION_ID,
  "execution-team": JOB_ORDER_EXECUTION_TEAM_SECTION_ID,
  "assistance-team": JOB_ORDER_ASSISTANCE_TEAM_SECTION_ID,
};

export function jobOrderSectionIdForKey(key: JobOrderScrollSection): string {
  return SECTION_BY_KEY[key];
}

export function scrollToJobOrderSection(sectionId: string): void {
  if (typeof document === "undefined") return;
  const el = document.getElementById(sectionId);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
  el.classList.add("jo-section-highlight");
  window.setTimeout(() => {
    el.classList.remove("jo-section-highlight");
  }, 2200);
}

export function resolveJobOrderSectionFromHash(hash: string): JobOrderScrollSection | null {
  const raw = hash.replace(/^#/, "").trim();
  if (raw === "jo-task-board" || raw === JOB_ORDER_TASK_BOARD_SECTION_ID) return "task-board";
  if (raw === "jo-execution-team" || raw === JOB_ORDER_EXECUTION_TEAM_SECTION_ID) {
    return "execution-team";
  }
  if (raw === "jo-assistance-team" || raw === JOB_ORDER_ASSISTANCE_TEAM_SECTION_ID) {
    return "assistance-team";
  }
  return null;
}
