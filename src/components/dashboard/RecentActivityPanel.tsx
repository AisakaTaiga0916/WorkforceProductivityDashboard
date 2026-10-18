"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { ActivityActor, TicketPriority, TicketStatus } from "@prisma/client/primary";
import { AgentTicketDeepLink } from "@/components/AgentTicketDeepLink";
import { AssigneeInitialsBadge } from "@/components/ticket/AssigneeInitialsBadge";
import { cn } from "@/lib/cn";
import { parseJobOrderDescription } from "@/modules/requests/job-order";
import { formatTicketActivityDetail } from "@/modules/requests/ticket-activity-display";
import { formatTicketPriorityLabel } from "@/modules/requests/ticket-priority-label";

export type TicketActivityLogRow = {
  id: string;
  ticketId: string;
  summary: string;
  detail: string | null;
  actor: ActivityActor;
  createdAt: string;
  ticketNumber: string;
  ticketTitle: string;
  ticketStatus: TicketStatus;
};

function relative(iso: string, referenceMs: number) {
  const ts = new Date(iso).getTime();
  const m = Math.floor((referenceMs - ts) / 60000);
  if (m <= 0) return "Just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function statusTone(status: TicketStatus) {
  if (status === "IN_PROGRESS") return "bg-orange-500/15 text-orange-900 dark:bg-orange-500/20 dark:text-orange-300";
  if (status === "ESCALATED") return "bg-rose-500/15 text-rose-900 dark:bg-rose-500/20 dark:text-rose-300";
  if (status === "FOR_CONFIRMATION" || status === "RESOLVED" || status === "CLOSED")
    return "bg-emerald-500/15 text-emerald-900 dark:bg-emerald-500/18 dark:text-emerald-300";
  if (status === "PENDING_INFO") return "bg-amber-500/15 text-amber-900 dark:bg-amber-500/20 dark:text-amber-300";
  return "bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-zinc-200";
}

function actorLabel(actor: ActivityActor) {
  return actor.replaceAll("_", " ");
}

type TicketDetailJson = {
  id: string;
  ticketNumber: string;
  title: string;
  description: string;
  status: TicketStatus;
  priority: TicketPriority;
  category: string;
  contactName: string;
  contactEmail: string;
  assignedAgent: { id: string; name: string; email: string; staffAssignmentColor?: string | null } | null;
  firstResponseDueAt: string;
  resolutionDueAt: string;
  createdAt: string;
  updatedAt: string;
};

const PREVIEW_COUNT = 3;

