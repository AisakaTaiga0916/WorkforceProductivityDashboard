/**
 * Workforce KPI lens — shared, client-safe types and pure aggregation helpers.
 *
 * Metric contract (must match the server loader and the detail API):
 * - Task KPI % = sum(done checklist items) / sum(total checklist items)
 *   for recorded KPI periods overlapping the selected date range.
 *   One checklist item = one unit of weight (not one task/card).
 *   Project / timeline KPI rows are excluded; Work owns the records.
 * - Request KPI % = requests assigned to the person and created in the range
 *   that are now For confirmation / Resolved / Closed, ÷ all of them.
 *   Payment, requisition, and fund-transfer requests are excluded (approval
 *   flows, not handling work).
 * - Overall KPI % = equal-weight average of the parts the person has
 *   (tasks and/or requests). A part with no data is left out, not counted as 0.
 * - No eligible data => null ("—"), never 0%.
 */

export const WORKFORCE_KPI_PERIOD_PRESETS = [
  { id: "month", label: "This month" },
  { id: "quarter", label: "This quarter" },
  { id: "year", label: "This year" },
  { id: "custom", label: "Custom" },
] as const;

export type WorkforceKpiPeriodPreset =
  (typeof WORKFORCE_KPI_PERIOD_PRESETS)[number]["id"];

export function isWorkforceKpiPeriodPreset(
  value: string | null | undefined,
): value is WorkforceKpiPeriodPreset {
  return WORKFORCE_KPI_PERIOD_PRESETS.some((preset) => preset.id === value);
}

export type PersonnelKpiRange = {
  preset: WorkforceKpiPeriodPreset;
  fromYmd: string;
  toYmd: string;
  label: string;
  timeZone: string;
};

export type PersonnelKpiTaskStatus =
  | "DONE"
  | "DELAYED"
  | "CURRENT"
  | "PENDING_VERIFICATION";

export type PersonnelKpiItemRow = {
  kpiId: string;
  periodKey: string;
  frequency?: string | null;
  total: number;
  done: number;
};

export type PersonnelKpiTotals = {
  kpiPercent: number | null;
  totalItems: number;
  doneItems: number;
  kpiCount: number;
  periodCount: number;
};

export type PersonnelKpiTaskCounts = {
  taskCount: number;
  doneTasks: number;
  missedTasks: number;
  openTasks: number;
};

export type PersonnelRequestKpi = {
  /** Requests assigned to the person and created in the range. */
  assigned: number;
  /** Of those, now For confirmation / Resolved / Closed. */
  resolved: number;
  /** Of those, still open. */
  open: number;
  /** Open ones past the Request Board 24h lane limit right now. */
  overdue: number;
  /** resolved ÷ assigned; null when nothing was assigned. */
  resolutionPercent: number | null;
};

export const EMPTY_PERSONNEL_REQUEST_KPI: PersonnelRequestKpi = {
  assigned: 0,
  resolved: 0,
  open: 0,
  overdue: 0,
  resolutionPercent: null,
};

export type PersonnelKpiBlendPart = {
  key: "tasks" | "requests";
  label: string;
  percent: number;
  /** Share of the overall KPI (equal split across the parts present). */
  weightPercent: number;
  /** percent × weight; the parts add up to the overall KPI. */
  points: number;
};

export type PersonnelKpiSummary = PersonnelKpiTotals &
  PersonnelKpiTaskCounts & {
    sourceUserId: string;
    agentId: string | null;
    name: string;
    email: string;
    teamName: string;
    staffRole: string;
    staffAssignmentColor: string | null;
    requests: PersonnelRequestKpi;
    /** Blend of task KPI (`kpiPercent`) and request resolution; null when neither exists. */
    overallPercent: number | null;
  };

export type PersonnelKpiTaskRow = {
  kpiId: string;
  title: string;
  pillar: string;
  frequency: string;
  status: PersonnelKpiTaskStatus;
  kpiPercent: number | null;
  totalItems: number;
  doneItems: number;
  periodCount: number;
  lastPeriodKey: string;
};

export type PersonnelKpiBreakdownRow = {
  key: string;
  label: string;
  kpiPercent: number | null;
  totalItems: number;
  doneItems: number;
  kpiCount: number;
  periodCount: number;
};

export type PersonnelKpiDetail = {
  range: PersonnelKpiRange;
  person: PersonnelKpiSummary;
  tasks: PersonnelKpiTaskRow[];
  frequencies: PersonnelKpiBreakdownRow[];
  periods: PersonnelKpiBreakdownRow[];
};

