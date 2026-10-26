import type { Prisma, TicketStatus } from "@prisma/client/primary";
import { DateTime } from "luxon";
import type { PersonnelRosterRow } from "@/lib/personnel-accounts-data";
import {
  loadTicketBoardLaneEnteredAtMap,
  loadTicketForConfirmationEnteredAtMap,
  loadTicketLastActivityAtMap,
} from "@/modules/requests/request-board-columns";
import { PROCEDURAL_REQUEST_TYPES } from "@/modules/requests/request-types";
import { getTicketSlaState } from "@/modules/requests/sla-shared";
import { normalizePersonName } from "@/lib/person-name";
import { prismaPrimary } from "@/modules/platform/db/prisma";
import { getTaskScheduleSettings } from "@/modules/platform/settings/task-schedule-settings-db";
import { workingDaysForCompany } from "@/modules/platform/settings/task-schedule-settings";
import { isTaskCompletionVerificationEnabled } from "@/modules/platform/settings/task-verification-settings-db";
import { loadAgentIdsForCompanyTeam } from "@/modules/platform/scope/staff-company-scope";
import {
  EMPTY_PERSONNEL_REQUEST_KPI,
  aggregatePersonnelKpi,
  blendPersonnelKpi,
  buildPersonnelKpiFrequencyBreakdown,
  buildPersonnelKpiPeriodBreakdown,
  personnelKpiTaskCounts,
  personnelRequestKpi,
  sortPersonnelKpiSummaries,
  type PersonnelRequestKpi,
  type PersonnelKpiDetail,
  type PersonnelKpiItemRow,
  type PersonnelKpiOverview,
  type PersonnelKpiRange,
  type PersonnelKpiSummary,
  type PersonnelKpiTaskRow,
  type PersonnelKpiTaskStatus,
} from "@/modules/workforce/personnel-kpi";
import {
  contributorProgressForKpiPeriod,
  enumeratePeriodKeysForKpiInRange,
  indexSnapshotsByKpiPeriod,
  periodKeysWithGmt8Aliases,
  resolvePeriodKeyForKpi,
} from "@/modules/tasks/kpi-period-snapshots";
import { kpiMainTaskLabel } from "@/modules/tasks/kpi-main-task";
import {
  isProjectTask,
  kpiChecklistProgress,
  taskUsesInvertedRecording,
} from "@/modules/tasks/kpi-subkpis";
import { usesProjectTimelineTracker } from "@/modules/tasks/it-project-subkpis";
import {
  isItProjectImplementationPillar,
  isJobOrderRequestPillar,
} from "@/modules/tasks/it-task-pillar-titles";
import { subKpiRequirementsMet } from "@/modules/tasks/sub-kpi-completion-mode";
import { isCompletionEffectivelyVerified } from "@/modules/tasks/task-completion-verification";
import { taskKanbanDerivedStatus } from "@/modules/tasks/kpi-cycle-state";
import { normalizeTimeZone } from "@/modules/tasks/kpi-recurrence";

const KPI_SELECT = {
  id: true,
  title: true,
  mainTask: true,
  frequency: true,
  isRecurring: true,
  subKpis: true,
  assignedAgent: { select: { id: true, name: true } },
  scopedCompanyTeamId: true,
  recurrenceWeekday: true,
  recurrenceMonthDay: true,
  periodKey: true,
  periodCycleStartAt: true,
  nonRecurringEndAt: true,
  completionVerificationStatus: true,
  lastFullCompletionAt: true,
} satisfies Prisma.KpiMaintenanceSelect;

type KpiRow = Prisma.KpiMaintenanceGetPayload<{ select: typeof KPI_SELECT }>;

type LoadedKpiRow = KpiRow & {
  workingDays: readonly number[];
  taskLabel: string;
  pillarLabel: string;
};

type ContributionWithMeta = PersonnelKpiItemRow & {
  frequency: string;
  title: string;
  pillar: string;
};

