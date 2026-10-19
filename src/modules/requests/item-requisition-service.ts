import type { Prisma } from "@prisma/client/primary";
import type { Session } from "next-auth";
import { NextResponse } from "next/server";
import { isElevatedUserRole } from "@/modules/platform/auth";
import { permissionDenied } from "@/modules/platform/rbac/permissions";
import { prisma } from "@/modules/platform/db/prisma";
import {
  resolveAgentCompanyIds,
  resolveStaffCompanyTeamId,
} from "@/modules/platform/scope/staff-company-scope";
import {
  resolveAgentIdForPositionCode,
  resolveMergedSourceUserIdForSessionEmail,
} from "@/modules/platform/approvals/approval-position-resolver";
import { loadTicketRequestType } from "@/modules/requests/ticket-request-type";
import { logActivity } from "@/modules/requests/ticket-actions";
import { sendResolutionEmail } from "@/lib/email";
import { proceduralBoardAssigneeWrite } from "@/modules/requests/procedural-board-assignee";
import {
  applyRequisitionPricingDerivedFields,
  formatItemRequisitionDescription,
  parseItemRequisitionDescription,
  parseRequisitionItemsPayload,
  validateItemRequisitionPricing,
} from "@/modules/requests/item-requisition";
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
} from "@/modules/requests/item-requisition-approval";
import {
  initItemRequisitionApprovalMetaIfNeeded,
  saveItemRequisitionApprovalMeta,
} from "@/modules/requests/item-requisition-approval-db";

/** Ticket row as loaded by the tickets PATCH route preamble. */
export type ItemRequisitionServiceTicket = Prisma.TicketGetPayload<{
  include: {
    assignedAgent: { select: { id: true; name: true; email: true; teamId: true } };
  };
}>;

type TicketWithAssignee = Prisma.TicketGetPayload<{
  include: { team: true; assignedAgent: true };
}>;

export type ItemRequisitionOutcome = {
  ticket: TicketWithAssignee | null;
  meta?: ItemRequisitionApprovalAssignees;
};

export async function handleSetItemRequisitionApprovalAssignees(args: {
  ticketId: string;
  ticket: ItemRequisitionServiceTicket;
  session: Session;
  body: Record<string, unknown>;
}): Promise<NextResponse | ItemRequisitionOutcome> {
  const { ticketId: id, ticket, session, body } = args;
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
  return { ticket: refreshed, meta: updatedMeta };
}

export async function handleRequestItemRequisitionApproval(args: {
  ticketId: string;
  ticket: ItemRequisitionServiceTicket;
  body: Record<string, unknown>;
  operatorAgentId: string | null;
  isAssignedOperator: boolean;
  canStaffMutateTicket: boolean;
  roleIsAdmin: boolean;
  roleIsCompanyAdmin: boolean;
}): Promise<NextResponse | ItemRequisitionOutcome> {
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
      { error: "Only the assigned personnel can request the next item requisition approval." },
      { status: 403 },
    );
  }
  if (!operatorAgentId) {
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
  const companyAnchorId = ticket.assignedAgentId ?? operatorAgentId;
  const [requesterCompanyIds, approverCompanyIds] = await Promise.all([
    resolveAgentCompanyIds(companyAnchorId),
    resolveAgentCompanyIds(approverId),
  ]);
  if (!requesterCompanyIds.some((cid) => approverCompanyIds.includes(cid))) {
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
  return { ticket: updated, meta: updatedMeta };
}

export async function handleUpdateItemRequisitionPricing(args: {
  ticketId: string;
  ticket: ItemRequisitionServiceTicket;
  session: Session;
  body: Record<string, unknown>;
  operatorAgentId: string | null;
  isAdminOrAgent: boolean;
}): Promise<NextResponse | ItemRequisitionOutcome> {
  const { ticketId: id, ticket, session, body, operatorAgentId, isAdminOrAgent } = args;
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
  if (!ticket.assignedAgentId || operatorAgentId !== ticket.assignedAgentId) {
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
    const approveBlock = await permissionDenied(session, "requests.approve");
    if (approveBlock) return approveBlock;
    const gate = canCompleteItemRequisitionApprovalStep({
      meta,
      actorAgentId: operatorAgentId,
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
    return { ticket: updated, meta: advanced };
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
  return { ticket: updated };
}

export async function handleUndoItemRequisitionCanvass(args: {
  ticketId: string;
  session: Session;
}): Promise<NextResponse | ItemRequisitionOutcome> {
  const { ticketId: id, session } = args;
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
  return { ticket: refreshed, meta: undone.meta };
}

export async function handleCompleteItemRequisitionApprovalStep(args: {
  ticketId: string;
  ticket: ItemRequisitionServiceTicket;
  session: Session;
  body: Record<string, unknown>;
  operatorAgentId: string | null;
  isAdminOrAgent: boolean;
}): Promise<NextResponse | ItemRequisitionOutcome> {
  const { ticketId: id, ticket, session, body, operatorAgentId, isAdminOrAgent } = args;
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
  const approveBlock = await permissionDenied(session, "requests.approve");
  if (approveBlock) return approveBlock;
  const gate = canCompleteItemRequisitionApprovalStep({
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

  return { ticket: updated, meta: advanced };
}
