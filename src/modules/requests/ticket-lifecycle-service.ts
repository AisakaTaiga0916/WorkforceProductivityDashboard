import type { Prisma, TicketPriority, TicketStatus } from "@prisma/client/primary";
import type { Session } from "next-auth";
import { NextResponse } from "next/server";
import { permissionDenied } from "@/modules/platform/rbac/permissions";
import { prisma } from "@/modules/platform/db/prisma";
import { loadTicketRequestType } from "@/modules/requests/ticket-request-type";
import { logActivity, touchFirstResponse } from "@/modules/requests/ticket-actions";
import { sendResolutionEmail } from "@/lib/email";
import { isAwaitingCustomerConfirmation } from "@/modules/requests/customer-pending-resolution";
import { didRequestBoardLaneChange } from "@/modules/requests/sla";
import {
  getRequestBoardColumnById,
  requestBoardOwnerKey,
  setTicketRequestBoardColumnId,
  touchTicketBoardLaneEnteredAt,
} from "@/modules/requests/request-board-columns";
import { proceduralBoardAssigneeWrite } from "@/modules/requests/procedural-board-assignee";
import { normalizeFeedbackComment, validateFeedbackForRating } from "@/modules/requests/ticket-feedback-policy";
import { ensureTicketRemarksColumn } from "@/lib/ensure-ticket-remarks-column";
import { initPaymentApprovalMetaIfNeeded } from "@/modules/requests/payment-approval-db";
import {
  applyItemRequisitionApprovalAssignees,
  canCompleteItemRequisitionApprovalStep,
  completeItemRequisitionApprovalStep,
  currentItemRequisitionStepBoardAssigneeId,
  itemRequisitionAssigneeFieldForStep,
  ITEM_REQUISITION_APPROVAL_STEP_LABELS,
  itemRequisitionProceduralStatusLabel,
} from "@/modules/requests/item-requisition-approval";
import {
  initItemRequisitionApprovalMetaIfNeeded,
  saveItemRequisitionApprovalMeta,
} from "@/modules/requests/item-requisition-approval-db";
import {
  applyFundTransferApprovalAssignees,
  canCompleteFundTransferApprovalStep,
  completeFundTransferApprovalStep,
  currentFundTransferStepBoardAssigneeId,
  fundTransferAssigneeFieldForStep,
  FUND_TRANSFER_APPROVAL_STEP_LABELS,
  fundTransferProceduralStatusLabel,
} from "@/modules/requests/fund-transfer-approval";
import {
  initFundTransferApprovalMetaIfNeeded,
  saveFundTransferApprovalMeta,
} from "@/modules/requests/fund-transfer-approval-db";
import {
  applyJobOrderApprovalAssignees,
  canCompleteJobOrderApprovalStep,
  clearJobOrderExecutionAssignment,
  completeJobOrderApprovalStep,
  currentJobOrderStepBoardAssigneeId,
  isJobOrderJobDone,
  jobOrderAssigneeFieldForStep,
  JOB_ORDER_APPROVAL_STEP_LABELS,
  jobOrderProceduralStatusLabel,
  promoteJobOrderPendingExecutionAssignee,
} from "@/modules/requests/job-order-approval";
import {
  initJobOrderApprovalMetaIfNeeded,
  saveJobOrderApprovalMeta,
} from "@/modules/requests/job-order-approval-db";
import { hasJobOrderJobOutputUploaded } from "@/modules/requests/job-order-attachments";
import { parseIntakeScreenshotMeta } from "@/modules/requests/ticket-intake-screenshots-meta";

/** Ticket row as loaded by the tickets PATCH route preamble. */
export type LifecycleServiceTicket = Prisma.TicketGetPayload<{
  include: {
    assignedAgent: { select: { id: true; name: true; email: true; teamId: true } };
  };
}>;

type TicketWithAssignee = Prisma.TicketGetPayload<{
  include: { team: true; assignedAgent: true };
}>;