type Dataset = {
  range: PersonnelKpiRange;
  personnel: PersonnelRosterRow[];
  contributionsByUserId: Map<string, ContributionWithMeta[]>;
  rowsById: Map<string, LoadedKpiRow>;
  statusByKpiId: Map<string, PersonnelKpiTaskStatus>;
};

function isProjectKpiRow(row: KpiRow): boolean {
  if (row.isRecurring === true) return false;
  if (isItProjectImplementationPillar(row.title) || isJobOrderRequestPillar(row.title)) {
    return true;
  }
  return isProjectTask(row.subKpis) || usesProjectTimelineTracker(row.subKpis);
}

function nameTokenKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");
}

type PersonIndex = {
  byAgentId: Map<string, PersonnelRosterRow>;
  byExactName: Map<string, PersonnelRosterRow | null>;
  byTokenName: Map<string, PersonnelRosterRow | null>;
};

function addNameIndex(
  index: Map<string, PersonnelRosterRow | null>,
  key: string,
  person: PersonnelRosterRow,
) {
  if (!key) return;
  if (!index.has(key)) {
    index.set(key, person);
    return;
  }
  const current = index.get(key);
  if (current && current.mergedSourceUserId !== person.mergedSourceUserId) {
    index.set(key, null);
  }
}

function buildPersonIndex(personnel: readonly PersonnelRosterRow[]): PersonIndex {
  const byAgentId = new Map<string, PersonnelRosterRow>();
  const byExactName = new Map<string, PersonnelRosterRow | null>();
  const byTokenName = new Map<string, PersonnelRosterRow | null>();

  for (const person of personnel) {
    if (person.agentId?.trim()) byAgentId.set(person.agentId.trim(), person);
    addNameIndex(byExactName, normalizePersonName(person.name), person);
    addNameIndex(byTokenName, nameTokenKey(person.name), person);
  }
  return { byAgentId, byExactName, byTokenName };
}

function resolvePerson(
  personIndex: PersonIndex,
  contributor: { id: string; name: string },
): PersonnelRosterRow | null {
  const id = contributor.id?.trim();
  if (id && id !== "__unassigned__") {
    const byId = personIndex.byAgentId.get(id);
    if (byId) return byId;
  }
  const name = contributor.name?.trim() ?? "";
  if (!name) return null;
  const exact = personIndex.byExactName.get(normalizePersonName(name));
  if (exact) return exact;
  const token = personIndex.byTokenName.get(nameTokenKey(name));
  return token ?? null;
}

async function companyKpiWhere(companyId: string | null): Promise<Prisma.KpiMaintenanceWhereInput> {
  if (!companyId) return {};
  const agentIds = await loadAgentIdsForCompanyTeam(companyId);
  const or: Prisma.KpiMaintenanceWhereInput[] = [{ scopedCompanyTeamId: companyId }];
  if (agentIds.length > 0) or.push({ assignedAgentId: { in: agentIds } });
  return { OR: or };
}

type SnapshotRow = {
  kpiMaintenanceId: string;
  periodKey: string;
  total: number;
  done: number;
  missing: number;
  percent: number;
  contributorProgress: unknown;
};

async function loadSnapshots(
  kpiIds: readonly string[],
  periodKeys: readonly string[],
): Promise<SnapshotRow[]> {
  if (kpiIds.length === 0 || periodKeys.length === 0) return [];
  const out: SnapshotRow[] = [];
  const idChunkSize = 500;
  const keyChunkSize = 4000;
  for (let i = 0; i < kpiIds.length; i += idChunkSize) {
    const ids = kpiIds.slice(i, i + idChunkSize);
    for (let j = 0; j < periodKeys.length; j += keyChunkSize) {
      const keys = periodKeys.slice(j, j + keyChunkSize);
      const rows = await prismaPrimary.kpiMaintenancePeriodSnapshot.findMany({
        where: {
          kpiMaintenanceId: { in: ids },
          periodKey: { in: keys },
        },
        select: {
          kpiMaintenanceId: true,
          periodKey: true,
          total: true,
          done: true,
          missing: true,
          percent: true,
          contributorProgress: true,
        },
      });
      out.push(...rows);
    }
  }
  return out;
}

