"use client";

/**
 * Work → Reports → Tasks: KPI period performance (pillar donuts, employee efficiency,
 * team grid). Company / team come from the shared report filter bar; cadence + period
 * are KPI-specific (monthly / yearly periods, not the report date range).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { DatePickerField } from "@/components/ui/DatePickerField";
import { cn } from "@/lib/cn";
import { TaskPillarMetricsGrid } from "@/components/metrics/TaskPillarMetricsGrid";
import { PersonnelTaskMetricsGrid } from "@/components/metrics/PersonnelTaskMetricsGrid";
import { DepartmentTaskMetricsGrid } from "@/components/metrics/DepartmentTaskMetricsGrid";
import { DEFAULT_TIME_ZONE } from "@/modules/tasks/kpi-recurrence";
import {
  buildPersonnelInsightCards,
  type MergedPersonnelEfficiencyRow,
  type PersonnelDelayPenaltyRow,
} from "@/modules/tasks/task-personnel-metrics";
import {
  mergedSourceUserIdsForOrgChartSectionTree,
  type OrgChartSectionOption,
} from "@/modules/hierarchy/org-chart-section-display";
import type {
  PersonnelTicketMetric,
  TaskChecklistPillarMetrics,
  TaskMetricsHelpdeskTickets,
  TaskMetricsUserSupportTickets,
} from "@/modules/tasks/kpis";
import type { DepartmentMainMetric } from "@/modules/tasks/department-task-metrics";
import {
  defaultTaskMetricsRangeForCadence,
  formatTaskMetricsPeriodLabel,
  resolveTaskMetricsQueryRange,
  taskMetricsMergedPeriod,
  type TaskMetricsCadence,
} from "@/modules/tasks/task-metrics-range";
import {
  FIELD_ASSIGNMENT_DONUT_KEY,
  TASK_FREQUENCY_DONUT_KEYS,
  TASK_METRICS_TASK_TYPE_OPTIONS,
  type TaskMetricsTaskType,
  type TaskMetricsTaskTypeFilter,
} from "@/modules/tasks/task-metrics-task-type";

type ViewMode = "company" | "personnel" | "departments";

/** Projects are reported under Work → Reports → Projects, not as a task KPI pillar. */
const KPI_TASK_TYPES = TASK_METRICS_TASK_TYPE_OPTIONS.filter((o) => o.value !== "project");

function pillarOrderFor(taskType: TaskMetricsTaskType): string[] | null {
  if (taskType === "task") return [...TASK_FREQUENCY_DONUT_KEYS];
  if (taskType === "field") return [FIELD_ASSIGNMENT_DONUT_KEY];
  return null;
}

type TaskMetricsPayload = {
  taskMetricsHelpdesk: TaskMetricsHelpdeskTickets | null;
  taskMetricsUserSupport: TaskMetricsUserSupportTickets | null;
  taskChecklistPillars: TaskChecklistPillarMetrics | null;
  personnelTicketMetrics: PersonnelTicketMetric[];
  personnelRfpAccountingMetrics: PersonnelTicketMetric[];
  personnelRfpFinanceMetrics: PersonnelTicketMetric[];
  personnelIrsCanvassMetrics: PersonnelTicketMetric[];
  personnelFtrPreparedMetrics: PersonnelTicketMetric[];
  personnelDelayPenalties: PersonnelDelayPenaltyRow[];
};

const EMPTY_PAYLOAD: TaskMetricsPayload = {
  taskMetricsHelpdesk: null,
  taskMetricsUserSupport: null,
  taskChecklistPillars: null,
  personnelTicketMetrics: [],
  personnelRfpAccountingMetrics: [],
  personnelRfpFinanceMetrics: [],
  personnelIrsCanvassMetrics: [],
  personnelFtrPreparedMetrics: [],
  personnelDelayPenalties: [],
};

const CONTROL_LABEL = "flex flex-col gap-1 text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500";
const SELECT_CLASS =
  "h-9 rounded-lg border border-zinc-300 bg-white px-2.5 text-sm text-zinc-900 outline-none focus:border-orange-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100";

