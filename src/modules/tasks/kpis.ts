import type { Prisma, TicketStatus } from "@prisma/client/primary";
import { DateTime } from "luxon";
import { ACTIVE_REQUEST_STATUSES, OPEN_PIPELINE_STATUSES } from "@/modules/requests/active-request-statuses";
import { loadRfpRolePersonnelMetrics } from "@/modules/requests/rfp-role-kpis";
import {
  loadFtrPreparedPersonnelMetrics,
  loadIrsCanvassPersonnelMetrics,
} from "@/modules/requests/irs-ftr-role-kpis";
import {
  computeTaskChecklistPillarMetrics,
  enumerateYmdDaysInRange,
  kpiMaintenanceWhereForTaskMetrics,
  snapshotTimeZoneForTaskMetrics,
  type TaskChecklistPillarMetrics,
} from "@/modules/tasks/kpi-period-snapshots";
import { normalizeTimeZone, type KpiFrequencyCode } from "@/modules/tasks/kpi-recurrence";
import {
  mergePenaltyDeductionMaps,
  penaltyDeductionsForKpi,
} from "@/modules/tasks/task-delay-penalty";
import type { PersonnelDelayPenaltyRow } from "@/modules/tasks/task-personnel-metrics";
import type { TaskMetricsTaskTypeFilter } from "@/modules/tasks/task-metrics-task-type";
import {
  combineHelpdeskCountsByBlend,
  loadHelpdeskCsvTaskMetricCounts,
  resolveHelpdeskMetricBlend,
  type HelpdeskTaskMetricCounts,
} from "@/modules/requests/helpdesk-csv";
import { loadAgentIdsForCompanyTeam } from "@/modules/platform/scope/staff-company-scope";
import { prisma } from "@/modules/platform/db/prisma";

export type {
  TaskChecklistPillarMetrics,
  TaskChecklistPillarMetric,
  TaskChecklistIncludedTask,
  TaskChecklistIncludedPhase,
  TaskChecklistIncludedTaskSegment,
} from "@/modules/tasks/kpi-period-snapshots";

export type KpiRange = { from: Date; to: Date };

function utcStartOfCalendarDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}

function utcEndOfCalendarDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
}

/** Parse `YYYY-MM-DD` query params as inclusive UTC days (end-of-day for `to`, not midnight). */
export function parseKpiRangeFromQuery(fromParam: string | null, toParam: string | null): KpiRange {
  const now = new Date();
  const defaultTo = utcEndOfCalendarDay(now);
  const fromAnchor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  fromAnchor.setUTCDate(fromAnchor.getUTCDate() - 30);
  const defaultFrom = utcStartOfCalendarDay(fromAnchor);

  const ymd = /^\d{4}-\d{2}-\d{2}$/;
  let from =
    fromParam && ymd.test(fromParam.trim())
      ? utcStartOfCalendarDay(new Date(`${fromParam.trim()}T12:00:00.000Z`))
      : defaultFrom;
  let to =
    toParam && ymd.test(toParam.trim())
      ? utcEndOfCalendarDay(new Date(`${toParam.trim()}T12:00:00.000Z`))
      : defaultTo;

  if (from.getTime() > to.getTime()) {
    const t = from;
    from = to;
    to = t;
  }
  return { from, to };
}
export type KpiScope = {
  assignedAgentId?: string;
  assignedAgentIds?: string[];
  teamId?: string;
  teamIds?: string[];
};

/** Matches Insights → Task metrics cadence (not task recurrence frequency). */
export type HelpdeskTaskCadence = "MONTHLY" | "YEARLY";

export function parseHelpdeskCadence(param: string | null): HelpdeskTaskCadence {
  const u = param?.trim().toUpperCase();
  if (u === "YEARLY" || u === "YEAR" || u === "ANNUAL") return "YEARLY";
  return "MONTHLY";
}

export type TaskMetricsHelpdeskTickets = {
  cadence: HelpdeskTaskCadence;
  /** Numerator: closed in reporting window */
  closedCount: number;
  denominator: number;
  /** @deprecated Prefer {@link TaskMetricsHelpdeskTickets.percent}. */
  ratio: number | null;
  /** Headline %: (closed ÷ (open + closed in range)) × 100, capped at 100 — see {@link helpdeskSupportPercent}. */
  percent: number | null;
  /** Current non-closed tickets (scoped backlog) */
  openBacklog: number;
  /** Non-closed tickets active in the reporting window (denominator) */
  openTicketsInPeriod: number;
  /** Tickets created in reporting range */
  requestsInRange: number;
  /** Inclusive reporting window from the date picker (YYYY-MM-DD). */
  rangeFromYmd: string;
  rangeToYmd: string;
};

