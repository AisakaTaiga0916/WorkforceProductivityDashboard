import type { PersonnelTicketMetric, TaskChecklistPillarMetrics } from "@/modules/tasks/kpis";
import { resolveRosterCompanyName } from "@/modules/hierarchy/hris-company-aliases";

export type PersonnelAccumulatedTaskMetric = {
  id: string;
  name: string;
  role: string;
  total: number;
  done: number;
  remaining: number;
  percent: number;
  pillarsContributed: number;
  penaltyDeduction?: number;
};

export type PersonnelCombinedMetricCard = {
  id: string;
  name: string;
  role: string;
  /** HRIS / merged department label when known. */
  departmentName?: string | null;
  tickets: {
    closed: number;
    pending: number;
    efficiency: number;
  } | null;
  /** RFP Requestor role KPI — not credited; kept null for payload compatibility. */
  rfpRequestor: {
    closed: number;
    pending: number;
    efficiency: number;
  } | null;
  /** RFP Prepared by Bookkeeper role KPI. */
  rfpAccounting: {
    closed: number;
    pending: number;
    efficiency: number;
  } | null;
  /** RFP Approved By Accounting role KPI. */
  rfpFinance: {
    closed: number;
    pending: number;
    efficiency: number;
  } | null;
  /** IRS Canvassed By role KPI. */
  irsCanvass: {
    closed: number;
    pending: number;
    efficiency: number;
  } | null;
  /** FTR Prepared By role KPI. */
  ftrPrepared: {
    closed: number;
    pending: number;
    efficiency: number;
  } | null;
  tasks: {
    closed: number;
    pending: number;
    efficiency: number;
    pillarsContributed: number;
    penaltyDeduction?: number;
    /** Raw task efficiency before delay penalty points are applied. */
    efficiencyBeforePenalty?: number;
  } | null;
};

export const PERSONNEL_AVERAGE_EFFICIENCY_FLOOR = 50;

export function applyPenaltyToTaskEfficiency(efficiency: number, penaltyDeduction: number): number {
  if (penaltyDeduction <= 0) return efficiency;
  const adjusted = efficiency - Math.min(efficiency, penaltyDeduction);
  return Math.max(PERSONNEL_AVERAGE_EFFICIENCY_FLOOR, Math.round(adjusted));
}

export function applyPersonnelAverageEfficiencyFloor(efficiency: number): number {
  return Math.max(PERSONNEL_AVERAGE_EFFICIENCY_FLOOR, Math.round(efficiency));
}

/** All request-role buckets on a personnel card (any request type). RFP requestor is excluded. */
export function personnelRequestBuckets(
  row: PersonnelCombinedMetricCard,
): Array<{ closed: number; pending: number; efficiency: number }> {
  return [
    row.tickets,
    row.rfpAccounting,
    row.rfpFinance,
    row.irsCanvass,
    row.ftrPrepared,
  ].filter((bucket): bucket is NonNullable<typeof bucket> => bucket != null);
}

/** Single Requests rollup: any request type lands here (not separate RFP/IRS/FTR sections). */
export function mergePersonnelRequestMetrics(
  row: PersonnelCombinedMetricCard,
): { closed: number; pending: number; efficiency: number } | null {
  const buckets = personnelRequestBuckets(row);
  if (buckets.length === 0) return null;
  const closed = buckets.reduce((sum, bucket) => sum + bucket.closed, 0);
  const pending = buckets.reduce((sum, bucket) => sum + bucket.pending, 0);
  const total = closed + pending;
  return {
    closed,
    pending,
    efficiency: total > 0 ? Math.round((closed / total) * 100) : 0,
  };
}

export function combinedPersonnelEfficiency(row: PersonnelCombinedMetricCard): number | null {
  const requests = mergePersonnelRequestMetrics(row);
  const values = [requests?.efficiency, row.tasks?.efficiency].filter(
    (value): value is number => value != null,
  );
  if (values.length === 0) return null;
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return applyPersonnelAverageEfficiencyFloor(average);
}

export type PersonnelEfficiencyBracketLabel =
  | "Outstanding"
  | "Good"
  | "Satisfactory"
  | "Needs Improvement";

export type PersonnelEfficiencyBracket = {
  label: PersonnelEfficiencyBracketLabel;
  badgeClassName: string;
  valueClassName: string;
};