function computeTaskStatus(
  row: LoadedKpiRow,
  verificationEnabled: boolean,
  nowMs: number,
  timeZone: string,
): PersonnelKpiTaskStatus {
  const inverted = taskUsesInvertedRecording({ title: row.title, subKpis: row.subKpis });
  const progress = kpiChecklistProgress(row.subKpis, row.taskLabel, {
    parentCardEffectivelyVerified: isCompletionEffectivelyVerified(row),
    verificationEnabled,
  });
  const status = taskKanbanDerivedStatus(
    row,
    {
      total: progress.total,
      done: inverted ? 0 : progress.done,
      nowMs,
      timeZone,
      verificationEnabled,
    },
  );
  if (inverted) return status === "DELAYED" ? "DELAYED" : "CURRENT";
  return status;
}

async function loadDataset(args: {
  personnel: readonly PersonnelRosterRow[];
  companyId: string | null;
  range: PersonnelKpiRange;
  /**
   * Collect rows for this person only. Name matching still uses the whole roster so a
   * name shared by two people stays unattributed — the detail number then equals the card.
   */
  onlySourceUserId?: string;
}): Promise<Dataset> {
  if (args.personnel.length === 0) {
    return {
      range: args.range,
      personnel: [],
      contributionsByUserId: new Map(),
      rowsById: new Map(),
      statusByKpiId: new Map(),
    };
  }
  const zone = normalizeTimeZone(args.range.timeZone);
  const now = new Date();
  const nowMs = now.getTime();
  const [where, schedule] = await Promise.all([
    companyKpiWhere(args.companyId),
    getTaskScheduleSettings(),
  ]);
  const workingDaysFor = (row: KpiRow) =>
    workingDaysForCompany(schedule, row.scopedCompanyTeamId ?? args.companyId ?? null);

  const kpis = await prismaPrimary.kpiMaintenance.findMany({
    where,
    select: KPI_SELECT,
    orderBy: [{ title: "asc" }, { mainTask: "asc" }],
  });

  const rows: LoadedKpiRow[] = kpis
    .filter((row) => !isProjectKpiRow(row))
    .map((row) => ({
      ...row,
      workingDays: workingDaysFor(row),
      taskLabel: kpiMainTaskLabel(row),
      pillarLabel: row.title.trim(),
    }));

  const keysByKpiId = new Map<string, string[]>();
  const allPeriodKeys = new Set<string>();
  for (const row of rows) {
    const keys = enumeratePeriodKeysForKpiInRange(row, args.range.fromYmd, args.range.toYmd, zone);
    keysByKpiId.set(row.id, keys);
    for (const key of keys) allPeriodKeys.add(key);
  }

  const snapshots = await loadSnapshots(
    rows.map((row) => row.id),
    periodKeysWithGmt8Aliases(allPeriodKeys),
  );
  const snapshotByKpiPeriod = indexSnapshotsByKpiPeriod(snapshots);

  const personIndex = buildPersonIndex(args.personnel);
  const contributionsByUserId = new Map<string, ContributionWithMeta[]>();
  for (const person of args.personnel) {
    if (args.onlySourceUserId && person.mergedSourceUserId !== args.onlySourceUserId) continue;
    contributionsByUserId.set(person.mergedSourceUserId, []);
  }

  for (const row of rows) {
    const keys = keysByKpiId.get(row.id) ?? [];
    if (keys.length === 0) continue;
    const nowKey = resolvePeriodKeyForKpi(row, now, zone);
    const keysWithSnapshots = keys.filter((key) =>
      snapshotByKpiPeriod.has(`${row.id}:${key}`),
    );
    // One-off KPIs are recorded under the period they were completed/updated in.
    // Prefer those snapshot periods; fall back to the live period only when no
    // snapshot exists in the selected window (avoids counting a stale one-off twice).
    const countedKeys = row.isRecurring
      ? keys
      : keysWithSnapshots.length > 0
        ? keysWithSnapshots
        : keys.includes(nowKey)
          ? [nowKey]
          : [];

    for (const key of countedKeys) {
      const snap = snapshotByKpiPeriod.get(`${row.id}:${key}`);
      if (row.isRecurring && key !== nowKey && !snap) continue;
      if (!row.isRecurring && key !== nowKey && !snap) continue;

      const contributors = contributorProgressForKpiPeriod(
        row,
        key,
        nowKey,
        snap,
        subKpiRequirementsMet,
      );
      for (const contributor of contributors) {
        if (contributor.total <= 0) continue;
        const person = resolvePerson(personIndex, contributor);
        if (!person) continue;
        const list = contributionsByUserId.get(person.mergedSourceUserId);
        if (!list) continue;
        const total = Math.round(contributor.total);
        list.push({
          kpiId: row.id,
          periodKey: key,
          frequency: row.isRecurring ? row.frequency : "ONE_OFF",
          title: row.taskLabel,
          pillar: row.pillarLabel,
          total,
          done: Math.min(total, Math.max(0, Math.round(contributor.done))),
        });
      }
    }
  }

  const verificationEnabled = await isTaskCompletionVerificationEnabled();
  const statusByKpiId = new Map<string, PersonnelKpiTaskStatus>();
  const contributedKpiIds = new Set<string>();
  for (const list of contributionsByUserId.values()) {
    for (const row of list) contributedKpiIds.add(row.kpiId);
  }
  const rowsById = new Map(rows.map((row) => [row.id, row] as const));
  for (const kpiId of contributedKpiIds) {
    const row = rowsById.get(kpiId);
    if (!row) continue;
    statusByKpiId.set(kpiId, computeTaskStatus(row, verificationEnabled, nowMs, zone));
  }

  return {
    range: args.range,
    personnel: [...args.personnel],
    contributionsByUserId,
    rowsById,
    statusByKpiId,
  };
}

