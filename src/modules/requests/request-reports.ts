/** Requests → Reports: volume, throughput, SLA / aging for the viewer's request scope. */

import type { Prisma, TicketStatus } from "@prisma/client/primary";
import { prisma } from "@/modules/platform/db/prisma";
import { ACTIVE_REQUEST_STATUSES } from "@/modules/requests/active-request-statuses";
import { REQUEST_TYPES, requestTypeLabel } from "@/modules/requests/request-types";
import { getTicketSlaState } from "@/modules/requests/sla-shared";
import { formatTicketStatusLabel } from "@/modules/requests/ticket-status-label";
import {
  loadTicketBoardLaneEnteredAtMap,
  loadTicketForConfirmationEnteredAtMap,
  loadTicketLastActivityAtMap,
} from "@/modules/requests/request-board-columns";
import {
  buildCsatStarDistribution,
  type CsatStarDistributionRow,
} from "@/modules/tasks/kpis";
import {
  bucketIndexFor,
  hoursBetween,
  median,
  reportBuckets,
  type ReportRange,
} from "@/modules/reports/report-range";

/** Row caps keep a single report bounded; the UI flags when a cap is hit. */
const RANGE_ROW_CAP = 20_000;
const OPEN_ROW_CAP = 3_000;

const AGING_BUCKETS: Array<{ label: string; maxHours: number }> = [
  { label: "< 1 day", maxHours: 24 },
  { label: "1–3 days", maxHours: 72 },
  { label: "3–7 days", maxHours: 168 },
  { label: "7–14 days", maxHours: 336 },
  { label: "14+ days", maxHours: Number.POSITIVE_INFINITY },
];

export type RequestReport = {
  totals: {
    created: number;
    resolved: number;
    openNow: number;
    overdueNow: number;
    atRiskNow: number;
    medianFirstResponseHours: number | null;
    medianResolutionHours: number | null;
    closed: number;
    /** Resolved → closed (customer confirmation), for tickets closed in range. */
    medianConfirmationHours: number | null;
  };
  /** Shares of requests created in range (null when none were created). */
  sla: {
    firstResponseMetRate: number | null;
    resolutionMetRate: number | null;
    transferRequestRate: number | null;
    reopenRate: number | null;
  };
  quality: {
    feedbackCount: number;
    csatAvg: number | null;
    csatByStar: CsatStarDistributionRow[];
  };
  closedByAssignee: Array<{ agentId: string; name: string; closed: number }>;
  trend: Array<{ key: string; label: string; created: number; resolved: number }>;
  byType: Array<{
    type: string;
    label: string;
    created: number;
    resolved: number;
    openNow: number;
    overdueNow: number;
    medianResolutionHours: number | null;
  }>;
  openByStatus: Array<{ status: TicketStatus; label: string; count: number }>;
  aging: Array<{ label: string; count: number }>;
  truncated: boolean;
};

function typeKey(raw: string | null | undefined): string {
  return raw?.trim() || "ISSUE_CONCERN_TICKET";
}