function LogRowCard({
  row,
  nowMs,
  onOpenTicket,
  interactive,
}: {
  row: TicketActivityLogRow;
  nowMs: number;
  onOpenTicket: (ticketId: string) => void;
  interactive?: boolean;
}) {
  const detailText = formatTicketActivityDetail(row.summary, row.detail);

  return (
    <article
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={interactive ? () => onOpenTicket(row.ticketId) : undefined}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onOpenTicket(row.ticketId);
              }
            }
          : undefined
      }
      className={cn(
        "rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm transition dark:border-zinc-800 dark:bg-zinc-900",
        interactive &&
          "cursor-pointer hover:border-orange-400/50 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500 dark:hover:border-orange-500/40",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-snug text-zinc-900 dark:text-zinc-100">{row.summary}</p>
          {detailText ? (
            <p className="mt-1 line-clamp-2 text-xs text-zinc-600 dark:text-zinc-400">{detailText}</p>
          ) : null}
          <p className="mt-2 text-xs font-medium text-zinc-500 dark:text-zinc-500">
            <span className="text-orange-700 dark:text-orange-400">{row.ticketNumber}</span>
            <span className="mx-1.5 text-zinc-400">·</span>
            <span className="line-clamp-1 text-zinc-700 dark:text-zinc-300">{row.ticketTitle}</span>
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2 sm:flex-row sm:items-center">
          <span className="text-[10px] font-bold uppercase tracking-wide text-zinc-500 dark:text-zinc-500">
            {relative(row.createdAt, nowMs)}
          </span>
          <span
            className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${statusTone(row.ticketStatus)}`}
          >
            {row.ticketStatus.replaceAll("_", " ")}
          </span>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-zinc-100 pt-3 dark:border-zinc-800/80">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
          {actorLabel(row.actor)}
        </span>
        {interactive ? (
          <span className="text-[10px] font-bold uppercase tracking-wide text-orange-700 dark:text-orange-400">
            View ticket →
          </span>
        ) : (
          <span className="text-[10px] text-zinc-400 dark:text-zinc-600">
            {new Date(row.createdAt).toLocaleString()}
          </span>
        )}
      </div>
    </article>
  );
}

function TicketDetailFloat({
  ticketId,
  onClose,
}: {
  ticketId: string | null;
  onClose: () => void;
}) {
  if (!ticketId) return null;

  return <TicketDetailFloatPanel key={ticketId} ticketId={ticketId} onClose={onClose} />;
}

function TicketDetailFloatPanel({
  ticketId,
  onClose,
}: {
  ticketId: string;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [data, setData] = useState<TicketDetailJson | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function fetchTicket() {
      try {
        const res = await fetch(`/api/tickets/${ticketId}`);
        const json = (await res.json().catch(() => ({}))) as { error?: string } & Partial<TicketDetailJson>;
        if (cancelled) return;
        if (!res.ok) {
          setError(json.error ?? "Could not load ticket.");
          setData(null);
          return;
        }
        setError(null);
        setData(json as TicketDetailJson);
      } catch {
        if (!cancelled) {
          setError("Network error.");
          setData(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void fetchTicket();
    return () => {
      cancelled = true;
    };
  }, [ticketId]);

  const jobOrderDetails = useMemo(
    () => (data?.description ? parseJobOrderDescription(data.description) : null),
    [data?.description],
  );

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[95] flex items-center justify-center p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Ticket details"
    >
      <button
        type="button"
        className="absolute inset-0 bg-zinc-950/55 backdrop-blur-[2px]"
        aria-label="Close ticket details"
        onClick={onClose}
      />
      <aside className="relative z-[96] flex max-h-[min(90dvh,720px)] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-zinc-200/90 bg-white/95 shadow-[0_24px_80px_rgba(0,0,0,0.28)] ring-1 ring-black/5 backdrop-blur-xl dark:border-zinc-700/90 dark:bg-zinc-900/95 dark:ring-white/10 sm:rounded-3xl">
        <header className="flex items-start justify-between gap-3 border-b border-zinc-200/80 px-4 py-3.5 dark:border-zinc-800/80 sm:px-5">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-orange-700 dark:text-orange-400">
              Ticket details
            </p>
            {loading ? (
              <p className="mt-1 text-sm text-zinc-500">Loading…</p>
            ) : data ? (
              <>
                <p className="mt-1 truncate text-lg font-bold text-zinc-900 dark:text-zinc-50">{data.ticketNumber}</p>
                <p className="mt-0.5 line-clamp-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">{data.title}</p>
              </>
            ) : (
              <p className="mt-1 text-sm text-zinc-500">—</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs font-semibold text-zinc-700 hover:bg-zinc-100 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
          >
            Close
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          {error ? (
            <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-200">
              {error}
            </p>
          ) : null}
          {!loading && data ? (
            <div className="space-y-4 text-sm">
              <div className="flex flex-wrap gap-2">
                <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ${statusTone(data.status)}`}>
                  {data.status.replaceAll("_", " ")}
                </span>
                <span
                  className={cn(
                    "rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-[10px] font-bold text-zinc-700 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
                    data.priority === "UNSET" ? "normal-case" : "uppercase",
                  )}
                >
                  {formatTicketPriorityLabel(data.priority)}
                </span>
                <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-[10px] font-bold uppercase text-zinc-600 dark:border-zinc-700 dark:bg-zinc-400/20 dark:text-zinc-300">
                  {data.category}
                </span>
              </div>
              <dl className="grid gap-2 text-xs">
                <div className="flex justify-between gap-3">
                  <dt className="text-zinc-500">Requester</dt>
                  <dd className="max-w-[60%] text-right font-medium text-zinc-900 dark:text-zinc-100">{data.contactName}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-zinc-500">Email</dt>
                  <dd className="max-w-[60%] truncate text-right font-medium text-zinc-800 dark:text-zinc-200">
                    {data.contactEmail}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-zinc-500">Assignee</dt>
                  <dd className="flex items-center justify-end gap-2 text-right font-medium text-zinc-900 dark:text-zinc-100">
                    <AssigneeInitialsBadge
                      agentName={data.assignedAgent?.name ?? null}
                      assigneeColorKey={data.assignedAgent?.staffAssignmentColor ?? null}
                      className="shrink-0"
                    />
                    <span className="min-w-0">{data.assignedAgent?.name ?? "Unassigned"}</span>
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-zinc-500">First response due</dt>
                  <dd className="text-right font-medium tabular-nums text-zinc-900 dark:text-zinc-100">
                    {new Date(data.firstResponseDueAt).toLocaleString()}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-zinc-500">Resolution due</dt>
                  <dd className="text-right font-medium tabular-nums text-zinc-900 dark:text-zinc-100">
                    {new Date(data.resolutionDueAt).toLocaleString()}
                  </dd>
                </div>
              </dl>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500">Description</p>
                {jobOrderDetails ? (
                  <dl className="mt-2 grid gap-2 text-xs">
                    <div>
                      <dt className="text-zinc-500">Nature of concern</dt>
                      <dd className="mt-0.5 font-medium text-zinc-800 dark:text-zinc-200">
                        {jobOrderDetails.natureOfConcern.length > 0
                          ? jobOrderDetails.natureOfConcern.join(", ")
                          : "—"}
                      </dd>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <dt className="text-zinc-500">Building</dt>
                        <dd className="mt-0.5 font-medium text-zinc-800 dark:text-zinc-200">
                          {jobOrderDetails.building || "—"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-zinc-500">Expected duration</dt>
                        <dd className="mt-0.5 font-medium text-zinc-800 dark:text-zinc-200">
                          {jobOrderDetails.expectedDuration || "—"}
                        </dd>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <dt className="text-zinc-500">Start date</dt>
                        <dd className="mt-0.5 font-medium tabular-nums text-zinc-800 dark:text-zinc-200">
                          {jobOrderDetails.startDate || "—"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-zinc-500">Target date</dt>
                        <dd className="mt-0.5 font-medium tabular-nums text-zinc-800 dark:text-zinc-200">
                          {jobOrderDetails.targetDate || "—"}
                        </dd>
                      </div>
                    </div>
                    {jobOrderDetails.notes ? (
                      <div>
                        <dt className="text-zinc-500">Notes</dt>
                        <dd className="mt-0.5 whitespace-pre-wrap font-medium text-zinc-800 dark:text-zinc-200">
                          {jobOrderDetails.notes}
                        </dd>
                      </div>
                    ) : null}
                  </dl>
                ) : (
                  <p className="mt-1 line-clamp-6 whitespace-pre-wrap text-xs leading-relaxed text-zinc-700 dark:text-zinc-300">
                    {data.description || "—"}
                  </p>
                )}
              </div>
              <AgentTicketDeepLink
                ticketId={data.id}
                onNavigate={onClose}
                className="inline-flex w-full items-center justify-center rounded-xl bg-orange-600 px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-white shadow-sm transition hover:bg-orange-500"
              >
                Open in queue
              </AgentTicketDeepLink>
            </div>
          ) : null}
        </div>
      </aside>
    </div>,
    document.body,
  );
}