function canTransition(from: TicketStatus, to: TicketStatus) {
  const allowed: [TicketStatus, TicketStatus][] = [
    ["OPEN", "IN_PROGRESS"],
    ["OPEN", "RESOLVED"],
    ["OPEN", "FOR_CONFIRMATION"],
    ["IN_PROGRESS", "RESOLVED"],
    ["IN_PROGRESS", "FOR_CONFIRMATION"],
    // Legacy PENDING_INFO tickets may still exit to active/resolved states.
    ["PENDING_INFO", "IN_PROGRESS"],
    ["PENDING_INFO", "RESOLVED"],
    ["PENDING_INFO", "FOR_CONFIRMATION"],
    ["ESCALATED", "IN_PROGRESS"],
    ["ESCALATED", "RESOLVED"],
    ["ESCALATED", "FOR_CONFIRMATION"],
    ["RESOLVED", "CLOSED"],
    ["RESOLVED", "IN_PROGRESS"],
    ["FOR_CONFIRMATION", "IN_PROGRESS"],
  ];
  return allowed.some(([a, b]) => a === from && b === to);
}

function resolutionVerifiedFromActivities(activities: Array<{ summary: string }>) {
  let verified = false;
  for (const a of activities) {
    if (a.summary === "Resolution verification approved") verified = true;
    if (a.summary === "Resolution verification rejected") verified = false;
  }
  return verified;
}

