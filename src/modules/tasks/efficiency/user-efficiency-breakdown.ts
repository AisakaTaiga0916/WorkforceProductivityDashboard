/**
 * User Efficiency Breakdown — period rollups + task drill-down.
 *
 * ## Database roles
 *
 * - **Primary PostgreSQL** owns live task / KPI / ticket rows (source of truth).
 * - **Merged MySQL** is dump/fetch only: this module reads primary, then upserts
 *   `merged_user_efficiency_breakdowns` (+ task details) via DATABASE_URL_SECONDARY_SYNC.
 * - Insights Personnel fetches the dump; it does not write overall KPI back to primary.
 *
 * ## Overall efficiency calculation
 *
 * For each (merged user × periodKey × frequency):
 *
 * 1. **Board tasks (TaskItem)** in `[periodStart, periodEnd)` assigned to the user's agent:
 *    - Count CURRENT + DONE + DELAYED into total/completed/delayed
 *    - Accrue delay penalty via `delayPenaltyFrequency` (DAILY / WEEKLY ceil÷7 / MONTHLY ceil÷30)
 *
 * 2. **KPI checklist + IT project phase subtasks** (always merged with board tasks):
 *    - Live non-recurring / IT project items attributed to assignees
 *    - Recurring checklist progress from period snapshots always merged alongside
 *      board / IT / live one-off checklist (penalties only reduce efficiency %)
 *    - Accrue frequency-aware penalties; detail `taskSource` KPI_CHECKLIST | IT_PROJECT_SUBTASK
 *
 * 3. Per person: merge TaskItem + project/checklist counts; `taskEfficiencyBeforePenalty` =
 *    done / (done + current) × 100; then subtract `delayPenaltyTotal` (floor 50%).
 *
 * 4. **Ticket efficiency** (Insights parity, tickets stay in primary PG):
 *    - closed / (open_or_in_progress + closed) × 100 in the period window
 *
 * 5. **overallEfficiency** = mean of available {taskEfficiency, ticketEfficiency},
 *    then floor at 50 (see `combinedPersonnelEfficiency` / `PERSONNEL_AVERAGE_EFFICIENCY_FLOOR`).
 *
 * Idempotent: unique (sourceUserId, periodKey, frequency); replace-in-place per period.
 * Write path always runs `ensureUserEfficiencyBreakdownTables` before upserts so dump
 * columns (tickets_*, delay_penalty_*) exist on older merged DBs.
 */
import { randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import { Prisma, PrismaClient as PrismaClientSecondary } from "@prisma/client/secondary";
import {
  bootstrapMysqlUrl,
  ensureUserEfficiencyBreakdownTables,
  parseMysqlDatabaseName,
} from "../../../../scripts/ensure-merged-task-kpi-tables";
import {
  normalizeDelayPenaltyFrequency,
  penaltyAccrualUnits,
} from "@/modules/tasks/delay-penalty-frequency";
import { isItProjectImplementationPillar } from "@/modules/tasks/it-task-pillar-titles";
import {
  findItProjectPhaseForSubKpi,
  isItProjectEnvelope,
  isItProjectSubTaskDelayed,
  itProjectChecklistItems,
  parseItProjectSubKpis,
} from "@/modules/tasks/it-project-subkpis";
import { helpdeskSupportPercent } from "@/modules/tasks/kpis";
import { OPEN_PIPELINE_STATUSES } from "@/modules/requests/active-request-statuses";
import { kpiMainTaskLabel } from "@/modules/tasks/kpi-main-task";
import { normalizePersonName } from "@/lib/person-name";
import { DEFAULT_TIME_ZONE, normalizeTimeZone, type KpiFrequencyCode } from "@/modules/tasks/kpi-recurrence";
import {
  collectChecklistProgressItems,
  subKpiProgressOwner,
  taskDailyPenaltyAmountFromSubKpis,
  taskDelayPenaltyFrequencyFromSubKpis,
} from "@/modules/tasks/kpi-subkpis";
import { prismaPrimary } from "@/modules/platform/db/prisma";
import { subKpiRequirementsMet } from "@/modules/tasks/sub-kpi-completion-mode";
import {
  buildCanonicalMergedIdMap,
  canonicalMergedId,
} from "@/lib/sync/merged-person-identity";
import { subKpiAccruedPenalty, type SubKpiPenaltyContext } from "@/modules/tasks/task-delay-penalty";
import {
  applyPenaltyToTaskEfficiency,
  applyPersonnelAverageEfficiencyFloor,
  normalizePersonnelTaskTotals,
} from "@/modules/tasks/task-personnel-metrics";

export type EfficiencyFrequency = KpiFrequencyCode | "YEARLY" | "LIFETIME";

export type ComputeUserEfficiencyOptions = {
  dryRun?: boolean;
  /** Frequencies to materialize. Default: MONTHLY + WEEKLY. */
  frequencies?: EfficiencyFrequency[];
  /** How many periods back from "now" to recompute (inclusive of current). */
  lookbackPeriods?: number;
  timeZone?: string;
  sourceTag?: string;
};

export type ComputeUserEfficiencyResult = {
  dryRun: boolean;
  targetDb: string;
  periods: Array<{ frequency: EfficiencyFrequency; periodKey: string }>;
  upsertedBreakdowns: number;
  upsertedDetails: number;
  skippedNoMergedUser: number;
};

type AgentEnrichment = {
  agentId: string;
  email: string;
  name: string;
  mergedSourceUserId: bigint;
  portalAccountId: string | null;
};

type TaskRow = {
  id: string;
  title: string;
  status: "CURRENT" | "DONE" | "DELAYED";
  dueAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  delayPenaltyAccrued: number;
  delayPenaltyAmount: number | null;
  delayPenaltyFrequency: string;
  assignedAgentId: string | null;
};

type ChecklistWorkRow = {
  agentId: string;
  ownerName: string;
  taskId: string | null;
  taskSource: "KPI_CHECKLIST" | "IT_PROJECT_SUBTASK" | "TRAVEL_ORDER" | "JOB_ORDER";
  taskTitle: string;
  status: "CURRENT" | "DONE" | "DELAYED";
  dueAt: Date | null;
  completedAt: Date | null;
  delayPenaltyAccrued: number;
};

type ChecklistSnapshotRollup = {
  total: number;
  done: number;
  title: string;
};

type PersonGroupRef = {
  mergedSourceUserId: bigint;
  agentIds: string[];
  name: string;
};

type PeriodWindow = {
  frequency: EfficiencyFrequency;
  periodKey: string;
  start: Date;
  end: Date;
};

function env(name: string, fallback: string): string {
  const v = process.env[name]?.trim();
  return v || fallback;
}

function resolveSecondaryWriteUrl(): string {
  const explicit = process.env.DATABASE_URL_SECONDARY_SYNC?.trim();
  if (explicit) return explicit;
  const appUrl = process.env.DATABASE_URL_SECONDARY?.trim();
  if (appUrl && !appUrl.includes("merge_app@")) return appUrl;
  return "mysql://root@localhost:3306/mergedatabase-demo";
}

/** Reporting period keys: 2026-07-14 | 2026-W28 | 2026-07 | 2026-Q3 | 2026-H1 | 2026 */
export function buildReportingPeriodKey(
  frequency: EfficiencyFrequency,
  at: DateTime,
): string {
  switch (frequency) {
    case "DAILY":
      return at.toISODate() ?? at.toFormat("yyyy-MM-dd");
    case "WEEKLY": {
      const week = at.weekNumber.toString().padStart(2, "0");
      return `${at.weekYear}-W${week}`;
    }
    case "MONTHLY":
      return at.toFormat("yyyy-MM");
    case "QUARTERLY":
      return `${at.year}-Q${at.quarter}`;
    case "SEMI_ANNUAL": {
      const half = at.month <= 6 ? 1 : 2;
      return `${at.year}-H${half}`;
    }
    case "YEARLY":
      return String(at.year);
    case "LIFETIME":
      return "LIFETIME";
    default:
      return at.toFormat("yyyy-MM");
  }
}

export function periodWindowFor(
  frequency: EfficiencyFrequency,
  at: DateTime,
): PeriodWindow {
  const z = at.zoneName ?? "Asia/Manila";
  let start: DateTime;
  let end: DateTime;
  switch (frequency) {
    case "DAILY":
      start = at.startOf("day");
      end = start.plus({ days: 1 });
      break;
    case "WEEKLY":
      start = at.startOf("week"); // Monday in Luxon ISO
      end = start.plus({ weeks: 1 });
      break;
    case "MONTHLY":
      start = at.startOf("month");
      end = start.plus({ months: 1 });
      break;
    case "QUARTERLY":
      start = at.startOf("quarter");
      end = start.plus({ months: 3 });
      break;
    case "SEMI_ANNUAL": {
      const halfStartMonth = at.month <= 6 ? 1 : 7;
      start = at.set({ month: halfStartMonth, day: 1 }).startOf("day");
      end = start.plus({ months: 6 });
      break;
    }
    case "YEARLY":
      start = at.startOf("year");
      end = start.plus({ years: 1 });
      break;
    case "LIFETIME":
      start = DateTime.fromObject({ year: 2000, month: 1, day: 1 }, { zone: z });
      end = at.endOf("day").plus({ days: 1 });
      break;
    default:
      start = at.startOf("month");
      end = start.plus({ months: 1 });
  }
  return {
    frequency,
    periodKey: buildReportingPeriodKey(frequency, start.setZone(z)),
    start: start.toJSDate(),
    end: end.toJSDate(),
  };
}

export function listRecentPeriods(
  frequency: EfficiencyFrequency,
  lookbackPeriods: number,
  timeZone: string,
  now = new Date(),
): PeriodWindow[] {
  const zone = normalizeTimeZone(timeZone);
  let cursor = DateTime.fromJSDate(now, { zone });
  const out: PeriodWindow[] = [];
  const n = Math.max(1, lookbackPeriods);
  for (let i = 0; i < n; i++) {
    out.push(periodWindowFor(frequency, cursor));
    switch (frequency) {
      case "DAILY":
        cursor = cursor.minus({ days: 1 });
        break;
      case "WEEKLY":
        cursor = cursor.minus({ weeks: 1 });
        break;
      case "MONTHLY":
        cursor = cursor.minus({ months: 1 });
        break;
      case "QUARTERLY":
        cursor = cursor.minus({ months: 3 });
        break;
      case "SEMI_ANNUAL":
        cursor = cursor.minus({ months: 6 });
        break;
      case "YEARLY":
        cursor = cursor.minus({ years: 1 });
        break;
      case "LIFETIME":
        break;
    }
  }
  return out;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

async function loadAgentEnrichment(): Promise<AgentEnrichment[]> {
  const agents = await prismaPrimary.agent.findMany({
    select: { id: true, email: true, name: true },
  });
  const portals = await prismaPrimary.portalAccount.findMany({
    where: { mergedSourceUserId: { not: null } },
    select: {
      id: true,
      email: true,
      name: true,
      mergedSourceUserId: true,
      accountStatus: true,
    },
  });

  const byEmail = new Map<string, (typeof portals)[number]>();
  const sorted = [...portals].sort((a, b) => {
    const aL = a.accountStatus === "LEGACY_CONFLICT" ? 1 : 0;
    const bL = b.accountStatus === "LEGACY_CONFLICT" ? 1 : 0;
    return aL - bL;
  });
  for (const p of sorted) {
    const key = p.email.trim().toLowerCase();
    if (!byEmail.has(key)) byEmail.set(key, p);
  }

  const personTokens = (name: string) =>
    new Set(
      name
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[,.]/g, " ")
        .split(/\s+/)
        .filter((t) => t.length > 1),
    );

  const linked = portals.filter((p) => p.mergedSourceUserId != null);
  const out: AgentEnrichment[] = [];

  for (const agent of agents) {
    let portal = byEmail.get(agent.email.trim().toLowerCase()) ?? null;
    if (!portal?.mergedSourceUserId) {
      const at = personTokens(agent.name);
      let best: (typeof linked)[number] | null = null;
      let bestScore = 0;
      for (const p of linked) {
        const overlap = [...at].filter((t) => personTokens(p.name).has(t)).length;
        if (overlap >= 2 && overlap > bestScore) {
          best = p;
          bestScore = overlap;
        }
      }
      portal = best;
    }
    if (!portal?.mergedSourceUserId) continue;
    out.push({
      agentId: agent.id,
      email: agent.email,
      name: agent.name,
      mergedSourceUserId: portal.mergedSourceUserId,
      portalAccountId: portal.id,
    });
  }
  return out;
}

async function loadTasksInWindow(start: Date, end: Date): Promise<TaskRow[]> {
  const rows = await prismaPrimary.taskItem.findMany({
    where: {
      OR: [
        { createdAt: { gte: start, lt: end } },
        { updatedAt: { gte: start, lt: end } },
        { completedAt: { gte: start, lt: end } },
        { dueAt: { gte: start, lt: end } },
      ],
    },
    select: {
      id: true,
      title: true,
      status: true,
      dueAt: true,
      createdAt: true,
      updatedAt: true,
      startedAt: true,
      completedAt: true,
      delayPenaltyAccrued: true,
      delayPenaltyAmount: true,
      delayPenaltyFrequency: true,
      assignedAgentId: true,
    },
  });
  return rows as TaskRow[];
}

function ymdToDate(ymd: string | null | undefined, timeZone: string): Date | null {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd.trim())) return null;
  const dt = DateTime.fromISO(ymd.trim(), { zone: normalizeTimeZone(timeZone) }).startOf("day");
  return dt.isValid ? dt.toJSDate() : null;
}

