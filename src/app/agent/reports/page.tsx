import { redirect } from "next/navigation";
import { OrchestrationQueueNav } from "@/components/OrchestrationQueueNav";
import { requireSession } from "@/lib/access";
import { BRAND_TITLE } from "@/lib/brand";
import { ModuleDisabledNotice } from "@/components/ModuleDisabledNotice";
import { isSystemModuleEnabled } from "@/modules/platform/settings/system-modules-db";
import { hasPermission, permissionSubjectFromSession } from "@/modules/platform/rbac/permissions";
import { formatDurationHours, percent } from "@/modules/reports/report-range";
import { loadRequestReport } from "@/modules/requests/request-reports";
import {
  REQUEST_REPORT_STATUS_OPTIONS,
  REQUEST_REPORT_TYPE_OPTIONS,
  resolveRequestReportContext,
} from "@/modules/requests/request-report-scope";
import { ReportFilterBar } from "@/components/reports/ReportFilterBar";
import {
  ReportAllCompaniesNotice,
  ReportBarList,
  ReportCard,
  ReportStatGrid,
  ReportTable,
  ReportTrendBars,
  ReportTruncatedNotice,
  type ReportStat,
} from "@/components/reports/ReportPrimitives";

export const dynamic = "force-dynamic";

function firstQuery(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

/** 0–1 share → "92.5%", em dash when unknown. */
function share(value: number | null): string {
  return value == null ? "—" : `${Math.round(value * 1000) / 10}%`;
}

type Params = {
  range?: string | string[];
  from?: string | string[];
  to?: string | string[];
  team?: string | string[];
  type?: string | string[];
  status?: string | string[];
};

export default async function RequestReportsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const session = await requireSession();
  if (!session?.user) redirect("/signin?callbackUrl=/agent/reports");
  if (!["SuperAdmin", "HighAdmin", "Admin", "Personnel"].includes(session.user.role)) redirect("/");
  if (!(await isSystemModuleEnabled("requests"))) return <ModuleDisabledNotice module="requests" />;

  const params = await searchParams;
  const ctx = await resolveRequestReportContext(session, {
    range: firstQuery(params.range),
    from: firstQuery(params.from),
    to: firstQuery(params.to),
    team: firstQuery(params.team),
    type: firstQuery(params.type),
    status: firstQuery(params.status),
  });
  const canReadRequests = await hasPermission(permissionSubjectFromSession(session), "requests.read");
  if (!ctx.viewer.canRead || !canReadRequests) redirect("/agent");

  const { viewer, range } = ctx;
  const report = await loadRequestReport({ where: ctx.where, range });
  const { totals, sla, quality } = report;

  const resolveRate = percent(totals.resolved, totals.created);
  const slaTone = (value: number | null): ReportStat["tone"] =>
    value == null ? "default" : value >= 0.95 ? "good" : value >= 0.8 ? "warning" : "danger";

  return (
    <main className="flex min-h-[calc(100vh-56px)] flex-col bg-zinc-50 px-3 py-4 text-zinc-900 dark:bg-background dark:text-zinc-100 sm:px-4">
      <div className="mx-auto w-full max-w-[96rem] space-y-4">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-orange-700 dark:text-orange-400/95">
            {BRAND_TITLE} · Requests
          </p>
          <h1 className="mt-1 text-xl font-bold tracking-tight sm:text-2xl">Request Reports</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Volume, throughput, SLA, and quality for requests in your Request Board scope.
          </p>
        </div>
        <OrchestrationQueueNav />

        <ReportFilterBar
          basePath="/agent/reports"
          preset={range.preset}
          fromYmd={range.fromYmd}
          toYmd={range.toYmd}
          companyLabel={viewer.companyLabel}
          companyHint="switch in the sidebar"
          filters={[
            { name: "team", label: "Team", value: ctx.teamId ?? "ALL", allLabel: "All teams", options: ctx.teams },
            {
              name: "type",
              label: "Type",
              value: ctx.typeValue,
              allLabel: "All types",
              options: REQUEST_REPORT_TYPE_OPTIONS,
            },
            {
              name: "status",
              label: "Status",
              value: ctx.statusValue,
              allLabel: "Any status",
              options: REQUEST_REPORT_STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
            },
          ]}
          exportPath={viewer.canExport ? "/api/reports/requests/export" : null}
        />
        <ReportAllCompaniesNotice show={viewer.allCompanies} />
        <ReportTruncatedNotice show={report.truncated} />

        <ReportStatGrid
          stats={[
            { id: "created", label: "Created", value: totals.created, hint: "In range" },
            {
              id: "resolved",
              label: "Resolved",
              value: totals.resolved,
              hint: resolveRate != null ? `${resolveRate}% of created` : "In range",
              tone: "good",
            },
            { id: "closed", label: "Closed", value: totals.closed, hint: "Confirmed in range" },
            { id: "open", label: "Open now", value: totals.openNow, href: "/agent", hint: "Active pipeline" },
            {
              id: "overdue",
              label: "Overdue now",
              value: totals.overdueNow,
              href: "/agent",
              hint: `${totals.atRiskNow} approaching`,
              tone: totals.overdueNow > 0 ? "danger" : "default",
            },
            {
              id: "first-response",
              label: "Median 1st response",
              value: formatDurationHours(totals.medianFirstResponseHours),
              hint: "Created in range",
            },
            {
              id: "resolution",
              label: "Median resolution",
              value: formatDurationHours(totals.medianResolutionHours),
              hint: "Resolved in range",
            },
            {
              id: "confirmation",
              label: "Median confirmation",
              value: formatDurationHours(totals.medianConfirmationHours),
              hint: "Resolved → closed",
            },
            {
              id: "sla-first",
              label: "1st response SLA",
              value: share(sla.firstResponseMetRate),
              hint: "Met due time · target 95%",
              tone: slaTone(sla.firstResponseMetRate),
            },
            {
              id: "sla-resolution",
              label: "Resolution SLA",
              value: share(sla.resolutionMetRate),
              hint: "Met due time · target 95%",
              tone: slaTone(sla.resolutionMetRate),
            },
            {
              id: "transfer",
              label: "Transfer requests",
              value: share(sla.transferRequestRate),
              hint: "Of created",
            },
            { id: "reopen", label: "Reopened", value: share(sla.reopenRate), hint: "Of created" },
          ]}
        />

        <ReportCard
          title="Throughput"
          subtitle={range.days > 62 ? "Created vs resolved per week" : "Created vs resolved per day"}
        >
          <ReportTrendBars
            rows={report.trend.map((t) => ({ key: t.key, label: t.label, values: [t.created, t.resolved] }))}
            series={[
              { label: "Created", className: "bg-orange-500/80" },
              { label: "Resolved", className: "bg-emerald-500/80" },
            ]}
          />
        </ReportCard>

        <div className="grid gap-4 lg:grid-cols-2">
          <ReportCard title="Volume by type" subtitle="Created / resolved in range · open and overdue now">
            <ReportTable
              head={["Type", "Created", "Resolved", "Open now", "Overdue", "Median resolution"]}
              rows={report.byType.map((t) => ({
                key: t.type,
                cells: [
                  t.label,
                  t.created,
                  t.resolved,
                  t.openNow,
                  t.overdueNow,
                  formatDurationHours(t.medianResolutionHours),
                ],
              }))}
            />
          </ReportCard>
          <div className="grid gap-4">
            <ReportCard title="Open by status" subtitle="Current pipeline (not range-bound)">
              <ReportBarList
                rows={report.openByStatus.map((s) => ({ key: s.status, label: s.label, value: s.count }))}
                emptyMessage="No open requests."
              />
            </ReportCard>
            <ReportCard title="Aging" subtitle="Open requests by age since created">
              <ReportBarList
                rows={report.aging.map((a) => ({ key: a.label, label: a.label, value: a.count }))}
                barClassName="bg-amber-500/70"
                emptyMessage="No open requests."
              />
            </ReportCard>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <ReportCard
            title="Customer satisfaction"
            subtitle={`${quality.feedbackCount} feedback response${quality.feedbackCount === 1 ? "" : "s"} in range${
              quality.csatAvg != null ? ` · avg ${Math.round(quality.csatAvg * 10) / 10} / 5` : ""
            }`}
          >
            <ReportBarList
              rows={[...quality.csatByStar].reverse().map((row) => ({
                key: String(row.star),
                label: row.label,
                value: row.count,
              }))}
              barClassName="bg-emerald-500/70"
              emptyMessage="No feedback in this range."
            />
          </ReportCard>
          {viewer.allCompanies ? null : (
            <ReportCard title="Closed by assignee" subtitle="Requests closed in range">
              <ReportTable
                head={["Assignee", "Closed"]}
                rows={report.closedByAssignee.map((row) => ({
                  key: row.agentId,
                  cells: [row.name, row.closed],
                }))}
                emptyMessage="Nothing closed in this range."
              />
            </ReportCard>
          )}
        </div>

        <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
          Dates are calendar days ({range.timeZone}). Overdue uses the Request Board 24h rule per request
          type. Team filters by the request&apos;s assignee; Status filters by current status.
        </p>
      </div>
    </main>
  );
}
