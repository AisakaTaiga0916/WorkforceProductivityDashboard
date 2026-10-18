"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  isItProjectPhaseDelayed,
  itProjectPhaseProgressFromItems,
  resolvePhaseEffectiveTargetDate,
  resolvePhaseOwnTargetDate,
  type ItProjectPhase,
} from "@/modules/tasks/it-project-subkpis";
import { cn } from "@/lib/cn";
import { DatePickerField } from "@/components/ui/DatePickerField";

export type ProjectTimelineKanbanProps = {
  phases: ItProjectPhase[];
  /** Main project target (pillarDueDate) — overrides phase targets when set. */
  mainProjectDueDate?: string | null;
  timeZone?: string;
  nowMs?: number;
  busy?: boolean;
  /** When set, phase target date is editable on each phase column. */
  onEditPhaseDueDate?: (phaseId: string, dueDate: string) => void;
  renderSubtask: (phase: ItProjectPhase, subtaskId: string) => ReactNode;
  className?: string;
};

function formatTargetDisplay(ymd: string | null): string {
  if (!ymd) return "No target date";
  const [y, m, d] = ymd.split("-");
  if (!y || !m || !d) return ymd;
  return `${m}/${d}/${y}`;
}

function PhaseProgressBar({ percent }: { percent: number }) {
  const clamped = Math.min(100, Math.max(0, percent));
  return (
    <div className="h-2 rounded-full bg-zinc-200/70 dark:bg-zinc-800/60">
      <div
        className="h-full rounded-full bg-orange-500 transition-[width]"
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

/** Horizontal phase columns (stacked on mobile) for IT / JO-linked Timeline Tracker. */
export function ProjectTimelineKanban({
  phases,
  mainProjectDueDate = null,
  timeZone = "Asia/Manila",
  nowMs,
  busy = false,
  onEditPhaseDueDate,
  renderSubtask,
  className,
}: ProjectTimelineKanbanProps) {
  const [viewPhaseId, setViewPhaseId] = useState<string>("ALL");

  const visiblePhases = useMemo(() => {
    if (viewPhaseId === "ALL") return phases;
    const match = phases.find((p) => p.id === viewPhaseId);
    return match ? [match] : phases;
  }, [phases, viewPhaseId]);

  return (
    <div className={cn("space-y-3", className)} aria-busy={busy || undefined}>
      {phases.length > 0 ? (
        <label className="flex max-w-sm flex-col text-[10px] font-bold uppercase tracking-wide text-zinc-600 dark:text-zinc-500">
          Phases
          <select
            value={
              viewPhaseId !== "ALL" && phases.some((p) => p.id === viewPhaseId)
                ? viewPhaseId
                : "ALL"
            }
            onChange={(e) => setViewPhaseId(e.target.value)}
            className="mt-1 rounded-lg border border-orange-400/45 bg-white px-2.5 py-2 text-xs font-semibold text-zinc-900 dark:border-orange-500/35 dark:bg-zinc-950 dark:text-zinc-100"
            aria-label="View phase"
          >
            <option value="ALL">All phases</option>
            {phases.map((phase) => {
              const phaseTarget = resolvePhaseOwnTargetDate(phase);
              return (
                <option key={phase.id} value={phase.id}>
                  {phase.name}
                  {phaseTarget ? ` · ${formatTargetDisplay(phaseTarget)}` : ""}
                </option>
              );
            })}
          </select>
          {mainProjectDueDate?.trim() ? (
            <span className="mt-1 text-[10px] font-medium normal-case tracking-normal text-zinc-500 dark:text-zinc-400">
              Main project target {formatTargetDisplay(mainProjectDueDate.trim())} overrides phase
              targets for delay tracking.
            </span>
          ) : null}
        </label>
      ) : null}

      <div className="flex flex-col gap-3 md:flex-row md:items-start md:gap-3 md:overflow-x-auto md:pb-1">
        {visiblePhases.map((phase) => {
          const phaseTarget = resolvePhaseOwnTargetDate(phase);
          const mainTarget = mainProjectDueDate?.trim()
            ? resolvePhaseEffectiveTargetDate(phase, mainProjectDueDate)
            : null;
          const delayed = isItProjectPhaseDelayed(
            phase,
            timeZone,
            nowMs,
            mainProjectDueDate,
          );
          const progress = itProjectPhaseProgressFromItems(phase);
          return (
            <section
              key={phase.id}
              className={cn(
                "w-full shrink-0 rounded-lg border p-3 md:w-[min(100%,20rem)]",
                delayed
                  ? "border-rose-400/60 bg-rose-500/[0.07] dark:border-rose-500/40 dark:bg-rose-500/10"
                  : "border-orange-400/45 bg-orange-500/[0.06] dark:border-orange-500/35 dark:bg-orange-500/10",
              )}
            >
              <div className="border-b border-orange-400/25 pb-2 dark:border-orange-500/25">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-orange-800 dark:text-orange-200">
                    {phase.name}
                  </p>
                  <span className="text-[10px] font-semibold text-zinc-600 dark:text-zinc-400">
                    {progress.total > 0
                      ? `${progress.done}/${progress.total} · ${progress.percent}%`
                      : "No sub-tasks"}
                  </span>
                </div>
                <div className="mt-1.5 space-y-1.5 text-[11px] text-zinc-600 dark:text-zinc-400">
                  {mainTarget ? (
                    <p>Project target · {formatTargetDisplay(mainTarget)}</p>
                  ) : null}
                  {onEditPhaseDueDate ? (
                    <label className="block text-[9px] font-bold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                      Phase target
                      <DatePickerField
                        value={phaseTarget ?? ""}
                        disabled={busy}
                        onChange={(e) => onEditPhaseDueDate(phase.id, e.target.value)}
                        wrapperClassName="mt-0.5"
                        shellClassName="h-8"
                        aria-label={`${phase.name} target date`}
                      />
                    </label>
                  ) : (
                    <p>Phase target · {formatTargetDisplay(phaseTarget)}</p>
                  )}
                </div>
                {delayed ? (
                  <div
                    role="alert"
                    className="mt-2 rounded-md border border-rose-400/50 bg-rose-500/15 px-2 py-1.5 text-[11px] font-semibold text-rose-900 dark:border-rose-500/40 dark:bg-rose-500/15 dark:text-rose-100"
                  >
                    Delayed —{" "}
                    {mainTarget
                      ? `project target ${formatTargetDisplay(mainTarget)}`
                      : `phase target ${formatTargetDisplay(phaseTarget)}`}
                  </div>
                ) : null}
                {progress.total > 0 ? (
                  <div className="mt-2">
                    <PhaseProgressBar percent={progress.percent} />
                  </div>
                ) : null}
              </div>
              <div className="mt-2 space-y-2">
                {phase.items.length === 0 ? (
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    No sub-tasks in this phase.
                  </p>
                ) : (
                  phase.items.map((item) => (
                    <div key={item.id}>{renderSubtask(phase, item.id)}</div>
                  ))
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
