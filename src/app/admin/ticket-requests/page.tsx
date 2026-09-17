import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, ClipboardList, LayoutGrid, PlusCircle, Users } from "lucide-react";
import type { TicketStatus } from "@prisma/client/primary";
import { requireSession } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { BRAND_TITLE } from "@/lib/brand";
import { formatTicketPriorityLabel } from "@/lib/ticket-priority-label";

export const dynamic = "force-dynamic";

function firstQuery(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

function statusChipClass(status: TicketStatus) {
  switch (status) {
    case "OPEN":
      return "bg-sky-500/15 text-sky-800 ring-sky-500/25 dark:text-sky-200";
    case "IN_PROGRESS":
    case "PENDING_INFO":
      return "bg-orange-500/15 text-orange-900 ring-orange-500/25 dark:text-orange-200";
    case "ESCALATED":
      return "bg-rose-500/15 text-rose-900 ring-rose-500/25 dark:text-rose-200";
    case "FOR_CONFIRMATION":
    case "RESOLVED":
    case "CLOSED":
      return "bg-violet-500/12 text-violet-900 ring-violet-500/20 dark:text-violet-200";
    default:
      return "bg-zinc-500/12 text-zinc-800 ring-zinc-500/20 dark:text-zinc-200";
  }
}

export default async function AdminTicketRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ submitted?: string | string[] }>;
}) {
  const session = await requireSession();
  if (!session?.user) redirect("/signin");
  if (!["SuperAdmin", "HighAdmin", "Admin"].includes(session.user.role)) redirect("/");

  const params = await searchParams;
  const submitted = firstQuery(params.submitted) === "1";

  const now = new Date();
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const activeStatuses: TicketStatus[] = ["OPEN", "IN_PROGRESS", "PENDING_INFO", "ESCALATED"];

  const [
    created24h,
    created7d,
    openPipeline,
    unassignedOpen,
    urgentOpen,
    recentTickets,
  ] = await Promise.all([
    prisma.ticket.count({ where: { createdAt: { gte: dayAgo } } }),
    prisma.ticket.count({ where: { createdAt: { gte: weekAgo } } }),
    prisma.ticket.count({ where: { status: { in: activeStatuses } } }),
    prisma.ticket.count({
      where: { status: { in: activeStatuses }, assignedAgentId: null },
    }),
    prisma.ticket.count({
      where: {
        status: { in: activeStatuses },
        priority: { in: ["URGENT", "HIGH"] },
      },
    }),
    prisma.ticket.findMany({
      orderBy: { createdAt: "desc" },
      take: 35,
      select: {
        id: true,
        ticketNumber: true,
        title: true,
        status: true,
        priority: true,
        category: true,
        contactName: true,
        contactEmail: true,
        createdAt: true,
        team: { select: { name: true } },
        assignedAgent: { select: { name: true } },
      },
    }),
  ]);

  return (
    <main className="min-h-[calc(100vh-56px)] bg-zinc-50 px-3 py-6 text-zinc-900 sm:px-4 sm:py-8 dark:bg-[#070d19] dark:text-zinc-100">
      <div className="mx-auto max-w-6xl space-y-6">
        {submitted ? (
          <div className="rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-950 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100">
            <p className="font-semibold">Ticket created</p>
            <p className="mt-0.5 text-xs opacity-90">
              The request is in the queue. You can open it from the board or the table below.
            </p>
          </div>
        ) : null}

        <header className="flex flex-col gap-5 rounded-2xl border border-zinc-200 bg-gradient-to-b from-white to-zinc-50 p-6 shadow-[0_12px_40px_rgba(0,0,0,0.06)] sm:flex-row sm:items-end sm:justify-between md:p-8 dark:border-zinc-800/90 dark:from-[#0d1629] dark:to-[#0b1220] dark:shadow-[0_18px_48px_rgba(0,0,0,0.35)]">
          <div className="min-w-0 space-y-2">
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-orange-700 dark:text-orange-400/95">
              {BRAND_TITLE} · Admin portal
            </p>
            <h1 className="text-2xl font-bold tracking-tight text-zinc-900 sm:text-3xl md:text-4xl dark:text-white">
              Create ticket request
            </h1>
            <p className="max-w-2xl text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
              Log intake on behalf of requesters, monitor fresh volume, and jump to triage or the ops board in one
              place.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:min-w-[220px]">
            <Link
              href="/tickets/new"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-orange-600 px-5 py-3 text-center text-sm font-semibold text-white shadow-sm transition hover:bg-orange-500"
            >
              <PlusCircle className="size-4 shrink-0 opacity-95" aria-hidden />
              New ticket request
            </Link>
            <div className="grid grid-cols-2 gap-2">
              <Link
                href="/admin/manual-assignment"
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-center text-xs font-semibold text-zinc-800 shadow-sm hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                <Users className="size-3.5" aria-hidden />
                Assign
              </Link>
              <Link
                href="/agent"
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-center text-xs font-semibold text-zinc-800 shadow-sm hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                <LayoutGrid className="size-3.5" aria-hidden />
                Board
              </Link>
            </div>
          </div>
        </header>

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <StatCard label="Created · 24h" value={String(created24h)} accent />
          <StatCard label="Created · 7d" value={String(created7d)} />
          <StatCard label="Open pipeline" value={String(openPipeline)} />
          <StatCard label="Unassigned" value={String(unassignedOpen)} />
          <StatCard label="Urgent / high" value={String(urgentOpen)} />
        </section>

        <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-[0_8px_28px_rgba(0,0,0,0.05)] sm:p-6 dark:border-zinc-800/90 dark:bg-[#0b1220] dark:shadow-[0_12px_40px_rgba(0,0,0,0.25)]">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-zinc-200 pb-4 dark:border-zinc-800/80">
            <div>
              <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                <ClipboardList className="size-4 text-orange-600 dark:text-orange-400" aria-hidden />
                Recent requests
              </h2>
            </div>
            <Link
              href="/"
              className="inline-flex items-center gap-1 text-xs font-semibold text-orange-700 hover:underline dark:text-orange-300"
            >
              Ticket dashboard
              <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-[11px] font-bold uppercase tracking-[0.12em] text-zinc-500 dark:border-zinc-800 dark:text-zinc-500">
                  <th className="whitespace-nowrap py-3 pr-4">Ticket</th>
                  <th className="whitespace-nowrap py-3 pr-4">Status</th>
                  <th className="whitespace-nowrap py-3 pr-4">Priority</th>
                  <th className="whitespace-nowrap py-3 pr-4">Category</th>
                  <th className="min-w-[8rem] py-3 pr-4">Requester</th>
                  <th className="whitespace-nowrap py-3 pr-4">Team</th>
                  <th className="whitespace-nowrap py-3 pr-4">Assignee</th>
                  <th className="whitespace-nowrap py-3 text-right">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
                {recentTickets.length === 0 ? (
                  <tr>
                    <td className="py-10 text-center text-zinc-500 dark:text-zinc-500" colSpan={8}>
                      No tickets yet. Use &quot;New ticket request&quot; to log the first one.
                    </td>
                  </tr>
                ) : (
                  recentTickets.map((t) => (
                    <tr key={t.id} className="hover:bg-zinc-50/80 dark:hover:bg-zinc-900/40">
                      <td className="max-w-[220px] py-3 pr-4">
                        <Link
                          href={`/agent/tickets/${t.id}`}
                          className="block font-semibold text-zinc-900 hover:text-orange-700 dark:text-zinc-100 dark:hover:text-orange-300"
                        >
                          {t.ticketNumber}
                        </Link>
                        <span className="mt-0.5 line-clamp-2 text-xs font-normal text-zinc-600 dark:text-zinc-400">
                          {t.title}
                        </span>
                      </td>
                      <td className="whitespace-nowrap py-3 pr-4">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${statusChipClass(t.status)}`}
                        >
                          {t.status.replaceAll("_", " ")}
                        </span>
                      </td>
                      <td className="whitespace-nowrap py-3 pr-4 text-zinc-800 dark:text-zinc-200">
                        {formatTicketPriorityLabel(t.priority)}
                      </td>
                      <td className="whitespace-nowrap py-3 pr-4 text-zinc-700 dark:text-zinc-300">
                        {t.category}
                      </td>
                      <td className="py-3 pr-4">
                        <div className="text-zinc-900 dark:text-zinc-100">{t.contactName}</div>
                        <div className="truncate text-xs text-zinc-500 dark:text-zinc-500">{t.contactEmail}</div>
                      </td>
                      <td className="whitespace-nowrap py-3 pr-4 text-zinc-700 dark:text-zinc-300">
                        {t.team?.name ?? "—"}
                      </td>
                      <td className="whitespace-nowrap py-3 pr-4 text-zinc-700 dark:text-zinc-300">
                        {t.assignedAgent?.name ?? "—"}
                      </td>
                      <td className="whitespace-nowrap py-3 text-right tabular-nums text-zinc-500 dark:text-zinc-500">
                        {t.createdAt.toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <article
      className={
        accent
          ? "rounded-2xl border border-orange-400/35 bg-gradient-to-br from-orange-500/12 to-white p-4 shadow-sm dark:border-orange-500/25 dark:from-orange-500/10 dark:to-zinc-950/80"
          : "rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950/50"
      }
    >
      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-500">{label}</p>
      <p className="mt-2 text-3xl font-bold tabular-nums tracking-tight text-zinc-900 dark:text-white">{value}</p>
    </article>
  );
}
