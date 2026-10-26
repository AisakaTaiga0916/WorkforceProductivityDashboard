/** Project health rules shared by the dashboard card and Work → Reports (pure). */

type ItemLike = { status: string; dueDate: string | null };
type PhaseLike = { dueDate: string | null; items: ItemLike[] };
type ProjectLike = { status: string; dueDate: string | null; phases: PhaseLike[] };

/** A phase is complete when it has items and every item is DONE. */
export function isProjectPhaseComplete(phase: PhaseLike): boolean {
  return phase.items.length > 0 && phase.items.every((item) => item.status === "DONE");
}

/** Phase past its target date (YYYY-MM-DD compare) and not complete. */
export function isProjectPhaseDelayed(phase: PhaseLike, todayYmd: string): boolean {
  return phase.dueDate != null && phase.dueDate < todayYmd && !isProjectPhaseComplete(phase);
}

/** Open project past its target date, with a delayed phase, or with an overdue open item. */
export function isProjectAtRisk(project: ProjectLike, todayYmd: string): boolean {
  if (project.status === "DONE") return false;
  if (project.dueDate && project.dueDate < todayYmd) return true;
  return project.phases.some(
    (phase) =>
      isProjectPhaseDelayed(phase, todayYmd) ||
      phase.items.some(
        (item) => item.status !== "DONE" && item.dueDate != null && item.dueDate < todayYmd,
      ),
  );
}
