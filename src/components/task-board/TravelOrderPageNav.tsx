"use client";

import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";

export type TravelOrderFormPage = 1 | 2 | 3 | 4;

type TravelOrderPageNavProps = {
  page: TravelOrderFormPage;
  onPageChange: (page: TravelOrderFormPage) => void;
  /** When false, hide the Gate Pass tab (Details + Approvals only). Default true. */
  showGatePass?: boolean;
  /** Work plans: insert Venues / Locations between Details and Approvals. */
  showLocationsTab?: boolean;
  /** When false, omit Back/Next (tabs only). Default true. */
  showStepButtons?: boolean;
  /** Disable Next (e.g. while busy). */
  nextDisabled?: boolean;
  /** Disable Back. */
  backDisabled?: boolean;
  /** Extra controls rendered beside Back/Next (e.g. Cancel). */
  stepActions?: ReactNode;
  className?: string;
};

function workPlanPageTabs(showLocationsTab: boolean, showGatePass: boolean) {
  if (showLocationsTab) {
    return [
      { page: 1 as const, label: "Details" },
      { page: 2 as const, label: "Venues / Locations" },
      { page: 3 as const, label: "Approvals" },
      ...(showGatePass ? [{ page: 4 as const, label: "Gate Pass" }] : []),
    ];
  }
  return [
    { page: 1 as const, label: "Details" },
    { page: 2 as const, label: "Approvals" },
    ...(showGatePass ? [{ page: 3 as const, label: "Gate Pass" }] : []),
  ];
}

/** Tab switcher + optional Back/Next for Work Plan / legacy Travel Order forms. */
export function TravelOrderPageNav({
  page,
  onPageChange,
  showGatePass = true,
  showLocationsTab = false,
  showStepButtons = true,
  nextDisabled = false,
  backDisabled = false,
  stepActions,
  className,
}: TravelOrderPageNavProps) {
  const showActions = showStepButtons || stepActions;
  const tabs = workPlanPageTabs(showLocationsTab, showGatePass);
  const tabIndex = Math.max(
    0,
    tabs.findIndex((tab) => tab.page === page),
  );
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 pb-3 dark:border-zinc-800",
        className,
      )}
    >
      <div
        className="inline-flex flex-wrap rounded-lg border border-zinc-200 bg-zinc-50 p-0.5 dark:border-zinc-700 dark:bg-zinc-900/60"
        role="tablist"
        aria-label="Travel order pages"
      >
        {tabs.map((tab, index) => (
          <button
            key={tab.page}
            type="button"
            role="tab"
            aria-selected={page === tab.page}
            onClick={() => onPageChange(tab.page)}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
              page === tab.page
                ? "bg-orange-600 text-white shadow-sm"
                : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100",
            )}
          >
            {index + 1} · {tab.label}
          </button>
        ))}
      </div>

      {showActions ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {showStepButtons && tabIndex > 0 ? (
            <button
              type="button"
              disabled={backDisabled}
              onClick={() => onPageChange(tabs[tabIndex - 1]!.page)}
              className="inline-flex items-center gap-1 rounded-md border border-zinc-200 px-2.5 py-1.5 text-xs font-semibold text-zinc-700 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Back
            </button>
          ) : null}
          {stepActions}
          {showStepButtons && tabIndex < tabs.length - 1 ? (
            <button
              type="button"
              disabled={nextDisabled}
              onClick={() => onPageChange(tabs[tabIndex + 1]!.page)}
              className="inline-flex items-center gap-1 rounded-md bg-orange-600 px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              Next
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Tailwind grid columns for horizontal approval stamp rows (left → right). */
export function travelOrderApprovalGridClass(count: number): string {
  const n = Math.min(Math.max(count, 1), 5);
  if (n <= 1) return "grid grid-cols-1 items-stretch gap-x-3 gap-y-3";
  if (n === 2) return "grid grid-cols-1 items-stretch gap-x-3 gap-y-3 sm:grid-cols-2";
  if (n === 3) return "grid grid-cols-1 items-stretch gap-x-3 gap-y-3 md:grid-cols-3";
  if (n === 4) return "grid grid-cols-1 items-stretch gap-x-3 gap-y-3 sm:grid-cols-2 xl:grid-cols-4";
  return "grid grid-cols-1 items-stretch gap-x-3 gap-y-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5";
}
