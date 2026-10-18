"use client";

import { Loader2, MapPin } from "lucide-react";
import type { TravelOrderGatePassDraft } from "@/modules/work-plans/travel-order";
import { toDatetimeLocalValue } from "@/modules/work-plans/travel-order";

type TravelOrderGatePassFieldsProps = {
  value: TravelOrderGatePassDraft;
  onChange: (next: TravelOrderGatePassDraft) => void;
  disabled?: boolean;
  /**
   * Actual departure/arrival Start–End UI. Only after the travel order is fully approved.
   * Hidden on create and while still pending approvals.
   */
  showActualTimes?: boolean;
  /** When true (and showActualTimes), Start/End buttons can capture live timestamps. */
  allowActualCapture?: boolean;
  startBusy?: boolean;
  endBusy?: boolean;
  onCaptureActual?: (action: "start" | "end") => void;
  /** Open map pin for captured Start/End GPS. */
  onOpenGps?: (kind: "start" | "end") => void;
  /** Format already-captured ISO times for display. */
  formatCapturedAt?: (iso: string | null) => string;
};

function defaultFormatCapturedAt(iso: string | null): string {
  if (!iso) return "";
  const dt = new Date(iso);
  if (!Number.isFinite(dt.getTime())) return iso;
  return dt.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  });
}

/** Shared Gate Pass (optional) fields for create + existing Travel Order views. */
export function TravelOrderGatePassFields({
  value,
  onChange,
  disabled = false,
  showActualTimes = false,
  allowActualCapture = false,
  startBusy = false,
  endBusy = false,
  onCaptureActual,
  onOpenGps,
  formatCapturedAt = defaultFormatCapturedAt,
}: TravelOrderGatePassFieldsProps) {
  const started = Boolean(value.actualDepartureStartedAt);
  const ended = Boolean(value.actualDepartureEndedAt);
  const hasStartGps =
    value.actualDepartureStartedLatitude != null &&
    value.actualDepartureStartedLongitude != null;
  const hasEndGps =
    value.actualDepartureEndedLatitude != null && value.actualDepartureEndedLongitude != null;

  function patch(partial: Partial<TravelOrderGatePassDraft>) {
    onChange({
      ...value,
      ...partial,
      included: true,
    });
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-600 dark:text-zinc-500">
          Gate Pass (Optional)
        </p>
        <p className="text-[11px] font-normal normal-case tracking-normal text-zinc-500">
          {showActualTimes
            ? allowActualCapture && disabled
              ? "Estimates are view-only here. Use Start / End to capture actual departure and arrival GPS."
              : "Update estimated times (optional) and capture actual departure / arrival GPS when ready."
            : "Estimated departure and arrival are optional. Actual times unlock after the travel order is fully approved. You can skip this page entirely."}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-[10px] font-bold uppercase tracking-wide text-zinc-600 dark:text-zinc-500">
          <span>
            Est. Departure Date and Time{" "}
            <span className="font-semibold normal-case tracking-normal text-zinc-500">
              (optional)
            </span>
          </span>
          <input
            type="datetime-local"
            value={value.estDepartureAt ?? ""}
            disabled={disabled}
            onChange={(e) => patch({ estDepartureAt: e.target.value })}
            className="mt-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-zinc-900 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
          />
        </label>
        <label className="flex flex-col gap-1 text-[10px] font-bold uppercase tracking-wide text-zinc-600 dark:text-zinc-500">
          <span>
            Est. Arrival Date and Time{" "}
            <span className="font-semibold normal-case tracking-normal text-zinc-500">
              (optional)
            </span>
          </span>
          <input
            type="datetime-local"
            value={value.estArrivalAt ?? ""}
            disabled={disabled}
            onChange={(e) => patch({ estArrivalAt: e.target.value })}
            className="mt-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-zinc-900 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
          />
        </label>
      </div>

      {showActualTimes ? (
        <div className="space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-600 dark:text-zinc-500">
            Actual Departure / Arrival Date and Time
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1.5 rounded-lg border border-zinc-200 bg-white/70 p-2 dark:border-zinc-700 dark:bg-zinc-950/40">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">
                  Actual Departure
                </p>
                <button
                  type="button"
                  disabled={!allowActualCapture || started || startBusy || ended}
                  onClick={() => onCaptureActual?.("start")}
                  className="inline-flex items-center gap-1 rounded-lg bg-orange-600 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-orange-500 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {startBusy ? <Loader2 className="size-3 animate-spin" aria-hidden /> : null}
                  Start
                </button>
              </div>
              {started ? (
                <div className="space-y-1">
                  <p className="text-[11px] tabular-nums text-zinc-600 dark:text-zinc-400">
                    {formatCapturedAt(value.actualDepartureStartedAt)}
                  </p>
                  {hasStartGps ? (
                    <button
                      type="button"
                      onClick={() => onOpenGps?.("start")}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-orange-700 hover:underline dark:text-orange-300"
                    >
                      <MapPin className="size-3" aria-hidden />
                      {value.actualDepartureStartedLatitude!.toFixed(5)},{" "}
                      {value.actualDepartureStartedLongitude!.toFixed(5)}
                    </button>
                  ) : null}
                </div>
              ) : (
                <p className="text-[11px] text-zinc-500">
                  Captures GPS + time when you depart
                  {allowActualCapture ? ". Allow location access." : "."}
                </p>
              )}
              <label className="block text-[10px] font-bold uppercase tracking-wide text-zinc-500">
                Guard on Duty
                <input
                  type="text"
                  value={value.startGuardOnDuty ?? ""}
                  disabled={(disabled && !allowActualCapture) || ended}
                  onChange={(e) => patch({ startGuardOnDuty: e.target.value })}
                  placeholder="Name of guard on duty…"
                  className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-xs font-normal normal-case tracking-normal text-zinc-900 placeholder:text-zinc-400 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                />
              </label>
            </div>

            <div className="space-y-1.5 rounded-lg border border-zinc-200 bg-white/70 p-2 dark:border-zinc-700 dark:bg-zinc-950/40">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">
                  Actual Arrival
                </p>
                <button
                  type="button"
                  disabled={!allowActualCapture || !started || ended || endBusy}
                  onClick={() => onCaptureActual?.("end")}
                  className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/50 bg-emerald-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-800 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-45 dark:text-emerald-200"
                >
                  {endBusy ? <Loader2 className="size-3 animate-spin" aria-hidden /> : null}
                  End
                </button>
              </div>
              {ended ? (
                <div className="space-y-1">
                  <p className="text-[11px] tabular-nums text-zinc-600 dark:text-zinc-400">
                    {formatCapturedAt(value.actualDepartureEndedAt)}
                  </p>
                  {hasEndGps ? (
                    <button
                      type="button"
                      onClick={() => onOpenGps?.("end")}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 hover:underline dark:text-emerald-300"
                    >
                      <MapPin className="size-3" aria-hidden />
                      {value.actualDepartureEndedLatitude!.toFixed(5)},{" "}
                      {value.actualDepartureEndedLongitude!.toFixed(5)}
                    </button>
                  ) : null}
                </div>
              ) : (
                <p className="text-[11px] text-zinc-500">
                  {started
                    ? "Captures GPS + time when you arrive."
                    : "Available after Actual Departure Start."}
                </p>
              )}
              <label className="block text-[10px] font-bold uppercase tracking-wide text-zinc-500">
                Guard on Duty
                <input
                  type="text"
                  value={value.endGuardOnDuty ?? ""}
                  disabled={(disabled && !allowActualCapture) || !started}
                  onChange={(e) => patch({ endGuardOnDuty: e.target.value })}
                  placeholder="Name of guard on duty…"
                  className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-xs font-normal normal-case tracking-normal text-zinc-900 placeholder:text-zinc-400 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                />
              </label>
            </div>
          </div>
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-zinc-300 px-2.5 py-2 text-[11px] text-zinc-500 dark:border-zinc-700">
          Actual departure and arrival times appear here after the travel order is fully approved.
        </p>
      )}
    </div>
  );
}

