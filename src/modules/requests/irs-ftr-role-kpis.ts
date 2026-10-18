/**
 * IRS / FTR personnel KPIs — credit Canvassed By (IRS) and Prepared By (FTR).
 * Mirrors RFP role attribution in {@link loadRfpRolePersonnelMetrics}.
 */

import { Prisma } from "@prisma/client/primary";
import { prisma } from "@/modules/platform/db/prisma";
import {
  parseItemRequisitionApprovalMeta,
  type ItemRequisitionApprovalMeta,
} from "@/modules/requests/item-requisition-approval";
import {
  parseFundTransferApprovalMeta,
  type FundTransferApprovalMeta,
} from "@/modules/requests/fund-transfer-approval";

export type RolePersonnelMetric = {
  id: string;
  name: string;
  closed: number;
  pending: number;
  efficiency: number;
};

type WorkingDayInterval = { start: Date; end: Date };

function roleEfficiencyPercent(closed: number, pending: number): number {
  const total = closed + pending;
  if (total <= 0) return 0;
  return Number(Math.min(100, (closed / total) * 100).toFixed(1));
}

function timestampInWorkingDays(iso: string | undefined, intervals: WorkingDayInterval[]): boolean {
  if (!iso || intervals.length === 0) return false;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return false;
  return intervals.some((i) => t >= i.start.getTime() && t <= i.end.getTime());
}

function agentInScope(
  agentId: string | null | undefined,
  scopedAgentIds: Set<string> | null,
): agentId is string {
  if (!agentId) return false;
  if (!scopedAgentIds) return true;
  return scopedAgentIds.has(agentId);
}

function resolveScopedAgentIds(scoped: Record<string, unknown>): Set<string> | null {
  const raw = (scoped as { assignedAgentId?: unknown }).assignedAgentId;
  if (raw == null) return null;
  if (typeof raw === "string") return new Set([raw]);
  if (typeof raw === "object" && raw !== null && "in" in raw) {
    const ids = (raw as { in: unknown }).in;
    if (Array.isArray(ids)) {
      return new Set(ids.filter((id): id is string => typeof id === "string" && Boolean(id)));
    }
  }
  return null;
}

type RoleCounts = Map<string, { closed: number; pending: number }>;

function bump(map: RoleCounts, agentId: string, field: "closed" | "pending") {
  const cur = map.get(agentId) ?? { closed: 0, pending: 0 };
  cur[field] += 1;
  map.set(agentId, cur);
}

async function metricsFromCounts(counts: RoleCounts): Promise<RolePersonnelMetric[]> {
  const agentIds = [...counts.keys()];
  if (agentIds.length === 0) return [];
  const agents = await prisma.agent.findMany({
    where: { id: { in: agentIds } },
    select: { id: true, name: true },
  });
  const nameById = new Map(agents.map((a) => [a.id, a.name]));
  return agentIds
    .map((id) => {
      const { closed, pending } = counts.get(id) ?? { closed: 0, pending: 0 };
      return {
        id,
        name: nameById.get(id)?.trim() || "Unknown",
        closed,
        pending,
        efficiency: roleEfficiencyPercent(closed, pending),
      };
    })
    .filter((row) => row.closed > 0 || row.pending > 0)
    .sort((a, b) => b.efficiency - a.efficiency || b.closed - a.closed || a.name.localeCompare(b.name));
}

/**
 * IRS Canvassed By KPIs from `item_requisition_approval_meta`.
 * Closed = canvass completed AND request confirmed (`closedAt`) on a Mon–Sat day in range.
 * Pending = currently awaiting Canvassed By (before confirmation).
 */
export async function loadIrsCanvassPersonnelMetrics(
  scoped: Record<string, unknown>,
  workingDayIntervals: WorkingDayInterval[],
): Promise<RolePersonnelMetric[]> {
  const scopedAgentIds = resolveScopedAgentIds(scoped);
  if (scopedAgentIds && scopedAgentIds.size === 0) return [];

  const tickets = await prisma.ticket.findMany({
    where: {
      requestType: "ITEM_REQUISITION_SLIP",
      itemRequisitionApprovalMeta: { not: Prisma.DbNull },
    },
    select: {
      id: true,
      assignedAgentId: true,
      closedAt: true,
      itemRequisitionApprovalMeta: true,
    },
  });

  const counts: RoleCounts = new Map();

  for (const row of tickets) {
    const meta = parseItemRequisitionApprovalMeta(
      row.itemRequisitionApprovalMeta,
    ) as ItemRequisitionApprovalMeta | null;
    if (!meta) continue;

    const confirmedInRange = timestampInWorkingDays(
      row.closedAt?.toISOString(),
      workingDayIntervals,
    );
    // Credit only the explicit Canvassed By seat — never the board assignee.
    if (confirmedInRange && meta.completed.CANVASSED_BY) {
      const creditId = meta.canvassedByAgentId?.trim() || null;
      if (agentInScope(creditId, scopedAgentIds)) bump(counts, creditId, "closed");
    }

    if (meta.proceduralStep === "CANVASSED_BY") {
      const pendingId = meta.canvassedByAgentId?.trim() || null;
      if (agentInScope(pendingId, scopedAgentIds)) bump(counts, pendingId, "pending");
    }
  }

  return metricsFromCounts(counts);
}

/**
 * FTR Prepared By KPIs from `fund_transfer_approval_meta`.
 * Closed = prepare completed AND request confirmed (`closedAt`) on a Mon–Sat day in range.
 * Pending = currently awaiting Prepared By (before confirmation).
 */
export async function loadFtrPreparedPersonnelMetrics(
  scoped: Record<string, unknown>,
  workingDayIntervals: WorkingDayInterval[],
): Promise<RolePersonnelMetric[]> {
  const scopedAgentIds = resolveScopedAgentIds(scoped);
  if (scopedAgentIds && scopedAgentIds.size === 0) return [];

  const tickets = await prisma.ticket.findMany({
    where: {
      requestType: "FUND_TRANSFER_REQUEST",
      fundTransferApprovalMeta: { not: Prisma.DbNull },
    },
    select: {
      id: true,
      assignedAgentId: true,
      closedAt: true,
      fundTransferApprovalMeta: true,
    },
  });

  const counts: RoleCounts = new Map();

  for (const row of tickets) {
    const meta = parseFundTransferApprovalMeta(
      row.fundTransferApprovalMeta,
    ) as FundTransferApprovalMeta | null;
    if (!meta) continue;

    const confirmedInRange = timestampInWorkingDays(
      row.closedAt?.toISOString(),
      workingDayIntervals,
    );
    // Credit only the explicit Prepared By seat — never the board assignee.
    if (confirmedInRange && meta.completed.PREPARED_BY) {
      const creditId = meta.preparedByAgentId?.trim() || null;
      if (agentInScope(creditId, scopedAgentIds)) bump(counts, creditId, "closed");
    }

    if (meta.proceduralStep === "PREPARED_BY") {
      const pendingId = meta.preparedByAgentId?.trim() || null;
      if (agentInScope(pendingId, scopedAgentIds)) bump(counts, pendingId, "pending");
    }
  }

  return metricsFromCounts(counts);
}
