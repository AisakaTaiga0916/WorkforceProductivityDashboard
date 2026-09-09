import { customerCanAccessTicket } from "@/lib/access";
import { portalCompanyAdminPrivilegesForEmail } from "@/lib/portal-staff";
import {
  currentFundTransferStepBoardAssigneeId,
  parseFundTransferApprovalMeta,
} from "@/lib/fund-transfer-approval";
import {
  currentJobOrderStepBoardAssigneeId,
  isJobOrderAssistanceMember,
  parseJobOrderApprovalMeta,
} from "@/lib/job-order-approval";
import {
  currentItemRequisitionStepBoardAssigneeId,
  parseItemRequisitionApprovalMeta,
} from "@/lib/item-requisition-approval";
import { prisma } from "@/lib/prisma";
import {
  currentPaymentStepBoardAssigneeId,
  parsePaymentApprovalMeta,
} from "@/lib/request-for-payment-approval";
import {
  currentAcaBoardAssigneeId,
  isAcaBoardVisibleToAgent,
  parseAcaApprovalMeta,
} from "@/lib/aca-approval";
import { resolveStaffCompanyTeamId } from "@/lib/staff-company-scope";
import {
  roleUsesOrgChartSectionBoardScope,
  ticketInViewerSectionScope,
} from "@/lib/org-chart-section-scope";
import { parseTransferRequestDetail } from "@/lib/ticket-transfer-request";

type TicketAccessShape = {
  id?: string;
  teamId: string | null;
  assignedAgentId: string | null;
  orgChartSectionId?: string | null;
  assignedAgent?: { email?: string | null; teamId?: string | null } | null;
  paymentApprovalMeta?: unknown;
  itemRequisitionApprovalMeta?: unknown;
  fundTransferApprovalMeta?: unknown;
  jobOrderApprovalMeta?: unknown;
  acaApprovalMeta?: unknown;
  contactEmail?: string | null;
  requestorEmail?: string | null;
};

async function resolveTicketSendToSectionId(
  ticket: TicketAccessShape | null | undefined,
): Promise<string | null> {
  if (!ticket) return null;
  const fromShape = (ticket.orgChartSectionId ?? "").trim();
  if (fromShape) return fromShape;
  const ticketId = (ticket.id ?? "").trim();
  if (!ticketId) return null;
  const rows = await prisma.$queryRaw<Array<{ org_chart_section_id: string | null }>>`
    SELECT org_chart_section_id FROM tickets WHERE id = ${ticketId} LIMIT 1
  `;
  return (rows[0]?.org_chart_section_id ?? "").trim() || null;
}

/** True when the session identity matches the ticket's board assignee. */
export function isTicketAssignee(args: {
  operatorId?: string | null;
  sessionEmail?: string | null;
  ticket: TicketAccessShape;
}): boolean {
  const { operatorId, sessionEmail, ticket } = args;
  if (operatorId && ticket.assignedAgentId === operatorId) return true;
  const agentEmail = ticket.assignedAgent?.email?.trim().toLowerCase() ?? "";
  const email = sessionEmail?.trim().toLowerCase() ?? "";
  return !!agentEmail && !!email && agentEmail === email;
}

/**
 * Async assignee check that also treats duplicate Agent rows sharing the
 * session email as the same person (HRIS remaps / legacy duplicates).
 */
export async function isSessionAssigneeOfTicket(args: {
  operatorId?: string | null;
  sessionEmail?: string | null;
  ticket: TicketAccessShape;
}): Promise<boolean> {
  if (isTicketAssignee(args)) return true;
  const email = (args.sessionEmail ?? "").trim();
  const assignedId = args.ticket.assignedAgentId;
  if (!email || !assignedId) return false;

  const [assigned, sessionAgents] = await Promise.all([
    prisma.agent.findUnique({
      where: { id: assignedId },
      select: { id: true, email: true },
    }),
    prisma.agent.findMany({
      where: { email: { equals: email, mode: "insensitive" } },
      select: { id: true },
    }),
  ]);
  if (!assigned) return false;
  if (sessionAgents.some((a) => a.id === assignedId)) return true;
  const assignedEmail = assigned.email?.trim().toLowerCase() ?? "";
  return !!assignedEmail && assignedEmail === email.toLowerCase();
}

