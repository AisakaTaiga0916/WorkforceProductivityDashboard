import type { Prisma } from "@prisma/client/primary";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { requireSession } from "@/lib/access";
import { customerTicketWhereBySessionEmail } from "@/lib/customer-pending-resolution";
import { prisma } from "@/lib/prisma";
import { findSessionAgentId } from "@/lib/session-agent";
import { BRAND_TITLE, BRAND_TAGLINE_CUSTOMER } from "@/lib/brand";

export const dynamic = "force-dynamic";

type TicketRow = Prisma.TicketGetPayload<{ include: { team: true; assignedAgent: true } }>;

function firstQuery(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

function priorityBadgeClass(priority: TicketRow["priority"]) {
  switch (priority) {
    case "URGENT":
      return "border-red-500/30 bg-red-500/15 text-red-300";
    case "HIGH":
      return "border-orange-500/30 bg-orange-500/15 text-orange-300";
    case "MEDIUM":
      return "border-cyan-500/30 bg-cyan-500/15 text-cyan-300";
    case "LOW":
      return "border-stone-500/30 bg-stone-500/20 text-stone-300";
    default:
      return "border-zinc-600/60 bg-zinc-800 text-zinc-300";
  }
}

function statusBadgeClass(status: TicketRow["status"]) {
  switch (status) {
    case "OPEN":
      return "border-blue-500/30 bg-blue-500/10 text-blue-300";
    case "IN_PROGRESS":
    case "PENDING_INFO":
    case "ESCALATED":
      return "border-cyan-500/30 bg-cyan-500/10 text-cyan-300";
    case "FOR_CONFIRMATION":
    case "RESOLVED":
    case "CLOSED":
      return "border-stone-500/30 bg-stone-500/15 text-stone-300";
    default:
      return "border-zinc-600/60 bg-zinc-800 text-zinc-300";
  }
}

function formatUpdated(date: Date) {
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} mins ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)} days ago`;
  return date.toLocaleDateString();
}

function ticketDetail(ticket: TicketRow) {
  const description = ticket.description?.trim();
  if (description) return description;
  return [ticket.team?.name, ticket.assignedAgent?.name ? `Assigned to ${ticket.assignedAgent.name}` : null]
    .filter(Boolean)
    .join(" · ");
}

function formatStatus(status: TicketRow["status"]) {
  if (status === "PENDING_INFO") return "IN PROGRESS";
  return status.replaceAll("_", " ");
}

function formatPriority(priority: TicketRow["priority"]) {
  return priority === "UNSET" ? "Normal" : priority;
}

function TicketMobileCard({ ticket }: { ticket: TicketRow }) {
  return (
    <Link
      href={`/tickets/${ticket.id}`}
      className="group block rounded-md border border-zinc-200 bg-white p-4 shadow-[0_14px_28px_rgba(0,0,0,0.06)] transition hover:border-orange-500/50 hover:bg-orange-50/40 dark:border-zinc-700/80 dark:bg-[#10100f] dark:shadow-[0_14px_28px_rgba(0,0,0,0.24)] dark:hover:bg-[#181716] md:hidden"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="font-mono text-xs font-semibold text-blue-300">#{ticket.ticketNumber}</span>
        <span
          className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[9px] font-black uppercase tracking-[0.12em] ${priorityBadgeClass(
            ticket.priority,
          )}`}
        >
          <span className="size-1.5 rounded-full bg-current" aria-hidden />
          {formatPriority(ticket.priority)}
        </span>
      </div>
      <h2 className="mt-4 line-clamp-2 text-lg font-semibold leading-snug text-zinc-950 group-hover:text-orange-800 dark:text-zinc-100 dark:group-hover:text-white">
        {ticket.title}
      </h2>
      <p className="mt-2 line-clamp-2 min-h-[2.5rem] text-sm leading-5 text-zinc-500">{ticketDetail(ticket)}</p>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200 pt-3 text-xs text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
        <span className={`rounded-sm border px-2 py-1 text-[10px] font-bold uppercase tracking-[0.12em] ${statusBadgeClass(ticket.status)}`}>
          {formatStatus(ticket.status)}
        </span>
        <div className="flex items-center gap-3">
          <span>{formatUpdated(ticket.updatedAt)}</span>
          <ExternalLink className="size-4 text-zinc-400 transition group-hover:text-orange-300" aria-hidden />
        </div>
      </div>
    </Link>
  );
}