export async function handleTicketStatusChange(args: {
  ticketId: string;
  ticket: LifecycleServiceTicket;
  session: Session;
  body: Record<string, unknown>;
  operatorAgentId: string | null;
  isOwner: boolean;
  isAdminOrAgent: boolean;
  canStaffMutateTicket: boolean;
  roleIsAdmin: boolean;
  roleIsCompanyAdmin: boolean;
  isAssignedOperator: boolean;
}): Promise<NextResponse | { ticket: LifecycleServiceTicket | TicketWithAssignee }> {
  const {
    ticketId: id,
    ticket,
    session,
    body,
    operatorAgentId,
    isOwner,
    isAdminOrAgent,
    canStaffMutateTicket,
    roleIsAdmin,
    roleIsCompanyAdmin,
    isAssignedOperator,
  } = args;

  let approveDenied: NextResponse | null | undefined;
  /** Role permission to complete a procedural approval step; seat checks still decide who. */
  const requestsApproveDenied = async () => {
    if (approveDenied === undefined) {
      approveDenied = await permissionDenied(session, "requests.approve");
    }
    return approveDenied;
  };

  if (!isAdminOrAgent && !(isOwner && body.status === "IN_PROGRESS")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (isAdminOrAgent && !canStaffMutateTicket && !(isOwner && body.status === "IN_PROGRESS")) {
    return NextResponse.json(
      { error: "Only the assigned personnel (or company admin) can update this ticket." },
      { status: 403 },
    );
  }
  const nextStatus = body.status as TicketStatus;
  if (nextStatus === "CLOSED") {
    return NextResponse.json(
      { error: "Tickets can only be fully closed after requestor verification and star review." },
      { status: 400 },
    );
  }

  const boardColumnIdRaw = body.boardColumnId;
  const requestedBoardColumnId =
    typeof boardColumnIdRaw === "string" && boardColumnIdRaw.trim()
      ? boardColumnIdRaw.trim()
      : boardColumnIdRaw === null
        ? null
        : undefined;
  const statusUnchanged = ticket.status === nextStatus;
  const onlyMovingBoard =
    statusUnchanged &&
    typeof requestedBoardColumnId === "string" &&
    requestedBoardColumnId !== (ticket.requestBoardColumnId ?? null);

  // Unassigned tickets cannot enter the work cycle.
  // This prevents setting IN_PROGRESS / FOR_CONFIRMATION when assignedAgentId is null.
  if (
    !onlyMovingBoard &&
    !ticket.assignedAgentId &&
    (nextStatus === "IN_PROGRESS" || nextStatus === "FOR_CONFIRMATION")
  ) {
    return NextResponse.json(
      { error: "A ticket must be assigned to personnel before it can move into In progress / For confirmation." },
      { status: 400 },
    );
  }

  if (!statusUnchanged && !canTransition(ticket.status, nextStatus)) {
    return NextResponse.json(
      { error: `Cannot move from ${ticket.status} to ${nextStatus}` },
      { status: 400 },
    );
  }

  if (statusUnchanged && !onlyMovingBoard && requestedBoardColumnId === undefined) {
    return { ticket };
  }

  if (nextStatus === "IN_PROGRESS" && ticket.priority === "UNSET" && !onlyMovingBoard) {
    return NextResponse.json(
      {
        error:
          "Set a priority level before moving this ticket to In progress. Use Ticket controls → Priority level.",
      },
      { status: 400 },
    );
  }

  if (ticket.status === "OPEN" && nextStatus === "IN_PROGRESS") {
    if (!(roleIsAdmin || roleIsCompanyAdmin || isAssignedOperator)) {
      return NextResponse.json(
        { error: "Only the assigned personnel can start working on this ticket." },
        { status: 403 },
      );
    }
  }

  const data: Prisma.TicketUpdateInput = statusUnchanged ? {} : { status: nextStatus };

  let paymentProceduralNote: string | null = null;
  if (!statusUnchanged) {
    if (nextStatus === "IN_PROGRESS" && ticket.status === "OPEN") {
      await touchFirstResponse(ticket, "AGENT");
    }

    if (nextStatus === "RESOLVED" || nextStatus === "FOR_CONFIRMATION") {
      data.resolvedAt = new Date();
      data.resolutionNotes =
        (body.resolutionNotes as string | undefined) ?? ticket.resolutionNotes;
      await touchFirstResponse(ticket, "AGENT");
    }

    if (nextStatus === "IN_PROGRESS" && isAwaitingCustomerConfirmation(ticket.status)) {
      data.reopenCount = ticket.reopenCount + 1;
      data.resolvedAt = null;
    }

    if (nextStatus === "ESCALATED") {
      return NextResponse.json(
        {
          error:
            "Use Request for transfer instead of changing status to escalated. Transfer requests are submitted from the ticket workspace.",
        },
        { status: 400 },
      );
    }

    // RFP: For Confirmation is locked until the full procedural chain is green-lit (DONE).
    // IRS / Fund Transfer may still advance a step via For Confirmation.
    if (nextStatus === "FOR_CONFIRMATION") {
      const requestType = await loadTicketRequestType(id);
      if (requestType === "REQUEST_FOR_PAYMENT") {
        const meta = await initPaymentApprovalMetaIfNeeded(id);
        if (meta.proceduralStep !== "DONE") {
          return NextResponse.json(
            {
              error:
                meta.skipApprovedBy
                  ? "This Request for Payment is not green-lit yet. Complete NOTED BY, PREPARED BY BOOKKEEPER, and APPROVED BY ACCOUNTING before proceeding."
                  : "This Request for Payment is not green-lit yet. Complete NOTED BY, APPROVED BY, PREPARED BY BOOKKEEPER, and APPROVED BY ACCOUNTING before proceeding.",
            },
            { status: 400 },
          );
        }
      } else if (requestType === "ITEM_REQUISITION_SLIP") {
        const meta = await initItemRequisitionApprovalMetaIfNeeded(id);
        if (meta.proceduralStep !== "DONE") {
          const approveBlock = await requestsApproveDenied();
          if (approveBlock) return approveBlock;
          const gate = canCompleteItemRequisitionApprovalStep({
            meta,
            actorAgentId: operatorAgentId,
            ticketAssignedAgentId: ticket.assignedAgentId,
          });
          if (!gate.ok) {
            return NextResponse.json({ error: gate.error }, { status: 403 });
          }
          const stepField = itemRequisitionAssigneeFieldForStep(meta.proceduralStep);
          const stamped = applyItemRequisitionApprovalAssignees(meta, {
            [stepField]: ticket.assignedAgentId,
          });
          const advanced = completeItemRequisitionApprovalStep(stamped);
          await saveItemRequisitionApprovalMeta(id, advanced);
          const completedLabel = ITEM_REQUISITION_APPROVAL_STEP_LABELS[meta.proceduralStep];
          await logActivity(
            id,
            "AGENT",
            `Item requisition approval · ${completedLabel}`,
            `${completedLabel} completed via For Confirmation move.`,
          );
          paymentProceduralNote = itemRequisitionProceduralStatusLabel(advanced.proceduralStep);
          if (advanced.proceduralStep !== "DONE") {
            data.status = "IN_PROGRESS";
            data.resolvedAt = null;
            Object.assign(
              data,
              proceduralBoardAssigneeWrite(
                currentItemRequisitionStepBoardAssigneeId(advanced),
                ticket.assignedAgentId,
              ),
            );
            if (paymentProceduralNote) {
              await logActivity(
                id,
                "SYSTEM",
                "Item requisition approval pending",
                paymentProceduralNote,
              );
            }
            await logActivity(
              id,
              "SYSTEM",
              "Next approval available",
              "Use Ticket Controls → Request approval to send this request to the next role.",
            );
          }
        }
      } else if (requestType === "FUND_TRANSFER_REQUEST") {
        const meta = await initFundTransferApprovalMetaIfNeeded(id);
        if (meta.proceduralStep !== "DONE") {
          const approveBlock = await requestsApproveDenied();
          if (approveBlock) return approveBlock;
          const gate = canCompleteFundTransferApprovalStep({
            meta,
            actorAgentId: operatorAgentId,
            ticketAssignedAgentId: ticket.assignedAgentId,
          });
          if (!gate.ok) {
            return NextResponse.json({ error: gate.error }, { status: 403 });
          }
          const stepField = fundTransferAssigneeFieldForStep(meta.proceduralStep);
          const stamped = applyFundTransferApprovalAssignees(meta, {
            [stepField]: ticket.assignedAgentId,
          });
          const advanced = completeFundTransferApprovalStep(stamped);
          await saveFundTransferApprovalMeta(id, advanced);
          const completedLabel = FUND_TRANSFER_APPROVAL_STEP_LABELS[meta.proceduralStep];
          await logActivity(
            id,
            "AGENT",
            `Fund transfer approval · ${completedLabel}`,
            `${completedLabel} completed via For Confirmation move.`,
          );
          paymentProceduralNote = fundTransferProceduralStatusLabel(advanced.proceduralStep);
          if (advanced.proceduralStep !== "DONE") {
            data.status = "IN_PROGRESS";
            data.resolvedAt = null;
            Object.assign(
              data,
              proceduralBoardAssigneeWrite(
                currentFundTransferStepBoardAssigneeId(advanced),
                ticket.assignedAgentId,
              ),
            );
            if (paymentProceduralNote) {
              await logActivity(
                id,
                "SYSTEM",
                "Fund transfer approval pending",
                paymentProceduralNote,
              );
            }
            await logActivity(
              id,
              "SYSTEM",
              "Next approval available",
              "Use Ticket Controls → Request approval to send this request to the next role.",
            );
          }
        }
      } else if (requestType === "JOB_ORDER") {
        const meta = await initJobOrderApprovalMetaIfNeeded(id);
        if (meta.proceduralStep !== "DONE") {
          const hasJobOutput = hasJobOrderJobOutputUploaded(
            parseIntakeScreenshotMeta(ticket.intakeScreenshotMeta),
          );
          const approveBlock = await requestsApproveDenied();
          if (approveBlock) return approveBlock;
          const gate = canCompleteJobOrderApprovalStep({
            meta,
            actorAgentId: operatorAgentId,
            ticketAssignedAgentId: ticket.assignedAgentId,
            hasJobOutput,
            hasJobDone: isJobOrderJobDone(meta),
          });
          if (!gate.ok) {
            return NextResponse.json({ error: gate.error }, { status: 403 });
          }
          const stepField = jobOrderAssigneeFieldForStep(meta.proceduralStep);
          const stamped = applyJobOrderApprovalAssignees(meta, {
            [stepField]: ticket.assignedAgentId,
          });
          let advanced = clearJobOrderExecutionAssignment(
            completeJobOrderApprovalStep(stamped),
          );
          const completedLabel = JOB_ORDER_APPROVAL_STEP_LABELS[meta.proceduralStep];
          await logActivity(
            id,
            "AGENT",
            `Job order approval · ${completedLabel}`,
            `${completedLabel} completed via For Confirmation move.`,
          );
          paymentProceduralNote = jobOrderProceduralStatusLabel(advanced.proceduralStep);
          if (advanced.proceduralStep !== "DONE") {
            await saveJobOrderApprovalMeta(id, advanced);
            data.status = "IN_PROGRESS";
            data.resolvedAt = null;
            Object.assign(
              data,
              proceduralBoardAssigneeWrite(
                currentJobOrderStepBoardAssigneeId(advanced),
                ticket.assignedAgentId,
              ),
            );
            if (paymentProceduralNote) {
              await logActivity(
                id,
                "SYSTEM",
                "Job order approval pending",
                paymentProceduralNote,
              );
            }
            await logActivity(
              id,
              "SYSTEM",
              "Next approval available",
              "Use Ticket Controls → Request approval to send this request to the next role.",
            );
          } else {
            const promoted = promoteJobOrderPendingExecutionAssignee(advanced);
            advanced = promoted.meta;
            await saveJobOrderApprovalMeta(id, advanced);
            data.status = "IN_PROGRESS";
            data.resolvedAt = null;
            const approvalDoneAssigneeWrite = proceduralBoardAssigneeWrite(
              promoted.agentId,
              ticket.assignedAgentId,
            );
            Object.assign(data, approvalDoneAssigneeWrite);
            if (promoted.agentId) {
              const promotedAgent = await prisma.agent.findUnique({
                where: { id: promoted.agentId },
                select: { name: true },
              });
              await logActivity(
                id,
                "SYSTEM",
                "Job order approval complete",
                `All Job Order approval roles are complete. Execution assignee ${promotedAgent?.name ?? "selected earlier"} applied to the Request Board.`,
              );
            } else {
              await logActivity(
                id,
                "SYSTEM",
                "Job order approval complete",
                "All Job Order approval roles are complete. Ready for execution assignment on the Assignment Board.",
              );
              if (Object.keys(approvalDoneAssigneeWrite).length > 0) {
                await logActivity(
                  id,
                  "SYSTEM",
                  "Board assignee cleared",
                  "All Job Order approvals are complete — cleared the Request Board icon for execution assignment.",
                );
              }
            }
          }
        }
      }
    }
  } // end !statusUnchanged side effects

  let boardColumnIdToSet: string | null | undefined;
  if (typeof requestedBoardColumnId === "string") {
    const boardColumn = await getRequestBoardColumnById(
      requestBoardOwnerKey(session.user),
      requestedBoardColumnId,
    );
    if (!boardColumn) {
      return NextResponse.json({ error: "Board column not found." }, { status: 400 });
    }
    if (!boardColumn.allowDrop) {
      return NextResponse.json(
        { error: "Cards cannot be moved into this board." },
        { status: 400 },
      );
    }
    boardColumnIdToSet = boardColumn.id;
  } else if (requestedBoardColumnId === null) {
    boardColumnIdToSet = null;
  }

  const statusAfterUpdate =
    typeof data.status === "string" ? (data.status as TicketStatus) : ticket.status;
  const columnAfterUpdate =
    boardColumnIdToSet !== undefined
      ? boardColumnIdToSet
      : (ticket.requestBoardColumnId ?? null);
  const laneChanged = didRequestBoardLaneChange(
    {
      status: ticket.status,
      requestBoardColumnId: ticket.requestBoardColumnId,
    },
    { status: statusAfterUpdate, requestBoardColumnId: columnAfterUpdate },
  );
  // Column moves stamp via setTicketRequestBoardColumnId; status-only lane changes stamp after update.
  const stampLaneAfterUpdate = laneChanged && boardColumnIdToSet === undefined;

  const updated = await prisma.ticket.update({
    where: { id },
    data,
    include: { team: true, assignedAgent: true },
  });

  if (boardColumnIdToSet !== undefined) {
    await setTicketRequestBoardColumnId(id, boardColumnIdToSet, {
      touchLaneEnteredAt: laneChanged,
    });
  } else if (stampLaneAfterUpdate) {
    await touchTicketBoardLaneEnteredAt(id);
  }

  const actor =
    isAwaitingCustomerConfirmation(ticket.status) && nextStatus === "IN_PROGRESS"
      ? "USER"
      : "AGENT";

  const effectiveStatus = updated.status;
  await logActivity(
    id,
    actor,
    onlyMovingBoard
      ? "Board lane updated"
      : `Status → ${effectiveStatus}`,
    typeof body.note === "string" ? body.note : paymentProceduralNote ?? undefined,
  );

  if (!onlyMovingBoard && (effectiveStatus === "RESOLVED" || effectiveStatus === "FOR_CONFIRMATION")) {
    const smtpRecipient =
      updated.requestorEmail?.trim() || updated.contactEmail;
    await sendResolutionEmail({
      ticketId: updated.id,
      ticketNumber: updated.ticketNumber,
      title: updated.title,
      recipientEmail: smtpRecipient,
      recipientName: updated.contactName,
      resolutionNotes: updated.resolutionNotes,
    });
    await logActivity(
      id,
      "SYSTEM",
      "Resolution email sent",
      `Mandatory rating request sent to ${smtpRecipient}.`,
    );
  }

  return { ticket: updated };
}

export async function handlePriorityChange(args: {
  ticketId: string;
  body: Record<string, unknown>;
  canPrioritize: boolean;
}): Promise<NextResponse | { ticket: TicketWithAssignee }> {
  const { ticketId: id, body, canPrioritize } = args;
  if (!canPrioritize) {
    return NextResponse.json(
      { error: "Only Admin or the assigned personnel can change priority." },
      { status: 403 },
    );
  }
  const nextPriority = body.priority as TicketPriority;
  const allowedPriorities: TicketPriority[] = ["LOW", "MEDIUM", "HIGH", "URGENT"];
  if (!allowedPriorities.includes(nextPriority)) {
    return NextResponse.json({ error: "Invalid priority." }, { status: 400 });
  }
  const updated = await prisma.ticket.update({
    where: { id },
    data: { priority: nextPriority },
    include: { team: true, assignedAgent: true },
  });
  await logActivity(
    id,
    "AGENT",
    `Priority → ${nextPriority}`,
    typeof body.note === "string" ? body.note : undefined,
  );
  return { ticket: updated };
}

export async function handleUpdateRemarks(args: {
  ticketId: string;
  body: Record<string, unknown>;
  canStaffMutateTicket: boolean;
}): Promise<NextResponse | { ticket: TicketWithAssignee }> {
  const { ticketId: id, body, canStaffMutateTicket } = args;
  if (!canStaffMutateTicket) {
    return NextResponse.json(
      { error: "Only the assigned personnel (or company admin) can update remarks." },
      { status: 403 },
    );
  }
  await ensureTicketRemarksColumn();
  const raw = typeof body.remarks === "string" ? body.remarks : "";
  const nextRemarks = raw.trim().slice(0, 8000) || null;
  const updated = await prisma.ticket.update({
    where: { id },
    data: { remarks: nextRemarks },
    include: { team: true, assignedAgent: true },
  });
  await logActivity(
    id,
    "AGENT",
    nextRemarks ? "Remarks updated" : "Remarks cleared",
    nextRemarks ? nextRemarks.slice(0, 500) : undefined,
  );
  return { ticket: updated };
}

export async function handleSubmitFeedback(args: {
  ticketId: string;
  ticket: LifecycleServiceTicket;
  body: Record<string, unknown>;
  isRequestor: boolean;
}): Promise<NextResponse | { feedback: Prisma.TicketFeedbackGetPayload<object> }> {
  const { ticketId: id, ticket, body, isRequestor } = args;
  if (!isRequestor) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!["FOR_CONFIRMATION", "RESOLVED", "CLOSED"].includes(ticket.status)) {
    return NextResponse.json(
      { error: "Feedback allowed only for tickets awaiting confirmation or closed." },
      { status: 400 },
    );
  }
  const verificationAudit = await prisma.ticketActivity.findMany({
    where: {
      ticketId: id,
      summary: { in: ["Resolution verification approved", "Resolution verification rejected"] },
    },
    orderBy: { createdAt: "asc" },
    select: { summary: true },
  });
  const resolutionVerified = resolutionVerifiedFromActivities(verificationAudit);
  if (!resolutionVerified) {
    return NextResponse.json(
      { error: "Email verification is required before submitting a star review." },
      { status: 400 },
    );
  }
  const csat = Number(body.csat);
  if (!Number.isFinite(csat) || csat < 1 || csat > 5) {
    return NextResponse.json({ error: "csat must be 1-5" }, { status: 400 });
  }
  const comment = normalizeFeedbackComment(body.comment);
  const feedbackError = validateFeedbackForRating(csat, comment);
  if (feedbackError) {
    return NextResponse.json({ error: feedbackError }, { status: 400 });
  }
  const nps =
    body.nps === undefined || body.nps === null
      ? null
      : Number(body.nps);
  if (nps !== null && (!Number.isFinite(nps) || nps < 0 || nps > 10)) {
    return NextResponse.json({ error: "nps must be 0-10" }, { status: 400 });
  }
  const ces =
    body.ces === undefined || body.ces === null
      ? null
      : Number(body.ces);
  if (ces !== null && (!Number.isFinite(ces) || ces < 1 || ces > 7)) {
    return NextResponse.json({ error: "ces must be 1-7" }, { status: 400 });
  }

  const existingFeedback = await prisma.ticketFeedback.findUnique({ where: { ticketId: id } });
  const fb = await prisma.ticketFeedback.upsert({
    where: { ticketId: id },
    create: {
      ticketId: id,
      csat,
      nps,
      ces,
      comment,
    },
    update: {
      csat,
      nps,
      ces,
      comment,
    },
  });

  if (!existingFeedback && (ticket.status === "RESOLVED" || ticket.status === "FOR_CONFIRMATION")) {
    await prisma.ticket.update({
      where: { id },
      data: { status: "CLOSED", closedAt: new Date() },
    });
    await logActivity(
      id,
      "USER",
      "Status → CLOSED",
      "Ticket closed automatically after mandatory rating.",
    );
  }

  await logActivity(id, "USER", "Feedback captured", "CSAT / optional NPS & CES recorded.");

  return { feedback: fb };
}

