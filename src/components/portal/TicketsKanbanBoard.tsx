"use client";

import Link from "next/link";
import type { TicketPriority, TicketStatus } from "@prisma/client/primary";
import { ExternalLink, MoreHorizontal } from "lucide-react";
import { AssigneeColorHighlight } from "@/components/ticket/AssigneeColorHighlight";
import { AssigneeInitialsBadge } from "@/components/ticket/AssigneeInitialsBadge";
import { cn } from "@/lib/cn";

export type KanbanTicket = {
  id: string;
  ticketNumber: string;
  title: string;
  status: TicketStatus;
  priority: TicketPriority;
  updatedAt: string;
  authorLabel: string;
  /** Assignee display name for initials chip */
  assigneeName?: string | null;
  assigneeColorKey?: string | null;
};

const columns: {
  id: "pending" | "inProgress" | "done";
  title: string;
  dotClassName: string;
  match: (s: TicketStatus) => boolean;
}[] = [
  {
    id: "pending",
    title: "Pending",
    dotClassName: "bg-blue-500",
    match: (s) => s === "OPEN",
  },
  {
    id: "inProgress",
    title: "In progress",
    dotClassName: "bg-cyan-400",
    match: (s) => s === "IN_PROGRESS" || s === "ESCALATED" || s === "PENDING_INFO",
  },
  {
    id: "done",
    title: "Resolved/Closed",
    dotClassName: "bg-stone-400",
    match: (s) => s === "FOR_CONFIRMATION" || s === "RESOLVED" || s === "CLOSED",
  },
];

function shortNum(ticketNumber: string) {
  const m = ticketNumber.replace(/\D/g, "");
  if (m.length >= 3) return m.slice(-3);
  return ticketNumber;
}

function idBadgeClass(ticketNumber: string, priority: TicketPriority) {
  if (priority === "UNSET")
    return "border-zinc-600/60 bg-zinc-800 text-zinc-300";
  if (priority === "URGENT") return "border-red-500/30 bg-red-500/15 text-red-300";
  const h = Array.from(ticketNumber).reduce((a, c) => a + c.charCodeAt(0), 0);
  return h % 2 === 0
    ? "border-orange-500/30 bg-orange-500/15 text-orange-300"
    : "border-cyan-500/30 bg-cyan-500/15 text-cyan-300";
}

function statusPill(status: TicketStatus) {
  switch (status) {
    case "IN_PROGRESS":
      return {
        label: "In progress",
        className: "border-orange-500/30 bg-orange-500/15 text-orange-300",
      };
    case "OPEN":
      return { label: "Open", className: "border-zinc-600/60 bg-zinc-800 text-zinc-300" };
    case "ESCALATED":
      return { label: "Urgent", className: "border-red-500/30 bg-red-500/15 text-red-300" };
    case "PENDING_INFO":
      return {
        label: "In progress",
        className: "border-orange-500/30 bg-orange-500/15 text-orange-300",
      };
    case "FOR_CONFIRMATION":
    case "RESOLVED":
      return {
        label: "For confirmation",
        className: "border-orange-500/30 bg-orange-500/15 text-orange-300",
      };
    case "CLOSED":
      return {
        label: "Closed",
        className: "border-stone-500/30 bg-stone-500/20 text-stone-300",
      };
    default: {
      const s = status as string;
      return { label: s.replaceAll("_", " "), className: "border-zinc-600/60 bg-zinc-800 text-zinc-300" };
    }
  }
}

function formatUpdated(iso: string) {
  const d = new Date(iso);
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  return d.toLocaleDateString();
}

function TicketCard({ t }: { t: KanbanTicket }) {
  const pill = statusPill(t.status);
  const pillLabel = t.priority === "URGENT" ? "Urgent" : pill.label;
  const pillClass =
    t.priority === "URGENT"
      ? "bg-rose-500/15 text-rose-900 dark:bg-rose-500/20 dark:text-rose-200"
      : pill.className;
  return (
    <AssigneeColorHighlight
      assigneeColorKey={t.assigneeColorKey}
      className="block rounded-md border border-zinc-200 bg-white shadow-[0_14px_28px_rgba(0,0,0,0.06)] transition hover:border-orange-500/50 hover:bg-orange-50/40 dark:border-zinc-700/80 dark:bg-[#1b1a19] dark:shadow-[0_14px_28px_rgba(0,0,0,0.24)] dark:hover:bg-[#211f1d]"
    >
      <Link href={`/tickets/${t.id}`} className="block p-3">
      <div className="flex items-start justify-between gap-2">
        <span
          className={cn(
            "shrink-0 rounded-sm border px-1.5 py-0.5 font-mono text-xs font-semibold",
            idBadgeClass(t.ticketNumber, t.priority),
          )}
        >
          #{shortNum(t.ticketNumber)}
        </span>
        <span className={cn("shrink-0 rounded-sm border px-1.5 py-0.5 text-[9px] font-black uppercase tracking-[0.12em]", pillClass)}>
          {pillLabel}
        </span>
      </div>
      <p className="mt-3 line-clamp-2 text-sm font-semibold leading-snug text-zinc-950 dark:text-zinc-100">{t.title}</p>
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-zinc-200 pt-2.5 text-xs text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
        <p className="min-w-0 truncate">
          Updated {formatUpdated(t.updatedAt)}
          {t.authorLabel ? ` · ${t.authorLabel}` : ""}
        </p>
        {t.assigneeName ? (
          <AssigneeInitialsBadge agentName={t.assigneeName} assigneeColorKey={t.assigneeColorKey} className="shrink-0" />
        ) : (
          <ExternalLink className="size-4 shrink-0 text-zinc-500" aria-hidden />
        )}
      </div>
      </Link>
    </AssigneeColorHighlight>
  );
}

export function TicketsKanbanBoard({ tickets }: { tickets: KanbanTicket[] }) {
  return (
    <div className="-mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-1 md:mx-0 md:grid md:gap-3 md:overflow-visible md:px-0 md:pb-0 md:snap-none md:grid-cols-3">
      {columns.map((col) => {
        const list = tickets.filter((t) => col.match(t.status));
        return (
          <div
            key={col.id}
            className="flex min-h-[19rem] w-[86vw] min-w-[260px] snap-start flex-col rounded-md border border-zinc-200 bg-white sm:w-[360px] md:w-auto md:min-w-0 dark:border-zinc-700/80 dark:bg-[#10100f]"
          >
            <div className="flex items-center justify-between border-b border-orange-500/20 px-3 py-3">
              <div className="flex items-center gap-2">
                <span className={`size-2 rounded-full ${col.dotClassName}`} aria-hidden />
                <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-zinc-700 dark:text-zinc-200">{col.title}</h3>
                <span className="rounded-sm bg-zinc-100 px-2 py-0.5 font-mono text-[10px] font-bold text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                  {String(list.length).padStart(2, "0")}
                </span>
              </div>
              <MoreHorizontal className="size-4 text-zinc-500" aria-hidden />
            </div>
            <div className="flex max-h-[min(48vh,460px)] min-h-[120px] flex-col gap-2.5 overflow-y-auto p-3">
              {list.length === 0 ? (
                <p className="rounded-md border border-dashed border-zinc-300 px-4 py-8 text-center text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-600">
                  No tickets in this column.
                </p>
              ) : (
                list.map((t) => <TicketCard key={t.id} t={t} />)
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