/**
 * Request Support headline: `(closed in range ÷ (open in range + closed in range)) × 100`, capped at 100%.
 * (Internal pillar key remains HELPDESK SUPPORT.)
 */
export function helpdeskSupportPercent(closedInRange: number, openInRange: number): number | null {
  const total = openInRange + closedInRange;
  if (total <= 0) return null;
  const raw = (closedInRange / total) * 100;
  return Number(Math.min(100, raw).toFixed(1));
}

/** Task metrics → USER SUPPORT pillar (average star rating in Insights date range). */
export type TaskMetricsUserSupportTickets = {
  averageRating: number | null;
  ratedTickets: number;
  totalTickets: number;
  unratedTickets: number;
  starCounts: CsatStarDistributionRow[];
};

const CSAT_STAR_LABELS: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: "Very Poor",
  2: "Poor",
  3: "Neutral",
  4: "Good",
  5: "Very Good",
};

export type CsatStarDistributionRow = {
  star: 1 | 2 | 3 | 4 | 5;
  label: string;
  count: number;
};

function buildCsatStarDistribution(
  rows: { csat: number; _count: number }[],
): CsatStarDistributionRow[] {
  const counts = new Map<number, number>([
    [1, 0],
    [2, 0],
    [3, 0],
    [4, 0],
    [5, 0],
  ]);
  for (const r of rows) {
    if (r.csat >= 1 && r.csat <= 5) counts.set(r.csat, r._count);
  }
  return ([1, 2, 3, 4, 5] as const).map((star) => ({
    star,
    label: CSAT_STAR_LABELS[star],
    count: counts.get(star) ?? 0,
  }));
}

function summarizeUserSupportRatings(args: {
  totalTickets: number;
  averageRating: number | null;
  starRows: { csat: number; _count: number }[];
}): TaskMetricsUserSupportTickets {
  const starCounts = buildCsatStarDistribution(args.starRows);
  const ratedTickets = starCounts.reduce((sum, row) => sum + row.count, 0);
  return {
    averageRating: args.averageRating == null ? null : Number(args.averageRating.toFixed(2)),
    ratedTickets,
    totalTickets: args.totalTickets,
    unratedTickets: Math.max(0, args.totalTickets - ratedTickets),
    starCounts,
  };
}

function summarizeUserSupportStatusCounts(rows: { status: TicketStatus; _count: number }[]) {
  const m = new Map<TicketStatus, number>();
  for (const r of rows) {
    m.set(r.status, r._count);
  }
  return {
    forConfirmation: m.get("FOR_CONFIRMATION") ?? 0,
    closed: m.get("CLOSED") ?? 0,
  };
}

function rangeFilter(range: KpiRange) {
  return { gte: range.from, lte: range.to };
}

type WorkingDayInterval = { start: Date; end: Date };

function ymdInTimeZone(d: Date, timeZone: string): string {
  const iso = DateTime.fromJSDate(d, { zone: normalizeTimeZone(timeZone) }).toISODate();
  return iso ?? d.toISOString().slice(0, 10);
}

/** Mon–Sat local days in range (Sundays excluded). */
function workingDayIntervalsInRange(range: KpiRange, timeZone: string): WorkingDayInterval[] {
  const zone = normalizeTimeZone(timeZone);
  return enumerateYmdDaysInRange(ymdInTimeZone(range.from, zone), ymdInTimeZone(range.to, zone), zone).map(
    (ymd) => {
      const dt = DateTime.fromISO(ymd, { zone });
      return {
        start: dt.startOf("day").toJSDate(),
        end: dt.endOf("day").toJSDate(),
      };
    },
  );
}

function timestampOnWorkingDaysWhere(
  field: "createdAt" | "closedAt" | "updatedAt",
  intervals: WorkingDayInterval[],
): Prisma.TicketWhereInput {
  if (intervals.length === 0) {
    return { [field]: { lt: new Date(0) } };
  }
  if (intervals.length === 1) {
    const iv = intervals[0]!;
    return { [field]: { gte: iv.start, lte: iv.end } };
  }
  return {
    OR: intervals.map((iv) => ({
      [field]: { gte: iv.start, lte: iv.end },
    })),
  };
}

function workingDaysSpanRange(intervals: WorkingDayInterval[]): KpiRange | null {
  if (intervals.length === 0) return null;
  return { from: intervals[0]!.start, to: intervals[intervals.length - 1]!.end };
}

