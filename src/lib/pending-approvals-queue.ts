import { Prisma } from "@prisma/client/primary";
import { ACTIVE_REQUEST_STATUSES } from "@/lib/active-request-statuses";
import {
  acaProceduralStatusLabel,
  isAcaBoardVisibleToAgent,
  parseAcaApprovalMeta,
} from "@/lib/aca-approval";
import {
  currentFundTransferStepBoardAssigneeId,
  fundTransferProceduralStatusLabel,
  parseFundTransferApprovalMeta,
} from "@/lib/fund-transfer-approval";
import {
  currentItemRequisitionStepBoardAssigneeId,
  itemRequisitionProceduralStatusLabel,
  parseItemRequisitionApprovalMeta,
} from "@/lib/item-requisition-approval";
import {
  currentJobOrderStepBoardAssigneeId,
  jobOrderProceduralStatusLabel,
  parseJobOrderApprovalMeta,
} from "@/lib/job-order-approval";
import {
  currentPaymentStepBoardAssigneeId,
  parsePaymentApprovalMeta,
  paymentProceduralStatusLabel,
} from "@/lib/request-for-payment-approval";
import { requestTypeAcronym, requestTypeLabel } from "@/lib/request-types";
import {
  getOperatorActionableApprovalLevel,
  hasHierarchicalApprovals,
  travelOrderApprovedByLabel,
} from "@/lib/travel-order";
import {
  listPendingTravelApprovalsForAgent,
} from "@/lib/travel-order-db";
import { prisma } from "@/lib/prisma";

export type PendingApprovalQueueRow = {
  id: string;
  kind: "ticket" | "travel_order";
  ticketId?: string;
  reference: string;
  title: string;
  subtitle?: string;
  requestTypeLabel: string;
  awaitingStep: string;
  status: string;
  companyName: string | null;
  updatedAt: Date;
  href: string;
};

/**
 * Ticket ids where `agentId` is the current procedural approval step holder
 * (includes tickets already assigned to them on the board).
 */
export async function loadPendingApprovalTicketIdsForAgent(
  agentId: string,
): Promise<string[]> {
  if (!agentId) return [];

  const [rfpRows, irsRows, ftrRows, joRows, acaRows] = await Promise.all([
    prisma.ticket.findMany({
      where: {
        requestType: "REQUEST_FOR_PAYMENT",
        paymentApprovalMeta: { not: Prisma.DbNull },
        status: { in: ACTIVE_REQUEST_STATUSES },
      },
      select: { id: true, paymentApprovalMeta: true },
    }),
    prisma.ticket.findMany({
      where: {
        requestType: "ITEM_REQUISITION_SLIP",
        itemRequisitionApprovalMeta: { not: Prisma.DbNull },
        status: { in: ACTIVE_REQUEST_STATUSES },
      },
      select: { id: true, itemRequisitionApprovalMeta: true },
    }),
    prisma.ticket.findMany({
      where: {
        requestType: "FUND_TRANSFER_REQUEST",
        fundTransferApprovalMeta: { not: Prisma.DbNull },
        status: { in: ACTIVE_REQUEST_STATUSES },
      },
      select: { id: true, fundTransferApprovalMeta: true },
    }),
    prisma.$queryRaw<Array<{ id: string; job_order_approval_meta: unknown }>>`
      SELECT id, job_order_approval_meta
      FROM tickets
      WHERE request_type = 'JOB_ORDER'
        AND job_order_approval_meta IS NOT NULL
        AND status::text IN (${Prisma.join([...ACTIVE_REQUEST_STATUSES])})
    `,
    prisma.$queryRaw<Array<{ id: string; aca_approval_meta: unknown }>>`
      SELECT id, aca_approval_meta
      FROM tickets
      WHERE request_type = 'AUTHORITY_TO_CONDUCT_ACTIVITY'
        AND aca_approval_meta IS NOT NULL
        AND status::text IN (${Prisma.join([...ACTIVE_REQUEST_STATUSES])})
    `,
  ]);

  const ids: string[] = [];

  for (const row of rfpRows) {
    const meta = parsePaymentApprovalMeta(row.paymentApprovalMeta);
    if (meta && currentPaymentStepBoardAssigneeId(meta) === agentId) ids.push(row.id);
  }
  for (const row of irsRows) {
    const meta = parseItemRequisitionApprovalMeta(row.itemRequisitionApprovalMeta);
    if (meta && currentItemRequisitionStepBoardAssigneeId(meta) === agentId) ids.push(row.id);
  }
  for (const row of ftrRows) {
    const meta = parseFundTransferApprovalMeta(row.fundTransferApprovalMeta);
    if (meta && currentFundTransferStepBoardAssigneeId(meta) === agentId) ids.push(row.id);
  }
  for (const row of joRows) {
    const meta = parseJobOrderApprovalMeta(row.job_order_approval_meta);
    if (meta && currentJobOrderStepBoardAssigneeId(meta) === agentId) ids.push(row.id);
  }
  for (const row of acaRows) {
    const meta = parseAcaApprovalMeta(row.aca_approval_meta);
    if (meta && isAcaBoardVisibleToAgent(meta, agentId)) ids.push(row.id);
  }

  return [...new Set(ids)];
}

