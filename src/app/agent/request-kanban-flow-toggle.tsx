"use client";

import { Building2, Layers } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import {
  readRequestKanbanFlowMode,
  writeRequestKanbanFlowMode,
  type RequestKanbanFlowMode,
} from "@/modules/requests/request-kanban-flow";

const OPTIONS: Array<{ id: RequestKanbanFlowMode; label: string; icon: typeof Building2 }> = [
  { id: "company", label: "Company", icon: Building2 },
  { id: "department", label: "Department", icon: Layers },
];

/** Chooses company vs department grouping for Assign Requests kanban drag flow. */
export function RequestKanbanFlowToggle({ className }: { className?: string }) {
  const [mode, setMode] = useState<RequestKanbanFlowMode>("department");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setMode(readRequestKanbanFlowMode());
    setReady(true);
  }, []);

  function select(next: RequestKanbanFlowMode) {
    setMode(next);
    writeRequestKanbanFlowMode(next);
  }

  return (
    <div
      role="tablist"
      aria-label="Request kanban drag flow"
      title="Sets how Assign Requests groups people for drag-and-drop (company or team)"
      className={cn(
        "inline-flex w-full rounded-lg border border-zinc-300 bg-zinc-100 p-0.5 text-xs font-semibold sm:w-auto dark:border-zinc-600 dark:bg-zinc-900/80",
        className,
      )}
    >
      <span className="hidden items-center px-2 text-[10px] font-bold uppercase tracking-wide text-zinc-500 sm:inline-flex">
        Kanban flow
      </span>
      {OPTIONS.map((option) => {
        const selected = ready && mode === option.id;
        const Icon = option.icon;
        return (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => select(option.id)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 transition sm:flex-none",
              selected
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "text-zinc-700 hover:bg-zinc-200/80 dark:text-zinc-300 dark:hover:bg-zinc-800",
            )}
          >
            <Icon className="size-3.5" aria-hidden />
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