/** Live {@link prisma.ticket} counts for Helpdesk / User Support pillars (Mon–Sat in `timeZone`). */
async function loadLiveHelpdeskTaskMetricCounts(args: {
  workingDayIntervals: WorkingDayInterval[];
  span: KpiRange;
  scoped: Record<string, unknown>;
}): Promise<HelpdeskTaskMetricCounts> {
  const { workingDayIntervals, span, scoped } = args;
  const [closedN, openN, volumeN, userSupportRows] = await Promise.all([
    prisma.ticket.count({
      where: {
        ...scoped,
        AND: [{ closedAt: { not: null } }, timestampOnWorkingDaysWhere("closedAt", workingDayIntervals)],
      },
    }),
    prisma.ticket.count({ where: openTicketsInRangeWhere(span, scoped) }),
    prisma.ticket.count({
      where: { ...timestampOnWorkingDaysWhere("createdAt", workingDayIntervals), ...scoped },
    }),
    prisma.ticket.groupBy({
      by: ["status"],
      where: {
        status: { in: ["FOR_CONFIRMATION", "CLOSED"] },
        ...timestampOnWorkingDaysWhere("updatedAt", workingDayIntervals),
        ...scoped,
      },
      _count: true,
    }),
  ]);
  const userSupport = summarizeUserSupportStatusCounts(
    userSupportRows.map((r) => ({
      status: r.status as TicketStatus,
      _count: r._count,
    })),
  );
  return {
    userSupport: { forConfirmation: userSupport.forConfirmation, closed: userSupport.closed },
    closedInRange: closedN,
    openTicketsInPeriod: openN,
    requestsInRange: volumeN,
  };
}

async function loadUserSupportRatingMetrics(args: {
  workingDayIntervals: WorkingDayInterval[];
  scoped: Record<string, unknown>;
}): Promise<TaskMetricsUserSupportTickets> {
  const { workingDayIntervals, scoped } = args;
  const ticketWhere = {
    ...timestampOnWorkingDaysWhere("createdAt", workingDayIntervals),
    ...scoped,
  };
  const feedbackWhere = {
    ticket: ticketWhere,
    csat: { gte: 1, lte: 5 },
  };
  const [totalTickets, ratingAgg, starRows] = await Promise.all([
    prisma.ticket.count({ where: ticketWhere }),
    prisma.ticketFeedback.aggregate({
      where: feedbackWhere,
      _avg: { csat: true },
    }),
    prisma.ticketFeedback.groupBy({
      by: ["csat"],
      where: feedbackWhere,
      _count: true,
    }),
  ]);
  return summarizeUserSupportRatings({
    totalTickets,
    averageRating: ratingAgg._avg.csat,
    starRows: starRows.map((r) => ({ csat: r.csat, _count: r._count })),
  });
}

function emptyTaskMetricsUserSupport(): TaskMetricsUserSupportTickets {
  return {
    averageRating: null,
    ratedTickets: 0,
    totalTickets: 0,
    unratedTickets: 0,
    starCounts: buildCsatStarDistribution([]),
  };
}

function emptyTaskMetricsHelpdesk(
  cadence: HelpdeskTaskCadence,
  openBacklog: number,
  rangeFromYmd = "",
  rangeToYmd = "",
): TaskMetricsHelpdeskTickets {
  return {
    cadence,
    closedCount: 0,
    denominator: 0,
    ratio: null,
    percent: null,
    openBacklog,
    openTicketsInPeriod: 0,
    requestsInRange: 0,
    rangeFromYmd,
    rangeToYmd,
  };
}

/**
 * Reporting timezone — defaults to Asia/Taipei (GMT+8) so volume trends line up with
 * what operators see locally instead of UTC midnights. Can be overridden with
 * the REPORT_TZ env var.
 */
const REPORT_TZ = process.env.REPORT_TZ || "Asia/Taipei";

function kpiRangeToYmd(range: KpiRange): { fromYmd: string; toYmd: string } {
  const ymd = (d: Date) =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  return { fromYmd: ymd(range.from), toYmd: ymd(range.to) };
}

function computeTaskMetricsHelpdesk(args: {
  cadence: HelpdeskTaskCadence;
  openBacklog: number;
  closedInRange: number;
  openTicketsInPeriod: number;
  requestsInRange: number;
  percent: number | null;
  rangeFromYmd: string;
  rangeToYmd: string;
}): TaskMetricsHelpdeskTickets {
  const {
    cadence,
    openBacklog,
    closedInRange,
    openTicketsInPeriod,
    requestsInRange,
    percent,
    rangeFromYmd,
    rangeToYmd,
  } = args;
  const denominator = openTicketsInPeriod + closedInRange;
  const ratio = denominator > 0 ? closedInRange / denominator : null;
  return {
    cadence,
    closedCount: closedInRange,
    denominator,
    ratio,
    percent,
    openBacklog,
    openTicketsInPeriod,
    requestsInRange,
    rangeFromYmd,
    rangeToYmd,
  };
}

