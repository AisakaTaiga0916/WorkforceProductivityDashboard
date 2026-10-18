/**
 * Migrate historical KPI period snapshots (+ merged_kpi_user_averages)
 * into merged_user_efficiency_breakdowns / merged_user_efficiency_task_details.
 *
 * Source of truth for history:
 *   - Primary `kpi_maintenance_period_snapshots.contributor_progress`
 *   - Optional ticket closed counts overlapping each period window
 *   - `merged_kpi_user_averages` → one LIFETIME / ALL rollup per user
 *
 * Idempotent upserts on (source_user_id, period_key, frequency).
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
  buildReportingPeriodKey,
  periodWindowFor,
  type EfficiencyFrequency,
} from "@/modules/tasks/efficiency/user-efficiency-breakdown";
import { helpdeskSupportPercent } from "@/modules/tasks/kpis";
import { normalizeTimeZone } from "@/modules/tasks/kpi-recurrence";
import { prismaPrimary } from "@/modules/platform/db/prisma";
import {
  buildCanonicalMergedIdMap,
  canonicalMergedId,
} from "@/lib/sync/merged-person-identity";
import {
  applyPersonnelAverageEfficiencyFloor,
  normalizePersonnelTaskTotals,
} from "@/modules/tasks/task-personnel-metrics";

export type MigrateKpiEfficiencyResult = {
  dryRun: boolean;
  targetDb: string;
  snapshotPeriodsProcessed: number;
  derivedPeriodsProcessed: number;
  lifetimeRows: number;
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

type ContributorAgg = {
  agentId: string;
  name: string;
  total: number;
  done: number;
  entries: Array<{ title: string; total: number; done: number }>;
};

type PeriodBucket = {
  frequency: EfficiencyFrequency | "LIFETIME";
  periodKey: string;
  start: Date;
  end: Date;
  byAgent: Map<string, ContributorAgg>;
};

function env(name: string, fallback: string): string {
  const v = process.env[name]?.trim();
  return v || fallback;
}

function resolveWriteUrl(): string {
  const explicit = process.env.DATABASE_URL_SECONDARY_SYNC?.trim();
  if (explicit) return explicit;
  const appUrl = process.env.DATABASE_URL_SECONDARY?.trim();
  if (appUrl && !appUrl.includes("merge_app@")) return appUrl;
  return "mysql://root@localhost:3306/mergedatabase-demo";
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function computeOverall(task: number | null, ticket: number | null): number {
  const values = [task, ticket].filter((v): v is number => v != null && Number.isFinite(v));
  if (values.length === 0) return applyPersonnelAverageEfficiencyFloor(0);
  return applyPersonnelAverageEfficiencyFloor(
    values.reduce((a, b) => a + b, 0) / values.length,
  );
}

/** Parse `D:Asia/Manila:2026-03-02` / legacy `D:2026-03-02` → window + reporting key. */
export function parseKpiSnapshotPeriodKey(
  frequency: string,
  periodKey: string,
  timeZone: string,
): { frequency: EfficiencyFrequency; reportingKey: string; start: Date; end: Date } | null {
  const zone = normalizeTimeZone(timeZone);
  const withTz = periodKey.match(/^([DWMQ]):([^:]+):(\d{4}-\d{2}-\d{2})$/);
  const legacy = periodKey.match(/^([DWMQ]):(\d{4}-\d{2}-\d{2})$/);
  let prefix: string;
  let ymd: string;
  let keyZone = zone;
  if (withTz) {
    prefix = withTz[1];
    keyZone = normalizeTimeZone(withTz[2]);
    ymd = withTz[3];
  } else if (legacy) {
    prefix = legacy[1];
    ymd = legacy[2];
  } else {
    return null;
  }

  const startDt = DateTime.fromISO(ymd, { zone: keyZone }).startOf("day");
  if (!startDt.isValid) return null;

  const freqFromPrefix =
    prefix === "D"
      ? "DAILY"
      : prefix === "W"
        ? "WEEKLY"
        : prefix === "M"
          ? "MONTHLY"
          : "QUARTERLY";
  // Prefer calendar window from the ISO date in the snapshot key.
  if (freqFromPrefix === "DAILY") {
    return {
      frequency: "DAILY",
      reportingKey: ymd,
      start: startDt.toJSDate(),
      end: startDt.plus({ days: 1 }).toJSDate(),
    };
  }
  if (freqFromPrefix === "MONTHLY") {
    const mStart = startDt.startOf("month");
    return {
      frequency: "MONTHLY",
      reportingKey: buildReportingPeriodKey("MONTHLY", mStart),
      start: mStart.toJSDate(),
      end: mStart.plus({ months: 1 }).toJSDate(),
    };
  }
  if (freqFromPrefix === "WEEKLY") {
    return {
      frequency: "WEEKLY",
      reportingKey: buildReportingPeriodKey("WEEKLY", startDt),
      start: startDt.toJSDate(),
      end: startDt.plus({ weeks: 1 }).toJSDate(),
    };
  }
  const qStart = startDt.startOf("quarter");
  return {
    frequency: "QUARTERLY",
    reportingKey: buildReportingPeriodKey("QUARTERLY", qStart),
    start: qStart.toJSDate(),
    end: qStart.plus({ months: 3 }).toJSDate(),
  };
}

