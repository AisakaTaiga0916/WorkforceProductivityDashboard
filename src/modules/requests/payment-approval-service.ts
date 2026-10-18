import type { Prisma } from "@prisma/client/primary";
import type { Session } from "next-auth";
import { NextResponse } from "next/server";
import { isElevatedUserRole } from "@/modules/platform/auth";
import { permissionDenied } from "@/modules/platform/rbac/permissions";
import { prisma } from "@/modules/platform/db/prisma";
import {
  resolveAgentDesignatedCompanyId,
  resolveStaffCompanyTeamId,
} from "@/modules/platform/scope/staff-company-scope";
import { loadTicketRequestType } from "@/modules/requests/ticket-request-type";
import { isSessionAssigneeOfTicket } from "@/modules/requests/ticket-staff-access";
import { logActivity } from "@/modules/requests/ticket-actions";
import { sendResolutionEmail } from "@/lib/email";
import { proceduralBoardAssigneeWrite } from "@/modules/requests/procedural-board-assignee";
import {
  applyPaymentApprovalAssignees,
  assigneeFieldForStep,
  assigneeIdForStep,
  canAssignDeferredPaymentAccountingFinance,
  canAssignPaymentApprover,
  canCompletePaymentApprovalStep,
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
} from "@/modules/requests/request-for-payment-approval";
import {
  applyPaymentModeToFields,
  formatPaymentRequestDescription,
  parsePaymentRequestDescription,
  validatePaymentModeFields,
} from "@/modules/requests/request-for-payment";
import {
  initPaymentApprovalMetaIfNeeded,
  savePaymentApprovalMeta,
} from "@/modules/requests/payment-approval-db";

/** Ticket row as loaded by the tickets PATCH route preamble. */
export type PaymentServiceTicket = Prisma.TicketGetPayload<{
  include: {
    assignedAgent: { select: { id: true; name: true; email: true; teamId: true } };
  };
}>;

type TicketWithAssignee = Prisma.TicketGetPayload<{
  include: { team: true; assignedAgent: true };
}>;

/**
 * Domain outcome for payment-approval actions. Failures are returned as a
 * ready `NextResponse` (permission guards included); successes carry the
 * refreshed ticket plus optional approval meta for the route to serialize.
 */
export type PaymentApprovalOutcome = {
  ticket: TicketWithAssignee | null;
  meta?: PaymentApprovalAssignees;
};

export async function handleSetPaymentApprovalAssignees(args: {
  ticketId: string;
  ticket: PaymentServiceTicket;
  session: Session;
  body: Record<string, unknown>;
  isAssignedOperator: boolean;
}): Promise<NextResponse | PaymentApprovalOutcome> {
  const { ticketId: id, ticket, session, body, isAssignedOperator } = args;
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
  return { ticket: refreshed, meta: updatedMeta };
}

export async function handleRequestPaymentApproval(args: {
  ticketId: string;
  ticket: PaymentServiceTicket;
  body: Record<string, unknown>;
  operatorAgentId: string | null;
  isAssignedOperator: boolean;
  canStaffMutateTicket: boolean;
  roleIsAdmin: boolean;
  roleIsCompanyAdmin: boolean;
}): Promise<NextResponse | PaymentApprovalOutcome> {
  const {
    ticketId: id,
    ticket,
    body,
    operatorAgentId,
    isAssignedOperator,
    canStaffMutateTicket,
    roleIsAdmin,
    roleIsCompanyAdmin,
  } = args;
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
  if (!operatorAgentId && !roleIsAdmin && !roleIsCompanyAdmin) {
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
  if (isAssignedOperator && operatorAgentId) {
    const doneGate = canCompletePaymentApprovalStep({
      meta,
      actorAgentId: operatorAgentId,
      ticketAssignedAgentId: ticket.assignedAgentId,
    });
    const priorIds = paymentApprovalParticipantIds(meta);
    const currentAssignee = assigneeIdForStep(meta, step);
    if (currentAssignee) priorIds.delete(currentAssignee);
    const alreadyApprovedEarlier = priorIds.has(operatorAgentId);
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
  const companyAnchorId = ticket.assignedAgentId ?? operatorAgentId ?? null;
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
  return { ticket: updated, meta: updatedMeta };
}

export async function handleApprovePaymentStep(args: {
  ticketId: string;
  ticket: PaymentServiceTicket;
  session: Session;
  operatorAgentId: string | null;
  isAdminOrAgent: boolean;
}): Promise<NextResponse | PaymentApprovalOutcome> {
  const { ticketId: id, ticket, session, operatorAgentId, isAdminOrAgent } = args;
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
  const approveBlock = await permissionDenied(session, "requests.approve");
  if (approveBlock) return approveBlock;
  const gate = canMarkPaymentStepApproved({
    meta,
    actorAgentId: operatorAgentId,
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
  return { ticket: updated, meta: approved };
}

export async function handleUpdatePaymentMode(args: {
  ticketId: string;
  ticket: PaymentServiceTicket;
  session: Session;
  body: Record<string, unknown>;
  isAssignedOperator: boolean;
  isAdminOrAgent: boolean;
}): Promise<NextResponse | PaymentApprovalOutcome> {
  const { ticketId: id, ticket, session, body, isAssignedOperator, isAdminOrAgent } = args;
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
  return { ticket: updated };
}

export async function handleCompletePaymentApprovalStep(args: {
  ticketId: string;
  ticket: PaymentServiceTicket;
  session: Session;
  operatorAgentId: string | null;
  isAdminOrAgent: boolean;
}): Promise<NextResponse | PaymentApprovalOutcome> {
  const { ticketId: id, ticket, session, operatorAgentId, isAdminOrAgent } = args;
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
    operatorId: operatorAgentId,
    sessionEmail: session.user.email,
    ticket,
  });
  const approveBlock = await permissionDenied(session, "requests.approve");
  if (approveBlock) return approveBlock;
  const gate = canCompletePaymentApprovalStep({
    meta,
    actorAgentId: actingAsAssignee
      ? ticket.assignedAgentId
      : operatorAgentId,
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
      await import("@/modules/requests/request-board-columns")
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

  return { ticket: updated, meta: advanced };
}
