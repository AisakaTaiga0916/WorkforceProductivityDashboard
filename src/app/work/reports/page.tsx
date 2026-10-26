import Link from "next/link";
import { redirect } from "next/navigation";
import type { Session } from "next-auth";
import { requireSession } from "@/lib/access";
import { cn } from "@/lib/cn";
import { isElevatedPlatformRole } from "@/lib/staff-role";
import { formatDurationHours, percent } from "@/modules/reports/report-range";
import { reportQuery } from "@/modules/reports/report-scope";
import {
  WORK_REPORT_LENS_META,
  resolveWorkReportContext,
  type WorkReportContext,
} from "@/modules/reports/work-report-context";
import {
  loadProjectWorkReport,
  loadTaskWorkReport,
  loadWorkPlanWorkReport,
  type ProjectWorkReport,
  type TaskWorkReport,
  type WorkPlanWorkReport,
} from "@/modules/reports/work-reports";
import { ReportFilterBar, type ReportFilterSelect } from "@/components/reports/ReportFilterBar";
import {
  ReportAllCompaniesNotice,
  ReportBarList,
  ReportCard,
  ReportStatGrid,
  ReportTable,
} from "@/components/reports/ReportPrimitives";
import { TaskKpiPerformance } from "@/components/reports/TaskKpiPerformance";

export const dynamic = "force-dynamic";

function firstQuery(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

/** KPI period reporting stays an admin view (as on the former Metrics & Reports page). */
function isAdminRole(role: string): boolean {
  return isElevatedPlatformRole(role) || role === "Admin";
}

type Params = {
  lens?: string | string[];
  range?: string | string[];
  from?: string | string[];
  to?: string | string[];
  team?: string | string[];
  assignee?: string | string[];
};

export default async function WorkReportsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const session = await requireSession();
  if (!session?.user) redirect("/signin?callbackUrl=/work/reports");

  const params = await searchParams;
  const ctx = await resolveWorkReportContext(session, {
    lens: firstQuery(params.lens),
    range: firstQuery(params.range),
    from: firstQuery(params.from),
    to: firstQuery(params.to),
    team: firstQuery(params.team),
    assignee: firstQuery(params.assignee),
  });
  if (!ctx.viewer.canRead || !ctx.lens) {
    return (
      <p className="rounded-xl border border-dashed border-zinc-300 px-4 py-6 text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
        You don&apos;t have access to any Work reports.
      </p>
    );
  }

  const { viewer, range, lens } = ctx;
  const input = { session, ...ctx };
  const tasks = lens === "tasks" ? await loadTaskWorkReport(input) : null;
  const projects = lens === "projects" ? await loadProjectWorkReport(input) : null;
  const plans = lens === "work-plans" ? await loadWorkPlanWorkReport(input) : null;

  // Switching lenses keeps the period + team; only the lens (and lens-only filters) change.
  const sharedQuery = {
    range: range.preset,
    from: range.preset === "custom" ? range.fromYmd : null,
    to: range.preset === "custom" ? range.toYmd : null,
    team: ctx.teamId,
  };

  const filters: ReportFilterSelect[] = [
    { name: "team", label: "Team", value: ctx.teamId ?? "ALL", allLabel: "All teams", options: ctx.teams },
  ];
  if (tasks && !viewer.allCompanies) {
    filters.push({
      name: "assignee",
      label: "Assignee",
      value: tasks.assigneeValue,
      allLabel: "Everyone",
      options: tasks.assigneeOptions,
    });
  }

  return (
    <section className="min-w-0 space-y-4">
      <nav aria-label="Report lenses" className="flex flex-wrap gap-1.5">
        {ctx.lenses.map((id) => (
          <Link
            key={id}
            href={`/work/reports${reportQuery({ lens: id, ...sharedQuery })}`}
            aria-current={id === lens ? "page" : undefined}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-semibold",
              id === lens
                ? "border-orange-500 bg-orange-500/15 text-orange-800 dark:text-orange-200"
                : "border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800",
            )}
          >
            {WORK_REPORT_LENS_META[id].label}
          </Link>
        ))}
      </nav>

      <ReportFilterBar
        basePath="/work/reports"
        preset={range.preset}
        fromYmd={range.fromYmd}
        toYmd={range.toYmd}
        companyLabel={viewer.companyLabel}
        companyHint="switch in the sidebar"
        filters={filters}
        keep={{ lens }}
        exportPath={viewer.canExport ? "/api/reports/work/export" : null}
      />
      <ReportAllCompaniesNotice show={viewer.allCompanies} />

      {tasks ? <TasksLens session={session} ctx={ctx} r={tasks} /> : null}
      {projects ? <ProjectsLens r={projects} detailed={!viewer.allCompanies} /> : null}
      {plans ? <WorkPlansLens r={plans} /> : null}
    </section>
  );
}

