import { isElevatedUserRole } from "@/lib/auth";
import type { Prisma, TicketPriority, TicketStatus } from "@prisma/client/primary";
import { NextResponse } from "next/server";
import { customerCanAccessTicket, requireSession } from "@/lib/access";
import { sendResolutionEmail } from "@/lib/email";
import { prisma } from "@/lib/prisma";
import { findSessionAgentWithTeam } from "@/lib/session-agent";
import { logActivity, touchFirstResponse } from "@/lib/ticket-actions";
import { portalCompanyAdminPrivilegesForEmail } from "@/lib/portal-staff";
import {
  canViewerApproveTransfer,
  parseTransferRequestDetail,
  serializeTransferRequest,
} from "@/lib/ticket-transfer-request";
import {
  JO_PROJECT_REQUEST_CANCELLED_SUMMARY,
  JO_PROJECT_REQUEST_FULFILLED_SUMMARY,
  JO_PROJECT_REQUESTED_SUMMARY,
  jobOrderProjectRequestPendingFromActivities,
  serializeJobOrderProjectRequest,
} from "@/lib/job-order-project-request";
import { loadHrisAssignableStaff } from "@/lib/hris-staff-roster";
import { didRequestBoardLaneChange, getTicketSlaState } from "@/lib/sla";
import { isAwaitingCustomerConfirmation } from "@/lib/customer-pending-resolution";
import { loadStaffAssignmentColorsForAgents } from "@/lib/assignee-assignment-color";
import { normalizeFeedbackComment, validateFeedbackForRating } from "@/lib/ticket-feedback-policy";
import { isAdminPortalRole } from "@/lib/staff-role";
import { rosterTeamNameFilter } from "@/lib/company-roster";
import { resolveAgentDesignatedCompanyId, resolveStaffCompanyTeamId } from "@/lib/staff-company-scope";
import { resolveAgentIdForPositionCode, resolveMergedSourceUserIdForSessionEmail } from "@/lib/approval-position-resolver";
import {
  adminOutsideCompanyScope,
  isAcaBoardVisibleAssignee,
  isCurrentAcaStepAssignee,
  isCurrentPaymentStepAssignee,
  isSessionAssigneeOfTicket,
  isSessionJobOrderTeamMember,
  isTicketAssignee,
  personnelForbiddenForTicket,
} from "@/lib/ticket-staff-access";
import {
  applyPaymentApprovalAssignees,
  assigneeFieldForStep,
  assigneeIdForStep,
  canAssignPaymentApprover,
  canCompletePaymentApprovalStep,
  canAssignDeferredPaymentAccountingFinance,
  canEditDeferredPaymentMode,
  canMarkPaymentStepApproved,
  completePaymentApprovalStep,
  currentPaymentStepBoardAssigneeId,
  isPaymentStepApprovedAck,
  markPaymentStepApproved,
  PAYMENT_APPROVAL_FIELD_LABELS,
  PAYMENT_APPROVAL_STEP_LABELS,
  paymentApprovalParticipantIds,
  paymentProceduralStatusLabel,
  paymentStepRequiresApprovedAck,
  type PaymentApprovalAssignees,
  type PaymentApprovalStep,
} from "@/lib/request-for-payment-approval";
import {
  applyPaymentModeToFields,
  formatPaymentRequestDescription,
  parsePaymentRequestDescription,
  validatePaymentModeFields,
} from "@/lib/request-for-payment";
import {
  initPaymentApprovalMetaIfNeeded,
  savePaymentApprovalMeta,
} from "@/lib/payment-approval-db";
import {
  applyItemRequisitionApprovalAssignees,
  canCompleteItemRequisitionApprovalStep,
  completeItemRequisitionApprovalStep,
  currentItemRequisitionStepBoardAssigneeId,
  itemRequisitionAssigneeFieldForStep,
  ITEM_REQUISITION_APPROVAL_FIELD_LABELS,
  ITEM_REQUISITION_APPROVAL_STEP_LABELS,
  itemRequisitionProceduralStatusLabel,
  undoItemRequisitionCanvass,
  type ItemRequisitionApprovalAssignees,
} from "@/lib/item-requisition-approval";
import {
  initItemRequisitionApprovalMetaIfNeeded,
  saveItemRequisitionApprovalMeta,
} from "@/lib/item-requisition-approval-db";
import {
  applyFundTransferApprovalAssignees,
  canCompleteFundTransferApprovalStep,
  completeFundTransferApprovalStep,
  currentFundTransferStepBoardAssigneeId,
  fundTransferAssigneeFieldForStep,
  FUND_TRANSFER_APPROVAL_FIELD_LABELS,
  FUND_TRANSFER_APPROVAL_STEP_LABELS,
  fundTransferProceduralStatusLabel,
  type FundTransferApprovalAssignees,
} from "@/lib/fund-transfer-approval";
import {
  initFundTransferApprovalMetaIfNeeded,
  saveFundTransferApprovalMeta,
} from "@/lib/fund-transfer-approval-db";
import {
  applyJobOrderApprovalAssignees,
  canCompleteJobOrderApprovalStep,
  completeJobOrderApprovalStep,
  currentJobOrderStepBoardAssigneeId,
  jobOrderAssigneeFieldForStep,
  JOB_ORDER_APPROVAL_FIELD_LABELS,
  JOB_ORDER_APPROVAL_STEP_LABELS,
  jobOrderProceduralStatusLabel,
  isJobOrderExecutionWorkspaceOpen,
  isJobOrderProcedureGreenLit,
  applyJobOrderWorkerAgentIds,
  applyJobOrderAssistanceTeam,
  isJobOrderAssistanceMember,
  parseJobOrderWorkerAgentIds,
  clearJobOrderExecutionAssignment,
  markJobOrderExecutionAssigned,
  promoteJobOrderPendingExecutionAssignee,
  setJobOrderPendingExecutionAssignee,
  canMarkJobOrderDone,
  isJobOrderJobDone,
  isJobOrderReadyForConfirmation,
  markJobOrderJobDone,
  type JobOrderApprovalAssignees,
  type JobOrderAssistanceScopeMode,
} from "@/lib/job-order-approval";
import { hasJobOrderJobOutputUploaded } from "@/lib/job-order-attachments";
import { parseIntakeScreenshotMeta } from "@/lib/ticket-intake-screenshots-meta";
import { resolveAgentIdsForOrgChartSection } from "@/lib/org-chart-section-roster";
import { isViewerOrgChartHeadForSection } from "@/lib/org-chart-section-scope";
import { isJobOrderExecutionOutsideSendToDepartment } from "@/lib/job-order-assistance-scope";
import {
  initJobOrderApprovalMetaIfNeeded,
  reconcileJobOrderAwaitingExecutionAssignee,
  saveJobOrderApprovalMeta,
} from "@/lib/job-order-approval-db";
import {
  acaLevelRequiresFeedback,
  acaProceduralStatusLabel,
  canCompleteAcaApprovalStep,
  completeAcaApprovalStep,
  currentAcaBoardAssigneeId,
  currentAcaLevel,
} from "@/lib/aca-approval";
import { loadAcaApprovalMeta, saveAcaApprovalMeta } from "@/lib/aca-approval-db";
import {
  applyRequisitionPricingDerivedFields,
  formatItemRequisitionDescription,
  parseItemRequisitionDescription,
  parseRequisitionItemsPayload,
  validateItemRequisitionPricing,
} from "@/lib/item-requisition";
import { proceduralBoardAssigneeWrite } from "@/lib/procedural-board-assignee";

async function loadTicketRequestType(ticketId: string): Promise<string> {
  const rows = await prisma.$queryRaw<Array<{ request_type: string | null }>>`
    SELECT request_type FROM tickets WHERE id = ${ticketId} LIMIT 1
  `;
  return (rows[0]?.request_type ?? "ISSUE_CONCERN_TICKET").trim() || "ISSUE_CONCERN_TICKET";
}

/** NextResponse.json cannot serialize BigInt (e.g. Team.hrisCompanyId). */
function jsonSafe<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? v.toString() : v)),
  ) as T;
}

async function ticketJsonWithAssigneeColor<T extends { assignedAgent: { email: string; name?: string } | null }>(
  ticket: T,
): Promise<
  Omit<T, "assignedAgent"> & {
    assignedAgent: (NonNullable<T["assignedAgent"]> & { staffAssignmentColor: string | null }) | null;
  }
> {
  const email = ticket.assignedAgent?.email;
  if (!email) {
    return jsonSafe({
      ...ticket,
      assignedAgent: ticket.assignedAgent
        ? { ...ticket.assignedAgent, staffAssignmentColor: null }
        : null,
    });
  }
  const map = await loadStaffAssignmentColorsForAgents([
    { email, name: ticket.assignedAgent?.name ?? null },
  ]);
  const staffAssignmentColor = map.get(email.trim().toLowerCase()) ?? null;
  return jsonSafe({
    ...ticket,
    assignedAgent: ticket.assignedAgent
      ? { ...ticket.assignedAgent, staffAssignmentColor }
      : null,
  });
}

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