export async function handleResolutionVerification(args: {
  ticketId: string;
  ticket: LifecycleServiceTicket;
  body: Record<string, unknown>;
  isRequestor: boolean;
}): Promise<NextResponse | { ticket: TicketWithAssignee } | { ok: true }> {
  const { ticketId: id, ticket, body, isRequestor } = args;
  if (!isRequestor) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!isAwaitingCustomerConfirmation(ticket.status)) {
    return NextResponse.json(
      { error: "Verification is only allowed while the ticket awaits your confirmation." },
      { status: 400 },
    );
  }
  const verified = Boolean(body.verified);
  if (!verified) {
    const reason = (body.reason as string | undefined)?.trim();
    if (!reason) {
      return NextResponse.json(
        { error: "Reason is required when not verifying resolution." },
        { status: 400 },
      );
    }
    const updated = await prisma.ticket.update({
      where: { id },
      data: {
        status: "OPEN",
        resolvedAt: null,
        reopenCount: ticket.reopenCount + 1,
      },
      include: { team: true, assignedAgent: true },
    });
    await logActivity(
      id,
      "USER",
      "Resolution verification rejected",
      reason,
    );
    return { ticket: updated };
  }
  await logActivity(
    id,
    "USER",
    "Resolution verification approved",
    "Requestor confirmed resolution via email verification.",
  );
  return { ok: true };
}

export async function handleCancelRequest(args: {
  ticketId: string;
  ticket: LifecycleServiceTicket;
  isRequestor: boolean;
}): Promise<NextResponse | { ticket: Prisma.TicketGetPayload<object> }> {
  const { ticketId: id, ticket, isRequestor } = args;
  if (!isRequestor) {
    return NextResponse.json(
      { error: "Only the requestor can cancel this request." },
      { status: 403 },
    );
  }
  if (ticket.assignedAgentId) {
    return NextResponse.json(
      { error: "This request already has an assignee and can no longer be cancelled." },
      { status: 400 },
    );
  }
  if (ticket.status === "CLOSED") {
    return NextResponse.json({ error: "This request is already closed." }, { status: 400 });
  }
  const updated = await prisma.ticket.update({
    where: { id },
    data: { status: "CLOSED", closedAt: new Date() },
  });
  await logActivity(
    id,
    "USER",
    "Request cancelled",
    "Requestor cancelled the request before it was assigned.",
  );
  await logActivity(id, "USER", "Status → CLOSED", "Closed after requestor cancellation.");
  return { ticket: updated };
}
