"use client";

import { useEffect, useState } from "react";
import { CloudOff, Loader2, RefreshCw, Wifi } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  countPendingTravelOrderWork,
} from "@/lib/offline/travel-order-offline-db";
import {
  flushTravelOrderPendingQueue,
  getTravelOrderSyncProgress,
  isBrowserOnline,
  subscribeTravelOrderConnectivity,
  subscribeTravelOrderSync,
  type TravelOrderSyncProgress,
} from "@/lib/offline/travel-order-sync";

/** Compact offline / sync status for Travel Order surfaces. */
export function TravelOrderOfflineBanner({ className }: { className?: string }) {
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const [sync, setSync] = useState<TravelOrderSyncProgress>(() => getTravelOrderSyncProgress());

  useEffect(() => {
    function refreshOnline() {
      setOnline(isBrowserOnline());
    }
    refreshOnline();
    const unsubConnectivity = subscribeTravelOrderConnectivity(refreshOnline);
    const unsub = subscribeTravelOrderSync(setSync);
    const tick = window.setInterval(() => {
      void countPendingTravelOrderWork().then(setPending);
    }, 2500);
    void countPendingTravelOrderWork().then(setPending);
    return () => {
      unsubConnectivity();
      unsub();
      window.clearInterval(tick);
    };
  }, []);

  if (online && pending === 0 && !sync.running && !sync.lastError) {
    return null;
  }

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-xs",
        online
          ? "border-sky-400/40 bg-sky-500/10 text-sky-950 dark:text-sky-100"
          : "border-amber-400/50 bg-amber-500/10 text-amber-950 dark:text-amber-100",
        className,
      )}
      role="status"
    >
      <div className="flex min-w-0 items-center gap-1.5">
        {online ? (
          <Wifi className="size-3.5 shrink-0" aria-hidden />
        ) : (
          <CloudOff className="size-3.5 shrink-0" aria-hidden />
        )}
        <span className="font-semibold">
          {online ? "Online" : "You are offline"}
        </span>
        <span className="truncate text-[11px] opacity-90">
          {online
            ? sync.running
              ? `Syncing Travel Orders… ${sync.done}/${sync.total}`
              : pending > 0
                ? `${pending} pending Travel Order change${pending === 1 ? "" : "s"}`
                : sync.lastError
                  ? sync.lastError
                  : "Travel Orders are synced"
            : "Drafts still work offline. If a reload fails, open the offline Travel Orders page."}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        {!online ? (
          <a
            href="/offline-travel-orders.html"
            className="inline-flex items-center rounded-md border border-amber-500/40 bg-white/70 px-2 py-0.5 text-[11px] font-semibold text-amber-950 hover:bg-white dark:bg-zinc-950/50 dark:text-amber-100"
          >
            Offline page
          </a>
        ) : null}
        {online && pending > 0 && !sync.running ? (
          <button
            type="button"
            disabled={sync.running}
            onClick={() => void flushTravelOrderPendingQueue()}
            className="inline-flex items-center gap-1 rounded-md border border-sky-500/40 bg-white/70 px-2 py-0.5 text-[11px] font-semibold text-sky-900 hover:bg-white disabled:opacity-50 dark:bg-zinc-950/50 dark:text-sky-100"
          >
            {sync.running ? (
              <Loader2 className="size-3 animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="size-3" aria-hidden />
            )}
            Sync now
          </button>
        ) : pending > 0 ? (
          <button
            type="button"
            disabled={sync.running}
            onClick={() => void flushTravelOrderPendingQueue()}
            className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-white/70 px-2 py-0.5 text-[11px] font-semibold text-amber-950 hover:bg-white disabled:opacity-50 dark:bg-zinc-950/50 dark:text-amber-100"
          >
            {sync.running ? (
              <Loader2 className="size-3 animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="size-3" aria-hidden />
            )}
            Retry sync
          </button>
        ) : null}
      </div>
    </div>
  );
}