export function RecentActivityPanel({
  activities,
  nowMs,
}: {
  activities: TicketActivityLogRow[];
  nowMs: number;
}) {
  const [logOpen, setLogOpen] = useState(false);
  const [detailTicketId, setDetailTicketId] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  const preview = useMemo(() => activities.slice(0, PREVIEW_COUNT), [activities]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!logOpen && !detailTicketId) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [logOpen, detailTicketId]);

  useEffect(() => {
    if (!logOpen && !detailTicketId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (detailTicketId) {
        setDetailTicketId(null);
        return;
      }
      setLogOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [logOpen, detailTicketId]);

  const openTicketFromLog = useCallback((ticketId: string) => {
    setDetailTicketId(ticketId);
  }, []);

  const activityLogModal =
    mounted && logOpen
      ? createPortal(
          <div className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center sm:p-6">
            <button
              type="button"
              className="absolute inset-0 bg-zinc-950/65 backdrop-blur-sm"
              aria-label="Close activity log"
              onClick={() => setLogOpen(false)}
            />
            <section
              className={cn(
                "relative z-[81] flex max-h-[min(92dvh,720px)] w-full max-w-3xl flex-col overflow-hidden rounded-t-3xl border border-zinc-200/90 bg-white/95 shadow-[0_-12px_60px_rgba(0,0,0,0.2)] ring-1 ring-black/5 backdrop-blur-xl dark:border-zinc-700/90 dark:bg-zinc-950/95 dark:shadow-[0_-20px_80px_rgba(0,0,0,0.55)] dark:ring-white/5 sm:rounded-3xl sm:shadow-[0_28px_100px_rgba(0,0,0,0.35)]",
              )}
            >
              <header className="flex shrink-0 items-start justify-between gap-3 border-b border-zinc-200/80 px-5 py-4 dark:border-zinc-800/80">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-orange-700 dark:text-orange-400">
                    Ticket audit log
                  </p>
                  <h3 className="mt-1 text-lg font-bold text-zinc-900 dark:text-zinc-50">All activity</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setLogOpen(false)}
                  className="shrink-0 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs font-semibold text-zinc-800 hover:bg-zinc-100 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
                >
                  Close
                </button>
              </header>

              <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-2 sm:px-5">
                {activities.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-500">
                    No ticket logs available.
                  </p>
                ) : (
                  <div className="space-y-2">
                    <p className="sticky top-0 z-[1] -mx-1 mb-3 rounded-xl border border-orange-200/80 bg-orange-50/95 px-3 py-2 text-[11px] font-semibold text-orange-950 backdrop-blur-sm dark:border-orange-500/25 dark:bg-orange-950/50 dark:text-orange-100">
                      Showing every log entry below. The dashboard still highlights the {PREVIEW_COUNT} most recent
                      events above.
                    </p>
                    <ul className="space-y-2.5">
                      {activities.map((row) => (
                        <li key={`full-${row.id}`}>
                          <LogRowCard row={row} nowMs={nowMs} onOpenTicket={openTicketFromLog} interactive />
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </section>
          </div>,
          document.body,
        )
      : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-zinc-900 sm:text-3xl dark:text-zinc-100">Recent Activity</h2>
        </div>
        <button
          type="button"
          onClick={() => setLogOpen(true)}
          className="rounded-full border border-orange-200 bg-orange-50 px-4 py-2 text-sm font-semibold text-orange-900 shadow-sm transition hover:bg-orange-100 dark:border-orange-500/30 dark:bg-orange-500/10 dark:text-orange-200 dark:hover:bg-orange-500/20"
        >
          View all logs
        </button>
      </div>

      {activities.length === 0 ? (
        <article className="rounded-2xl border border-zinc-200 bg-white p-5 text-sm text-zinc-600 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-500">
          No recent ticket activity yet.
        </article>
      ) : (
        <div className="space-y-3">
          {preview.map((row) => (
            <LogRowCard key={row.id} row={row} nowMs={nowMs} onOpenTicket={openTicketFromLog} interactive />
          ))}
        </div>
      )}

      {activityLogModal}

      <TicketDetailFloat ticketId={detailTicketId} onClose={() => setDetailTicketId(null)} />
    </div>
  );
}
