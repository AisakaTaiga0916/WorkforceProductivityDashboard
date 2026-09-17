"use client";

import Link from "next/link";
import { AgentTicketDeepLink } from "@/components/AgentTicketDeepLink";
import { ElapsedFromIso } from "@/components/ElapsedFromIso";
import { cn } from "@/lib/cn";
import type { StaffNotificationFeedItem } from "@/lib/staff-notifications";

type Props = {
  item: StaffNotificationFeedItem;
  seenTravelIds?: Set<string>;
  onNavigate?: () => void;
  onOpenTravel?: (args: {
    taskId: string;
    travelOrderId: string;
    title: string;
  }) => void;
  className?: string;
};

function shellClass(kind: StaffNotificationFeedItem["kind"], unread: boolean) {
  if (kind === "phase_delay") {
    return "border-rose-300/60 bg-rose-50/80 hover:bg-rose-100/80 dark:border-rose-500/30 dark:bg-rose-500/10 dark:hover:bg-rose-500/15";
  }
  if (kind === "account_request") {
    return "border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/15 dark:border-amber-500/30 dark:bg-amber-500/10 dark:hover:bg-amber-500/15";
  }
  if (kind === "travel_approval") {
    return unread
      ? "border-orange-500/40 bg-orange-500/10 hover:bg-orange-500/15 dark:border-orange-500/30 dark:bg-orange-500/10 dark:hover:bg-orange-500/15"
      : "border-zinc-200 bg-zinc-50 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-950/60 dark:hover:bg-zinc-800/70";
  }
  if (kind === "travel_confirmation") {
    return unread
      ? "border-sky-500/40 bg-sky-500/10 hover:bg-sky-500/15 dark:border-sky-500/30 dark:bg-sky-500/10 dark:hover:bg-sky-500/15"
      : "border-zinc-200 bg-zinc-50 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-950/60 dark:hover:bg-zinc-800/70";
  }
  if (kind === "task_verification") {
    return "border-violet-400/50 bg-violet-500/10 hover:bg-violet-500/15 dark:border-violet-500/30 dark:bg-violet-500/10 dark:hover:bg-violet-500/15";
  }
  if (kind === "task_verification_result") {
    return "border-emerald-400/50 bg-emerald-500/10 hover:bg-emerald-500/15 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:hover:bg-emerald-500/15";
  }
  return "border-zinc-200 bg-zinc-50 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-950/60 dark:hover:bg-zinc-800/70";
}

export function StaffNotificationFeedItemView({
  item,
  seenTravelIds,
  onNavigate,
  onOpenTravel,
  className,
}: Props) {
  const unread =
    (item.kind === "travel_approval" || item.kind === "travel_confirmation") &&
    Boolean(item.travelOrderId) &&
    !(seenTravelIds?.has(item.travelOrderId!) ?? false);

  const body = (
    <>
      <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">{item.title}</p>
      {item.subtitle ? (
        <p className="mt-0.5 line-clamp-2 text-xs text-zinc-600 dark:text-zinc-400">{item.subtitle}</p>
      ) : null}
      <p className="mt-1 text-[11px] uppercase tracking-wide text-zinc-500 dark:text-zinc-500">
        {item.meta} · <ElapsedFromIso iso={item.at} className="inline" />
      </p>
    </>
  );

  const base = cn(
    "block w-full rounded-lg border px-3 py-2 text-left transition",
    shellClass(item.kind, unread),
    className,
  );

  if (item.kind === "ticket" && item.ticketId) {
    return (
      <AgentTicketDeepLink ticketId={item.ticketId} onNavigate={onNavigate} className={base}>
        {body}
      </AgentTicketDeepLink>
    );
  }

  if (
    (item.kind === "travel_approval" || item.kind === "travel_confirmation") &&
    item.kpiMaintenanceId &&
    item.travelOrderId &&
    onOpenTravel
  ) {
    return (
      <button
        type="button"
        className={base}
        onClick={() => {
          onNavigate?.();
          onOpenTravel({
            taskId: item.kpiMaintenanceId!,
            travelOrderId: item.travelOrderId!,
            title: item.title,
          });
        }}
      >
        {body}
      </button>
    );
  }

  const href = item.href ?? "#";
  return (
    <Link href={href} onClick={onNavigate} className={base}>
      {body}
    </Link>
  );
}
