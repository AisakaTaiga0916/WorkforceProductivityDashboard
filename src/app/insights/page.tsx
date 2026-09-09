"use client";

import { isElevatedPlatformRole } from "@/lib/staff-role";

import { useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";

import { DatePickerField } from "@/components/ui/DatePickerField";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/cn";
import { BRAND_TITLE } from "@/lib/brand";
import {
  MetricsBarChart,
  MetricsGauge,
  MetricsPieChart,
  MetricsQueueStrip,
  MetricsTrendChart,
  colorForTicketStatus,
  queueSegmentsForCharts,
} from "@/components/metrics/MetricsCharts";
import { TaskPillarMetricsGrid } from "@/components/metrics/TaskPillarMetricsGrid";
import { PersonnelTaskMetricsGrid } from "@/components/metrics/PersonnelTaskMetricsGrid";
import { DepartmentTaskMetricsGrid } from "@/components/metrics/DepartmentTaskMetricsGrid";
import { MetricsFilterBar, type MetricsFilterFieldDef } from "@/components/metrics/MetricsFilterBar";
import {
  buildCadenceFieldOptions,
  buildCompanyFieldOptions,
  buildTaskTypeFieldOptions,
  metricsUrlPatch,
  parseMetricsCadence,
  parseTaskMetricsViewMode,
  resolveTaskMetricsTaskTypeFromUrl,
} from "@/lib/metrics-filter-url";
import {
  buildPersonnelInsightCards,
  type MergedPersonnelEfficiencyRow,
  type PersonnelCombinedMetricCard,
  type PersonnelDelayPenaltyRow,
} from "@/lib/task-personnel-metrics";
import {
  buildOrgChartDepartmentFilterOptions,
  mergedSourceUserIdsForOrgChartSectionTree,
  type OrgChartSectionOption,
} from "@/lib/org-chart-section-display";
import type { PersonnelTicketMetric } from "@/lib/kpis";
import type { DepartmentMainMetric } from "@/lib/department-task-metrics";
import { KpiDefinitionConsole } from "@/components/KpiDefinitionConsole";
import { InsightsMetricsPanes } from "@/app/insights/insights-metrics-panes";
import { resolveRosterCompanyName } from "@/lib/hris-company-aliases";
import { DEFAULT_TIME_ZONE } from "@/lib/kpi-recurrence";
import type {
  CsatStarDistributionRow,
  TaskChecklistPillarMetrics,
  TaskMetricsHelpdeskTickets,
  TaskMetricsUserSupportTickets,
} from "@/lib/kpis";
import {
  defaultTaskMetricsRangeForCadence,
  formatTaskMetricsPeriodLabel,
  resolveTaskMetricsQueryRange,
  taskMetricsMergedPeriod,
  type TaskMetricsCadence,
} from "@/lib/task-metrics-range";
import {
  FIELD_ASSIGNMENT_DONUT_KEY,
  PROJECTS_DONUT_KEY,
  TASK_FREQUENCY_DONUT_KEYS,
  TASK_METRICS_ALL_TYPE_SECTIONS,
  type TaskMetricsTaskType,
  type TaskMetricsTaskTypeFilter,
} from "@/lib/task-metrics-task-type";

type KpiPayload = {
  range: { from: string; to: string };
  operational: {
    ticketVolume: number;
    backlogSize: number;
    forConfirmationSize: number;
    firstResponseTimeMsAvg: number | null;
    resolutionTimeMsAvg: number | null;
    confirmationTimeMsAvg: number | null;
    firstContactResolutionApprox: number | null;
  };
  sla: {
    firstResponseComplianceRate: number | null;
    resolutionComplianceRate: number | null;
    transferRequestRate: number | null;
    reopenRate: number | null;
    ticketsClosedInRange: number;
  };
  quality: {
    csatAvg: number | null;
    npsAvg: number | null;
    cesAvg: number | null;
    feedbackCount: number;
    csatByStar: CsatStarDistributionRow[];
  };
  agents: {
    ticketsClosedByAgent: { agentId: string; name: string; ticketsClosed: number }[];
  };
  charts?: {
    days: string[];
    createdByDay: number[];
    closedByDay: number[];
    queueStatusMix: { status: string; count: number }[];
  };
  kpiManagement?: {
    kpisAdded: number;
  };
};

type TaskMetricsViewMode = "company" | "personnel" | "departments";

type InsightsTab = "ticket-metrics" | "task-metrics" | "kpi-mgmt";

function parseInsightsTab(raw: string | null): InsightsTab | null {
  if (raw === "ticket-metrics" || raw === "task-metrics" || raw === "kpi-mgmt") return raw;
  return null;
}

function formatDuration(ms: number | null) {
  if (ms === null) return "—";
  const hours = ms / 3_600_000;
  if (hours < 1) return `${Math.round(ms / 60_000)} min avg`;
  return `${hours.toFixed(1)} h avg`;
}

function pct(n: number | null) {
  if (n === null) return "—";
  return `${Math.round(n * 1000) / 10}%`;
}

export default function InsightsPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto max-w-[112rem] px-3 py-6 text-sm text-zinc-600 dark:text-zinc-400">
          Loading metrics…
        </main>
      }
    >
      <InsightsPageInner />
    </Suspense>
  );
}

