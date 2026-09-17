import type { TicketStatus } from "@prisma/client/primary";
import { customerCanAccessTicket } from "@/lib/access";
import { isElevatedUserRole } from "@/lib/auth";
import { parseFundTransferApprovalMeta } from "@/lib/fund-transfer-approval";
import { parseItemRequisitionApprovalMeta } from "@/lib/item-requisition-approval";
import { parseJobOrderApprovalMeta } from "@/lib/job-order-approval";
import { prisma } from "@/lib/prisma";
import { parseRequestTypeId, type RequestTypeId } from "@/lib/request-types";
import type { ChatParticipant } from "@/lib/request-chat-types";
import { parsePaymentApprovalMeta } from "@/lib/request-for-payment-approval";
import { findSessionAgentWithTeam } from "@/lib/session-agent";
import { isTicketRequestor } from "@/lib/ticket-staff-access";

export type ChatTicketAccessRow = {
  id: string;
  status: TicketStatus;
  requestType: string;
  teamId: string | null;
  assignedAgentId: string | null;
  orgChartSectionId: string | null;
  contactName: string;
  contactEmail: string;
  requestorEmail: string | null;
  assignedAgent: { id: string; email: string | null; name: string; teamId: string | null } | null;
  paymentApprovalMeta: unknown;
  itemRequisitionApprovalMeta: unknown;
  fundTransferApprovalMeta: unknown;
  jobOrderApprovalMeta: unknown;
  acaApprovalMeta: unknown;
};

export function isRequestChatClosed(ticket: { status: string }): boolean {
  return ticket.status === "CLOSED";
}

export async function loadTicketForChatAccess(
  ticketId: string,
): Promise<ChatTicketAccessRow | null> {
  return prisma.ticket.findUnique({
    where: { id: ticketId },
    select: {
      id: true,
      status: true,
      requestType: true,
      teamId: true,
      assignedAgentId: true,
      orgChartSectionId: true,
      contactName: true,
      contactEmail: true,
      requestorEmail: true,
      assignedAgent: { select: { id: true, email: true, name: true, teamId: true } },
      paymentApprovalMeta: true,
      itemRequisitionApprovalMeta: true,
      fundTransferApprovalMeta: true,
      jobOrderApprovalMeta: true,
      acaApprovalMeta: true,
    },
  });
}

function addAgentId(set: Set<string>, id: string | null | undefined) {
  const trimmed = (id ?? "").trim();
  if (trimmed) set.add(trimmed);
}

/**
 * Agent ids allowed in request chat for this ticket type (excluding the requestor,
 * who is always matched by email).
 *
 * - ISSUE/CONCERN: board assignee
 * - RFP: Noted By, Approved By, Bookkeeper, Accounting
 * - J.O.: Noted By / Approved By seats
 * - FTR: Recommending + Approved By
 * - R.S.: Canvasser + Approved By
 */
export function collectRequestChatParticipantAgentIds(
  ticket: ChatTicketAccessRow,
): Set<string> {
  const type = parseRequestTypeId(ticket.requestType) as RequestTypeId;
  const ids = new Set<string>();

  switch (type) {
    case "ISSUE_CONCERN_TICKET": {
      addAgentId(ids, ticket.assignedAgentId);
      break;
    }
    case "REQUEST_FOR_PAYMENT": {
      const meta = parsePaymentApprovalMeta(ticket.paymentApprovalMeta);
      if (meta) {
        // Approvers
        addAgentId(ids, meta.notedByAgentId);
        addAgentId(ids, meta.approvedByAgentId);
        // Bookkeeper (Prepared by Bookkeeper)
        addAgentId(ids, meta.accountingAgentId);
        // Accounting (Approved By Accounting / finance seat)
        addAgentId(ids, meta.financeAgentId);
      }
      break;
    }
    case "JOB_ORDER": {
      const meta = parseJobOrderApprovalMeta(ticket.jobOrderApprovalMeta);
      if (meta) {
        addAgentId(ids, meta.notedByAgentId);
        addAgentId(ids, meta.approvedByAgentId);
        addAgentId(ids, meta.approvedBy2AgentId);
      }
      break;
    }
    case "FUND_TRANSFER_REQUEST": {
      const meta = parseFundTransferApprovalMeta(ticket.fundTransferApprovalMeta);
      if (meta) {
        addAgentId(ids, meta.recommendingApprovalAgentId);
        addAgentId(ids, meta.approvedByAgentId);
      }
      break;
    }
    case "ITEM_REQUISITION_SLIP": {
      const meta = parseItemRequisitionApprovalMeta(ticket.itemRequisitionApprovalMeta);
      if (meta) {
        addAgentId(ids, meta.canvassedByAgentId);
        addAgentId(ids, meta.approvedByAgentId);
      }
      break;
    }
    default: {
      // Unlisted types (e.g. ACA): requestor + board assignee only.
      addAgentId(ids, ticket.assignedAgentId);
      break;
    }
  }

  return ids;
}

