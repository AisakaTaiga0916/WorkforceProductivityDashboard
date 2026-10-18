import type { Prisma } from "@prisma/client/primary";
import type { Session } from "next-auth";
import { NextResponse } from "next/server";
import { prisma } from "@/modules/platform/db/prisma";
import { loadTicketRequestType } from "@/modules/requests/ticket-request-type";
import { logActivity, touchFirstResponse } from "@/modules/requests/ticket-actions";
import { sendResolutionEmail } from "@/lib/email";
import { isSessionAssigneeOfTicket } from "@/modules/requests/ticket-staff-access";
import { resolveAgentIdsForOrgChartSection } from "@/modules/hierarchy/org-chart-section-roster";
import { isViewerOrgChartHeadForSection } from "@/modules/platform/scope/org-chart-section-scope";
import { isJobOrderExecutionOutsideSendToDepartment } from "@/modules/requests/job-order-assistance-scope";
import { proceduralBoardAssigneeWrite } from "@/modules/requests/procedural-board-assignee";
import { resolveAgentDesignatedCompanyId } from "@/modules/platform/scope/staff-company-scope";
import { loadHrisAssignableStaff } from "@/modules/hierarchy/hris-staff-roster";
import { isAdminPortalRole } from "@/lib/staff-role";
import {
  applyJobOrderAssistanceTeam,
  applyJobOrderWorkerAgentIds,
  canMarkJobOrderDone,
  currentJobOrderStepBoardAssigneeId,
  isJobOrderAssistanceMember,
  isJobOrderExecutionWorkspaceOpen,
  isJobOrderProcedureGreenLit,
  isJobOrderReadyForConfirmation,
  jobOrderProceduralStatusLabel,
  markJobOrderExecutionAssigned,
  markJobOrderJobDone,
  parseJobOrderWorkerAgentIds,
  setJobOrderPendingExecutionAssignee,
  type JobOrderApprovalAssignees,
  type JobOrderAssistanceScopeMode,
} from "@/modules/requests/job-order-approval";
import {
  initJobOrderApprovalMetaIfNeeded,
  saveJobOrderApprovalMeta,
} from "@/modules/requests/job-order-approval-db";
import {
  getTicketLinkedKpiMaintenanceId,
  linkJobOrderToProject,
  projectDisplayName,
  unlinkJobOrderFromProject,
} from "@/modules/requests/job-order-project";
import {
  JO_PROJECT_REQUEST_CANCELLED_SUMMARY,
  JO_PROJECT_REQUEST_FULFILLED_SUMMARY,
  JO_PROJECT_REQUESTED_SUMMARY,
  jobOrderProjectRequestPendingFromActivities,
  serializeJobOrderProjectRequest,
} from "@/modules/requests/job-order-project-request";

/** Ticket row as loaded by the tickets PATCH route preamble. */
export type JobOrderExecutionTicket = Prisma.TicketGetPayload<{
  include: {
    assignedAgent: { select: { id: true; name: true; email: true; teamId: true } };
  };
}>;

type TicketWithAssignee = Prisma.TicketGetPayload<{
  include: { team: true; assignedAgent: true };
}>;

export type JobOrderExecutionOutcome = {
  ticket: TicketWithAssignee | null;
  meta?: JobOrderApprovalAssignees;
  extra?: Record<string, unknown>;
};

export async function handleSetJobOrderExecutionAssignee(args: {
  ticketId: string;
  ticket: JobOrderExecutionTicket;
  body: Record<string, unknown>;
  canStaffMutateTicket: boolean;
  roleIsAdmin: boolean;
  roleIsCompanyAdmin: boolean;
}): Promise<NextResponse | JobOrderExecutionOutcome> {
  const { ticketId: id, ticket, body, canStaffMutateTicket, roleIsAdmin, roleIsCompanyAdmin } = args;
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
    return { ticket: current, meta: pendingMeta };
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
  return { ticket: updated, meta: markedMeta };
}

export async function handleSetJobOrderWorkers(args: {
  ticketId: string;
  ticket: JobOrderExecutionTicket;
  session: Session;
  body: Record<string, unknown>;
  operatorAgentId: string | null;
  canStaffMutateTicket: boolean;
  roleIsAdmin: boolean;
  roleIsCompanyAdmin: boolean;
}): Promise<NextResponse | JobOrderExecutionOutcome> {
  const {
    ticketId: id,
    ticket,
    session,
    body,
    operatorAgentId,
    canStaffMutateTicket,
    roleIsAdmin,
    roleIsCompanyAdmin,
  } = args;
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
    (isJobOrderProcedureGreenLit(joMeta) ? ticket.assignedAgentId?.trim() : null) ||
    joMeta.pendingExecutionAssigneeAgentId?.trim() ||
    null;
  if (!executionAssigneeId) {
    return NextResponse.json(
      { error: "Assign an execution assignee before adding co-workers." },
      { status: 400 },
    );
  }
  const actingAsExecutionAssignee = await isSessionAssigneeOfTicket({
    operatorId: operatorAgentId ?? undefined,
    sessionEmail: session.user.email,
    ticket,
  });
  const actingAsPendingExecutionAssignee =
    Boolean(operatorAgentId) && operatorAgentId === executionAssigneeId;
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
  return { ticket: refreshed, meta: updatedMeta };
}

