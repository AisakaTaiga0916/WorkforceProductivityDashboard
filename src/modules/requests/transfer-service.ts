import type { Prisma } from "@prisma/client/primary";
import type { Session } from "next-auth";
import { NextResponse } from "next/server";
import { prisma } from "@/modules/platform/db/prisma";
import { loadTicketRequestType } from "@/modules/requests/ticket-request-type";
import { logActivity } from "@/modules/requests/ticket-actions";
import { isAdminPortalRole } from "@/lib/staff-role";
import { ACTIVE_COMPANY_WHERE } from "@/modules/platform/companies/company-directory";
import {
  canViewerApproveTransfer,
  parseTransferRequestDetail,
  serializeTransferRequest,
} from "@/modules/requests/ticket-transfer-request";
import { requestTypeSupportsTransfer } from "@/modules/requests/request-types";
import { didRequestBoardLaneChange } from "@/modules/requests/sla";
import {
  applyPaymentApprovalAssignees,
  assigneeFieldForStep,
  canAssignPaymentApprover,
  PAYMENT_APPROVAL_STEP_LABELS,
  type PaymentApprovalAssignees,
} from "@/modules/requests/request-for-payment-approval";
import {
  initPaymentApprovalMetaIfNeeded,
  savePaymentApprovalMeta,
} from "@/modules/requests/payment-approval-db";

/** Ticket row as loaded by the tickets PATCH route preamble. */
export type TransferServiceTicket = Prisma.TicketGetPayload<{
  include: {
    assignedAgent: { select: { id: true; name: true; email: true; teamId: true } };
  };
}>;

type TicketWithAssignee = Prisma.TicketGetPayload<{
  include: { team: true; assignedAgent: true };
}>;

export type TransferOutcome = {
  ticket: TicketWithAssignee | null;
  meta?: PaymentApprovalAssignees;
};

function transferPendingFromActivities(
  activities: Array<{ summary: string }>,
) {
  let pending = false;
  for (const a of activities) {
    if (a.summary === "Transfer requested") pending = true;
    if (a.summary === "Transfer approved" || a.summary === "Transfer rejected") pending = false;
  }
  return pending;
}

async function loadTransferPending(ticketId: string) {
  const transferAudit = await prisma.ticketActivity.findMany({
    where: {
      ticketId,
      summary: { in: ["Transfer requested", "Transfer approved", "Transfer rejected"] },
    },
    orderBy: { createdAt: "asc" },
    select: { summary: true },
  });
  return transferPendingFromActivities(transferAudit);
}

async function loadLastTransferRequestDetail(ticketId: string) {
  const transferAudit = await prisma.ticketActivity.findMany({
    where: {
      ticketId,
      summary: { in: ["Transfer requested", "Transfer approved", "Transfer rejected"] },
    },
    orderBy: { createdAt: "asc" },
    select: { summary: true, detail: true },
  });
  let lastRequestDetail: string | null = null;
  for (const row of transferAudit) {
    if (row.summary === "Transfer requested") lastRequestDetail = row.detail ?? null;
    if (row.summary === "Transfer approved" || row.summary === "Transfer rejected") lastRequestDetail = null;
  }
  return parseTransferRequestDetail(lastRequestDetail);
}