function InsightsPageInner() {
  const { data: session } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const isPersonnel = session?.user?.role === "Personnel";
  const isAdminRole = isElevatedPlatformRole(session?.user?.role) || session?.user?.role === "Admin";
  const isCompanyScopedAdmin = session?.user?.role === "Admin";
  const isSuperAdmin = session?.user?.role === "SuperAdmin";
  const tabFromUrl = parseInsightsTab(searchParams.get("tab"));
  const [activeTab, setActiveTab] = useState<InsightsTab>(tabFromUrl ?? "ticket-metrics");
  const [data, setData] = useState<KpiPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [volumeChartView, setVolumeChartView] = useState<"density" | "line">("density");
  /** IANA zone for KPI period boundaries. */
  const [recurrenceTz, setRecurrenceTz] = useState(DEFAULT_TIME_ZONE);

  useEffect(() => {
    queueMicrotask(() => {
      try {
        setRecurrenceTz(DEFAULT_TIME_ZONE);
      } catch {
        setRecurrenceTz(DEFAULT_TIME_ZONE);
      }
    });
  }, []);

  /** Personnel only see personal request metrics. SuperAdmin/Admin see task reporting tabs. */
  const showTaskReportingTabs = isAdminRole;
  const showKpiTasksTab = false;

  const defaultRange = useMemo(() => {
    const to = new Date();
    const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
    return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
  }, []);

  const [from, setFrom] = useState(defaultRange.from);
  const [to, setTo] = useState(defaultRange.to);

  const taskMetricsDefaults = useMemo(() => defaultTaskMetricsRangeForCadence("MONTHLY"), []);
  const [taskMetricsCadence, setTaskMetricsCadence] = useState<TaskMetricsCadence>("MONTHLY");
  const [taskMetricsDailyDate, setTaskMetricsDailyDate] = useState(taskMetricsDefaults.dailyDate);
  const [taskMetricsFrom, setTaskMetricsFrom] = useState(taskMetricsDefaults.from);
  const [taskMetricsTo, setTaskMetricsTo] = useState(taskMetricsDefaults.to);
  const [taskMetricsHelpdesk, setTaskMetricsHelpdesk] = useState<TaskMetricsHelpdeskTickets | null>(null);
  const [taskMetricsUserSupport, setTaskMetricsUserSupport] = useState<TaskMetricsUserSupportTickets | null>(
    null,
  );
  const [taskMetricCompanies, setTaskMetricCompanies] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedTaskMetricCompany, setSelectedTaskMetricCompany] = useState("");
  const [selectedTicketMetricCompany, setSelectedTicketMetricCompany] = useState("");
  const [taskChecklistPillars, setTaskChecklistPillars] = useState<TaskChecklistPillarMetrics | null>(null);
  const [personnelTicketMetrics, setPersonnelTicketMetrics] = useState<PersonnelTicketMetric[]>([]);
  const [personnelRfpAccountingMetrics, setPersonnelRfpAccountingMetrics] = useState<PersonnelTicketMetric[]>([]);
  const [personnelRfpFinanceMetrics, setPersonnelRfpFinanceMetrics] = useState<PersonnelTicketMetric[]>([]);
  const [personnelIrsCanvassMetrics, setPersonnelIrsCanvassMetrics] = useState<PersonnelTicketMetric[]>([]);
  const [personnelFtrPreparedMetrics, setPersonnelFtrPreparedMetrics] = useState<PersonnelTicketMetric[]>([]);
  const [personnelAcaSubmittedMetrics, setPersonnelAcaSubmittedMetrics] = useState<PersonnelTicketMetric[]>([]);
  const [personnelDelayPenalties, setPersonnelDelayPenalties] = useState<PersonnelDelayPenaltyRow[]>([]);
  const [taskMetricsLoading, setTaskMetricsLoading] = useState(false);
  const [taskMetricsError, setTaskMetricsError] = useState<string | null>(null);
  const [taskMetricsViewMode, setTaskMetricsViewMode] = useState<TaskMetricsViewMode>("company");
  const [taskMetricsTaskType, setTaskMetricsTaskType] = useState<TaskMetricsTaskTypeFilter>("ALL");
  const [departmentMetrics, setDepartmentMetrics] = useState<DepartmentMainMetric[]>([]);
  const [departmentMetricsLoading, setDepartmentMetricsLoading] = useState(false);
  const [departmentMetricsError, setDepartmentMetricsError] = useState<string | null>(null);
  const [requestMetricAgents, setRequestMetricAgents] = useState<Array<{ id: string; name: string }>>(
    [],
  );
  const [requestMetricAgentsLoading, setRequestMetricAgentsLoading] = useState(false);
  const [requestOrgChartSections, setRequestOrgChartSections] = useState<OrgChartSectionOption[]>([]);

  const metricsSearchQ = searchParams.get("q") ?? "";
  const selectedRequestMetricAgentId = searchParams.get("agentId") ?? "";
  const selectedPersonnelDepartment =
    searchParams.get("department") && searchParams.get("department") !== "ALL"
      ? searchParams.get("department")!
      : "";

  const requestDepartmentOptions = useMemo(
    () => buildOrgChartDepartmentFilterOptions(requestOrgChartSections),
    [requestOrgChartSections],
  );
  const resolvedRequestMetricAgentId = useMemo(() => {
    if (selectedRequestMetricAgentId) return selectedRequestMetricAgentId;
    const q = metricsSearchQ.trim().toLowerCase();
    if (!q || requestMetricAgents.length === 0) return "";
    const matches = requestMetricAgents.filter((agent) =>
      agent.name.toLowerCase().includes(q),
    );
    return matches.length === 1 ? matches[0]!.id : "";
  }, [selectedRequestMetricAgentId, metricsSearchQ, requestMetricAgents]);

  const selectedRequestMetricAgentName = useMemo(() => {
    if (!resolvedRequestMetricAgentId) return null;
    return (
      requestMetricAgents.find((agent) => agent.id === resolvedRequestMetricAgentId)?.name ??
      data?.agents?.ticketsClosedByAgent?.find((row) => row.agentId === resolvedRequestMetricAgentId)
        ?.name ??
      null
    );
  }, [resolvedRequestMetricAgentId, requestMetricAgents, data?.agents?.ticketsClosedByAgent]);

  const loadKpis = useCallback(async () => {
    setError(null);
    if (isCompanyScopedAdmin && !selectedTicketMetricCompany) {
      setData(null);
      return;
    }
    if (isAdminRole && !isCompanyScopedAdmin && !selectedTicketMetricCompany) {
      setData(null);
      return;
    }
    const qs = new URLSearchParams({ from, to });
    if (isAdminRole) {
      qs.set("companyId", selectedTicketMetricCompany || "ALL");
    }
    if (isAdminRole && selectedPersonnelDepartment) {
      qs.set("department", selectedPersonnelDepartment);
    }
    if (resolvedRequestMetricAgentId) {
      qs.set("agentId", resolvedRequestMetricAgentId);
    }
    const res = await fetch(`/api/kpis?${qs.toString()}`, { cache: "no-store" });
    if (!res.ok) {
      setError("Could not load KPIs. Is the database running and migrated?");
      setData(null);
      return;
    }
    const json = (await res.json()) as KpiPayload;
    setData(json);
  }, [
    from,
    to,
    isAdminRole,
    isCompanyScopedAdmin,
    selectedTicketMetricCompany,
    selectedPersonnelDepartment,
    resolvedRequestMetricAgentId,
  ]);

  const loadTaskMetrics = useCallback(async () => {
    if (taskMetricsViewMode === "departments") return;
    setTaskMetricsError(null);
    setTaskMetricsLoading(true);
    const { from: tf, to: tt } = resolveTaskMetricsQueryRange(
      taskMetricsCadence,
      taskMetricsDailyDate,
      taskMetricsFrom,
      taskMetricsTo,
    );
    const qs = new URLSearchParams({
      from: tf,
      to: tt,
      helpdeskCadence: taskMetricsCadence,
      tz: recurrenceTz,
    });
    if (selectedTaskMetricCompany) {
      qs.set("companyId", selectedTaskMetricCompany);
    } else if (taskMetricsViewMode === "company" || taskMetricsViewMode === "personnel") {
      qs.set("companyId", "ALL");
    }
    // Task filter only scopes company-view donuts; omit when showing all types.
    if (taskMetricsViewMode === "company" && taskMetricsTaskType !== "ALL") {
      qs.set("taskType", taskMetricsTaskType);
    }
    try {
      const res = await fetch(`/api/kpis/task-metrics?${qs.toString()}`, { cache: "no-store" });
      if (!res.ok) {
        setTaskMetricsError("Could not load task metrics for the selected dates.");
        setTaskMetricsHelpdesk(null);
        setTaskMetricsUserSupport(null);
        setTaskChecklistPillars(null);
        setPersonnelTicketMetrics([]);
        setPersonnelRfpAccountingMetrics([]);
        setPersonnelRfpFinanceMetrics([]);
        setPersonnelIrsCanvassMetrics([]);
        setPersonnelFtrPreparedMetrics([]);
        setPersonnelAcaSubmittedMetrics([]);
        setPersonnelDelayPenalties([]);
        return;
      }
      const json = (await res.json()) as {
        taskMetricsHelpdesk: TaskMetricsHelpdeskTickets;
        taskMetricsUserSupport: TaskMetricsUserSupportTickets;
        taskChecklistPillars: TaskChecklistPillarMetrics;
        personnelTicketMetrics: PersonnelTicketMetric[];
        personnelRfpAccountingMetrics?: PersonnelTicketMetric[];
        personnelRfpFinanceMetrics?: PersonnelTicketMetric[];
        personnelIrsCanvassMetrics?: PersonnelTicketMetric[];
        personnelFtrPreparedMetrics?: PersonnelTicketMetric[];
        personnelAcaSubmittedMetrics?: PersonnelTicketMetric[];
        personnelDelayPenalties?: PersonnelDelayPenaltyRow[];
      };
      setTaskMetricsHelpdesk(json.taskMetricsHelpdesk);
      setTaskMetricsUserSupport(json.taskMetricsUserSupport);
      setTaskChecklistPillars(json.taskChecklistPillars);
      setPersonnelTicketMetrics(json.personnelTicketMetrics ?? []);
      setPersonnelRfpAccountingMetrics(json.personnelRfpAccountingMetrics ?? []);
      setPersonnelRfpFinanceMetrics(json.personnelRfpFinanceMetrics ?? []);
      setPersonnelIrsCanvassMetrics(json.personnelIrsCanvassMetrics ?? []);
      setPersonnelFtrPreparedMetrics(json.personnelFtrPreparedMetrics ?? []);
      setPersonnelAcaSubmittedMetrics(json.personnelAcaSubmittedMetrics ?? []);
      setPersonnelDelayPenalties(json.personnelDelayPenalties ?? []);
    } finally {
      setTaskMetricsLoading(false);
    }
  }, [
    taskMetricsCadence,
    taskMetricsDailyDate,
    taskMetricsFrom,
    taskMetricsTo,
    recurrenceTz,
    selectedTaskMetricCompany,
    taskMetricsTaskType,
    taskMetricsViewMode,
  ]);

  const loadDepartmentMetrics = useCallback(async () => {
    if (taskMetricsViewMode !== "departments") return;
    setDepartmentMetricsError(null);
    setDepartmentMetricsLoading(true);
    const { from: tf, to: tt } = resolveTaskMetricsQueryRange(
      taskMetricsCadence,
      taskMetricsDailyDate,
      taskMetricsFrom,
      taskMetricsTo,
    );
    const qs = new URLSearchParams({
      from: tf,
      to: tt,
      helpdeskCadence: taskMetricsCadence,
      tz: recurrenceTz,
    });
    try {
      const res = await fetch(`/api/kpis/department-metrics?${qs.toString()}`, { cache: "no-store" });
      if (!res.ok) {
        setDepartmentMetricsError("Could not load department metrics for the selected dates.");
        setDepartmentMetrics([]);
        return;
      }
      const json = (await res.json()) as { sections?: DepartmentMainMetric[] };
      setDepartmentMetrics(json.sections ?? []);
    } finally {
      setDepartmentMetricsLoading(false);
    }
  }, [
    taskMetricsCadence,
    taskMetricsDailyDate,
    taskMetricsFrom,
    taskMetricsTo,
    recurrenceTz,
    taskMetricsViewMode,
  ]);

  function handleTaskMetricsCadenceChange(next: TaskMetricsCadence) {
    setTaskMetricsCadence(next);
    const defaults = defaultTaskMetricsRangeForCadence(next);
    setTaskMetricsDailyDate(defaults.dailyDate);
    setTaskMetricsFrom(defaults.from);
    setTaskMetricsTo(defaults.to);
  }

  useEffect(() => {
    if (!showTaskReportingTabs || activeTab !== "ticket-metrics" || !isAdminRole) return;
    let cancelled = false;
    async function loadRequestMetricAgents() {
      setRequestMetricAgentsLoading(true);
      const companyParam =
        isCompanyScopedAdmin && selectedTicketMetricCompany
          ? selectedTicketMetricCompany
          : selectedTicketMetricCompany && selectedTicketMetricCompany !== "ALL"
            ? selectedTicketMetricCompany
            : null;
      const qs = new URLSearchParams();
      if (companyParam) qs.set("company", companyParam);
      else qs.set("anyCompany", "1");
      if (selectedPersonnelDepartment) qs.set("section", selectedPersonnelDepartment);
      try {
        const res = await fetch(`/api/agents?${qs.toString()}`, { cache: "no-store" });
        const rows = (await res.json().catch(() => [])) as Array<{ id: string; name: string }>;
        if (cancelled) return;
        if (!res.ok || !Array.isArray(rows)) {
          setRequestMetricAgents([]);
          return;
        }
        setRequestMetricAgents(
          rows
            .map((row) => ({ id: row.id, name: row.name?.trim() || "Unknown" }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        );
      } catch {
        if (!cancelled) setRequestMetricAgents([]);
      } finally {
        if (!cancelled) setRequestMetricAgentsLoading(false);
      }
    }
    void loadRequestMetricAgents();
    return () => {
      cancelled = true;
    };
  }, [
    showTaskReportingTabs,
    activeTab,
    isAdminRole,
    isCompanyScopedAdmin,
    selectedTicketMetricCompany,
    selectedPersonnelDepartment,
  ]);

  useEffect(() => {
    if (activeTab !== "ticket-metrics" || !isAdminRole) return;
    let cancelled = false;
    async function loadRequestDepartments() {
      try {
        const res = await fetch("/api/org-chart-sections?scope=viewer", { cache: "no-store" });
        if (!res.ok) {
          if (!cancelled) setRequestOrgChartSections([]);
          return;
        }
        const json = (await res.json()) as { sections?: OrgChartSectionOption[] };
        if (!cancelled) setRequestOrgChartSections(json.sections ?? []);
      } catch {
        if (!cancelled) setRequestOrgChartSections([]);
      }
    }
    void loadRequestDepartments();
    return () => {
      cancelled = true;
    };
  }, [activeTab, isAdminRole]);

  useEffect(() => {
    queueMicrotask(() => void loadKpis());
  }, [loadKpis]);

  useEffect(() => {
    function onVisibility() {
      if (document.visibilityState === "visible") void loadKpis();
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [loadKpis]);

  useEffect(() => {
    if (activeTab !== "ticket-metrics") return;
    const id = setInterval(() => void loadKpis(), 45_000);
    return () => clearInterval(id);
  }, [activeTab, loadKpis]);

  useEffect(() => {
    if (activeTab !== "task-metrics") {
      return;
    }
    queueMicrotask(() => void loadTaskMetrics());
  }, [activeTab, loadTaskMetrics]);

  useEffect(() => {
    if (activeTab !== "task-metrics") {
      return;
    }
    queueMicrotask(() => void loadDepartmentMetrics());
  }, [activeTab, loadDepartmentMetrics]);

  useEffect(() => {
    if (!showTaskReportingTabs) return;
    let cancelled = false;
    async function loadMetricCompanies() {
      const res = await fetch("/api/kpis/metric-companies", { cache: "no-store" });
      if (!res.ok) {
        if (!cancelled) {
          setError("Could not load companies for request metrics.");
        }
        return;
      }
      const json = (await res.json()) as { companies: Array<{ id: string; name: string }> };
      if (cancelled) return;
      const companies = json.companies ?? [];
      setTaskMetricCompanies(companies);
      setSelectedTaskMetricCompany((current) => {
        if (isCompanyScopedAdmin) {
          if (companies.some((company) => company.id === current)) return current;
          return companies[0]?.id ?? "";
        }
        // SuperAdmin: never invent a default company — empty means all companies.
        if (!current || current === "ALL") return "";
        if (companies.some((company) => company.id === current)) return current;
        return "";
      });
      setSelectedTicketMetricCompany((current) => {
        if (current === "ALL" && !isCompanyScopedAdmin) return current;
        if (companies.some((company) => company.id === current)) return current;
        if (isCompanyScopedAdmin) return companies[0]?.id ?? "";
        return "ALL";
      });
    }
    void loadMetricCompanies();
    const id = window.setInterval(() => void loadMetricCompanies(), 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [showTaskReportingTabs, isCompanyScopedAdmin]);

  useEffect(() => {
    function onVisibility() {
      if (
        document.visibilityState === "visible" &&
        activeTab === "task-metrics"
      ) {
        void loadTaskMetrics();
      }
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [activeTab, loadTaskMetrics]);

  useEffect(() => {
    if (activeTab !== "task-metrics") {
      return;
    }
    const id = setInterval(() => void loadTaskMetrics(), 15_000);
    return () => clearInterval(id);
  }, [activeTab, loadTaskMetrics]);

  const selectTab = useCallback(
    (value: InsightsTab) => {
      setActiveTab(value);
      const current = parseInsightsTab(searchParams.get("tab")) ?? "ticket-metrics";
      if (current === value) return;
      const params = new URLSearchParams(searchParams.toString());
      params.set("tab", value);
      router.replace(`/insights?${params.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  const insightsMetricsPane = activeTab === "task-metrics" ? "task" : "request";
  const onInsightsMetricsPaneChange = useCallback(
    (next: "request" | "task") => {
      selectTab(next === "task" ? "task-metrics" : "ticket-metrics");
    },
    [selectTab],
  );

  const patchMetricsUrl = useCallback(
    (patch: (params: URLSearchParams) => void) => {
      metricsUrlPatch(router, patch, ["tab"]);
    },
    [router],
  );

  useEffect(() => {
    const fromParam = searchParams.get("from");
    const toParam = searchParams.get("to");
    if (fromParam) setFrom(fromParam);
    if (toParam) setTo(toParam);

    const companyId = searchParams.get("companyId");
    if (activeTab === "ticket-metrics") {
      // Absent / ALL = unscoped — must reset so Clear can drop the Company chip.
      setSelectedTicketMetricCompany(
        companyId && companyId !== "ALL" ? companyId : "ALL",
      );
    }

    if (activeTab === "task-metrics") {
      setTaskMetricsViewMode(parseTaskMetricsViewMode(searchParams.get("taskView")));
      // Always sync — Clear deletes params; missing taskType/cadence means defaults.
      setTaskMetricsTaskType(resolveTaskMetricsTaskTypeFromUrl(searchParams.get("taskType")));
      const cad = parseMetricsCadence(searchParams.get("cadence"));
      if (cad !== taskMetricsCadence) {
        handleTaskMetricsCadenceChange(cad);
      }
      const period = searchParams.get("period");
      if (period) {
        setTaskMetricsFrom(period);
        setTaskMetricsTo(period);
      }
      if (companyId !== null) {
        setSelectedTaskMetricCompany(companyId === "ALL" ? "" : companyId);
      } else {
        setSelectedTaskMetricCompany("");
      }
    }
  }, [searchParams, activeTab, taskMetricsCadence]);

  useEffect(() => {
    if (tabFromUrl && tabFromUrl !== activeTab) {
      queueMicrotask(() => setActiveTab(tabFromUrl));
    }
  }, [tabFromUrl, activeTab]);

  useEffect(() => {
    if (!showKpiTasksTab && activeTab === "kpi-mgmt") {
      queueMicrotask(() => selectTab("ticket-metrics"));
    }
    if (!showTaskReportingTabs && activeTab === "task-metrics") {
      queueMicrotask(() => selectTab("ticket-metrics"));
    }
  }, [showKpiTasksTab, showTaskReportingTabs, activeTab, selectTab]);

  const charts = data?.charts ?? {
    days: [],
    createdByDay: [],
    closedByDay: [],
    queueStatusMix: [],
  };

  const queuePieSegments = useMemo(
    () =>
      queueSegmentsForCharts(charts.queueStatusMix).map((seg) => ({
        label: seg.status.replaceAll("_", " "),
        value: seg.count,
        color: colorForTicketStatus(seg.status),
      })),
    [charts.queueStatusMix],
  );
  const satisfactionRows = useMemo(() => {
    const dist = data?.quality?.csatByStar;
    if (!dist?.length) {
      return ([1, 2, 3, 4, 5] as const).map((star) => ({
        label:
          star === 1
            ? "1★ — Very Poor"
            : star === 2
              ? "2★ — Poor"
              : star === 3
                ? "3★ — Neutral"
                : star === 4
                  ? "4★ — Good"
                  : "5★ — Very Good",
        value: 0,
      }));
    }
    return dist.map((r) => ({
      label: `${r.star}★ — ${r.label}`,
      value: r.count,
    }));
  }, [data]);

  const userEmail = session?.user?.email ?? "";

  const requestMetricsFilterFields = useMemo((): MetricsFilterFieldDef[] => {
    if (!isAdminRole) return [];
    const fields: MetricsFilterFieldDef[] = [];
    if (!isCompanyScopedAdmin) {
      fields.push({
        id: "company",
        type: "Company",
        param: "companyId",
        visible: true,
        value: selectedTicketMetricCompany || "ALL",
        emptyValue: "ALL",
        options: buildCompanyFieldOptions(taskMetricCompanies, { includeAll: false }),
      });
    }
    fields.push({
      id: "department",
      type: "Department",
      param: "department",
      visible: true,
      value: selectedPersonnelDepartment || "ALL",
      emptyValue: "ALL",
      options: requestDepartmentOptions,
    });
    return fields;
  }, [
    isAdminRole,
    isCompanyScopedAdmin,
    selectedTicketMetricCompany,
    selectedPersonnelDepartment,
    taskMetricCompanies,
    requestDepartmentOptions,
  ]);

  const viewingPersonalRequestMetrics = Boolean(resolvedRequestMetricAgentId);

  const filteredAgentClosers = useMemo(() => {
    if (viewingPersonalRequestMetrics) return [];
    return data?.agents?.ticketsClosedByAgent ?? [];
  }, [data?.agents?.ticketsClosedByAgent, viewingPersonalRequestMetrics]);

  return (
    <main className="mx-auto max-w-[112rem] space-y-8 px-3 py-6 text-zinc-900 sm:space-y-10 sm:px-5 sm:py-8 lg:px-6 md:py-10 dark:text-zinc-100">
      <header className="rounded-2xl border border-zinc-200 bg-gradient-to-b from-white to-zinc-50 p-4 shadow-[0_12px_40px_rgba(0,0,0,0.06)] sm:p-6 md:p-8 dark:border-zinc-800/90 dark:from-[#101010] dark:to-[#080808] dark:shadow-[0_20px_50px_rgba(0,0,0,0.4)]">
        <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-orange-700 sm:text-xs sm:tracking-[0.18em] dark:text-orange-400/95">
              {viewingPersonalRequestMetrics && activeTab === "ticket-metrics"
                ? "Personal request metrics"
                : isPersonnel
                  ? "Personal metrics"
                  : "Request metrics & reports"}
            </p>
            <h1 className="mt-1.5 text-2xl font-bold tracking-tight text-zinc-900 sm:mt-2 sm:text-3xl md:text-4xl dark:text-white">
              {viewingPersonalRequestMetrics && activeTab === "ticket-metrics"
                ? selectedRequestMetricAgentName ?? "Personal request metrics"
                : isPersonnel
                  ? "Personal performance intelligence"
                  : "Operations intelligence"}
            </h1>
            {viewingPersonalRequestMetrics && activeTab === "ticket-metrics" && isAdminRole ? (
              <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                Showing request metrics for tickets assigned to{" "}
                <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                  {selectedRequestMetricAgentName ?? "selected personnel"}
                </span>
                . Clear the search to return to company-wide metrics.
              </p>
            ) : null}
        </div>
        <Tabs value={activeTab} onValueChange={(value) => selectTab(value as InsightsTab)} className="mt-4 w-full sm:mt-6">
          <TabsList className="flex h-auto w-full gap-1 rounded-xl border border-zinc-300 bg-zinc-100 p-1 text-xs font-semibold dark:border-zinc-700 dark:bg-zinc-900/90 sm:rounded-full">
            <TabsTrigger value="ticket-metrics" className="min-h-9 flex-1 rounded-lg px-3 py-2 text-center text-[11px] font-semibold leading-tight data-[state=active]:bg-orange-600 data-[state=active]:text-white sm:rounded-full sm:px-4 sm:py-2 sm:text-xs">
              <span className="sm:hidden">{isPersonnel ? "My requests" : "Request metrics"}</span>
              <span className="hidden sm:inline">{isPersonnel ? "My Request Metrics and Reports" : "Request Metrics and Reports"}</span>
            </TabsTrigger>
            {showTaskReportingTabs ? (
              <TabsTrigger value="task-metrics" className="min-h-9 flex-1 rounded-lg px-3 py-2 text-center text-[11px] font-semibold leading-tight data-[state=active]:bg-orange-600 data-[state=active]:text-white sm:rounded-full sm:px-4 sm:py-2 sm:text-xs">
                <span className="sm:hidden">Task metrics</span>
                <span className="hidden sm:inline">Task Metrics and Reports</span>
              </TabsTrigger>
            ) : null}
            {showKpiTasksTab ? (
              <TabsTrigger value="kpi-mgmt" className="min-h-9 flex-1 rounded-lg px-3 py-2 text-center text-xs font-semibold data-[state=active]:bg-orange-600 data-[state=active]:text-white sm:rounded-full sm:px-4 sm:py-2">
                {isPersonnel ? "My Task Management" : "Task Management"}
              </TabsTrigger>
            ) : null}
          </TabsList>
        </Tabs>
      </header>

      {activeTab === "kpi-mgmt" && showKpiTasksTab ? (
        <div className="space-y-6">
          <KpiDefinitionConsole onMaintenanceRecordsUpdated={() => {}} />
        </div>
      ) : showTaskReportingTabs ? (
        <InsightsMetricsPanes
          pane={insightsMetricsPane}
          onPaneChange={onInsightsMetricsPaneChange}
          requestMetrics={
            <>

              {isAdminRole ? (
        <div className="space-y-3 rounded-xl border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/40 sm:p-4">
          <MetricsFilterBar
            initialQuery={metricsSearchQ}
            placeholder="Search personnel by name…"
            fields={requestMetricsFilterFields}
            savedFilterStorageKey={
              userEmail ? `saved-request-metrics-filters:${userEmail}:v1` : undefined
            }
            preserveParams={["tab", "from", "to", "agentId", "department"]}
            extraCaptureParams={["from", "to", "agentId", "department"]}
            searchSuggestions={requestMetricAgents.map((agent) => ({
              id: agent.id,
              label: agent.name,
            }))}
            searchSuggestionsLoading={requestMetricAgentsLoading}
            searchSuggestionParam="agentId"
            className="border-0 bg-transparent shadow-none dark:bg-transparent"
          />
          <div className="grid grid-cols-2 gap-3 border-t border-zinc-200 pt-3 dark:border-zinc-700 sm:flex sm:flex-wrap sm:items-end">
            {isCompanyScopedAdmin ? (
              <CompanyValueLabel
                label="Company"
                value={
                  taskMetricCompanies.find((c) => c.id === selectedTicketMetricCompany)?.name ??
                  "No assigned company"
                }
                className="col-span-2 min-w-0 sm:col-span-1 sm:min-w-[12rem]"
              />
            ) : null}
            <label className="flex min-w-0 flex-col text-left text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-600 dark:text-zinc-500">
              From
              <DatePickerField
                value={from}
                max={to || undefined}
                onChange={(e) => {
                  const next = e.target.value;
                  setFrom(next);
                  patchMetricsUrl((params) => {
                    params.set("from", next);
                  });
                }}
                wrapperClassName="mt-1.5 w-full min-w-0"
              />
            </label>
            <label className="flex min-w-0 flex-col text-left text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-600 dark:text-zinc-500">
              To
              <DatePickerField
                value={to}
                min={from || undefined}
                onChange={(e) => {
                  const next = e.target.value;
                  setTo(next);
                  patchMetricsUrl((params) => {
                    params.set("to", next);
                  });
                }}
                wrapperClassName="mt-1.5 w-full min-w-0"
              />
            </label>
          </div>
        </div>
              ) : null}

              {error ? (
        <p className="rounded-xl border border-red-500/35 bg-red-50 px-4 py-3 text-sm text-red-900 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </p>
              ) : null}

        <div className="space-y-8">
          {!data ? (
            <div className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-6 dark:border-zinc-800 dark:bg-zinc-900/40">
              <span className="inline-block size-4 animate-spin rounded-full border-2 border-orange-600 border-t-transparent" aria-hidden />
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                {isAdminRole && !selectedTicketMetricCompany
                  ? "Loading companies…"
                  : "Loading metrics…"}
              </p>
            </div>
          ) : (
            <>
          {/* Operational load */}
          <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-[0_12px_36px_rgba(0,0,0,0.06)] sm:p-6 md:p-7 dark:border-zinc-800/90 dark:bg-[#0a0a0a] dark:shadow-[0_16px_48px_rgba(0,0,0,0.35)]">
            <h2 className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-600 sm:text-[11px] sm:tracking-[0.2em] dark:text-zinc-500">
              Operational load
            </h2>
            <div className="mt-3 space-y-3 sm:mt-4 sm:space-y-4">
              <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
                <MetricTile
                  label="Request volume"
                  value={String(data.operational.ticketVolume)}
                  accent
                />
                <MetricTile
                  label="Active requests"
                  value={String(data.operational.backlogSize)}
                />
                <MetricTile
                  label="For Confirmation"
                  value={String(data.operational.forConfirmationSize)}
                />
                <MetricTile
                  label="Closed"
                  value={String(data.sla.ticketsClosedInRange)}
                />
              </div>
              <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3">
                <MetricTile
                  label="Avg first response"
                  value={formatDuration(data.operational.firstResponseTimeMsAvg)}
                />
                <MetricTile
                  label="Avg resolution time"
                  value={formatDuration(data.operational.resolutionTimeMsAvg)}
                />
                <MetricTile
                  label="Avg confirmation time"
                  value={formatDuration(data.operational.confirmationTimeMsAvg)}
                />
              </div>
            </div>
          </section>

          {/* Volume and throughput */}
          <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-[0_12px_36px_rgba(0,0,0,0.06)] sm:p-6 md:p-7 dark:border-zinc-800/90 dark:bg-[#0a0a0a] dark:shadow-[0_16px_48px_rgba(0,0,0,0.35)]">
            <h2 className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-600 sm:text-[11px] sm:tracking-[0.22em] dark:text-zinc-500">
              Volume and throughput
            </h2>
            <p className="mt-1 text-base font-semibold leading-snug text-zinc-900 sm:text-lg dark:text-zinc-100">
              Created vs closed (daily, real-time)
            </p>

            <div className="mt-4 grid grid-cols-2 gap-3 rounded-xl border border-zinc-200 bg-zinc-50/80 p-3 dark:border-zinc-800 dark:bg-zinc-950/50 sm:gap-4 sm:p-4">
              <div>
                <span className="block text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-500">
                  Created in range
                </span>
                <span className="mt-0.5 block text-2xl font-bold tabular-nums text-orange-700 sm:text-lg dark:text-orange-400">
                  {data.operational.ticketVolume}
                </span>
              </div>
              <div>
                <span className="block text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-500">
                  Closed in range
                </span>
                <span className="mt-0.5 block text-2xl font-bold tabular-nums text-zinc-900 sm:text-lg dark:text-zinc-200">
                  {data.sla.ticketsClosedInRange}
                </span>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Tabs value={volumeChartView} onValueChange={(value) => setVolumeChartView(value as typeof volumeChartView)}>
                <TabsList className="h-auto w-full rounded-xl border border-zinc-300 bg-zinc-100 p-1 text-[10px] font-bold uppercase tracking-[0.12em] dark:border-zinc-700 dark:bg-zinc-900/90 sm:w-auto sm:rounded-full">
                  <TabsTrigger value="density" className="min-h-8 flex-1 rounded-lg px-3 py-1.5 text-[10px] font-bold uppercase data-[state=active]:bg-orange-600 data-[state=active]:text-white sm:flex-none sm:rounded-full sm:px-3 sm:py-1">
                    Density
                  </TabsTrigger>
                  <TabsTrigger value="line" className="min-h-8 flex-1 rounded-lg px-3 py-1.5 text-[10px] font-bold uppercase data-[state=active]:bg-orange-600 data-[state=active]:text-white sm:flex-none sm:rounded-full sm:px-3 sm:py-1">
                    Line chart
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            <div className="mt-4 sm:mt-6">
              <MetricsTrendChart
                labels={charts.days}
                created={charts.createdByDay}
                closed={charts.closedByDay}
                variant={volumeChartView}
              />
            </div>
          </section>

          {/* Queue composition + SLA performance */}
          <section className="grid gap-4 sm:gap-6 lg:grid-cols-2">
            <div className="stoic-card p-4 sm:p-7">
              <h2 className="stoic-label">Queue composition</h2>
              <div className="mt-6">
                <MetricsPieChart
                  title="Open queue distribution"
                  itemsLabel={(n) => `${n} open request${n === 1 ? "" : "s"}`}
                  emptyDescription="No active queue items."
                  showPercentages
                  pieClassName="h-44 w-44 sm:h-48 sm:w-48"
                  segments={queuePieSegments}
                />
              </div>
              <div className="mt-5 border-t border-border pt-5">
                <MetricsQueueStrip segments={charts.queueStatusMix} />
              </div>
            </div>

            <div className="stoic-card p-4 sm:p-7">
              <h2 className="stoic-label">SLA performance</h2>
              <div className="mt-4 grid grid-cols-2 gap-4 sm:mt-6 sm:gap-8">
                <MetricsGauge
                  label="First response"
                  value={data.sla.firstResponseComplianceRate}
                  target={0.95}
                />
                <MetricsGauge
                  label="Resolution"
                  value={data.sla.resolutionComplianceRate}
                  target={0.95}
                />
              </div>
              <div className="mt-6 grid grid-cols-2 gap-3 border-t border-border pt-6">
                <div className="rounded-xl border border-border bg-surface-muted px-3 py-4 text-center">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                    Transfer request rate
                  </p>
                  <p className="mt-1 text-2xl font-bold tabular-nums text-brand">
                    {pct(data.sla.transferRequestRate)}
                  </p>
                </div>
                <div className="rounded-xl border border-border bg-surface-muted px-3 py-4 text-center">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">Reopen rate</p>
                  <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">
                    {pct(data.sla.reopenRate)}
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* Quality signals */}
          <section>
            <h2 className="text-[11px] font-bold uppercase tracking-[0.2em] text-zinc-600 dark:text-zinc-500">
              Quality &amp; signals
            </h2>
            <div className="mt-4 grid gap-6 lg:grid-cols-[1.7fr_1fr]">
              <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-[0_8px_28px_rgba(0,0,0,0.06)] dark:border-zinc-800/90 dark:bg-[#0a0a0a]">
                <MetricsBarChart
                  title="User satisfaction (CSAT star ratings)"
                  rows={satisfactionRows}
                  valueFormatter={(v) =>
                    v === 0 ? "0" : `${v} response${v === 1 ? "" : "s"}`
                  }
                />
              </section>
              <div className="grid gap-4">
                <MetricTile
                  label="Feedback responses"
                  value={String(data.quality.feedbackCount)}
                  accent
                />
                <MetricTile
                  label="Quality note"
                  value="CSAT = 1–5 stars"
                />
              </div>
            </div>
          </section>

          {filteredAgentClosers.length > 0 && !viewingPersonalRequestMetrics ? (
            <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-[0_8px_28px_rgba(0,0,0,0.06)] sm:p-7 dark:border-zinc-800/90 dark:bg-[#0a0a0a]">
              <h2 className="text-[11px] font-bold uppercase tracking-[0.2em] text-zinc-600 dark:text-zinc-500">
                Top closers in range
              </h2>
              <ul className="mt-4 space-y-2">
                {filteredAgentClosers.slice(0, 12).map((row) => (
                  <li
                    key={row.agentId}
                    className="flex items-center justify-between rounded-lg border border-zinc-200 bg-zinc-50/80 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900/50"
                  >
                    <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{row.name}</span>
                    <span className="text-sm font-bold tabular-nums text-orange-700 dark:text-orange-300">
                      {row.ticketsClosed} closed
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
            </>
          )}
        </div>

            </>
          }
          taskMetrics={

            <TaskMetricsPanel
              checklistPillars={taskChecklistPillars}
              personnelTicketMetrics={personnelTicketMetrics}
              personnelRfpAccountingMetrics={personnelRfpAccountingMetrics}
              personnelRfpFinanceMetrics={personnelRfpFinanceMetrics}
              personnelIrsCanvassMetrics={personnelIrsCanvassMetrics}
              personnelFtrPreparedMetrics={personnelFtrPreparedMetrics}
              personnelAcaSubmittedMetrics={personnelAcaSubmittedMetrics}
              personnelDelayPenalties={personnelDelayPenalties}
              departmentSections={departmentMetrics}
              helpdeskTickets={taskMetricsHelpdesk}
              userSupportTickets={taskMetricsUserSupport}
              loading={
                taskMetricsViewMode === "departments" ? departmentMetricsLoading : taskMetricsLoading
              }
              error={
                taskMetricsViewMode === "departments" ? departmentMetricsError : taskMetricsError
              }
              taskMetricsCadence={taskMetricsCadence}
              onTaskMetricsCadenceChange={handleTaskMetricsCadenceChange}
              dailyDate={taskMetricsDailyDate}
              onDailyDateChange={setTaskMetricsDailyDate}
              rangeFrom={taskMetricsFrom}
              rangeTo={taskMetricsTo}
              onRangeFromChange={setTaskMetricsFrom}
              onRangeToChange={setTaskMetricsTo}
              reportingTimeZone={recurrenceTz}
              companies={taskMetricCompanies}
              selectedCompany={selectedTaskMetricCompany}
              onSelectedCompanyChange={setSelectedTaskMetricCompany}
              lockCompanySelection={isCompanyScopedAdmin}
              metricsViewMode={taskMetricsViewMode}
              onMetricsViewModeChange={setTaskMetricsViewMode}
              taskType={taskMetricsTaskType}
              onTaskTypeChange={setTaskMetricsTaskType}
              allowAllCompaniesInPersonnel={true}
              canExtendView={isAdminRole}
              canManageDepartmentVisibility={isSuperAdmin}
              onDepartmentVisibilityChanged={() => void loadDepartmentMetrics()}
              canImportDepartmentTasks={isAdminRole}
              metricsSearchQ={metricsSearchQ}
              selectedPersonnelDepartment={selectedPersonnelDepartment}
              userEmail={userEmail}
              patchMetricsUrl={patchMetricsUrl}
            />
          
          }
        />
      ) : (
            <>

              {isAdminRole ? (
        <div className="space-y-3 rounded-xl border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/40 sm:p-4">
          <MetricsFilterBar
            initialQuery={metricsSearchQ}
            placeholder="Search personnel by name…"
            fields={requestMetricsFilterFields}
            savedFilterStorageKey={
              userEmail ? `saved-request-metrics-filters:${userEmail}:v1` : undefined
            }
            preserveParams={["tab", "from", "to", "agentId", "department"]}
            extraCaptureParams={["from", "to", "agentId", "department"]}
            searchSuggestions={requestMetricAgents.map((agent) => ({
              id: agent.id,
              label: agent.name,
            }))}
            searchSuggestionsLoading={requestMetricAgentsLoading}
            searchSuggestionParam="agentId"
            className="border-0 bg-transparent shadow-none dark:bg-transparent"
          />
          <div className="grid grid-cols-2 gap-3 border-t border-zinc-200 pt-3 dark:border-zinc-700 sm:flex sm:flex-wrap sm:items-end">
            {isCompanyScopedAdmin ? (
              <CompanyValueLabel
                label="Company"
                value={
                  taskMetricCompanies.find((c) => c.id === selectedTicketMetricCompany)?.name ??
                  "No assigned company"
                }
                className="col-span-2 min-w-0 sm:col-span-1 sm:min-w-[12rem]"
              />
            ) : null}
            <label className="flex min-w-0 flex-col text-left text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-600 dark:text-zinc-500">
              From
              <DatePickerField
                value={from}
                max={to || undefined}
                onChange={(e) => {
                  const next = e.target.value;
                  setFrom(next);
                  patchMetricsUrl((params) => {
                    params.set("from", next);
                  });
                }}
                wrapperClassName="mt-1.5 w-full min-w-0"
              />
            </label>
            <label className="flex min-w-0 flex-col text-left text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-600 dark:text-zinc-500">
              To
              <DatePickerField
                value={to}
                min={from || undefined}
                onChange={(e) => {
                  const next = e.target.value;
                  setTo(next);
                  patchMetricsUrl((params) => {
                    params.set("to", next);
                  });
                }}
                wrapperClassName="mt-1.5 w-full min-w-0"
              />
            </label>
          </div>
        </div>
              ) : null}

              {error ? (
        <p className="rounded-xl border border-red-500/35 bg-red-50 px-4 py-3 text-sm text-red-900 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </p>
              ) : null}

        <div className="space-y-8">
          {!data ? (
            <div className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-6 dark:border-zinc-800 dark:bg-zinc-900/40">
              <span className="inline-block size-4 animate-spin rounded-full border-2 border-orange-600 border-t-transparent" aria-hidden />
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                {isAdminRole && !selectedTicketMetricCompany
                  ? "Loading companies…"
                  : "Loading metrics…"}
              </p>
            </div>
          ) : (
            <>
          {/* Operational load */}
          <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-[0_12px_36px_rgba(0,0,0,0.06)] sm:p-6 md:p-7 dark:border-zinc-800/90 dark:bg-[#0a0a0a] dark:shadow-[0_16px_48px_rgba(0,0,0,0.35)]">
            <h2 className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-600 sm:text-[11px] sm:tracking-[0.2em] dark:text-zinc-500">
              Operational load
            </h2>
            <div className="mt-3 space-y-3 sm:mt-4 sm:space-y-4">
              <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
                <MetricTile
                  label="Request volume"
                  value={String(data.operational.ticketVolume)}
                  accent
                />
                <MetricTile
                  label="Active requests"
                  value={String(data.operational.backlogSize)}
                />
                <MetricTile
                  label="For Confirmation"
                  value={String(data.operational.forConfirmationSize)}
                />
                <MetricTile
                  label="Closed"
                  value={String(data.sla.ticketsClosedInRange)}
                />
              </div>
              <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3">
                <MetricTile
                  label="Avg first response"
                  value={formatDuration(data.operational.firstResponseTimeMsAvg)}
                />
                <MetricTile
                  label="Avg resolution time"
                  value={formatDuration(data.operational.resolutionTimeMsAvg)}
                />
                <MetricTile
                  label="Avg confirmation time"
                  value={formatDuration(data.operational.confirmationTimeMsAvg)}
                />
              </div>
            </div>
          </section>

          {/* Volume and throughput */}
          <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-[0_12px_36px_rgba(0,0,0,0.06)] sm:p-6 md:p-7 dark:border-zinc-800/90 dark:bg-[#0a0a0a] dark:shadow-[0_16px_48px_rgba(0,0,0,0.35)]">
            <h2 className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-600 sm:text-[11px] sm:tracking-[0.22em] dark:text-zinc-500">
              Volume and throughput
            </h2>
            <p className="mt-1 text-base font-semibold leading-snug text-zinc-900 sm:text-lg dark:text-zinc-100">
              Created vs closed (daily, real-time)
            </p>

            <div className="mt-4 grid grid-cols-2 gap-3 rounded-xl border border-zinc-200 bg-zinc-50/80 p-3 dark:border-zinc-800 dark:bg-zinc-950/50 sm:gap-4 sm:p-4">
              <div>
                <span className="block text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-500">
                  Created in range
                </span>
                <span className="mt-0.5 block text-2xl font-bold tabular-nums text-orange-700 sm:text-lg dark:text-orange-400">
                  {data.operational.ticketVolume}
                </span>
              </div>
              <div>
                <span className="block text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-500">
                  Closed in range
                </span>
                <span className="mt-0.5 block text-2xl font-bold tabular-nums text-zinc-900 sm:text-lg dark:text-zinc-200">
                  {data.sla.ticketsClosedInRange}
                </span>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Tabs value={volumeChartView} onValueChange={(value) => setVolumeChartView(value as typeof volumeChartView)}>
                <TabsList className="h-auto w-full rounded-xl border border-zinc-300 bg-zinc-100 p-1 text-[10px] font-bold uppercase tracking-[0.12em] dark:border-zinc-700 dark:bg-zinc-900/90 sm:w-auto sm:rounded-full">
                  <TabsTrigger value="density" className="min-h-8 flex-1 rounded-lg px-3 py-1.5 text-[10px] font-bold uppercase data-[state=active]:bg-orange-600 data-[state=active]:text-white sm:flex-none sm:rounded-full sm:px-3 sm:py-1">
                    Density
                  </TabsTrigger>
                  <TabsTrigger value="line" className="min-h-8 flex-1 rounded-lg px-3 py-1.5 text-[10px] font-bold uppercase data-[state=active]:bg-orange-600 data-[state=active]:text-white sm:flex-none sm:rounded-full sm:px-3 sm:py-1">
                    Line chart
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            <div className="mt-4 sm:mt-6">
              <MetricsTrendChart
                labels={charts.days}
                created={charts.createdByDay}
                closed={charts.closedByDay}
                variant={volumeChartView}
              />
            </div>
          </section>

          {/* Queue composition + SLA performance */}
          <section className="grid gap-4 sm:gap-6 lg:grid-cols-2">
            <div className="stoic-card p-4 sm:p-7">
              <h2 className="stoic-label">Queue composition</h2>
              <div className="mt-6">
                <MetricsPieChart
                  title="Open queue distribution"
                  itemsLabel={(n) => `${n} open request${n === 1 ? "" : "s"}`}
                  emptyDescription="No active queue items."
                  showPercentages
                  pieClassName="h-44 w-44 sm:h-48 sm:w-48"
                  segments={queuePieSegments}
                />
              </div>
              <div className="mt-5 border-t border-border pt-5">
                <MetricsQueueStrip segments={charts.queueStatusMix} />
              </div>
            </div>

            <div className="stoic-card p-4 sm:p-7">
              <h2 className="stoic-label">SLA performance</h2>
              <div className="mt-4 grid grid-cols-2 gap-4 sm:mt-6 sm:gap-8">
                <MetricsGauge
                  label="First response"
                  value={data.sla.firstResponseComplianceRate}
                  target={0.95}
                />
                <MetricsGauge
                  label="Resolution"
                  value={data.sla.resolutionComplianceRate}
                  target={0.95}
                />
              </div>
              <div className="mt-6 grid grid-cols-2 gap-3 border-t border-border pt-6">
                <div className="rounded-xl border border-border bg-surface-muted px-3 py-4 text-center">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                    Transfer request rate
                  </p>
                  <p className="mt-1 text-2xl font-bold tabular-nums text-brand">
                    {pct(data.sla.transferRequestRate)}
                  </p>
                </div>
                <div className="rounded-xl border border-border bg-surface-muted px-3 py-4 text-center">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">Reopen rate</p>
                  <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">
                    {pct(data.sla.reopenRate)}
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* Quality signals */}
          <section>
            <h2 className="text-[11px] font-bold uppercase tracking-[0.2em] text-zinc-600 dark:text-zinc-500">
              Quality &amp; signals
            </h2>
            <div className="mt-4 grid gap-6 lg:grid-cols-[1.7fr_1fr]">
              <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-[0_8px_28px_rgba(0,0,0,0.06)] dark:border-zinc-800/90 dark:bg-[#0a0a0a]">
                <MetricsBarChart
                  title="User satisfaction (CSAT star ratings)"
                  rows={satisfactionRows}
                  valueFormatter={(v) =>
                    v === 0 ? "0" : `${v} response${v === 1 ? "" : "s"}`
                  }
                />
              </section>
              <div className="grid gap-4">
                <MetricTile
                  label="Feedback responses"
                  value={String(data.quality.feedbackCount)}
                  accent
                />
                <MetricTile
                  label="Quality note"
                  value="CSAT = 1–5 stars"
                />
              </div>
            </div>
          </section>

          {filteredAgentClosers.length > 0 && !viewingPersonalRequestMetrics ? (
            <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-[0_8px_28px_rgba(0,0,0,0.06)] sm:p-7 dark:border-zinc-800/90 dark:bg-[#0a0a0a]">
              <h2 className="text-[11px] font-bold uppercase tracking-[0.2em] text-zinc-600 dark:text-zinc-500">
                Top closers in range
              </h2>
              <ul className="mt-4 space-y-2">
                {filteredAgentClosers.slice(0, 12).map((row) => (
                  <li
                    key={row.agentId}
                    className="flex items-center justify-between rounded-lg border border-zinc-200 bg-zinc-50/80 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900/50"
                  >
                    <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{row.name}</span>
                    <span className="text-sm font-bold tabular-nums text-orange-700 dark:text-orange-300">
                      {row.ticketsClosed} closed
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
            </>
          )}
        </div>

            </>
      )}
    </main>
  );
}

function CompanyValueLabel({
  label,
  value,
  className,
  valueClassName,
}: {
  label: string;
  value: string;
  className?: string;
  valueClassName?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5 text-left", className)}>
      <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-500">
        {label}
      </span>
      <span
        className={cn(
          "flex min-h-9 items-center rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-sm font-semibold text-zinc-900 dark:border-zinc-700/80 dark:bg-zinc-900/60 dark:text-zinc-100",
          valueClassName,
        )}
      >
        {value}
      </span>
    </div>
  );
}



function TaskMetricsPanel({
  checklistPillars,
  personnelTicketMetrics,
  personnelRfpAccountingMetrics,
  personnelRfpFinanceMetrics,
  personnelIrsCanvassMetrics,
  personnelFtrPreparedMetrics,
  personnelAcaSubmittedMetrics,
  personnelDelayPenalties,
  departmentSections,
  helpdeskTickets,
  userSupportTickets,
  loading,
  error,
  taskMetricsCadence,
  onTaskMetricsCadenceChange,
  dailyDate,
  onDailyDateChange,
  rangeFrom,
  rangeTo,
  onRangeFromChange,
  onRangeToChange,
  reportingTimeZone,
  companies,
  selectedCompany,
  onSelectedCompanyChange,
  lockCompanySelection,
  metricsViewMode,
  onMetricsViewModeChange,
  taskType,
  onTaskTypeChange,
  allowAllCompaniesInPersonnel,
  canExtendView = false,
  canManageDepartmentVisibility = false,
  onDepartmentVisibilityChanged,
  canImportDepartmentTasks = false,
  metricsSearchQ = "",
  selectedPersonnelDepartment = "",
  userEmail = "",
  patchMetricsUrl,
}: {
  checklistPillars: TaskChecklistPillarMetrics | null;
  personnelTicketMetrics: PersonnelTicketMetric[];
  personnelRfpAccountingMetrics: PersonnelTicketMetric[];
  personnelRfpFinanceMetrics: PersonnelTicketMetric[];
  personnelIrsCanvassMetrics: PersonnelTicketMetric[];
  personnelFtrPreparedMetrics: PersonnelTicketMetric[];
  personnelAcaSubmittedMetrics: PersonnelTicketMetric[];
  personnelDelayPenalties: PersonnelDelayPenaltyRow[];
  departmentSections: DepartmentMainMetric[];
  helpdeskTickets: TaskMetricsHelpdeskTickets | null;
  userSupportTickets: TaskMetricsUserSupportTickets | null;
  loading: boolean;
  error: string | null;
  taskMetricsCadence: TaskMetricsCadence;
  onTaskMetricsCadenceChange: (v: TaskMetricsCadence) => void;
  dailyDate: string;
  onDailyDateChange: (v: string) => void;
  rangeFrom: string;
  rangeTo: string;
  onRangeFromChange: (v: string) => void;
  onRangeToChange: (v: string) => void;
  reportingTimeZone: string;
  companies: Array<{ id: string; name: string }>;
  selectedCompany: string;
  onSelectedCompanyChange: (v: string) => void;
  lockCompanySelection: boolean;
  metricsViewMode: TaskMetricsViewMode;
  onMetricsViewModeChange: (mode: TaskMetricsViewMode) => void;
  taskType: TaskMetricsTaskTypeFilter;
  onTaskTypeChange: (v: TaskMetricsTaskTypeFilter) => void;
  allowAllCompaniesInPersonnel: boolean;
  canExtendView?: boolean;
  canManageDepartmentVisibility?: boolean;
  onDepartmentVisibilityChanged?: () => void;
  canImportDepartmentTasks?: boolean;
  metricsSearchQ?: string;
  selectedPersonnelDepartment?: string;
  userEmail?: string;
  patchMetricsUrl?: (patch: (params: URLSearchParams) => void) => void;
}) {
  const freq = taskMetricsCadence;
  const isMonthly = freq === "MONTHLY";

  const reportingPeriodLabel = formatTaskMetricsPeriodLabel(freq, {
    dailyDate,
    rangeFrom,
    rangeTo,
  });
  const showCompanyTaskMetrics = metricsViewMode === "company";
  const selectedCompanyName =
    selectedCompany === ""
      ? null
      : companies.find((company) => company.id === selectedCompany)?.name ?? null;
  const lockedCompanyName =
    companies.find((company) => company.id === selectedCompany)?.name ??
    companies[0]?.name ??
    "No assigned company";
  const showPersonnelCompanyFilter = metricsViewMode === "personnel";
  const showCompanyScopeFilter = metricsViewMode === "company";

  function selectViewMode(optionId: TaskMetricsViewMode) {
    onMetricsViewModeChange(optionId);
    patchMetricsUrl?.((params) => {
      params.set("taskView", optionId);
      if (optionId !== "personnel") params.delete("department");
      if (lockCompanySelection && companies[0]?.id) {
        params.set("companyId", companies[0].id);
      } else if (!params.get("companyId") || params.get("companyId") === "ALL") {
        // Unscoped: leave company unselected (all companies) — no default pick.
        params.delete("companyId");
      }
    });
    if (lockCompanySelection && companies[0]?.id) {
      onSelectedCompanyChange(companies[0].id);
    } else if (!selectedCompany) {
      onSelectedCompanyChange("");
    }
  }

  // Company-scoped Admin: never leave company selection empty (Personnel tab used to clear it).
  useEffect(() => {
    if (!lockCompanySelection) return;
    if (selectedCompany && companies.some((c) => c.id === selectedCompany)) return;
    if (companies[0]?.id) onSelectedCompanyChange(companies[0].id);
  }, [lockCompanySelection, selectedCompany, companies, onSelectedCompanyChange]);

  // Personnel view reads the stored KPI from mergedatabase-demo (merged_users +
  // merged_user_efficiency_breakdowns) so stored values can be verified.
  // Primary owns live task updates; sync dumps overall KPI here.
  const [mergedPersonnelRows, setMergedPersonnelRows] = useState<MergedPersonnelEfficiencyRow[]>([]);
  const [mergedPersonnelLoading, setMergedPersonnelLoading] = useState(false);
  const [mergedPersonnelError, setMergedPersonnelError] = useState<string | null>(null);
  const [orgChartSections, setOrgChartSections] = useState<OrgChartSectionOption[]>([]);
  const [orgChartMembersBySection, setOrgChartMembersBySection] = useState<Record<string, string[]>>(
    {},
  );
  const mergedPeriod = taskMetricsMergedPeriod(freq, { dailyDate, rangeFrom, rangeTo });

  const personnelDepartmentOptions = useMemo(
    // Org chart departments are shared across companies — do not hide them when a
    // company chip is set (company scopes people; department scopes org-chart members).
    () => buildOrgChartDepartmentFilterOptions(orgChartSections),
    [orgChartSections],
  );

  const selectedOrgChartMemberIds = useMemo(() => {
    if (!selectedPersonnelDepartment) return null;
    return mergedSourceUserIdsForOrgChartSectionTree(
      selectedPersonnelDepartment,
      orgChartSections,
      orgChartMembersBySection,
    );
  }, [selectedPersonnelDepartment, orgChartSections, orgChartMembersBySection]);

  const selectedOrgChartDepartmentLabel = useMemo(() => {
    if (!selectedPersonnelDepartment) return null;
    return (
      personnelDepartmentOptions.find((o) => o.value === selectedPersonnelDepartment)?.label ??
      orgChartSections.find((s) => s.id === selectedPersonnelDepartment)?.name ??
      null
    );
  }, [selectedPersonnelDepartment, personnelDepartmentOptions, orgChartSections]);

  const taskMetricsFilterFields = useMemo((): MetricsFilterFieldDef[] => {
    const fields: MetricsFilterFieldDef[] = [];
    if ((showCompanyScopeFilter || showPersonnelCompanyFilter) && !lockCompanySelection) {
      fields.push({
        id: "company",
        type: "Company",
        param: "companyId",
        visible: true,
        value: selectedCompany || "ALL",
        emptyValue: "ALL",
        options: buildCompanyFieldOptions(companies, { includeAll: false }),
      });
    }
    if (showPersonnelCompanyFilter) {
      fields.push({
        id: "department",
        type: "Department",
        param: "department",
        visible: true,
        value: selectedPersonnelDepartment || "ALL",
        emptyValue: "ALL",
        options: personnelDepartmentOptions,
      });
    }
    if (showCompanyScopeFilter) {
      fields.push({
        id: "taskType",
        type: "Task",
        param: "taskType",
        visible: true,
        value: taskType,
        emptyValue: "ALL",
        options: buildTaskTypeFieldOptions(),
      });
    }
    fields.push({
      id: "cadence",
      type: "Cadence",
      param: "cadence",
      visible: true,
      value: freq,
      emptyValue: "MONTHLY",
      options: buildCadenceFieldOptions(),
    });
    return fields;
  }, [
    showCompanyScopeFilter,
    showPersonnelCompanyFilter,
    lockCompanySelection,
    selectedCompany,
    companies,
    personnelDepartmentOptions,
    selectedPersonnelDepartment,
    taskType,
    freq,
  ]);

  useEffect(() => {
    if (!selectedPersonnelDepartment) return;
    if (personnelDepartmentOptions.some((o) => o.value === selectedPersonnelDepartment)) return;
    patchMetricsUrl?.((params) => {
      params.delete("department");
    });
  }, [selectedPersonnelDepartment, personnelDepartmentOptions, patchMetricsUrl]);

  useEffect(() => {
    if (metricsViewMode !== "personnel") return;
    let cancelled = false;
    async function loadOrgChartDepartments() {
      try {
        const res = await fetch("/api/org-chart-sections?scope=viewer", { cache: "no-store" });
        if (!res.ok) {
          if (!cancelled) {
            setOrgChartSections([]);
            setOrgChartMembersBySection({});
          }
          return;
        }
        const json = (await res.json()) as {
          sections?: OrgChartSectionOption[];
          membersBySection?: Record<string, string[]>;
        };
        if (cancelled) return;
        setOrgChartSections(json.sections ?? []);
        setOrgChartMembersBySection(json.membersBySection ?? {});
      } catch {
        if (!cancelled) {
          setOrgChartSections([]);
          setOrgChartMembersBySection({});
        }
      }
    }
    void loadOrgChartDepartments();
    return () => {
      cancelled = true;
    };
  }, [metricsViewMode]);

  useEffect(() => {
    if (metricsViewMode !== "personnel") return;
    let cancelled = false;
    async function loadMergedPersonnel() {
      setMergedPersonnelLoading(true);
      setMergedPersonnelError(null);
      try {
        const qs = new URLSearchParams({
          mode: "personnel",
          periodKey: mergedPeriod.periodKey,
          frequency: mergedPeriod.frequency,
        });
        const res = await fetch(`/api/admin/efficiency?${qs.toString()}`, { cache: "no-store" });
        if (!res.ok) {
          if (!cancelled) {
            setMergedPersonnelRows([]);
            setMergedPersonnelError("Could not load merged KPI rows for this period.");
          }
          return;
        }
        const json = (await res.json()) as { rows?: MergedPersonnelEfficiencyRow[] };
        if (!cancelled) setMergedPersonnelRows(json.rows ?? []);
      } catch {
        if (!cancelled) {
          setMergedPersonnelRows([]);
          setMergedPersonnelError("Could not load merged KPI rows for this period.");
        }
      } finally {
        if (!cancelled) setMergedPersonnelLoading(false);
      }
    }
    void loadMergedPersonnel();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metricsViewMode, mergedPeriod.periodKey, mergedPeriod.frequency]);

  const mergedPersonnelCards = useMemo<PersonnelCombinedMetricCard[]>(() => {
    const companyFilter = selectedCompanyName
      ? (resolveRosterCompanyName(selectedCompanyName) ?? selectedCompanyName).trim().toLowerCase()
      : null;
    return buildPersonnelInsightCards({
      mergedRows: mergedPersonnelRows,
      selectedCompanyName: companyFilter,
      selectedOrgChartMemberIds,
      personnelDelayPenalties,
      personnelTicketMetrics,
      personnelRfpAccountingMetrics,
      personnelRfpFinanceMetrics,
      personnelIrsCanvassMetrics,
      personnelFtrPreparedMetrics,
      personnelAcaSubmittedMetrics,
      liveTicketsAuthoritative: !loading && !error,
    });
  }, [
    mergedPersonnelRows,
    selectedCompanyName,
    selectedOrgChartMemberIds,
    personnelDelayPenalties,
    personnelTicketMetrics,
    personnelRfpAccountingMetrics,
    personnelRfpFinanceMetrics,
    personnelIrsCanvassMetrics,
    personnelFtrPreparedMetrics,
    personnelAcaSubmittedMetrics,
    loading,
    error,
  ]);

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-[0_12px_36px_rgba(0,0,0,0.06)] sm:p-7 dark:border-zinc-800/90 dark:bg-[#0a0a0a] dark:shadow-[0_16px_48px_rgba(0,0,0,0.35)]">
      <div className="space-y-4">
        <MetricsFilterBar
          initialQuery={metricsSearchQ}
          placeholder={
            metricsViewMode === "personnel"
              ? "Search personnel by name…"
              : "Search task metrics…"
          }
          fields={taskMetricsFilterFields}
          savedFilterStorageKey={
            userEmail ? `saved-task-metrics-filters:${userEmail}:v1` : undefined
          }
          preserveParams={["tab", "taskView", "period", "department"]}
          extraCaptureParams={["period", "taskView", "department"]}
        />
        {lockCompanySelection ? (
          <CompanyValueLabel label="Company" value={lockedCompanyName} className="max-w-xs" />
        ) : null}
      </div>
      <div className="mt-5 flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <h3 className="text-[11px] font-bold uppercase tracking-[0.22em] text-zinc-600 dark:text-zinc-500">
            Task metrics
          </h3>
          <div className="mt-3 inline-flex rounded-xl border border-zinc-200 bg-zinc-100/80 p-1 dark:border-zinc-700 dark:bg-zinc-900/60">
            {(
              [
                { id: "company", label: "Company" },
                { id: "personnel", label: "Personnel" },
                { id: "departments", label: "Departments" },
              ] as const
            ).map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => selectViewMode(option.id)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-semibold transition",
                  metricsViewMode === option.id
                    ? "bg-orange-600 text-white shadow-sm"
                    : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex w-full shrink-0 flex-col gap-4 lg:w-auto lg:items-end">
          <div
            className={cn(
              "w-full rounded-xl border border-zinc-200 bg-zinc-50/90 p-2.5 dark:border-zinc-700/80 dark:bg-zinc-900/50",
              "sm:max-w-[12rem]",
            )}
          >
            <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-500">
              {isMonthly ? "Reporting month" : "Reporting year"}
            </span>
            {isMonthly ? (
              <label className="mt-2 flex flex-col text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-600 dark:text-zinc-500">
                Month
                <DatePickerField
                  granularity="month"
                  value={rangeFrom}
                  onChange={(e) => {
                    const ym = e.target.value;
                    onRangeFromChange(ym);
                    onRangeToChange(ym);
                    patchMetricsUrl?.((params) => {
                      params.set("period", ym);
                    });
                  }}
                  wrapperClassName="mt-1.5"
                  inputClassName="min-w-[10.5rem]"
                />
              </label>
            ) : (
              <label className="mt-2 flex flex-col text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-600 dark:text-zinc-500">
                Year
                <DatePickerField
                  granularity="year"
                  value={rangeFrom}
                  onChange={(e) => {
                    const y = e.target.value;
                    onRangeFromChange(y);
                    onRangeToChange(y);
                    patchMetricsUrl?.((params) => {
                      params.set("period", y);
                    });
                  }}
                  wrapperClassName="mt-1.5"
                  inputClassName="min-w-[10.5rem]"
                />
              </label>
            )}
            {loading ? (
              <p className="mt-3 text-xs font-semibold text-orange-700 dark:text-orange-300">Updating metrics…</p>
            ) : null}
          </div>
        </div>
      </div>
      {error ? (
        <p className="mt-4 rounded-xl border border-rose-400/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-900 dark:border-rose-500/30 dark:text-rose-100">
          {error}
        </p>
      ) : null}
      <div className={cn("mt-6", loading && "pointer-events-none opacity-60")}>
        {metricsViewMode === "company" ? (
          taskType === "ALL" ? (
            <div className="space-y-10">
              {TASK_METRICS_ALL_TYPE_SECTIONS.map((section) => {
                const isRequests = section.value === "requests";
                const preferPillarOrder = preferPillarOrderForTaskType(section.value);
                return (
                  <div key={section.value} className="space-y-3">
                    <h3 className="text-[11px] font-bold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
                      {section.label}
                    </h3>
                    <TaskPillarMetricsGrid
                      checklistPillars={checklistPillars}
                      metricsCadence={freq}
                      reportingPeriodLabel={reportingPeriodLabel}
                      helpdeskTickets={helpdeskTickets}
                      userSupportTickets={userSupportTickets}
                      includeChecklistPillars={!isRequests}
                      includeTicketPillars={isRequests}
                      preferPillarOrder={preferPillarOrder}
                      showEmptyPillars={!isRequests}
                      canExtendView={canExtendView}
                      taskType={section.value}
                      companyId={selectedCompany || undefined}
                      reportingTimeZone={reportingTimeZone}
                    />
                  </div>
                );
              })}
            </div>
          ) : (
            <TaskPillarMetricsGrid
              checklistPillars={checklistPillars}
              metricsCadence={freq}
              reportingPeriodLabel={reportingPeriodLabel}
              helpdeskTickets={helpdeskTickets}
              userSupportTickets={userSupportTickets}
              includeChecklistPillars={showCompanyTaskMetrics && taskType !== "requests"}
              includeTicketPillars={taskType === "requests"}
              preferPillarOrder={preferPillarOrderForTaskType(taskType)}
              showEmptyPillars={
                taskType === "task" || taskType === "field" || taskType === "project"
              }
              canExtendView={canExtendView}
              taskType={taskType}
              companyId={selectedCompany || undefined}
              reportingTimeZone={reportingTimeZone}
            />
          )
        ) : metricsViewMode === "departments" ? (
          <DepartmentTaskMetricsGrid
            sections={departmentSections}
            reportingPeriodLabel={reportingPeriodLabel}
            loading={loading}
            canManageVisibility={canManageDepartmentVisibility}
            onVisibilityChanged={onDepartmentVisibilityChanged}
            canImport={canImportDepartmentTasks}
            onImportComplete={onDepartmentVisibilityChanged}
          />
        ) : (
          <>
            {mergedPersonnelError ? (
              <p className="rounded-xl border border-rose-400/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-900 dark:border-rose-500/30 dark:text-rose-100">
                {mergedPersonnelError}
              </p>
            ) : null}
            <PersonnelTaskMetricsGrid
              rows={mergedPersonnelCards}
              reportingPeriodLabel={reportingPeriodLabel}
              companyLabel={selectedCompanyName}
              departmentLabel={selectedOrgChartDepartmentLabel}
              loading={mergedPersonnelLoading}
              searchQuery={metricsSearchQ}
            />
          </>
        )}
      </div>
    </section>
  );
}

function preferPillarOrderForTaskType(taskType: TaskMetricsTaskType): string[] | null {
  if (taskType === "requests") return null;
  if (taskType === "task") return [...TASK_FREQUENCY_DONUT_KEYS];
  if (taskType === "field") return [FIELD_ASSIGNMENT_DONUT_KEY];
  return [PROJECTS_DONUT_KEY];
}

function MetricTile({
  label,
  value,
  accent,
  className,
}: {
  label: string;
  value: string;
  accent?: boolean;
  className?: string;
}) {
  const compactValue = value.length > 10;
  return (
    <article
      className={cn(
        "rounded-xl border p-3 shadow-sm transition sm:rounded-2xl sm:p-4",
        accent
          ? "border-orange-400/40 bg-gradient-to-br from-orange-500/15 to-zinc-50 dark:border-orange-500/35 dark:from-orange-500/10 dark:to-zinc-950"
          : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950/60",
        className,
      )}
    >
      <p className="text-[9px] font-bold uppercase leading-tight tracking-[0.12em] text-zinc-600 sm:text-[10px] sm:tracking-[0.14em] dark:text-zinc-500">
        {label}
      </p>
      <p
        className={cn(
          "mt-1.5 font-bold tabular-nums leading-tight sm:mt-2",
          compactValue ? "text-lg sm:text-xl" : "text-xl sm:text-2xl",
          accent ? "text-orange-800 dark:text-orange-300" : "text-zinc-900 dark:text-white",
        )}
      >
        {value}
      </p>
    </article>
  );
}