/** Color-coded bracket for combined ticket/task average efficiency. */
export function personnelEfficiencyBracket(efficiency: number): PersonnelEfficiencyBracket {
  const value = Math.round(efficiency);
  if (value >= 95) {
    return {
      label: "Outstanding",
      badgeClassName:
        "border-emerald-500/45 bg-emerald-500/12 text-emerald-900 dark:border-emerald-400/40 dark:bg-emerald-500/10 dark:text-emerald-200",
      valueClassName: "text-emerald-800 dark:text-emerald-200",
    };
  }
  if (value >= 88) {
    return {
      label: "Good",
      badgeClassName:
        "border-teal-500/45 bg-teal-500/12 text-teal-900 dark:border-teal-400/40 dark:bg-teal-500/10 dark:text-teal-200",
      valueClassName: "text-teal-800 dark:text-teal-200",
    };
  }
  if (value >= 75) {
    return {
      label: "Satisfactory",
      badgeClassName:
        "border-amber-500/45 bg-amber-500/12 text-amber-950 dark:border-amber-400/40 dark:bg-amber-500/10 dark:text-amber-200",
      valueClassName: "text-amber-900 dark:text-amber-200",
    };
  }
  return {
    label: "Needs Improvement",
    badgeClassName:
      "border-rose-500/45 bg-rose-500/12 text-rose-900 dark:border-rose-400/40 dark:bg-rose-500/10 dark:text-rose-200",
    valueClassName: "text-rose-800 dark:text-rose-200",
  };
}

/** @deprecated Use PersonnelCombinedMetricCard */
export type PersonnelTaskMetricCard = {
  kind: "task";
  id: string;
  name: string;
  role: string;
  closed: number;
  remaining: number;
  efficiency: number;
  pillarsContributed: number;
};

/** @deprecated Use PersonnelCombinedMetricCard */
export type PersonnelTicketMetricCard = {
  kind: "ticket";
  id: string;
  name: string;
  role: string;
  closed: number;
  pending: number;
  efficiency: number;
};

/** @deprecated Use PersonnelCombinedMetricCard */
export type PersonnelMetricCardRow = PersonnelTaskMetricCard | PersonnelTicketMetricCard;

/**
 * Done ÷ total, matching the company-view pillar math (and the per-pillar
 * contributor rows), so the personnel cards agree with the company donuts.
 */
function personnelTaskEfficiency(done: number, pending: number): number {
  const total = done + pending;
  if (total <= 0) return 0;
  return Math.min(100, Math.round((done / total) * 100));
}

export function normalizePersonnelTaskTotals(
  assigned: number,
  closed: number,
): { pending: number; closed: number; efficiency: number } {
  const total = Math.max(0, assigned);
  const done = Math.min(Math.max(0, closed), total);
  const pending = Math.max(0, total - done);
  return {
    pending,
    closed: done,
    efficiency: personnelTaskEfficiency(done, pending),
  };
}

export function normalizePersonName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

/**
 * Stable identity for merging personnel cards across agent / HRIS name formats.
 * "Magbanua, Edmund Narvaez" and "Edmund Narvaez Magbanua" share the same key.
 */
export function personnelIdentityKey(name: string): string {
  let n = normalizePersonName(name);
  if (!n) return "";
  if (n.includes(",")) {
    const [last, rest = ""] = n.split(",", 2);
    n = `${rest.trim()} ${last.trim()}`.trim();
  }
  const tokens = n
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .sort();
  return tokens.join(" ");
}

/** Merged-database personnel row (Insights verification view). */
export type MergedPersonnelEfficiencyRow = {
  sourceUserId: string;
  name: string;
  companyName: string | null;
  departmentName?: string | null;
  totalTasks: number;
  completedTasks: number;
  delayedTasks: number;
  ticketsClosed: number;
  ticketsPending: number;
  taskEfficiency: number | null;
  ticketEfficiency: number | null;
  overallEfficiency: number;
  onTimeCompletionRate: number | null;
  delayPenaltyTotal?: number;
  taskEfficiencyBeforePenalty?: number | null;
  computedAt: string;
};

function mergeTicketMetricMaps(
  target: Map<string, PersonnelTicketMetric>,
  rows: PersonnelTicketMetric[],
) {
  for (const metric of rows) {
    const key = personnelIdentityKey(metric.name);
    if (!key) continue;
    const existing = target.get(key);
    if (!existing) {
      target.set(key, { ...metric });
      continue;
    }
    const closed = existing.closed + metric.closed;
    const pending = existing.pending + metric.pending;
    const total = closed + pending;
    target.set(key, {
      ...existing,
      id: existing.id || metric.id,
      name: preferDisplayName(existing.name, metric.name),
      closed,
      pending,
      efficiency: total > 0 ? Math.round((closed / total) * 100) : existing.efficiency,
    });
  }
}

function preferDisplayName(a: string, b: string): string {
  const aT = a.trim();
  const bT = b.trim();
  if (!aT) return bT;
  if (!bT) return aT;
  // Prefer HRIS-style "Last, First" when either side has it.
  if (aT.includes(",") && !bT.includes(",")) return aT;
  if (bT.includes(",") && !aT.includes(",")) return bT;
  return aT.length >= bT.length ? aT : bT;
}