export function TaskKpiPerformance({
  companyId,
  companyName,
  teamId,
  teamName,
  canExtendView,
  canManageDepartmentVisibility,
  canImportDepartmentTasks,
}: {
  /** Company filter (null = all companies, global viewers only). */
  companyId: string | null;
  companyName: string | null;
  /** Shared Team filter (org-chart section) — scopes the Employees view. */
  teamId: string | null;
  teamName: string | null;
  canExtendView: boolean;
  canManageDepartmentVisibility: boolean;
  canImportDepartmentTasks: boolean;
}) {
  const timeZone = DEFAULT_TIME_ZONE;
  const [view, setView] = useState<ViewMode>("company");
  const [taskType, setTaskType] = useState<TaskMetricsTaskTypeFilter>("ALL");
  const [cadence, setCadence] = useState<TaskMetricsCadence>("MONTHLY");
  const [period, setPeriod] = useState(() => defaultTaskMetricsRangeForCadence("MONTHLY").from);
  const [search, setSearch] = useState("");

  const [payload, setPayload] = useState<TaskMetricsPayload>(EMPTY_PAYLOAD);
  const [departments, setDepartments] = useState<DepartmentMainMetric[]>([]);
  const [mergedRows, setMergedRows] = useState<MergedPersonnelEfficiencyRow[]>([]);
  const [sections, setSections] = useState<OrgChartSectionOption[]>([]);
  const [membersBySection, setMembersBySection] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const periodOpts = useMemo(() => ({ dailyDate: period, rangeFrom: period, rangeTo: period }), [period]);
  const periodLabel = formatTaskMetricsPeriodLabel(cadence, periodOpts);

  const queryBase = useCallback(() => {
    const { from, to } = resolveTaskMetricsQueryRange(cadence, period, period, period);
    const qs = new URLSearchParams({ from, to, helpdeskCadence: cadence, tz: timeZone });
    qs.set("companyId", companyId ?? "ALL");
    return qs;
  }, [cadence, period, timeZone, companyId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (view === "departments") {
        const res = await fetch(`/api/kpis/department-metrics?${queryBase()}`, { cache: "no-store" });
        if (!res.ok) throw new Error("Could not load team metrics for this period.");
        const json = (await res.json()) as { sections?: DepartmentMainMetric[] };
        setDepartments(json.sections ?? []);
        return;
      }
      const qs = queryBase();
      if (view === "company" && taskType !== "ALL") qs.set("taskType", taskType);
      const requests: Array<Promise<void>> = [
        fetch(`/api/kpis/task-metrics?${qs}`, { cache: "no-store" }).then(async (res) => {
          if (!res.ok) throw new Error("Could not load task metrics for this period.");
          const json = (await res.json()) as Partial<TaskMetricsPayload>;
          setPayload({ ...EMPTY_PAYLOAD, ...json });
        }),
      ];
      if (view === "personnel") {
        const merged = taskMetricsMergedPeriod(cadence, periodOpts);
        const effQs = new URLSearchParams({
          mode: "personnel",
          periodKey: merged.periodKey,
          frequency: merged.frequency,
        });
        requests.push(
          fetch(`/api/admin/efficiency?${effQs}`, { cache: "no-store" }).then(async (res) => {
            const json = res.ok ? ((await res.json()) as { rows?: MergedPersonnelEfficiencyRow[] }) : {};
            setMergedRows(json.rows ?? []);
          }),
        );
        if (teamId) {
          requests.push(
            fetch("/api/org-chart-sections?scope=viewer", { cache: "no-store" }).then(async (res) => {
              const json = res.ok
                ? ((await res.json()) as {
                    sections?: OrgChartSectionOption[];
                    membersBySection?: Record<string, string[]>;
                  })
                : {};
              setSections(json.sections ?? []);
              setMembersBySection(json.membersBySection ?? {});
            }),
          );
        }
      }
      await Promise.all(requests);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load KPI metrics.");
    } finally {
      setLoading(false);
    }
  }, [view, taskType, cadence, periodOpts, queryBase, teamId]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  const teamMemberIds = useMemo(
    () => (teamId ? mergedSourceUserIdsForOrgChartSectionTree(teamId, sections, membersBySection) : null),
    [teamId, sections, membersBySection],
  );

  const personnelCards = useMemo(
    () =>
      buildPersonnelInsightCards({
        mergedRows,
        selectedCompanyName: companyName ? companyName.trim().toLowerCase() : null,
        selectedOrgChartMemberIds: teamMemberIds,
        personnelDelayPenalties: payload.personnelDelayPenalties,
        personnelTicketMetrics: payload.personnelTicketMetrics,
        personnelRfpAccountingMetrics: payload.personnelRfpAccountingMetrics,
        personnelRfpFinanceMetrics: payload.personnelRfpFinanceMetrics,
        personnelIrsCanvassMetrics: payload.personnelIrsCanvassMetrics,
        personnelFtrPreparedMetrics: payload.personnelFtrPreparedMetrics,
        liveTicketsAuthoritative: !loading && !error,
      }),
    [mergedRows, companyName, teamMemberIds, payload, loading, error],
  );

  function changeCadence(next: TaskMetricsCadence) {
    setCadence(next);
    setPeriod(defaultTaskMetricsRangeForCadence(next).from);
  }

  const pillarGrid = (type: TaskMetricsTaskType) => (
    <TaskPillarMetricsGrid
      checklistPillars={payload.taskChecklistPillars}
      metricsCadence={cadence}
      reportingPeriodLabel={periodLabel}
      helpdeskTickets={payload.taskMetricsHelpdesk}
      userSupportTickets={payload.taskMetricsUserSupport}
      includeChecklistPillars={type !== "requests"}
      includeTicketPillars={type === "requests"}
      preferPillarOrder={pillarOrderFor(type)}
      showEmptyPillars={type !== "requests"}
      canExtendView={canExtendView}
      taskType={type}
      companyId={companyId ?? undefined}
      reportingTimeZone={timeZone}
    />
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="inline-flex rounded-xl border border-zinc-200 bg-zinc-100/80 p-1 dark:border-zinc-700 dark:bg-zinc-900/60">
          {(
            [
              { id: "company", label: "Company" },
              { id: "personnel", label: "Employees" },
              { id: "departments", label: "Teams" },
            ] as const
          ).map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setView(option.id)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-semibold transition",
                view === option.id
                  ? "bg-orange-600 text-white shadow-sm"
                  : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
        {view === "company" ? (
          <label className={CONTROL_LABEL}>
            Task type
            <select
              value={taskType}
              onChange={(e) => setTaskType(e.target.value as TaskMetricsTaskTypeFilter)}
              className={SELECT_CLASS}
            >
              <option value="ALL">All types</option>
              {KPI_TASK_TYPES.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className={CONTROL_LABEL}>
          Cadence
          <select
            value={cadence}
            onChange={(e) => changeCadence(e.target.value as TaskMetricsCadence)}
            className={SELECT_CLASS}
          >
            <option value="MONTHLY">Monthly</option>
            <option value="YEARLY">Yearly</option>
          </select>
        </label>
        <label className={CONTROL_LABEL}>
          {cadence === "MONTHLY" ? "Month" : "Year"}
          <DatePickerField
            granularity={cadence === "MONTHLY" ? "month" : "year"}
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            inputClassName="min-w-[10.5rem]"
          />
        </label>
        {view === "personnel" ? (
          <label className={CONTROL_LABEL}>
            Search
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Employee name…"
              className={SELECT_CLASS}
            />
          </label>
        ) : null}
        {loading ? (
          <p className="self-center text-xs font-semibold text-orange-700 dark:text-orange-300">Updating…</p>
        ) : null}
      </div>

      {error ? (
        <p className="rounded-xl border border-rose-400/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-900 dark:border-rose-500/30 dark:text-rose-100">
          {error}
        </p>
      ) : null}

      <div className={cn(loading && "pointer-events-none opacity-60")}>
        {view === "company" ? (
          taskType === "ALL" ? (
            <div className="space-y-8">
              {KPI_TASK_TYPES.map((section) => (
                <div key={section.value} className="space-y-3">
                  <h3 className="text-[11px] font-bold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
                    {section.label}
                  </h3>
                  {pillarGrid(section.value)}
                </div>
              ))}
            </div>
          ) : (
            pillarGrid(taskType)
          )
        ) : view === "departments" ? (
          <DepartmentTaskMetricsGrid
            sections={departments}
            reportingPeriodLabel={periodLabel}
            loading={loading}
            canManageVisibility={canManageDepartmentVisibility}
            onVisibilityChanged={() => void load()}
            canImport={canImportDepartmentTasks}
            onImportComplete={() => void load()}
          />
        ) : (
          <PersonnelTaskMetricsGrid
            rows={personnelCards}
            reportingPeriodLabel={periodLabel}
            companyLabel={companyName}
            departmentLabel={teamName}
            loading={loading}
            searchQuery={search}
          />
        )}
      </div>
    </div>
  );
}
