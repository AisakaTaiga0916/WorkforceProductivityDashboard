import type { TicketPriority, TicketStatus } from "@prisma/client/primary";
import Link from "next/link";
import { Plus } from "lucide-react";
import { AssigneeColorHighlight } from "@/components/ticket/AssigneeColorHighlight";
import { AssigneeInitialsBadge } from "@/components/ticket/AssigneeInitialsBadge";
import { CancelRequestButton } from "@/components/tickets/CancelRequestButton";
import { CreateRequestButton } from "@/components/tickets/CreateRequestModal";
import { TicketBoardFilterBar } from "@/app/agent/ticket-board-filter-bar";
import {
  customerHasPendingResolvedTicket,
  customerPendingTicketHref,
  isAwaitingCustomerConfirmation,
} from "@/lib/customer-pending-resolution";
import { loadStaffAssignmentColorsForAgents } from "@/lib/assignee-assignment-color";
import { BRAND_TITLE } from "@/lib/brand";
import { cn } from "@/lib/cn";
import { prisma } from "@/lib/prisma";
import { isRequestTypeId } from "@/lib/request-types";
import { visibleIntakeRequestTypes } from "@/lib/intake-request-type-visibility";
import { getIntakeRequestTypeVisibility } from "@/lib/intake-request-type-visibility-db";

/** Canonical deep link for the My Requests swipe pane on Request Board. */
export const MY_REQUESTS_HREF = "/agent?pane=mine";

type ColumnId = "open" | "inProgress" | "forConfirmation" | "closed";

type ColumnDef = {
  id: ColumnId;
  title: string;
  match: (s: TicketStatus) => boolean;
  tone: { dot: string; label: string; ring: string };
};

const COLUMNS: ColumnDef[] = [
  {
    id: "open",
    title: "Open",
    match: (s) => s === "OPEN",
    tone: {
      dot: "bg-orange-500",
      label: "text-orange-800 dark:text-orange-300",
      ring: "ring-orange-500/30",
    },
  },
  {
    id: "inProgress",
    title: "In progress",
    match: (s) => s === "IN_PROGRESS" || s === "PENDING_INFO" || s === "ESCALATED",
    tone: {
      dot: "bg-amber-500",
      label: "text-amber-800 dark:text-amber-300",
      ring: "ring-amber-500/30",
    },
  },
  {
    id: "forConfirmation",
    title: "For confirmation",
    match: (s) => s === "FOR_CONFIRMATION" || s === "RESOLVED",
    tone: {
      dot: "bg-emerald-500",
      label: "text-emerald-800 dark:text-emerald-300",
      ring: "ring-emerald-500/30",
    },
  },
  {
    id: "closed",
    title: "Closed",
    match: (s) => s === "CLOSED",
    tone: {
      dot: "bg-zinc-500",
      label: "text-zinc-700 dark:text-zinc-300",
      ring: "ring-zinc-500/30",
    },
  },
];

const STATUS_OPTIONS: Array<{ label: string; value: string }> = [
  { label: "All", value: "ALL" },
  { label: "Open", value: "OPEN" },
  { label: "In Progress", value: "IN_PROGRESS" },
  { label: "Transfer pending", value: "ESCALATED" },
  { label: "For confirmation", value: "FOR_CONFIRMATION" },
  { label: "Resolved (legacy)", value: "RESOLVED" },
  { label: "Closed", value: "CLOSED" },
];

const PRIORITY_OPTIONS: Array<{ label: string; value: string }> = [
  { label: "All", value: "ALL" },
  { label: "Set Priority Level", value: "UNSET" },
  { label: "Low", value: "LOW" },
  { label: "Medium", value: "MEDIUM" },
  { label: "High", value: "HIGH" },
  { label: "Urgent", value: "URGENT" },
];

function statusPillClass(status: TicketStatus) {
  if (status === "ESCALATED")
    return "bg-rose-500/15 text-rose-800 dark:bg-rose-500/20 dark:text-rose-200";
  if (status === "IN_PROGRESS" || status === "PENDING_INFO")
    return "bg-amber-500/15 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200";
  if (status === "OPEN")
    return "bg-orange-500/15 text-orange-900 dark:bg-orange-500/20 dark:text-orange-200";
  if (status === "FOR_CONFIRMATION" || status === "RESOLVED")
    return "bg-emerald-500/15 text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-200";
  return "bg-zinc-200 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-200";
}

