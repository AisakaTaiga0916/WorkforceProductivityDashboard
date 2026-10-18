/**
 * Request for Payment personnel KPIs — helpdesk-style metrics for
 * Prepared by Bookkeeper and Approved By Accounting.
 * Requestors are not credited (submitting an RFP is not a KPI).
 */

import { Prisma } from "@prisma/client/primary";
import { prisma } from "@/modules/platform/db/prisma";
import {
  parsePaymentApprovalMeta,
  type PaymentApprovalMeta,
} from "@/modules/requests/request-for-payment-approval";

export type RfpRolePersonnelMetric = {
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

async function metricsFromCounts(counts: RoleCounts): Promise<RfpRolePersonnelMetric[]> {
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
 * Build Accounting / Finance personnel KPIs from RFP tickets.
 * Requestor and Approved By are not credited — only Prepared by Bookkeeper
 * (`accountingAgentId`) and Approved By Accounting (`financeAgentId`).
 * Closed = request confirmed (`closedAt`) on a Mon–Sat day in range
 *   and the role step completed.
 * Pending = awaiting that role step, and only when that seat is assigned.
 * Never fall back to the board assignee (often the Approver while Bookkeeper
 * / Accounting seats are still empty).
 */
export async function loadRfpRolePersonnelMetrics(
  scoped: Record<string, unknown>,
  workingDayIntervals: WorkingDayInterval[],
): Promise<{
  /** Always empty — requestors are not credited for RFP KPIs. */
  requestor: RfpRolePersonnelMetric[];
  accounting: RfpRolePersonnelMetric[];
  finance: RfpRolePersonnelMetric[];
}> {
  const scopedAgentIds = resolveScopedAgentIds(scoped);
  if (scopedAgentIds && scopedAgentIds.size === 0) {
    return { requestor: [], accounting: [], finance: [] };
  }

  // Load all RFPs with approval meta; apply company/personnel scope in memory so
  // role assignees are credited even when they are not the board assignee.
  const tickets = await prisma.ticket.findMany({
    where: {
      requestType: "REQUEST_FOR_PAYMENT",
      paymentApprovalMeta: { not: Prisma.DbNull },
    },
    select: {
      id: true,
      closedAt: true,
      paymentApprovalMeta: true,
    },
  });

  const accountingCounts: RoleCounts = new Map();
  const financeCounts: RoleCounts = new Map();

  for (const row of tickets) {
    const meta = parsePaymentApprovalMeta(row.paymentApprovalMeta) as PaymentApprovalMeta | null;
    if (!meta) continue;

    const confirmedIso = row.closedAt?.toISOString();
    const confirmedInRange = timestampInWorkingDays(confirmedIso, workingDayIntervals);

    // Closed credit only after requestor confirmation (closedAt), still attributed to the role.
    if (confirmedInRange && meta.completed.APPROVED_BY_ACCOUNTING) {
      const creditId = meta.accountingAgentId?.trim() || null;
      if (agentInScope(creditId, scopedAgentIds)) bump(accountingCounts, creditId, "closed");
    }

    if (confirmedInRange && meta.completed.APPROVED_BY_FINANCE) {
      const creditId = meta.financeAgentId?.trim() || null;
      if (agentInScope(creditId, scopedAgentIds)) bump(financeCounts, creditId, "closed");
    }

    if (meta.proceduralStep === "APPROVED_BY_ACCOUNTING") {
      const pendingId = meta.accountingAgentId?.trim() || null;
      if (agentInScope(pendingId, scopedAgentIds)) bump(accountingCounts, pendingId, "pending");
    }

    if (meta.proceduralStep === "APPROVED_BY_FINANCE") {
      const pendingId = meta.financeAgentId?.trim() || null;
      if (agentInScope(pendingId, scopedAgentIds)) bump(financeCounts, pendingId, "pending");
    }
  }

  const [accounting, finance] = await Promise.all([
    metricsFromCounts(accountingCounts),
    metricsFromCounts(financeCounts),
  ]);
  return { requestor: [], accounting, finance };
}