/** Open tickets that overlapped the reporting window (created by end, not closed before start). */
function openTicketsInRangeWhere(range: KpiRange, scoped: Record<string, unknown>) {
  return {
    ...scoped,
    status: { not: "CLOSED" as const },
    createdAt: { lte: range.to },
    OR: [{ closedAt: null }, { closedAt: { gte: range.from } }],
  };
}

const localDayFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: REPORT_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function localDayKey(d: Date): string {
  /** en-CA returns YYYY-MM-DD which is also what we use as the bucket label. */
  return localDayFmt.format(d);
}

/** Local-time calendar days inclusive between `from` and `to` (DST-safe). */
function enumerateDaysLocal(from: Date, to: Date): string[] {
  const startKey = localDayKey(from);
  const endKey = localDayKey(to);
  const labels: string[] = [];
  /**
   * Walk by parsing each YYYY-MM-DD as a UTC midnight and stepping 24h. This is
   * deterministic and avoids DST ambiguity since we never re-cross timezone
   * offsets while iterating.
   */
  const startMs = Date.UTC(
    Number(startKey.slice(0, 4)),
    Number(startKey.slice(5, 7)) - 1,
    Number(startKey.slice(8, 10)),
  );
  const endMs = Date.UTC(
    Number(endKey.slice(0, 4)),
    Number(endKey.slice(5, 7)) - 1,
    Number(endKey.slice(8, 10)),
  );
  for (let t = startMs; t <= endMs; t += 86400000) {
    labels.push(new Date(t).toISOString().slice(0, 10));
  }
  return labels;
}

function countPerDay(labels: string[], timestamps: Date[], dayOf: (d: Date) => string): number[] {
  const map = new Map(labels.map((l) => [l, 0]));
  for (const dt of timestamps) {
    const k = dayOf(dt);
    if (map.has(k)) map.set(k, (map.get(k) ?? 0) + 1);
  }
  return labels.map((l) => map.get(l) ?? 0);
}

export type PersonnelTicketMetric = {
  id: string;
  name: string;
  closed: number;
  /** Assigned tickets currently OPEN or IN_PROGRESS. */
  pending: number;
  efficiency: number;
};

export type TaskMetricsPayload = {
  range: KpiRange;
  taskMetricsHelpdesk: TaskMetricsHelpdeskTickets;
  taskMetricsUserSupport: TaskMetricsUserSupportTickets;
  taskChecklistPillars: TaskChecklistPillarMetrics;
  personnelTicketMetrics: PersonnelTicketMetric[];
  /** RFP Requestor — not credited; always empty. */
  personnelRfpRequestorMetrics: PersonnelTicketMetric[];
  /** RFP Approved By (Accounting) — closed/pending/efficiency per agent. */
  personnelRfpAccountingMetrics: PersonnelTicketMetric[];
  /** RFP Approved By (Finance) — closed/pending/efficiency per agent. */
  personnelRfpFinanceMetrics: PersonnelTicketMetric[];
  /** IRS Canvassed By — closed/pending/efficiency per agent. */
  personnelIrsCanvassMetrics: PersonnelTicketMetric[];
  /** FTR Prepared By — closed/pending/efficiency per agent. */
  personnelFtrPreparedMetrics: PersonnelTicketMetric[];
  personnelDelayPenalties: PersonnelDelayPenaltyRow[];
};

