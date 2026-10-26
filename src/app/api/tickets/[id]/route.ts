import { NextResponse } from "next/server";
import { customerCanAccessTicket, requireSession } from "@/lib/access";
import { moduleDisabledResponse } from "@/modules/platform/settings/system-modules-db";
import { prisma } from "@/modules/platform/db/prisma";
import { findSessionAgentWithTeam } from "@/lib/session-agent";
import { portalCompanyAdminPrivilegesForEmail } from "@/lib/portal-staff";
import {
  handleApproveTransfer,
  handleRejectTransfer,
  handleRequestTransfer,
} from "@/modules/requests/transfer-service";
import {
  handleCancelRequest,
  handlePriorityChange,
  handleResolutionVerification,
  handleSubmitFeedback,
  handleTicketStatusChange,
  handleUpdateRemarks,
} from "@/modules/requests/ticket-lifecycle-service";
import { getTicketSlaState } from "@/modules/requests/sla";
import { loadStaffAssignmentColorsForAgents } from "@/lib/assignee-assignment-color";
import {
  adminOutsideCompanyScope,
  isCurrentPaymentStepAssignee,
  isSessionJobOrderTeamMember,
  isTicketAssignee,
  personnelForbiddenForTicket,
} from "@/modules/requests/ticket-staff-access";
import {
  handleApprovePaymentStep,
  handleCompletePaymentApprovalStep,
  handleRequestPaymentApproval,
  handleSetPaymentApprovalAssignees,
  handleUpdatePaymentMode,
} from "@/modules/requests/payment-approval-service";
import {
  handleCompleteItemRequisitionApprovalStep,
  handleRequestItemRequisitionApproval,
  handleSetItemRequisitionApprovalAssignees,
  handleUndoItemRequisitionCanvass,
  handleUpdateItemRequisitionPricing,
} from "@/modules/requests/item-requisition-service";
import {
  handleCompleteFundTransferApprovalStep,
  handleRequestFundTransferApproval,
  handleSetFundTransferApprovalAssignees,
} from "@/modules/requests/fund-transfer-service";
import {
  handleCompleteJobOrderApprovalStep,
  handleRequestJobOrderApproval,
  handleSetJobOrderApprovalAssignees,
} from "@/modules/requests/job-order-approval-service";
import {
  handleCompleteJobOrderExecution,
  handleSetJobOrderAssistanceTeam,
  handleSetJobOrderExecutionAssignee,
  handleSetJobOrderWorkers,
} from "@/modules/requests/job-order-execution-service";

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
    (await isSessionJobOrderTeamMember({
      operatorId: operator?.id,
      sessionEmail: session.user.email,
      ticket,
    }));
  // Cross-company Admins may still read tickets they own as board/RFP assignee
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
    await import("@/modules/requests/request-board-columns");
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
  if (session.user.role !== "Customer") {
    const moduleOff = await moduleDisabledResponse("requests");
    if (moduleOff) return moduleOff;
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
  const canPrioritize = roleIsAdmin || isAssignedOperator;
  if (session.user.role === "Customer" && !isOwner) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // Cross-company Admins may still act when they own the board assignment or the
  // current RFP procedural step (NOTED BY can be AGC while the ticket is routed to ACI).
  if (
    !isAssignedOperator &&
    !isPaymentStepOperator &&
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

    if (action === "assign") {
      return NextResponse.json(
        { error: "Assignment updates are only available on the Assignment Board." },
        { status: 403 },
      );
    }

    if (action === "status") {
      const res = await handleTicketStatusChange({
        ticketId: id,
        ticket,
        session,
        body,
        operatorAgentId: operator?.id ?? null,
        isOwner,
        isAdminOrAgent,
        canStaffMutateTicket,
        roleIsAdmin,
        roleIsCompanyAdmin,
        isAssignedOperator,
      });
      if (res instanceof NextResponse) return res;
      return NextResponse.json(await ticketJsonWithAssigneeColor(res.ticket));
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
      const res = await handlePriorityChange({
        ticketId: id,
        body,
        canPrioritize,
      });
      if (res instanceof NextResponse) return res;
      return NextResponse.json(await ticketJsonWithAssigneeColor(res.ticket));
    }

    if (action === "remarks") {
      const res = await handleUpdateRemarks({
        ticketId: id,
        body,
        canStaffMutateTicket,
      });
      if (res instanceof NextResponse) return res;
      return NextResponse.json(await ticketJsonWithAssigneeColor(res.ticket));
    }

    if (action === "request_transfer") {
      const res = await handleRequestTransfer({
        ticketId: id,
        ticket,
        body,
        operatorAgentId: operator?.id ?? null,
        operatorName: operator?.name ?? null,
        isAssignedOperator,
      });
      if (res instanceof NextResponse) return res;
      return NextResponse.json({
        ...(res.ticket ? await ticketJsonWithAssigneeColor(res.ticket) : {}),
      });
    }

    if (action === "approve_transfer") {
      const res = await handleApproveTransfer({
        ticketId: id,
        ticket,
        session,
        body,
        operatorAgentId: operator?.id ?? null,
      });
      if (res instanceof NextResponse) return res;
      return NextResponse.json({
        ...(res.ticket ? await ticketJsonWithAssigneeColor(res.ticket) : {}),
        ...(res.meta ? { paymentApprovalMeta: res.meta } : {}),
      });
    }

    if (action === "reject_transfer") {
      const res = await handleRejectTransfer({
        ticketId: id,
        ticket,
        session,
        body,
        operatorAgentId: operator?.id ?? null,
      });
      if (res instanceof NextResponse) return res;
      return NextResponse.json({
        ...(res.ticket ? await ticketJsonWithAssigneeColor(res.ticket) : {}),
      });
    }

    if (action === "feedback") {
      const res = await handleSubmitFeedback({
        ticketId: id,
        ticket,
        body,
        isRequestor,
      });
      if (res instanceof NextResponse) return res;
      return NextResponse.json(res.feedback);
    }

    if (action === "resolution_verification") {
      const res = await handleResolutionVerification({
        ticketId: id,
        ticket,
        body,
        isRequestor,
      });
      if (res instanceof NextResponse) return res;
      if ("ok" in res) return NextResponse.json({ ok: true });
      return NextResponse.json(await ticketJsonWithAssigneeColor(res.ticket));
    }

    if (action === "set_payment_approval_assignees") {
      const res = await handleSetPaymentApprovalAssignees({
        ticketId: id,
        ticket,
        session,
        body,
        isAssignedOperator,
      });
      if (res instanceof NextResponse) return res;
      return NextResponse.json({
        ...(res.ticket ? await ticketJsonWithAssigneeColor(res.ticket) : {}),
        ...(res.meta ? { paymentApprovalMeta: res.meta } : {}),
      });
    }

    if (action === "request_payment_approval") {
      const res = await handleRequestPaymentApproval({
        ticketId: id,
        ticket,
        body,
        operatorAgentId: operator?.id ?? null,
        isAssignedOperator,
        canStaffMutateTicket,
        roleIsAdmin,
        roleIsCompanyAdmin,
      });
      if (res instanceof NextResponse) return res;
      return NextResponse.json({
        ...(res.ticket ? await ticketJsonWithAssigneeColor(res.ticket) : {}),
        ...(res.meta ? { paymentApprovalMeta: res.meta } : {}),
      });
    }

    if (action === "approve_payment_step") {
      const res = await handleApprovePaymentStep({
        ticketId: id,
        ticket,
        session,
        operatorAgentId: operator?.id ?? null,
        isAdminOrAgent,
      });
      if (res instanceof NextResponse) return res;
      return NextResponse.json({
        ...(res.ticket ? await ticketJsonWithAssigneeColor(res.ticket) : {}),
        ...(res.meta ? { paymentApprovalMeta: res.meta } : {}),
      });
    }

    if (action === "update_payment_mode") {
      const res = await handleUpdatePaymentMode({
        ticketId: id,
        ticket,
        session,
        body,
        isAssignedOperator,
        isAdminOrAgent,
      });
      if (res instanceof NextResponse) return res;
      return NextResponse.json(res.ticket ? await ticketJsonWithAssigneeColor(res.ticket) : {});
    }

    if (action === "complete_payment_approval_step") {
      const res = await handleCompletePaymentApprovalStep({
        ticketId: id,
        ticket,
        session,
        operatorAgentId: operator?.id ?? null,
        isAdminOrAgent,
      });
      if (res instanceof NextResponse) return res;
      return NextResponse.json({
        ...(res.ticket ? await ticketJsonWithAssigneeColor(res.ticket) : {}),
        ...(res.meta ? { paymentApprovalMeta: res.meta } : {}),
      });
    }

    if (action === "set_item_requisition_approval_assignees") {
      const res = await handleSetItemRequisitionApprovalAssignees({
        ticketId: id,
        ticket,
        session,
        body,
      });
      if (res instanceof NextResponse) return res;
      return NextResponse.json({
        ...(res.ticket ? await ticketJsonWithAssigneeColor(res.ticket) : {}),
        ...(res.meta ? { itemRequisitionApprovalMeta: res.meta } : {}),
      });
    }

    if (action === "request_item_requisition_approval") {
      const res = await handleRequestItemRequisitionApproval({
        ticketId: id,
        ticket,
        body,
        operatorAgentId: operator?.id ?? null,
        isAssignedOperator,
        canStaffMutateTicket,
        roleIsAdmin,
        roleIsCompanyAdmin,
      });
      if (res instanceof NextResponse) return res;
      return NextResponse.json({
        ...(res.ticket ? await ticketJsonWithAssigneeColor(res.ticket) : {}),
        ...(res.meta ? { itemRequisitionApprovalMeta: res.meta } : {}),
      });
    }

    if (action === "update_item_requisition_pricing") {
      const res = await handleUpdateItemRequisitionPricing({
        ticketId: id,
        ticket,
        session,
        body,
        operatorAgentId: operator?.id ?? null,
        isAdminOrAgent,
      });
      if (res instanceof NextResponse) return res;
      return NextResponse.json({
        ...(res.ticket ? await ticketJsonWithAssigneeColor(res.ticket) : {}),
        ...(res.meta ? { itemRequisitionApprovalMeta: res.meta } : {}),
      });
    }

    if (action === "undo_item_requisition_canvass") {
      const res = await handleUndoItemRequisitionCanvass({ ticketId: id, session });
      if (res instanceof NextResponse) return res;
      return NextResponse.json({
        ...(res.ticket ? await ticketJsonWithAssigneeColor(res.ticket) : {}),
        ...(res.meta ? { itemRequisitionApprovalMeta: res.meta } : {}),
      });
    }

    if (action === "complete_item_requisition_approval_step") {
      const res = await handleCompleteItemRequisitionApprovalStep({
        ticketId: id,
        ticket,
        session,
        body,
        operatorAgentId: operator?.id ?? null,
        isAdminOrAgent,
      });
      if (res instanceof NextResponse) return res;
      return NextResponse.json({
        ...(res.ticket ? await ticketJsonWithAssigneeColor(res.ticket) : {}),
        ...(res.meta ? { itemRequisitionApprovalMeta: res.meta } : {}),
      });
    }

    if (action === "set_fund_transfer_approval_assignees") {
      const res = await handleSetFundTransferApprovalAssignees({
        ticketId: id,
        ticket,
        session,
        body,
      });
      if (res instanceof NextResponse) return res;
      return NextResponse.json({
        ...(res.ticket ? await ticketJsonWithAssigneeColor(res.ticket) : {}),
        ...(res.meta ? { fundTransferApprovalMeta: res.meta } : {}),
      });
    }

    if (action === "request_fund_transfer_approval") {
      const res = await handleRequestFundTransferApproval({
        ticketId: id,
        ticket,
        body,
        operatorAgentId: operator?.id ?? null,
        isAssignedOperator,
        canStaffMutateTicket,
        roleIsAdmin,
        roleIsCompanyAdmin,
      });
      if (res instanceof NextResponse) return res;
      return NextResponse.json({
        ...(res.ticket ? await ticketJsonWithAssigneeColor(res.ticket) : {}),
        ...(res.meta ? { fundTransferApprovalMeta: res.meta } : {}),
      });
    }

    if (action === "complete_fund_transfer_approval_step") {
      const res = await handleCompleteFundTransferApprovalStep({
        ticketId: id,
        ticket,
        session,
        operatorAgentId: operator?.id ?? null,
        isAdminOrAgent,
      });
      if (res instanceof NextResponse) return res;
      return NextResponse.json({
        ...(res.ticket ? await ticketJsonWithAssigneeColor(res.ticket) : {}),
        ...(res.meta ? { fundTransferApprovalMeta: res.meta } : {}),
      });
    }

    if (action === "set_job_order_approval_assignees") {
      const res = await handleSetJobOrderApprovalAssignees({
        ticketId: id,
        ticket,
        session,
        body,
      });
      if (res instanceof NextResponse) return res;
      return NextResponse.json({
        ...(res.ticket ? await ticketJsonWithAssigneeColor(res.ticket) : {}),
        ...(res.meta ? { jobOrderApprovalMeta: res.meta } : {}),
      });
    }

    if (action === "request_job_order_approval") {
      const res = await handleRequestJobOrderApproval({
        ticketId: id,
        body,
        operatorAgentId: operator?.id ?? null,
        isAssignedOperator,
        canStaffMutateTicket,
        roleIsAdmin,
        roleIsCompanyAdmin,
      });
      if (res instanceof NextResponse) return res;
      return NextResponse.json({
        ...(res.ticket ? await ticketJsonWithAssigneeColor(res.ticket) : {}),
        ...(res.meta ? { jobOrderApprovalMeta: res.meta } : {}),
      });
    }

    if (action === "complete_job_order_approval_step") {
      const res = await handleCompleteJobOrderApprovalStep({
        ticketId: id,
        ticket,
        session,
        operatorAgentId: operator?.id ?? null,
        isAdminOrAgent,
      });
      if (res instanceof NextResponse) return res;
      return NextResponse.json({
        ...(res.ticket ? await ticketJsonWithAssigneeColor(res.ticket) : {}),
        ...(res.meta ? { jobOrderApprovalMeta: res.meta } : {}),
      });
    }

    if (action === "set_job_order_execution_assignee") {
      const res = await handleSetJobOrderExecutionAssignee({
        ticketId: id,
        ticket,
        body,
        canStaffMutateTicket,
        roleIsAdmin,
        roleIsCompanyAdmin,
      });
      if (res instanceof NextResponse) return res;
      return NextResponse.json({
        ...(res.ticket ? await ticketJsonWithAssigneeColor(res.ticket) : {}),
        ...(res.meta ? { jobOrderApprovalMeta: res.meta } : {}),
        ...(res.extra ?? {}),
      });
    }

    if (action === "set_job_order_workers") {
      const res = await handleSetJobOrderWorkers({
        ticketId: id,
        ticket,
        session,
        body,
        operatorAgentId: operator?.id ?? null,
        canStaffMutateTicket,
        roleIsAdmin,
        roleIsCompanyAdmin,
      });
      if (res instanceof NextResponse) return res;
      return NextResponse.json({
        ...(res.ticket ? await ticketJsonWithAssigneeColor(res.ticket) : {}),
        ...(res.meta ? { jobOrderApprovalMeta: res.meta } : {}),
        ...(res.extra ?? {}),
      });
    }

    if (action === "set_job_order_assistance_team") {
      const res = await handleSetJobOrderAssistanceTeam({
        ticketId: id,
        ticket,
        session,
        body,
        operatorAgentId: operator?.id ?? null,
        canStaffMutateTicket,
        roleIsAdmin,
        roleIsCompanyAdmin,
      });
      if (res instanceof NextResponse) return res;
      return NextResponse.json({
        ...(res.ticket ? await ticketJsonWithAssigneeColor(res.ticket) : {}),
        ...(res.meta ? { jobOrderApprovalMeta: res.meta } : {}),
        ...(res.extra ?? {}),
      });
    }

    if (action === "complete_job_order_execution") {
      const res = await handleCompleteJobOrderExecution({
        ticketId: id,
        ticket,
        session,
        operatorAgentId: operator?.id ?? null,
        canStaffMutateTicket,
        roleIsAdmin,
        roleIsCompanyAdmin,
      });
      if (res instanceof NextResponse) return res;
      return NextResponse.json({
        ...(res.ticket ? await ticketJsonWithAssigneeColor(res.ticket) : {}),
        ...(res.meta ? { jobOrderApprovalMeta: res.meta } : {}),
        ...(res.extra ?? {}),
      });
    }

    if (action === "cancel_request") {
      const res = await handleCancelRequest({
        ticketId: id,
        ticket,
        isRequestor,
      });
      if (res instanceof NextResponse) return res;
      return NextResponse.json(res.ticket);
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }
}