function mergeContributor(
  map: Map<string, ContributorAgg>,
  agentId: string,
  name: string,
  total: number,
  done: number,
) {
  const cur = map.get(agentId) ?? {
    agentId,
    name,
    total: 0,
    done: 0,
    entries: [],
  };
  cur.total += total;
  cur.done += Math.min(done, total);
  cur.name = name || cur.name;
  cur.entries.push({
    title: name ? `KPI checklist · ${name}` : "KPI checklist contribution",
    total,
    done: Math.min(done, total),
  });
  map.set(agentId, cur);
}

function parseContributorProgress(
  raw: unknown,
  sink: Map<string, ContributorAgg>,
) {
  if (!Array.isArray(raw)) return;
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id : "";
    const name = typeof row.name === "string" ? row.name : "";
    const total = Number(row.total);
    const done = Number(row.done);
    if (!id || id === "__unassigned__" || !Number.isFinite(total) || total <= 0) continue;
    mergeContributor(sink, id, name, total, done);
  }
}

async function loadAgentEnrichment(): Promise<Map<string, AgentEnrichment>> {
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
  const tokens = (name: string) =>
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
  const out = new Map<string, AgentEnrichment>();
  for (const agent of agents) {
    let portal = byEmail.get(agent.email.trim().toLowerCase()) ?? null;
    if (!portal?.mergedSourceUserId) {
      const at = tokens(agent.name);
      let best: (typeof linked)[number] | null = null;
      let bestScore = 0;
      for (const p of linked) {
        const overlap = [...at].filter((t) => tokens(p.name).has(t)).length;
        if (overlap >= 2 && overlap > bestScore) {
          best = p;
          bestScore = overlap;
        }
      }
      portal = best;
    }
    if (!portal?.mergedSourceUserId) continue;
    out.set(agent.id, {
      agentId: agent.id,
      email: agent.email,
      name: agent.name,
      mergedSourceUserId: portal.mergedSourceUserId,
      portalAccountId: portal.id,
    });
  }
  return out;
}

async function ticketCountsForWindow(
  start: Date,
  end: Date,
): Promise<Map<string, { closed: number; pending: number }>> {
  const [closedByAgent, pendingByAgent] = await Promise.all([
    prismaPrimary.ticket.groupBy({
      by: ["assignedAgentId"],
      where: {
        assignedAgentId: { not: null },
        closedAt: { gte: start, lt: end },
      },
      _count: true,
    }),
    prismaPrimary.ticket.groupBy({
      by: ["assignedAgentId"],
      where: {
        assignedAgentId: { not: null },
        status: { in: ["OPEN", "IN_PROGRESS"] },
      },
      _count: true,
    }),
  ]);
  const out = new Map<string, { closed: number; pending: number }>();
  for (const r of closedByAgent) {
    if (!r.assignedAgentId) continue;
    const cur = out.get(r.assignedAgentId) ?? { closed: 0, pending: 0 };
    cur.closed += r._count;
    out.set(r.assignedAgentId, cur);
  }
  for (const r of pendingByAgent) {
    if (!r.assignedAgentId) continue;
    const cur = out.get(r.assignedAgentId) ?? { closed: 0, pending: 0 };
    cur.pending += r._count;
    out.set(r.assignedAgentId, cur);
  }
  return out;
}