export async function handleRequestTransfer(args: {
  ticketId: string;
  ticket: TransferServiceTicket;
  body: Record<string, unknown>;
  operatorAgentId: string | null;
  operatorName: string | null;
  isAssignedOperator: boolean;
}): Promise<NextResponse | TransferOutcome> {
  const { ticketId: id, ticket, body, operatorAgentId, operatorName, isAssignedOperator } = args;
  if (!isAssignedOperator) {
    return NextResponse.json(
      { error: "Only the assigned personnel can request transfer." },
      { status: 403 },
    );
  }
  const transferRequestType = await loadTicketRequestType(id);
  if (!requestTypeSupportsTransfer(transferRequestType)) {
    return NextResponse.json(
      { error: "Transfer is not available for this request type." },
      { status: 400 },
    );
  }
  const transferPending = await loadTransferPending(id);
  if (transferPending) {
    return NextResponse.json({ error: "A transfer request is already pending." }, { status: 400 });
  }

  const recipientAgentId =
    typeof body.recipientAgentId === "string" ? body.recipientAgentId.trim() : "";
  // Legacy admin-reviewer fields (still accepted for older clients).
  const recipientPortalAccountId =
    typeof body.recipientPortalAccountId === "string" ? body.recipientPortalAccountId.trim() : "";
  const recipientSuperAdmin = Boolean(body.recipientSuperAdmin);
  const targetTeamId = typeof body.targetTeamId === "string" ? body.targetTeamId.trim() : "";

  if (recipientAgentId) {
    if (recipientAgentId === ticket.assignedAgentId) {
      return NextResponse.json({ error: "Choose a different person to transfer to." }, { status: 400 });
    }
    if (!ticket.assignedAgentId || !operatorAgentId || ticket.assignedAgentId !== operatorAgentId) {
      return NextResponse.json(
        { error: "Only the assigned personnel can request transfer." },
        { status: 403 },
      );
    }
    const recipient = await prisma.agent.findUnique({
      where: { id: recipientAgentId },
      select: { id: true, name: true, email: true, teamId: true },
    });
    if (!recipient) {
      return NextResponse.json({ error: "Transfer recipient not found." }, { status: 404 });
    }
    const reasonText =
      typeof body.reason === "string" && body.reason.trim()
        ? body.reason.trim()
        : "Unable to resolve with current assignment.";
    const fromAgent = ticket.assignedAgent;
    await logActivity(
      id,
      "AGENT",
      "Transfer requested",
      serializeTransferRequest({
        recipientAgentId: recipient.id,
        recipientAgentName: recipient.name,
        fromAgentId: ticket.assignedAgentId,
        fromAgentName: fromAgent?.name ?? operatorName ?? null,
        recipientPortalAccountId: null,
        recipientSuperAdmin: false,
        targetTeamId: null,
        targetTeamName: null,
        reason: reasonText,
      }),
    );
    // Release to Assign Requests unassigned pool (Transfer pending) for reassignment.
    const transferLaneChanged = didRequestBoardLaneChange(
      {
        status: ticket.status,
        requestBoardColumnId: ticket.requestBoardColumnId,
      },
      { status: "ESCALATED", requestBoardColumnId: null },
    );
    const updated = await prisma.ticket.update({
      where: { id },
      data: {
        assignedAgentId: null,
        status: "ESCALATED",
        requestBoardColumnId: null,
      },
      include: { team: true, assignedAgent: true },
    });
    if (transferLaneChanged) {
      const { touchTicketBoardLaneEnteredAt } = await import("@/modules/requests/request-board-columns");
      await touchTicketBoardLaneEnteredAt(id);
    }
    await logActivity(
      id,
      "SYSTEM",
      "Transfer pending in unassigned pool",
      `Request released to Assign Requests (unassigned). Preferred recipient: ${recipient.name}.`,
    );
    return { ticket: updated };
  }

  if ((!recipientPortalAccountId && !recipientSuperAdmin) || (recipientPortalAccountId && recipientSuperAdmin)) {
    return NextResponse.json(
      { error: "Choose a colleague to transfer this request to." },
      { status: 400 },
    );
  }
  const targetTeam = targetTeamId
    ? await prisma.company.findFirst({
        where: {
          id: targetTeamId,
          ...ACTIVE_COMPANY_WHERE,
        },
        select: { id: true, name: true },
      })
    : null;
  if (targetTeamId && !targetTeam) {
    return NextResponse.json({ error: "Choose a valid destination company." }, { status: 400 });
  }
  if (targetTeam && targetTeam.id === ticket.assignedAgent?.teamId) {
    return NextResponse.json(
      { error: "Choose a different company for a cross-company transfer." },
      { status: 400 },
    );
  }
  const reasonText =
    typeof body.reason === "string" && body.reason.trim()
      ? body.reason.trim()
      : "Unable to resolve with current assignment.";
  if (recipientPortalAccountId) {
    const assigneeCompanyId = ticket.assignedAgent?.teamId ?? null;
    const reviewer = await prisma.portalAccount.findUnique({
      where: { id: recipientPortalAccountId },
      select: {
        accountStatus: true,
        role: true,
        companyMemberships: {
          where: { companyId: assigneeCompanyId ?? "__none__" },
          select: { companyId: true },
        },
      },
    });
    if (
      !reviewer ||
      reviewer.accountStatus !== "ACTIVE" ||
      reviewer.companyMemberships.length === 0 ||
      !isAdminPortalRole(reviewer.role)
    ) {
      return NextResponse.json(
        { error: "Choose an active company Admin from the assigned personnel's company." },
        { status: 400 },
      );
    }
  }
  await logActivity(
    id,
    "AGENT",
    "Transfer requested",
    serializeTransferRequest({
      recipientAgentId: null,
      recipientAgentName: null,
      recipientPortalAccountId: recipientPortalAccountId || null,
      recipientSuperAdmin,
      targetTeamId: targetTeam?.id ?? null,
      targetTeamName: targetTeam?.name ?? null,
      reason: reasonText,
    }),
  );
  const updated = await prisma.ticket.update({
    where: { id },
    data: {
      status: ticket.status === "OPEN" ? "ESCALATED" : ticket.status,
    },
    include: { team: true, assignedAgent: true },
  });
  return { ticket: updated };
}