/**
 * Live KPI checklist + IT project subtasks for the window.
 * Always merged with TaskItem work (not a fallback-only path).
 */
async function loadProjectAndChecklistWorkInWindow(
  start: Date,
  end: Date,
  timeZone: string,
): Promise<Map<string, ChecklistWorkRow[]>> {
  const nowMs = Math.min(Date.now(), end.getTime() - 1);
  const kpis = await prismaPrimary.kpiMaintenance.findMany({
      where: {
      OR: [
        { title: "IT PROJECT IMPLEMENTATION" },
        { isRecurring: false },
      ],
    },
    select: {
      id: true,
      title: true,
      mainTask: true,
      frequency: true,
      isRecurring: true,
      subKpis: true,
      assignedAgentId: true,
      assignedAgent: { select: { id: true, name: true } },
      createdAt: true,
      updatedAt: true,
    },
  });

  const byAgent = new Map<string, ChecklistWorkRow[]>();

  for (const kpi of kpis) {
    const inWindow =
      (kpi.createdAt >= start && kpi.createdAt < end) ||
      (kpi.updatedAt >= start && kpi.updatedAt < end) ||
      isItProjectImplementationPillar(kpi.title) ||
      kpi.isRecurring === false;
    if (!inWindow) continue;

    const isIt = isItProjectImplementationPillar(kpi.title) || isItProjectEnvelope(kpi.subKpis);
    const taskDailyPenaltyAmount = taskDailyPenaltyAmountFromSubKpis(kpi.subKpis);
    const taskDelayPenaltyFrequency = taskDelayPenaltyFrequencyFromSubKpis(kpi.subKpis);
    const parentAssignee = kpi.assignedAgent
      ? { id: kpi.assignedAgent.id, name: kpi.assignedAgent.name }
      : kpi.assignedAgentId
        ? { id: kpi.assignedAgentId, name: "Assignee" }
        : null;

    if (isIt) {
      const data = parseItProjectSubKpis(kpi.subKpis);
      for (const item of itProjectChecklistItems(kpi.subKpis)) {
        if (!item.title.trim()) continue;
        const owner = subKpiProgressOwner(item, parentAssignee);
        if (owner.id === "__unassigned__") continue;
        const phase = findItProjectPhaseForSubKpi(data, item.id);
        const dueYmd = item.dueDate ?? phase?.dueDate ?? null;
        const dueAt = ymdToDate(dueYmd, timeZone);
        const completedAt = ymdToDate(item.actualDate, timeZone);
        const done = Boolean(item.actualDate) || subKpiRequirementsMet(item);
        const delayed =
          !done &&
          isItProjectSubTaskDelayed(
            { ...item, dueDate: dueYmd ?? item.dueDate },
            nowMs,
            timeZone,
          );
        const penaltyCtx: SubKpiPenaltyContext = {
          nowMs,
          timeZone,
          frequency: kpi.frequency as KpiFrequencyCode,
          isRecurring: false,
          title: kpi.title,
          taskDailyPenaltyAmount,
          taskDelayPenaltyFrequency,
          phaseDueDate: phase?.dueDate ?? null,
        };
        const penalty = subKpiAccruedPenalty(item, penaltyCtx);
        const row: ChecklistWorkRow = {
          agentId: owner.id,
          ownerName: owner.name,
          taskId: item.id,
          taskSource: "IT_PROJECT_SUBTASK",
          taskTitle: `${kpiMainTaskLabel(kpi)} · ${item.title}`.slice(0, 512),
          status: done ? "DONE" : delayed ? "DELAYED" : "CURRENT",
          dueAt,
          completedAt,
          delayPenaltyAccrued: Math.round(penalty),
        };
        const list = byAgent.get(owner.id) ?? [];
        list.push(row);
        byAgent.set(owner.id, list);
      }
      continue;
    }

    if (kpi.isRecurring !== false) continue;
    const items = collectChecklistProgressItems(kpi.subKpis, kpiMainTaskLabel(kpi));
    for (const item of items) {
      if (!item.title.trim()) continue;
      const owner = subKpiProgressOwner(item, parentAssignee);
      if (owner.id === "__unassigned__") continue;
      const dueAt = ymdToDate(item.dueDate, timeZone);
      const completedAt = ymdToDate(item.actualDate, timeZone);
      const done = subKpiRequirementsMet(item);
      const penaltyCtx: SubKpiPenaltyContext = {
        nowMs,
        timeZone,
        frequency: kpi.frequency as KpiFrequencyCode,
        isRecurring: false,
        title: kpi.title,
        taskDailyPenaltyAmount,
        taskDelayPenaltyFrequency,
      };
      const delayed = !done && subKpiAccruedPenalty(item, penaltyCtx) > 0;
      const penalty = subKpiAccruedPenalty(item, penaltyCtx);
      const row: ChecklistWorkRow = {
        agentId: owner.id,
        ownerName: owner.name,
        taskId: item.id,
        taskSource: "KPI_CHECKLIST",
        taskTitle: `${kpiMainTaskLabel(kpi)} · ${item.title}`.slice(0, 512),
        status: done ? "DONE" : delayed ? "DELAYED" : "CURRENT",
        dueAt,
        completedAt,
        delayPenaltyAccrued: Math.round(penalty),
      };
      const list = byAgent.get(owner.id) ?? [];
      list.push(row);
      byAgent.set(owner.id, list);
    }
  }

  return byAgent;
}