/** True when the signed-in user filed the ticket (My Requests / customer ownership). */
export function isTicketRequestor(
  ticket: Pick<TicketAccessShape, "contactEmail" | "requestorEmail">,
  sessionEmail?: string | null,
): boolean {
  if (!ticket.contactEmail && !ticket.requestorEmail) return false;
  return customerCanAccessTicket(
    {
      contactEmail: ticket.contactEmail ?? "",
      requestorEmail: ticket.requestorEmail,
    },
    sessionEmail,
  );
}

/** True when the actor is the current RFP / IRS / FTR procedural-step assignee. */
export function isCurrentProceduralStepAssignee(
  ticket: TicketAccessShape,
  operatorId: string | null | undefined,
): boolean {
  if (!operatorId) return false;

  const paymentMeta = parsePaymentApprovalMeta(ticket.paymentApprovalMeta);
  if (paymentMeta && currentPaymentStepBoardAssigneeId(paymentMeta) === operatorId) {
    return true;
  }

  const irsMeta = parseItemRequisitionApprovalMeta(ticket.itemRequisitionApprovalMeta);
  if (irsMeta && currentItemRequisitionStepBoardAssigneeId(irsMeta) === operatorId) {
    return true;
  }

  const ftrMeta = parseFundTransferApprovalMeta(ticket.fundTransferApprovalMeta);
  if (ftrMeta && currentFundTransferStepBoardAssigneeId(ftrMeta) === operatorId) {
    return true;
  }

  const joMeta = parseJobOrderApprovalMeta(ticket.jobOrderApprovalMeta);
  if (joMeta && currentJobOrderStepBoardAssigneeId(joMeta) === operatorId) {
    return true;
  }

  return false;
}

/** @deprecated Use {@link isCurrentProceduralStepAssignee}. */
export function isCurrentPaymentStepAssignee(
  ticket: TicketAccessShape,
  operatorId: string | null | undefined,
): boolean {
  return isCurrentProceduralStepAssignee(ticket, operatorId);
}

/** True when the actor is the current ACA procedural-step assignee. */
export function isCurrentAcaStepAssignee(
  ticket: TicketAccessShape,
  operatorId: string | null | undefined,
): boolean {
  if (!operatorId) return false;
  const meta = parseAcaApprovalMeta(ticket.acaApprovalMeta);
  if (!meta) return false;
  return currentAcaBoardAssigneeId(meta) === operatorId;
}

/**
 * True when the actor should see/open this ACA on their board:
 * current procedural assignee, or listed AP 4 / 4 ExeComs / All ExeCom seat.
 */
export function isAcaBoardVisibleAssignee(
  ticket: TicketAccessShape,
  operatorId: string | null | undefined,
): boolean {
  if (!operatorId) return false;
  return isAcaBoardVisibleToAgent(parseAcaApprovalMeta(ticket.acaApprovalMeta), operatorId);
}

/** True when the actor is on Job Order Seek Assistance or execution team for this ticket. */
export function isJobOrderTeamMemberAssignee(
  ticket: TicketAccessShape,
  operatorId: string | null | undefined,
): boolean {
  if (!operatorId) return false;
  const meta = parseJobOrderApprovalMeta(ticket.jobOrderApprovalMeta);
  if (!meta) return false;
  if (isJobOrderAssistanceMember(operatorId, meta)) return true;
  if (meta.pendingExecutionAssigneeAgentId === operatorId) return true;
  return Boolean(meta.workerAgentIds?.includes(operatorId));
}

/**
 * Async: same as {@link isJobOrderTeamMemberAssignee}, also matching duplicate Agent
 * rows that share the session email.
 */
export async function isSessionJobOrderTeamMember(args: {
  operatorId?: string | null;
  sessionEmail?: string | null;
  ticket: TicketAccessShape;
}): Promise<boolean> {
  if (isJobOrderTeamMemberAssignee(args.ticket, args.operatorId)) return true;
  const email = (args.sessionEmail ?? "").trim();
  if (!email) return false;
  let meta = parseJobOrderApprovalMeta(args.ticket.jobOrderApprovalMeta);
  if (!meta && args.ticket.id) {
    const rows = await prisma.$queryRaw<Array<{ job_order_approval_meta: unknown }>>`
      SELECT job_order_approval_meta FROM tickets WHERE id = ${args.ticket.id} LIMIT 1
    `;
    meta = parseJobOrderApprovalMeta(rows[0]?.job_order_approval_meta);
  }
  if (!meta) return false;
  const sessionAgents = await prisma.agent.findMany({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true },
  });
  return sessionAgents.some(
    (a) =>
      isJobOrderAssistanceMember(a.id, meta) ||
      meta.pendingExecutionAssigneeAgentId === a.id ||
      Boolean(meta.workerAgentIds?.includes(a.id)),
  );
}

