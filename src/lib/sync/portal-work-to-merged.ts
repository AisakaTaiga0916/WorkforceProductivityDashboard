/**
 * Sync portal-attributed tasks and KPI progress from primary PostgreSQL
 * into mergedatabase-demo with merged_users linkage.
 *
 * Also computes per-user KPI checklist averages plus Insights-parity
 * task / ticket / overall efficiencies (merged_kpi_user_averages).
 *
 * Ticket *records* stay in primary PostgreSQL — only efficiency % is stored
 * on the merged averages row.
 */
import { Prisma, PrismaClient as PrismaClientSecondary } from "@prisma/client/secondary";
import {
  bootstrapMysqlUrl,
  ensureMergedPortalWorkTables,
  parseMysqlDatabaseName,
} from "../../../scripts/ensure-merged-task-kpi-tables";
import {
  computeTaskMetrics,
  parseKpiRangeFromQuery,
  type PersonnelTicketMetric,
} from "@/modules/tasks/kpis";
import { prismaPrimary, prismaSecondary } from "@/modules/platform/db/prisma";
import {
  buildCanonicalMergedIdMap,
  canonicalMergedId,
} from "@/lib/sync/merged-person-identity";
import {
  aggregatePersonnelTaskMetrics,
  applyDelayPenaltiesToPersonnelTasks,
  attachPersonnelRequestRoleMetrics,
  combinedPersonnelEfficiency,
  mergePersonnelMetricCards,
  mergePersonnelRequestMetrics,
} from "@/modules/tasks/task-personnel-metrics";

const BATCH_SIZE = 500;

export type PortalWorkSyncResult = {
  dryRun: boolean;
  sourceTag: string;
  targetDb: string;
  source: {
    kpis: number;
    snapshots: number;
    tasks: number;
    activities: number;
  };
  synced: {
    kpis: number;
    snapshots: number;
    tasks: number;
    activities: number;
    kpiUserAverages: number;
  };
  enrichment: {
    agentsWithPortal: number;
    agentsWithMergedId: number;
  };
};

type AgentEnrichment = {
  agentEmail: string;
  portalAccountId: string | null;
  mergedSourceUserId: bigint | null;
};

type PortalLink = {
  id: string;
  email: string;
  mergedSourceUserId: bigint | null;
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
  return "mysql://root@localhost:3306/mergedatabase-dev";
}

function resolveSourceTag(): string {
  return env("TICKETING_MERGE_SOURCE_TAG", "ticketing_system");
}

async function chunkCreateMany<T>(
  items: T[],
  write: (batch: T[]) => Promise<unknown>,
  dryRun: boolean,
): Promise<number> {
  if (dryRun || items.length === 0) return items.length;
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    await write(items.slice(i, i + BATCH_SIZE));
  }
  return items.length;
}

