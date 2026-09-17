"use client";

import { Lightbulb, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { collapseDuplicateDesignation } from "@/lib/org-chart-executive-titles";
import type { TravelOrderOrgChartPathSeat } from "@/lib/travel-order";
import type { TravelOrderRecommendedConfirmer } from "@/lib/travel-order-org-chart-path";

type Props = {
  seats: TravelOrderOrgChartPathSeat[];
  requestorOrgLayer?: number | null;
  confirmation?: TravelOrderRecommendedConfirmer | null;
  loading?: boolean;
  error?: string | null;
  disabled?: boolean;
  usedFallback?: boolean;
  onApply: () => void;
};

/** Work Plan Approvals: recommend org-chart chain from requestor up to Layer 2, then confirmer. */
export function WorkPlanApprovalRecommendationGuide({
  seats,
  loading = false,
  error = null,
  disabled = false,
  usedFallback = false,
  confirmation = null,
  onApply,
}: Props) {
  const filled = seats.filter((s) => s.agentId?.trim());
  const confirmationFilled = Boolean(confirmation?.agentId?.trim());
  const canApply = (filled.length > 0 || confirmationFilled) && !loading;
  const confirmationName =
    confirmation?.agentName?.trim() || (confirmation?.agentId ? "Assigned personnel" : null);

  const helpText = usedFallback
    ? "Recommended path walks your managers up the org chart, then the department head confirms. The top of the chart is excluded. Fill any missing seat below."
    : "Recommended path walks your managers up the org chart, then the department head confirms. The top of the chart is excluded. You can still override any seat.";

  return (
    <div className="rounded-xl border border-orange-200/80 bg-orange-50/40 p-3 dark:border-orange-500/25 dark:bg-orange-950/15 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            <Lightbulb
              className="size-4 shrink-0 text-orange-600 dark:text-orange-400"
              aria-hidden
            />
            Approval recommendations
          </p>
          <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">{helpText}</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!canApply || disabled}
          onClick={onApply}
          className="shrink-0 border-orange-300 bg-white text-orange-900 hover:bg-orange-50 dark:border-orange-500/40 dark:bg-zinc-950 dark:text-orange-100 dark:hover:bg-orange-950/40"
        >
          {loading ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <Sparkles className="size-3.5" aria-hidden />
          )}
          Apply recommendations
        </Button>
      </div>

      {loading ? (
        <p className="mt-3 flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          Loading org-chart recommendations…
        </p>
      ) : error ? (
        <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">{error}</p>
      ) : seats.length > 0 || confirmation != null ? (
        <div className="mt-3 space-y-3">
          {seats.length > 0 ? (
            <div className="-mx-1 overflow-x-auto px-1 pb-1">
              <div className="flex w-max min-w-full items-stretch gap-3">
                {seats.map((seat, index) => {
                  const name =
                    seat.agentName?.trim() || (seat.agentId ? "Assigned personnel" : null);
                  const department = collapseDuplicateDesignation(seat.hint);
                  return (
                    <div
                      key={`wp-rec-${seat.sequenceLevel}-${seat.orgChartLayer}`}
                      className="flex w-[13.5rem] shrink-0 flex-col sm:w-[14.5rem]"
                    >
                      {index > 0 ? (
                        <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
                          then →
                        </p>
                      ) : (
                        <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-transparent select-none">
                          start
                        </p>
                      )}
                      <div
                        className={cn(
                          "isolate flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border px-3 py-2",
                          seat.agentId
                            ? "border-emerald-200/80 bg-white dark:border-emerald-500/25 dark:bg-zinc-950/50"
                            : "border-zinc-200/80 bg-white/70 dark:border-zinc-700 dark:bg-zinc-950/30",
                        )}
                      >
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span
                            className={cn(
                              "rounded-full px-1.5 py-px text-[10px] font-semibold",
                              seat.recommendedOptional
                                ? "bg-sky-500/15 text-sky-800 dark:text-sky-200"
                                : "bg-emerald-500/15 text-emerald-800 dark:text-emerald-200",
                            )}
                          >
                            {seat.recommendedOptional ? "Optional" : "Required"}
                          </span>
                        </div>
                        <p
                          className={cn(
                            "mt-0.5 break-words text-sm font-medium",
                            name
                              ? "text-emerald-800 dark:text-emerald-300"
                              : "text-zinc-400 dark:text-zinc-600",
                          )}
                        >
                          {name ?? "No recommendation yet"}
                        </p>
                        {department ? (
                          <p className="mt-0.5 break-words text-[11px] font-medium uppercase tracking-[0.08em] text-zinc-500 dark:text-zinc-400">
                            {department}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
          <div className="flex w-full max-w-md flex-col">
            {seats.length > 0 ? (
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
                then →
              </p>
            ) : (
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-transparent select-none">
                start
              </p>
            )}
            <div
              className={cn(
                "isolate flex min-h-0 flex-col overflow-hidden rounded-lg border px-3 py-2",
                confirmationFilled
                  ? "border-emerald-200/80 bg-white dark:border-emerald-500/25 dark:bg-zinc-950/50"
                  : "border-zinc-200/80 bg-white/70 dark:border-zinc-700 dark:bg-zinc-950/30",
              )}
            >
              <div className="flex flex-wrap items-center gap-1.5">
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-500">
                  To be Confirmed by
                </p>
                <span className="rounded-full bg-emerald-500/15 px-1.5 py-px text-[10px] font-semibold text-emerald-800 dark:text-emerald-200">
                  Required
                </span>
              </div>
              <p
                className={cn(
                  "mt-0.5 break-words text-sm font-medium",
                  confirmationName
                    ? "text-emerald-800 dark:text-emerald-300"
                    : "text-zinc-400 dark:text-zinc-600",
                )}
              >
                {confirmationName ?? "No recommendation yet"}
              </p>
              {confirmation?.hint ? (
                <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                  {confirmation.hint}
                </p>
              ) : !confirmationName ? (
                <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                  Department head — assign manually below if none is set.
                </p>
              ) : null}
            </div>
          </div>
        </div>
      ) : (
        <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
          No recommendations yet. Assign approvers from the org chart below.
        </p>
      )}
    </div>
  );
}