function awaitingStepForTicket(opts: {
  requestType: string | null;
  paymentApprovalMeta: unknown;
  itemRequisitionApprovalMeta: unknown;
  fundTransferApprovalMeta: unknown;
  jobOrderApprovalMeta: unknown;
  acaApprovalMeta: unknown;
}): string {
  switch (opts.requestType) {
    case "REQUEST_FOR_PAYMENT": {
      const meta = parsePaymentApprovalMeta(opts.paymentApprovalMeta);
      return paymentProceduralStatusLabel(meta?.proceduralStep) ?? "Awaiting approval";
    }
    case "ITEM_REQUISITION_SLIP": {
      const meta = parseItemRequisitionApprovalMeta(opts.itemRequisitionApprovalMeta);
      return itemRequisitionProceduralStatusLabel(meta?.proceduralStep) ?? "Awaiting approval";
    }
    case "FUND_TRANSFER_REQUEST": {
      const meta = parseFundTransferApprovalMeta(opts.fundTransferApprovalMeta);
      return fundTransferProceduralStatusLabel(meta?.proceduralStep) ?? "Awaiting approval";
    }
    case "JOB_ORDER": {
      const meta = parseJobOrderApprovalMeta(opts.jobOrderApprovalMeta);
      return jobOrderProceduralStatusLabel(meta?.proceduralStep) ?? "Awaiting approval";
    }
    case "AUTHORITY_TO_CONDUCT_ACTIVITY": {
      const meta = parseAcaApprovalMeta(opts.acaApprovalMeta);
      return acaProceduralStatusLabel(meta) ?? "Awaiting approval";
    }
    default:
      return "Awaiting approval";
  }
}

/** Unified Needs My Approval queue: procedural request seats + travel-order layers. */
export async function loadPendingApprovalsQueueForAgent(
  agentId: string,
): Promise<PendingApprovalQueueRow[]> {
  if (!agentId) return [];

  const ticketIds = await loadPendingApprovalTicketIdsForAgent(agentId);
  const [tickets, travelOrders] = await Promise.all([
    ticketIds.length > 0
      ? prisma.ticket.findMany({
          where: { id: { in: ticketIds } },
          include: { team: { select: { name: true } } },
          orderBy: { updatedAt: "desc" },
        })
      : Promise.resolve([]),
    listPendingTravelApprovalsForAgent(agentId),
  ]);

  const ticketRows: PendingApprovalQueueRow[] = tickets.map((t) => {
    const typeId = t.requestType ?? null;
    return {
      id: `ticket-${t.id}`,
      kind: "ticket",
      ticketId: t.id,
      reference: t.ticketNumber,
      title: t.title,
      subtitle: t.contactName || t.contactEmail || undefined,
      requestTypeLabel: typeId
        ? `${requestTypeAcronym(typeId)} · ${requestTypeLabel(typeId)}`
        : "Request",
      awaitingStep: awaitingStepForTicket({
        requestType: t.requestType,
        paymentApprovalMeta: t.paymentApprovalMeta,
        itemRequisitionApprovalMeta: t.itemRequisitionApprovalMeta,
        fundTransferApprovalMeta: t.fundTransferApprovalMeta,
        jobOrderApprovalMeta: t.jobOrderApprovalMeta,
        acaApprovalMeta: t.acaApprovalMeta,
      }),
      status: t.status.replaceAll("_", " "),
      companyName: t.team?.name ?? null,
      updatedAt: t.updatedAt,
      href: `/agent/tickets/${t.id}`,
    };
  });

  const travelRows: PendingApprovalQueueRow[] = travelOrders.map((order) => {
    const levels = order.approvalLevels ?? [];
    const pending = hasHierarchicalApprovals(levels)
      ? getOperatorActionableApprovalLevel(levels, agentId)
      : null;
    const label =
      order.kpiMainTask || order.kpiTitle || "Travel Order";
    return {
      id: `travel-${order.id}`,
      kind: "travel_order",
      reference: "Travel Order",
      title: label,
      subtitle: order.orderRequest?.trim() || undefined,
      requestTypeLabel: "Travel Order",
      awaitingStep: pending
        ? travelOrderApprovedByLabel(
            pending.optional === true,
            pending.level,
            levels.length,
            pending,
          )
        : "Awaiting approval",
      status: "Pending approval",
      companyName: null,
      updatedAt: order.updatedAt,
      href: `/agent/tasks?task=${encodeURIComponent(order.kpiMaintenanceId)}`,
    };
  });

  return [...ticketRows, ...travelRows].sort(
    (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
  );
}