function mergeActivityBuckets(
  a: { closed: number; pending: number; efficiency: number } | null | undefined,
  b: { closed: number; pending: number; efficiency: number } | null | undefined,
): { closed: number; pending: number; efficiency: number } | null {
  if (!a && !b) return null;
  if (!a) return b ? { ...b } : null;
  if (!b) return { ...a };
  const closed = a.closed + b.closed;
  const pending = a.pending + b.pending;
  const total = closed + pending;
  return {
    closed,
    pending,
    efficiency: total > 0 ? Math.round((closed / total) * 100) : Math.max(a.efficiency, b.efficiency),
  };
}

function mergeTaskBuckets(
  a: PersonnelCombinedMetricCard["tasks"],
  b: PersonnelCombinedMetricCard["tasks"],
): PersonnelCombinedMetricCard["tasks"] {
  if (!a && !b) return null;
  if (!a) return b ? { ...b } : null;
  if (!b) return { ...a };
  const closed = a.closed + b.closed;
  const pending = a.pending + b.pending;
  const penaltyDeduction = Math.max(a.penaltyDeduction ?? 0, b.penaltyDeduction ?? 0);
  const efficiencyBeforePenalty = Math.max(
    a.efficiencyBeforePenalty ?? a.efficiency,
    b.efficiencyBeforePenalty ?? b.efficiency,
  );
  const efficiency =
    penaltyDeduction > 0
      ? applyPenaltyToTaskEfficiency(efficiencyBeforePenalty, penaltyDeduction)
      : normalizePersonnelTaskTotals(closed + pending, closed).efficiency;
  return {
    closed,
    pending,
    efficiency,
    pillarsContributed: Math.max(a.pillarsContributed, b.pillarsContributed),
    ...(penaltyDeduction > 0 ? { penaltyDeduction, efficiencyBeforePenalty } : {}),
  };
}

/** Fold two cards for the same person into one (requests + tasks + role seats). */
export function mergePersonnelCombinedCards(
  a: PersonnelCombinedMetricCard,
  b: PersonnelCombinedMetricCard,
): PersonnelCombinedMetricCard {
  const preferAId =
    !isSyntheticMergedId(a.id) && isSyntheticMergedId(b.id)
      ? true
      : isSyntheticMergedId(a.id) && !isSyntheticMergedId(b.id)
        ? false
        : (a.tasks?.closed ?? 0) + (a.tasks?.pending ?? 0) >=
          (b.tasks?.closed ?? 0) + (b.tasks?.pending ?? 0);
  return {
    id: preferAId ? a.id || b.id : b.id || a.id,
    name: preferDisplayName(a.name, b.name),
    role: mergeRoles(a.role, b.role),
    departmentName: a.departmentName?.trim() || b.departmentName?.trim() || null,
    tickets: mergeActivityBuckets(a.tickets, b.tickets),
    rfpRequestor: null,
    rfpAccounting: mergeActivityBuckets(a.rfpAccounting, b.rfpAccounting),
    rfpFinance: mergeActivityBuckets(a.rfpFinance, b.rfpFinance),
    irsCanvass: mergeActivityBuckets(a.irsCanvass, b.irsCanvass),
    ftrPrepared: mergeActivityBuckets(a.ftrPrepared, b.ftrPrepared),
    tasks: mergeTaskBuckets(a.tasks, b.tasks),
  };
}

/** Collapse any remaining same-person cards (name variants, split request/task rows). */
export function consolidatePersonnelCards(
  cards: PersonnelCombinedMetricCard[],
): PersonnelCombinedMetricCard[] {
  const byKey = new Map<string, PersonnelCombinedMetricCard>();
  for (const card of cards) {
    const key = personnelIdentityKey(card.name);
    if (!key) continue;
    const existing = byKey.get(key);
    byKey.set(key, existing ? mergePersonnelCombinedCards(existing, card) : card);
  }
  return [...byKey.values()];
}

function isSyntheticMergedId(id: string): boolean {
  try {
    return BigInt(id) >= 9000000000n;
  } catch {
    return false;
  }
}

function pickCanonicalMergedRow(
  a: MergedPersonnelEfficiencyRow,
  b: MergedPersonnelEfficiencyRow,
): MergedPersonnelEfficiencyRow {
  const aSynthetic = isSyntheticMergedId(a.sourceUserId);
  const bSynthetic = isSyntheticMergedId(b.sourceUserId);
  if (aSynthetic !== bSynthetic) return aSynthetic ? b : a;
  if (a.totalTasks !== b.totalTasks) return a.totalTasks > b.totalTasks ? a : b;
  const aId = BigInt(a.sourceUserId);
  const bId = BigInt(b.sourceUserId);
  return aId <= bId ? a : b;
}

