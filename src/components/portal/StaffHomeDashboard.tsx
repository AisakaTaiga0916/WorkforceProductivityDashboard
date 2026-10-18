import Link from "next/link";
import { Code, CreditCard, Rocket, Shield } from "lucide-react";
import { prisma } from "@/modules/platform/db/prisma";
import { loadStaffAssignmentColorsForAgents } from "@/lib/assignee-assignment-color";
import { TicketsKanbanBoard, type KanbanTicket } from "./TicketsKanbanBoard";
import { BRAND_TITLE } from "@/lib/brand";

const categories = [
  {
    title: "Billing & Invoices",
    body: "Statements, payment issues, and invoice questions.",
    icon: CreditCard,
  },
  {
    title: "Technical Support",
    body: "Access, software, and infrastructure help.",
    icon: Code,
  },
  {
    title: "Onboarding",
    body: `Accounts, access, and getting started with ${BRAND_TITLE}.`,
    icon: Rocket,
  },
  {
    title: "Privacy & Security",
    body: "Data handling, compliance, and security questions.",
    icon: Shield,
  },
] as const;

type Props = {
  operatorId: string | null;
  firstName: string;
  canCreateTickets: boolean;
  pendingVerificationHref: string | null;
};

export async function StaffHomeDashboard({
  operatorId,
  firstName,
  canCreateTickets,
  pendingVerificationHref,
}: Props) {
  const ticketScope = operatorId ? { assignedAgentId: operatorId } : { id: "__none__" };

  const [tickets, activities] = await Promise.all([
    prisma.ticket.findMany({
      where: ticketScope,
      orderBy: { updatedAt: "desc" },
      take: 50,
      include: { assignedAgent: { select: { name: true, email: true } } },
    }),
    prisma.ticketActivity.findMany({
      where: { ticket: ticketScope },
      orderBy: { createdAt: "desc" },
      take: 5,
      include: { ticket: { select: { ticketNumber: true, title: true } } },
    }),
  ]);

  const assigneeColorByEmail =
    tickets.length > 0
      ? await loadStaffAssignmentColorsForAgents(
          tickets.map((t) => ({ email: t.assignedAgent?.email, name: t.assignedAgent?.name })),
        )
      : new Map<string, string | null>();

  const kanbanData: KanbanTicket[] = tickets.map((t) => {
    const assigneeEmail = t.assignedAgent?.email?.trim().toLowerCase();
    const assigneeColorKey = assigneeEmail ? (assigneeColorByEmail.get(assigneeEmail) ?? null) : null;
    return {
      id: t.id,
      ticketNumber: t.ticketNumber,
      title: t.title,
      status: t.status,
      priority: t.priority,
      updatedAt: t.updatedAt.toISOString(),
      authorLabel: t.assignedAgent?.name ? `by ${t.assignedAgent.name}` : "Support team",
      assigneeName: t.assignedAgent?.name ?? null,
      assigneeColorKey,
    };
  });

  return (
    <main className="px-3 py-5 text-zinc-900 sm:px-6 sm:py-6 md:py-8 dark:text-zinc-100">
      <div className="mx-auto max-w-6xl space-y-8">
        <section className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-zinc-900 sm:text-3xl md:text-4xl dark:text-zinc-100">
              Welcome back, {firstName}.
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!canCreateTickets && pendingVerificationHref ? (
              <Link
                href={pendingVerificationHref}
                className="inline-flex items-center justify-center rounded-xl border border-amber-500/60 bg-amber-500/15 px-4 py-2.5 text-sm font-semibold text-amber-950 transition hover:bg-amber-500/25 dark:text-amber-200"
              >
                View active Issue/Concern
              </Link>
            ) : null}
            <Link
              href="/tickets/new"
              className="inline-flex items-center justify-center rounded-xl bg-orange-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-orange-500"
            >
              + Create Request
            </Link>
          </div>
        </section>

        <section className="grid gap-5 md:gap-6 lg:grid-cols-[1fr,280px]">
          <div className="min-w-0 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">Active requests</h2>
              <Link
                href="/my-tickets"
                className="text-sm font-semibold text-orange-700 hover:underline dark:text-orange-300"
              >
                View all tickets
              </Link>
            </div>
            <TicketsKanbanBoard tickets={kanbanData} />
          </div>

          <div className="space-y-4 md:grid md:grid-cols-2 md:gap-4 md:space-y-0 lg:grid-cols-1">
            <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-[0_8px_24px_rgba(0,0,0,0.06)] dark:border-zinc-800 dark:bg-[#0b1220] dark:shadow-[0_10px_30px_rgba(0,0,0,0.25)]">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-600 dark:text-zinc-500">
                Current system status
              </p>
              <p className="mt-3 flex items-center gap-2 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                <span className="inline-block size-2.5 rounded-full bg-orange-600 dark:bg-orange-500" aria-hidden />
                All systems operational
              </p>
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-[0_8px_24px_rgba(0,0,0,0.06)] dark:border-zinc-800 dark:bg-[#0b1220] dark:shadow-[0_10px_30px_rgba(0,0,0,0.25)]">
              <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">Recent activity</h3>
              <ul className="mt-4 space-y-3 text-sm">
                {activities.length === 0 ? (
                  <li className="text-zinc-600 dark:text-zinc-500">No recent activity on your tickets.</li>
                ) : (
                  activities.map((a) => (
                    <li
                      key={a.id}
                      className="border-b border-zinc-200 pb-3 last:border-0 last:pb-0 dark:border-zinc-800"
                    >
                      <p className="font-medium text-zinc-900 dark:text-zinc-200">{a.ticket.ticketNumber}</p>
                      <p className="line-clamp-2 text-xs text-zinc-600 dark:text-zinc-400">{a.summary}</p>
                      <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-500">
                        {a.createdAt.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}
                      </p>
                    </li>
                  ))
                )}
              </ul>
            </div>
          </div>
        </section>

        <section>
          <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">Help categories</h2>
            </div>
            <Link
              href="/tickets/knowledge"
              className="text-sm font-semibold text-orange-700 hover:underline dark:text-orange-300"
            >
              Open knowledge base
            </Link>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {categories.map((c) => {
              const Icon = c.icon;
              return (
                <Link
                  key={c.title}
                  href="/tickets/knowledge"
                  className="flex h-full flex-col items-center rounded-2xl border border-zinc-200 bg-white p-5 text-center shadow-[0_6px_20px_rgba(0,0,0,0.06)] transition hover:border-orange-400/50 hover:bg-orange-50/50 dark:border-zinc-800 dark:bg-[#0b1220] dark:shadow-[0_8px_24px_rgba(0,0,0,0.2)] dark:hover:border-orange-400/40 dark:hover:bg-[#0f172a]"
                >
                  <span className="mb-3 flex size-12 items-center justify-center rounded-full bg-orange-500/20 text-orange-700 dark:text-orange-300">
                    <Icon className="size-6" />
                  </span>
                  <span className="text-sm font-bold text-zinc-900 dark:text-zinc-100">{c.title}</span>
                </Link>
              );
            })}
          </div>
        </section>

        <section className="rounded-2xl border border-orange-400/35 bg-orange-500/15 p-5 sm:p-6 dark:border-orange-400/30 dark:bg-orange-500/10">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-zinc-800 sm:max-w-2xl dark:text-zinc-200">
              <span className="font-semibold text-orange-900 dark:text-orange-200">{BRAND_TITLE} v4.0 is now live.</span>{" "}
              Discover new automated recovery protocols and an enhanced edge monitoring dashboard.
            </p>
            <Link
              href="/tickets/knowledge"
              className="inline-flex shrink-0 items-center justify-center rounded-xl bg-orange-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-orange-500"
            >
              Explore features
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}