export type PersonnelKpiOverview = {
  range: PersonnelKpiRange;
  people: PersonnelKpiSummary[];
  totals: PersonnelKpiTotals;
  tasks: {
    count: number;
    done: number;
    missed: number;
    open: number;
  };
  peopleWithData: number;
};

const FREQUENCY_LABELS: Record<string, string> = {
  DAILY: "Daily",
  WEEKLY: "Weekly",
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  SEMI_ANNUAL: "Semi-annual",
  YEARLY: "Yearly",
};

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

export function personnelKpiFrequencyLabel(frequency: string): string {
  return FREQUENCY_LABELS[frequency.trim().toUpperCase()] ?? "One-off";
}

export function personnelKpiStatusLabel(status: PersonnelKpiTaskStatus): string {
  switch (status) {
    case "DONE":
      return "Done";
    case "DELAYED":
      return "Delayed";
    case "PENDING_VERIFICATION":
      return "For verification";
    default:
      return "Current";
  }
}

function validContribution(row: PersonnelKpiItemRow): boolean {
  return (
    Number.isFinite(row.total) &&
    row.total > 0 &&
    Number.isFinite(row.done) &&
    row.done >= 0
  );
}

/** Weighted total across checklist items, with unique KPI + period counts. */
export function aggregatePersonnelKpi(
  rows: readonly PersonnelKpiItemRow[],
): PersonnelKpiTotals {
  let totalItems = 0;
  let doneItems = 0;
  const kpiIds = new Set<string>();
  const periodKeys = new Set<string>();

  for (const row of rows) {
    if (!validContribution(row)) continue;
    const total = Math.round(row.total);
    const done = Math.min(total, Math.round(row.done));
    totalItems += total;
    doneItems += done;
    kpiIds.add(row.kpiId);
    periodKeys.add(`${row.kpiId}:${row.periodKey}`);
  }

  return {
    kpiPercent:
      totalItems > 0 ? Math.round((doneItems / totalItems) * 100) : null,
    totalItems,
    doneItems,
    kpiCount: kpiIds.size,
    periodCount: periodKeys.size,
  };
}

export function personnelRequestKpi(counts: {
  assigned: number;
  resolved: number;
  overdue: number;
}): PersonnelRequestKpi {
  const assigned = Math.max(0, Math.round(counts.assigned));
  const resolved = Math.min(assigned, Math.max(0, Math.round(counts.resolved)));
  const open = assigned - resolved;
  return {
    assigned,
    resolved,
    open,
    overdue: Math.min(open, Math.max(0, Math.round(counts.overdue))),
    resolutionPercent: assigned > 0 ? Math.round((resolved / assigned) * 100) : null,
  };
}

/** Overall KPI: equal-weight average of the parts the person has data for. */
export function blendPersonnelKpi(
  taskPercent: number | null,
  requestPercent: number | null,
): { overallPercent: number | null; parts: PersonnelKpiBlendPart[] } {
  const present: Array<{ key: PersonnelKpiBlendPart["key"]; label: string; percent: number }> = [];
  if (taskPercent != null) present.push({ key: "tasks", label: "Tasks", percent: taskPercent });
  if (requestPercent != null) {
    present.push({ key: "requests", label: "Requests", percent: requestPercent });
  }
  if (present.length === 0) return { overallPercent: null, parts: [] };
  const weightPercent = 100 / present.length;
  const parts = present.map((part) => ({
    ...part,
    weightPercent,
    points: (part.percent * weightPercent) / 100,
  }));
  return {
    overallPercent: Math.round(parts.reduce((sum, part) => sum + part.points, 0)),
    parts,
  };
}

export function personnelKpiTaskCounts(
  statuses: readonly PersonnelKpiTaskStatus[],
): PersonnelKpiTaskCounts {
  let doneTasks = 0;
  let missedTasks = 0;
  let openTasks = 0;
  for (const status of statuses) {
    if (status === "DONE") doneTasks += 1;
    else if (status === "DELAYED") missedTasks += 1;
    else openTasks += 1;
  }
  return {
    taskCount: statuses.length,
    doneTasks,
    missedTasks,
    openTasks,
  };
}

function startDateParts(periodKey: string): {
  prefix: string;
  year: number;
  month: number;
  day: number;
} | null {
  const [prefix = "", , value = ""] = periodKey.split(":");
  const match = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3] ?? "1");
  if (!Number.isFinite(year) || month < 1 || month > 12) return null;
  return { prefix: prefix.toUpperCase(), year, month, day };
}