/** Collapse duplicate merged_users / breakdown rows that share the same person identity. */
export function dedupeMergedPersonnelRows(
  rows: MergedPersonnelEfficiencyRow[],
): MergedPersonnelEfficiencyRow[] {
  const byName = new Map<string, MergedPersonnelEfficiencyRow>();
  for (const row of rows) {
    const key = personnelIdentityKey(row.name);
    if (!key) continue;
    const existing = byName.get(key);
    if (!existing) {
      byName.set(key, row);
      continue;
    }
    const canonical = pickCanonicalMergedRow(existing, row);
    const other = canonical === existing ? row : existing;
    byName.set(key, {
      ...canonical,
      name: preferDisplayName(canonical.name, other.name),
      companyName: canonical.companyName ?? other.companyName,
      departmentName: canonical.departmentName ?? other.departmentName,
      totalTasks: Math.max(canonical.totalTasks, other.totalTasks),
      completedTasks: Math.max(canonical.completedTasks, other.completedTasks),
      delayedTasks: Math.max(canonical.delayedTasks, other.delayedTasks),
      ticketsClosed: Math.max(canonical.ticketsClosed, other.ticketsClosed),
      ticketsPending: Math.max(canonical.ticketsPending, other.ticketsPending),
      delayPenaltyTotal: Math.max(
        canonical.delayPenaltyTotal ?? 0,
        other.delayPenaltyTotal ?? 0,
      ),
      taskEfficiency: canonical.taskEfficiency ?? other.taskEfficiency,
      taskEfficiencyBeforePenalty:
        canonical.taskEfficiencyBeforePenalty ?? other.taskEfficiencyBeforePenalty,
      ticketEfficiency: canonical.ticketEfficiency ?? other.ticketEfficiency,
      overallEfficiency: Math.max(canonical.overallEfficiency, other.overallEfficiency),
    });
  }
  return [...byName.values()];
}

function bucketHasActivity(
  bucket: { closed: number; pending: number } | null | undefined,
): boolean {
  return bucket != null && (bucket.closed > 0 || bucket.pending > 0);
}

/**
 * True when the person has task or performer-side request KPI — not approver-only
 * seats (e.g. RFP Approved By Accounting / financeAgentId).
 */
export function personnelHasRecordedKpi(card: PersonnelCombinedMetricCard): boolean {
  if (bucketHasActivity(card.tasks)) return true;
  if (bucketHasActivity(card.tickets)) return true;
  if (bucketHasActivity(card.rfpAccounting)) return true;
  if (bucketHasActivity(card.irsCanvass)) return true;
  if (bucketHasActivity(card.ftrPrepared)) return true;
  return false;
}

export function filterPersonnelSearchQuery(
  rows: PersonnelCombinedMetricCard[],
  query: string,
): PersonnelCombinedMetricCard[] {
  const needle = normalizePersonName(query);
  if (!needle) return rows;
  const needleKey = personnelIdentityKey(query);
  return rows.filter((row) => {
    const name = normalizePersonName(row.name);
    const key = personnelIdentityKey(row.name);
    return name.includes(needle) || (needleKey.length > 0 && key.includes(needleKey));
  });
}

/** Unique department labels from merged personnel rows (optionally company-scoped). */
export function buildPersonnelDepartmentOptions(
  rows: MergedPersonnelEfficiencyRow[],
  selectedCompanyName?: string | null,
): Array<{ value: string; label: string }> {
  let scoped = rows;
  if (selectedCompanyName) {
    const target = selectedCompanyName.trim().toLowerCase();
    scoped = rows.filter((row) => {
      const rowCompany =
        (resolveRosterCompanyName(row.companyName) ?? row.companyName)?.trim().toLowerCase() ?? "";
      return rowCompany === target;
    });
  }
  const names = new Set<string>();
  for (const row of scoped) {
    const name = row.departmentName?.trim();
    if (name) names.add(name);
  }
  return [
    ...[...names].sort((a, b) => a.localeCompare(b)).map((name) => ({ value: name, label: name })),
  ];
}