export async function handleSetJobOrderAssistanceTeam(args: {
  ticketId: string;
  ticket: JobOrderExecutionTicket;
  session: Session;
  body: Record<string, unknown>;
  operatorAgentId: string | null;
  canStaffMutateTicket: boolean;
  roleIsAdmin: boolean;
  roleIsCompanyAdmin: boolean;
}): Promise<NextResponse | JobOrderExecutionOutcome> {
  const {
    ticketId: id,
    ticket,
    session,
    body,
    operatorAgentId,
    canStaffMutateTicket,
    roleIsAdmin,
    roleIsCompanyAdmin,
  } = args;
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
    operatorId: operatorAgentId ?? undefined,
    sessionEmail: session.user.email,
    ticket,
  });
  const sectionRowsForHead = await prisma.$queryRaw<
    Array<{ org_chart_section_id: string | null }>
  >`
    SELECT org_chart_section_id FROM tickets WHERE id = ${id} LIMIT 1
  `;
  const sendToSectionIdForHead = sectionRowsForHead[0]?.org_chart_section_id?.trim() || null;
  const isSendToDepartmentHead = await isViewerOrgChartHeadForSection(
    session.user.email,
    sendToSectionIdForHead,
  );
  const canManageAssistance =
    roleIsAdmin || roleIsCompanyAdmin || actingAsCurrentApprover || isSendToDepartmentHead;
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
    return { ticket: refreshed, meta: cleared };
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
    (isJobOrderProcedureGreenLit(joMeta) ? ticket.assignedAgentId?.trim() : null) ||
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

  const candidateIds = [...(assigneeAgentId ? [assigneeAgentId] : []), ...workerAgentIds];
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
  return { ticket: refreshed, meta: updatedMeta };
}

export async function handleCompleteJobOrderExecution(args: {
  ticketId: string;
  ticket: JobOrderExecutionTicket;
  session: Session;
  operatorAgentId: string | null;
  canStaffMutateTicket: boolean;
  roleIsAdmin: boolean;
  roleIsCompanyAdmin: boolean;
}): Promise<NextResponse | JobOrderExecutionOutcome> {
  const {
    ticketId: id,
    ticket,
    session,
    operatorAgentId,
    canStaffMutateTicket,
    roleIsAdmin,
    roleIsCompanyAdmin,
  } = args;
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
    operatorId: operatorAgentId ?? undefined,
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
    : operatorAgentId
      ? [operatorAgentId]
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
          operatorAgentId ??
          null
        : operatorAgentId ?? null,
    actorIsExecutionAssignee:
      actingAsExecutionAssignee ||
      Boolean(
        operatorAgentId &&
          operatorAgentId === (joMeta.pendingExecutionAssigneeAgentId?.trim() || null),
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
    return { ticket: updated, meta: stampedMeta };
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
  return { ticket: updated, meta: stampedMeta };
}

export async function handleLinkJobOrderProject(args: {
  ticketId: string;
  body: Record<string, unknown>;
  canStaffMutateTicket: boolean;
}): Promise<NextResponse | JobOrderExecutionOutcome> {
  const { ticketId: id, body, canStaffMutateTicket } = args;
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
  return {
    ticket: updated,
    extra: {
      linkedProject: {
        id: result.project.id,
        title: result.project.title,
        mainTask: result.project.mainTask,
        itProjectName: result.project.itProjectName,
        displayName: projectDisplayName(result.project),
      },
    },
  };
}

export async function handleUnlinkJobOrderProject(args: {
  ticketId: string;
  canStaffMutateTicket: boolean;
}): Promise<NextResponse | JobOrderExecutionOutcome> {
  const { ticketId: id, canStaffMutateTicket } = args;
  if (!canStaffMutateTicket) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const result = await unlinkJobOrderFromProject({ ticketId: id, actor: "AGENT" });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const updated = await prisma.ticket.findUnique({
    where: { id },
    include: { team: true, assignedAgent: true },
  });
  return { ticket: updated, extra: { linkedProject: null } };
}

export async function handleRequestJobOrderProject(args: {
  ticketId: string;
  ticket: JobOrderExecutionTicket;
  session: Session;
  body: Record<string, unknown>;
  operatorAgentId: string | null;
  operatorName: string | null;
  isAssignedOperator: boolean;
  roleIsAdmin: boolean;
  roleIsCompanyAdmin: boolean;
}): Promise<NextResponse | JobOrderExecutionOutcome> {
  const {
    ticketId: id,
    ticket,
    session,
    body,
    operatorAgentId,
    operatorName,
    isAssignedOperator,
    roleIsAdmin,
    roleIsCompanyAdmin,
  } = args;
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
      requestedByAgentId: operatorAgentId,
      requestedByAgentName: operatorName ?? session.user.name ?? null,
      note,
    }),
  );

  const updated = await prisma.ticket.findUnique({
    where: { id },
    include: { team: true, assignedAgent: true },
  });
  return {
    ticket: updated,
    extra: {
      projectRequest: {
        pending: true,
        targetAdminAgentId: targetAdmin.id,
        targetAdminAgentName: targetAdmin.name,
        requestedByAgentId: operatorAgentId,
        requestedByAgentName: operatorName ?? session.user.name ?? null,
        note: note ?? null,
      },
    },
  };
}

export async function handleCancelJobOrderProjectRequest(args: {
  ticketId: string;
  operatorAgentId: string | null;
  isAssignedOperator: boolean;
  roleIsAdmin: boolean;
  roleIsCompanyAdmin: boolean;
}): Promise<NextResponse | JobOrderExecutionOutcome> {
  const { ticketId: id, operatorAgentId, isAssignedOperator, roleIsAdmin, roleIsCompanyAdmin } =
    args;
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
    operatorAgentId &&
    payload.requestedByAgentId !== operatorAgentId
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
  return { ticket: updated, extra: { projectRequest: { pending: false } } };
}