/** Ordered staff seats for chat header (agent id + display role). */
export function collectRequestChatParticipantSeats(
  ticket: ChatTicketAccessRow,
): { agentId: string; role: string }[] {
  const type = parseRequestTypeId(ticket.requestType) as RequestTypeId;
  const seats: { agentId: string; role: string }[] = [];
  const seen = new Set<string>();
  const push = (agentId: string | null | undefined, role: string) => {
    const id = (agentId ?? "").trim();
    if (!id || seen.has(id)) return;
    seen.add(id);
    seats.push({ agentId: id, role });
  };

  switch (type) {
    case "ISSUE_CONCERN_TICKET": {
      push(ticket.assignedAgentId, "Assignee");
      break;
    }
    case "REQUEST_FOR_PAYMENT": {
      const meta = parsePaymentApprovalMeta(ticket.paymentApprovalMeta);
      if (meta) {
        push(meta.notedByAgentId, "Approver");
        push(meta.approvedByAgentId, "Approver");
        push(meta.accountingAgentId, "Bookkeeper");
        push(meta.financeAgentId, "Accounting");
      }
      break;
    }
    case "JOB_ORDER": {
      const meta = parseJobOrderApprovalMeta(ticket.jobOrderApprovalMeta);
      if (meta) {
        push(meta.notedByAgentId, "Approver");
        push(meta.approvedByAgentId, "Approver");
        push(meta.approvedBy2AgentId, "Approver");
      }
      break;
    }
    case "FUND_TRANSFER_REQUEST": {
      const meta = parseFundTransferApprovalMeta(ticket.fundTransferApprovalMeta);
      if (meta) {
        push(meta.recommendingApprovalAgentId, "Approver");
        push(meta.approvedByAgentId, "Approver");
      }
      break;
    }
    case "ITEM_REQUISITION_SLIP": {
      const meta = parseItemRequisitionApprovalMeta(ticket.itemRequisitionApprovalMeta);
      if (meta) {
        push(meta.canvassedByAgentId, "Canvasser");
        push(meta.approvedByAgentId, "Approver");
      }
      break;
    }
    default: {
      push(ticket.assignedAgentId, "Assignee");
      break;
    }
  }

  return seats;
}

async function sessionAgentIdsForEmail(email?: string | null): Promise<Set<string>> {
  const normalized = (email ?? "").trim();
  if (!normalized) return new Set();
  const agents = await prisma.agent.findMany({
    where: { email: { equals: normalized, mode: "insensitive" } },
    select: { id: true },
  });
  return new Set(agents.map((a) => a.id));
}

/**
 * Request-chat participants only (per request type).
 * SuperAdmin / HighAdmin retain access for support.
 */
export async function canAccessRequestChat(args: {
  role: string | undefined;
  email?: string | null;
  name?: string | null;
  ticket: ChatTicketAccessRow;
}): Promise<boolean> {
  const { role, email, ticket } = args;
  if (!role) return false;

  // Platform support override
  if (isElevatedUserRole(role)) return true;

  // Requestor always (customer or staff who filed the request)
  if (
    customerCanAccessTicket(
      { contactEmail: ticket.contactEmail, requestorEmail: ticket.requestorEmail },
      email,
    ) ||
    isTicketRequestor(ticket, email)
  ) {
    return true;
  }

  // Customers who are not the requestor cannot join.
  if (role === "Customer") return false;

  const participantAgentIds = collectRequestChatParticipantAgentIds(ticket);
  if (participantAgentIds.size === 0) return false;

  const operator = await findSessionAgentWithTeam({ email, name: args.name });
  if (operator?.id && participantAgentIds.has(operator.id)) return true;

  const sessionAgentIds = await sessionAgentIdsForEmail(email);
  for (const id of sessionAgentIds) {
    if (participantAgentIds.has(id)) return true;
  }

  // Also allow when the ticket's assignedAgent email matches (ISSUE/CONCERN
  // assignee with duplicate Agent rows).
  const assignedEmail = ticket.assignedAgent?.email?.trim().toLowerCase() ?? "";
  const sessionEmail = (email ?? "").trim().toLowerCase();
  if (
    assignedEmail &&
    sessionEmail &&
    assignedEmail === sessionEmail &&
    ticket.assignedAgentId &&
    participantAgentIds.has(ticket.assignedAgentId)
  ) {
    return true;
  }

  return false;
}