export function buildPersonnelInsightCards(args: {
  mergedRows: MergedPersonnelEfficiencyRow[];
  selectedCompanyName?: string | null;
  /** @deprecated Prefer `selectedOrgChartMemberIds` (org-chart section filter). */
  selectedDepartmentName?: string | null;
  /** When set, only rows whose `sourceUserId` is in this set (org-chart section tree). */
  selectedOrgChartMemberIds?: ReadonlySet<string> | null;
  personnelDelayPenalties: PersonnelDelayPenaltyRow[];
  personnelTicketMetrics: PersonnelTicketMetric[];
  personnelRfpAccountingMetrics: PersonnelTicketMetric[];
  personnelRfpFinanceMetrics: PersonnelTicketMetric[];
  personnelIrsCanvassMetrics: PersonnelTicketMetric[];
  personnelFtrPreparedMetrics: PersonnelTicketMetric[];
  liveTicketsAuthoritative: boolean;
}): PersonnelCombinedMetricCard[] {
  let rows = dedupeMergedPersonnelRows(args.mergedRows);
  if (args.selectedCompanyName) {
    const target = args.selectedCompanyName.trim().toLowerCase();
    rows = rows.filter((row) => {
      const rowCompany =
        (resolveRosterCompanyName(row.companyName) ?? row.companyName)?.trim().toLowerCase() ?? "";
      return rowCompany === target;
    });
  }
  if (args.selectedOrgChartMemberIds) {
    rows = rows.filter((row) => args.selectedOrgChartMemberIds!.has(row.sourceUserId));
  } else if (args.selectedDepartmentName) {
    const target = args.selectedDepartmentName.trim().toLowerCase();
    rows = rows.filter((row) => (row.departmentName ?? "").trim().toLowerCase() === target);
  }

  const penaltyById = new Map(args.personnelDelayPenalties.map((row) => [row.id, row.deduction]));
  const penaltyByName = new Map(
    args.personnelDelayPenalties.map((row) => [personnelIdentityKey(row.name), row.deduction]),
  );

  const liveRequestsByName = new Map<string, PersonnelTicketMetric>();
  mergeTicketMetricMaps(liveRequestsByName, args.personnelTicketMetrics);

  const liveRfpAccountingByName = new Map<string, PersonnelTicketMetric>();
  mergeTicketMetricMaps(liveRfpAccountingByName, args.personnelRfpAccountingMetrics);

  const liveRfpFinanceByName = new Map<string, PersonnelTicketMetric>();
  mergeTicketMetricMaps(liveRfpFinanceByName, args.personnelRfpFinanceMetrics);

  const liveIrsCanvassByName = new Map<string, PersonnelTicketMetric>();
  mergeTicketMetricMaps(liveIrsCanvassByName, args.personnelIrsCanvassMetrics);

  const liveFtrPreparedByName = new Map<string, PersonnelTicketMetric>();
  mergeTicketMetricMaps(liveFtrPreparedByName, args.personnelFtrPreparedMetrics);

  const byName = new Map<string, PersonnelCombinedMetricCard>();

  for (const row of rows) {
    const key = personnelIdentityKey(row.name);
    if (!key) continue;

    const livePenalty =
      penaltyById.get(row.sourceUserId) ?? penaltyByName.get(key) ?? 0;
    const storedPenalty = row.delayPenaltyTotal ?? 0;
    const penaltyDeduction = Math.max(livePenalty, storedPenalty);
    const efficiencyBeforePenalty = Math.round(
      row.taskEfficiencyBeforePenalty ?? row.taskEfficiency ?? 0,
    );
    const taskEfficiency =
      penaltyDeduction > 0
        ? applyPenaltyToTaskEfficiency(efficiencyBeforePenalty, penaltyDeduction)
        : Math.round(row.taskEfficiency ?? 0);

    const live = liveRequestsByName.get(key);
    const closed = live != null
      ? live.closed
      : args.liveTicketsAuthoritative
        ? 0
        : Number(row.ticketsClosed ?? 0);
    const pending = live != null
      ? live.pending
      : args.liveTicketsAuthoritative
        ? 0
        : Number(row.ticketsPending ?? 0);
    const requestTotal = closed + pending;
    const requestEfficiency =
      live != null
        ? Math.round(live.efficiency)
        : args.liveTicketsAuthoritative
          ? null
          : row.ticketEfficiency != null
            ? Math.round(Number(row.ticketEfficiency))
            : requestTotal > 0
              ? Math.round((closed / requestTotal) * 100)
              : null;

    const rfpAccounting = liveRfpAccountingByName.get(key) ?? null;
    const rfpFinance = liveRfpFinanceByName.get(key) ?? null;
    const irsCanvass = liveIrsCanvassByName.get(key) ?? null;
    const ftrPrepared = liveFtrPreparedByName.get(key) ?? null;

    const card: PersonnelCombinedMetricCard = {
      id: row.sourceUserId,
      name: row.name,
      role: "Assignee",
      departmentName: row.departmentName?.trim() || null,
      tickets:
        live != null || (!args.liveTicketsAuthoritative && (requestEfficiency != null || requestTotal > 0))
          ? {
              closed,
              pending,
              efficiency: requestEfficiency ?? 0,
            }
          : null,
      rfpRequestor: null,
      rfpAccounting: rfpAccounting
        ? {
            closed: rfpAccounting.closed,
            pending: rfpAccounting.pending,
            efficiency: Math.round(rfpAccounting.efficiency),
          }
        : null,
      rfpFinance: rfpFinance
        ? {
            closed: rfpFinance.closed,
            pending: rfpFinance.pending,
            efficiency: Math.round(rfpFinance.efficiency),
          }
        : null,
      irsCanvass: irsCanvass
        ? {
            closed: irsCanvass.closed,
            pending: irsCanvass.pending,
            efficiency: Math.round(irsCanvass.efficiency),
          }
        : null,
      ftrPrepared: ftrPrepared
        ? {
            closed: ftrPrepared.closed,
            pending: ftrPrepared.pending,
            efficiency: Math.round(ftrPrepared.efficiency),
          }
        : null,
      tasks:
        row.totalTasks > 0 || row.taskEfficiency != null
          ? {
              closed: row.completedTasks,
              pending: Math.max(0, row.totalTasks - row.completedTasks),
              efficiency: taskEfficiency,
              pillarsContributed: 0,
              ...(penaltyDeduction > 0
                ? { penaltyDeduction, efficiencyBeforePenalty }
                : {}),
            }
          : null,
    };

    const existing = byName.get(key);
    byName.set(key, existing ? mergePersonnelCombinedCards(existing, card) : card);
  }

  // Live request metrics only enrich the soft-path merged roster — never create
  // cards for legacy ticketing-only agents that aren't in mergeddatabase-dev.
  const findRosterCard = (name: string) => {
    const key = personnelIdentityKey(name);
    if (!key) return null;
    return byName.get(key) ?? null;
  };

  for (const live of liveRequestsByName.values()) {
    const card = findRosterCard(live.name);
    if (!card) continue;
    card.tickets = mergeActivityBuckets(card.tickets, {
      closed: live.closed,
      pending: live.pending,
      efficiency: Math.round(live.efficiency),
    });
    card.name = preferDisplayName(card.name, live.name);
  }
  for (const live of liveRfpAccountingByName.values()) {
    const card = findRosterCard(live.name);
    if (!card) continue;
    card.rfpAccounting = accumulateRoleBucket(card.rfpAccounting, live);
    card.name = preferDisplayName(card.name, live.name);
  }
  for (const live of liveIrsCanvassByName.values()) {
    const card = findRosterCard(live.name);
    if (!card) continue;
    card.irsCanvass = accumulateRoleBucket(card.irsCanvass, live);
    card.name = preferDisplayName(card.name, live.name);
  }
  for (const live of liveFtrPreparedByName.values()) {
    const card = findRosterCard(live.name);
    if (!card) continue;
    card.ftrPrepared = accumulateRoleBucket(card.ftrPrepared, live);
    card.name = preferDisplayName(card.name, live.name);
  }
  // RFP finance (Approved By Accounting) is approver-only — attach when a card
  // already exists, but never create a card from finance metrics alone.
  for (const live of liveRfpFinanceByName.values()) {
    const card = findRosterCard(live.name);
    if (!card) continue;
    card.rfpFinance = accumulateRoleBucket(card.rfpFinance, live);
  }

  return consolidatePersonnelCards([...byName.values()].filter(personnelHasRecordedKpi)).sort(
    (a, b) => {
      const aEff = combinedPersonnelEfficiency(a) ?? -1;
      const bEff = combinedPersonnelEfficiency(b) ?? -1;
      const aReq = mergePersonnelRequestMetrics(a);
      const bReq = mergePersonnelRequestMetrics(b);
      const aClosed = (aReq?.closed ?? 0) + (a.tasks?.closed ?? 0);
      const bClosed = (bReq?.closed ?? 0) + (b.tasks?.closed ?? 0);
      return bEff - aEff || bClosed - aClosed || a.name.localeCompare(b.name);
    },
  );
}