/**
 * Confirmed Travel Orders in the window — one DONE row per traveler (Field Assignment credit).
 */
async function loadConfirmedTravelWorkInWindow(
  start: Date,
  end: Date,
): Promise<Map<string, ChecklistWorkRow[]>> {
  const { parseTravelerAgentIds } = await import("@/modules/work-plans/travel-order");
  const { TRAVEL_ORDER_STATUS } = await import("@/modules/work-plans/travel-order");

  const rows = await prismaPrimary.$queryRaw<
    Array<{
      id: string;
      order_request: string;
      traveler_agent_ids: unknown;
      created_by_agent_id: string | null;
      updated_at: Date;
    }>
  >`
    SELECT id, order_request, traveler_agent_ids, created_by_agent_id, updated_at
    FROM travel_orders
    WHERE status = ${TRAVEL_ORDER_STATUS.CONFIRMED}
      AND updated_at >= ${start}
      AND updated_at < ${end}
  `;

  const agentIds = new Set<string>();
  const parsed = rows.map((r) => {
    const travelers = parseTravelerAgentIds(r.traveler_agent_ids, r.created_by_agent_id);
    for (const id of travelers) agentIds.add(id);
    return { ...r, travelers };
  });

  const nameById = new Map<string, string>();
  if (agentIds.size > 0) {
    const agents = await prismaPrimary.agent.findMany({
      where: { id: { in: [...agentIds] } },
      select: { id: true, name: true },
    });
    for (const a of agents) nameById.set(a.id, a.name);
  }

  const byAgent = new Map<string, ChecklistWorkRow[]>();
  for (const row of parsed) {
    const title = (row.order_request?.trim() || "Travel Order").slice(0, 512);
    const completedAt =
      row.updated_at instanceof Date ? row.updated_at : new Date(row.updated_at);
    for (const agentId of row.travelers) {
      const work: ChecklistWorkRow = {
        agentId,
        ownerName: nameById.get(agentId) ?? "Traveler",
        taskId: row.id,
        taskSource: "TRAVEL_ORDER",
        taskTitle: title,
        status: "DONE",
        dueAt: null,
        completedAt,
        delayPenaltyAccrued: 0,
      };
      const list = byAgent.get(agentId) ?? [];
      list.push(work);
      byAgent.set(agentId, list);
    }
  }
  return byAgent;
}

/**
 * Green-lit Job Orders in the window — one DONE row per assignee + listed co-worker (execution credit).
 */
async function loadJobOrderWorkerWorkInWindow(
  start: Date,
  end: Date,
): Promise<Map<string, ChecklistWorkRow[]>> {
  const { parseJobOrderApprovalMeta } = await import("@/modules/requests/job-order-approval");
  const { jobOrderKpiCreditAgentIds } = await import("@/modules/requests/job-order-workers");

  const rows = await prismaPrimary.$queryRaw<
    Array<{
      id: string;
      title: string;
      ticket_number: string;
      assigned_agent_id: string | null;
      job_order_approval_meta: unknown;
      linked_kpi_maintenance_id: string | null;
      project_assignee_id: string | null;
      updated_at: Date;
    }>
  >`
    SELECT
      t.id,
      t.title,
      t.ticket_number,
      t.assigned_agent_id,
      t.job_order_approval_meta,
      t.linked_kpi_maintenance_id,
      k.assigned_agent_id AS project_assignee_id,
      t.updated_at
    FROM tickets t
    LEFT JOIN kpi_maintenance k ON k.id = t.linked_kpi_maintenance_id
    WHERE t.request_type = 'JOB_ORDER'
      AND t.job_order_approval_meta->>'proceduralStep' = 'DONE'
      AND t.status IN ('FOR_CONFIRMATION', 'RESOLVED', 'CLOSED')
      AND t.updated_at >= ${start}
      AND t.updated_at < ${end}
  `;

  const agentIds = new Set<string>();
  const parsed = rows.map((row) => {
    const meta = parseJobOrderApprovalMeta(row.job_order_approval_meta);
    const creditIds = jobOrderKpiCreditAgentIds({
      meta,
      ticketAssignedAgentId: row.assigned_agent_id,
      linkedProjectAssigneeId: row.project_assignee_id,
    });
    for (const id of creditIds) agentIds.add(id);
    return { ...row, meta, creditIds };
  });

  const nameById = new Map<string, string>();
  if (agentIds.size > 0) {
    const agents = await prismaPrimary.agent.findMany({
      where: { id: { in: [...agentIds] } },
      select: { id: true, name: true },
    });
    for (const agent of agents) nameById.set(agent.id, agent.name);
  }

  const byAgent = new Map<string, ChecklistWorkRow[]>();
  for (const row of parsed) {
    const title = (row.title?.trim() || row.ticket_number || "Job Order").slice(0, 512);
    const completedAt =
      row.updated_at instanceof Date ? row.updated_at : new Date(row.updated_at);
    for (const agentId of row.creditIds) {
      const work: ChecklistWorkRow = {
        agentId,
        ownerName: nameById.get(agentId) ?? "Co-worker",
        taskId: row.id,
        taskSource: "JOB_ORDER",
        taskTitle: title,
        status: "DONE",
        dueAt: null,
        completedAt,
        delayPenaltyAccrued: 0,
      };
      const list = byAgent.get(agentId) ?? [];
      list.push(work);
      byAgent.set(agentId, list);
    }
  }
  return byAgent;
}

function agentIdsForMergedPerson(
  group: PersonGroupRef,
  agents: AgentEnrichment[],
  canonicalIds: Map<string, bigint>,
): string[] {
  const key = group.mergedSourceUserId.toString();
  const ids = new Set(group.agentIds);
  for (const agent of agents) {
    if (canonicalMergedId(agent.mergedSourceUserId, canonicalIds).toString() === key) {
      ids.add(agent.agentId);
    }
  }
  return [...ids];
}