/** Ticket statuses that count as handled for the request KPI. */
const RESOLVED_REQUEST_STATUSES = new Set<TicketStatus>(["FOR_CONFIRMATION", "RESOLVED", "CLOSED"]);
const REQUEST_ROW_CAP = 20_000;

/**
 * Per-assignee request counts for the range: requests created in [from, to] (range zone),
 * assigned to the agent, inside the company (owning company or a send-to department of it).
 * Overdue uses the Request Board 24h lane rule, same as Requests → Reports.
 */
async function loadRequestKpiByAgentId(args: {
  agentIds: readonly string[];
  companyId: string | null;
  range: PersonnelKpiRange;
}): Promise<Map<string, PersonnelRequestKpi>> {
  const out = new Map<string, PersonnelRequestKpi>();
  if (args.agentIds.length === 0) return out;
  const zone = normalizeTimeZone(args.range.timeZone);
  const start = DateTime.fromISO(args.range.fromYmd, { zone }).startOf("day").toJSDate();
  const endExclusive = DateTime.fromISO(args.range.toYmd, { zone })
    .startOf("day")
    .plus({ days: 1 })
    .toJSDate();

  const rows = await prismaPrimary.ticket.findMany({
    where: {
      assignedAgentId: { in: [...args.agentIds] },
      createdAt: { gte: start, lt: endExclusive },
      NOT: { requestType: { in: [...PROCEDURAL_REQUEST_TYPES] } },
      ...(args.companyId
        ? {
            OR: [
              { teamId: args.companyId },
              { orgChartSection: { companyTeamId: args.companyId } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      assignedAgentId: true,
      status: true,
      requestType: true,
      createdAt: true,
      updatedAt: true,
      resolvedAt: true,
    },
    take: REQUEST_ROW_CAP,
  });

  const openRows = rows.filter((row) => !RESOLVED_REQUEST_STATUSES.has(row.status));
  const openIds = openRows.map((row) => row.id);
  const [laneEnteredById, lastActivityById, forConfirmationById] = await Promise.all([
    loadTicketBoardLaneEnteredAtMap(openIds),
    loadTicketLastActivityAtMap(openIds),
    loadTicketForConfirmationEnteredAtMap(openIds),
  ]);
  const overdueIds = new Set(
    openRows
      .filter(
        (row) =>
          getTicketSlaState({
            ...row,
            boardLaneEnteredAt: laneEnteredById.get(row.id) ?? row.updatedAt,
            lastActivityAt: lastActivityById.get(row.id) ?? null,
            forConfirmationAt: forConfirmationById.get(row.id) ?? null,
          }) === "BREACHED",
      )
      .map((row) => row.id),
  );

  const counts = new Map<string, { assigned: number; resolved: number; overdue: number }>();
  for (const row of rows) {
    if (!row.assignedAgentId) continue;
    const c = counts.get(row.assignedAgentId) ?? { assigned: 0, resolved: 0, overdue: 0 };
    c.assigned += 1;
    if (RESOLVED_REQUEST_STATUSES.has(row.status)) c.resolved += 1;
    if (overdueIds.has(row.id)) c.overdue += 1;
    counts.set(row.assignedAgentId, c);
  }
  for (const [agentId, c] of counts) out.set(agentId, personnelRequestKpi(c));
  return out;
}

function buildSummary(
  person: PersonnelRosterRow,
  rows: readonly ContributionWithMeta[],
  statusByKpiId: ReadonlyMap<string, PersonnelKpiTaskStatus>,
  requestsByAgentId: ReadonlyMap<string, PersonnelRequestKpi>,
): PersonnelKpiSummary {
  const totals = aggregatePersonnelKpi(rows);
  const kpiIds = [...new Set(rows.map((row) => row.kpiId))];
  const statuses = kpiIds
    .map((kpiId) => statusByKpiId.get(kpiId))
    .filter((status): status is PersonnelKpiTaskStatus => Boolean(status));
  const requests =
    (person.agentId ? requestsByAgentId.get(person.agentId) : undefined) ??
    EMPTY_PERSONNEL_REQUEST_KPI;
  return {
    sourceUserId: person.mergedSourceUserId,
    agentId: person.agentId,
    name: person.name,
    email: person.email,
    teamName: person.teamName,
    staffRole: person.staffRole,
    staffAssignmentColor: person.staffAssignmentColor,
    ...totals,
    ...personnelKpiTaskCounts(statuses),
    requests,
    overallPercent: blendPersonnelKpi(totals.kpiPercent, requests.resolutionPercent).overallPercent,
  };
}

function rosterAgentIds(personnel: readonly PersonnelRosterRow[]): string[] {
  return [
    ...new Set(
      personnel.map((person) => person.agentId?.trim()).filter((id): id is string => Boolean(id)),
    ),
  ];
}

export async function loadPersonnelKpiOverview(args: {
  personnel: readonly PersonnelRosterRow[];
  companyId: string | null;
  range: PersonnelKpiRange;
}): Promise<PersonnelKpiOverview> {
  const [dataset, requestsByAgentId] = await Promise.all([
    loadDataset(args),
    loadRequestKpiByAgentId({
      agentIds: rosterAgentIds(args.personnel),
      companyId: args.companyId,
      range: args.range,
    }),
  ]);
  const people = sortPersonnelKpiSummaries(
    dataset.personnel.map((person) =>
      buildSummary(
        person,
        dataset.contributionsByUserId.get(person.mergedSourceUserId) ?? [],
        dataset.statusByKpiId,
        requestsByAgentId,
      ),
    ),
  );
  const allRows = [...dataset.contributionsByUserId.values()].flat();
  const totals = aggregatePersonnelKpi(allRows);
  const allKpiIds = [...new Set(allRows.map((row) => row.kpiId))];
  const taskStatuses = allKpiIds
    .map((kpiId) => dataset.statusByKpiId.get(kpiId))
    .filter((status): status is PersonnelKpiTaskStatus => Boolean(status));
  const taskCounts = personnelKpiTaskCounts(taskStatuses);
  return {
    range: dataset.range,
    people,
    totals,
    tasks: {
      count: taskCounts.taskCount,
      done: taskCounts.doneTasks,
      missed: taskCounts.missedTasks,
      open: taskCounts.openTasks,
    },
    peopleWithData: people.filter((person) => person.overallPercent != null).length,
  };
}

const STATUS_ORDER: Record<PersonnelKpiTaskStatus, number> = {
  DELAYED: 0,
  PENDING_VERIFICATION: 1,
  CURRENT: 2,
  DONE: 3,
};

function buildTaskRows(
  rows: readonly ContributionWithMeta[],
  rowsById: ReadonlyMap<string, LoadedKpiRow>,
  statusByKpiId: ReadonlyMap<string, PersonnelKpiTaskStatus>,
): PersonnelKpiTaskRow[] {
  const byKpi = new Map<string, ContributionWithMeta[]>();
  for (const row of rows) {
    const list = byKpi.get(row.kpiId) ?? [];
    list.push(row);
    byKpi.set(row.kpiId, list);
  }

  const tasks: PersonnelKpiTaskRow[] = [];
  for (const [kpiId, list] of byKpi) {
    const source = rowsById.get(kpiId);
    const totals = aggregatePersonnelKpi(list);
    const periods = buildPersonnelKpiPeriodBreakdown(list, 1);
    tasks.push({
      kpiId,
      title: source?.taskLabel ?? list[0]?.title ?? "KPI task",
      pillar: source?.pillarLabel ?? list[0]?.pillar ?? "",
      frequency: source?.isRecurring ? source.frequency : "ONE_OFF",
      status: statusByKpiId.get(kpiId) ?? "CURRENT",
      kpiPercent: totals.kpiPercent,
      totalItems: totals.totalItems,
      doneItems: totals.doneItems,
      periodCount: totals.periodCount,
      lastPeriodKey: periods[0]?.key ?? list[0]?.periodKey ?? "",
    });
  }
  return tasks.sort(
    (a, b) =>
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.title.localeCompare(b.title),
  );
}

export async function loadPersonnelKpiDetail(args: {
  /** Full company roster, so name matching is identical to the overview. */
  personnel: readonly PersonnelRosterRow[];
  person: PersonnelRosterRow;
  companyId: string | null;
  range: PersonnelKpiRange;
}): Promise<PersonnelKpiDetail> {
  const [dataset, requestsByAgentId] = await Promise.all([
    loadDataset({
      personnel: args.personnel,
      companyId: args.companyId,
      range: args.range,
      onlySourceUserId: args.person.mergedSourceUserId,
    }),
    loadRequestKpiByAgentId({
      agentIds: rosterAgentIds([args.person]),
      companyId: args.companyId,
      range: args.range,
    }),
  ]);
  const rows = dataset.contributionsByUserId.get(args.person.mergedSourceUserId) ?? [];
  const person = buildSummary(args.person, rows, dataset.statusByKpiId, requestsByAgentId);
  return {
    range: dataset.range,
    person,
    tasks: buildTaskRows(rows, dataset.rowsById, dataset.statusByKpiId),
    frequencies: buildPersonnelKpiFrequencyBreakdown(rows),
    periods: buildPersonnelKpiPeriodBreakdown(rows),
  };
}