async function buildAgentEnrichment(): Promise<{
  agents: Array<{ id: string; email: string; name: string }>;
  byAgentId: Map<string, AgentEnrichment>;
  byEmail: Map<string, PortalLink>;
  mergedPeople: Array<{ sourceUserId: bigint; name: string; email: string | null; portalAccountId: string | null }>;
  stats: { agentsWithPortal: number; agentsWithMergedId: number };
}> {
  const sourceTag = process.env.HRIS_MERGE_SOURCE_TAG?.trim() || "hrisdemo";
  const [agents, portals, mergedRows] = await Promise.all([
    prismaPrimary.agent.findMany({ select: { id: true, email: true, name: true } }),
    // Include LEGACY_CONFLICT so KPI contributors on old work emails still map.
    prismaPrimary.portalAccount.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        mergedSourceUserId: true,
        accountStatus: true,
      },
    }),
    prismaSecondary.$queryRaw<
      Array<{ source_user_id: bigint; name: string; email: string | null }>
    >`
      SELECT source_user_id, name, email
      FROM merged_users
      WHERE is_active = 1
        AND (source_database = ${sourceTag} OR source_user_id >= 9000000000)
    `,
  ]);

  // Fold portal-synthetic merged ids (>= 9e9) into their HRIS person so all
  // work attribution lands on the merged_users row the personnel tab shows.
  const canonicalIds = buildCanonicalMergedIdMap(
    mergedRows.map((m) => ({
      sourceUserId: m.source_user_id,
      name: m.name,
      email: m.email,
    })),
  );

  const byEmail = new Map<string, PortalLink>();
  // Prefer active portals over LEGACY_CONFLICT when emails collide.
  const sortedPortals = [...portals].sort((a, b) => {
    const aLegacy = a.accountStatus === "LEGACY_CONFLICT" ? 1 : 0;
    const bLegacy = b.accountStatus === "LEGACY_CONFLICT" ? 1 : 0;
    return aLegacy - bLegacy;
  });
  for (const portal of sortedPortals) {
    const key = portal.email.trim().toLowerCase();
    if (!byEmail.has(key)) {
      byEmail.set(key, {
        id: portal.id,
        email: portal.email,
        mergedSourceUserId:
          portal.mergedSourceUserId != null
            ? canonicalMergedId(portal.mergedSourceUserId, canonicalIds)
            : null,
      });
    }
  }

  const linkedPortals = portals.filter((p) => p.mergedSourceUserId != null);
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

  function bestNameMatch(agentName: string): (typeof linkedPortals)[number] | null {
    const at = personTokens(agentName);
    if (at.size === 0) return null;
    let best: (typeof linkedPortals)[number] | null = null;
    let bestScore = 0;
    for (const portal of linkedPortals) {
      // Prefer non-legacy when scores tie
      const pt = personTokens(portal.name);
      const overlap = [...at].filter((t) => pt.has(t)).length;
      if (overlap < 2) continue;
      const legacyPenalty = portal.accountStatus === "LEGACY_CONFLICT" ? 0.1 : 0;
      const score = overlap - legacyPenalty;
      if (score > bestScore) {
        best = portal;
        bestScore = score;
      }
    }
    return best;
  }

  const portalByMergedId = new Map<string, string>();
  for (const p of linkedPortals) {
    if (p.mergedSourceUserId == null) continue;
    const key = p.mergedSourceUserId.toString();
    if (p.accountStatus !== "LEGACY_CONFLICT" || !portalByMergedId.has(key)) {
      portalByMergedId.set(key, p.id);
    }
  }

  const mergedPeople = mergedRows.map((m) => ({
    sourceUserId: m.source_user_id,
    name: m.name,
    email: m.email,
    portalAccountId: portalByMergedId.get(m.source_user_id.toString()) ?? null,
  }));

  const byAgentId = new Map<string, AgentEnrichment>();
  let agentsWithPortal = 0;
  let agentsWithMergedId = 0;

  for (const agent of agents) {
    const byMail = byEmail.get(agent.email.trim().toLowerCase());
    const byName =
      byMail?.mergedSourceUserId == null ? bestNameMatch(agent.name) : null;
    const portal = byMail?.mergedSourceUserId != null ? byMail : byName ?? byMail;

    let mergedSourceUserId = portal?.mergedSourceUserId ?? null;
    // Direct name match to merged_users when portal link is missing
    if (mergedSourceUserId == null) {
      const at = personTokens(agent.name);
      let best: (typeof mergedPeople)[number] | null = null;
      let bestScore = 0;
      for (const m of mergedPeople) {
        const overlap = [...at].filter((t) => personTokens(m.name).has(t)).length;
        if (overlap >= 2 && overlap > bestScore) {
          best = m;
          bestScore = overlap;
        }
      }
      if (best) mergedSourceUserId = best.sourceUserId;
    }
    if (mergedSourceUserId != null) {
      mergedSourceUserId = canonicalMergedId(mergedSourceUserId, canonicalIds);
    }

    const enrichment: AgentEnrichment = {
      agentEmail: agent.email,
      portalAccountId: portal?.id ?? null,
      mergedSourceUserId,
    };
    byAgentId.set(agent.id, enrichment);
    if (portal) agentsWithPortal++;
    if (enrichment.mergedSourceUserId != null) agentsWithMergedId++;
  }

  return {
    agents,
    byAgentId,
    byEmail,
    mergedPeople,
    stats: { agentsWithPortal, agentsWithMergedId },
  };
}