function deriveRollupBuckets(
  dailyBuckets: PeriodBucket[],
  timeZone: string,
): PeriodBucket[] {
  const zone = normalizeTimeZone(timeZone);
  const groups = new Map<string, PeriodBucket>();

  const add = (freq: EfficiencyFrequency, at: DateTime, source: PeriodBucket) => {
    const win = periodWindowFor(freq, at.setZone(zone));
    const key = `${freq}|${win.periodKey}`;
    let bucket = groups.get(key);
    if (!bucket) {
      bucket = {
        frequency: freq,
        periodKey: win.periodKey,
        start: win.start,
        end: win.end,
        byAgent: new Map(),
      };
      groups.set(key, bucket);
    }
    for (const [agentId, agg] of source.byAgent) {
      mergeContributor(bucket.byAgent, agentId, agg.name, agg.total, agg.done);
    }
  };

  for (const day of dailyBuckets) {
    const at = DateTime.fromJSDate(day.start, { zone });
    add("WEEKLY", at, day);
    add("MONTHLY", at, day);
    add("QUARTERLY", at, day);
    add("SEMI_ANNUAL", at, day);
    add("YEARLY", at, day);
  }
  return [...groups.values()];
}

async function upsertBucket(
  prismaWrite: PrismaClientSecondary,
  bucket: PeriodBucket,
  agentById: Map<string, AgentEnrichment>,
  mergedUserIds: Set<string>,
  ticketEff: Map<string, { closed: number; pending: number }>,
  sourceTag: string,
  dryRun: boolean,
  counters: { upsertedBreakdowns: number; upsertedDetails: number; skippedNoMergedUser: number },
) {
  // Group contributor rows by (canonical) merged user — the same person can
  // appear under several agent ids and their totals must accumulate.
  type PersonAgg = {
    enriched: AgentEnrichment;
    total: number;
    done: number;
    entries: Array<{ title: string; total: number; done: number }>;
    ticketsClosed: number;
    ticketsPending: number;
    hasTicketData: boolean;
  };
  const byMerged = new Map<string, PersonAgg>();
  for (const [agentId, agg] of bucket.byAgent) {
    const enriched = agentById.get(agentId);
    if (!enriched) continue;
    if (!mergedUserIds.has(enriched.mergedSourceUserId.toString())) {
      counters.skippedNoMergedUser++;
      continue;
    }
    const key = enriched.mergedSourceUserId.toString();
    const cur =
      byMerged.get(key) ??
      ({
        enriched,
        total: 0,
        done: 0,
        entries: [],
        ticketsClosed: 0,
        ticketsPending: 0,
        hasTicketData: false,
      } as PersonAgg);
    cur.total += agg.total;
    cur.done += Math.min(agg.done, agg.total);
    cur.entries.push(...agg.entries);
    const counts = ticketEff.get(agentId);
    if (counts) {
      cur.hasTicketData = true;
      cur.ticketsClosed += counts.closed;
      cur.ticketsPending += counts.pending;
    }
    byMerged.set(key, cur);
  }

  for (const person of byMerged.values()) {
    const { enriched, entries } = person;
    const agg = { total: person.total, done: person.done, entries };
    const ticketEfficiency = person.hasTicketData
      ? helpdeskSupportPercent(person.ticketsClosed, person.ticketsPending)
      : null;

    const normalized = normalizePersonnelTaskTotals(agg.total, agg.done);
    const taskEfficiency = normalized.efficiency;
    const overallEfficiency = computeOverall(taskEfficiency, ticketEfficiency);
    const totalTasks = normalized.pending + normalized.closed;
    const completedTasks = normalized.closed;
    const delayedTasks = 0;
    const details = [
      ...agg.entries.map((e) => ({
        taskId: null as string | null,
        taskSource: "KPI_CHECKLIST",
        taskTitle: e.title.slice(0, 512),
        status: e.done >= e.total ? "DONE" : "CURRENT",
        dueAt: null as Date | null,
        completedAt: null as Date | null,
        efficiencyContribution:
          e.total > 0 ? round2((e.done / e.total) * taskEfficiency) : 0,
        notes: "Migrated from kpi_maintenance_period_snapshots.contributor_progress",
      })),
      ...(ticketEfficiency != null
        ? [
            {
              taskId: null as string | null,
              taskSource: "TICKET_SUMMARY",
              taskTitle: "Ticket efficiency (period)",
              status: "DONE",
              dueAt: null as Date | null,
              completedAt: null as Date | null,
              efficiencyContribution: round2(ticketEfficiency),
              notes: "Migrated/computed from primary tickets closed in period window",
            },
          ]
        : []),
    ];

    if (dryRun) {
      counters.upsertedBreakdowns++;
      counters.upsertedDetails += details.length;
      continue;
    }

    const existing = await prismaWrite.mergedUserEfficiencyBreakdown.findUnique({
      where: {
        sourceUserId_periodKey_frequency: {
          sourceUserId: enriched.mergedSourceUserId,
          periodKey: bucket.periodKey,
          frequency: bucket.frequency,
        },
      },
      select: { id: true },
    });
    const breakdownId = existing?.id ?? randomUUID();
    const payload = {
      portalAccountId: enriched.portalAccountId,
      displayName: enriched.name,
      periodStartAt: bucket.start,
      periodEndAt: bucket.end,
      overallEfficiency: new Prisma.Decimal(round2(overallEfficiency)),
      taskEfficiency: new Prisma.Decimal(round2(taskEfficiency)),
      ticketEfficiency:
        ticketEfficiency != null ? new Prisma.Decimal(round2(ticketEfficiency)) : null,
      totalTasks,
      completedTasks,
      delayedTasks,
      ticketsClosed: person.ticketsClosed,
      ticketsPending: person.ticketsPending,
      onTimeCompletionRate: null,
      averageTaskCompletionHours: null,
      efficiencyScore: new Prisma.Decimal(round2(overallEfficiency)),
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
          sourceUserId: enriched.mergedSourceUserId,
          periodKey: bucket.periodKey,
          frequency: bucket.frequency,
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
          notes: d.notes,
        })),
      });
    }

    counters.upsertedBreakdowns++;
    counters.upsertedDetails += details.length;
  }
}