function priorityPillClass(priority: TicketPriority) {
  if (priority === "URGENT")
    return "border-rose-400/60 bg-rose-500/15 text-rose-900 dark:bg-rose-500/20 dark:text-rose-200";
  if (priority === "HIGH")
    return "border-orange-400/60 bg-orange-500/15 text-orange-900 dark:bg-orange-500/20 dark:text-orange-200";
  if (priority === "MEDIUM")
    return "border-amber-300/70 bg-amber-500/10 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200";
  if (priority === "LOW")
    return "border-emerald-400/60 bg-emerald-500/10 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-200";
  return "border-zinc-300 bg-zinc-100 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300";
}

function priorityLabel(priority: TicketPriority) {
  if (priority === "UNSET") return "Set priority";
  return priority.charAt(0) + priority.slice(1).toLowerCase();
}

function statusLabel(status: TicketStatus) {
  switch (status) {
    case "FOR_CONFIRMATION":
      return "Awaiting sign-off";
    case "PENDING_INFO":
      return "In progress";
    case "IN_PROGRESS":
      return "In progress";
    case "ESCALATED":
      return "Transfer pending";
    case "RESOLVED":
      return "Resolved";
    case "OPEN":
      return "Open";
    case "CLOSED":
      return "Closed";
    default:
      return String(status).replaceAll("_", " ");
  }
}

function relativeTime(d: Date) {
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  return d.toLocaleDateString();
}