function mergeRoles(existing: string, incoming: string): string {
  const roles = new Set(
    `${existing} / ${incoming}`
      .split(" / ")
      .map((part) => part.trim())
      .filter(Boolean),
  );
  const sorted = [...roles].sort();
  if (sorted.includes("Assignee") && sorted.includes("Sub-assignee")) return "Assignee";
  return sorted.join(" / ") || "Assignee";
}

export type PersonnelDelayPenaltyRow = {
  id: string;
  name: string;
  deduction: number;
};

function penaltyDeductionForPerson(
  penalties: PersonnelDelayPenaltyRow[],
  id: string,
  name: string,
): number {
  if (penalties.length === 0) return 0;
  const byId = new Map(penalties.map((row) => [row.id, row.deduction]));
  const byName = new Map(
    penalties.map((row) => [normalizePersonName(row.name).toLowerCase(), row.deduction]),
  );
  return (
    byId.get(id) ??
    byName.get(normalizePersonName(name).toLowerCase()) ??
    0
  );
}

/** Apply live delay-penalty deductions to assignee progress rows (company pillar donuts). */
export function applyPenaltiesToAssigneeProgress<
  T extends { id: string; name: string; percent: number; total: number },
>(rows: T[], penalties: PersonnelDelayPenaltyRow[]): T[] {
  if (penalties.length === 0) return rows;
  return rows.map((row) => {
    const deduction = penaltyDeductionForPerson(penalties, row.id, row.name);
    if (deduction <= 0) return row;
    return {
      ...row,
      percent: applyPenaltyToTaskEfficiency(row.percent, deduction),
    };
  });
}