async function migrateLifetimeAverages(
  prismaWrite: PrismaClientSecondary,
  agentById: Map<string, AgentEnrichment>,
  mergedUserIds: Set<string>,
  sourceTag: string,
  dryRun: boolean,
  counters: { upsertedBreakdowns: number; upsertedDetails: number; skippedNoMergedUser: number },
): Promise<number> {
  const averages = await prismaWrite.mergedKpiUserAverage.findMany();
  const byMerged = new Map(averages.map((a) => [a.sourceUserId.toString(), a]));
  // Also index agents by merged id for display.
  const agentByMerged = new Map<string, AgentEnrichment>();
  for (const a of agentById.values()) {
    agentByMerged.set(a.mergedSourceUserId.toString(), a);
  }

  let lifetimeRows = 0;
  for (const [mergedId, avg] of byMerged) {
    if (!mergedUserIds.has(mergedId)) {
      counters.skippedNoMergedUser++;
      continue;
    }
    const enriched = agentByMerged.get(mergedId);
    const taskEfficiency = avg.taskEfficiency ?? avg.overallPercent;
    const ticketEfficiency = avg.ticketEfficiency;
    const overall =
      avg.overallEfficiency ??
      computeOverall(
        taskEfficiency,
        ticketEfficiency != null ? ticketEfficiency : null,
      );

    const start = avg.firstPeriodKey
      ? parseKpiSnapshotPeriodKey("DAILY", avg.firstPeriodKey, "Asia/Manila")?.start ??
        avg.computedAt
      : avg.computedAt;
    const end = avg.lastPeriodKey
      ? parseKpiSnapshotPeriodKey("DAILY", avg.lastPeriodKey, "Asia/Manila")?.end ??
        avg.computedAt
      : avg.computedAt;

    if (dryRun) {
      counters.upsertedBreakdowns++;
      counters.upsertedDetails += 1;
      lifetimeRows++;
      continue;
    }

    const existing = await prismaWrite.mergedUserEfficiencyBreakdown.findUnique({
      where: {
        sourceUserId_periodKey_frequency: {
          sourceUserId: avg.sourceUserId,
          periodKey: "ALL",
          frequency: "LIFETIME",
        },
      },
      select: { id: true },
    });
    const breakdownId = existing?.id ?? randomUUID();
    const payload = {
      portalAccountId: avg.portalAccountId ?? enriched?.portalAccountId ?? null,
      displayName: avg.displayName,
      periodStartAt: start,
      periodEndAt: end,
      overallEfficiency: new Prisma.Decimal(round2(overall)),
      taskEfficiency: new Prisma.Decimal(round2(taskEfficiency)),
      ticketEfficiency:
        ticketEfficiency != null ? new Prisma.Decimal(round2(ticketEfficiency)) : null,
      totalTasks: avg.totalItems,
      completedTasks: avg.doneItems,
      delayedTasks: 0,
      onTimeCompletionRate: null,
      averageTaskCompletionHours: null,
      efficiencyScore: new Prisma.Decimal(round2(overall)),
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
          sourceUserId: avg.sourceUserId,
          periodKey: "ALL",
          frequency: "LIFETIME",
          ...payload,
        },
      });
    }

    await prismaWrite.mergedUserEfficiencyTaskDetail.createMany({
      data: [
        {
          id: randomUUID(),
          breakdownId,
          taskId: null,
          taskSource: "KPI_CHECKLIST",
          taskTitle: "Lifetime KPI average (migrated)",
          status: "DONE",
          dueAt: null,
          completedAt: null,
          efficiencyContribution: new Prisma.Decimal(round2(overall)),
          notes: `Migrated from merged_kpi_user_averages (kpiCount=${avg.kpiCount}, snapshotCount=${avg.snapshotCount}, overallPercent=${avg.overallPercent}).`,
        },
      ],
    });

    counters.upsertedBreakdowns++;
    counters.upsertedDetails += 1;
    lifetimeRows++;
  }
  return lifetimeRows;
}

