"use client";

import { Camera, Loader2, MapPin, Plus, X } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  travelOrderLocationVisitStatus,
  travelOrderLocationVisitStatusLabel,
  type TravelOrderDto,
  type TravelOrderLocationDto,
} from "@/lib/travel-order";

const MAX_LOCATION_IMAGES = 5;

type TravelOrderLocationVisitListProps = {
  order: TravelOrderDto;
  title?: string;
  approved: boolean;
  hasGatePass: boolean;
  locationsUnlocked: boolean;
  gatePassOnly: boolean;
  allowCheckIn: boolean;
  personnelGuard: boolean;
  busyKey: string | null;
  formatCheckedAt: (iso: string | null) => string;
  resolveTaskId: (orderId: string) => string;
  onCaptureVisit: (loc: TravelOrderLocationDto, action: "start" | "end") => void;
  onOpenGps: (loc: TravelOrderLocationDto, kind: "start" | "end") => void;
  onRemarksChange: (locationId: string, value: string) => void;
  onUploadImages: (loc: TravelOrderLocationDto, files: FileList | null) => void;
  onRemoveImage: (loc: TravelOrderLocationDto, storedFileName: string) => void;
  canAddLocation?: boolean;
  newLocationDraft?: string;
  addLocationBusy?: boolean;
  onNewLocationDraftChange?: (value: string) => void;
  onAddLocation?: () => void;
};