/** Task metrics tab: helpdesk ratio + user support (scoped reporting range). */
export async function computeTaskMetrics(
  range: KpiRange,
  scope: KpiScope = {},
  helpdeskCadence: HelpdeskTaskCadence = "MONTHLY",
  opts: { timeZone?: string; taskType?: TaskMetricsTaskTypeFilter } = {},
): Promise<TaskMetricsPayload> {
  const scoped = scope.assignedAgentIds
    ? ({ assignedAgentId: { in: scope.assignedAgentIds.length > 0 ? scope.assignedAgentIds : ["__none__"] } } as const)
    : scope.assignedAgentId
      ? ({ assignedAgentId: scope.assignedAgentId } as const)
      : {};
  /** Helpdesk / User Support use Manila working days even when the browser sends UTC before hydration. */
  const helpdeskTz = snapshotTimeZoneForTaskMetrics(opts.timeZone);
  const taskTypeFilter: TaskMetricsTaskTypeFilter =
    opts.taskType === "project" ||
    opts.taskType === "field" ||
    opts.taskType === "task" ||
    opts.taskType === "requests"
      ? opts.taskType
      : "ALL";
  const workingDays = workingDayIntervalsInRange(range, helpdeskTz);
  const { fromYmd, toYmd } = kpiRangeToYmd(range);

  const backlogOpen = await prisma.ticket.count({
    where: { status: "OPEN", ...scoped },
  });

  let closedInRange = 0;
  let openInRange = 0;
  let volume = 0;
  let taskMetricsUserSupport = emptyTaskMetricsUserSupport();

  if (workingDays.length > 0) {
    const span = workingDaysSpanRange(workingDays)!;
    const globalScope = !scope.assignedAgentId && !scope.assignedAgentIds;

    const [csvCounts, liveCounts] = await Promise.all([
      globalScope
        ? loadHelpdeskCsvTaskMetricCounts({ workingDayIntervals: workingDays, span })
        : Promise.resolve(null),
      loadLiveHelpdeskTaskMetricCounts({
        workingDayIntervals: workingDays,
        span,
        scoped,
      }),
    ]);

    const blend = globalScope ? resolveHelpdeskMetricBlend(fromYmd, toYmd) : "live-only";
    const combined = globalScope
      ? combineHelpdeskCountsByBlend(csvCounts, liveCounts, blend)
      : liveCounts;

    if (combined) {
      closedInRange = combined.closedInRange;
      openInRange = combined.openTicketsInPeriod;
      volume = combined.requestsInRange;
      taskMetricsUserSupport = await loadUserSupportRatingMetrics({ workingDayIntervals: workingDays, scoped });
    }
  }

  const taskMetricsHelpdesk =
    workingDays.length === 0
      ? emptyTaskMetricsHelpdesk(helpdeskCadence, backlogOpen, fromYmd, toYmd)
      : computeTaskMetricsHelpdesk({
          cadence: helpdeskCadence,
          openBacklog: backlogOpen,
          closedInRange,
          openTicketsInPeriod: openInRange,
          requestsInRange: volume,
          percent: helpdeskSupportPercent(closedInRange, openInRange),
          rangeFromYmd: fromYmd,
          rangeToYmd: toYmd,
        });

  const kpiWhere = kpiMaintenanceWhereForTaskMetrics(scope.assignedAgentId, scope.assignedAgentIds);
  const checklistArgs = {
    metricsCadence: helpdeskCadence,
    fromYmd,
    toYmd,
    timeZone: helpdeskTz,
    kpiWhere,
  } as const;

  let taskChecklistPillars: TaskChecklistPillarMetrics;
  if (taskTypeFilter === "ALL") {
    const [task, project, field] = await Promise.all([
      computeTaskChecklistPillarMetrics({ ...checklistArgs, taskType: "task" }),
      computeTaskChecklistPillarMetrics({ ...checklistArgs, taskType: "project" }),
      computeTaskChecklistPillarMetrics({ ...checklistArgs, taskType: "field" }),
    ]);
    taskChecklistPillars = { ...task, ...project, ...field };
  } else if (taskTypeFilter === "requests") {
    taskChecklistPillars = await computeTaskChecklistPillarMetrics({
      ...checklistArgs,
      taskType: "requests",
    });
  } else {
    taskChecklistPillars = await computeTaskChecklistPillarMetrics({
      ...checklistArgs,
      taskType: taskTypeFilter,
    });
  }

  const personnelTicketMetrics =
    workingDays.length > 0
      ? await loadPersonnelTicketMetrics(scoped, workingDays)
      : [];

  const rfpRoleMetrics =
    workingDays.length > 0
      ? await loadRfpRolePersonnelMetrics(scoped, workingDays)
      : { requestor: [], accounting: [], finance: [] };

  const [personnelIrsCanvassMetrics, personnelFtrPreparedMetrics] =
    workingDays.length > 0
      ? await Promise.all([
          loadIrsCanvassPersonnelMetrics(scoped, workingDays),
          loadFtrPreparedPersonnelMetrics(scoped, workingDays),
        ])
      : [[], []];

  const personnelDelayPenalties = await loadPersonnelDelayPenalties(
    kpiMaintenanceWhereForTaskMetrics(scope.assignedAgentId, scope.assignedAgentIds),
    helpdeskTz,
  );

  return {
    range,
    taskMetricsHelpdesk,
    taskMetricsUserSupport,
    taskChecklistPillars,
    personnelTicketMetrics,
    personnelRfpRequestorMetrics: rfpRoleMetrics.requestor,
    personnelRfpAccountingMetrics: rfpRoleMetrics.accounting,
    personnelRfpFinanceMetrics: rfpRoleMetrics.finance,
    personnelIrsCanvassMetrics,
    personnelFtrPreparedMetrics,
    personnelDelayPenalties,
  };
}