export async function handleApproveTransfer(args: {
  ticketId: string;
  ticket: TransferServiceTicket;
  session: Session;
  body: Record<string, unknown>;
  operatorAgentId: string | null;
}): Promise<NextResponse | TransferOutcome> {
  const { ticketId: id, ticket, session, body, operatorAgentId } = args;
  const transferPending = await loadTransferPending(id);
  if (!transferPending) {
    return NextResponse.json({ error: "No pending transfer request." }, { status: 400 });
  }
  const parsed = await loadLastTransferRequestDetail(id);
  const mayApprove = canViewerApproveTransfer({
    sessionRole: session.user.role,
    reviewerPortalAccountId: (
      await prisma.portalAccount.findFirst({
        where: { email: { equals: session.user.email ?? "", mode: "insensitive" } },
        select: { id: true },
      })
    )?.id ?? null,
    sessionAgentId: operatorAgentId,
    parsed,
  });
  if (!mayApprove) {
    return NextResponse.json(
      { error: "Only the selected colleague (or SuperAdmin) can accept this transfer." },
      { status: 403 },
    );
  }

  // Peer transfer: already parked on recipient’s board at request time — confirm keep.
  // For RFP on Accounting/Finance, also update that procedural assignee to the recipient.
  if (parsed?.recipientAgentId) {
    const recipient = await prisma.agent.findUnique({
      where: { id: parsed.recipientAgentId },
      select: { id: true, name: true },
    });
    if (!recipient) {
      return NextResponse.json({ error: "Transfer recipient no longer exists." }, { status: 400 });
    }

    const transferRequestType = await loadTicketRequestType(id);
    let paymentMetaAfter: PaymentApprovalAssignees | null = null;
    if (transferRequestType === "REQUEST_FOR_PAYMENT") {
      const meta = await initPaymentApprovalMetaIfNeeded(id);
      const step = meta.proceduralStep;
      if (step === "APPROVED_BY_ACCOUNTING" || step === "APPROVED_BY_FINANCE") {
        const uniqueness = canAssignPaymentApprover({
          meta,
          agentId: recipient.id,
          forStep: step,
        });
        if (!uniqueness.ok) {
          return NextResponse.json({ error: uniqueness.error }, { status: 400 });
        }
        const field = assigneeFieldForStep(step);
        const updatedMeta = applyPaymentApprovalAssignees(meta, {
          [field]: recipient.id,
        });
        const saved = await savePaymentApprovalMeta(id, updatedMeta, step);
        if (!saved.ok) {
          return NextResponse.json(
            { error: "Payment approval was updated by someone else. Refresh and try again." },
            { status: 409 },
          );
        }
        paymentMetaAfter = updatedMeta;
        await logActivity(
          id,
          "SYSTEM",
          "Payment approval assignee updated",
          `${PAYMENT_APPROVAL_STEP_LABELS[step]} reassigned to ${recipient.name} on transfer accept.`,
        );
      }
    }

    const updated = await prisma.ticket.update({
      where: { id },
      data: {
        assignedAgentId: recipient.id,
        status:
          ticket.status === "ESCALATED" || ticket.status === "OPEN"
            ? "IN_PROGRESS"
            : ticket.status,
      },
      include: { team: true, assignedAgent: true },
    });
    await logActivity(
      id,
      "SYSTEM",
      "Transfer approved",
      typeof body.note === "string" && body.note.trim()
        ? body.note.trim()
        : `Transfer accepted — request stays with ${recipient.name}.`,
    );
    return { ticket: updated, ...(paymentMetaAfter ? { meta: paymentMetaAfter } : {}) };
  }

  // Legacy: move to unassigned company queue.
  const targetTeam = parsed?.targetTeamId
    ? await prisma.company.findFirst({
        where: {
          id: parsed.targetTeamId,
          ...ACTIVE_COMPANY_WHERE,
        },
        select: { id: true },
      })
    : null;
  if (parsed?.targetTeamId && !targetTeam) {
    return NextResponse.json({ error: "Transfer destination company no longer exists." }, { status: 400 });
  }
  const destinationTeamId = targetTeam?.id ?? ticket.assignedAgent?.teamId ?? null;
  const updated = await prisma.ticket.update({
    where: { id },
    data: {
      assignedAgentId: null,
      ...(destinationTeamId ? { teamId: destinationTeamId } : {}),
      status: "OPEN",
    },
    include: { team: true, assignedAgent: true },
  });
  await logActivity(
    id,
    "SYSTEM",
    "Transfer approved",
    typeof body.note === "string" ? body.note : "Admin approved reassignment request.",
  );
  return { ticket: updated };
}