function enrichAgent(
  agentId: string | null | undefined,
  byAgentId: Map<string, AgentEnrichment>,
): Pick<AgentEnrichment, "agentEmail" | "portalAccountId" | "mergedSourceUserId"> {
  if (!agentId) {
    return { agentEmail: "", portalAccountId: null, mergedSourceUserId: null };
  }
  const row = byAgentId.get(agentId);
  return {
    agentEmail: row?.agentEmail ?? "",
    portalAccountId: row?.portalAccountId ?? null,
    mergedSourceUserId: row?.mergedSourceUserId ?? null,
  };
}

function enrichEmail(
  email: string,
  byEmail: Map<string, PortalLink>,
): { mergedSourceUserId: bigint | null; portalAccountId: string | null } {
  const portal = byEmail.get(email.trim().toLowerCase());
  return {
    mergedSourceUserId: portal?.mergedSourceUserId ?? null,
    portalAccountId: portal?.id ?? null,
  };
}

type StoredContributor = { id: string; name: string; total: number; done: number };

/** Parse the JSON contributorProgress column into typed rows (defensive). */
function parseContributorProgress(raw: unknown): StoredContributor[] {
  if (!Array.isArray(raw)) return [];
  const out: StoredContributor[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const name = typeof row.name === "string" ? row.name.trim() : "";
    const total = Number(row.total);
    const done = Number(row.done);
    if (!Number.isFinite(total) || !Number.isFinite(done) || total <= 0) continue;
    out.push({
      id: typeof row.id === "string" ? row.id : name.toLowerCase(),
      name,
      total: Math.round(total),
      done: Math.round(Math.min(done, total)),
    });
  }
  return out;
}

type UserAverageAccumulator = {
  sourceUserId: bigint;
  portalAccountId: string | null;
  agentEmail: string | null;
  displayName: string;
  kpiIds: Set<string>;
  snapshotCount: number;
  totalItems: number;
  doneItems: number;
  /** Per-snapshot completion percentages (for the unweighted average). */
  percents: number[];
  firstPeriodKey: string | null;
  lastPeriodKey: string | null;
};

/**
 * Aggregate KPI period snapshots into an overall average per user/employee.
 *
 * Attribution priority per snapshot:
 *   1. `contributorProgress` JSON (per-person done/total) — the canonical breakdown.
 *   2. Fallback to the KPI's assigned agent using the snapshot total/done.
 *
 * Each contributor is resolved agent id/name → agent email → portal → merged_users.
 */
function normalizePersonKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function computeKpiUserAverages(
  kpis: Array<{ id: string; assignedAgentId: string | null }>,
  snapshots: Array<{
    kpiMaintenanceId: string;
    periodKey: string;
    total: number;
    done: number;
    percent: number;
    contributorProgress: unknown;
  }>,
  agents: Array<{ id: string; email: string; name: string }>,
  byAgentId: Map<string, AgentEnrichment>,
  byEmail: Map<string, PortalLink>,
): UserAverageAccumulator[] {
  const kpiById = new Map(kpis.map((k) => [k.id, k]));
  const agentById = new Map(agents.map((a) => [a.id, a]));
  const agentByName = new Map<string, (typeof agents)[number]>();
  for (const a of agents) {
    agentByName.set(a.name.trim().toLowerCase(), a);
    agentByName.set(normalizePersonKey(a.name), a);
  }

  const byUser = new Map<string, UserAverageAccumulator>();

  const resolveUser = (contributorId: string, contributorName: string) => {
    const agent =
      agentById.get(contributorId) ??
      agentByName.get(contributorName.trim().toLowerCase()) ??
      agentByName.get(normalizePersonKey(contributorName));
    if (!agent) return null;

    // Prefer agent-id enrichment (includes name-matched HRIS / legacy portals).
    const enriched = byAgentId.get(agent.id);
    if (enriched?.mergedSourceUserId != null) {
      return {
        sourceUserId: enriched.mergedSourceUserId,
        portalAccountId: enriched.portalAccountId,
        agentEmail: agent.email,
        displayName: agent.name || contributorName,
      };
    }

    const portal = byEmail.get(agent.email.trim().toLowerCase());
    if (!portal?.mergedSourceUserId) return null;
    return {
      sourceUserId: portal.mergedSourceUserId,
      portalAccountId: portal.id,
      agentEmail: agent.email,
      displayName: agent.name || contributorName,
    };
  };

  const record = (
    resolved: {
      sourceUserId: bigint;
      portalAccountId: string | null;
      agentEmail: string;
      displayName: string;
    },
    kpiId: string,
    periodKey: string,
    total: number,
    done: number,
  ) => {
    if (total <= 0) return;
    const key = resolved.sourceUserId.toString();
    const percent = Math.round((Math.min(done, total) / total) * 100);
    const existing = byUser.get(key);
    if (existing) {
      existing.kpiIds.add(kpiId);
      existing.snapshotCount += 1;
      existing.totalItems += total;
      existing.doneItems += Math.min(done, total);
      existing.percents.push(percent);
      if (!existing.firstPeriodKey || periodKey < existing.firstPeriodKey) {
        existing.firstPeriodKey = periodKey;
      }
      if (!existing.lastPeriodKey || periodKey > existing.lastPeriodKey) {
        existing.lastPeriodKey = periodKey;
      }
      return;
    }
    byUser.set(key, {
      sourceUserId: resolved.sourceUserId,
      portalAccountId: resolved.portalAccountId,
      agentEmail: resolved.agentEmail,
      displayName: resolved.displayName,
      kpiIds: new Set([kpiId]),
      snapshotCount: 1,
      totalItems: total,
      doneItems: Math.min(done, total),
      percents: [percent],
      firstPeriodKey: periodKey,
      lastPeriodKey: periodKey,
    });
  };

  for (const snap of snapshots) {
    const contributors = parseContributorProgress(snap.contributorProgress);
    if (contributors.length > 0) {
      for (const c of contributors) {
        const resolved = resolveUser(c.id, c.name);
        if (resolved) record(resolved, snap.kpiMaintenanceId, snap.periodKey, c.total, c.done);
      }
      continue;
    }
    // Fallback: attribute the whole snapshot to the KPI's assigned agent.
    const kpi = kpiById.get(snap.kpiMaintenanceId);
    if (!kpi?.assignedAgentId) continue;
    const agent = agentById.get(kpi.assignedAgentId);
    if (!agent) continue;
    const resolved = resolveUser(agent.id, agent.name);
    if (resolved) record(resolved, snap.kpiMaintenanceId, snap.periodKey, snap.total, snap.done);
  }

  return [...byUser.values()];
}

type EfficiencyByMergedUser = {
  sourceUserId: bigint;
  portalAccountId: string | null;
  agentEmail: string | null;
  displayName: string;
  taskEfficiency: number | null;
  ticketEfficiency: number | null;
  overallEfficiency: number | null;
};

/**
 * Insights-parity task + ticket efficiencies for each merged user.
 * Ticket *rows* stay in PG; only % efficiencies are stored on merged averages.
 */