export function gatePassDraftFromOrder(order: {
  gatePassIncluded?: boolean;
  estDepartureAt?: string | null;
  estArrivalAt?: string | null;
  actualDepartureStartedAt?: string | null;
  actualDepartureStartedLatitude?: number | null;
  actualDepartureStartedLongitude?: number | null;
  gatePassStartGuardOnDuty?: string | null;
  actualDepartureEndedAt?: string | null;
  actualDepartureEndedLatitude?: number | null;
  actualDepartureEndedLongitude?: number | null;
  gatePassEndGuardOnDuty?: string | null;
}): TravelOrderGatePassDraft {
  return {
    included: order.gatePassIncluded === true,
    estDepartureAt: toDatetimeLocalValue(order.estDepartureAt),
    estArrivalAt: toDatetimeLocalValue(order.estArrivalAt),
    actualDepartureStartedAt: order.actualDepartureStartedAt ?? null,
    actualDepartureStartedLatitude: order.actualDepartureStartedLatitude ?? null,
    actualDepartureStartedLongitude: order.actualDepartureStartedLongitude ?? null,
    actualDepartureEndedAt: order.actualDepartureEndedAt ?? null,
    actualDepartureEndedLatitude: order.actualDepartureEndedLatitude ?? null,
    actualDepartureEndedLongitude: order.actualDepartureEndedLongitude ?? null,
    startGuardOnDuty: order.gatePassStartGuardOnDuty ?? "",
    endGuardOnDuty: order.gatePassEndGuardOnDuty ?? "",
  };
}