export default async function MyTicketsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[]; submitted?: string | string[] }>;
}) {
  const session = await requireSession();
  if (!session?.user) redirect("/signin");
  if (
    session.user.role !== "Customer" &&
    session.user.role !== "Personnel" &&
    session.user.role !== "Admin"
  ) {
    redirect("/");
  }
  const role = session.user.role;
  const params = await searchParams;
  const query = firstQuery(params.q)?.trim() ?? "";
  const submitted = firstQuery(params.submitted) === "1";

  const scope =
    role === "Customer"
      ? customerTicketWhereBySessionEmail(session.user.email ?? "")
      : await (async () => {
          const operator = await findSessionAgentId({ email: session.user.email, name: session.user.name });
          return operator ? ({ assignedAgentId: operator.id } as const) : { id: "__none__" };
        })();
  const searchOr: Prisma.TicketWhereInput | undefined = query
    ? {
        OR: [
          { ticketNumber: { contains: query, mode: "insensitive" } },
          { title: { contains: query, mode: "insensitive" } },
        ],
      }
    : undefined;
  const tickets = await prisma.ticket.findMany({
    where: searchOr ? { AND: [scope, searchOr] } : scope,
    orderBy: { createdAt: "desc" },
    include: { team: true, assignedAgent: true },
    take: 100,
  });

  return (
    <main className="min-h-[calc(100vh-56px)] bg-zinc-50 text-zinc-900 dark:bg-[#0e0e0d] dark:text-zinc-100">
      <div className="mx-auto max-w-[1440px] space-y-4 px-3 py-4 sm:px-4 lg:px-4">
        {submitted && role === "Customer" ? (
          <div className="rounded-md border border-orange-500/40 bg-orange-500/10 px-4 py-3 text-sm text-orange-900 dark:bg-orange-500/15 dark:text-orange-100">
            Ticket submitted successfully. You can now track it here in your customer portal.
          </div>
        ) : null}

        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-orange-700 dark:text-orange-400">
              {BRAND_TITLE} · {BRAND_TAGLINE_CUSTOMER}
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-zinc-950 dark:text-zinc-100 md:text-3xl">
              {role === "Customer" ? "Active Tickets" : "My tickets"}
            </h1>
            {query ? <p className="mt-2 text-sm text-zinc-500">Showing results for &ldquo;{query}&rdquo;</p> : null}
          </div>
        </header>

        <div className="space-y-3 md:hidden">
          {tickets.length === 0 ? (
            <div className="rounded-md border border-dashed border-zinc-300 px-4 py-8 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-600">
              {role === "Customer" ? "No submitted tickets yet." : "No tickets assigned to you yet."}
            </div>
          ) : (
            tickets.map((ticket) => <TicketMobileCard key={ticket.id} ticket={ticket} />)
          )}
        </div>

        <div className="hidden overflow-hidden rounded-md border border-zinc-200 bg-white shadow-[0_14px_28px_rgba(0,0,0,0.06)] dark:border-zinc-700/80 dark:bg-[#10100f] dark:shadow-[0_14px_28px_rgba(0,0,0,0.24)] md:block">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] table-fixed text-sm">
              <thead className="border-b border-orange-500/20 bg-zinc-100 text-left text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500 dark:bg-[#151413]">
                <tr>
                  <th className="w-[10rem] px-3 py-3">Ticket</th>
                  <th className="px-3 py-3">Request</th>
                  <th className="w-[10rem] px-3 py-3">Status</th>
                  <th className="w-[8rem] px-3 py-3">Priority</th>
                  <th className="w-[10rem] px-3 py-3">Assigned</th>
                  <th className="w-[8rem] px-3 py-3">Updated</th>
                  <th className="w-[4rem] px-3 py-3 text-right">Open</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {tickets.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-sm text-zinc-500 dark:text-zinc-600">
                      {role === "Customer" ? "No submitted tickets yet." : "No tickets assigned to you yet."}
                    </td>
                  </tr>
                ) : (
                  tickets.map((ticket) => (
                    <tr key={ticket.id} className="transition hover:bg-zinc-50 dark:hover:bg-[#181716]">
                      <td className="px-3 py-3 align-top">
                        <Link href={`/tickets/${ticket.id}`} className="font-mono text-xs font-semibold text-blue-300 hover:text-blue-200">
                          #{ticket.ticketNumber}
                        </Link>
                      </td>
                      <td className="px-3 py-3 align-top">
                        <Link href={`/tickets/${ticket.id}`} className="line-clamp-1 font-semibold text-zinc-950 hover:text-orange-700 dark:text-zinc-100 dark:hover:text-white">
                          {ticket.title}
                        </Link>
                        <p className="mt-1 line-clamp-1 text-xs text-zinc-500">{ticketDetail(ticket)}</p>
                      </td>
                      <td className="px-3 py-3 align-top">
                        <span className={`inline-flex rounded-sm border px-2 py-1 text-[10px] font-bold uppercase tracking-[0.12em] ${statusBadgeClass(ticket.status)}`}>
                          {formatStatus(ticket.status)}
                        </span>
                      </td>
                      <td className="px-3 py-3 align-top">
                        <span className={`inline-flex items-center gap-1 rounded-sm border px-2 py-1 text-[10px] font-bold uppercase tracking-[0.12em] ${priorityBadgeClass(ticket.priority)}`}>
                          <span className="size-1.5 rounded-full bg-current" aria-hidden />
                          {formatPriority(ticket.priority)}
                        </span>
                      </td>
                      <td className="px-3 py-3 align-top text-xs text-zinc-600 dark:text-zinc-400">
                        {ticket.assignedAgent?.name ?? "Queue"}
                      </td>
                      <td className="px-3 py-3 align-top text-xs text-zinc-600 dark:text-zinc-400">{formatUpdated(ticket.updatedAt)}</td>
                      <td className="px-3 py-3 align-top">
                        <Link
                          href={`/tickets/${ticket.id}`}
                          className="ml-auto flex size-8 items-center justify-center rounded-md border border-zinc-300 text-zinc-500 transition hover:border-orange-500/50 hover:text-orange-700 dark:border-zinc-800 dark:text-zinc-400 dark:hover:text-orange-300"
                          aria-label={`Open ${ticket.ticketNumber}`}
                        >
                          <ExternalLink className="size-4" aria-hidden />
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </main>
  );
}