/** Human label for a KPI period key, e.g. "Oct 26, 2026" or "Week of Oct 20". */
export function personnelKpiPeriodLabel(periodKey: string): string {
  const parts = startDateParts(periodKey);
  if (!parts) return periodKey;
  const month = MONTHS[parts.month - 1]!;
  switch (parts.prefix) {
    case "D":
      return `${month} ${parts.day}, ${parts.year}`;
    case "W":
      return `Week of ${month} ${parts.day}`;
    case "M":
      return `${month} ${parts.year}`;
    case "Q":
      return `Quarter from ${month} ${parts.year}`;
    case "S":
      return `Half-year from ${month} ${parts.year}`;
    case "Y":
      return String(parts.year);
    default:
      return periodKey;
  }
}

function periodSortValue(periodKey: string): number {
  const parts = startDateParts(periodKey);
  if (!parts) return 0;
  return Date.UTC(parts.year, parts.month - 1, parts.day);
}

/** Per-frequency weighted totals for the detail drawer. */
export function buildPersonnelKpiFrequencyBreakdown(
  rows: readonly PersonnelKpiItemRow[],
): PersonnelKpiBreakdownRow[] {
  const groups = new Map<string, PersonnelKpiItemRow[]>();
  for (const row of rows) {
    if (!validContribution(row)) continue;
    const frequency = row.frequency?.trim().toUpperCase() || "ONE_OFF";
    const list = groups.get(frequency) ?? [];
    list.push(row);
    groups.set(frequency, list);
  }
  return [...groups.entries()]
    .map(([frequency, group]) => ({
      key: frequency,
      label: personnelKpiFrequencyLabel(frequency),
      ...aggregatePersonnelKpi(group),
    }))
    .sort((a, b) => b.totalItems - a.totalItems || a.label.localeCompare(b.label));
}

/** Most recent recorded periods first, for the detail drawer. */
export function buildPersonnelKpiPeriodBreakdown(
  rows: readonly PersonnelKpiItemRow[],
  limit = 8,
): PersonnelKpiBreakdownRow[] {
  const groups = new Map<string, PersonnelKpiItemRow[]>();
  for (const row of rows) {
    if (!validContribution(row)) continue;
    const list = groups.get(row.periodKey) ?? [];
    list.push(row);
    groups.set(row.periodKey, list);
  }
  return [...groups.entries()]
    .sort((a, b) => periodSortValue(b[0]) - periodSortValue(a[0]))
    .slice(0, Math.max(0, limit))
    .map(([periodKey, group]) => ({
      key: periodKey,
      label: personnelKpiPeriodLabel(periodKey),
      ...aggregatePersonnelKpi(group),
    }));
}

export type PersonnelKpiContribution = PersonnelKpiTaskRow & {
  /** Share of all checklist items in the range (0–100). */
  weightPercent: number;
  /** Points this task adds to the weighted average; all tasks sum to it. */
  earnedPoints: number;
  /** Points lost to incomplete items in this task. */
  lostPoints: number;
};

/**
 * Split the weighted average into per-task parts. With T = all items in range:
 * weight = items / T, earned = done / T × 100, lost = (items − done) / T × 100.
 * Σ earned is the weighted average (before rounding); earned + lost = weight.
 */
export function buildPersonnelKpiContributions(
  tasks: readonly PersonnelKpiTaskRow[],
): PersonnelKpiContribution[] {
  const totalItems = tasks.reduce((sum, task) => sum + Math.max(0, task.totalItems), 0);
  if (totalItems <= 0) return [];
  return tasks
    .filter((task) => task.totalItems > 0)
    .map((task) => {
      const done = Math.min(task.totalItems, Math.max(0, task.doneItems));
      return {
        ...task,
        weightPercent: (task.totalItems / totalItems) * 100,
        earnedPoints: (done / totalItems) * 100,
        lostPoints: ((task.totalItems - done) / totalItems) * 100,
      };
    });
}

/** Stable card order: people with an overall KPI % first, then name. */
export function sortPersonnelKpiSummaries(
  rows: readonly PersonnelKpiSummary[],
): PersonnelKpiSummary[] {
  return [...rows].sort((a, b) => {
    const ap = a.overallPercent;
    const bp = b.overallPercent;
    if (ap == null && bp == null) return a.name.localeCompare(b.name);
    if (ap == null) return 1;
    if (bp == null) return -1;
    return bp - ap || a.name.localeCompare(b.name);
  });
}