function resolutionVerifiedFromActivities(
  activities: Array<{ summary: string }>,
) {
  let verified = false;
  for (const a of activities) {
    if (a.summary === "Resolution verification approved") verified = true;
    if (a.summary === "Resolution verification rejected") verified = false;
  }
  return verified;
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await requireSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const ticket = await prisma.ticket.findUnique({
    where: { id },
    include: {
      team: { select: { id: true, name: true } },
      assignedAgent: { select: { id: true, name: true, email: true, teamId: true } },
      activities: { orderBy: { createdAt: "asc" } },
      messages: { orderBy: { createdAt: "asc" } },
      feedback: true,
    },
  });
  if (!ticket) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const operator = await findSessionAgentWithTeam({
    email: session.user.email,
    name: session.user.name,
  });
  if (
    session.user.role === "Customer" &&
    !customerCanAccessTicket(
      { contactEmail: ticket.contactEmail, requestorEmail: ticket.requestorEmail },
      session.user.email,
    )
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (session.user.role === "Personnel") {
    if (
      await personnelForbiddenForTicket({
        email: session.user.email,
        operatorId: operator?.id,
        ticket,
      })
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }
  const ownsTicket =
    isTicketAssignee({
      operatorId: operator?.id,
      sessionEmail: session.user.email,
      ticket,
    }) ||
    isCurrentPaymentStepAssignee(ticket, operator?.id) ||
    isAcaBoardVisibleAssignee(ticket, operator?.id) ||
    (await isSessionJobOrderTeamMember({
      operatorId: operator?.id,
      sessionEmail: session.user.email,
      ticket,
    }));
  // Cross-company Admins may still read tickets they own as board/RFP/ACA-step assignee
  // (e.g. NOTED BY from the preparer company on a ticket routed to another company).
  if (
    !ownsTicket &&
    (await adminOutsideCompanyScope({
      role: session.user.role,
      email: session.user.email,
      ticketTeamId: ticket.teamId,
      ticket,
      operatorId: operator?.id,
    }))
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const payload = await ticketJsonWithAssigneeColor(ticket);
  const { loadTicketBoardLaneEnteredAtMap, loadTicketLastActivityAtMap, loadTicketForConfirmationEnteredAtMap } =
    await import("@/lib/request-board-columns");
  const [laneMap, activityMap, confirmationMap] = await Promise.all([
    loadTicketBoardLaneEnteredAtMap([id]),
    loadTicketLastActivityAtMap([id]),
    loadTicketForConfirmationEnteredAtMap([id]),
  ]);
  const boardLaneEnteredAt = laneMap.get(id) ?? ticket.updatedAt;
  const lastActivityAt = activityMap.get(id) ?? null;
  const forConfirmationAt =
    confirmationMap.get(id) ??
    (ticket.status === "FOR_CONFIRMATION"
      ? (ticket.resolvedAt ?? boardLaneEnteredAt)
      : null);
  return NextResponse.json({
    ...payload,
    boardLaneEnteredAt: laneMap.get(id)?.toISOString() ?? null,
    lastActivityAt: lastActivityAt?.toISOString() ?? null,
    forConfirmationAt: forConfirmationAt?.toISOString() ?? null,
    slaState: getTicketSlaState({
      ...ticket,
      boardLaneEnteredAt,
      lastActivityAt,
      forConfirmationAt,
    }),
  });
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await requireSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const ticket = await prisma.ticket.findUnique({
    where: { id },
    include: {
      assignedAgent: { select: { id: true, name: true, email: true, teamId: true } },
    },
  });
  if (!ticket) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // paymentApprovalMeta is a scalar Json field — available on the ticket row for RFP step checks.
  const isRequestor = customerCanAccessTicket(
    { contactEmail: ticket.contactEmail, requestorEmail: ticket.requestorEmail },
    session.user.email,
  );
  const isOwner = isRequestor;
  const isAdminOrAgent = ["SuperAdmin", "HighAdmin", "Admin", "Personnel"].includes(session.user.role);
  const roleIsAdmin = ["SuperAdmin", "HighAdmin", "Admin"].includes(session.user.role);
  const operator = await findSessionAgentWithTeam({ email: session.user.email, name: session.user.name });
  const roleIsCompanyAdmin = await portalCompanyAdminPrivilegesForEmail(session.user.email);
  const isAssignedOperator = isTicketAssignee({
    operatorId: operator?.id,
    sessionEmail: session.user.email,
    ticket,
  });
  const isPaymentStepOperator = isCurrentPaymentStepAssignee(ticket, operator?.id);
  const isAcaStepOperator = isCurrentAcaStepAssignee(ticket, operator?.id);
  const isAcaBoardOperator = isAcaBoardVisibleAssignee(ticket, operator?.id);
  const canPrioritize = roleIsAdmin || isAssignedOperator;
  if (session.user.role === "Customer" && !isOwner) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // Cross-company Admins may still act when they own the board assignment or the
  // current RFP/ACA procedural step (NOTED BY can be AGC while the ticket is routed to ACI).
  if (
    !isAssignedOperator &&
    !isPaymentStepOperator &&
    !isAcaStepOperator &&
    !isAcaBoardOperator &&
    (await adminOutsideCompanyScope({
      role: session.user.role,
      email: session.user.email,
      ticketTeamId: ticket.teamId,
      ticket,
      operatorId: operator?.id,
    }))
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const personnelBlocked =
    session.user.role === "Personnel"
      ? await personnelForbiddenForTicket({
          email: session.user.email,
          operatorId: operator?.id,
          ticket,
        })
      : false;
  /** Assignee, RFP-step assignee, company coordinator, or Admin/SuperAdmin. */
  const canStaffMutateTicket =
    roleIsAdmin || (session.user.role === "Personnel" && !personnelBlocked);

  try {
    const body = await req.json();
    const action = body.action as string;
    const loadTransferPending = async () => {
      const transferAudit = await prisma.ticketActivity.findMany({
        where: {
          ticketId: id,
          summary: { in: ["Transfer requested", "Transfer approved", "Transfer rejected"] },
        },
        orderBy: { createdAt: "asc" },
        select: { summary: true },
      });
      return transferPendingFromActivities(transferAudit);
    };
    const loadResolutionVerified = async () => {
      const verificationAudit = await prisma.ticketActivity.findMany({
        where: {
          ticketId: id,
          summary: { in: ["Resolution verification approved", "Resolution verification rejected"] },
        },
        orderBy: { createdAt: "asc" },
        select: { summary: true },
      });
      return resolutionVerifiedFromActivities(verificationAudit);
    };

    if (action === "assign") {
      return NextResponse.json(
        { error: "Assignment updates are only available on the Assignment Board." },
        { status: 403 },
      );
    }

    if (action === "status") {
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
        return NextResponse.json(await ticketJsonWithAssigneeColor(ticket));
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

      // RFP / ACA: For Confirmation is locked until the full procedural chain is green-lit (DONE).
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
        } else if (requestType === "AUTHORITY_TO_CONDUCT_ACTIVITY") {
          const meta = await loadAcaApprovalMeta(id);
          if (!meta || meta.proceduralStep !== "DONE") {
            return NextResponse.json(
              {
                error:
                  "This Authority to Conduct Activity is not green-lit yet. Complete Recommended By, Finance Manager, and all approving seats before proceeding.",
              },
              { status: 400 },
            );
          }
        } else if (requestType === "ITEM_REQUISITION_SLIP") {
          const meta = await initItemRequisitionApprovalMetaIfNeeded(id);
          if (meta.proceduralStep !== "DONE") {
            const gate = canCompleteItemRequisitionApprovalStep({
              meta,
              actorAgentId: operator?.id ?? null,
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
            const gate = canCompleteFundTransferApprovalStep({
              meta,
              actorAgentId: operator?.id ?? null,
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
            const gate = canCompleteJobOrderApprovalStep({
              meta,
              actorAgentId: operator?.id ?? null,
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
        const { getRequestBoardColumnById, requestBoardOwnerKey } = await import(
          "@/lib/request-board-columns"
        );
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
        const { setTicketRequestBoardColumnId } = await import("@/lib/request-board-columns");
        await setTicketRequestBoardColumnId(id, boardColumnIdToSet, {
          touchLaneEnteredAt: laneChanged,
        });
      } else if (stampLaneAfterUpdate) {
        const { touchTicketBoardLaneEnteredAt } = await import("@/lib/request-board-columns");
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

      return NextResponse.json(await ticketJsonWithAssigneeColor(updated));
    }

    if (action === "request_more_info") {
      return NextResponse.json(
        {
          error:
            "Pending info / request more information is no longer used. Use Request chat instead.",
        },
        { status: 410 },
      );
    }

    if (action === "priority") {
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
      return NextResponse.json(await ticketJsonWithAssigneeColor(updated));
    }

    if (action === "request_transfer") {
      if (!isAssignedOperator) {
        return NextResponse.json(
          { error: "Only the assigned personnel can request transfer." },
          { status: 403 },
        );
      }
      const transferRequestType = await loadTicketRequestType(id);
      const { requestTypeSupportsTransfer } = await import("@/lib/request-types");
      if (!requestTypeSupportsTransfer(transferRequestType)) {
        return NextResponse.json(
          { error: "Transfer is not available for this request type." },
          { status: 400 },
        );
      }
      const transferPending = await loadTransferPending();
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
        if (!ticket.assignedAgentId || !operator?.id || ticket.assignedAgentId !== operator.id) {
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
            fromAgentName: fromAgent?.name ?? operator.name ?? null,
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
          const { touchTicketBoardLaneEnteredAt } = await import("@/lib/request-board-columns");
          await touchTicketBoardLaneEnteredAt(id);
        }
        await logActivity(
          id,
          "SYSTEM",
          "Transfer pending in unassigned pool",
          `Request released to Assign Requests (unassigned). Preferred recipient: ${recipient.name}.`,
        );
        return NextResponse.json(await ticketJsonWithAssigneeColor(updated));
      }

      if ((!recipientPortalAccountId && !recipientSuperAdmin) || (recipientPortalAccountId && recipientSuperAdmin)) {
        return NextResponse.json(
          { error: "Choose a colleague to transfer this request to." },
          { status: 400 },
        );
      }
      const targetTeam = targetTeamId
        ? await prisma.team.findFirst({
            where: {
              id: targetTeamId,
              ...rosterTeamNameFilter(),
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
        const reviewer = await prisma.portalAccount.findUnique({
          where: { id: recipientPortalAccountId },
          select: { accountStatus: true, staffDesignatedCompanyId: true, role: true },
        });
        if (
          !reviewer ||
          reviewer.accountStatus !== "ACTIVE" ||
          reviewer.staffDesignatedCompanyId !== ticket.assignedAgent?.teamId ||
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
      return NextResponse.json(await ticketJsonWithAssigneeColor(updated));
    }

    if (action === "approve_transfer") {
      const transferPending = await loadTransferPending();
      if (!transferPending) {
        return NextResponse.json({ error: "No pending transfer request." }, { status: 400 });
      }
      const transferAudit = await prisma.ticketActivity.findMany({
        where: {
          ticketId: id,
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
      const parsed = parseTransferRequestDetail(lastRequestDetail);
      const mayApprove = canViewerApproveTransfer({
        sessionRole: session.user.role,
        reviewerPortalAccountId: (
          await prisma.portalAccount.findFirst({
            where: { email: { equals: session.user.email ?? "", mode: "insensitive" } },
            select: { id: true },
          })
        )?.id ?? null,
        sessionAgentId: operator?.id ?? null,
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
        let paymentMetaAfter: Awaited<ReturnType<typeof initPaymentApprovalMetaIfNeeded>> | null =
          null;
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
        return NextResponse.json({
          ...(await ticketJsonWithAssigneeColor(updated)),
          ...(paymentMetaAfter ? { paymentApprovalMeta: paymentMetaAfter } : {}),
        });
      }

      // Legacy: move to unassigned company queue.
      const targetTeam = parsed?.targetTeamId
        ? await prisma.team.findFirst({
            where: {
              id: parsed.targetTeamId,
              ...rosterTeamNameFilter(),
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
      return NextResponse.json(await ticketJsonWithAssigneeColor(updated));
    }

    if (action === "reject_transfer") {
      const transferPending = await loadTransferPending();
      if (!transferPending) {
        return NextResponse.json({ error: "No pending transfer request." }, { status: 400 });
      }
      const transferAudit = await prisma.ticketActivity.findMany({
        where: {
          ticketId: id,
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
      const parsed = parseTransferRequestDetail(lastRequestDetail);
      const mayReject = canViewerApproveTransfer({
        sessionRole: session.user.role,
        reviewerPortalAccountId: (
          await prisma.portalAccount.findFirst({
            where: { email: { equals: session.user.email ?? "", mode: "insensitive" } },
            select: { id: true },
          })
        )?.id ?? null,
        sessionAgentId: operator?.id ?? null,
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
          return NextResponse.json(await ticketJsonWithAssigneeColor(updated!));
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
        return NextResponse.json(await ticketJsonWithAssigneeColor(updated));
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
      return NextResponse.json(await ticketJsonWithAssigneeColor(updated!));
    }

    if (action === "feedback") {
      if (!isRequestor) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      if (!["FOR_CONFIRMATION", "RESOLVED", "CLOSED"].includes(ticket.status)) {
        return NextResponse.json(
          { error: "Feedback allowed only for tickets awaiting confirmation or closed." },
          { status: 400 },
        );
      }
      const resolutionVerified = await loadResolutionVerified();
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

      return NextResponse.json(fb);
    }

    if (action === "resolution_verification") {
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
        return NextResponse.json(await ticketJsonWithAssigneeColor(updated));
      }
      await logActivity(
        id,
        "USER",
        "Resolution verification approved",
        "Requestor confirmed resolution via email verification.",
      );
      return NextResponse.json({ ok: true });
    }

    if (action === "set_payment_approval_assignees") {
      if (
        !isElevatedUserRole(session.user.role) &&
        session.user.role !== "Admin" &&
        session.user.role !== "Personnel"
      ) {
        return NextResponse.json(
          { error: "Only Admin, SuperAdmin, or Personnel can set payment approval roles from Ticket controls." },
          { status: 403 },
        );
      }
      const requestType = await loadTicketRequestType(id);
      if (requestType !== "REQUEST_FOR_PAYMENT") {
        return NextResponse.json(
          { error: "Payment approval roles apply only to Request for Payment." },
          { status: 400 },
        );
      }
      const meta = await initPaymentApprovalMetaIfNeeded(id);
      const paymentFields = parsePaymentRequestDescription(ticket.description);
      const deferredAccountingFinanceAssign = canAssignDeferredPaymentAccountingFinance({
        meta,
        modeOfPayment: paymentFields?.modeOfPayment,
      });
      const assigneeDeferredEditor = Boolean(isAssignedOperator && deferredAccountingFinanceAssign);
      const fullAssigneeEditor =
        isElevatedUserRole(session.user.role) ||
        session.user.role === "Admin" ||
        (session.user.role === "Personnel" && !assigneeDeferredEditor);
      // Board assignee may only fill deferred Accounting / Finance seats after Noted By + Approved By.
      if (!fullAssigneeEditor && !assigneeDeferredEditor) {
        return NextResponse.json(
          {
            error:
              "Only the assigned personnel can set Accounting and Finance after Noted By and Approved By are complete on a deferred payment request.",
          },
          { status: 403 },
        );
      }
      const pickId = (v: unknown): string | null => {
        if (v === null || v === "") return null;
        return typeof v === "string" && v.trim() ? v.trim() : null;
      };
      // Prepared By is intake-only and not editable from Ticket Controls.
      const nextAssignees: Partial<PaymentApprovalAssignees> = {};
      if (fullAssigneeEditor) {
        if ("notedByAgentId" in body) nextAssignees.notedByAgentId = pickId(body.notedByAgentId);
        if ("approvedByAgentId" in body) nextAssignees.approvedByAgentId = pickId(body.approvedByAgentId);
      }
      if ("accountingAgentId" in body) nextAssignees.accountingAgentId = pickId(body.accountingAgentId);
      if ("financeAgentId" in body) nextAssignees.financeAgentId = pickId(body.financeAgentId);

      if (assigneeDeferredEditor && !fullAssigneeEditor) {
        const keys = Object.keys(nextAssignees);
        if (keys.some((k) => k !== "accountingAgentId" && k !== "financeAgentId")) {
          return NextResponse.json(
            { error: "You can only set Prepared by Bookkeeper and Approved By Accounting on this step." },
            { status: 403 },
          );
        }
        if (!nextAssignees.accountingAgentId && !meta.accountingAgentId) {
          return NextResponse.json(
            { error: "Select Prepared by Bookkeeper." },
            { status: 400 },
          );
        }
        if (!nextAssignees.financeAgentId && !meta.financeAgentId) {
          return NextResponse.json(
            { error: "Select Approved By Accounting." },
            { status: 400 },
          );
        }
      }

      const agentIds = Object.values(nextAssignees).filter((v): v is string => Boolean(v));
      if (agentIds.length > 0) {
        const found = await prisma.agent.findMany({
          where: { id: { in: agentIds } },
          select: { id: true, name: true },
        });
        if (found.length !== new Set(agentIds).size) {
          return NextResponse.json({ error: "One or more selected assignees were not found." }, { status: 400 });
        }
      }

      const requestorCompanyId = await resolveStaffCompanyTeamId(
        ticket.requestorEmail ?? ticket.contactEmail,
      );
      const sendToCompanyId = ticket.teamId;
      async function assertAgentCompany(
        agentId: string | null | undefined,
        expectedCompanyId: string | null | undefined,
        roleLabel: string,
      ): Promise<NextResponse | null> {
        if (!agentId) return null;
        if (!expectedCompanyId) {
          return NextResponse.json(
            { error: `${roleLabel} cannot be set because the company scope is missing.` },
            { status: 400 },
          );
        }
        const agentCompanyId = await resolveAgentDesignatedCompanyId(agentId);
        if (agentCompanyId !== expectedCompanyId) {
          return NextResponse.json(
            { error: `${roleLabel} must be someone from the correct company roster.` },
            { status: 400 },
          );
        }
        return null;
      }
      for (const check of [
        await assertAgentCompany(nextAssignees.notedByAgentId, requestorCompanyId, "Noted By"),
        await assertAgentCompany(
          nextAssignees.accountingAgentId,
          sendToCompanyId,
          "Prepared by Bookkeeper:",
        ),
        await assertAgentCompany(
          nextAssignees.financeAgentId,
          sendToCompanyId,
          "Approved By Accounting",
        ),
      ]) {
        if (check) return check;
      }

      // Preview uniqueness across procedural roles (Prepared By is intake-only).
      const previewMeta = applyPaymentApprovalAssignees(meta, nextAssignees);
      const roleEntries: Array<[PaymentApprovalStep, string | null]> = [
        ["NOTED_BY", previewMeta.notedByAgentId],
        ["APPROVED_BY", previewMeta.approvedByAgentId],
        ["APPROVED_BY_ACCOUNTING", previewMeta.accountingAgentId],
        ["APPROVED_BY_FINANCE", previewMeta.financeAgentId],
      ];
      const seen = new Map<string, PaymentApprovalStep>();
      for (const [step, agentId] of roleEntries) {
        if (!agentId) continue;
        const prior = seen.get(agentId);
        if (prior) {
          return NextResponse.json(
            {
              error: `Each person may only approve once. The same user is set for both ${PAYMENT_APPROVAL_STEP_LABELS[prior]} and ${PAYMENT_APPROVAL_STEP_LABELS[step]}.`,
            },
            { status: 400 },
          );
        }
        seen.set(agentId, step);
      }

      const updatedMeta = previewMeta;
      const savedAssignees = await savePaymentApprovalMeta(id, updatedMeta, meta.proceduralStep);
      if (!savedAssignees.ok) {
        return NextResponse.json(
          { error: "Payment approval was updated by someone else. Refresh and try again." },
          { status: 409 },
        );
      }
      // Put the request on the current procedural role assignee’s Request Board.
      // Empty current seat clears the board icon (no stale prior assignee).
      const boardAssigneeId = currentPaymentStepBoardAssigneeId(updatedMeta);
      const assigneeWrite = proceduralBoardAssigneeWrite(boardAssigneeId, ticket.assignedAgentId);
      if (Object.keys(assigneeWrite).length > 0) {
        await prisma.ticket.update({
          where: { id },
          data: {
            ...assigneeWrite,
            ...(boardAssigneeId &&
            (ticket.status === "OPEN" || ticket.status === "PENDING_INFO")
              ? { status: "IN_PROGRESS" as const }
              : {}),
            ...(boardAssigneeId ? { resolvedAt: null } : {}),
          },
        });
        await logActivity(
          id,
          "SYSTEM",
          boardAssigneeId ? "Assigned to current approval role" : "Board assignee cleared",
          boardAssigneeId
            ? "Request placed on the current procedural assignee’s Request Board."
            : "Current approval seat has no assignee — cleared the Request Board icon.",
        );
      }
      const nameById = new Map(
        (
          await prisma.agent.findMany({
            where: {
              id: {
                in: [
                  updatedMeta.preparedByAgentId,
                  updatedMeta.notedByAgentId,
                  updatedMeta.approvedByAgentId,
                  updatedMeta.accountingAgentId,
                  updatedMeta.financeAgentId,
                ].filter((v): v is string => Boolean(v)),
              },
            },
            select: { id: true, name: true },
          })
        ).map((a) => [a.id, a.name]),
      );
      const detail = (
        Object.keys(PAYMENT_APPROVAL_FIELD_LABELS) as Array<keyof PaymentApprovalAssignees>
      )
        .map((key) => {
          const idVal = updatedMeta[key];
          return `${PAYMENT_APPROVAL_FIELD_LABELS[key]}: ${idVal ? nameById.get(idVal) ?? idVal : "Unassigned"}`;
        })
        .join(" · ");
      await logActivity(id, "AGENT", "Payment approval assignees updated", detail);
      const refreshed = await prisma.ticket.findUnique({
        where: { id },
        include: { team: true, assignedAgent: true },
      });
      return NextResponse.json({
        ...(await ticketJsonWithAssigneeColor(refreshed!)),
        paymentApprovalMeta: updatedMeta,
      });
    }

      if (action === "request_payment_approval") {
      if (!canStaffMutateTicket) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      if (!isAssignedOperator && !roleIsAdmin && !roleIsCompanyAdmin) {
        return NextResponse.json(
          { error: "Only the assigned personnel can request the next payment approval." },
          { status: 403 },
        );
      }
      // Admins / company admins may reassign without a linked Agent row; assignees still need one.
      if (!operator?.id && !roleIsAdmin && !roleIsCompanyAdmin) {
        return NextResponse.json({ error: "Your staff profile could not be resolved." }, { status: 400 });
      }
      const requestType = await loadTicketRequestType(id);
      if (requestType !== "REQUEST_FOR_PAYMENT") {
        return NextResponse.json(
          { error: "Payment approval applies only to Request for Payment." },
          { status: 400 },
        );
      }
      const meta = await initPaymentApprovalMetaIfNeeded(id);
      if (meta.proceduralStep === "DONE") {
        return NextResponse.json({ error: "All payment approval steps are already complete." }, { status: 400 });
      }
      const step = meta.proceduralStep;
      // Assignee must mark Done before they can Submit for Next Approval.
      if (isAssignedOperator && operator?.id) {
        const doneGate = canCompletePaymentApprovalStep({
          meta,
          actorAgentId: operator.id,
          ticketAssignedAgentId: ticket.assignedAgentId,
        });
        const priorIds = paymentApprovalParticipantIds(meta);
        const currentAssignee = assigneeIdForStep(meta, step);
        if (currentAssignee) priorIds.delete(currentAssignee);
        const alreadyApprovedEarlier = priorIds.has(operator.id);
        if (doneGate.ok && !alreadyApprovedEarlier) {
          return NextResponse.json(
            {
              error: "Mark Done on this step before submitting for the next approval.",
            },
            { status: 400 },
          );
        }
      }
      const approverId =
        typeof body.approverAgentId === "string" && body.approverAgentId.trim()
          ? body.approverAgentId.trim()
          : null;
      if (!approverId) {
        return NextResponse.json({ error: "Select a company user to request approval from." }, { status: 400 });
      }
      const companyAnchorId = ticket.assignedAgentId ?? operator?.id ?? null;
      if (!companyAnchorId) {
        return NextResponse.json(
          { error: "Assign this request first, or select a company user with a staff profile." },
          { status: 400 },
        );
      }
      const requesterCompanyId = await resolveAgentDesignatedCompanyId(companyAnchorId);
      const approverCompanyId = await resolveAgentDesignatedCompanyId(approverId);
      // APPROVED BY may be chosen from any company on create; keep that path open here too.
      if (step !== "APPROVED_BY") {
        if (!requesterCompanyId || !approverCompanyId || requesterCompanyId !== approverCompanyId) {
          return NextResponse.json(
            { error: "You can only request approval from users in the same company as this request." },
            { status: 403 },
          );
        }
      }
      const approver = await prisma.agent.findUnique({
        where: { id: approverId },
        select: { id: true, name: true },
      });
      if (!approver) {
        return NextResponse.json({ error: "Selected user was not found." }, { status: 400 });
      }
      const uniqueness = canAssignPaymentApprover({
        meta,
        agentId: approver.id,
        forStep: step,
      });
      if (!uniqueness.ok) {
        return NextResponse.json({ error: uniqueness.error }, { status: 400 });
      }
      const field = assigneeFieldForStep(step);
      const previousAssigneeId = assigneeIdForStep(meta, step);
      let updatedMeta = applyPaymentApprovalAssignees(meta, { [field]: approver.id });
      // Changing Accounting/Finance assignee invalidates any prior Approved ack on that step.
      if (
        previousAssigneeId &&
        previousAssigneeId !== approver.id &&
        (step === "APPROVED_BY_ACCOUNTING" || step === "APPROVED_BY_FINANCE")
      ) {
        const nextAck = { ...updatedMeta.stepApproved };
        delete nextAck[step];
        updatedMeta = { ...updatedMeta, stepApproved: nextAck };
      }
      const saved = await savePaymentApprovalMeta(id, updatedMeta, step);
      if (!saved.ok) {
        return NextResponse.json(
          { error: "Payment approval was updated by someone else. Refresh and try again." },
          { status: 409 },
        );
      }
      const updated = await prisma.ticket.update({
        where: { id },
        data: {
          status: "IN_PROGRESS",
          resolvedAt: null,
          assignedAgent: { connect: { id: approver.id } },
        },
        include: { team: true, assignedAgent: true },
      });
      await logActivity(
        id,
        "AGENT",
        `Approval requested · ${PAYMENT_APPROVAL_STEP_LABELS[step]}`,
        `Requested ${PAYMENT_APPROVAL_STEP_LABELS[step]} from ${approver.name}. Assigned for next step.`,
      );
      const pending = paymentProceduralStatusLabel(updatedMeta.proceduralStep);
      if (pending) {
        await logActivity(id, "SYSTEM", "Payment approval pending", pending);
      }
      return NextResponse.json({
        ...(await ticketJsonWithAssigneeColor(updated)),
        paymentApprovalMeta: updatedMeta,
      });
    }

    if (action === "approve_payment_step") {
      if (!isAdminOrAgent) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      const requestType = await loadTicketRequestType(id);
      if (requestType !== "REQUEST_FOR_PAYMENT") {
        return NextResponse.json(
          { error: "Payment approval applies only to Request for Payment." },
          { status: 400 },
        );
      }
      const meta = await initPaymentApprovalMetaIfNeeded(id);
      const gate = canMarkPaymentStepApproved({
        meta,
        actorAgentId: operator?.id ?? null,
        ticketAssignedAgentId: ticket.assignedAgentId,
      });
      if (!gate.ok) {
        return NextResponse.json({ error: gate.error }, { status: 403 });
      }
      if (!ticket.assignedAgentId) {
        return NextResponse.json(
          { error: "A ticket must be assigned to personnel before approval can be recorded." },
          { status: 400 },
        );
      }
      const step = meta.proceduralStep;
      if (step === "DONE") {
        return NextResponse.json(
          { error: "All payment approval steps are already complete." },
          { status: 400 },
        );
      }
      const uniqueness = canAssignPaymentApprover({
        meta,
        agentId: ticket.assignedAgentId,
        forStep: step,
      });
      if (!uniqueness.ok) {
        return NextResponse.json({ error: uniqueness.error }, { status: 400 });
      }
      const stepField = assigneeFieldForStep(step);
      const stamped = applyPaymentApprovalAssignees(meta, {
        [stepField]: ticket.assignedAgentId,
      });
      const approved = markPaymentStepApproved(stamped);
      const saved = await savePaymentApprovalMeta(id, approved, step);
      if (!saved.ok) {
        return NextResponse.json(
          { error: "Payment approval was updated by someone else. Refresh and try again." },
          { status: 409 },
        );
      }
      const label = PAYMENT_APPROVAL_STEP_LABELS[step];
      await logActivity(
        id,
        "AGENT",
        `Payment approved · ${label}`,
        `${label} approved. Click Done to hand off to the next role.`,
      );
      const updated = await prisma.ticket.findUnique({
        where: { id },
        include: { team: true, assignedAgent: true },
      });
      return NextResponse.json({
        ...(updated ? await ticketJsonWithAssigneeColor(updated) : {}),
        paymentApprovalMeta: approved,
      });
    }

    if (action === "update_payment_mode") {
      if (!isAdminOrAgent) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      const requestType = await loadTicketRequestType(id);
      if (requestType !== "REQUEST_FOR_PAYMENT") {
        return NextResponse.json(
          { error: "Mode of payment updates apply only to Request for Payment." },
          { status: 400 },
        );
      }
      const meta = await initPaymentApprovalMetaIfNeeded(id);
      const existing = parsePaymentRequestDescription(ticket.description);
      if (!existing) {
        return NextResponse.json(
          { error: "Could not parse payment details for this request." },
          { status: 400 },
        );
      }
      if (
        !canEditDeferredPaymentMode({
          meta,
          proceduralStep: meta.proceduralStep,
          modeOfPayment: existing.modeOfPayment,
        })
      ) {
        return NextResponse.json(
          {
            error:
              "Mode of payment can be set or edited on PREPARED BY BOOKKEEPER after Noted By and Approved By are complete (or on APPROVED BY when Bookkeeper / Accounting seats were left unset).",
          },
          { status: 400 },
        );
      }
      const adminCompanyTeamId =
        session.user.role === "Admin"
          ? await resolveStaffCompanyTeamId(session.user.email)
          : null;
      const maySetPaymentMode =
        isAssignedOperator ||
        isElevatedUserRole(session.user.role) ||
        (session.user.role === "Admin" &&
          Boolean(adminCompanyTeamId) &&
          adminCompanyTeamId === ticket.teamId);
      if (!maySetPaymentMode) {
        return NextResponse.json(
          {
            error:
              "Only the assigned personnel or an Admin for this company can set Mode of payment.",
          },
          { status: 403 },
        );
      }
      const validated = validatePaymentModeFields({
        modeOfPayment: typeof body.modeOfPayment === "string" ? body.modeOfPayment : "",
        deliveryOfCheck: typeof body.deliveryOfCheck === "string" ? body.deliveryOfCheck : "",
        bankNameAccountNumber:
          typeof body.bankNameAccountNumber === "string" ? body.bankNameAccountNumber : "",
      });
      if (!validated.ok) {
        return NextResponse.json({ error: validated.error }, { status: 400 });
      }
      const merged = applyPaymentModeToFields(existing, validated.fields);
      const description = formatPaymentRequestDescription(merged);
      const updated = await prisma.ticket.update({
        where: { id },
        data: { description },
        include: { team: true, assignedAgent: true },
      });
      await logActivity(
        id,
        "AGENT",
        "Mode of payment updated",
        [
          validated.fields.modeOfPayment,
          validated.fields.deliveryOfCheck
            ? `Delivery: ${validated.fields.deliveryOfCheck}`
            : null,
          validated.fields.bankNameAccountNumber
            ? `Bank: ${validated.fields.bankNameAccountNumber}`
            : null,
        ]
          .filter(Boolean)
          .join(" · "),
      );
      return NextResponse.json(await ticketJsonWithAssigneeColor(updated));
    }

    if (action === "complete_payment_approval_step") {
      if (!isAdminOrAgent) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      const requestType = await loadTicketRequestType(id);
      if (requestType !== "REQUEST_FOR_PAYMENT") {
        return NextResponse.json(
          { error: "Payment approval steps apply only to Request for Payment." },
          { status: 400 },
        );
      }
      const meta = await initPaymentApprovalMetaIfNeeded(id);
      const actingAsAssignee = await isSessionAssigneeOfTicket({
        operatorId: operator?.id,
        sessionEmail: session.user.email,
        ticket,
      });
      const gate = canCompletePaymentApprovalStep({
        meta,
        actorAgentId: actingAsAssignee
          ? ticket.assignedAgentId
          : (operator?.id ?? null),
        ticketAssignedAgentId: ticket.assignedAgentId,
      });
      if (!gate.ok) {
        return NextResponse.json({ error: gate.error }, { status: 403 });
      }
      if (!ticket.assignedAgentId) {
        return NextResponse.json(
          { error: "A ticket must be assigned to personnel before approval can advance." },
          { status: 400 },
        );
      }
      const previousStep = meta.proceduralStep;
      if (previousStep === "DONE") {
        return NextResponse.json(
          { error: "All payment approval steps are already complete." },
          { status: 400 },
        );
      }
      if (
        paymentStepRequiresApprovedAck(previousStep) &&
        !isPaymentStepApprovedAck(meta, previousStep)
      ) {
        return NextResponse.json(
          {
            error: `Click Approved for ${PAYMENT_APPROVAL_STEP_LABELS[previousStep]} before Done.`,
          },
          { status: 400 },
        );
      }
      if (previousStep === "APPROVED_BY_ACCOUNTING") {
        const paymentFields = parsePaymentRequestDescription(ticket.description);
        const modeCheck = validatePaymentModeFields({
          modeOfPayment: paymentFields?.modeOfPayment ?? "",
          deliveryOfCheck: paymentFields?.deliveryOfCheck ?? "",
          bankNameAccountNumber: paymentFields?.bankNameAccountNumber ?? "",
        });
        if (!modeCheck.ok) {
          return NextResponse.json(
            {
              error: `${modeCheck.error} Set Mode of payment on this request before marking Accounting Done.`,
            },
            { status: 400 },
          );
        }
      }
      const uniqueness = canAssignPaymentApprover({
        meta,
        agentId: ticket.assignedAgentId,
        forStep: previousStep,
      });
      if (!uniqueness.ok) {
        return NextResponse.json({ error: uniqueness.error }, { status: 400 });
      }
      const stepField = assigneeFieldForStep(previousStep);
      const stamped = applyPaymentApprovalAssignees(meta, {
        [stepField]: ticket.assignedAgentId,
      });
      const advanced = completePaymentApprovalStep(stamped);
      const saved = await savePaymentApprovalMeta(id, advanced, previousStep);
      if (!saved.ok) {
        return NextResponse.json(
          { error: "Payment approval was updated by someone else. Refresh and try again." },
          { status: 409 },
        );
      }
      const completedLabel = PAYMENT_APPROVAL_STEP_LABELS[previousStep];
      await logActivity(
        id,
        "AGENT",
        `Payment approval · ${completedLabel}`,
        `${completedLabel} marked complete.`,
      );

      const allDone = advanced.proceduralStep === "DONE";
      const nextAssigneeId = allDone ? null : currentPaymentStepBoardAssigneeId(advanced);
      const updated = await prisma.ticket.update({
        where: { id },
        data: allDone
          ? { status: "FOR_CONFIRMATION", resolvedAt: new Date() }
          : {
              status: "IN_PROGRESS",
              resolvedAt: null,
              ...proceduralBoardAssigneeWrite(nextAssigneeId, ticket.assignedAgentId),
            },
        include: { team: true, assignedAgent: true },
      });

      if (allDone) {
        await logActivity(
          id,
          "SYSTEM",
          "Payment approval complete",
          "All Request for Payment approval roles are complete. Sent for customer confirmation.",
        );
        await logActivity(id, "AGENT", "Status → FOR_CONFIRMATION", "All payment approvals complete.");
        await (
          await import("@/lib/request-board-columns")
        ).stampForConfirmationBoardLane(id);
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
      } else {
        const pending = paymentProceduralStatusLabel(advanced.proceduralStep);
        if (pending) {
          await logActivity(id, "SYSTEM", "Payment approval pending", pending);
        }
        await logActivity(
          id,
          "SYSTEM",
          nextAssigneeId
            ? "Assigned to next approval role"
            : "Next approval available",
          nextAssigneeId
            ? "Request moved to the next role assignee’s Request Board."
            : "Use Ticket Controls → Submit for Next Approval to send this request to the next role.",
        );
        if (ticket.status !== "IN_PROGRESS") {
          await logActivity(id, "AGENT", "Status → IN_PROGRESS", pending ?? undefined);
        }
      }

      return NextResponse.json({
        ...(await ticketJsonWithAssigneeColor(updated)),
        paymentApprovalMeta: advanced,
      });
    }

    if (action === "set_item_requisition_approval_assignees") {
      if (
        !isElevatedUserRole(session.user.role) &&
        session.user.role !== "Admin" &&
        session.user.role !== "Personnel"
      ) {
        return NextResponse.json(
          {
            error:
              "Only Admin, SuperAdmin, or Personnel can set item requisition approval roles from Ticket controls.",
          },
          { status: 403 },
        );
      }
      const requestType = await loadTicketRequestType(id);
      if (requestType !== "ITEM_REQUISITION_SLIP") {
        return NextResponse.json(
          { error: "Item requisition approval roles apply only to Item Requisition Slip." },
          { status: 400 },
        );
      }
      const meta = await initItemRequisitionApprovalMetaIfNeeded(id);
      const pickId = (v: unknown): string | null => {
        if (v === null || v === "") return null;
        return typeof v === "string" && v.trim() ? v.trim() : null;
      };
      const assignees: Partial<ItemRequisitionApprovalAssignees> = {
        canvassedByAgentId: pickId(body.canvassedByAgentId),
        approvedByAgentId: pickId(body.approvedByAgentId),
      };
      const nextAssignees: Partial<ItemRequisitionApprovalAssignees> = {};
      if ("canvassedByAgentId" in body) {
        nextAssignees.canvassedByAgentId = assignees.canvassedByAgentId ?? null;
      }
      if ("approvedByAgentId" in body) {
        nextAssignees.approvedByAgentId = assignees.approvedByAgentId ?? null;
      }

      const agentIds = Object.values(nextAssignees).filter((v): v is string => Boolean(v));
      if (agentIds.length > 0) {
        const found = await prisma.agent.findMany({
          where: { id: { in: agentIds } },
          select: { id: true, name: true },
        });
        if (found.length !== new Set(agentIds).size) {
          return NextResponse.json(
            { error: "One or more selected assignees were not found." },
            { status: 400 },
          );
        }
      }

      const updatedMeta = applyItemRequisitionApprovalAssignees(meta, nextAssignees);
      await saveItemRequisitionApprovalMeta(id, updatedMeta);
      const boardAssigneeId = currentItemRequisitionStepBoardAssigneeId(updatedMeta);
      const assigneeWrite = proceduralBoardAssigneeWrite(boardAssigneeId, ticket.assignedAgentId);
      if (Object.keys(assigneeWrite).length > 0) {
        await prisma.ticket.update({
          where: { id },
          data: {
            ...assigneeWrite,
            ...(boardAssigneeId &&
            (ticket.status === "OPEN" || ticket.status === "PENDING_INFO")
              ? { status: "IN_PROGRESS" as const }
              : {}),
            ...(boardAssigneeId ? { resolvedAt: null } : {}),
          },
        });
        await logActivity(
          id,
          "SYSTEM",
          boardAssigneeId ? "Assigned to current approval role" : "Board assignee cleared",
          boardAssigneeId
            ? "Request placed on the current procedural assignee’s Request Board."
            : "Current approval seat has no assignee — cleared the Request Board icon.",
        );
      }
      const nameById = new Map(
        (
          await prisma.agent.findMany({
            where: {
              id: {
                in: [updatedMeta.canvassedByAgentId, updatedMeta.approvedByAgentId].filter(
                  (v): v is string => Boolean(v),
                ),
              },
            },
            select: { id: true, name: true },
          })
        ).map((a) => [a.id, a.name]),
      );
      const detail = (
        Object.keys(ITEM_REQUISITION_APPROVAL_FIELD_LABELS) as Array<
          keyof ItemRequisitionApprovalAssignees
        >
      )
        .map((key) => {
          const idVal = updatedMeta[key];
          return `${ITEM_REQUISITION_APPROVAL_FIELD_LABELS[key]}: ${
            idVal ? nameById.get(idVal) ?? idVal : "Unassigned"
          }`;
        })
        .join(" · ");
      await logActivity(id, "AGENT", "Item requisition approval assignees updated", detail);
      const refreshed = await prisma.ticket.findUnique({
        where: { id },
        include: { team: true, assignedAgent: true },
      });
      return NextResponse.json({
        ...(await ticketJsonWithAssigneeColor(refreshed!)),
        itemRequisitionApprovalMeta: updatedMeta,
      });
    }

    if (action === "request_item_requisition_approval") {
      if (!canStaffMutateTicket) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      if (!isAssignedOperator && !roleIsAdmin && !roleIsCompanyAdmin) {
        return NextResponse.json(
          { error: "Only the assigned personnel can request the next item requisition approval." },
          { status: 403 },
        );
      }
      if (!operator?.id) {
        return NextResponse.json({ error: "Your staff profile could not be resolved." }, { status: 400 });
      }
      const requestType = await loadTicketRequestType(id);
      if (requestType !== "ITEM_REQUISITION_SLIP") {
        return NextResponse.json(
          { error: "Item requisition approval applies only to Item Requisition Slip." },
          { status: 400 },
        );
      }
      const meta = await initItemRequisitionApprovalMetaIfNeeded(id);
      if (meta.proceduralStep === "DONE") {
        return NextResponse.json(
          { error: "All item requisition approval steps are already complete." },
          { status: 400 },
        );
      }
      const step = meta.proceduralStep;
      if (step !== "APPROVED_BY") {
        return NextResponse.json(
          {
            error:
              "Assign Canvassed By on the Assignment Board first. After pricing is saved, select who will Approve.",
          },
          { status: 400 },
        );
      }
      const approverId =
        typeof body.approverAgentId === "string" && body.approverAgentId.trim()
          ? body.approverAgentId.trim()
          : null;
      if (!approverId) {
        return NextResponse.json(
          { error: "Select a company user to Approve this request." },
          { status: 400 },
        );
      }
      const companyAnchorId = ticket.assignedAgentId ?? operator.id;
      const requesterCompanyId = await resolveAgentDesignatedCompanyId(companyAnchorId);
      const approverCompanyId = await resolveAgentDesignatedCompanyId(approverId);
      if (!requesterCompanyId || !approverCompanyId || requesterCompanyId !== approverCompanyId) {
        return NextResponse.json(
          { error: "You can only request approval from users in the same company as this request." },
          { status: 403 },
        );
      }
      const approver = await prisma.agent.findUnique({
        where: { id: approverId },
        select: { id: true, name: true },
      });
      if (!approver) {
        return NextResponse.json({ error: "Selected user was not found." }, { status: 400 });
      }
      const field = itemRequisitionAssigneeFieldForStep(step);
      const updatedMeta = applyItemRequisitionApprovalAssignees(meta, { [field]: approver.id });
      await saveItemRequisitionApprovalMeta(id, updatedMeta);
      const updated = await prisma.ticket.update({
        where: { id },
        data: {
          status: "IN_PROGRESS",
          resolvedAt: null,
          assignedAgent: { connect: { id: approver.id } },
        },
        include: { team: true, assignedAgent: true },
      });
      await logActivity(
        id,
        "AGENT",
        "Approved By assigned",
        `${approver.name} assigned as Approved By by the Canvassed By assignee.`,
      );
      const pending = itemRequisitionProceduralStatusLabel(updatedMeta.proceduralStep);
      if (pending) {
        await logActivity(id, "SYSTEM", "Item requisition approval pending", pending);
      }
      return NextResponse.json({
        ...(await ticketJsonWithAssigneeColor(updated)),
        itemRequisitionApprovalMeta: updatedMeta,
      });
    }

    if (action === "update_item_requisition_pricing") {
      if (!isAdminOrAgent) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      const requestType = await loadTicketRequestType(id);
      if (requestType !== "ITEM_REQUISITION_SLIP") {
        return NextResponse.json(
          { error: "Pricing updates apply only to Item Requisition Slip." },
          { status: 400 },
        );
      }
      if (!ticket.assignedAgentId || operator?.id !== ticket.assignedAgentId) {
        return NextResponse.json(
          { error: "Only the assigned personnel can fill price quotation, unit price, and total." },
          { status: 403 },
        );
      }
      const existing = parseItemRequisitionDescription(ticket.description);
      if (!existing) {
        return NextResponse.json(
          { error: "Could not parse requisition details for this request." },
          { status: 400 },
        );
      }
      const pricingRows = parseRequisitionItemsPayload(body.items);
      if (pricingRows.length !== existing.items.length) {
        return NextResponse.json(
          { error: "Pricing rows must match the existing requisition line items." },
          { status: 400 },
        );
      }
      const merged = existing.items.map((item, index) => {
        const row = pricingRows[index]!;
        return applyRequisitionPricingDerivedFields({
          ...item,
          priceQuotation: (row.priceQuotation ?? "").trim(),
          unitPrice: (row.unitPrice ?? "").trim(),
          total: (row.total ?? "").trim(),
          nameOfSupplier: (row.nameOfSupplier ?? "").trim(),
          terms: (row.terms ?? "").trim(),
        });
      });
      const pricingOk = validateItemRequisitionPricing(merged);
      if (!pricingOk.ok) {
        return NextResponse.json({ error: pricingOk.error }, { status: 400 });
      }
      const description = formatItemRequisitionDescription({
        items: merged,
        purposeOfRequest: existing.purposeOfRequest,
      });

      const meta = await initItemRequisitionApprovalMetaIfNeeded(id);
      const completingCanvass = meta.proceduralStep === "CANVASSED_BY";

      if (completingCanvass) {
        const gate = canCompleteItemRequisitionApprovalStep({
          meta,
          actorAgentId: operator?.id ?? null,
          ticketAssignedAgentId: ticket.assignedAgentId,
        });
        if (!gate.ok) {
          return NextResponse.json({ error: gate.error }, { status: 403 });
        }
        const stamped = applyItemRequisitionApprovalAssignees(meta, {
          canvassedByAgentId: ticket.assignedAgentId,
        });
        let advanced = completeItemRequisitionApprovalStep(stamped);

        // Approved By comes from the requestor's company position when not already set.
        if (!advanced.approvedByAgentId) {
          const requestorCompanyId =
            ticket.teamId ??
            (await resolveStaffCompanyTeamId(ticket.contactEmail)) ??
            null;
          const requestorMergedSourceUserId = await resolveMergedSourceUserIdForSessionEmail(
            ticket.contactEmail,
          );
          const approvedByAgentId = await resolveAgentIdForPositionCode({
            code: "RS_APPROVED_BY",
            companyTeamId: requestorCompanyId,
            requestorMergedSourceUserId,
          });
          if (approvedByAgentId) {
            advanced = applyItemRequisitionApprovalAssignees(advanced, { approvedByAgentId });
          }
        }

        await saveItemRequisitionApprovalMeta(id, advanced);
        const nextBoardAssigneeId =
          advanced.approvedByAgentId ?? currentItemRequisitionStepBoardAssigneeId(advanced);
        const updated = await prisma.ticket.update({
          where: { id },
          data: {
            description,
            status: "IN_PROGRESS",
            resolvedAt: null,
            ...proceduralBoardAssigneeWrite(nextBoardAssigneeId, ticket.assignedAgentId),
          },
          include: { team: true, assignedAgent: true },
        });
        await logActivity(
          id,
          "AGENT",
          "Requisition pricing updated",
          "Price quotation, supplier, terms, unit price, and total saved by assignee.",
        );
        await logActivity(
          id,
          "AGENT",
          `Item requisition approval · ${ITEM_REQUISITION_APPROVAL_STEP_LABELS.CANVASSED_BY}`,
          `${ITEM_REQUISITION_APPROVAL_STEP_LABELS.CANVASSED_BY} completed by saving pricing.`,
        );
        const pending = itemRequisitionProceduralStatusLabel(advanced.proceduralStep);
        if (pending) {
          await logActivity(id, "SYSTEM", "Item requisition approval pending", pending);
        }
        if (advanced.approvedByAgentId) {
          await logActivity(
            id,
            "SYSTEM",
            "Assigned to Approved By",
            "Approved By is taken from the requestor’s company. Request moved to that assignee’s board.",
          );
        } else {
          await logActivity(
            id,
            "SYSTEM",
            "Next approval available",
            "No Approved By position found for the requestor’s company. Use Ticket Controls → Select Approved By.",
          );
        }
        return NextResponse.json({
          ...(await ticketJsonWithAssigneeColor(updated)),
          itemRequisitionApprovalMeta: advanced,
        });
      }

      const updated = await prisma.ticket.update({
        where: { id },
        data: { description },
        include: { team: true, assignedAgent: true },
      });
      await logActivity(
        id,
        "AGENT",
        "Requisition pricing updated",
        "Price quotation, supplier, terms, unit price, and total saved by assignee.",
      );
      return NextResponse.json(await ticketJsonWithAssigneeColor(updated));
    }

    if (action === "undo_item_requisition_canvass") {
      if (!isElevatedUserRole(session.user.role)) {
        return NextResponse.json(
          { error: "Only SuperAdmin can undo Canvassed By." },
          { status: 403 },
        );
      }
      const requestType = await loadTicketRequestType(id);
      if (requestType !== "ITEM_REQUISITION_SLIP") {
        return NextResponse.json(
          { error: "Undo Canvassed By applies only to Item Requisition Slip." },
          { status: 400 },
        );
      }
      const meta = await initItemRequisitionApprovalMetaIfNeeded(id);
      const undone = undoItemRequisitionCanvass(meta);
      if (!undone.ok) {
        return NextResponse.json({ error: undone.error }, { status: 400 });
      }
      await saveItemRequisitionApprovalMeta(id, undone.meta);
      const refreshed = await prisma.ticket.update({
        where: { id },
        data: { status: "IN_PROGRESS", resolvedAt: null },
        include: { team: true, assignedAgent: true },
      });
      await logActivity(
        id,
        "AGENT",
        "Canvassed By undone",
        "SuperAdmin cleared Canvassed By. Request returned to CANVASSED BY IS MISSING.",
      );
      const pending = itemRequisitionProceduralStatusLabel(undone.meta.proceduralStep);
      if (pending) {
        await logActivity(id, "SYSTEM", "Item requisition approval pending", pending);
      }
      return NextResponse.json({
        ...(await ticketJsonWithAssigneeColor(refreshed)),
        itemRequisitionApprovalMeta: undone.meta,
      });
    }

    if (action === "complete_item_requisition_approval_step") {
      if (!isAdminOrAgent) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      const requestType = await loadTicketRequestType(id);
      if (requestType !== "ITEM_REQUISITION_SLIP") {
        return NextResponse.json(
          { error: "Item requisition approval steps apply only to Item Requisition Slip." },
          { status: 400 },
        );
      }
      const meta = await initItemRequisitionApprovalMetaIfNeeded(id);
      if (meta.proceduralStep === "CANVASSED_BY") {
        return NextResponse.json(
          {
            error:
              "Canvassed By completes automatically when the assignee saves pricing. Use Save pricing instead.",
          },
          { status: 400 },
        );
      }
      const gate = canCompleteItemRequisitionApprovalStep({
        meta,
        actorAgentId: operator?.id ?? null,
        ticketAssignedAgentId: ticket.assignedAgentId,
      });
      if (!gate.ok) {
        return NextResponse.json({ error: gate.error }, { status: 403 });
      }
      if (!ticket.assignedAgentId) {
        return NextResponse.json(
          { error: "A ticket must be assigned to personnel before approval can advance." },
          { status: 400 },
        );
      }

      // Persist pricing/supplier from the complete payload when provided.
      if (Array.isArray(body.items)) {
        const existing = parseItemRequisitionDescription(ticket.description);
        if (existing) {
          const pricingRows = parseRequisitionItemsPayload(body.items);
          if (pricingRows.length === existing.items.length) {
            const merged = existing.items.map((item, index) => {
              const row = pricingRows[index]!;
              return applyRequisitionPricingDerivedFields({
                ...item,
                priceQuotation: (row.priceQuotation ?? "").trim(),
                unitPrice: (row.unitPrice ?? "").trim(),
                total: (row.total ?? "").trim(),
                nameOfSupplier: (row.nameOfSupplier ?? "").trim(),
                terms: (row.terms ?? "").trim(),
              });
            });
            const pricingOk = validateItemRequisitionPricing(merged);
            if (!pricingOk.ok) {
              return NextResponse.json({ error: pricingOk.error }, { status: 400 });
            }
            await prisma.ticket.update({
              where: { id },
              data: {
                description: formatItemRequisitionDescription({
                  items: merged,
                  purposeOfRequest: existing.purposeOfRequest,
                }),
              },
            });
          }
        }
      }

      const previousStep = meta.proceduralStep;
      if (previousStep === "DONE") {
        return NextResponse.json(
          { error: "All item requisition approval steps are already complete." },
          { status: 400 },
        );
      }
      const stepField = itemRequisitionAssigneeFieldForStep(previousStep);
      const stamped = applyItemRequisitionApprovalAssignees(meta, {
        [stepField]: ticket.assignedAgentId,
      });
      const advanced = completeItemRequisitionApprovalStep(stamped);
      await saveItemRequisitionApprovalMeta(id, advanced);
      const completedLabel = ITEM_REQUISITION_APPROVAL_STEP_LABELS[previousStep];
      await logActivity(
        id,
        "AGENT",
        `Item requisition approval · ${completedLabel}`,
        `${completedLabel} marked complete.`,
      );

      const allDone = advanced.proceduralStep === "DONE";
      const nextAssigneeId = allDone ? null : currentItemRequisitionStepBoardAssigneeId(advanced);
      const updated = await prisma.ticket.update({
        where: { id },
        data: allDone
          ? { status: "FOR_CONFIRMATION", resolvedAt: new Date() }
          : {
              status: "IN_PROGRESS",
              resolvedAt: null,
              ...proceduralBoardAssigneeWrite(nextAssigneeId, ticket.assignedAgentId),
            },
        include: { team: true, assignedAgent: true },
      });

      if (allDone) {
        await logActivity(
          id,
          "SYSTEM",
          "Item requisition approval complete",
          "All Item Requisition Slip approval roles are complete. Sent for customer confirmation.",
        );
        await logActivity(
          id,
          "AGENT",
          "Status → FOR_CONFIRMATION",
          "All item requisition approvals complete.",
        );
        await (
          await import("@/lib/request-board-columns")
        ).stampForConfirmationBoardLane(id);
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
      } else {
        const pending = itemRequisitionProceduralStatusLabel(advanced.proceduralStep);
        if (pending) {
          await logActivity(id, "SYSTEM", "Item requisition approval pending", pending);
        }
        await logActivity(
          id,
          "SYSTEM",
          "Next approval available",
          "Use Ticket Controls → Request approval to send this request to the next role.",
        );
        if (ticket.status !== "IN_PROGRESS") {
          await logActivity(id, "AGENT", "Status → IN_PROGRESS", pending ?? undefined);
        }
      }

      return NextResponse.json({
        ...(await ticketJsonWithAssigneeColor(updated)),
        itemRequisitionApprovalMeta: advanced,
      });
    }

    if (action === "set_fund_transfer_approval_assignees") {
      if (
        !isElevatedUserRole(session.user.role) &&
        session.user.role !== "Admin" &&
        session.user.role !== "Personnel"
      ) {
        return NextResponse.json(
          {
            error:
              "Only Admin, SuperAdmin, or Personnel can set fund transfer approval roles from Ticket controls.",
          },
          { status: 403 },
        );
      }
      const requestType = await loadTicketRequestType(id);
      if (requestType !== "FUND_TRANSFER_REQUEST") {
        return NextResponse.json(
          { error: "Fund transfer approval roles apply only to Fund Transfer Request." },
          { status: 400 },
        );
      }
      const meta = await initFundTransferApprovalMetaIfNeeded(id);
      const pickId = (v: unknown): string | null => {
        if (v === null || v === "") return null;
        return typeof v === "string" && v.trim() ? v.trim() : null;
      };
      const assignees: Partial<FundTransferApprovalAssignees> = {
        preparedByAgentId: pickId(body.preparedByAgentId),
        recommendingApprovalAgentId: pickId(body.recommendingApprovalAgentId),
        approvedByAgentId: pickId(body.approvedByAgentId),
      };
      const nextAssignees: Partial<FundTransferApprovalAssignees> = {};
      if ("preparedByAgentId" in body) nextAssignees.preparedByAgentId = assignees.preparedByAgentId ?? null;
      if ("recommendingApprovalAgentId" in body) {
        nextAssignees.recommendingApprovalAgentId = assignees.recommendingApprovalAgentId ?? null;
      }
      if ("approvedByAgentId" in body) nextAssignees.approvedByAgentId = assignees.approvedByAgentId ?? null;

      const agentIds = Object.values(nextAssignees).filter((v): v is string => Boolean(v));
      if (agentIds.length > 0) {
        const found = await prisma.agent.findMany({
          where: { id: { in: agentIds } },
          select: { id: true, name: true },
        });
        if (found.length !== new Set(agentIds).size) {
          return NextResponse.json({ error: "One or more selected assignees were not found." }, { status: 400 });
        }
      }

      const updatedMeta = applyFundTransferApprovalAssignees(meta, nextAssignees);
      await saveFundTransferApprovalMeta(id, updatedMeta);
      const boardAssigneeId = currentFundTransferStepBoardAssigneeId(updatedMeta);
      const assigneeWrite = proceduralBoardAssigneeWrite(boardAssigneeId, ticket.assignedAgentId);
      if (Object.keys(assigneeWrite).length > 0) {
        await prisma.ticket.update({
          where: { id },
          data: {
            ...assigneeWrite,
            ...(boardAssigneeId &&
            (ticket.status === "OPEN" || ticket.status === "PENDING_INFO")
              ? { status: "IN_PROGRESS" as const }
              : {}),
            ...(boardAssigneeId ? { resolvedAt: null } : {}),
          },
        });
        await logActivity(
          id,
          "SYSTEM",
          boardAssigneeId ? "Assigned to current approval role" : "Board assignee cleared",
          boardAssigneeId
            ? "Request placed on the current procedural assignee’s Request Board."
            : "Current approval seat has no assignee — cleared the Request Board icon.",
        );
      }
      const nameById = new Map(
        (
          await prisma.agent.findMany({
            where: {
              id: {
                in: [
                  updatedMeta.preparedByAgentId,
                  updatedMeta.recommendingApprovalAgentId,
                  updatedMeta.approvedByAgentId,
                ].filter((v): v is string => Boolean(v)),
              },
            },
            select: { id: true, name: true },
          })
        ).map((a) => [a.id, a.name]),
      );
      const detail = (
        Object.keys(FUND_TRANSFER_APPROVAL_FIELD_LABELS) as Array<keyof FundTransferApprovalAssignees>
      )
        .map((key) => {
          const idVal = updatedMeta[key];
          return `${FUND_TRANSFER_APPROVAL_FIELD_LABELS[key]}: ${
            idVal ? nameById.get(idVal) ?? idVal : "Unassigned"
          }`;
        })
        .join(" · ");
      await logActivity(id, "AGENT", "Fund transfer approval assignees updated", detail);
      const refreshed = await prisma.ticket.findUnique({
        where: { id },
        include: { team: true, assignedAgent: true },
      });
      return NextResponse.json({
        ...(await ticketJsonWithAssigneeColor(refreshed!)),
        fundTransferApprovalMeta: updatedMeta,
      });
    }

    if (action === "request_fund_transfer_approval") {
      if (!canStaffMutateTicket) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      if (!isAssignedOperator && !roleIsAdmin && !roleIsCompanyAdmin) {
        return NextResponse.json(
          { error: "Only the assigned personnel can request the next fund transfer approval." },
          { status: 403 },
        );
      }
      if (!operator?.id) {
        return NextResponse.json({ error: "Your staff profile could not be resolved." }, { status: 400 });
      }
      const requestType = await loadTicketRequestType(id);
      if (requestType !== "FUND_TRANSFER_REQUEST") {
        return NextResponse.json(
          { error: "Fund transfer approval applies only to Fund Transfer Request." },
          { status: 400 },
        );
      }
      const meta = await initFundTransferApprovalMetaIfNeeded(id);
      if (meta.proceduralStep === "DONE") {
        return NextResponse.json({ error: "All fund transfer approval steps are already complete." }, { status: 400 });
      }
      const step = meta.proceduralStep;
      const approverId =
        typeof body.approverAgentId === "string" && body.approverAgentId.trim()
          ? body.approverAgentId.trim()
          : null;
      if (!approverId) {
        return NextResponse.json({ error: "Select a company user to request approval from." }, { status: 400 });
      }
      const companyAnchorId = ticket.assignedAgentId ?? operator.id;
      const requesterCompanyId = await resolveAgentDesignatedCompanyId(companyAnchorId);
      const approverCompanyId = await resolveAgentDesignatedCompanyId(approverId);
      if (!requesterCompanyId || !approverCompanyId || requesterCompanyId !== approverCompanyId) {
        return NextResponse.json(
          { error: "You can only request approval from users in the same company as this request." },
          { status: 403 },
        );
      }
      const approver = await prisma.agent.findUnique({
        where: { id: approverId },
        select: { id: true, name: true },
      });
      if (!approver) {
        return NextResponse.json({ error: "Selected user was not found." }, { status: 400 });
      }
      const field = fundTransferAssigneeFieldForStep(step);
      const updatedMeta = applyFundTransferApprovalAssignees(meta, { [field]: approver.id });
      await saveFundTransferApprovalMeta(id, updatedMeta);
      const updated = await prisma.ticket.update({
        where: { id },
        data: {
          status: "IN_PROGRESS",
          resolvedAt: null,
          assignedAgent: { connect: { id: approver.id } },
        },
        include: { team: true, assignedAgent: true },
      });
      await logActivity(
        id,
        "AGENT",
        `Approval requested · ${FUND_TRANSFER_APPROVAL_STEP_LABELS[step]}`,
        `Requested ${FUND_TRANSFER_APPROVAL_STEP_LABELS[step]} from ${approver.name}. Assigned for next step.`,
      );
      const pending = fundTransferProceduralStatusLabel(updatedMeta.proceduralStep);
      if (pending) {
        await logActivity(id, "SYSTEM", "Fund transfer approval pending", pending);
      }
      return NextResponse.json({
        ...(await ticketJsonWithAssigneeColor(updated)),
        fundTransferApprovalMeta: updatedMeta,
      });
    }

    if (action === "complete_fund_transfer_approval_step") {
      if (!isAdminOrAgent) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      const requestType = await loadTicketRequestType(id);
      if (requestType !== "FUND_TRANSFER_REQUEST") {
        return NextResponse.json(
          { error: "Fund transfer approval steps apply only to Fund Transfer Request." },
          { status: 400 },
        );
      }
      const meta = await initFundTransferApprovalMetaIfNeeded(id);
      const gate = canCompleteFundTransferApprovalStep({
        meta,
        actorAgentId: operator?.id ?? null,
        ticketAssignedAgentId: ticket.assignedAgentId,
      });
      if (!gate.ok) {
        return NextResponse.json({ error: gate.error }, { status: 403 });
      }
      if (!ticket.assignedAgentId) {
        return NextResponse.json(
          { error: "A ticket must be assigned to personnel before approval can advance." },
          { status: 400 },
        );
      }
      const previousStep = meta.proceduralStep;
      if (previousStep === "DONE") {
        return NextResponse.json(
          { error: "All fund transfer approval steps are already complete." },
          { status: 400 },
        );
      }
      const stepField = fundTransferAssigneeFieldForStep(previousStep);
      const stamped = applyFundTransferApprovalAssignees(meta, {
        [stepField]: ticket.assignedAgentId,
      });
      const advanced = completeFundTransferApprovalStep(stamped);
      await saveFundTransferApprovalMeta(id, advanced);
      const completedLabel = FUND_TRANSFER_APPROVAL_STEP_LABELS[previousStep];
      await logActivity(
        id,
        "AGENT",
        `Fund transfer approval · ${completedLabel}`,
        `${completedLabel} marked complete.`,
      );

      const allDone = advanced.proceduralStep === "DONE";
      const nextAssigneeId = allDone ? null : currentFundTransferStepBoardAssigneeId(advanced);
      const updated = await prisma.ticket.update({
        where: { id },
        data: allDone
          ? { status: "FOR_CONFIRMATION", resolvedAt: new Date() }
          : {
              status: "IN_PROGRESS",
              resolvedAt: null,
              ...proceduralBoardAssigneeWrite(nextAssigneeId, ticket.assignedAgentId),
            },
        include: { team: true, assignedAgent: true },
      });

      if (allDone) {
        await logActivity(
          id,
          "SYSTEM",
          "Fund transfer approval complete",
          "All Fund Transfer Request approval roles are complete. Sent for customer confirmation.",
        );
        await logActivity(
          id,
          "AGENT",
          "Status → FOR_CONFIRMATION",
          "All fund transfer approvals complete.",
        );
        await (
          await import("@/lib/request-board-columns")
        ).stampForConfirmationBoardLane(id);
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
      } else {
        const pending = fundTransferProceduralStatusLabel(advanced.proceduralStep);
        if (pending) {
          await logActivity(id, "SYSTEM", "Fund transfer approval pending", pending);
        }
        await logActivity(
          id,
          "SYSTEM",
          "Next approval available",
          "Use Ticket Controls → Request approval to send this request to the next role.",
        );
        if (ticket.status !== "IN_PROGRESS") {
          await logActivity(id, "AGENT", "Status → IN_PROGRESS", pending ?? undefined);
        }
      }

      return NextResponse.json({
        ...(await ticketJsonWithAssigneeColor(updated)),
        fundTransferApprovalMeta: advanced,
      });
    }

    if (action === "set_job_order_approval_assignees") {
      if (
        !isElevatedUserRole(session.user.role) &&
        session.user.role !== "Admin" &&
        session.user.role !== "Personnel"
      ) {
        return NextResponse.json(
          {
            error:
              "Only Admin, SuperAdmin, or Personnel can set job order approval roles from Ticket controls.",
          },
          { status: 403 },
        );
      }
      const requestType = await loadTicketRequestType(id);
      if (requestType !== "JOB_ORDER") {
        return NextResponse.json(
          { error: "Job order approval assignees apply only to Job Order." },
          { status: 400 },
        );
      }
      const meta = await initJobOrderApprovalMetaIfNeeded(id);
      const pickId = (v: unknown): string | null => {
        if (v === null || v === "") return null;
        return typeof v === "string" && v.trim() ? v.trim() : null;
      };
      const nextAssignees: Partial<JobOrderApprovalAssignees> = {};
      if ("notedByAgentId" in body) nextAssignees.notedByAgentId = pickId(body.notedByAgentId);
      if ("approvedByAgentId" in body) nextAssignees.approvedByAgentId = pickId(body.approvedByAgentId);
      if ("approvedBy2AgentId" in body) nextAssignees.approvedBy2AgentId = pickId(body.approvedBy2AgentId);
      if ("preparedByAgentId" in body) nextAssignees.preparedByAgentId = pickId(body.preparedByAgentId);
      const agentIds = Object.values(nextAssignees).filter((v): v is string => Boolean(v));
      if (agentIds.length > 0) {
        const found = await prisma.agent.findMany({
          where: { id: { in: agentIds } },
          select: { id: true },
        });
        if (found.length !== new Set(agentIds).size) {
          return NextResponse.json(
            { error: "One or more selected assignees were not found." },
            { status: 400 },
          );
        }
      }
      const updatedMeta = applyJobOrderApprovalAssignees(meta, nextAssignees);
      await saveJobOrderApprovalMeta(id, updatedMeta);
      // Post-approval: board assignee is the execution assignee — do not clear via procedural sync.
      if (updatedMeta.proceduralStep !== "DONE") {
        const boardAssigneeId = currentJobOrderStepBoardAssigneeId(updatedMeta);
        const assigneeWrite = proceduralBoardAssigneeWrite(boardAssigneeId, ticket.assignedAgentId);
        if (Object.keys(assigneeWrite).length > 0) {
          await prisma.ticket.update({
            where: { id },
            data: {
              ...assigneeWrite,
              ...(boardAssigneeId &&
              (ticket.status === "OPEN" || ticket.status === "PENDING_INFO")
                ? { status: "IN_PROGRESS" as const }
                : {}),
              ...(boardAssigneeId ? { resolvedAt: null } : {}),
            },
          });
          await logActivity(
            id,
            "SYSTEM",
            boardAssigneeId ? "Assigned to current approval role" : "Board assignee cleared",
            boardAssigneeId
              ? "Request placed on the current procedural assignee’s Request Board."
              : "Current approval seat has no assignee — cleared the Request Board icon.",
          );
        }
      }
      const nameById = new Map(
        (
          await prisma.agent.findMany({
            where: {
              id: {
                in: [
                  updatedMeta.preparedByAgentId,
                  updatedMeta.notedByAgentId,
                  updatedMeta.approvedByAgentId,
                  updatedMeta.approvedBy2AgentId,
                ].filter((v): v is string => Boolean(v)),
              },
            },
            select: { id: true, name: true },
          })
        ).map((a) => [a.id, a.name]),
      );
      const detail = (
        Object.keys(JOB_ORDER_APPROVAL_FIELD_LABELS) as Array<keyof JobOrderApprovalAssignees>
      )
        .map((key) => {
          const idVal = updatedMeta[key];
          return `${JOB_ORDER_APPROVAL_FIELD_LABELS[key]}: ${
            idVal ? nameById.get(idVal) ?? idVal : "Unassigned"
          }`;
        })
        .join(" · ");
      await logActivity(id, "AGENT", "Job order approval assignees updated", detail);
      const refreshed = await prisma.ticket.findUnique({
        where: { id },
        include: { team: true, assignedAgent: true },
      });
      return NextResponse.json({
        ...(await ticketJsonWithAssigneeColor(refreshed!)),
        jobOrderApprovalMeta: updatedMeta,
      });
    }

    if (action === "request_job_order_approval") {
      if (!canStaffMutateTicket) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      if (!isAssignedOperator && !roleIsAdmin && !roleIsCompanyAdmin) {
        return NextResponse.json(
          { error: "Only the assigned personnel can request the next job order approval." },
          { status: 403 },
        );
      }
      if (!operator?.id) {
        return NextResponse.json({ error: "Your staff profile could not be resolved." }, { status: 400 });
      }
      const requestType = await loadTicketRequestType(id);
      if (requestType !== "JOB_ORDER") {
        return NextResponse.json(
          { error: "Job order approval applies only to Job Order." },
          { status: 400 },
        );
      }
      const meta = await initJobOrderApprovalMetaIfNeeded(id);
      if (meta.proceduralStep === "DONE") {
        return NextResponse.json({ error: "All job order approval steps are already complete." }, { status: 400 });
      }
      const step = meta.proceduralStep;
      const approverId =
        typeof body.approverAgentId === "string" && body.approverAgentId.trim()
          ? body.approverAgentId.trim()
          : null;
      if (!approverId) {
        return NextResponse.json({ error: "Select a user to request approval from." }, { status: 400 });
      }
      const approver = await prisma.agent.findUnique({
        where: { id: approverId },
        select: { id: true, name: true },
      });
      if (!approver) {
        return NextResponse.json({ error: "Selected user was not found." }, { status: 400 });
      }
      const field = jobOrderAssigneeFieldForStep(step);
      const updatedMeta = applyJobOrderApprovalAssignees(meta, { [field]: approver.id });
      await saveJobOrderApprovalMeta(id, updatedMeta);
      const updated = await prisma.ticket.update({
        where: { id },
        data: {
          status: "IN_PROGRESS",
          resolvedAt: null,
          assignedAgent: { connect: { id: approver.id } },
        },
        include: { team: true, assignedAgent: true },
      });
      await logActivity(
        id,
        "AGENT",
        `Approval requested · ${JOB_ORDER_APPROVAL_STEP_LABELS[step]}`,
        `Requested ${JOB_ORDER_APPROVAL_STEP_LABELS[step]} from ${approver.name}. Assigned for next step.`,
      );
      const pending = jobOrderProceduralStatusLabel(updatedMeta.proceduralStep);
      if (pending) {
        await logActivity(id, "SYSTEM", "Job order approval pending", pending);
      }
      return NextResponse.json({
        ...(await ticketJsonWithAssigneeColor(updated)),
        jobOrderApprovalMeta: updatedMeta,
      });
    }

    if (action === "complete_job_order_approval_step") {
      if (!isAdminOrAgent) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      const requestType = await loadTicketRequestType(id);
      if (requestType !== "JOB_ORDER") {
        return NextResponse.json(
          { error: "Job order approval steps apply only to Job Order." },
          { status: 400 },
        );
      }
      const meta = await initJobOrderApprovalMetaIfNeeded(id);
      const hasJobOutput = hasJobOrderJobOutputUploaded(
        parseIntakeScreenshotMeta(ticket.intakeScreenshotMeta),
      );
      const gate = canCompleteJobOrderApprovalStep({
        meta,
        actorAgentId: operator?.id ?? null,
        ticketAssignedAgentId: ticket.assignedAgentId,
        hasJobOutput,
        hasJobDone: isJobOrderJobDone(meta),
      });
      if (!gate.ok) {
        return NextResponse.json({ error: gate.error }, { status: 403 });
      }
      if (!ticket.assignedAgentId) {
        return NextResponse.json(
          { error: "A ticket must be assigned to personnel before approval can advance." },
          { status: 400 },
        );
      }
      const previousStep = meta.proceduralStep;
      if (previousStep === "DONE") {
        return NextResponse.json(
          { error: "All job order approval steps are already complete." },
          { status: 400 },
        );
      }
      const stepField = jobOrderAssigneeFieldForStep(previousStep);
      const stamped = applyJobOrderApprovalAssignees(meta, {
        [stepField]: ticket.assignedAgentId,
      });
      let advanced = clearJobOrderExecutionAssignment(
        completeJobOrderApprovalStep(stamped),
      );

      const allDone = advanced.proceduralStep === "DONE";
      let boardAssigneeId = currentJobOrderStepBoardAssigneeId(advanced);
      let promotedExecutionAgentId: string | null = null;
      if (allDone) {
        const promoted = promoteJobOrderPendingExecutionAssignee(advanced);
        advanced = promoted.meta;
        promotedExecutionAgentId = promoted.agentId;
        if (promotedExecutionAgentId) {
          boardAssigneeId = promotedExecutionAgentId;
        }
      }

      await saveJobOrderApprovalMeta(id, advanced);
      const completedLabel = JOB_ORDER_APPROVAL_STEP_LABELS[previousStep];
      await logActivity(
        id,
        "AGENT",
        `Job order approval · ${completedLabel}`,
        `${completedLabel} marked complete.`,
      );

      const sendForConfirmation = isJobOrderReadyForConfirmation(advanced);
      const assigneeWrite = proceduralBoardAssigneeWrite(boardAssigneeId, ticket.assignedAgentId);
      const updated = await prisma.ticket.update({
        where: { id },
        data: {
          status: sendForConfirmation ? "FOR_CONFIRMATION" : "IN_PROGRESS",
          resolvedAt: sendForConfirmation ? new Date() : null,
          ...assigneeWrite,
        },
        include: { team: true, assignedAgent: true },
      });

      if (allDone) {
        if (promotedExecutionAgentId) {
          const promotedAgent = await prisma.agent.findUnique({
            where: { id: promotedExecutionAgentId },
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
        }
      }

      if (sendForConfirmation) {
        await logActivity(id, "AGENT", "Status → FOR_CONFIRMATION", "Approved By complete after Job Done.");
        await (
          await import("@/lib/request-board-columns")
        ).stampForConfirmationBoardLane(id);
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

      return NextResponse.json({
        ...(await ticketJsonWithAssigneeColor(updated)),
        jobOrderApprovalMeta: advanced,
      });
    }

    if (action === "complete_aca_approval_step") {
      if (!isAdminOrAgent) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      const requestType = await loadTicketRequestType(id);
      if (requestType !== "AUTHORITY_TO_CONDUCT_ACTIVITY") {
        return NextResponse.json(
          { error: "ACA approval steps apply only to Authority to Conduct Activity." },
          { status: 400 },
        );
      }
      const meta = await loadAcaApprovalMeta(id);
      if (!meta) {
        return NextResponse.json({ error: "ACA approval metadata was not found." }, { status: 400 });
      }
      const gate = canCompleteAcaApprovalStep({
        meta,
        actorAgentId: operator?.id ?? null,
        ticketAssignedAgentId: ticket.assignedAgentId,
      });
      if (!gate.ok) {
        return NextResponse.json({ error: gate.error }, { status: 403 });
      }
      if (!ticket.assignedAgentId) {
        return NextResponse.json(
          { error: "A ticket must be assigned to personnel before approval can advance." },
          { status: 400 },
        );
      }
      const previousStep = meta.proceduralStep;
      if (previousStep === "DONE") {
        return NextResponse.json(
          { error: "All ACA approval steps are already complete." },
          { status: 400 },
        );
      }
      const comment =
        typeof body.comment === "string" && body.comment.trim() ? body.comment.trim() : null;
      const completingLevel = meta.levels.find((l) => l.key === previousStep);
      if (acaLevelRequiresFeedback(completingLevel?.roleCode) && !comment) {
        return NextResponse.json(
          {
            error:
              "Feedback is required before approving this ACA seat (AP 4 / 4 ExeComs / All ExeCom).",
          },
          { status: 400 },
        );
      }
      const advanced = completeAcaApprovalStep(meta, { comment });
      const saved = await saveAcaApprovalMeta(id, advanced, previousStep);
      if (!saved.ok) {
        return NextResponse.json(
          { error: "ACA approval was updated by someone else. Refresh and try again." },
          { status: 409 },
        );
      }
      const completedLevel = meta.levels.find((l) => l.key === previousStep);
      const completedLabel = completedLevel?.label ?? previousStep;
      await logActivity(
        id,
        "AGENT",
        `ACA approval · ${completedLabel}`,
        comment
          ? `${completedLabel} marked complete. Comment: ${comment}`
          : `${completedLabel} marked complete.`,
      );

      const allDone = advanced.proceduralStep === "DONE";
      const nextAssigneeId = allDone ? null : currentAcaBoardAssigneeId(advanced);
      const updated = await prisma.ticket.update({
        where: { id },
        data: allDone
          ? { status: "FOR_CONFIRMATION", resolvedAt: new Date() }
          : {
              status: "IN_PROGRESS",
              resolvedAt: null,
              ...proceduralBoardAssigneeWrite(nextAssigneeId, ticket.assignedAgentId),
            },
        include: { team: true, assignedAgent: true },
      });

      if (allDone) {
        await logActivity(
          id,
          "SYSTEM",
          "ACA approval complete",
          "All Authority to Conduct Activity approval seats are complete. Sent for customer confirmation.",
        );
        await logActivity(id, "AGENT", "Status → FOR_CONFIRMATION", "All ACA approvals complete.");
        const smtpRecipient =
          (updated as unknown as { requestorEmail?: string | null }).requestorEmail?.trim() ||
          updated.contactEmail;
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
      } else {
        const pending = acaProceduralStatusLabel(advanced);
        const nextLevel = currentAcaLevel(advanced);
        if (pending) {
          await logActivity(id, "SYSTEM", "ACA approval pending", pending);
        }
        await logActivity(
          id,
          "SYSTEM",
          nextAssigneeId
            ? "Assigned to next ACA approval role"
            : "Next ACA approval available",
          nextAssigneeId
            ? `Request moved to ${nextLevel?.label ?? "next role"} assignee’s Request Board.`
            : "Assign the next ACA seat from Ticket Controls.",
        );
        if (ticket.status !== "IN_PROGRESS") {
          await logActivity(id, "AGENT", "Status → IN_PROGRESS", pending ?? undefined);
        }
      }

      return NextResponse.json({
        ...(await ticketJsonWithAssigneeColor(updated)),
        acaApprovalMeta: advanced,
      });
    }

    if (action === "set_job_order_execution_assignee") {
      if (!canStaffMutateTicket) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      const requestType = await loadTicketRequestType(id);
      if (requestType !== "JOB_ORDER") {
        return NextResponse.json(
          { error: "Only Job Order requests can set an execution assignee." },
          { status: 400 },
        );
      }
      const joMeta = await initJobOrderApprovalMetaIfNeeded(id);
      if (!isJobOrderExecutionWorkspaceOpen(joMeta)) {
        return NextResponse.json(
          {
            error:
              "Execution assignee unlocks after Noted By and Approved By are complete (when those seats apply).",
          },
          { status: 400 },
        );
      }
      if (!(roleIsAdmin || roleIsCompanyAdmin)) {
        return NextResponse.json(
          { error: "Only Admin can assign the Job Order execution assignee." },
          { status: 403 },
        );
      }
      const executionAssigneeAgentId =
        typeof body.executionAssigneeAgentId === "string"
          ? body.executionAssigneeAgentId.trim()
          : "";
      if (!executionAssigneeAgentId) {
        return NextResponse.json({ error: "Select personnel to assign." }, { status: 400 });
      }
      const agent = await prisma.agent.findUnique({
        where: { id: executionAssigneeAgentId },
        select: { id: true, name: true },
      });
      if (!agent) {
        return NextResponse.json({ error: "Selected personnel was not found." }, { status: 400 });
      }

      // While approvals are still in progress, only stage the pick — do not steal the
      // current procedural board assignee.
      if (!isJobOrderProcedureGreenLit(joMeta)) {
        const pendingMeta = setJobOrderPendingExecutionAssignee(joMeta, agent.id);
        await saveJobOrderApprovalMeta(id, pendingMeta);
        await logActivity(
          id,
          "AGENT",
          "Job order execution assignee staged",
          `${agent.name} selected for execution (applies when approvals finish).`,
        );
        const current = await prisma.ticket.findUnique({
          where: { id },
          include: { team: true, assignedAgent: true },
        });
        return NextResponse.json({
          ...(current ? await ticketJsonWithAssigneeColor(current) : {}),
          jobOrderApprovalMeta: pendingMeta,
        });
      }

      const updated = await prisma.ticket.update({
        where: { id },
        data: {
          assignedAgent: { connect: { id: agent.id } },
          ...(ticket.status === "OPEN" ||
          ticket.status === "PENDING_INFO" ||
          ticket.status === "FOR_CONFIRMATION"
            ? { status: "IN_PROGRESS" as const }
            : {}),
          resolvedAt: null,
        },
        include: { team: true, assignedAgent: true },
      });
      await logActivity(
        id,
        "AGENT",
        "Job order execution assignee set",
        `${agent.name} assigned as execution assignee.`,
      );
      const markedMeta = markJobOrderExecutionAssigned(
        setJobOrderPendingExecutionAssignee(joMeta, null),
      );
      await saveJobOrderApprovalMeta(id, markedMeta);
      return NextResponse.json({
        ...(await ticketJsonWithAssigneeColor(updated)),
        jobOrderApprovalMeta: markedMeta,
      });
    }

    if (action === "set_job_order_workers") {
      if (!canStaffMutateTicket) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      const requestType = await loadTicketRequestType(id);
      if (requestType !== "JOB_ORDER") {
        return NextResponse.json(
          { error: "Only Job Order requests can set co-workers." },
          { status: 400 },
        );
      }
      const joMeta = await initJobOrderApprovalMetaIfNeeded(id);
      if (!isJobOrderExecutionWorkspaceOpen(joMeta)) {
        return NextResponse.json(
          {
            error:
              "Co-workers unlock after Noted By and Approved By are complete (when those seats apply).",
          },
          { status: 400 },
        );
      }
      const executionAssigneeId =
        (isJobOrderProcedureGreenLit(joMeta)
          ? ticket.assignedAgentId?.trim()
          : null) ||
        joMeta.pendingExecutionAssigneeAgentId?.trim() ||
        null;
      if (!executionAssigneeId) {
        return NextResponse.json(
          { error: "Assign an execution assignee before adding co-workers." },
          { status: 400 },
        );
      }
      const actingAsExecutionAssignee = await isSessionAssigneeOfTicket({
        operatorId: operator?.id,
        sessionEmail: session.user.email,
        ticket,
      });
      const actingAsPendingExecutionAssignee =
        Boolean(operator?.id) && operator!.id === executionAssigneeId;
      const canManageWorkers =
        roleIsAdmin ||
        roleIsCompanyAdmin ||
        actingAsExecutionAssignee ||
        actingAsPendingExecutionAssignee;
      if (!canManageWorkers) {
        return NextResponse.json(
          {
            error: "Only the Job Order assignee or Admin can update the execution team.",
          },
          { status: 403 },
        );
      }
      const rawIds: unknown[] = Array.isArray(body.workerAgentIds) ? body.workerAgentIds : [];
      const workerAgentIds = rawIds
        .filter((v): v is string => typeof v === "string" && Boolean(v.trim()))
        .map((v) => v.trim());
      if (workerAgentIds.length > 0) {
        const found = await prisma.agent.findMany({
          where: { id: { in: workerAgentIds } },
          select: { id: true },
        });
        if (found.length !== new Set(workerAgentIds).size) {
          return NextResponse.json(
            { error: "One or more selected co-workers were not found." },
            { status: 400 },
          );
        }
      }
      const updatedMeta = applyJobOrderWorkerAgentIds(joMeta, workerAgentIds, executionAssigneeId);
      await saveJobOrderApprovalMeta(id, updatedMeta);
      const nameById = new Map(
        (
          await prisma.agent.findMany({
            where: { id: { in: parseJobOrderWorkerAgentIds(updatedMeta) } },
            select: { id: true, name: true },
          })
        ).map((a) => [a.id, a.name]),
      );
      const detail =
        parseJobOrderWorkerAgentIds(updatedMeta).length > 0
          ? parseJobOrderWorkerAgentIds(updatedMeta)
              .map((workerId) => nameById.get(workerId) ?? workerId)
              .join(", ")
          : "None";
      await logActivity(id, "AGENT", "Job order co-workers updated", detail);
      const refreshed = await prisma.ticket.findUnique({
        where: { id },
        include: { team: true, assignedAgent: true },
      });
      return NextResponse.json({
        ...(refreshed ? await ticketJsonWithAssigneeColor(refreshed) : {}),
        jobOrderApprovalMeta: updatedMeta,
      });
    }

    if (action === "set_job_order_assistance_team") {
      if (!canStaffMutateTicket) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      const requestType = await loadTicketRequestType(id);
      if (requestType !== "JOB_ORDER") {
        return NextResponse.json(
          { error: "Only Job Order requests can set an assistance team." },
          { status: 400 },
        );
      }
      const joMeta = await initJobOrderApprovalMetaIfNeeded(id);
      if (!isJobOrderExecutionWorkspaceOpen(joMeta)) {
        return NextResponse.json(
          {
            error:
              "Assistance team unlocks after Noted By and Approved By are complete (when those seats apply).",
          },
          { status: 400 },
        );
      }
      const actingAsCurrentApprover = await isSessionAssigneeOfTicket({
        operatorId: operator?.id,
        sessionEmail: session.user.email,
        ticket,
      });
      const sectionRowsForHead = await prisma.$queryRaw<
        Array<{ org_chart_section_id: string | null }>
      >`
        SELECT org_chart_section_id FROM tickets WHERE id = ${id} LIMIT 1
      `;
      const sendToSectionIdForHead =
        sectionRowsForHead[0]?.org_chart_section_id?.trim() || null;
      const isSendToDepartmentHead = await isViewerOrgChartHeadForSection(
        session.user.email,
        sendToSectionIdForHead,
      );
      const canManageAssistance =
        roleIsAdmin ||
        roleIsCompanyAdmin ||
        actingAsCurrentApprover ||
        isSendToDepartmentHead;
      if (!canManageAssistance) {
        return NextResponse.json(
          {
            error:
              "Only the Send-to department head, an approver, or Admin can update the assistance team.",
          },
          { status: 403 },
        );
      }

      if (body.clearAssistanceTeam === true) {
        const cleared = applyJobOrderAssistanceTeam(joMeta, null);
        await saveJobOrderApprovalMeta(id, cleared);
        await logActivity(id, "AGENT", "Job order assistance team cleared", "Removed");
        const refreshed = await prisma.ticket.findUnique({
          where: { id },
          include: { team: true, assignedAgent: true },
        });
        return NextResponse.json({
          ...(refreshed ? await ticketJsonWithAssigneeColor(refreshed) : {}),
          jobOrderApprovalMeta: cleared,
        });
      }

      const scopeMode: JobOrderAssistanceScopeMode =
        body.scopeMode === "company" ? "company" : "department";
      const orgChartSectionId =
        typeof body.orgChartSectionId === "string" ? body.orgChartSectionId.trim() : "";
      const companyTeamId =
        typeof body.companyTeamId === "string" ? body.companyTeamId.trim() : "";
      const assigneeAgentId =
        typeof body.assigneeAgentId === "string" ? body.assigneeAgentId.trim() : "";
      const rawWorkerIds: unknown[] = Array.isArray(body.workerAgentIds)
        ? body.workerAgentIds
        : [];
      const workerAgentIds = rawWorkerIds
        .filter((v): v is string => typeof v === "string" && Boolean(v.trim()))
        .map((v) => v.trim());

      if (scopeMode === "department" && !orgChartSectionId) {
        return NextResponse.json(
          { error: "Select a department for the assistance team scope." },
          { status: 400 },
        );
      }
      if (scopeMode === "company" && !companyTeamId) {
        return NextResponse.json(
          { error: "Select a company for the assistance team scope." },
          { status: 400 },
        );
      }

      const sendToSectionId = sendToSectionIdForHead;
      const executionAssigneeId =
        (isJobOrderProcedureGreenLit(joMeta)
          ? ticket.assignedAgentId?.trim()
          : null) ||
        joMeta.pendingExecutionAssigneeAgentId?.trim() ||
        null;
      if (sendToSectionId && executionAssigneeId && !isSendToDepartmentHead) {
        const sectionAgentIds = await resolveAgentIdsForOrgChartSection(sendToSectionId);
        if (
          !isJobOrderExecutionOutsideSendToDepartment({
            executionAssigneeAgentId: executionAssigneeId,
            sendToOrgChartSectionId: sendToSectionId,
            sendToSectionAgentIds: sectionAgentIds,
          })
        ) {
          return NextResponse.json(
            {
              error:
                "Assistance team is only used when the execution assignee is outside Send request to (department).",
            },
            { status: 400 },
          );
        }
      } else if (!executionAssigneeId && !isSendToDepartmentHead) {
        return NextResponse.json(
          { error: "Assign an execution assignee before setting an assistance team." },
          { status: 400 },
        );
      }

      let allowedAgentIds: Set<string> | null = null;
      if (scopeMode === "department") {
        allowedAgentIds = new Set(await resolveAgentIdsForOrgChartSection(orgChartSectionId));
      }

      const candidateIds = [
        ...(assigneeAgentId ? [assigneeAgentId] : []),
        ...workerAgentIds,
      ];
      if (candidateIds.length > 0) {
        const found = await prisma.agent.findMany({
          where: { id: { in: candidateIds } },
          select: { id: true },
        });
        if (found.length !== new Set(candidateIds).size) {
          return NextResponse.json(
            { error: "One or more selected assistance personnel were not found." },
            { status: 400 },
          );
        }
        if (scopeMode === "department" && allowedAgentIds) {
          const outside = found.filter((a) => !allowedAgentIds!.has(a.id));
          if (outside.length > 0) {
            return NextResponse.json(
              { error: "Assistance team members must belong to the selected department." },
              { status: 400 },
            );
          }
        }
      }

      const updatedMeta = applyJobOrderAssistanceTeam(joMeta, {
        scopeMode,
        orgChartSectionId: scopeMode === "department" ? orgChartSectionId : null,
        companyTeamId: scopeMode === "company" ? companyTeamId : null,
        assigneeAgentId: assigneeAgentId || null,
        workerAgentIds,
      });
      await saveJobOrderApprovalMeta(id, updatedMeta);
      const assist = updatedMeta.assistanceTeam;
      const ids = [
        ...(assist?.assigneeAgentId ? [assist.assigneeAgentId] : []),
        ...(assist?.workerAgentIds ?? []),
      ];
      const nameById = new Map(
        (
          await prisma.agent.findMany({
            where: { id: { in: ids } },
            select: { id: true, name: true },
          })
        ).map((a) => [a.id, a.name]),
      );
      const detail = [
        `Scope: ${scopeMode}`,
        assist?.assigneeAgentId
          ? `Assignee: ${nameById.get(assist.assigneeAgentId) ?? assist.assigneeAgentId}`
          : "Assignee: none",
        assist && assist.workerAgentIds.length > 0
          ? `Co-workers: ${assist.workerAgentIds.map((wid) => nameById.get(wid) ?? wid).join(", ")}`
          : "Co-workers: none",
      ].join(" · ");
      await logActivity(id, "AGENT", "Job order assistance team updated", detail);
      const refreshed = await prisma.ticket.findUnique({
        where: { id },
        include: { team: true, assignedAgent: true },
      });
      return NextResponse.json({
        ...(refreshed ? await ticketJsonWithAssigneeColor(refreshed) : {}),
        jobOrderApprovalMeta: updatedMeta,
      });
    }

    if (action === "complete_job_order_execution") {
      if (!canStaffMutateTicket) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      const requestType = await loadTicketRequestType(id);
      if (requestType !== "JOB_ORDER") {
        return NextResponse.json(
          { error: "Only Job Order requests can be marked done." },
          { status: 400 },
        );
      }
      const joMeta = await initJobOrderApprovalMetaIfNeeded(id);
      const actingAsExecutionAssignee = await isSessionAssigneeOfTicket({
        operatorId: operator?.id,
        sessionEmail: session.user.email,
        ticket,
      });
      const sessionEmail = session.user.email?.trim() ?? "";
      const sessionAgentIds = sessionEmail
        ? (
            await prisma.agent.findMany({
              where: { email: { equals: sessionEmail, mode: "insensitive" } },
              select: { id: true },
            })
          ).map((a) => a.id)
        : operator?.id
          ? [operator.id]
          : [];
      const actingAsAssistanceMember = sessionAgentIds.some((agentId) =>
        isJobOrderAssistanceMember(agentId, joMeta),
      );
      const gate = canMarkJobOrderDone({
        meta: joMeta,
        ticketStatus: ticket.status,
        ticketAssignedAgentId: ticket.assignedAgentId,
        pendingExecutionAssigneeAgentId: joMeta.pendingExecutionAssigneeAgentId,
        actorAgentId:
          actingAsAssistanceMember && sessionAgentIds[0]
            ? sessionAgentIds.find((id) => isJobOrderAssistanceMember(id, joMeta)) ??
              operator?.id ??
              null
            : operator?.id ?? null,
        actorIsExecutionAssignee:
          actingAsExecutionAssignee ||
          Boolean(
            operator?.id &&
              operator.id === (joMeta.pendingExecutionAssigneeAgentId?.trim() || null),
          ),
        isAdmin: roleIsAdmin || roleIsCompanyAdmin,
      });
      if (!gate.ok) {
        const status = gate.error.startsWith("Only the execution") ? 403 : 400;
        return NextResponse.json({ error: gate.error }, { status });
      }
      const stampedMeta = markJobOrderJobDone(joMeta);
      await saveJobOrderApprovalMeta(id, stampedMeta);
      await touchFirstResponse(ticket, "AGENT");
      await logActivity(
        id,
        "AGENT",
        "Job order execution complete",
        "Work marked Job Done.",
      );

      if (isJobOrderReadyForConfirmation(stampedMeta)) {
        const updated = await prisma.ticket.update({
          where: { id },
          data: {
            status: "FOR_CONFIRMATION",
            resolvedAt: new Date(),
          },
          include: { team: true, assignedAgent: true },
        });
        await logActivity(id, "AGENT", "Status → FOR_CONFIRMATION", "Job Done with approvals complete.");
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
        return NextResponse.json({
          ...(await ticketJsonWithAssigneeColor(updated)),
          jobOrderApprovalMeta: stampedMeta,
        });
      }

      const lastApproverId =
        stampedMeta.proceduralStep !== "DONE"
          ? currentJobOrderStepBoardAssigneeId(stampedMeta)
          : null;
      const assigneeWrite = proceduralBoardAssigneeWrite(lastApproverId, ticket.assignedAgentId);
      const updated = await prisma.ticket.update({
        where: { id },
        data: {
          status: "IN_PROGRESS",
          resolvedAt: null,
          ...assigneeWrite,
        },
        include: { team: true, assignedAgent: true },
      });
      const pending = jobOrderProceduralStatusLabel(stampedMeta.proceduralStep);
      await logActivity(
        id,
        "SYSTEM",
        "Awaiting final Approved By",
        pending
          ? `Job Done recorded. ${pending}`
          : "Job Done recorded. Waiting on the final Approved By before customer confirmation.",
      );
      return NextResponse.json({
        ...(await ticketJsonWithAssigneeColor(updated)),
        jobOrderApprovalMeta: stampedMeta,
      });
    }

    if (action === "link_job_order_project") {
      if (!canStaffMutateTicket) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      const joMeta = await initJobOrderApprovalMetaIfNeeded(id);
      if (!isJobOrderExecutionWorkspaceOpen(joMeta)) {
        return NextResponse.json(
          {
            error:
              "Related Task Board unlocks after Noted By and Approved By are complete (when those seats apply).",
          },
          { status: 400 },
        );
      }
      const { linkJobOrderToProject, projectDisplayName } = await import("@/lib/job-order-project");
      const kpiMaintenanceId = typeof body.kpiMaintenanceId === "string" ? body.kpiMaintenanceId : "";
      const result = await linkJobOrderToProject({
        ticketId: id,
        kpiMaintenanceId,
        actor: "AGENT",
      });
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: result.status });
      }
      const updated = await prisma.ticket.findUnique({
        where: { id },
        include: { team: true, assignedAgent: true },
      });
      return NextResponse.json({
        ...(updated ? await ticketJsonWithAssigneeColor(updated) : {}),
        linkedProject: {
          id: result.project.id,
          title: result.project.title,
          mainTask: result.project.mainTask,
          itProjectName: result.project.itProjectName,
          displayName: projectDisplayName(result.project),
        },
      });
    }

    if (action === "unlink_job_order_project") {
      if (!canStaffMutateTicket) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      const { unlinkJobOrderFromProject } = await import("@/lib/job-order-project");
      const result = await unlinkJobOrderFromProject({ ticketId: id, actor: "AGENT" });
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: result.status });
      }
      const updated = await prisma.ticket.findUnique({
        where: { id },
        include: { team: true, assignedAgent: true },
      });
      return NextResponse.json({
        ...(updated ? await ticketJsonWithAssigneeColor(updated) : {}),
        linkedProject: null,
      });
    }

    if (action === "request_job_order_project") {
      if (!isAssignedOperator) {
        return NextResponse.json(
          { error: "Only the assigned personnel can request a Task Project." },
          { status: 403 },
        );
      }
      if (roleIsAdmin || roleIsCompanyAdmin) {
        return NextResponse.json(
          { error: "Admins can create the Task Project directly." },
          { status: 400 },
        );
      }
      const requestType = await loadTicketRequestType(id);
      if (requestType !== "JOB_ORDER") {
        return NextResponse.json(
          { error: "Only Job Order requests can request a Task Project." },
          { status: 400 },
        );
      }
      const joMetaForProject = await initJobOrderApprovalMetaIfNeeded(id);
      if (!isJobOrderExecutionWorkspaceOpen(joMetaForProject)) {
        return NextResponse.json(
          {
            error:
              "Related Task Board unlocks after Noted By and Approved By are complete (when those seats apply).",
          },
          { status: 400 },
        );
      }
      const { getTicketLinkedKpiMaintenanceId } = await import("@/lib/job-order-project");
      const alreadyLinked = await getTicketLinkedKpiMaintenanceId(id);
      if (alreadyLinked) {
        return NextResponse.json(
          { error: "This Job Order is already linked to a project." },
          { status: 400 },
        );
      }

      const requestAudit = await prisma.ticketActivity.findMany({
        where: {
          ticketId: id,
          summary: {
            in: [
              JO_PROJECT_REQUESTED_SUMMARY,
              JO_PROJECT_REQUEST_FULFILLED_SUMMARY,
              JO_PROJECT_REQUEST_CANCELLED_SUMMARY,
            ],
          },
        },
        orderBy: { createdAt: "asc" },
        select: { summary: true, detail: true },
      });
      const { pending } = jobOrderProjectRequestPendingFromActivities(requestAudit);
      if (pending) {
        return NextResponse.json(
          { error: "A Task Project request is already pending." },
          { status: 400 },
        );
      }

      const targetAdminAgentId =
        typeof body.targetAdminAgentId === "string" ? body.targetAdminAgentId.trim() : "";
      if (!targetAdminAgentId) {
        return NextResponse.json(
          { error: "Select a company Admin to create the Task Project." },
          { status: 400 },
        );
      }

      const companyTeamId =
        ticket.teamId?.trim() ||
        (ticket.assignedAgentId
          ? await resolveAgentDesignatedCompanyId(ticket.assignedAgentId)
          : null);
      if (!companyTeamId) {
        return NextResponse.json(
          { error: "This Job Order has no company to scope Admins." },
          { status: 400 },
        );
      }

      const staff = await loadHrisAssignableStaff({ companyTeamId });
      const adminStaff = staff.find(
        (s) =>
          s.agentId === targetAdminAgentId &&
          (isAdminPortalRole(s.portalRole) || s.headPrivileges),
      );
      if (!adminStaff) {
        return NextResponse.json(
          { error: "Choose an Admin from this Job Order’s company." },
          { status: 400 },
        );
      }

      const targetAdmin = await prisma.agent.findUnique({
        where: { id: targetAdminAgentId },
        select: { id: true, name: true },
      });
      if (!targetAdmin) {
        return NextResponse.json({ error: "Selected Admin not found." }, { status: 404 });
      }

      const note =
        typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 500) : undefined;

      await logActivity(
        id,
        "AGENT",
        JO_PROJECT_REQUESTED_SUMMARY,
        serializeJobOrderProjectRequest({
          targetAdminAgentId: targetAdmin.id,
          targetAdminAgentName: targetAdmin.name,
          requestedByAgentId: operator?.id ?? null,
          requestedByAgentName: operator?.name ?? session.user.name ?? null,
          note,
        }),
      );

      const updated = await prisma.ticket.findUnique({
        where: { id },
        include: { team: true, assignedAgent: true },
      });
      return NextResponse.json({
        ...(updated ? await ticketJsonWithAssigneeColor(updated) : {}),
        projectRequest: {
          pending: true,
          targetAdminAgentId: targetAdmin.id,
          targetAdminAgentName: targetAdmin.name,
          requestedByAgentId: operator?.id ?? null,
          requestedByAgentName: operator?.name ?? session.user.name ?? null,
          note: note ?? null,
        },
      });
    }

    if (action === "cancel_job_order_project_request") {
      if (!isAssignedOperator && !roleIsAdmin && !roleIsCompanyAdmin) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      const requestAudit = await prisma.ticketActivity.findMany({
        where: {
          ticketId: id,
          summary: {
            in: [
              JO_PROJECT_REQUESTED_SUMMARY,
              JO_PROJECT_REQUEST_FULFILLED_SUMMARY,
              JO_PROJECT_REQUEST_CANCELLED_SUMMARY,
            ],
          },
        },
        orderBy: { createdAt: "asc" },
        select: { summary: true, detail: true },
      });
      const { pending, payload } = jobOrderProjectRequestPendingFromActivities(requestAudit);
      if (!pending) {
        return NextResponse.json({ error: "No pending Task Project request." }, { status: 400 });
      }
      if (
        isAssignedOperator &&
        !roleIsAdmin &&
        !roleIsCompanyAdmin &&
        payload?.requestedByAgentId &&
        operator?.id &&
        payload.requestedByAgentId !== operator.id
      ) {
        return NextResponse.json(
          { error: "Only the requester or an Admin can cancel this request." },
          { status: 403 },
        );
      }

      await logActivity(
        id,
        "AGENT",
        JO_PROJECT_REQUEST_CANCELLED_SUMMARY,
        payload?.targetAdminAgentName
          ? `Cancelled request to ${payload.targetAdminAgentName}.`
          : "Cancelled Task Project request.",
      );

      const updated = await prisma.ticket.findUnique({
        where: { id },
        include: { team: true, assignedAgent: true },
      });
      return NextResponse.json({
        ...(updated ? await ticketJsonWithAssigneeColor(updated) : {}),
        projectRequest: { pending: false },
      });
    }

    if (action === "cancel_request") {
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
      return NextResponse.json(updated);
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }
}