export async function loadRequestReport(input: {
  where: Prisma.TicketWhereInput;
  range: ReportRange;
}): Promise<RequestReport> {
  const { where, range } = input;
  const inRange = { gte: range.start, lt: range.endExclusive };

  const [created, resolved, open, closedRows, transferRequests, feedbackAgg, feedbackByStar] =
    await Promise.all([
    prisma.ticket.findMany({
      where: { AND: [where, { createdAt: inRange }] },
      select: {
        requestType: true,
        createdAt: true,
        firstResponseAt: true,
        firstResponseDueAt: true,
        resolvedAt: true,
        resolutionDueAt: true,
        reopenCount: true,
      },
      take: RANGE_ROW_CAP,
    }),
    prisma.ticket.findMany({
      where: { AND: [where, { resolvedAt: inRange }] },
      select: { requestType: true, createdAt: true, resolvedAt: true },
      take: RANGE_ROW_CAP,
    }),
    prisma.ticket.findMany({
      where: { AND: [where, { status: { in: ACTIVE_REQUEST_STATUSES } }] },
      select: {
        id: true,
        status: true,
        requestType: true,
        createdAt: true,
        updatedAt: true,
        resolvedAt: true,
      },
      orderBy: { createdAt: "asc" },
      take: OPEN_ROW_CAP,
    }),
    prisma.ticket.findMany({
      where: { AND: [where, { closedAt: inRange }] },
      select: { assignedAgentId: true, resolvedAt: true, closedAt: true },
      take: RANGE_ROW_CAP,
    }),
    prisma.ticketActivity.count({
      where: { summary: "Transfer requested", createdAt: inRange, ticket: where },
    }),
    prisma.ticketFeedback.aggregate({
      where: { createdAt: inRange, ticket: where },
      _avg: { csat: true },
      _count: true,
    }),
    prisma.ticketFeedback.groupBy({
      by: ["csat"],
      where: { createdAt: inRange, ticket: where, csat: { gte: 1, lte: 5 } },
      _count: true,
    }),
  ]);

  const openIds = open.map((row) => row.id);
  const [laneEnteredById, lastActivityById, forConfirmationById] = await Promise.all([
    loadTicketBoardLaneEnteredAtMap(openIds),
    loadTicketLastActivityAtMap(openIds),
    loadTicketForConfirmationEnteredAtMap(openIds),
  ]);

  const buckets = reportBuckets(range);
  const trend = buckets.map((b) => ({ key: b.key, label: b.label, created: 0, resolved: 0 }));

  type TypeAcc = {
    created: number;
    resolved: number;
    openNow: number;
    overdueNow: number;
    resolutionHours: number[];
  };
  const byType = new Map<string, TypeAcc>();
  const typeAcc = (raw: string | null | undefined): TypeAcc => {
    const key = typeKey(raw);
    let acc = byType.get(key);
    if (!acc) {
      acc = { created: 0, resolved: 0, openNow: 0, overdueNow: 0, resolutionHours: [] };
      byType.set(key, acc);
    }
    return acc;
  };
  for (const t of REQUEST_TYPES) typeAcc(t.id);

  const firstResponseHours: number[] = [];
  for (const row of created) {
    typeAcc(row.requestType).created += 1;
    const idx = bucketIndexFor(buckets, row.createdAt);
    if (idx >= 0) trend[idx]!.created += 1;
    if (row.firstResponseAt) firstResponseHours.push(hoursBetween(row.firstResponseAt, row.createdAt));
  }

  const resolutionHours: number[] = [];
  for (const row of resolved) {
    if (!row.resolvedAt) continue;
    const acc = typeAcc(row.requestType);
    acc.resolved += 1;
    const hours = hoursBetween(row.resolvedAt, row.createdAt);
    acc.resolutionHours.push(hours);
    resolutionHours.push(hours);
    const idx = bucketIndexFor(buckets, row.resolvedAt);
    if (idx >= 0) trend[idx]!.resolved += 1;
  }

  const statusCounts = new Map<TicketStatus, number>();
  const aging = AGING_BUCKETS.map((b) => ({ label: b.label, count: 0 }));
  const now = new Date();
  let overdueNow = 0;
  let atRiskNow = 0;
  for (const row of open) {
    const acc = typeAcc(row.requestType);
    acc.openNow += 1;
    statusCounts.set(row.status, (statusCounts.get(row.status) ?? 0) + 1);
    const ageHours = hoursBetween(now, row.createdAt);
    const agingIdx = AGING_BUCKETS.findIndex((b) => ageHours < b.maxHours);
    aging[agingIdx >= 0 ? agingIdx : aging.length - 1]!.count += 1;
    const state = getTicketSlaState({
      ...row,
      boardLaneEnteredAt: laneEnteredById.get(row.id) ?? row.updatedAt,
      lastActivityAt: lastActivityById.get(row.id) ?? null,
      forConfirmationAt:
        forConfirmationById.get(row.id) ??
        (row.status === "FOR_CONFIRMATION" ? (row.resolvedAt ?? null) : null),
    });
    if (state === "BREACHED") {
      overdueNow += 1;
      acc.overdueNow += 1;
    } else if (state === "AT_RISK") {
      atRiskNow += 1;
    }
  }

  // SLA compliance (same basis as the former Insights page): of requests created in
  // range that got a first response / resolution, the share that met the due time.
  const responded = created.filter((row) => row.firstResponseAt);
  const resolvedFromCreated = created.filter((row) => row.resolvedAt);
  const rate = (part: number, whole: number) => (whole === 0 ? null : part / whole);
  const sla = {
    firstResponseMetRate: rate(
      responded.filter((row) => row.firstResponseAt! <= row.firstResponseDueAt).length,
      responded.length,
    ),
    resolutionMetRate: rate(
      resolvedFromCreated.filter((row) => row.resolvedAt! <= row.resolutionDueAt).length,
      resolvedFromCreated.length,
    ),
    transferRequestRate: rate(transferRequests, created.length),
    reopenRate: rate(created.filter((row) => row.reopenCount > 0).length, created.length),
  };

  const confirmationHours: number[] = [];
  const closedByAgent = new Map<string, number>();
  for (const row of closedRows) {
    if (row.resolvedAt && row.closedAt && row.closedAt >= row.resolvedAt) {
      confirmationHours.push(hoursBetween(row.closedAt, row.resolvedAt));
    }
    if (row.assignedAgentId) {
      closedByAgent.set(row.assignedAgentId, (closedByAgent.get(row.assignedAgentId) ?? 0) + 1);
    }
  }
  const closerAgents = closedByAgent.size
    ? await prisma.agent.findMany({
        where: { id: { in: [...closedByAgent.keys()] } },
        select: { id: true, name: true },
      })
    : [];
  const closerNames = new Map(closerAgents.map((a) => [a.id, a.name]));

  return {
    totals: {
      created: created.length,
      resolved: resolved.length,
      openNow: open.length,
      overdueNow,
      atRiskNow,
      medianFirstResponseHours: median(firstResponseHours),
      medianResolutionHours: median(resolutionHours),
      closed: closedRows.length,
      medianConfirmationHours: median(confirmationHours),
    },
    sla,
    quality: {
      feedbackCount: feedbackAgg._count,
      csatAvg: feedbackAgg._avg.csat,
      csatByStar: buildCsatStarDistribution(
        feedbackByStar
          .filter((row): row is typeof row & { csat: number } => row.csat != null)
          .map((row) => ({ csat: row.csat, _count: row._count })),
      ),
    },
    closedByAssignee: [...closedByAgent.entries()]
      .map(([agentId, closed]) => ({ agentId, name: closerNames.get(agentId) ?? "Unknown", closed }))
      .sort((a, b) => b.closed - a.closed || a.name.localeCompare(b.name))
      .slice(0, 15),
    trend,
    byType: [...byType.entries()]
      .map(([type, acc]) => ({
        type,
        label: requestTypeLabel(type),
        created: acc.created,
        resolved: acc.resolved,
        openNow: acc.openNow,
        overdueNow: acc.overdueNow,
        medianResolutionHours: median(acc.resolutionHours),
      }))
      .sort((a, b) => b.created + b.openNow - (a.created + a.openNow)),
    // Several statuses share a board label (e.g. In progress); merge them like the board does.
    openByStatus: ACTIVE_REQUEST_STATUSES.reduce<RequestReport["openByStatus"]>((acc, status) => {
      const label = formatTicketStatusLabel(status);
      const count = statusCounts.get(status) ?? 0;
      const existing = acc.find((row) => row.label === label);
      if (existing) existing.count += count;
      else acc.push({ status, label, count });
      return acc;
    }, []),
    aging,
    truncated:
      created.length >= RANGE_ROW_CAP ||
      resolved.length >= RANGE_ROW_CAP ||
      closedRows.length >= RANGE_ROW_CAP ||
      open.length >= OPEN_ROW_CAP,
  };
}