/** Task-weighted headline percent from assignee rows (after penalties when applied). */
export function weightedAssigneeProgressPercent(
  rows: Array<{ percent: number; total: number }>,
): number {
  let weighted = 0;
  let weight = 0;
  for (const row of rows) {
    if (row.total <= 0) continue;
    weighted += row.percent * row.total;
    weight += row.total;
  }
  return weight > 0 ? Math.round(weighted / weight) : 0;
}

export function applyDelayPenaltiesToPersonnelTasks(
  tasks: PersonnelAccumulatedTaskMetric[],
  penalties: PersonnelDelayPenaltyRow[],
): PersonnelAccumulatedTaskMetric[] {
  if (penalties.length === 0) return tasks;
  const byId = new Map(penalties.map((row) => [row.id, row.deduction]));
  const byName = new Map(penalties.map((row) => [row.name.trim().toLowerCase(), row.deduction]));
  return tasks.map((task) => {
    const deduction = byId.get(task.id) ?? byName.get(task.name.trim().toLowerCase()) ?? 0;
    if (deduction <= 0) return task;
    return {
      ...task,
      penaltyDeduction: Math.round(deduction * 100) / 100,
      percent: applyPenaltyToTaskEfficiency(task.percent, deduction),
    };
  });
}

function emptyPersonnelCard(id: string, name: string, role = "Assignee"): PersonnelCombinedMetricCard {
  return {
    id,
    name: name.trim(),
    role,
    departmentName: null,
    tickets: null,
    rfpRequestor: null,
    rfpAccounting: null,
    rfpFinance: null,
    irsCanvass: null,
    ftrPrepared: null,
    tasks: null,
  };
}

function accumulateRoleBucket(
  current: { closed: number; pending: number; efficiency: number } | null,
  incoming: PersonnelTicketMetric,
): { closed: number; pending: number; efficiency: number } {
  const closed = (current?.closed ?? 0) + incoming.closed;
  const pending = (current?.pending ?? 0) + incoming.pending;
  const total = closed + pending;
  return {
    closed,
    pending,
    efficiency: total > 0 ? Math.round((closed / total) * 100) : Math.round(incoming.efficiency),
  };
}

/** Attach RFP / IRS / FTR role KPIs onto personnel cards (Insights parity). */
export function attachPersonnelRequestRoleMetrics(
  cards: PersonnelCombinedMetricCard[],
  roles: {
    rfpAccounting?: PersonnelTicketMetric[];
    rfpFinance?: PersonnelTicketMetric[];
    irsCanvass?: PersonnelTicketMetric[];
    ftrPrepared?: PersonnelTicketMetric[];
  },
): PersonnelCombinedMetricCard[] {
  const byName = new Map(
    cards.map((card) => [personnelIdentityKey(card.name), card] as const).filter(([key]) => key),
  );

  const apply = (
    rows: PersonnelTicketMetric[] | undefined,
    field: keyof Pick<
      PersonnelCombinedMetricCard,
      "rfpAccounting" | "rfpFinance" | "irsCanvass" | "ftrPrepared"
    >,
    createIfMissing: boolean,
  ) => {
    for (const row of rows ?? []) {
      const key = personnelIdentityKey(row.name);
      if (!key) continue;
      let card = byName.get(key);
      if (!card) {
        if (!createIfMissing) continue;
        card = emptyPersonnelCard(row.id, row.name);
      }
      card[field] = accumulateRoleBucket(card[field], row);
      card.name = preferDisplayName(card.name, row.name);
      if (row.id) card.id = card.id || row.id;
      byName.set(key, card);
    }
  };

  apply(roles.rfpAccounting, "rfpAccounting", true);
  apply(roles.irsCanvass, "irsCanvass", true);
  apply(roles.ftrPrepared, "ftrPrepared", true);
  // Approver-only seat: never create a card from finance alone.
  apply(roles.rfpFinance, "rfpFinance", false);

  return consolidatePersonnelCards([...byName.values()]).sort((a, b) => {
    const aReq = mergePersonnelRequestMetrics(a)?.efficiency ?? -1;
    const bReq = mergePersonnelRequestMetrics(b)?.efficiency ?? -1;
    return bReq - aReq || a.name.localeCompare(b.name);
  });
}

