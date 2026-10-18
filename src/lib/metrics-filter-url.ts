import type { TaskMetricsCadence } from "@/modules/tasks/task-metrics-range";
import {
  TASK_METRICS_TASK_TYPE_OPTIONS,
  parseTaskMetricsTaskTypeFilter,
  type TaskMetricsTaskTypeFilter,
} from "@/modules/tasks/task-metrics-task-type";

export type TaskMetricsViewMode = "company" | "personnel" | "departments";

export function parseTaskMetricsViewMode(raw: string | null): TaskMetricsViewMode {
  if (raw === "personnel" || raw === "departments") return raw;
  return "company";
}

export function parseMetricsCadence(raw: string | null): TaskMetricsCadence {
  return raw === "YEARLY" ? "YEARLY" : "MONTHLY";
}

export function metricsUrlPatch(
  router: { replace: (href: string, opts?: { scroll?: boolean }) => void },
  patch: (params: URLSearchParams) => void,
  preserveParams: string[] = ["tab"],
) {
  const params = new URLSearchParams(window.location.search);
  const preserved = new Map<string, string>();
  for (const key of preserveParams) {
    const value = params.get(key);
    if (value != null) preserved.set(key, value);
  }
  patch(params);
  for (const [key, value] of preserved) {
    if (!params.has(key)) params.set(key, value);
  }
  const qs = params.toString();
  router.replace(`${window.location.pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
}

export function buildTaskTypeFieldOptions() {
  return TASK_METRICS_TASK_TYPE_OPTIONS.map((o) => ({ value: o.value, label: o.label }));
}

export function buildCadenceFieldOptions() {
  return [
    { value: "MONTHLY", label: "Monthly" },
    { value: "YEARLY", label: "Yearly" },
  ];
}

export function buildCompanyFieldOptions(
  companies: Array<{ id: string; name: string }>,
  opts?: { includeAll?: boolean; allLabel?: string },
) {
  const list: Array<{ value: string; label: string }> = [];
  if (opts?.includeAll !== false) {
    list.push({ value: "ALL", label: opts?.allLabel ?? "All companies" });
  }
  for (const company of companies) {
    list.push({ value: company.id, label: company.name });
  }
  return list;
}

export function resolveTaskMetricsTaskTypeFromUrl(raw: string | null): TaskMetricsTaskTypeFilter {
  return parseTaskMetricsTaskTypeFilter(raw);
}