function dedupeProjectRows(rows: ChecklistWorkRow[]): ChecklistWorkRow[] {
  const seen = new Set<string>();
  const out: ChecklistWorkRow[] = [];
  for (const row of rows) {
    const key = `${row.taskSource}:${row.taskId ?? row.taskTitle}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

/** Pull IT / live checklist rows for a merged person, including duplicate agent rows. */
function collectProjectRowsForGroup(
  group: PersonGroupRef,
  projectWork: Map<string, ChecklistWorkRow[]>,
  agents: AgentEnrichment[],
  canonicalIds: Map<string, bigint>,
): ChecklistWorkRow[] {
  const linkedIds = new Set(agentIdsForMergedPerson(group, agents, canonicalIds));
  const rows: ChecklistWorkRow[] = [];
  for (const id of linkedIds) {
    const list = projectWork.get(id);
    if (list?.length) rows.push(...list);
  }

  const personName = normalizePersonName(group.name).toLowerCase();
  for (const [agentId, list] of projectWork) {
    if (linkedIds.has(agentId)) continue;
    for (const row of list) {
      if (normalizePersonName(row.ownerName).toLowerCase() !== personName) continue;
      rows.push(row);
    }
  }
  return dedupeProjectRows(rows);
}

/**
 * Recurring KPI checklist totals from period snapshots.
 * Always additive with board / IT / live one-off rows — penalties only affect efficiency.
 */
function collectChecklistSnapshotForGroup(
  group: PersonGroupRef,
  checklistFallback: Map<
    string,
    {
      total: number;
      done: number;
      details: Array<{ title: string; done: number; total: number }>;
    }
  >,
  agents: AgentEnrichment[],
  canonicalIds: Map<string, bigint>,
): ChecklistSnapshotRollup | null {
  const linkedIds = agentIdsForMergedPerson(group, agents, canonicalIds);
  const matchedIds = new Set<string>();
  let total = 0;
  let done = 0;

  for (const id of linkedIds) {
    const part = checklistFallback.get(id);
    if (!part || part.total <= 0) continue;
    matchedIds.add(id);
    total += part.total;
    done += part.done;
  }

  const personName = normalizePersonName(group.name).toLowerCase();
  for (const [id, part] of checklistFallback) {
    if (matchedIds.has(id) || part.total <= 0) continue;
    const label =
      part.details.find((d) => d.title.trim())?.title.replace(/^KPI checklist · /i, "").trim() ?? "";
    if (!label || normalizePersonName(label).toLowerCase() !== personName) continue;
    matchedIds.add(id);
    total += part.total;
    done += part.done;
  }

  if (total <= 0) return null;
  return {
    total,
    done,
    title: `KPI checklist · ${group.name}`,
  };
}

/**
 * Snapshot-based recurring checklist contributor totals for the period.
 */
async function loadChecklistFallbackByAgent(
  start: Date,
  end: Date,
): Promise<
  Map<
    string,
    {
      total: number;
      done: number;
      details: Array<{ title: string; done: number; total: number }>;
    }
  >
> {
  const snapshots = await prismaPrimary.kpiMaintenancePeriodSnapshot.findMany({
    where: { capturedAt: { gte: start, lt: end } },
    select: { contributorProgress: true },
  });

  const byAgent = new Map<
    string,
    { total: number; done: number; details: Array<{ title: string; done: number; total: number }> }
  >();

  for (const snap of snapshots) {
    const raw = snap.contributorProgress;
    if (!Array.isArray(raw)) continue;
    for (const entry of raw) {
      if (!entry || typeof entry !== "object") continue;
      const row = entry as Record<string, unknown>;
      const id = typeof row.id === "string" ? row.id : "";
      const name = typeof row.name === "string" ? row.name : "";
      const total = Number(row.total);
      const done = Number(row.done);
      if (!id || id === "__unassigned__" || !Number.isFinite(total) || total <= 0) continue;
      const current = byAgent.get(id) ?? { total: 0, done: 0, details: [] };
      current.total += total;
      current.done += Math.min(done, total);
      current.details.push({
        title: name ? `KPI checklist · ${name}` : "KPI checklist contribution",
        done: Math.min(done, total),
        total,
      });
      byAgent.set(id, current);
    }
  }
  return byAgent;
}

function boardTaskPenalty(t: TaskRow, nowMs: number): number {
  if (t.delayPenaltyAccrued > 0) return t.delayPenaltyAccrued;
  const rate = t.delayPenaltyAmount ?? 0;
  if (rate <= 0 || !t.dueAt) return 0;
  const zone = DEFAULT_TIME_ZONE;
  const dueDay = DateTime.fromJSDate(t.dueAt, { zone }).startOf("day");
  const endSource = t.completedAt ?? (t.status === "DONE" ? t.updatedAt : new Date(nowMs));
  const endDay = DateTime.fromJSDate(endSource, { zone }).startOf("day");
  if (!dueDay.isValid || !endDay.isValid) return 0;
  const delayStart = dueDay.plus({ days: 1 });
  if (endDay < delayStart) return 0;
  const days = Math.floor(endDay.diff(delayStart, "days").days) + 1;
  const units = penaltyAccrualUnits(days, normalizeDelayPenaltyFrequency(t.delayPenaltyFrequency));
  return Math.max(0, Math.round(rate * units));
}

/** Procedural RFPs / IRS / FTR use role-seat KPIs — never board-assignee credit. */
const PROCEDURAL_REQUEST_TYPES = [
  "REQUEST_FOR_PAYMENT",
  "ITEM_REQUISITION_SLIP",
  "FUND_TRANSFER_REQUEST",
] as const;

async function loadTicketCountsByAgent(
  start: Date,
  end: Date,
): Promise<Map<string, { closed: number; pending: number }>> {
  // Match Insights assignee ticket KPI: Issue/Concern / Job Order / etc. only.
  // Approvers who are board assignees on procedural RFPs must not get Requests credit here.
  const [closedByAgent, pendingByAgent] = await Promise.all([
    prismaPrimary.ticket.groupBy({
      by: ["assignedAgentId"],
      where: {
        assignedAgentId: { not: null },
        NOT: { requestType: { in: [...PROCEDURAL_REQUEST_TYPES] } },
        closedAt: { gte: start, lt: end },
      },
      _count: true,
    }),
    prismaPrimary.ticket.groupBy({
      by: ["assignedAgentId"],
      where: {
        assignedAgentId: { not: null },
        NOT: { requestType: { in: [...PROCEDURAL_REQUEST_TYPES] } },
        status: { in: OPEN_PIPELINE_STATUSES },
      },
      _count: true,
    }),
  ]);

  const out = new Map<string, { closed: number; pending: number }>();
  for (const row of closedByAgent) {
    if (!row.assignedAgentId) continue;
    const cur = out.get(row.assignedAgentId) ?? { closed: 0, pending: 0 };
    cur.closed += row._count;
    out.set(row.assignedAgentId, cur);
  }
  for (const row of pendingByAgent) {
    if (!row.assignedAgentId) continue;
    const cur = out.get(row.assignedAgentId) ?? { closed: 0, pending: 0 };
    cur.pending += row._count;
    out.set(row.assignedAgentId, cur);
  }
  return out;
}

function computeOverall(
  taskEfficiency: number | null,
  ticketEfficiency: number | null,
): number {
  const values = [taskEfficiency, ticketEfficiency].filter(
    (v): v is number => v != null && Number.isFinite(v),
  );
  if (values.length === 0) return applyPersonnelAverageEfficiencyFloor(0);
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  return applyPersonnelAverageEfficiencyFloor(avg);
}

export async function runComputeUserEfficiencyBreakdowns(
  options?: ComputeUserEfficiencyOptions,
): Promise<ComputeUserEfficiencyResult> {
  const dryRun = options?.dryRun ?? false;
  const frequencies = options?.frequencies ?? (["MONTHLY", "WEEKLY"] as EfficiencyFrequency[]);
  const lookbackPeriods = options?.lookbackPeriods ?? 3;
  const timeZone = normalizeTimeZone(options?.timeZone ?? "Asia/Manila");
  const sourceTag = options?.sourceTag ?? env("TICKETING_MERGE_SOURCE_TAG", "ticketing_system");

  const writeUrl = resolveSecondaryWriteUrl();
  const targetDb = parseMysqlDatabaseName(writeUrl) ?? "mergedatabase-demo";
  const bootstrapUrl = bootstrapMysqlUrl(writeUrl);

  const prismaBootstrap = new PrismaClientSecondary({
    datasources: { db: { url: bootstrapUrl } },
  });
  const prismaWrite = new PrismaClientSecondary({
    datasources: { db: { url: writeUrl } },
  });

  const periods = frequencies.flatMap((f) => listRecentPeriods(f, lookbackPeriods, timeZone));

  const result: ComputeUserEfficiencyResult = {
    dryRun,
    targetDb,
    periods: periods.map((p) => ({ frequency: p.frequency, periodKey: p.periodKey })),
    upsertedBreakdowns: 0,
    upsertedDetails: 0,
    skippedNoMergedUser: 0,
  };

  try {
    // Ensure dump tables/columns on the write URL before Prisma upserts overall KPI.
    await prismaBootstrap.$connect();
    try {
      await ensureUserEfficiencyBreakdownTables(prismaBootstrap, targetDb);
    } catch (e) {
      console.error(
        "[user-efficiency] ensureUserEfficiencyBreakdownTables failed (write path)",
        e,
      );
      throw e;
    }
    await prismaBootstrap.$disconnect();

    await prismaWrite.$connect();
    await prismaPrimary.$connect();

    const agents = await loadAgentEnrichment();
    const agentById = new Map(agents.map((a) => [a.agentId, a]));

    const existingUsers = await prismaWrite.mergedUser.findMany({
      select: { sourceUserId: true, name: true, email: true },
    });
    const mergedUserIds = new Set(existingUsers.map((u) => u.sourceUserId.toString()));
    // Portal-synthetic merged ids (>= 9e9) fold into their HRIS person so the
    // breakdown lands on the row the personnel tab shows (with company/role).
    const canonicalIds = buildCanonicalMergedIdMap(existingUsers);
    const mergedNameById = new Map(
      existingUsers.map((u) => [u.sourceUserId.toString(), u.name] as const),
    );

    for (const period of periods) {
      const upsertedSourceUserIds = new Set<string>();
      const nowMs = Math.min(Date.now(), period.end.getTime() - 1);
      const tasks = await loadTasksInWindow(period.start, period.end);
      const ticketCounts = await loadTicketCountsByAgent(period.start, period.end);
      const projectWork = await loadProjectAndChecklistWorkInWindow(
        period.start,
        period.end,
        timeZone,
      );
      const travelWork = await loadConfirmedTravelWorkInWindow(period.start, period.end);
      for (const [agentId, rows] of travelWork) {
        const list = projectWork.get(agentId) ?? [];
        list.push(...rows);
        projectWork.set(agentId, list);
      }
      const jobOrderWork = await loadJobOrderWorkerWorkInWindow(period.start, period.end);
      for (const [agentId, rows] of jobOrderWork) {
        const list = projectWork.get(agentId) ?? [];
        list.push(...rows);
        projectWork.set(agentId, list);
      }
      // Always load snapshot checklist progress. Applied per person only when that
      // person has no TaskItem and no live project/checklist rows (see below).
      // Do not gate on global `tasks.length` — one board task must not wipe
      // everyone else's KPI checklist fallback.
      const checklistFallback = await loadChecklistFallbackByAgent(period.start, period.end);

      const tasksByAgent = new Map<string, TaskRow[]>();
      for (const t of tasks) {
        if (!t.assignedAgentId) continue;
        const list = tasksByAgent.get(t.assignedAgentId) ?? [];
        list.push(t);
        tasksByAgent.set(t.assignedAgentId, list);
      }

      const agentIds = new Set<string>([
        ...tasksByAgent.keys(),
        ...ticketCounts.keys(),
        ...projectWork.keys(),
        ...checklistFallback.keys(),
      ]);

      // Group agent rows by canonical merged person: the same person can own
      // several agent rows (legacy emails / duplicate portals) and their work
      // must accumulate on one breakdown row.
      type PersonGroup = {
        mergedSourceUserId: bigint;
        portalAccountId: string | null;
        name: string;
        agentIds: string[];
      };
      const groups = new Map<string, PersonGroup>();
      for (const agentId of agentIds) {
        const enriched = agentById.get(agentId);
        if (!enriched) continue;
        const mergedId = canonicalMergedId(enriched.mergedSourceUserId, canonicalIds);
        const key = mergedId.toString();
        if (!mergedUserIds.has(key)) {
          result.skippedNoMergedUser++;
          continue;
        }
        const group = groups.get(key) ?? {
          mergedSourceUserId: mergedId,
          portalAccountId: enriched.portalAccountId,
          name: mergedNameById.get(key) ?? enriched.name,
          agentIds: [],
        };
        group.portalAccountId = group.portalAccountId ?? enriched.portalAccountId;
        group.agentIds.push(agentId);
        groups.set(key, group);
      }

      for (const group of groups.values()) {
        const agentTasks = group.agentIds.flatMap((id) => tasksByAgent.get(id) ?? []);
        const projectRows = collectProjectRowsForGroup(
          group,
          projectWork,
          agents,
          canonicalIds,
        );

        let totalTasks = agentTasks.length + projectRows.length;
        let completedTasks =
          agentTasks.filter((t) => t.status === "DONE").length +
          projectRows.filter((t) => t.status === "DONE").length;
        let delayedTasks =
          agentTasks.filter((t) => t.status === "DELAYED").length +
          projectRows.filter((t) => t.status === "DELAYED").length;
        let currentTasks =
          agentTasks.filter((t) => t.status === "CURRENT").length +
          projectRows.filter((t) => t.status === "CURRENT").length;

        let taskEfficiencyBeforePenalty: number | null = null;
        let taskEfficiency: number | null = null;
        let delayPenaltyTotal = 0;
        let onTimeCompletionRate: number | null = null;
        let averageTaskCompletionHours: number | null = null;
        let details: Array<{
          taskId: string | null;
          taskSource: string;
          taskTitle: string;
          status: string;
          dueAt: Date | null;
          completedAt: Date | null;
          efficiencyContribution: number | null;
          delayPenaltyAccrued: number;
          notes: string | null;
        }> = [];

        if (totalTasks > 0) {
          const activeDenom = completedTasks + currentTasks;
          taskEfficiencyBeforePenalty =
            activeDenom > 0
              ? Math.min(100, Math.round((completedTasks / activeDenom) * 100))
              : delayedTasks > 0
                ? 0
                : null;

          for (const t of agentTasks) delayPenaltyTotal += boardTaskPenalty(t, nowMs);
          for (const t of projectRows) delayPenaltyTotal += t.delayPenaltyAccrued;

          taskEfficiency =
            taskEfficiencyBeforePenalty != null
              ? applyPenaltyToTaskEfficiency(taskEfficiencyBeforePenalty, delayPenaltyTotal)
              : null;

          const doneBoard = agentTasks.filter((t) => t.status === "DONE");
          if (doneBoard.length > 0) {
            let onTime = 0;
            let hoursSum = 0;
            for (const t of doneBoard) {
              const completedAt = t.completedAt ?? t.updatedAt;
              if (!t.dueAt || completedAt.getTime() <= t.dueAt.getTime()) onTime++;
              const startAt = t.startedAt ?? t.createdAt;
              hoursSum += Math.max(0, (completedAt.getTime() - startAt.getTime()) / 3_600_000);
            }
            onTimeCompletionRate = round2((onTime / doneBoard.length) * 100);
            averageTaskCompletionHours = round2(hoursSum / doneBoard.length);
          }

          const perDone =
            taskEfficiency != null && completedTasks > 0
              ? round2(taskEfficiency / completedTasks)
              : 0;
          details = [
            ...agentTasks.map((t) => {
              const penalty = boardTaskPenalty(t, nowMs);
              return {
            taskId: t.id,
            taskSource: "TASK_ITEM",
            taskTitle: t.title.slice(0, 512),
            status: t.status,
            dueAt: t.dueAt,
                completedAt: t.status === "DONE" ? t.completedAt ?? t.updatedAt : null,
            efficiencyContribution: t.status === "DONE" ? perDone : 0,
                delayPenaltyAccrued: penalty,
            notes:
              t.status === "DELAYED"
                ? "Delayed board task — counted in delayedTasks, excluded from taskEfficiency denominator."
                    : penalty > 0
                      ? `Delay penalty accrued: ${penalty} pts`
                : null,
              };
            }),
            ...projectRows.map((t) => ({
              taskId: t.taskId,
              taskSource: t.taskSource,
              taskTitle: t.taskTitle,
              status: t.status,
              dueAt: t.dueAt,
              completedAt: t.completedAt,
              efficiencyContribution: t.status === "DONE" ? perDone : 0,
              delayPenaltyAccrued: t.delayPenaltyAccrued,
              notes:
                t.delayPenaltyAccrued > 0
                  ? `Delay penalty accrued: ${t.delayPenaltyAccrued} pts`
                  : t.taskSource === "IT_PROJECT_SUBTASK"
                    ? "IT project subtask"
                    : t.taskSource === "TRAVEL_ORDER"
                      ? "Confirmed Travel Order (traveler)"
                      : t.taskSource === "JOB_ORDER"
                        ? "Approved Job Order (assignee / co-worker)"
                        : "Non-recurring KPI checklist item",
            })),
          ];
        }

        // Recurring KPI checklist snapshots always merge with board / IT / live
        // one-off rows. Penalties reduce efficiency only — never drop task counts.
        const snapshotChecklist = collectChecklistSnapshotForGroup(
          group,
          checklistFallback,
          agents,
          canonicalIds,
        );
        if (snapshotChecklist) {
          const liveChecklistCount = projectRows.filter(
            (row) => row.taskSource === "KPI_CHECKLIST",
          ).length;
          const snapshotTotal = Math.max(0, snapshotChecklist.total - liveChecklistCount);
          const snapshotDone = Math.max(
            0,
            Math.min(snapshotChecklist.done, snapshotTotal),
          );
          if (snapshotTotal > 0) {
            const normalized = normalizePersonnelTaskTotals(snapshotTotal, snapshotDone);
            totalTasks += normalized.pending + normalized.closed;
            completedTasks += normalized.closed;
            currentTasks += normalized.pending;
            const activeDenom = completedTasks + currentTasks;
            taskEfficiencyBeforePenalty =
              activeDenom > 0
                ? Math.min(100, Math.round((completedTasks / activeDenom) * 100))
                : delayedTasks > 0
                  ? 0
                  : null;
            taskEfficiency =
              taskEfficiencyBeforePenalty != null
                ? applyPenaltyToTaskEfficiency(taskEfficiencyBeforePenalty, delayPenaltyTotal)
                : null;
            const perDone =
              taskEfficiency != null && completedTasks > 0
                ? round2(taskEfficiency / completedTasks)
                : 0;
            details = details.map((d) =>
              d.taskSource === "TICKET_SUMMARY"
                ? d
                : {
                    ...d,
                    efficiencyContribution: d.status === "DONE" ? perDone : 0,
                  },
            );
            details.push({
              taskId: null,
              taskSource: "KPI_CHECKLIST",
              taskTitle: snapshotChecklist.title.slice(0, 512),
              status: snapshotDone >= snapshotTotal ? "DONE" : "CURRENT",
              dueAt: null,
              completedAt: null,
              efficiencyContribution:
                snapshotTotal > 0
                  ? round2((snapshotDone / snapshotTotal) * (taskEfficiency ?? 0))
                  : null,
              delayPenaltyAccrued: 0,
              notes:
                agentTasks.length > 0 || projectRows.length > 0
                  ? "Merged recurring KPI checklist contributor progress with board/project work."
                  : "Efficiency includes KPI checklist contributor progress for the period.",
            });
          }
        }

        // Sum ticket counts across the person's agent rows, then take the rate.
        let ticketClosed = 0;
        let ticketPending = 0;
        let hasTicketData = false;
        for (const id of group.agentIds) {
          const counts = ticketCounts.get(id);
          if (!counts) continue;
          hasTicketData = true;
          ticketClosed += counts.closed;
          ticketPending += counts.pending;
        }
        const ticketEfficiency = hasTicketData
          ? helpdeskSupportPercent(ticketClosed, ticketPending)
          : null;
        if (ticketEfficiency != null && details.every((d) => d.taskSource !== "TICKET_SUMMARY")) {
          details.push({
            taskId: null,
            taskSource: "TICKET_SUMMARY",
            taskTitle: "Ticket efficiency (period)",
            status: "DONE",
            dueAt: null,
            completedAt: null,
            efficiencyContribution: round2(ticketEfficiency),
            delayPenaltyAccrued: 0,
            notes: "Aggregated ticket closed/(open+closed) for the period; ticket rows stay in primary PG.",
          });
        }

        const overallEfficiency = computeOverall(taskEfficiency, ticketEfficiency);
        if (
          taskEfficiency == null &&
          ticketEfficiency == null &&
          totalTasks === 0 &&
          details.length === 0
        ) {
          continue;
        }

        const efficiencyScore = round2(
          overallEfficiency * 0.7 + (onTimeCompletionRate ?? overallEfficiency) * 0.3,
        );

        if (dryRun) {
          upsertedSourceUserIds.add(group.mergedSourceUserId.toString());
          result.upsertedBreakdowns++;
          result.upsertedDetails += details.length;
          continue;
        }

        const existing = await prismaWrite.mergedUserEfficiencyBreakdown.findUnique({
          where: {
            sourceUserId_periodKey_frequency: {
              sourceUserId: group.mergedSourceUserId,
              periodKey: period.periodKey,
              frequency: period.frequency,
            },
          },
          select: { id: true },
        });

        const breakdownId = existing?.id ?? randomUUID();
        const payload = {
          portalAccountId: group.portalAccountId,
          displayName: group.name,
          periodStartAt: period.start,
          periodEndAt: period.end,
          overallEfficiency: new Prisma.Decimal(round2(overallEfficiency)),
          taskEfficiency:
            taskEfficiency != null ? new Prisma.Decimal(round2(taskEfficiency)) : null,
          ticketEfficiency:
            ticketEfficiency != null ? new Prisma.Decimal(round2(ticketEfficiency)) : null,
          totalTasks,
          completedTasks,
          delayedTasks,
          ticketsClosed: hasTicketData ? ticketClosed : 0,
          ticketsPending: hasTicketData ? ticketPending : 0,
          delayPenaltyTotal,
          taskEfficiencyBeforePenalty:
            taskEfficiencyBeforePenalty != null
              ? new Prisma.Decimal(round2(taskEfficiencyBeforePenalty))
              : null,
          onTimeCompletionRate:
            onTimeCompletionRate != null
              ? new Prisma.Decimal(onTimeCompletionRate)
              : null,
          averageTaskCompletionHours:
            averageTaskCompletionHours != null
              ? new Prisma.Decimal(averageTaskCompletionHours)
              : null,
          efficiencyScore: new Prisma.Decimal(efficiencyScore),
          sourceDatabase: sourceTag,
          computedAt: new Date(),
        };

        if (existing) {
          await prismaWrite.mergedUserEfficiencyTaskDetail.deleteMany({
            where: { breakdownId: existing.id },
          });
          await prismaWrite.mergedUserEfficiencyBreakdown.update({
            where: { id: existing.id },
            data: payload,
          });
        } else {
          await prismaWrite.mergedUserEfficiencyBreakdown.create({
            data: {
              id: breakdownId,
              sourceUserId: group.mergedSourceUserId,
              periodKey: period.periodKey,
              frequency: period.frequency,
              ...payload,
            },
          });
        }

        if (details.length > 0) {
          await prismaWrite.mergedUserEfficiencyTaskDetail.createMany({
            data: details.map((d) => ({
              id: randomUUID(),
              breakdownId,
              taskId: d.taskId,
              taskSource: d.taskSource,
              taskTitle: d.taskTitle,
              status: d.status,
              dueAt: d.dueAt,
              completedAt: d.completedAt,
              efficiencyContribution:
                d.efficiencyContribution != null
                  ? new Prisma.Decimal(d.efficiencyContribution)
                  : null,
              delayPenaltyAccrued: d.delayPenaltyAccrued,
              notes: d.notes,
            })),
          });
        }

        upsertedSourceUserIds.add(group.mergedSourceUserId.toString());
        result.upsertedBreakdowns++;
        result.upsertedDetails += details.length;
      }

      // Drop stale period rows (e.g. Approvers who only had procedural-RFP
      // board-assignee ticket credit before role-seat rules). Otherwise they
      // linger with pending>0 when the person is no longer in this period's groups.
      if (!dryRun) {
        const stale = await prismaWrite.mergedUserEfficiencyBreakdown.findMany({
          where: {
            periodKey: period.periodKey,
            frequency: period.frequency,
          },
          select: { id: true, sourceUserId: true },
        });
        const staleIds = stale
          .filter((row) => !upsertedSourceUserIds.has(row.sourceUserId.toString()))
          .map((row) => row.id);
        if (staleIds.length > 0) {
          await prismaWrite.mergedUserEfficiencyTaskDetail.deleteMany({
            where: { breakdownId: { in: staleIds } },
          });
          await prismaWrite.mergedUserEfficiencyBreakdown.deleteMany({
            where: { id: { in: staleIds } },
          });
        }
      }
    }
  } finally {
    await prismaBootstrap.$disconnect().catch(() => undefined);
    await prismaWrite.$disconnect().catch(() => undefined);
  }

  return result;
}
