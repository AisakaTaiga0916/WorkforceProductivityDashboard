import Link from "next/link";
import { Code, CreditCard, Rocket, Shield } from "lucide-react";
import { prisma } from "@/modules/platform/db/prisma";
import { loadStaffAssignmentColorsForAgents } from "@/lib/assignee-assignment-color";
import { customerTicketWhereBySessionEmail } from "@/modules/requests/customer-pending-resolution";
import { BRAND_TITLE } from "@/lib/brand";
import { summarizeCustomerTicketStatuses } from "@/lib/dashboard-home";
import {
  DashboardQuickCreate,
  DashboardRecentActivity,
  DashboardSummaryCards,
  type SummaryCard,
} from "@/components/dashboard/DashboardHomeSections";
import { TicketsKanbanBoard, type KanbanTicket } from "./TicketsKanbanBoard";

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
  email: string;
  firstName: string;
  canCreateTickets: boolean;
  pendingVerificationHref: string | null;
};

export async function CustomerHomeDashboard({
  email,
  firstName,
  canCreateTickets,
  pendingVerificationHref,
}: Props) {
  const ticketScope = customerTicketWhereBySessionEmail(email);
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
      include: { ticket: { select: { id: true, ticketNumber: true, title: true } } },
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

  const statusSummary = summarizeCustomerTicketStatuses(tickets.map((ticket) => ticket.status));
  const summaryCards: SummaryCard[] = [
    { id: "open", label: "Open", value: statusSummary.open, href: "/my-tickets" },
    {
      id: "in-progress",
      label: "In progress",
      value: statusSummary.inProgress,
      href: "/my-tickets",
    },
    {
      id: "for-confirmation",
      label: "For confirmation",
      value: statusSummary.forConfirmation,
      href: "/my-tickets",
    },
    { id: "closed", label: "Closed", value: statusSummary.closed, href: "/my-tickets" },
  ];

  const createActions = [
    {
      id: "issue",
      label: "Create Issue/Concern",
      href: "/tickets/new?type=ISSUE_CONCERN_TICKET",
      subtitle: "Report a problem or concern",
    },
    {
      id: "rfp",
      label: "Create Request for Payment",
      href: "/tickets/new?type=REQUEST_FOR_PAYMENT",
      subtitle: "Submit an R.F.P.",
    },
    {
      id: "my-tickets",
      label: "View my requests",
      href: "/my-tickets",
      subtitle: "Track everything you've submitted",
    },
  ];

  const recentActivity = activities.map((activity) => ({
    id: activity.id,
    ticketNumber: activity.ticket.ticketNumber,
    title: activity.ticket.title,
    summary: activity.summary,
    createdAt: activity.createdAt.toISOString(),
    href: `/tickets/${activity.ticket.id}`,
  }));

  return (
    <main className="px-3 py-4 text-zinc-900 dark:text-zinc-100 sm:px-4 lg:px-4">
      <div className="mx-auto max-w-[1440px] space-y-5">
        <section className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-orange-700 dark:text-orange-400">
              {BRAND_TITLE} · Customer portal
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-zinc-950 dark:text-zinc-100 md:text-3xl">
              What do you need right now?
            </h1>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              Welcome back, {firstName}. Track open requests and start new ones from here.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canCreateTickets ? null : (
              <Link
                href={pendingVerificationHref ?? "/my-tickets"}
                className="inline-flex items-center justify-center rounded-lg border border-amber-500/40 bg-amber-500/15 px-4 py-2.5 text-sm font-semibold text-amber-100 transition hover:bg-amber-500/25"
              >
                {pendingVerificationHref?.includes("/verification")
                  ? "Confirm or close Issue/Concern"
                  : "View active Issue/Concern"}
              </Link>
            )}
            <Link
              href="/tickets/new"
              className="inline-flex items-center justify-center rounded-lg bg-orange-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-orange-500"
            >
              + Create Request
            </Link>
          </div>
        </section>

        <DashboardSummaryCards cards={summaryCards} />

        <DashboardQuickCreate actions={createActions} />

        <section className="grid gap-4 lg:grid-cols-[1fr,260px]">
          <div className="min-w-0 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lg font-bold text-zinc-950 dark:text-zinc-100">Active requests</h2>
              <Link href="/my-tickets" className="text-sm font-semibold text-orange-300 hover:underline">
                View all tickets
              </Link>
            </div>
            <TicketsKanbanBoard tickets={kanbanData} />
          </div>

          <div className="space-y-3 md:grid md:grid-cols-2 md:gap-3 md:space-y-0 lg:grid-cols-1">
            <div className="rounded-md border border-zinc-200 bg-white p-4 shadow-[0_14px_28px_rgba(0,0,0,0.06)] dark:border-zinc-700/80 dark:bg-[#10100f] dark:shadow-[0_14px_28px_rgba(0,0,0,0.24)]">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">
                Current system status
              </p>
              <p className="mt-3 flex items-center gap-2 text-lg font-semibold text-zinc-950 dark:text-zinc-100">
                <span className="inline-block size-2.5 rounded-full bg-emerald-500" aria-hidden />
                All systems operational
              </p>
            </div>

            <DashboardRecentActivity items={recentActivity} />
          </div>
        </section>

        <section>
          <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="text-lg font-bold text-zinc-950 dark:text-zinc-100">Help categories</h2>
            </div>
            <Link href="/tickets/knowledge" className="text-sm font-semibold text-orange-300 hover:underline">
              Open knowledge base
            </Link>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {categories.map((c) => {
              const Icon = c.icon;
              return (
                <Link
                  key={c.title}
                  href="/tickets/knowledge"
                  className="flex h-full flex-col items-center rounded-md border border-zinc-200 bg-white p-4 text-center shadow-[0_14px_28px_rgba(0,0,0,0.06)] transition hover:border-orange-500/45 hover:bg-orange-50/40 dark:border-zinc-700/80 dark:bg-[#10100f] dark:shadow-[0_14px_28px_rgba(0,0,0,0.24)] dark:hover:bg-[#181716]"
                >
                  <span className="mb-3 flex size-12 items-center justify-center rounded-lg bg-orange-500/12 text-orange-300">
                    <Icon className="size-6" />
                  </span>
                  <span className="text-sm font-bold text-zinc-950 dark:text-zinc-100">{c.title}</span>
                </Link>
              );
            })}
          </div>
        </section>

        <section className="rounded-md border border-orange-500/30 bg-orange-500/10 p-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-zinc-700 dark:text-zinc-200 sm:max-w-2xl">
              <span className="font-semibold text-orange-800 dark:text-orange-200">{BRAND_TITLE} v4.0 is now live.</span>{" "}
              Discover new automated recovery protocols and an enhanced edge monitoring dashboard.
            </p>
            <Link
              href="/tickets/knowledge"
              className="inline-flex shrink-0 items-center justify-center rounded-lg bg-orange-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-orange-500"
            >
              Explore features
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
