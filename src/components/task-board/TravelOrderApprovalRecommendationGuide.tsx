"use client";

import { Lightbulb, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { TravelOrderOrgChartPathSeat } from "@/lib/travel-order";
import type { TravelOrderRecommendedConfirmer } from "@/lib/travel-order-org-chart-path";

type Props = {
  seats: TravelOrderOrgChartPathSeat[];
  requestorOrgLayer: number | null;
  /** Immediate department head for To be Confirmed by. */
  confirmation?: TravelOrderRecommendedConfirmer | null;
  loading?: boolean;
  error?: string | null;
  disabled?: boolean;
  /** When true, one or more recommended seats could not be auto-filled. */
  usedFallback?: boolean;
  onApply: () => void;
};

/**
 * Travel-order Approvals recommendations:
 * Immediate head → HR team head → major department head, then confirm by immediate head.
 * Requestors may override with any org-chart department head (cross-department).
 */
export function TravelOrderApprovalRecommendationGuide({
  seats,
  requestorOrgLayer: _requestorOrgLayer,
  confirmation = null,
  loading = false,
  error = null,
  disabled = false,
  usedFallback = false,
  onApply,
}: Props) {
  void _requestorOrgLayer;
  const filledApprovalSeats = seats.filter((seat) => seat.agentId?.trim());
  const confirmationFilled = Boolean(confirmation?.agentId?.trim());
  const canApply =
    (filledApprovalSeats.length > 0 || confirmationFilled) && !loading;
  const hasAnySeat = seats.length > 0 || confirmation != null;

  const helpText = usedFallback
    ? "Recommended path: immediate head → HR team head → major department head, then confirm with the immediate head. Missing seats can be filled from any department head on the org chart."
    : "Recommended path: immediate head → HR team head → major department head, then confirm with the immediate head. You can still assign heads from other departments below.";

  const confirmationName =
    confirmation?.agentName?.trim() ||
    (confirmation?.agentId ? "Assigned personnel" : null);

  return (
    <div className="rounded-xl border border-orange-200/80 bg-orange-50/40 p-3 dark:border-orange-500/25 dark:bg-orange-950/15 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            <Lightbulb className="size-4 shrink-0 text-orange-600 dark:text-orange-400" aria-hidden />
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
          Loading recommendations…
        </p>
      ) : error ? (
        <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">{error}</p>
      ) : hasAnySeat ? (
        <div className="mt-3 space-y-3">
          {seats.length > 0 ? (
            <div className="-mx-1 overflow-x-auto px-1 pb-1">
              <div className="flex w-max min-w-full items-stretch gap-3">
                {seats.map((seat, index) => {
                  const name =
                    seat.agentName?.trim() ||
                    (seat.agentId ? "Assigned personnel" : null);
                  const alternates = seat.alternateAgents
                    .map((a) => a.agentName?.trim())
                    .filter(Boolean) as string[];
                  const title =
                    seat.label?.trim() || `Approved by · Level ${seat.orgChartLayer}`;
                  return (
                    <div
                      key={`to-rec-${seat.sequenceLevel}`}
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
                          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-500">
                            {title}
                          </p>
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
                          {alternates.length > 0 ? (
                            <span className="rounded-full bg-orange-500/15 px-1.5 py-px text-[10px] font-semibold text-orange-800 dark:text-orange-200">
                              Either / or
                            </span>
                          ) : null}
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
                          {alternates.length > 0 ? ` or ${alternates.join(" or ")}` : ""}
                        </p>
                        {seat.hint ? (
                          <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                            {seat.hint}
                          </p>
                        ) : !name ? (
                          <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                            Assign any department head from the org chart below.
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
                  Immediate department head — assign manually below if none is set.
                </p>
              ) : null}
            </div>
          </div>
        </div>
      ) : (
        <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
          No recommendations yet. Assign department heads from the org chart below.
        </p>
      )}
    </div>
  );
}