async function computeMergedUserEfficiencies(
  agents: Array<{ id: string; email: string; name: string }>,
  byAgentId: Map<string, AgentEnrichment>,
): Promise<Map<string, EfficiencyByMergedUser>> {
  const range = parseKpiRangeFromQuery(null, null);
  // Full task metrics (checklist pillars + request role seats). Do not pass taskType=requests
  // or task checklist progress is skipped.
  const metrics = await computeTaskMetrics(range, {}, "MONTHLY");
  const taskRows = applyDelayPenaltiesToPersonnelTasks(
    aggregatePersonnelTaskMetrics(metrics.taskChecklistPillars),
    metrics.personnelDelayPenalties,
  );
  const baseCards = mergePersonnelMetricCards(
    taskRows,
    metrics.personnelTicketMetrics as PersonnelTicketMetric[],
  );
  // Insights parity: Requests = assignee tickets + RFP/IRS/FTR role seats (no Approver fallback).
  const cards = attachPersonnelRequestRoleMetrics(baseCards, {
    rfpAccounting: metrics.personnelRfpAccountingMetrics,
    rfpFinance: metrics.personnelRfpFinanceMetrics,
    irsCanvass: metrics.personnelIrsCanvassMetrics,
    ftrPrepared: metrics.personnelFtrPreparedMetrics,
  });

  const agentById = new Map(agents.map((a) => [a.id, a]));
  const agentByName = new Map<string, (typeof agents)[number]>();
  for (const a of agents) {
    agentByName.set(a.name.trim().toLowerCase(), a);
    agentByName.set(
      a.name
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, ""),
      a,
    );
  }

  const out = new Map<string, EfficiencyByMergedUser>();

  for (const card of cards) {
    const agent =
      agentById.get(card.id) ??
      agentByName.get(card.name.trim().toLowerCase()) ??
      agentByName.get(
        card.name
          .trim()
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, ""),
      );
    if (!agent) continue;
    const enriched = byAgentId.get(agent.id);
    if (enriched?.mergedSourceUserId == null) continue;

    const key = enriched.mergedSourceUserId.toString();
    const requests = mergePersonnelRequestMetrics(card);
    const combined = combinedPersonnelEfficiency(card);
    out.set(key, {
      sourceUserId: enriched.mergedSourceUserId,
      portalAccountId: enriched.portalAccountId,
      agentEmail: agent.email,
      displayName: agent.name || card.name,
      taskEfficiency: card.tasks?.efficiency ?? null,
      ticketEfficiency: requests?.efficiency ?? null,
      overallEfficiency: combined,
    });
  }

  return out;
}

