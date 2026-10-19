import Link from "next/link";
import { BarChart3, SlidersHorizontal } from "lucide-react";
import type { StaffDashboardHome } from "@/lib/dashboard-home";
import { BRAND_TITLE } from "@/lib/brand";
import {
  DashboardActionList,
  DashboardFilterPills,
  DashboardRecentActivity,
  DashboardSummaryCards,
  type SummaryCard,
} from "@/components/dashboard/DashboardHomeSections";

type Props = {
  data: StaffDashboardHome;
  role: string;
  nowLabel: string;
};

export function PersonalizedStaffDashboard({ data, nowLabel }: Props) {
  const { summary } = data;

  const projectsAtRiskCard: SummaryCard[] =
    summary.projectsAtRisk > 0
      ? [
          {
            id: "projects-at-risk",
            label: "Projects at risk",
            value: summary.projectsAtRisk,
            href: "/work/projects",
            tone: "danger",
          },
        ]
      : [];

  const summaryCards: SummaryCard[] = data.isPersonnelView
    ? [
        { id: "open", label: "Open", value: summary.open, href: "/agent?status=OPEN" },
        {
          id: "in-progress",
          label: "In progress",
          value: summary.inProgress,
          href: "/agent?status=IN_PROGRESS",
        },
        {
          id: "for-confirmation",
          label: "For confirmation",
          value: summary.forConfirmation,
          href: "/agent?status=FOR_CONFIRMATION",
        },
        {
          id: "delayed-tasks",
          label: "Delayed tasks",
          value: summary.tasksDelayed,
          href: "/work/tasks",
          tone: summary.tasksDelayed > 0 ? "warning" : "default",
        },
        ...projectsAtRiskCard,
      ]
    : [];

  const adminSummaryCards: SummaryCard[] = data.isAdminView
    ? [
        {
          id: "needs-action",
          label: "Needs your action",
          value: data.needsAction.length,
          href: "#needs-action",
          tone: data.needsAction.length > 0 ? "warning" : "default",
        },
        {
          id: "open-unassigned",
          label: "Open / Unassigned",
          value: `${summary.open} / ${summary.unassigned}`,
          href: "/agent?status=OPEN",
          tone: summary.unassigned > 0 ? "warning" : "default",
        },
        {
          id: "pending-approvals",
          label: "Pending approvals",
          value: summary.pendingApprovals,
          href: "/agent",
          tone: summary.pendingApprovals > 0 ? "warning" : "default",
        },
        {
          id: "tasks-due",
          label: "Tasks due",
          value: summary.tasksCurrent,
          href: "/work/tasks",
          tone: summary.tasksDelayed > 0 ? "warning" : "default",
        },
        ...projectsAtRiskCard,
      ]
    : [];

  const filterPills = [
    { id: "today", label: "Today", href: "/agent?sort=updatedAt&dir=desc" },
    { id: "week", label: "This week", href: "/agent?sort=updatedAt&dir=desc" },
    { id: "high", label: "High priority", href: "/agent?priority=HIGH" },
    { id: "urgent", label: "Urgent", href: "/agent?priority=URGENT" },
    { id: "unassigned", label: "Unassigned", href: "/agent?assigned=UNASSIGNED" },
  ];

  const dashboardTitle = data.isPersonnelView ? "What do I need to do right now?" : "Operational dashboard";

  return (
    <main className="min-h-full bg-zinc-50 px-3 py-3 text-zinc-900 sm:px-5 sm:py-4 dark:bg-zinc-950 dark:text-zinc-100">
      <div className="mx-auto w-full max-w-7xl space-y-4 sm:space-y-5">
        <header className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-orange-700 sm:text-[11px] dark:text-orange-400/95">
            {BRAND_TITLE}
          </p>
          <h1 className="mt-1 text-xl font-bold tracking-tight text-zinc-900 sm:text-2xl dark:text-white">
            {dashboardTitle}
          </h1>
          <p className="mt-1 text-xs leading-relaxed text-zinc-600 sm:text-sm dark:text-zinc-400">
            <span className="font-medium text-zinc-800 dark:text-zinc-200">Welcome back, {data.greeting}.</span>{" "}
            <span className="text-zinc-500 dark:text-zinc-400">
              {nowLabel} · {data.scopeLabel}
            </span>
          </p>
        </header>

        {data.isPersonnelView ? <DashboardSummaryCards cards={summaryCards} /> : null}
        {adminSummaryCards.length > 0 ? <DashboardSummaryCards cards={adminSummaryCards} /> : null}

        <div className="space-y-3">
          <DashboardFilterPills pills={filterPills} />
          {data.isAdminView ? (
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:gap-2">
              <Link
                href="/insights"
                className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-xl border border-zinc-300 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 transition hover:border-orange-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 sm:rounded-full sm:py-1.5"
              >
                <BarChart3 className="size-3.5 shrink-0" aria-hidden />
                <span className="truncate">KPI / Insights</span>
              </Link>
              <Link
                href="/process"
                className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-xl border border-zinc-300 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 transition hover:border-orange-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 sm:rounded-full sm:py-1.5"
              >
                <SlidersHorizontal className="size-3.5 shrink-0" aria-hidden />
                <span className="truncate">Process Controls</span>
              </Link>
            </div>
          ) : null}
        </div>

        {data.isPersonnelView ? (
          <section className="grid items-start gap-4 sm:gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
            <div className="min-w-0 space-y-4 self-start sm:space-y-5">
              <DashboardActionList
                title="Assigned to me"
                emptyMessage="No active assignments."
                items={data.assignedPreview}
                viewAllHref="/agent"
              />
              <DashboardRecentActivity items={data.recentActivity} />
            </div>
            <div className="space-y-4 sm:space-y-5">
              <DashboardActionList
                id="needs-action"
                title="Needs your action"
                emptyMessage="You're caught up — nothing is waiting on you right now."
                items={data.needsAction}
                viewAllHref="/agent"
              />
              <DashboardActionList
                title="Tasks assigned to me"
                emptyMessage="No tasks assigned to you yet."
                items={data.overdueItems}
                viewAllHref="/work/tasks"
              />
            </div>
          </section>
        ) : (
          <section className="grid items-start gap-4 sm:gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
            <DashboardActionList
              id="needs-action"
              title="Needs your action"
              emptyMessage="No urgent items in your scope right now."
              items={data.needsAction}
              viewAllHref="/agent"
            />
            <div className="min-w-0">
              <DashboardRecentActivity items={data.recentActivity} />
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
