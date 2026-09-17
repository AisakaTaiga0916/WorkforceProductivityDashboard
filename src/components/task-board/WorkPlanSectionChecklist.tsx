"use client";

import { cn } from "@/lib/cn";
import {
  WORK_PLAN_WIZARD_STEPS,
  type WorkPlanSectionId,
} from "@/lib/work-plan";

type WorkPlanSectionChecklistProps = {
  completeById: Partial<Record<WorkPlanSectionId, boolean>>;
  activeId: WorkPlanSectionId | null;
  onSelect: (id: WorkPlanSectionId) => void;
};

/** Wizard step rail for Work Plan intake. */
export function WorkPlanSectionChecklist({
  completeById,
  activeId,
  onSelect,
}: WorkPlanSectionChecklistProps) {
  return (
    <nav
      aria-label="Travel Order steps"
      className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-0.5"
    >
      {WORK_PLAN_WIZARD_STEPS.map((item, index) => {
        const done = completeById[item.id] === true;
        const active = activeId === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item.id)}
            className={cn(
              "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold transition",
              active
                ? "bg-orange-600 text-white"
                : done
                  ? "bg-emerald-500/15 text-emerald-800 dark:text-emerald-200"
                  : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700",
            )}
          >
            <span
              className={cn(
                "inline-flex size-4 items-center justify-center rounded-full text-[9px] font-bold",
                active
                  ? "bg-white/20 text-white"
                  : done
                    ? "bg-emerald-600 text-white"
                    : "bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300",
              )}
            >
              {done && !active ? "✓" : index + 1}
            </span>
            {item.label}
          </button>
        );
      })}
    </nav>
  );
}