function TasksLens({ session, ctx, r }: { session: Session; ctx: WorkReportContext; r: TaskWorkReport }) {
  const onTime = percent(r.onTimeCompleted, r.onTimeBasis);
  const detailed = !ctx.viewer.allCompanies;
  return (
    <>
      <ReportStatGrid
        stats={[
          { id: "current", label: "Current", value: r.board.current, href: "/work/tasks", hint: "On the board now" },
          {
            id: "delayed",
            label: "Delayed",
            value: r.board.delayed,
            href: "/work/tasks",
            tone: r.board.delayed > 0 ? "danger" : "default",
            hint: "On the board now",
          },
          { id: "done", label: "Done", value: r.board.done, href: "/work/tasks", hint: "On the board now" },
          {
            id: "due",
            label: "Completed vs due",
            value: `${r.completedOfDue} / ${r.dueInRange}`,
            hint: "One-off targets in range",
          },
          {
            id: "on-time",
            label: "On-time",
            value: onTime != null ? `${onTime}%` : "—",
            hint: `${r.onTimeBasis} one-off completions`,
            tone: onTime != null && onTime < 80 ? "warning" : "good",
          },
          { id: "completed", label: "Completed", value: r.completedInRange, hint: "Full completions in range" },
        ]}
      />
      <div className={cn("grid gap-4", detailed && "lg:grid-cols-2")}>
        {detailed ? (
          <ReportCard title="Load by assignee" subtitle="Open (current + delayed) and delayed cards on the board">
            <ReportTable
              head={["Assignee", "Open", "Delayed", "Done"]}
              rows={r.byAssignee.slice(0, 20).map((a) => ({
                key: a.agentId ?? "unassigned",
                cells: [a.name, a.open, a.delayed, a.done],
              }))}
              emptyMessage="No tasks in scope."
            />
          </ReportCard>
        ) : null}
        <div className="grid gap-4">
          <ReportCard title="Overdue aging" subtitle="Delayed one-off tasks by days past target">
            <ReportBarList
              rows={[
                ...r.overdueAging.map((a) => ({ key: a.label, label: a.label, value: a.count })),
                { key: "recurring", label: "Recurring (cycle missed)", value: r.recurringDelayed },
              ]}
              barClassName="bg-rose-500/70"
              emptyMessage="Nothing delayed."
            />
          </ReportCard>
          {detailed ? (
            <ReportCard title="Most delayed">
              <ReportTable
                head={["Task", "Assignee", "Target", "Days late"]}
                rows={r.delayedTasks.map((t) => ({
                  key: t.id,
                  cells: [
                    <Link key="l" href={`/work/tasks?task=${encodeURIComponent(t.id)}`} className="hover:underline">
                      {t.title}
                    </Link>,
                    t.assignee,
                    t.targetYmd ?? "Recurring",
                    t.daysLate ?? "—",
                  ],
                }))}
                emptyMessage="Nothing delayed."
              />
            </ReportCard>
          ) : null}
        </div>
      </div>
      <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
        Board lanes and delays are due on working days (company schedule). Target dates in range are
        calendar days.
        {r.legacyProjectRowsExcluded > 0
          ? ` ${r.legacyProjectRowsExcluded} legacy project card(s) on the task board are excluded — they are reported under Projects after the cutover.`
          : ""}
      </p>
      {detailed && isAdminRole(session.user.role) ? (
        <ReportCard
          title="KPI performance"
          subtitle="Task KPI periods (monthly / yearly) by pillar, employee efficiency, and team"
        >
          <TaskKpiPerformance
            companyId={ctx.viewer.companyFilterId}
            companyName={ctx.viewer.companyName}
            teamId={ctx.teamId}
            teamName={ctx.teams.find((t) => t.value === ctx.teamId)?.label ?? null}
            canExtendView
            canManageDepartmentVisibility={session.user.role === "SuperAdmin"}
            canImportDepartmentTasks
          />
        </ReportCard>
      ) : null}
    </>
  );
}