export function mergePersonnelMetricCards(
  tasks: PersonnelAccumulatedTaskMetric[],
  tickets: PersonnelTicketMetric[],
): PersonnelCombinedMetricCard[] {
  const byName = new Map<string, PersonnelCombinedMetricCard>();

  for (const ticket of tickets) {
    const key = personnelIdentityKey(ticket.name);
    if (!key) continue;
    const current = byName.get(key) ?? emptyPersonnelCard(ticket.id, ticket.name);
    const closed = (current.tickets?.closed ?? 0) + ticket.closed;
    const pending = (current.tickets?.pending ?? 0) + ticket.pending;
    const total = closed + pending;
    current.tickets = {
      closed,
      pending,
      efficiency: total > 0 ? Math.round((closed / total) * 100) : Math.round(ticket.efficiency),
    };
    current.name = preferDisplayName(current.name, ticket.name);
    if (ticket.id) current.id = ticket.id;
    byName.set(key, current);
  }

  for (const task of tasks) {
    const key = personnelIdentityKey(task.name);
    if (!key) continue;
    const current = byName.get(key) ?? {
      id: task.id,
      name: task.name.trim(),
      role: task.role,
      tickets: null,
      rfpRequestor: null,
      rfpAccounting: null,
      rfpFinance: null,
      irsCanvass: null,
      ftrPrepared: null,
      tasks: null,
    };
    const normalized = normalizePersonnelTaskTotals(task.total, task.done);
    const closed = (current.tasks?.closed ?? 0) + normalized.closed;
    const pending = (current.tasks?.pending ?? 0) + normalized.pending;
    const penaltyDeduction = Math.max(
      task.penaltyDeduction ?? 0,
      current.tasks?.penaltyDeduction ?? 0,
    );
    const efficiencyBeforePenalty = normalizePersonnelTaskTotals(
      closed + pending,
      closed,
    ).efficiency;
    const efficiency =
      penaltyDeduction > 0
        ? applyPenaltyToTaskEfficiency(efficiencyBeforePenalty, penaltyDeduction)
        : efficiencyBeforePenalty;
    current.tasks = {
      pending,
      closed,
      efficiency,
      pillarsContributed: Math.max(
        task.pillarsContributed,
        current.tasks?.pillarsContributed ?? 0,
      ),
      ...(penaltyDeduction > 0
        ? { penaltyDeduction, efficiencyBeforePenalty }
        : {}),
    };
    current.role = mergeRoles(current.role, task.role);
    current.name = preferDisplayName(current.name, task.name);
    if (task.id && task.id !== "__unassigned__") current.id = task.id;
    byName.set(key, current);
  }

  return consolidatePersonnelCards([...byName.values()])
    .filter((row) => row.tickets != null || row.tasks != null)
    .sort((a, b) => {
      const aEff = Math.max(a.tickets?.efficiency ?? 0, a.tasks?.efficiency ?? 0);
      const bEff = Math.max(b.tickets?.efficiency ?? 0, b.tasks?.efficiency ?? 0);
      const aClosed = (a.tickets?.closed ?? 0) + (a.tasks?.closed ?? 0);
      const bClosed = (b.tickets?.closed ?? 0) + (b.tasks?.closed ?? 0);
      return bEff - aEff || bClosed - aClosed || a.name.localeCompare(b.name);
    });
}

/** Roll up contributor rows across checklist pillars into per-personnel accumulated task metrics. */
export function aggregatePersonnelTaskMetrics(
  checklistPillars: TaskChecklistPillarMetrics | null,
): PersonnelAccumulatedTaskMetric[] {
  const byKey = new Map<
    string,
    {
      id: string;
      name: string;
      roles: Set<string>;
      total: number;
      done: number;
      pillars: Set<string>;
    }
  >();

  for (const [pillar, metric] of Object.entries(checklistPillars ?? {})) {
    const contributorRows = metric?.assigneeProgressAccumulated ?? metric?.assigneeProgress ?? [];
    for (const row of contributorRows) {
      if (!row.name.trim() || row.id === "__unassigned__") continue;
      const key = personnelIdentityKey(row.name) ||
        (row.id && row.id !== "__unassigned__" ? row.id : normalizePersonName(row.name));
      if (!key) continue;
      const current = byKey.get(key) ?? {
        id: row.id,
        name: row.name,
        roles: new Set<string>(),
        total: 0,
        done: 0,
        pillars: new Set<string>(),
      };
      current.roles.add(row.role);
      current.total += row.total;
      current.done += row.done;
      current.name = preferDisplayName(current.name, row.name);
      if (row.total > 0) current.pillars.add(pillar);
      byKey.set(key, current);
    }
  }

  return [...byKey.values()]
    .map((row) => {
      const total = row.total;
      const done = Math.min(row.done, total);
      const roles = [...row.roles].sort();
      const role =
        roles.includes("Assignee") && roles.includes("Sub-assignee") ? "Assignee" : roles.join(" / ");
      const normalized = normalizePersonnelTaskTotals(total, done);
      return {
        id: row.id,
        name: row.name,
        role,
        total: normalized.pending + normalized.closed,
        done: normalized.closed,
        remaining: normalized.pending,
        percent: normalized.efficiency,
        pillarsContributed: row.pillars.size,
      };
    })
    .filter((row) => row.total > 0)
    .sort((a, b) => b.percent - a.percent || b.done - a.done || a.name.localeCompare(b.name));
}