export async function runMigrateKpiToEfficiencyBreakdowns(options?: {
  dryRun?: boolean;
  timeZone?: string;
  sourceTag?: string;
  /** Also roll daily snapshot data into WEEKLY / MONTHLY / QUARTERLY reporting keys. */
  deriveRollups?: boolean;
  /** Migrate merged_kpi_user_averages → frequency=LIFETIME periodKey=ALL */
  includeLifetime?: boolean;
}): Promise<MigrateKpiEfficiencyResult> {
  const dryRun = options?.dryRun ?? false;
  const timeZone = normalizeTimeZone(options?.timeZone ?? "Asia/Manila");
  const sourceTag = options?.sourceTag ?? env("TICKETING_MERGE_SOURCE_TAG", "ticketing_system");
  const deriveRollups = options?.deriveRollups !== false;
  const includeLifetime = options?.includeLifetime !== false;

  const writeUrl = resolveWriteUrl();
  const targetDb = parseMysqlDatabaseName(writeUrl) ?? "mergedatabase-demo";
  const bootstrapUrl = bootstrapMysqlUrl(writeUrl);

  const prismaBootstrap = new PrismaClientSecondary({
    datasources: { db: { url: bootstrapUrl } },
  });
  const prismaWrite = new PrismaClientSecondary({
    datasources: { db: { url: writeUrl } },
  });

  const counters = {
    upsertedBreakdowns: 0,
    upsertedDetails: 0,
    skippedNoMergedUser: 0,
  };

  const result: MigrateKpiEfficiencyResult = {
    dryRun,
    targetDb,
    snapshotPeriodsProcessed: 0,
    derivedPeriodsProcessed: 0,
    lifetimeRows: 0,
    upsertedBreakdowns: 0,
    upsertedDetails: 0,
    skippedNoMergedUser: 0,
  };

  try {
    await prismaBootstrap.$connect();
    await ensureUserEfficiencyBreakdownTables(prismaBootstrap, targetDb);
    await prismaBootstrap.$disconnect();

    await prismaWrite.$connect();
    await prismaPrimary.$connect();

    const agentById = await loadAgentEnrichment();
    const existingUsers = await prismaWrite.mergedUser.findMany({
      select: { sourceUserId: true, name: true, email: true },
    });
    const mergedUserIds = new Set(existingUsers.map((u) => u.sourceUserId.toString()));
    // Fold portal-synthetic merged ids into their HRIS person (personnel-tab row).
    const canonicalIds = buildCanonicalMergedIdMap(existingUsers);
    for (const enrichment of agentById.values()) {
      enrichment.mergedSourceUserId = canonicalMergedId(
        enrichment.mergedSourceUserId,
        canonicalIds,
      );
    }

    const snapshots = await prismaPrimary.kpiMaintenancePeriodSnapshot.findMany({
      select: {
        periodKey: true,
        frequency: true,
        contributorProgress: true,
        capturedAt: true,
      },
      orderBy: { capturedAt: "asc" },
    });

    const snapshotBuckets = new Map<string, PeriodBucket>();

    for (const snap of snapshots) {
      const parsed = parseKpiSnapshotPeriodKey(snap.frequency, snap.periodKey, timeZone);
      if (!parsed) continue;
      const mapKey = `${parsed.frequency}|${parsed.reportingKey}`;
      let bucket = snapshotBuckets.get(mapKey);
      if (!bucket) {
        bucket = {
          frequency: parsed.frequency,
          periodKey: parsed.reportingKey,
          start: parsed.start,
          end: parsed.end,
          byAgent: new Map(),
        };
        snapshotBuckets.set(mapKey, bucket);
      }
      parseContributorProgress(snap.contributorProgress, bucket.byAgent);
    }

    result.snapshotPeriodsProcessed = snapshotBuckets.size;

    const dailyBuckets = [...snapshotBuckets.values()].filter((b) => b.frequency === "DAILY");
    const derived = deriveRollups ? deriveRollupBuckets(dailyBuckets, timeZone) : [];
    result.derivedPeriodsProcessed = derived.length;

    const allBuckets = [...snapshotBuckets.values(), ...derived];

    // Cache ticket eff by window key to avoid repeat queries.
    const ticketCache = new Map<string, Map<string, { closed: number; pending: number }>>();

    for (const bucket of allBuckets) {
      const tKey = `${bucket.start.toISOString()}|${bucket.end.toISOString()}`;
      let ticketEff = ticketCache.get(tKey);
      if (!ticketEff) {
        ticketEff = await ticketCountsForWindow(bucket.start, bucket.end);
        ticketCache.set(tKey, ticketEff);
      }
      await upsertBucket(
        prismaWrite,
        bucket,
        agentById,
        mergedUserIds,
        ticketEff,
        sourceTag,
        dryRun,
        counters,
      );
    }

    if (includeLifetime) {
      result.lifetimeRows = await migrateLifetimeAverages(
        prismaWrite,
        agentById,
        mergedUserIds,
        sourceTag,
        dryRun,
        counters,
      );
    }

    result.upsertedBreakdowns = counters.upsertedBreakdowns;
    result.upsertedDetails = counters.upsertedDetails;
    result.skippedNoMergedUser = counters.skippedNoMergedUser;
  } finally {
    await prismaBootstrap.$disconnect().catch(() => undefined);
    await prismaWrite.$disconnect().catch(() => undefined);
  }

  return result;
}
