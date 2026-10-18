import type { Prisma } from "@prisma/client/primary";
import type { Session } from "next-auth";
import { NextResponse } from "next/server";
import { isElevatedUserRole } from "@/modules/platform/auth";
import { permissionDenied } from "@/modules/platform/rbac/permissions";
import { prisma } from "@/modules/platform/db/prisma";
import { loadTicketRequestType } from "@/modules/requests/ticket-request-type";
import { logActivity } from "@/modules/requests/ticket-actions";
import { sendResolutionEmail } from "@/lib/email";
import { proceduralBoardAssigneeWrite } from "@/modules/requests/procedural-board-assignee";
import { parseIntakeScreenshotMeta } from "@/modules/requests/ticket-intake-screenshots-meta";
import { hasJobOrderJobOutputUploaded } from "@/modules/requests/job-order-attachments";
import {
  applyJobOrderApprovalAssignees,
  canCompleteJobOrderApprovalStep,
  clearJobOrderExecutionAssignment,
  completeJobOrderApprovalStep,
  currentJobOrderStepBoardAssigneeId,
  isJobOrderJobDone,
  isJobOrderReadyForConfirmation,
  jobOrderAssigneeFieldForStep,
  JOB_ORDER_APPROVAL_FIELD_LABELS,
  JOB_ORDER_APPROVAL_STEP_LABELS,
  jobOrderProceduralStatusLabel,
  promoteJobOrderPendingExecutionAssignee,
  type JobOrderApprovalAssignees,
} from "@/modules/requests/job-order-approval";
import {
  initJobOrderApprovalMetaIfNeeded,
  saveJobOrderApprovalMeta,
} from "@/modules/requests/job-order-approval-db";

/** Ticket row as loaded by the tickets PATCH route preamble. */
export type JobOrderServiceTicket = Prisma.TicketGetPayload<{
  include: {
    assignedAgent: { select: { id: true; name: true; email: true; teamId: true } };
  };
}>;

type TicketWithAssignee = Prisma.TicketGetPayload<{
  include: { team: true; assignedAgent: true };
}>;

export type JobOrderApprovalOutcome = {
  ticket: TicketWithAssignee | null;
  meta?: JobOrderApprovalAssignees;
};

export async function handleSetJobOrderApprovalAssignees(args: {
  ticketId: string;
  ticket: JobOrderServiceTicket;
  session: Session;
  body: Record<string, unknown>;
}): Promise<NextResponse | JobOrderApprovalOutcome> {
  const { ticketId: id, ticket, session, body } = args;
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
  return { ticket: refreshed, meta: updatedMeta };
}

export async function handleRequestJobOrderApproval(args: {
  ticketId: string;
  body: Record<string, unknown>;
  operatorAgentId: string | null;
  isAssignedOperator: boolean;
  canStaffMutateTicket: boolean;
  roleIsAdmin: boolean;
  roleIsCompanyAdmin: boolean;
}): Promise<NextResponse | JobOrderApprovalOutcome> {
  const {
    ticketId: id,
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
      { error: "Only the assigned personnel can request the next job order approval." },
      { status: 403 },
    );
  }
  if (!operatorAgentId) {
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
  return { ticket: updated, meta: updatedMeta };
}

export async function handleCompleteJobOrderApprovalStep(args: {
  ticketId: string;
  ticket: JobOrderServiceTicket;
  session: Session;
  operatorAgentId: string | null;
  isAdminOrAgent: boolean;
}): Promise<NextResponse | JobOrderApprovalOutcome> {
  const { ticketId: id, ticket, session, operatorAgentId, isAdminOrAgent } = args;
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
  const approveBlock = await permissionDenied(session, "requests.approve");
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
  }

  return { ticket: updated, meta: advanced };
}