export async function handleRejectTransfer(args: {
  ticketId: string;
  ticket: TransferServiceTicket;
  session: Session;
  body: Record<string, unknown>;
  operatorAgentId: string | null;
}): Promise<NextResponse | TransferOutcome> {
  const { ticketId: id, ticket, session, body, operatorAgentId } = args;
  const transferPending = await loadTransferPending(id);
  if (!transferPending) {
    return NextResponse.json({ error: "No pending transfer request." }, { status: 400 });
  }
  const parsed = await loadLastTransferRequestDetail(id);
  const mayReject = canViewerApproveTransfer({
    sessionRole: session.user.role,
    reviewerPortalAccountId: (
      await prisma.portalAccount.findFirst({
        where: { email: { equals: session.user.email ?? "", mode: "insensitive" } },
        select: { id: true },
      })
    )?.id ?? null,
    sessionAgentId: operatorAgentId,
    parsed,
  });
  if (!mayReject) {
    return NextResponse.json(
      { error: "Only the selected colleague (or SuperAdmin) can decline this transfer." },
      { status: 403 },
    );
  }

  // Peer transfer declined: return the request to the original requester’s board.
  if (parsed?.recipientAgentId) {
    const restoreAgentId = parsed.fromAgentId?.trim() || null;
    if (!restoreAgentId) {
      await logActivity(
        id,
        "AGENT",
        "Transfer rejected",
        typeof body.note === "string" && body.note.trim()
          ? body.note.trim()
          : "Transfer declined — original requester was not recorded; assignment unchanged.",
      );
      const updated = await prisma.ticket.findUnique({
        where: { id },
        include: { team: true, assignedAgent: true },
      });
      return { ticket: updated };
    }
    const restoreAgent = await prisma.agent.findUnique({
      where: { id: restoreAgentId },
      select: { id: true, name: true },
    });
    if (!restoreAgent) {
      return NextResponse.json(
        { error: "Original requester no longer exists; cannot return the transfer." },
        { status: 400 },
      );
    }
    const updated = await prisma.ticket.update({
      where: { id },
      data: {
        assignedAgentId: restoreAgent.id,
        status:
          ticket.status === "ESCALATED" || ticket.status === "OPEN"
            ? "IN_PROGRESS"
            : ticket.status,
      },
      include: { team: true, assignedAgent: true },
    });
    await logActivity(
      id,
      "AGENT",
      "Transfer rejected",
      typeof body.note === "string" && body.note.trim()
        ? body.note.trim()
        : `Transfer declined — returned to ${restoreAgent.name}.`,
    );
    await logActivity(
      id,
      "SYSTEM",
      "Assigned to transfer requester",
      `Request returned to ${restoreAgent.name}’s board.`,
    );
    return { ticket: updated };
  }

  await logActivity(
    id,
    "AGENT",
    "Transfer rejected",
    typeof body.note === "string" && body.note.trim()
      ? body.note.trim()
      : "Transfer declined — request stays with the current assignee.",
  );
  const updated = await prisma.ticket.findUnique({
    where: { id },
    include: { team: true, assignedAgent: true },
  });
  return { ticket: updated };
}