/** Location Start/End visit cards used by travel orders and work-plan venues. */
export function TravelOrderLocationVisitList({
  order,
  title = "Location",
  approved,
  hasGatePass,
  locationsUnlocked,
  gatePassOnly,
  allowCheckIn,
  personnelGuard,
  busyKey,
  formatCheckedAt,
  resolveTaskId,
  onCaptureVisit,
  onOpenGps,
  onRemarksChange,
  onUploadImages,
  onRemoveImage,
  canAddLocation = false,
  newLocationDraft = "",
  addLocationBusy = false,
  onNewLocationDraftChange,
  onAddLocation,
}: TravelOrderLocationVisitListProps) {
  return (
    <div className="space-y-2">
      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-600 dark:text-zinc-400">
        {title}
      </p>
      {approved && hasGatePass && !locationsUnlocked ? (
        <p className="rounded-lg border border-dashed border-orange-400/50 bg-orange-500/5 px-2.5 py-2 text-[11px] text-orange-800 dark:border-orange-500/30 dark:text-orange-200">
          Locations stay locked until Gate Pass Actual Departure Start is captured.
        </p>
      ) : null}
      <ul className="space-y-2">
        {order.locations.map((loc) => {
          const visitStatus = travelOrderLocationVisitStatus(loc);
          const statusLabel = travelOrderLocationVisitStatusLabel(visitStatus);
          const started = Boolean(loc.startedAt);
          const ended = Boolean(loc.endedAt || loc.checkedAt);
          const pendingLocal = loc.id.startsWith("local_loc_");
          const startBusy = busyKey === `start-${loc.id}`;
          const endBusy = busyKey === `end-${loc.id}`;
          const hasStartGps =
            loc.startedLatitude != null && loc.startedLongitude != null;
          const hasEndGps =
            (loc.endedLatitude ?? loc.latitude) != null &&
            (loc.endedLongitude ?? loc.longitude) != null;
          const locActionsEnabled = !gatePassOnly && allowCheckIn && locationsUnlocked;

          if (!approved) {
            return (
              <li
                key={loc.id}
                className="rounded-lg border border-dashed border-zinc-300 px-2.5 py-2 dark:border-zinc-700"
              >
                <p className="flex items-center gap-1.5 text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                  <MapPin className="size-3.5 text-orange-600" aria-hidden />
                  {loc.label}
                </p>
                <p className="mt-0.5 text-[11px] text-zinc-500">
                  Start/End GPS capture, remarks, and images unlock after approval
                  {hasGatePass ? ", then after Gate Pass Actual Departure Start." : "."}
                </p>
              </li>
            );
          }

          if (!locationsUnlocked) {
            return (
              <li
                key={loc.id}
                className="rounded-lg border border-dashed border-zinc-300 px-2.5 py-2 dark:border-zinc-700"
              >
                <p className="flex items-center gap-1.5 text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                  <MapPin className="size-3.5 text-orange-600" aria-hidden />
                  {loc.label}
                </p>
                <p className="mt-0.5 text-[11px] text-zinc-500">
                  Locked until Gate Pass Actual Departure Start.
                </p>
              </li>
            );
          }

          return (
            <li
              key={loc.id}
              className={cn(
                "space-y-2 rounded-lg border px-2.5 py-2",
                visitStatus === "completed"
                  ? "border-emerald-400/50 bg-emerald-500/5 dark:border-emerald-700/50"
                  : visitStatus === "in_progress"
                    ? "border-orange-400/50 bg-orange-500/5 dark:border-orange-700/40"
                    : "border-zinc-300 dark:border-zinc-700",
              )}
            >
              <div className="flex flex-wrap items-center gap-2">
                <p className="min-w-0 flex-1 truncate text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                  {loc.label}
                </p>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                    pendingLocal
                      ? "bg-sky-500/15 text-sky-800 dark:text-sky-200"
                      : visitStatus === "completed"
                        ? "bg-emerald-500/15 text-emerald-800 dark:text-emerald-200"
                        : visitStatus === "in_progress"
                          ? "bg-orange-500/15 text-orange-800 dark:text-orange-200"
                          : "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
                  )}
                >
                  {pendingLocal ? "Pending sync" : statusLabel}
                </span>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <div className="space-y-1.5 rounded-lg border border-zinc-200 bg-white/70 p-2 dark:border-zinc-700 dark:bg-zinc-950/40">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">
                      Start
                    </p>
                    <button
                      type="button"
                      disabled={
                        !locActionsEnabled || started || startBusy || ended || pendingLocal
                      }
                      onClick={() => onCaptureVisit(loc, "start")}
                      className="inline-flex items-center gap-1 rounded-lg bg-orange-600 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-orange-500 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      {startBusy ? (
                        <Loader2 className="size-3 animate-spin" aria-hidden />
                      ) : null}
                      Start
                    </button>
                  </div>
                  {started ? (
                    <div className="space-y-1">
                      <p className="text-[11px] tabular-nums text-zinc-600 dark:text-zinc-400">
                        {loc.startedAt ? formatCheckedAt(loc.startedAt) : "Started"}
                      </p>
                      {hasStartGps ? (
                        <button
                          type="button"
                          onClick={() => onOpenGps(loc, "start")}
                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-orange-700 hover:underline dark:text-orange-300"
                        >
                          <MapPin className="size-3" aria-hidden />
                          {loc.startedLatitude!.toFixed(5)}, {loc.startedLongitude!.toFixed(5)}
                        </button>
                      ) : null}
                    </div>
                  ) : (
                    <p className="text-[11px] text-zinc-500">
                      Captures GPS + time when you arrive.
                    </p>
                  )}
                </div>

                <div className="space-y-1.5 rounded-lg border border-zinc-200 bg-white/70 p-2 dark:border-zinc-700 dark:bg-zinc-950/40">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">
                      End
                    </p>
                    <button
                      type="button"
                      disabled={
                        !locActionsEnabled || !started || ended || endBusy || pendingLocal
                      }
                      onClick={() => onCaptureVisit(loc, "end")}
                      className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/50 bg-emerald-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-800 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-45 dark:text-emerald-200"
                    >
                      {endBusy ? (
                        <Loader2 className="size-3 animate-spin" aria-hidden />
                      ) : null}
                      End
                    </button>
                  </div>
                  {ended ? (
                    <div className="space-y-1">
                      <p className="text-[11px] tabular-nums text-zinc-600 dark:text-zinc-400">
                        {formatCheckedAt(loc.endedAt ?? loc.checkedAt)}
                      </p>
                      {hasEndGps ? (
                        <button
                          type="button"
                          onClick={() => onOpenGps(loc, "end")}
                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 hover:underline dark:text-emerald-300"
                        >
                          <MapPin className="size-3" aria-hidden />
                          {(loc.endedLatitude ?? loc.latitude)!.toFixed(5)},{" "}
                          {(loc.endedLongitude ?? loc.longitude)!.toFixed(5)}
                        </button>
                      ) : null}
                    </div>
                  ) : (
                    <p className="text-[11px] text-zinc-500">
                      {started
                        ? "Captures GPS + time when you finish."
                        : "Available after Start."}
                    </p>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <label className="block text-[10px] font-bold uppercase tracking-wide text-zinc-500">
                  Remarks
                  <textarea
                    rows={2}
                    defaultValue={loc.remarks ?? ""}
                    disabled={!locActionsEnabled}
                    onChange={(e) => onRemarksChange(loc.id, e.target.value)}
                    placeholder="Notes for this location…"
                    className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-xs font-normal normal-case tracking-normal text-zinc-900 placeholder:text-zinc-400 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                  />
                </label>
                {!personnelGuard ? (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        id={`travel-loc-img-${loc.id}`}
                        type="file"
                        accept="image/*"
                        capture="environment"
                        className="pointer-events-none absolute h-0 w-0 overflow-hidden opacity-0"
                        tabIndex={-1}
                        aria-hidden
                        disabled={
                          !locActionsEnabled ||
                          loc.attachments.length >= MAX_LOCATION_IMAGES ||
                          busyKey === `img-${loc.id}`
                        }
                        onChange={(e) => {
                          onUploadImages(loc, e.target.files);
                          e.target.value = "";
                        }}
                      />
                      <button
                        type="button"
                        disabled={
                          !locActionsEnabled ||
                          loc.attachments.length >= MAX_LOCATION_IMAGES ||
                          busyKey === `img-${loc.id}`
                        }
                        onClick={() =>
                          document.getElementById(`travel-loc-img-${loc.id}`)?.click()
                        }
                        title="Take photo"
                        aria-label="Take photo"
                        className={`inline-flex size-9 cursor-pointer items-center justify-center rounded-lg border border-orange-500/50 bg-orange-500/10 text-orange-800 hover:bg-orange-500/20 dark:border-orange-500/40 dark:text-orange-200 dark:hover:bg-orange-950/40 ${
                          !locActionsEnabled ||
                          loc.attachments.length >= MAX_LOCATION_IMAGES ||
                          busyKey === `img-${loc.id}`
                            ? "pointer-events-none opacity-50"
                            : ""
                        }`}
                      >
                        {busyKey === `img-${loc.id}` ? (
                          <Loader2 className="size-4 animate-spin" aria-hidden />
                        ) : (
                          <Camera className="size-4" aria-hidden />
                        )}
                      </button>
                      <span className="text-[10px] text-zinc-500">
                        {loc.attachments.length}/{MAX_LOCATION_IMAGES} · camera
                      </span>
                    </div>
                    {loc.attachments.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {loc.attachments.map((att) => {
                          const href = `/api/kpi-maintenance/${encodeURIComponent(resolveTaskId(order.id))}/travel-orders/${encodeURIComponent(order.id)}/files/${encodeURIComponent(att.storedFileName)}`;
                          const removing = busyKey === `rm-${loc.id}-${att.storedFileName}`;
                          return (
                            <div
                              key={att.storedFileName}
                              className="relative overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-700"
                            >
                              <a href={href} target="_blank" rel="noreferrer" className="block">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={href}
                                  alt={att.originalName}
                                  className="h-16 w-16 object-cover"
                                />
                              </a>
                              {locActionsEnabled ? (
                                <button
                                  type="button"
                                  disabled={removing}
                                  onClick={() => onRemoveImage(loc, att.storedFileName)}
                                  className="absolute right-0.5 top-0.5 inline-flex size-5 items-center justify-center rounded-full bg-black/70 text-white hover:bg-black/85 disabled:opacity-50"
                                  aria-label={`Remove ${att.originalName}`}
                                >
                                  {removing ? (
                                    <Loader2 className="size-3 animate-spin" aria-hidden />
                                  ) : (
                                    <X className="size-3" aria-hidden />
                                  )}
                                </button>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                  </>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      {canAddLocation ? (
        <div className="rounded-lg border border-dashed border-orange-400/50 bg-orange-500/[0.04] p-2.5 dark:border-orange-500/40">
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-orange-800 dark:text-orange-200">
            Add another location
          </p>
          <p className="mt-0.5 text-[11px] text-zinc-500">
            Travelers can add a stop while this travel order is running.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={newLocationDraft}
              disabled={addLocationBusy}
              placeholder="Location name / address…"
              onChange={(e) => onNewLocationDraftChange?.(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onAddLocation?.();
                }
              }}
              className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-xs text-zinc-900 placeholder:text-zinc-400 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
            />
            <button
              type="button"
              disabled={addLocationBusy || !newLocationDraft.trim()}
              onClick={() => onAddLocation?.()}
              className="inline-flex items-center gap-1 rounded-lg bg-orange-600 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-orange-500 disabled:cursor-not-allowed disabled:opacity-45"
            >
              {addLocationBusy ? (
                <Loader2 className="size-3 animate-spin" aria-hidden />
              ) : (
                <Plus className="size-3" aria-hidden />
              )}
              Add location
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