export function requestChatRoom(ticketId: string): string {
  return `request:${ticketId}`;
}

type PortalAvatarRow = {
  id: string;
  email: string;
  name: string;
  profileImage: string | null;
  profileImageZoom: number;
  profileImagePosX: number;
  profileImagePosY: number;
};

async function loadPortalAvatarsByEmails(emails: string[]): Promise<Map<string, PortalAvatarRow>> {
  const unique = [
    ...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean)),
  ];
  if (unique.length === 0) return new Map();
  const rows = await prisma.portalAccount.findMany({
    where: {
      OR: unique.map((email) => ({ email: { equals: email, mode: "insensitive" as const } })),
    },
    select: {
      id: true,
      email: true,
      name: true,
      profileImage: true,
      profileImageZoom: true,
      profileImagePosX: true,
      profileImagePosY: true,
    },
  });
  const map = new Map<string, PortalAvatarRow>();
  for (const row of rows) {
    map.set(row.email.trim().toLowerCase(), row);
  }
  return map;
}

/**
 * Requestor + role seats for the chat header (with profile photos when available).
 */
export async function resolveRequestChatParticipants(
  ticket: ChatTicketAccessRow,
): Promise<ChatParticipant[]> {
  const seats = collectRequestChatParticipantSeats(ticket);
  const agents =
    seats.length > 0
      ? await prisma.agent.findMany({
          where: { id: { in: seats.map((s) => s.agentId) } },
          select: { id: true, name: true, email: true },
        })
      : [];
  const agentById = new Map(agents.map((a) => [a.id, a]));

  const requestorEmail = (ticket.requestorEmail || ticket.contactEmail || "").trim();
  const emails = [
    requestorEmail,
    ...agents.map((a) => a.email?.trim() || ""),
  ].filter(Boolean);
  const portalByEmail = await loadPortalAvatarsByEmails(emails);

  const out: ChatParticipant[] = [];

  const requestorPortal = requestorEmail
    ? portalByEmail.get(requestorEmail.toLowerCase())
    : undefined;
  out.push({
    key: "requestor",
    role: "Requestor",
    name:
      requestorPortal?.name?.trim() ||
      ticket.contactName?.trim() ||
      requestorEmail ||
      "Requestor",
    email: requestorEmail || null,
    portalAccountId: requestorPortal?.id ?? null,
    agentId: null,
    profileImage: requestorPortal?.profileImage ?? null,
    profileImageZoom: requestorPortal?.profileImageZoom ?? 1,
    profileImagePosX: requestorPortal?.profileImagePosX ?? 50,
    profileImagePosY: requestorPortal?.profileImagePosY ?? 50,
  });

  for (const seat of seats) {
    const agent = agentById.get(seat.agentId);
    if (!agent) continue;
    const email = agent.email?.trim() || "";
    const portal = email ? portalByEmail.get(email.toLowerCase()) : undefined;
    out.push({
      key: `agent:${agent.id}`,
      role: seat.role,
      name: agent.name?.trim() || portal?.name?.trim() || email || seat.role,
      email: email || null,
      portalAccountId: portal?.id ?? null,
      agentId: agent.id,
      profileImage: portal?.profileImage ?? null,
      profileImageZoom: portal?.profileImageZoom ?? 1,
      profileImagePosX: portal?.profileImagePosX ?? 50,
      profileImagePosY: portal?.profileImagePosY ?? 50,
    });
  }

  return out;
}

/** Load portal profile photos for chat message sender ids (portal account ids). */
export async function loadChatSenderAvatars(
  senderIds: string[],
): Promise<
  Map<
    string,
    {
      profileImage: string | null;
      profileImageZoom: number;
      profileImagePosX: number;
      profileImagePosY: number;
    }
  >
> {
  const unique = [...new Set(senderIds.map((id) => id.trim()).filter(Boolean))];
  if (unique.length === 0) return new Map();
  const rows = await prisma.portalAccount.findMany({
    where: { id: { in: unique } },
    select: {
      id: true,
      profileImage: true,
      profileImageZoom: true,
      profileImagePosX: true,
      profileImagePosY: true,
    },
  });
  return new Map(
    rows.map((r) => [
      r.id,
      {
        profileImage: r.profileImage,
        profileImageZoom: r.profileImageZoom,
        profileImagePosX: r.profileImagePosX,
        profileImagePosY: r.profileImagePosY,
      },
    ]),
  );
}