/**
 * Admin (JWT Admin) may only touch tickets in their designated department
 * (org-chart send-to section tree). Legacy tickets without a section fall back
 * to designated-company matching. SuperAdmin is never blocked here.
 * Requestors, board assignees, and current procedural-step assignees may always access.
 */
export async function adminOutsideCompanyScope(args: {
  role: string | undefined;
  email?: string | null;
  ticketTeamId: string | null;
  ticket?: TicketAccessShape | null;
  operatorId?: string | null;
}): Promise<boolean> {
  if (args.role !== "Admin") return false;
  if (args.ticket && isTicketRequestor(args.ticket, args.email)) return false;
  if (
    args.ticket &&
    isTicketAssignee({
      operatorId: args.operatorId,
      sessionEmail: args.email,
      ticket: args.ticket,
    })
  ) {
    return false;
  }
  if (args.ticket && isCurrentProceduralStepAssignee(args.ticket, args.operatorId)) {
    return false;
  }
  if (
    args.ticket &&
    (await isSessionJobOrderTeamMember({
      operatorId: args.operatorId,
      sessionEmail: args.email,
      ticket: args.ticket,
    }))
  ) {
    return false;
  }
  const sendToSectionId = await resolveTicketSendToSectionId(args.ticket);
  if (
    await ticketInViewerSectionScope({
      email: args.email,
      orgChartSectionId: sendToSectionId,
    })
  ) {
    return false;
  }
  // Legacy / missing section: fall back to designated company.
  if (sendToSectionId) {
    // Has a department but viewer is not in that tree → blocked.
    return true;
  }
  const scoped = await resolveStaffCompanyTeamId(args.email);
  if (!scoped) return true;
  return args.ticketTeamId !== scoped;
}

/** True when `operatorId` is the named recipient of a still-pending peer transfer. */
export async function isPendingTransferRecipient(
  ticketId: string | null | undefined,
  operatorId: string | null | undefined,
): Promise<boolean> {
  if (!ticketId || !operatorId) return false;
  const transferAudit = await prisma.ticketActivity.findMany({
    where: {
      ticketId,
      summary: { in: ["Transfer requested", "Transfer approved", "Transfer rejected"] },
    },
    orderBy: { createdAt: "asc" },
    select: { summary: true, detail: true },
  });
  let pendingRecipientId: string | null = null;
  for (const row of transferAudit) {
    if (row.summary === "Transfer requested") {
      pendingRecipientId = parseTransferRequestDetail(row.detail)?.recipientAgentId ?? null;
    } else if (row.summary === "Transfer approved" || row.summary === "Transfer rejected") {
      pendingRecipientId = null;
    }
  }
  return pendingRecipientId === operatorId;
}

/**
 * Personnel may read/mutate when they are the requestor, board assignee,
 * current procedural-step assignee, listed ACA ExeCom seat, pending transfer
 * recipient, Job Order Seek Assistance / execution team member,
 * ticket send-to department is in their org-chart section tree,
 * or company coordinator for the ticket's company.
 */
export async function personnelForbiddenForTicket(args: {
  email?: string | null;
  operatorId?: string | null;
  ticket: TicketAccessShape;
}): Promise<boolean> {
  const { email, operatorId, ticket } = args;
  if (isTicketAssignee({ operatorId, sessionEmail: email, ticket })) return false;
  if (isTicketRequestor(ticket, email)) return false;
  if (isCurrentProceduralStepAssignee(ticket, operatorId)) return false;
  if (isAcaBoardVisibleAssignee(ticket, operatorId)) return false;
  if (await isPendingTransferRecipient(ticket.id, operatorId)) return false;
  if (
    await isSessionJobOrderTeamMember({
      operatorId,
      sessionEmail: email,
      ticket,
    })
  ) {
    return false;
  }

  const sendToSectionId = await resolveTicketSendToSectionId(ticket);
  if (
    roleUsesOrgChartSectionBoardScope("Personnel") &&
    (await ticketInViewerSectionScope({
      email,
      orgChartSectionId: sendToSectionId,
    }))
  ) {
    return false;
  }

  const companyCoordinator = await portalCompanyAdminPrivilegesForEmail(email);
  if (!companyCoordinator) return true;
  const coordinatorTeamId = await resolveStaffCompanyTeamId(email);
  if (!coordinatorTeamId) return true;
  return !(
    ticket.teamId === coordinatorTeamId ||
    ticket.assignedAgent?.teamId === coordinatorTeamId
  );
}