function ProjectsLens({ r, detailed }: { r: ProjectWorkReport; detailed: boolean }) {
  return (
    <>
      <ReportStatGrid
        stats={[
          { id: "open", label: "Open", value: r.open, href: "/work/projects", hint: `${r.total} total` },
          {
            id: "risk",
            label: "At risk",
            value: r.atRisk,
            href: "/work/projects",
            tone: r.atRisk > 0 ? "danger" : "default",
            hint: "Late target, phase, or item",
          },
          {
            id: "phases",
            label: "Delayed phases",
            value: r.delayedPhases.length,
            tone: r.delayedPhases.length > 0 ? "warning" : "default",
          },
          { id: "created", label: "Created", value: r.createdInRange, hint: "In range" },
          { id: "completed", label: "Completed", value: r.completedInRange, hint: "Moved to Done in range", tone: "good" },
        ]}
      />
      <div className={cn("grid gap-4", detailed && "lg:grid-cols-2")}>
        <ReportCard title="By status" subtitle="All projects in scope">
          <ReportBarList
            rows={r.byStatus.map((s) => ({ key: s.status, label: s.label, value: s.count }))}
            emptyMessage="No projects in scope."
          />
        </ReportCard>
        {detailed ? (
          <ReportCard title="At-risk projects">
            <ReportTable
              head={["Project", "Status", "Target", "Lead"]}
              rows={r.atRiskProjects.map((p) => ({
                key: p.id,
                cells: [
                  <Link key="l" href="/work/projects" className="hover:underline">
                    {p.title}
                  </Link>,
                  p.status.replace("_", " "),
                  p.dueDate ?? "—",
                  p.lead ?? "—",
                ],
              }))}
              emptyMessage="No projects at risk."
            />
          </ReportCard>
        ) : null}
      </div>
      {detailed ? (
        <ReportCard title="Delayed phases" subtitle="Past target date with open items">
          <ReportTable
            head={["Project", "Phase", "Target", "Days late"]}
            rows={r.delayedPhases.map((p) => ({
              key: `${p.projectId}-${p.phaseName}`,
              cells: [p.projectTitle, p.phaseName, p.dueDate, p.daysLate],
            }))}
            emptyMessage="No delayed phases."
          />
        </ReportCard>
      ) : null}
    </>
  );
}

function WorkPlansLens({ r }: { r: WorkPlanWorkReport }) {
  const approved = r.outcomes
    .filter((o) => o.status === "APPROVED" || o.status === "CONFIRMED")
    .reduce((sum, o) => sum + o.count, 0);
  return (
    <>
      <ReportStatGrid
        stats={[
          { id: "submitted", label: "Submitted", value: r.submittedInRange, hint: "In range" },
          {
            id: "approved",
            label: "Approved",
            value: approved,
            hint: `${percent(approved, r.submittedInRange) ?? 0}% of submitted`,
            tone: "good",
          },
          {
            id: "pending",
            label: "Pending now",
            value: r.pendingNow,
            href: "/work/work-plans",
            tone: r.pendingNow > 0 ? "warning" : "default",
          },
          {
            id: "cycle",
            label: "Median cycle",
            value: formatDurationHours(r.medianCycleHours),
            hint: `Submit → final approval (${r.cycleBasis})`,
          },
        ]}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <ReportCard title="Outcome of plans submitted in range">
          <ReportBarList
            rows={r.outcomes.map((o) => ({ key: o.status, label: o.label, value: o.count }))}
            emptyMessage="No work plans submitted in this range."
          />
        </ReportCard>
        <ReportCard title="Pending by approval level" subtitle="Plans waiting now (any submit date)">
          <ReportBarList
            rows={r.pendingByLevel.map((p) => ({ key: p.label, label: p.label, value: p.count }))}
            barClassName="bg-amber-500/70"
            emptyMessage="Nothing waiting for approval."
          />
        </ReportCard>
      </div>
    </>
  );
}
