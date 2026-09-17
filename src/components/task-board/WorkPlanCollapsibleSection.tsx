"use client";

import { useState, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";

type WorkPlanCollapsibleSectionProps = {
  id?: string;
  title: string;
  /** Controlled open state. When set with onOpenChange, section is controlled. */
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** When true, show a completed check in the header. */
  complete?: boolean;
  summary?: string | null;
  children: ReactNode;
};

/** Accordion panel for the Work Plan document (supports controlled exclusive open). */
export function WorkPlanCollapsibleSection({
  id,
  title,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  complete = false,
  summary = null,
  children,
}: WorkPlanCollapsibleSectionProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const controlled = typeof openProp === "boolean";
  const isOpen = controlled ? openProp : uncontrolledOpen;

  function toggle() {
    const next = !isOpen;
    if (controlled) onOpenChange?.(next);
    else setUncontrolledOpen(next);
  }

  return (
    <section
      id={id}
      className="scroll-mt-28 overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-700"
    >
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center justify-between gap-3 bg-zinc-50 px-3 py-2.5 text-left dark:bg-zinc-900/60"
        aria-expanded={isOpen}
      >
        <div className="flex min-w-0 items-start gap-2">
          <span
            className={cn(
              "mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full border",
              complete
                ? "border-emerald-500 bg-emerald-500 text-white"
                : "border-zinc-300 dark:border-zinc-600",
            )}
            aria-hidden
          >
            {complete ? <Check className="size-2.5" strokeWidth={3} /> : null}
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-orange-700 dark:text-orange-300">
              {title}
            </p>
            {!isOpen && summary ? (
              <p className="mt-0.5 truncate text-xs text-zinc-500">{summary}</p>
            ) : null}
          </div>
        </div>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-zinc-500 transition-transform",
            isOpen ? "rotate-180" : "",
          )}
          aria-hidden
        />
      </button>
      {isOpen ? <div className="space-y-3 p-3 sm:p-4">{children}</div> : null}
    </section>
  );
}
