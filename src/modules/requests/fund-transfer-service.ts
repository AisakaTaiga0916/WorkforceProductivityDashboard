import type { Prisma } from "@prisma/client/primary";
import type { Session } from "next-auth";
import { NextResponse } from "next/server";
import { isElevatedUserRole } from "@/modules/platform/auth";
import { permissionDenied } from "@/modules/platform/rbac/permissions";
import { prisma } from "@/modules/platform/db/prisma";
import { resolveAgentDesignatedCompanyId } from "@/modules/platform/scope/staff-company-scope";
import { loadTicketRequestType } from "@/modules/requests/ticket-request-type";
import { logActivity } from "@/modules/requests/ticket-actions";
import { sendResolutionEmail } from "@/lib/email";
import { proceduralBoardAssigneeWrite } from "@/modules/requests/procedural-board-assignee";
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
} from "@/modules/requests/fund-transfer-approval";
import {
  initFundTransferApprovalMetaIfNeeded,
  saveFundTransferApprovalMeta,
} from "@/modules/requests/fund-transfer-approval-db";

/** Ticket row as loaded by the tickets PATCH route preamble. */
export type FundTransferServiceTicket = Prisma.TicketGetPayload<{
  include: {
    assignedAgent: { select: { id: true; name: true; email: true; teamId: true } };
  };
}>;

type TicketWithAssignee = Prisma.TicketGetPayload<{
  include: { team: true; assignedAgent: true };
}>;

export type FundTransferOutcome = {
  ticket: TicketWithAssignee | null;
  meta?: FundTransferApprovalAssignees;
};

export async function handleSetFundTransferApprovalAssignees(args: {
  ticketId: string;
  ticket: FundTransferServiceTicket;
  session: Session;
  body: Record<string, unknown>;
}): Promise<NextResponse | FundTransferOutcome> {
  const { ticketId: id, ticket, session, body } = args;
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
  return { ticket: refreshed, meta: updatedMeta };
}

export async function handleRequestFundTransferApproval(args: {
  ticketId: string;
  ticket: FundTransferServiceTicket;
  body: Record<string, unknown>;
  operatorAgentId: string | null;
  isAssignedOperator: boolean;
  canStaffMutateTicket: boolean;
  roleIsAdmin: boolean;
  roleIsCompanyAdmin: boolean;
}): Promise<NextResponse | FundTransferOutcome> {
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
      { error: "Only the assigned personnel can request the next fund transfer approval." },
      { status: 403 },
    );
  }
  if (!operatorAgentId) {
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
  const companyAnchorId = ticket.assignedAgentId ?? operatorAgentId;
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
  return { ticket: updated, meta: updatedMeta };
}

export async function handleCompleteFundTransferApprovalStep(args: {
  ticketId: string;
  ticket: FundTransferServiceTicket;
  session: Session;
  operatorAgentId: string | null;
  isAdminOrAgent: boolean;
}): Promise<NextResponse | FundTransferOutcome> {
  const { ticketId: id, ticket, session, operatorAgentId, isAdminOrAgent } = args;
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
  const approveBlock = await permissionDenied(session, "requests.approve");
  if (approveBlock) return approveBlock;
  const gate = canCompleteFundTransferApprovalStep({
    meta,
    actorAgentId: operatorAgentId,
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

  return { ticket: updated, meta: advanced };
}