async function loadPersonnelDelayPenalties(
  kpiWhere: Prisma.KpiMaintenanceWhereInput,
  timeZone: string,
): Promise<PersonnelDelayPenaltyRow[]> {
  const nowMs = Date.now();
  const rows = await prisma.kpiMaintenance.findMany({
    where: kpiWhere,
    select: {
      subKpis: true,
      frequency: true,
      isRecurring: true,
      title: true,
      assignedAgent: { select: { id: true, name: true } },
    },
  });
  const merged = mergePenaltyDeductionMaps(
    rows.map((row) =>
      penaltyDeductionsForKpi(
        {
          subKpis: row.subKpis,
          frequency: row.frequency as KpiFrequencyCode,
          isRecurring: row.isRecurring,
          title: row.title,
          assignedAgent: row.assignedAgent,
        },
        { nowMs, timeZone },
      ),
    ),
  );
  return [...merged.values()]
    .filter((row) => row.deduction > 0)
    .map((row) => ({
      id: row.id,
      name: row.name,
      deduction: Math.round(row.deduction * 100) / 100,
    }));
}

async function loadPersonnelTicketMetrics(
  scoped: Record<string, unknown>,
  workingDayIntervals: WorkingDayInterval[],
): Promise<PersonnelTicketMetric[]> {
  // Keep the agent scope (company / personnel) — a plain `assignedAgentId: { not: null }`
  // key would silently replace the scoped filter spread before it.
  // Counts Issue/Concern, Job Order, etc. Closed uses ticket.closedAt (set when the
  // requestor confirms / ticket closes). RFP / IRS / FTR use dedicated role KPIs
  // gated the same way so procedural credits are not double-counted here.
  const proceduralRequestTypes = [
    "REQUEST_FOR_PAYMENT",
    "ITEM_REQUISITION_SLIP",
    "FUND_TRANSFER_REQUEST",
  ] as const;
  const assignedAgentFilter =
    (scoped as { assignedAgentId?: unknown }).assignedAgentId ?? ({ not: null } as const);
  const [closedByAgent, pendingByAgent] = await Promise.all([
    prisma.ticket.groupBy({
      by: ["assignedAgentId"],
      where: {
        ...scoped,
        assignedAgentId: assignedAgentFilter,
        NOT: { requestType: { in: [...proceduralRequestTypes] } },
        AND: [{ closedAt: { not: null } }, timestampOnWorkingDaysWhere("closedAt", workingDayIntervals)],
      },
      _count: true,
    }),
    prisma.ticket.groupBy({
      by: ["assignedAgentId"],
      where: {
        ...scoped,
        assignedAgentId: assignedAgentFilter,
        NOT: { requestType: { in: [...proceduralRequestTypes] } },
        status: { in: OPEN_PIPELINE_STATUSES },
      },
      _count: true,
    }),
  ]);

  const agentIds = [
    ...new Set(
      [...closedByAgent, ...pendingByAgent]
        .map((row) => row.assignedAgentId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  if (agentIds.length === 0) return [];

  const agents = await prisma.agent.findMany({
    where: { id: { in: agentIds } },
    select: { id: true, name: true },
  });
  const agentMap = new Map(agents.map((agent) => [agent.id, agent.name]));

  const closedMap = new Map(
    closedByAgent
      .filter((row) => row.assignedAgentId)
      .map((row) => [row.assignedAgentId!, row._count] as const),
  );
  const pendingMap = new Map(
    pendingByAgent
      .filter((row) => row.assignedAgentId)
      .map((row) => [row.assignedAgentId!, row._count] as const),
  );

  return agentIds
    .map((id) => {
      const closed = closedMap.get(id) ?? 0;
      const pending = pendingMap.get(id) ?? 0;
      const efficiency = helpdeskSupportPercent(closed, pending) ?? 0;
      return {
        id,
        name: agentMap.get(id)?.trim() || "Unknown",
        closed,
        pending,
        efficiency,
      };
    })
    .filter((row) => row.closed > 0 || row.pending > 0)
    .sort((a, b) => b.efficiency - a.efficiency || b.closed - a.closed || a.name.localeCompare(b.name));
}

export async function computeKpis(
  range: KpiRange,
  scope: KpiScope = {},
  opts: { helpdeskCadence?: HelpdeskTaskCadence } = {},
) {
  const helpdeskCadence = opts.helpdeskCadence ?? "MONTHLY";
  const agentScope = scope.assignedAgentIds
    ? ({ assignedAgentId: { in: scope.assignedAgentIds.length > 0 ? scope.assignedAgentIds : ["__none__"] } } as const)
    : scope.assignedAgentId
      ? ({ assignedAgentId: scope.assignedAgentId } as const)
      : {};
  const teamScope = scope.teamIds
    ? ({ teamId: { in: scope.teamIds.length > 0 ? scope.teamIds : ["__none__"] } } as const)
    : scope.teamId
      ? ({ teamId: scope.teamId } as const)
      : {};
  const scoped: Prisma.TicketWhereInput = { ...agentScope, ...teamScope };
  const ticketRelationScope = Object.keys(scoped).length > 0 ? ({ ticket: scoped } as const) : {};
  const maintenanceScope = scope.assignedAgentIds
    ? ({ assignedAgentId: { in: scope.assignedAgentIds.length > 0 ? scope.assignedAgentIds : ["__none__"] } } as const)
    : scope.assignedAgentId
      ? ({ assignedAgentId: scope.assignedAgentId } as const)
      : {};
  const createdInRange = { createdAt: rangeFilter(range), ...scoped };
  const closedInRangeWhere = { closedAt: rangeFilter(range), ...scoped };

  const [
    volume,
    backlogActive,
    forConfirmationBacklog,
    transferRequestsInRange,
    reopened,
    firstResponseSamples,
    resolutionSamples,
    feedbackAgg,
    perAgent,
    closedTickets,
    createdTimestamps,
    closedTimestamps,
    queueByStatus,
    kpisAdded,
    feedbackCsatByStar,
    confirmationClosedSamples,
  ] = await Promise.all([
    prisma.ticket.count({ where: createdInRange }),
    prisma.ticket.count({
      where: { status: { in: ACTIVE_REQUEST_STATUSES }, ...scoped },
    }),
    prisma.ticket.count({
      where: { status: { in: ["FOR_CONFIRMATION", "RESOLVED"] }, ...scoped },
    }),
    prisma.ticketActivity.count({
      where: {
        summary: "Transfer requested",
        createdAt: rangeFilter(range),
        ...ticketRelationScope,
      },
    }),
    prisma.ticket.count({
      where: { ...createdInRange, reopenCount: { gt: 0 } },
    }),
    prisma.ticket.findMany({
      where: {
        ...createdInRange,
        firstResponseAt: { not: null },
      },
      select: {
        createdAt: true,
        firstResponseAt: true,
        firstResponseDueAt: true,
      },
    }),
    prisma.ticket.findMany({
      where: {
        ...createdInRange,
        resolvedAt: { not: null },
      },
      select: {
        createdAt: true,
        resolvedAt: true,
        resolutionDueAt: true,
      },
    }),
    prisma.ticketFeedback.aggregate({
      where: {
        createdAt: rangeFilter(range),
        ...ticketRelationScope,
      },
      _avg: { csat: true, nps: true, ces: true },
      _count: true,
    }),
    prisma.ticket.groupBy({
      by: ["assignedAgentId"],
      where: closedInRangeWhere,
      _count: true,
    }),
    prisma.ticket.findMany({
      where: closedInRangeWhere,
      select: { reopenCount: true, messages: { select: { id: true } } },
    }),
    prisma.ticket.findMany({
      where: createdInRange,
      select: { createdAt: true },
    }),
    prisma.ticket.findMany({
      where: closedInRangeWhere,
      select: { closedAt: true },
    }),
    prisma.ticket.groupBy({
      by: ["status"],
      where: { status: { not: "CLOSED" }, ...scoped },
      _count: true,
    }),
    prisma.kpiMaintenance.count({
      where: {
        createdAt: rangeFilter(range),
        ...maintenanceScope,
      },
    }),
    prisma.ticketFeedback.groupBy({
      by: ["csat"],
      where: {
        createdAt: rangeFilter(range),
        ...ticketRelationScope,
        csat: { gte: 1, lte: 5 },
      },
      _count: true,
    }),
    prisma.ticket.findMany({
      where: {
        closedAt: rangeFilter(range),
        resolvedAt: { not: null },
        ...scoped,
      },
      select: { resolvedAt: true, closedAt: true },
    }),
  ]);

  const dayLabels = enumerateDaysLocal(range.from, range.to);
  const createdByDay = countPerDay(
    dayLabels,
    createdTimestamps.map((t) => t.createdAt),
    localDayKey,
  );
  const closedDates = closedTimestamps.map((t) => t.closedAt).filter((d): d is Date => d != null);
  const closedByDay = countPerDay(dayLabels, closedDates, localDayKey);

  const queueStatusMix = queueByStatus
    .map((row) => ({
      status: row.status as TicketStatus,
      count: row._count,
    }))
    .sort((a, b) => b.count - a.count);

  const ms = (a: Date, b: Date) => b.getTime() - a.getTime();

  const frtValues = firstResponseSamples.map((t) =>
    ms(t.createdAt, t.firstResponseAt!),
  );
  const avgFrtMs =
    frtValues.length === 0
      ? null
      : frtValues.reduce((a, b) => a + b, 0) / frtValues.length;

  const artValues = resolutionSamples.map((t) =>
    ms(t.createdAt, t.resolvedAt!),
  );
  const avgArtMs =
    artValues.length === 0
      ? null
      : artValues.reduce((a, b) => a + b, 0) / artValues.length;

  const confirmationValues = confirmationClosedSamples
    .map((t) => (t.closedAt && t.resolvedAt ? ms(t.resolvedAt, t.closedAt) : null))
    .filter((v): v is number => v !== null && v >= 0);
  const avgConfirmationMs =
    confirmationValues.length === 0
      ? null
      : confirmationValues.reduce((a, b) => a + b, 0) / confirmationValues.length;

  const firstResponseSlaMet = firstResponseSamples.filter(
    (t) => t.firstResponseAt! <= t.firstResponseDueAt,
  ).length;
  const firstResponseSlaRate =
    firstResponseSamples.length === 0
      ? null
      : firstResponseSlaMet / firstResponseSamples.length;

  const resolutionSlaMet = resolutionSamples.filter(
    (t) => t.resolvedAt! <= t.resolutionDueAt,
  ).length;
  const resolutionSlaRate =
    resolutionSamples.length === 0
      ? null
      : resolutionSlaMet / resolutionSamples.length;

  const closedCount = closedTickets.length;

  const fcrEligible = closedTickets.filter((t) => t.reopenCount === 0);
  const fcrApprox =
    fcrEligible.length === 0
      ? null
      : fcrEligible.filter((t) => t.messages.length <= 2).length /
        fcrEligible.length;

  const transferRequestRate = volume === 0 ? null : transferRequestsInRange / volume;
  const reopenRate = volume === 0 ? null : reopened / volume;

  const agentIds = perAgent
    .map((row) => row.assignedAgentId)
    .filter((id): id is string => Boolean(id));
  const agents = agentIds.length
    ? await prisma.agent.findMany({
        where: { id: { in: agentIds } },
        select: { id: true, name: true, email: true },
      })
    : [];
  const agentMap = new Map(agents.map((a) => [a.id, a]));

  const agentRows = perAgent
    .filter((row) => row.assignedAgentId)
    .map((row) => ({
      agentId: row.assignedAgentId!,
      name: agentMap.get(row.assignedAgentId!)?.name ?? "Unknown",
      ticketsClosed: row._count,
    }))
    .sort((a, b) => b.ticketsClosed - a.ticketsClosed);

  let taskMetricsScope: KpiScope = scope;
  if (!scope.assignedAgentId && !scope.assignedAgentIds && (scope.teamId || scope.teamIds)) {
    if (scope.teamId) {
      taskMetricsScope = {
        ...scope,
        assignedAgentIds: await loadAgentIdsForCompanyTeam(scope.teamId),
      };
    } else if (scope.teamIds) {
      const nested = await Promise.all(scope.teamIds.map((id) => loadAgentIdsForCompanyTeam(id)));
      taskMetricsScope = {
        ...scope,
        assignedAgentIds: [...new Set(nested.flat())],
      };
    }
  }

  const { taskMetricsHelpdesk, taskMetricsUserSupport } = await computeTaskMetrics(
    range,
    taskMetricsScope,
    helpdeskCadence,
  );
  const csatByStar = buildCsatStarDistribution(
    feedbackCsatByStar.map((r) => ({ csat: r.csat, _count: r._count })),
  );

  return {
    range,
    operational: {
      ticketVolume: volume,
      /** Active request pipeline (non-CLOSED) — matches Request / Company board totals. */
      backlogSize: backlogActive,
      forConfirmationSize: forConfirmationBacklog,
      firstResponseTimeMsAvg: avgFrtMs,
      resolutionTimeMsAvg: avgArtMs,
      confirmationTimeMsAvg: avgConfirmationMs,
      firstContactResolutionApprox: fcrApprox,
    },
    sla: {
      firstResponseComplianceRate: firstResponseSlaRate,
      resolutionComplianceRate: resolutionSlaRate,
      transferRequestRate,
      reopenRate,
      ticketsClosedInRange: closedCount,
    },
    quality: {
      csatAvg: feedbackAgg._avg.csat,
      npsAvg: feedbackAgg._avg.nps,
      cesAvg: feedbackAgg._avg.ces,
      feedbackCount: feedbackAgg._count,
      csatByStar,
    },
    agents: {
      ticketsClosedByAgent: agentRows,
    },
    charts: {
      days: dayLabels,
      createdByDay,
      closedByDay,
      queueStatusMix,
    },
    kpiManagement: {
      kpisAdded,
    },
    taskMetricsHelpdesk,
    taskMetricsUserSupport,
  };
}