/** Ticket-level rows (created in range) for CSV export. */
export async function loadRequestReportExportRows(input: {
  where: Prisma.TicketWhereInput;
  range: ReportRange;
}): Promise<Array<Array<string | number | null>>> {
  const rows = await prisma.ticket.findMany({
    where: { AND: [input.where, { createdAt: { gte: input.range.start, lt: input.range.endExclusive } }] },
    select: {
      ticketNumber: true,
      title: true,
      requestType: true,
      status: true,
      priority: true,
      createdAt: true,
      firstResponseAt: true,
      resolvedAt: true,
      team: { select: { name: true } },
      assignedAgent: { select: { name: true } },
    },
    orderBy: { createdAt: "asc" },
    take: RANGE_ROW_CAP,
  });
  const header = [
    "Request #",
    "Title",
    "Type",
    "Status",
    "Priority",
    "Company",
    "Assignee",
    "Created",
    "First response",
    "Resolved",
    "First response (h)",
    "Resolution (h)",
  ];
  const round = (h: number) => Math.round(h * 10) / 10;
  return [
    header,
    ...rows.map((r) => [
      r.ticketNumber,
      r.title,
      requestTypeLabel(r.requestType),
      formatTicketStatusLabel(r.status),
      r.priority,
      r.team?.name ?? null,
      r.assignedAgent?.name ?? null,
      r.createdAt.toISOString(),
      r.firstResponseAt?.toISOString() ?? null,
      r.resolvedAt?.toISOString() ?? null,
      r.firstResponseAt ? round(hoursBetween(r.firstResponseAt, r.createdAt)) : null,
      r.resolvedAt ? round(hoursBetween(r.resolvedAt, r.createdAt)) : null,
    ]),
  ];
}
