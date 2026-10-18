import { Prisma } from "@prisma/client/primary";
import { ACTIVE_REQUEST_STATUSES } from "@/modules/requests/active-request-statuses";
import { prisma } from "@/modules/platform/db/prisma";
import {
  currentFundTransferStepBoardAssigneeId,
  parseFundTransferApprovalMeta,
} from "@/modules/requests/fund-transfer-approval";
import {
  currentJobOrderStepBoardAssigneeId,
  parseJobOrderApprovalMeta,
} from "@/modules/requests/job-order-approval";
import {
  currentItemRequisitionStepBoardAssigneeId,
  parseItemRequisitionApprovalMeta,
} from "@/modules/requests/item-requisition-approval";
import {
  currentPaymentStepBoardAssigneeId,
  parsePaymentApprovalMeta,
} from "@/modules/requests/request-for-payment-approval";
import { parseTransferRequestDetail } from "@/modules/requests/ticket-transfer-request";

/**
 * Ticket ids with a pending peer transfer addressed to `agentId`
 * (so the recipient sees them even if assignment has not moved yet).
 */
export async function loadTicketIdsPendingTransferToAgent(
  agentId: string,
): Promise<string[]> {
  if (!agentId) return [];
  const rows = await prisma.ticketActivity.findMany({
    where: {
      summary: { in: ["Transfer requested", "Transfer approved", "Transfer rejected"] },
      ticket: {
        status: { in: ACTIVE_REQUEST_STATUSES },
      },
    },
    orderBy: { createdAt: "asc" },
    select: {
      ticketId: true,
      summary: true,
      detail: true,
    },
  });

  const pendingRecipientByTicket = new Map<string, string | null>();
  for (const row of rows) {
    if (row.summary === "Transfer requested") {
      const parsed = parseTransferRequestDetail(row.detail);
      pendingRecipientByTicket.set(row.ticketId, parsed?.recipientAgentId ?? null);
    } else if (row.summary === "Transfer approved" || row.summary === "Transfer rejected") {
      pendingRecipientByTicket.set(row.ticketId, null);
    }
  }

  const ids: string[] = [];
  for (const [ticketId, recipientId] of pendingRecipientByTicket) {
    if (recipientId === agentId) ids.push(ticketId);
  }
  return ids;
}

/**
 * RFP ticket ids whose current procedural role assignee is `agentId`
 * (even when `tickets.assignedAgentId` has not been synced yet).
 */
export async function loadRfpTicketIdsForCurrentStepAssignee(
  agentId: string,
): Promise<string[]> {
  if (!agentId) return [];
  const rows = await prisma.ticket.findMany({
    where: {
      requestType: "REQUEST_FOR_PAYMENT",
      paymentApprovalMeta: { not: Prisma.DbNull },
      status: { in: ACTIVE_REQUEST_STATUSES },
    },
    select: {
      id: true,
      assignedAgentId: true,
      paymentApprovalMeta: true,
    },
  });

  const ids: string[] = [];
  for (const row of rows) {
    if (row.assignedAgentId === agentId) continue; // already covered by assignedAgentId filter
    const meta = parsePaymentApprovalMeta(row.paymentApprovalMeta);
    if (!meta) continue;
    if (currentPaymentStepBoardAssigneeId(meta) === agentId) {
      ids.push(row.id);
    }
  }
  return ids;
}

export async function loadIrsTicketIdsForCurrentStepAssignee(
  agentId: string,
): Promise<string[]> {
  if (!agentId) return [];
  const rows = await prisma.ticket.findMany({
    where: {
      requestType: "ITEM_REQUISITION_SLIP",
      itemRequisitionApprovalMeta: { not: Prisma.DbNull },
      status: { in: ACTIVE_REQUEST_STATUSES },
    },
    select: {
      id: true,
      assignedAgentId: true,
      itemRequisitionApprovalMeta: true,
    },
  });

  const ids: string[] = [];
  for (const row of rows) {
    if (row.assignedAgentId === agentId) continue;
    const meta = parseItemRequisitionApprovalMeta(row.itemRequisitionApprovalMeta);
    if (!meta) continue;
    if (currentItemRequisitionStepBoardAssigneeId(meta) === agentId) {
      ids.push(row.id);
    }
  }
  return ids;
}

export async function loadFtrTicketIdsForCurrentStepAssignee(
  agentId: string,
): Promise<string[]> {
  if (!agentId) return [];
  const rows = await prisma.ticket.findMany({
    where: {
      requestType: "FUND_TRANSFER_REQUEST",
      fundTransferApprovalMeta: { not: Prisma.DbNull },
      status: { in: ACTIVE_REQUEST_STATUSES },
    },
    select: {
      id: true,
      assignedAgentId: true,
      fundTransferApprovalMeta: true,
    },
  });

  const ids: string[] = [];
  for (const row of rows) {
    if (row.assignedAgentId === agentId) continue;
    const meta = parseFundTransferApprovalMeta(row.fundTransferApprovalMeta);
    if (!meta) continue;
    if (currentFundTransferStepBoardAssigneeId(meta) === agentId) {
      ids.push(row.id);
    }
  }
  return ids;
}

/**
 * Job Order ticket ids whose current procedural-step assignee is `agentId`.
 */
export async function loadJobOrderTicketIdsForCurrentStepAssignee(
  agentId: string,
): Promise<string[]> {
  if (!agentId) return [];
  const rows = await prisma.$queryRaw<
    Array<{ id: string; assigned_agent_id: string | null; job_order_approval_meta: unknown }>
  >`
    SELECT id, assigned_agent_id, job_order_approval_meta
    FROM tickets
    WHERE request_type = 'JOB_ORDER'
      AND job_order_approval_meta IS NOT NULL
      AND status::text IN (${Prisma.join([...ACTIVE_REQUEST_STATUSES])})
  `;

  const ids: string[] = [];
  for (const row of rows) {
    if (row.assigned_agent_id === agentId) continue;
    const meta = parseJobOrderApprovalMeta(row.job_order_approval_meta);
    if (!meta) continue;
    if (currentJobOrderStepBoardAssigneeId(meta) === agentId) {
      ids.push(row.id);
    }
  }
  return ids;
}

/**
 * Prisma where fragment: Personnel Request Board shows own assignments + pending
 * transfers to them + Job Order Seek Assistance / execution-team membership.
 * Procedural approval seats live on Needs My Approval instead.
 */
export async function personnelRequestBoardWhere(
  agentId: string | null | undefined,
): Promise<Prisma.TicketWhereInput> {
  if (!agentId) {
    return { assignedAgentId: "__none__" };
  }
  const [transferIds, jobOrderTeamIds] = await Promise.all([
    loadTicketIdsPendingTransferToAgent(agentId),
    import("@/modules/requests/job-order-workers-server").then((m) =>
      m.loadJobOrderTicketIdsVisibleToAgent(agentId),
    ),
  ]);
  const extraIds = [...new Set([...transferIds, ...jobOrderTeamIds])];
  if (extraIds.length === 0) {
    return { assignedAgentId: agentId };
  }
  return {
    OR: [{ assignedAgentId: agentId }, { id: { in: extraIds } }],
  };
}