export async function MyRequestsBoard({
  email,
  authProvider,
  query = "",
  selectedPriority = "ALL",
  selectedStatus = "ALL",
  selectedRequestType = "ALL",
  submitted = false,
  savedFilterStorageKey,
}: {
  email: string;
  authProvider?: string | null;
  query?: string;
  selectedPriority?: string;
  selectedStatus?: string;
  selectedRequestType?: string;
  submitted?: boolean;
  savedFilterStorageKey?: string;
}) {
  const me = email.trim().toLowerCase();
  const requestTypeVisibility = await getIntakeRequestTypeVisibility();
  const visibleRequestTypes = visibleIntakeRequestTypes(requestTypeVisibility.hiddenTypeIds);
  const requestTypeFilter =
    selectedRequestType === "ALL" || isRequestTypeId(selectedRequestType)
      ? selectedRequestType === "ALL" ||
        visibleRequestTypes.some((t) => t.id === selectedRequestType)
        ? selectedRequestType
        : "ALL"
      : "ALL";

  const clauses: Array<Record<string, unknown>> = [
    {
      OR: [
        { contactEmail: { equals: me, mode: "insensitive" as const } },
        { requestorEmail: { equals: me, mode: "insensitive" as const } },
      ],
    },
  ];

  if (query) {
    clauses.push({
      OR: [
        { ticketNumber: { contains: query, mode: "insensitive" as const } },
        { title: { contains: query, mode: "insensitive" as const } },
      ],
    });
  }
  if (selectedPriority !== "ALL") {
    clauses.push({ priority: selectedPriority as TicketPriority });
  }
  if (selectedStatus !== "ALL") {
    if (selectedStatus === "IN_PROGRESS") {
      clauses.push({ status: { in: ["IN_PROGRESS", "PENDING_INFO"] } });
    } else {
      clauses.push({ status: selectedStatus as TicketStatus });
    }
  }
  if (requestTypeFilter !== "ALL") {
    clauses.push({ requestType: requestTypeFilter });
  }

  const where = clauses.length === 1 ? clauses[0] : { AND: clauses };

  const tickets = await prisma.ticket.findMany({
    where,
    orderBy: [{ priority: "asc" }, { updatedAt: "desc" }],
    include: { team: true, assignedAgent: true },
    take: 200,
  });

  const assigneeColorByEmail =
    tickets.length > 0
      ? await loadStaffAssignmentColorsForAgents(
          tickets.map((t) => ({ email: t.assignedAgent?.email, name: t.assignedAgent?.name })),
        )
      : new Map<string, string | null>();

  const counts = {
    total: tickets.length,
    open: tickets.filter((t) => t.status === "OPEN").length,
    inProgress: tickets.filter(
      (t) => t.status === "IN_PROGRESS" || t.status === "PENDING_INFO" || t.status === "ESCALATED",
    ).length,
    forConfirmation: tickets.filter(
      (t) => t.status === "FOR_CONFIRMATION" || t.status === "RESOLVED",
    ).length,
    closed: tickets.filter((t) => t.status === "CLOSED").length,
  };

  const intakeBlock = await customerHasPendingResolvedTicket(me, authProvider);

  return (
    <div className="flex flex-col gap-4 sm:gap-5">
      {submitted ? (
        <div className="rounded-xl border border-orange-400/50 bg-orange-500/15 px-4 py-3 text-sm text-orange-950 dark:border-orange-500/40 dark:bg-orange-500/10 dark:text-orange-200">
          Request submitted successfully. It appears below in your dashboard.
        </div>
      ) : null}

      <header className="rounded-2xl border border-zinc-200 bg-gradient-to-br from-white via-white to-orange-50/40 p-4 shadow-[0_12px_36px_rgba(0,0,0,0.05)] dark:border-zinc-800/90 dark:from-[#171614] dark:via-[#131313] dark:to-[#10100f] dark:shadow-[0_18px_48px_rgba(0,0,0,0.35)] sm:p-5 md:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-orange-700 dark:text-orange-400/95">
              {BRAND_TITLE} · My Requests
            </p>
            <h2 className="mt-1.5 text-[1.5rem] font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-[1.85rem]">
              My requests
            </h2>
            <p className="mt-1 max-w-xl text-sm text-zinc-600 dark:text-zinc-400">
              Tickets you submitted as requestor. Confirm and rate resolved work in the{" "}
              <span className="font-semibold text-emerald-800 dark:text-emerald-300">For confirmation</span> column.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {intakeBlock != null ? (
              <Link
                href={customerPendingTicketHref(intakeBlock)}
                className="inline-flex h-10 items-center gap-2 rounded-lg border border-amber-500/50 bg-amber-500/15 px-4 text-sm font-semibold text-amber-950 shadow-sm transition hover:bg-amber-500/25 dark:text-amber-100"
                title="Finish this request before opening another."
              >
                <Plus className="size-4" aria-hidden />
                Resume {intakeBlock.ticketNumber}
              </Link>
            ) : (
              <CreateRequestButton
                showPlusIcon
                className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#f97316] px-4 text-sm font-semibold text-white shadow-[0_8px_24px_rgba(249,115,22,0.32)] transition hover:bg-[#fb923c] active:translate-y-px"
              />
            )}
          </div>
        </div>

        <div className="mt-4">
          <TicketBoardFilterBar
            initialQuery={query}
            placeholder="Search request # or title"
            savedFilterStorageKey={savedFilterStorageKey}
            company={{ visible: false, value: "ALL", options: [{ value: "ALL", label: "All companies" }] }}
            section={{ visible: false, value: "ALL", options: [{ value: "ALL", label: "All departments" }] }}
            assigned={{ visible: false, value: "ALL", options: [{ value: "ALL", label: "All" }] }}
            priority={{
              visible: true,
              value: selectedPriority,
              options: PRIORITY_OPTIONS,
            }}
            requestType={{
              visible: true,
              value: requestTypeFilter,
              options: [
                { value: "ALL", label: "All request types" },
                ...visibleRequestTypes.map((t) => ({
                  value: t.id,
                  label: `${t.acronym} · ${t.label}`,
                })),
              ],
            }}
            status={{
              visible: true,
              value: selectedStatus,
              options: STATUS_OPTIONS,
            }}
          />
        </div>
      </header>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatTile label="Total" value={counts.total} accent={false} />
        <StatTile label="Open" value={counts.open} accent="orange" />
        <StatTile label="In progress" value={counts.inProgress} accent="amber" />
        <StatTile label="For confirmation" value={counts.forConfirmation} accent="emerald" />
        <StatTile label="Closed" value={counts.closed} accent={false} />
      </section>

      <section className="-mx-1 grid gap-4 px-1 md:mx-0 md:grid-cols-2 md:px-0 xl:grid-cols-4">
        {COLUMNS.map((col) => {
          const list = tickets.filter((t) => col.match(t.status));
          return (
            <div
              key={col.id}
              className="flex min-h-[280px] flex-col rounded-2xl border border-zinc-200 bg-white shadow-[0_8px_24px_rgba(0,0,0,0.04)] dark:border-zinc-800/90 dark:bg-surface dark:shadow-[0_14px_36px_rgba(0,0,0,0.32)]"
            >
              <div className="flex items-center justify-between gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800/80">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className={cn("size-2.5 shrink-0 rounded-full ring-4", col.tone.dot, col.tone.ring)} />
                  <div className="min-w-0">
                    <h3 className={cn("text-[11px] font-bold uppercase tracking-[0.18em]", col.tone.label)}>
                      {col.title}
                    </h3>
                  </div>
                </div>
                <span className="shrink-0 rounded-full border border-zinc-200 bg-zinc-100 px-2 py-0.5 text-[11px] font-bold tabular-nums text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800/70 dark:text-zinc-300">
                  {list.length}
                </span>
              </div>
              <div className="flex max-h-[min(60vh,640px)] min-h-[160px] flex-col gap-2.5 overflow-y-auto p-3">
                {list.length === 0 ? (
                  <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-zinc-200 px-3 py-8 text-center text-xs text-zinc-500 dark:border-zinc-700 dark:text-zinc-500">
                    {col.id === "open"
                      ? "No open requests. Submit a request to get started."
                      : col.id === "inProgress"
                        ? "Nothing being worked on right now."
                        : col.id === "forConfirmation"
                          ? "Nothing waiting on your confirmation."
                          : "No closed requests yet."}
                  </div>
                ) : (
                  list.map((t) => {
                    const assigneeKey = t.assignedAgent?.email
                      ? (assigneeColorByEmail.get(t.assignedAgent.email.trim().toLowerCase()) ?? null)
                      : null;
                    const awaitingConfirmation = isAwaitingCustomerConfirmation(t.status);
                    const ticketHref = awaitingConfirmation
                      ? customerPendingTicketHref(t)
                      : `/tickets/${t.id}`;
                    return (
                      <AssigneeColorHighlight
                        key={t.id}
                        assigneeColorKey={assigneeKey}
                        className="group rounded-xl border border-zinc-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-orange-400/60 hover:bg-orange-50/40 hover:shadow-md dark:border-zinc-700/80 dark:bg-[#181716] dark:hover:border-orange-500/40 dark:hover:bg-[#201f1d]"
                      >
                        <Link href={ticketHref} className="block p-3.5">
                          <div className="flex items-start justify-between gap-2">
                            <span className="font-mono text-[11px] font-bold text-orange-700 dark:text-orange-300">
                              {t.ticketNumber}
                            </span>
                            <span
                              className={cn(
                                "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                                statusPillClass(t.status),
                              )}
                            >
                              {statusLabel(t.status)}
                            </span>
                          </div>
                          <p className="mt-2 line-clamp-2 text-sm font-semibold text-zinc-900 transition group-hover:text-orange-900 dark:text-zinc-100 dark:group-hover:text-orange-100">
                            {t.title}
                          </p>
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            <span
                              className={cn(
                                "inline-flex rounded-md border px-1.5 py-0.5 text-[10px] font-semibold",
                                priorityPillClass(t.priority),
                              )}
                            >
                              {priorityLabel(t.priority)}
                            </span>
                            {t.team?.name ? (
                              <span className="inline-flex rounded-md border border-zinc-200 bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300">
                                {t.team.name}
                              </span>
                            ) : null}
                          </div>
                          <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-zinc-600 dark:text-zinc-400">
                            <span className="flex min-w-0 items-center gap-1.5 truncate">
                              {t.assignedAgent?.name ? (
                                <>
                                  <AssigneeInitialsBadge
                                    agentName={t.assignedAgent.name}
                                    assigneeColorKey={assigneeKey}
                                    className="shrink-0"
                                  />
                                  <span className="truncate">
                                    Assigned:{" "}
                                    <span className="font-medium text-zinc-800 dark:text-zinc-200">
                                      {t.assignedAgent.name}
                                    </span>
                                  </span>
                                </>
                              ) : (
                                <span className="text-zinc-500">No assignee yet</span>
                              )}
                            </span>
                            <span className="shrink-0 text-zinc-500 dark:text-zinc-500">
                              {relativeTime(t.updatedAt)}
                            </span>
                          </div>
                          {awaitingConfirmation ? (
                            <p className="mt-3 inline-flex w-full items-center justify-center rounded-lg bg-emerald-600 px-3 py-2 text-center text-xs font-bold uppercase tracking-[0.08em] text-white shadow-sm transition group-hover:bg-emerald-500">
                              Confirm resolution
                            </p>
                          ) : null}
                        </Link>
                        {!t.assignedAgentId && t.status !== "CLOSED" ? (
                          <div className="border-t border-zinc-200 px-3.5 pb-3.5 pt-2 dark:border-zinc-700/80">
                            <CancelRequestButton
                              ticketId={t.id}
                              ticketNumber={t.ticketNumber}
                              stopPropagation
                            />
                          </div>
                        ) : null}
                      </AssigneeColorHighlight>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
}

function StatTile({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent: false | "orange" | "amber" | "emerald";
}) {
  const valueClass =
    accent === "orange"
      ? "text-orange-700 dark:text-orange-300"
      : accent === "amber"
        ? "text-amber-700 dark:text-amber-300"
        : accent === "emerald"
          ? "text-emerald-700 dark:text-emerald-300"
          : "text-zinc-900 dark:text-zinc-100";
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800/90 dark:bg-surface">
      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-600 dark:text-zinc-500">{label}</p>
      <p className={cn("mt-1 text-3xl font-semibold tabular-nums", valueClass)}>{value}</p>
    </div>
  );
}
