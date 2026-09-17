"use client";

import Link from "next/link";
import { LogOut } from "lucide-react";
import { signOut } from "next-auth/react";
import { TravelOrderSummaryPanel } from "@/components/task-board/TravelOrderSummaryPanel";
import { BRAND_TITLE } from "@/lib/brand";

type TravelOrdersQuickAccessProps = {
  operatorAgentId: string | null;
  canAssignWork?: boolean;
  /** Gate-pass kiosk: capture Start/End only; no task-board link. */
  personnelGuard?: boolean;
};

/** Staff quick-access Work Plans, including Gate Pass for trips that include travel. */
export function TravelOrdersQuickAccess({
  operatorAgentId,
  canAssignWork = false,
  personnelGuard = false,
}: TravelOrdersQuickAccessProps) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-orange-700 dark:text-orange-400">
            {BRAND_TITLE}
          </p>
          <h1 className="mt-1 text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-2xl">
            Travel Orders
          </h1>
          <p className="mt-1.5 max-w-xl text-sm text-zinc-600 dark:text-zinc-400">
            {personnelGuard
              ? "Gate Pass kiosk for approved active trips linked to Travel Orders. View details and approvals, then record Guard on Duty and Gate Pass Start / End."
              : "Quick access for Travel Orders. View details and approvals. Gate Pass is handled by Personnel-Guard while a trip is running."}
          </p>
        </div>
        {personnelGuard ? (
          <button
            type="button"
            onClick={() => void signOut({ callbackUrl: "/signin" })}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900"
          >
            <LogOut className="size-3.5" aria-hidden />
            Sign out
          </button>
        ) : (
          <Link
            href="/agent/tasks"
            className="inline-flex shrink-0 items-center rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900"
          >
            Open Task Board
          </Link>
        )}
      </div>

      <TravelOrderSummaryPanel
        source="visible"
        interactionMode="gatePassOnly"
        operatorAgentId={operatorAgentId}
        canAssignWork={canAssignWork}
        canCheckIn
        personnelGuard={personnelGuard}
      />
    </div>
  );
}