export async function runPortalWorkToMergedSync(options?: {
  dryRun?: boolean;
}): Promise<PortalWorkSyncResult> {
  const dryRun = options?.dryRun ?? false;
  const writeUrl = resolveSecondaryWriteUrl();
  const bootstrapUrl = bootstrapMysqlUrl(writeUrl);
  const targetDb = parseMysqlDatabaseName(writeUrl) ?? "mergedatabase-dev";
  const sourceTag = resolveSourceTag();

  const prismaBootstrap = new PrismaClientSecondary({
    datasources: { db: { url: bootstrapUrl } },
  });
  const prismaWrite = new PrismaClientSecondary({
    datasources: { db: { url: writeUrl } },
  });

  const result: PortalWorkSyncResult = {
    dryRun,
    sourceTag,
    targetDb,
    source: { kpis: 0, snapshots: 0, tasks: 0, activities: 0 },
    synced: { kpis: 0, snapshots: 0, tasks: 0, activities: 0, kpiUserAverages: 0 },
    enrichment: { agentsWithPortal: 0, agentsWithMergedId: 0 },
  };

  try {
    await Promise.all([prismaPrimary.$connect(), prismaBootstrap.$connect()]);
    await ensureMergedPortalWorkTables(prismaBootstrap, targetDb, sourceTag);
    await prismaBootstrap.$disconnect();

    await prismaWrite.$connect();

    const { agents, byAgentId, byEmail, stats } = await buildAgentEnrichment();
    result.enrichment = stats;

    const [kpis, snapshots, tasks, activities] = await Promise.all([
      prismaPrimary.kpiMaintenance.findMany(),
      prismaPrimary.kpiMaintenancePeriodSnapshot.findMany(),
      prismaPrimary.taskItem.findMany(),
      prismaPrimary.taskActivity.findMany(),
    ]);

    result.source = {
      kpis: kpis.length,
      snapshots: snapshots.length,
      tasks: tasks.length,
      activities: activities.length,
    };

    if (!dryRun) {
      await prismaWrite.$transaction([
        prismaWrite.mergedTaskActivity.deleteMany({ where: { sourceDatabase: sourceTag } }),
        prismaWrite.mergedTaskItem.deleteMany({ where: { sourceDatabase: sourceTag } }),
        prismaWrite.mergedKpiPeriodSnapshot.deleteMany({ where: { sourceDatabase: sourceTag } }),
        prismaWrite.mergedKpiMaintenance.deleteMany({ where: { sourceDatabase: sourceTag } }),
        prismaWrite.mergedKpiUserAverage.deleteMany({ where: { sourceDatabase: sourceTag } }),
      ]);
    }

    const kpiRows = kpis.map((k) => {
      const assignee = enrichAgent(k.assignedAgentId, byAgentId);
      const creator = enrichEmail(k.createdBy, byEmail);
      return {
        sourceId: k.id,
        sourceDatabase: sourceTag,
        title: k.title,
        mainTask: k.mainTask,
        isRecurring: k.isRecurring,
        nonRecurringStartAt: k.nonRecurringStartAt,
        nonRecurringEndAt: k.nonRecurringEndAt,
        frequency: k.frequency,
        subKpis: k.subKpis as object,
        assignedAgentId: k.assignedAgentId,
        assignedAgentEmail: assignee.agentEmail || null,
        assignedPortalAccountId: assignee.portalAccountId,
        assignedMergedSourceUserId: assignee.mergedSourceUserId,
        assignedRole: k.assignedRole,
        recurrenceWeekday: k.recurrenceWeekday,
        recurrenceMonthDay: k.recurrenceMonthDay,
        periodCycleStartAt: k.periodCycleStartAt,
        lastFullCompletionAt: k.lastFullCompletionAt,
        periodKey: k.periodKey,
        rolledOverIncomplete: k.rolledOverIncomplete,
        itProjectName: k.itProjectName,
        itProjectPhase: k.itProjectPhase,
        scopedCompanyTeamId: k.scopedCompanyTeamId,
        createdBy: k.createdBy,
        createdByMergedSourceUserId: creator.mergedSourceUserId,
        createdByPortalAccountId: creator.portalAccountId,
        createdByRole: k.createdByRole,
        createdAt: k.createdAt,
        updatedAt: k.updatedAt,
      };
    });

    const snapshotRows = snapshots.map((s) => ({
      sourceId: s.id,
      sourceDatabase: sourceTag,
      kpiMaintenanceId: s.kpiMaintenanceId,
      periodKey: s.periodKey,
      frequency: s.frequency,
      timeZone: s.timeZone,
      total: s.total,
      done: s.done,
      missing: s.missing,
      percent: s.percent,
      fullyComplete: s.fullyComplete,
      contributorProgress:
        s.contributorProgress === null
          ? Prisma.JsonNull
          : (s.contributorProgress as Prisma.InputJsonValue),
      capturedAt: s.capturedAt,
    }));

    const taskRows = tasks.map((t) => {
      const assignee = enrichAgent(t.assignedAgentId, byAgentId);
      const creator = enrichEmail(t.createdBy, byEmail);
      return {
        sourceId: t.id,
        sourceDatabase: sourceTag,
        title: t.title,
        description: t.description,
        status: t.status,
        assignedAgentId: t.assignedAgentId,
        assignedAgentEmail: assignee.agentEmail || null,
        assignedPortalAccountId: assignee.portalAccountId,
        assignedMergedSourceUserId: assignee.mergedSourceUserId,
        priority: t.priority,
        dueAt: t.dueAt,
        createdBy: t.createdBy,
        createdByMergedSourceUserId: creator.mergedSourceUserId,
        createdByPortalAccountId: creator.portalAccountId,
        createdByRole: t.createdByRole,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
      };
    });

    const activityRows = activities.map((a) => {
      const author = enrichEmail(a.author, byEmail);
      return {
        sourceId: a.id,
        sourceDatabase: sourceTag,
        taskId: a.taskId,
        author: a.author,
        authorMergedSourceUserId: author.mergedSourceUserId,
        authorPortalAccountId: author.portalAccountId,
        action: a.action,
        detail: a.detail,
        createdAt: a.createdAt,
      };
    });

    result.synced.kpis = await chunkCreateMany(kpiRows, (batch) =>
      prismaWrite.mergedKpiMaintenance.createMany({ data: batch }),
    dryRun);
    result.synced.snapshots = await chunkCreateMany(snapshotRows, (batch) =>
      prismaWrite.mergedKpiPeriodSnapshot.createMany({ data: batch }),
    dryRun);
    result.synced.tasks = await chunkCreateMany(taskRows, (batch) =>
      prismaWrite.mergedTaskItem.createMany({ data: batch }),
    dryRun);
    result.synced.activities = await chunkCreateMany(activityRows, (batch) =>
      prismaWrite.mergedTaskActivity.createMany({ data: batch }),
    dryRun);

    // Overall average KPI progress per user/employee + Insights efficiencies.
    const userAverages = computeKpiUserAverages(
      kpis.map((k) => ({ id: k.id, assignedAgentId: k.assignedAgentId })),
      snapshots.map((s) => ({
        kpiMaintenanceId: s.kpiMaintenanceId,
        periodKey: s.periodKey,
        total: s.total,
        done: s.done,
        percent: s.percent,
        contributorProgress: s.contributorProgress,
      })),
      agents,
      byAgentId,
      byEmail,
    );

    const efficiencies = await computeMergedUserEfficiencies(agents, byAgentId);

    const byMergedId = new Map(
      userAverages.map((u) => [u.sourceUserId.toString(), u] as const),
    );
    // Ticket/task-only agents who have no KPI snapshot history still get a row.
    for (const [key, eff] of efficiencies) {
      if (byMergedId.has(key)) continue;
      byMergedId.set(key, {
        sourceUserId: eff.sourceUserId,
        portalAccountId: eff.portalAccountId,
        agentEmail: eff.agentEmail,
        displayName: eff.displayName,
        kpiIds: new Set(),
        snapshotCount: 0,
        totalItems: 0,
        doneItems: 0,
        percents: [],
        firstPeriodKey: null,
        lastPeriodKey: null,
      });
    }

    const userAverageRows = [...byMergedId.values()].map((u) => {
      const done = Math.min(u.doneItems, u.totalItems);
      const overallPercent = u.totalItems > 0 ? Math.round((done / u.totalItems) * 100) : 0;
      const averagePercent =
        u.percents.length > 0
          ? Math.round(u.percents.reduce((sum, p) => sum + p, 0) / u.percents.length)
          : 0;
      const eff = efficiencies.get(u.sourceUserId.toString());
      return {
        sourceUserId: u.sourceUserId,
        sourceDatabase: sourceTag,
        portalAccountId: u.portalAccountId,
        agentEmail: u.agentEmail,
        displayName: u.displayName,
        kpiCount: u.kpiIds.size,
        snapshotCount: u.snapshotCount,
        totalItems: u.totalItems,
        doneItems: done,
        overallPercent,
        averagePercent,
        taskEfficiency: eff?.taskEfficiency ?? null,
        ticketEfficiency: eff?.ticketEfficiency ?? null,
        overallEfficiency: eff?.overallEfficiency ?? null,
        firstPeriodKey: u.firstPeriodKey,
        lastPeriodKey: u.lastPeriodKey,
      };
    });
    result.synced.kpiUserAverages = await chunkCreateMany(userAverageRows, (batch) =>
      prismaWrite.mergedKpiUserAverage.createMany({ data: batch }),
    dryRun);
  } finally {
    await prismaBootstrap.$disconnect().catch(() => undefined);
    await prismaWrite.$disconnect().catch(() => undefined);
  }

  return result;
}
