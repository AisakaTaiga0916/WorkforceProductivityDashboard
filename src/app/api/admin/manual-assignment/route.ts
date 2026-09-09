import { isElevatedUserRole } from "@/lib/auth";
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { isStaffPortalRole } from "@/lib/staff-role";
import { logActivity, touchFirstResponse } from "@/lib/ticket-actions";
import {
  applyPaymentApprovalAssignees,
  assigneeFieldForStep,
  canAssignPaymentApprover,
  PAYMENT_APPROVAL_STEP_LABELS,
  paymentProceduralStatusLabel,
} from "@/lib/request-for-payment-approval";
import {
  initPaymentApprovalMetaIfNeeded,
  savePaymentApprovalMeta,
} from "@/lib/payment-approval-db";
import {
  applyItemRequisitionApprovalAssignees,
  ITEM_REQUISITION_APPROVAL_STEP_LABELS,
  itemRequisitionProceduralStatusLabel,
} from "@/lib/item-requisition-approval";
import {
  initItemRequisitionApprovalMetaIfNeeded,
  saveItemRequisitionApprovalMeta,
} from "@/lib/item-requisition-approval-db";
import {
  applyFundTransferApprovalAssignees,
  fundTransferAssigneeFieldForStep,
  FUND_TRANSFER_APPROVAL_STEP_LABELS,
  fundTransferProceduralStatusLabel,
} from "@/lib/fund-transfer-approval";
import {
  initFundTransferApprovalMetaIfNeeded,
  saveFundTransferApprovalMeta,
} from "@/lib/fund-transfer-approval-db";
import {
  applyJobOrderApprovalAssignees,
  jobOrderAssigneeFieldForStep,
  JOB_ORDER_APPROVAL_STEP_LABELS,
  jobOrderProceduralStatusLabel,
  markJobOrderExecutionAssigned,
} from "@/lib/job-order-approval";
import {
  initJobOrderApprovalMetaIfNeeded,
  saveJobOrderApprovalMeta,
} from "@/lib/job-order-approval-db";
import {
  resolveViewerOrgChartSectionScope,
  roleUsesCompanyDepartmentTaskAssignScope,
} from "@/lib/org-chart-section-scope";
import {
  resolveAgentDesignatedCompanyId,
  resolveStaffCompanyTeamId,
} from "@/lib/staff-company-scope";

type AssignBody = {
  ticketId?: string;
  agentId?: string;
  portalAccountId?: string;
};

async function getDefaultTeamId() {
  const teams = await prisma.team.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
  const preferred = teams.find((t) => t.name.toLowerCase().includes("general"));
  return preferred?.id ?? teams[0]?.id ?? null;
}

export async function POST(req: Request) {
  const session = await requireSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const isSuperAdmin = isElevatedUserRole(session.user.role);
  const isJwtAdmin = session.user.role === "Admin";

  if (!(isSuperAdmin || isJwtAdmin)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = (await req.json()) as AssignBody;
    const ticketId = body.ticketId?.trim();
    const agentId = body.agentId?.trim();
    const portalAccountId = body.portalAccountId?.trim();
    if (!ticketId || (!portalAccountId && !agentId)) {
      return NextResponse.json({ error: "ticketId and (agentId or portalAccountId) are required." }, { status: 400 });
    }

    const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });

    if (!ticket) return NextResponse.json({ error: "Ticket not found." }, { status: 404 });

    const companyDeptLock =
      roleUsesCompanyDepartmentTaskAssignScope(session.user.role) && !isSuperAdmin;
    const adminCompanyId = companyDeptLock
      ? await resolveStaffCompanyTeamId(session.user.email)
      : null;
    let sectionScope: Awaited<ReturnType<typeof resolveViewerOrgChartSectionScope>> | null =
      null;
    if (companyDeptLock) {
      if (!adminCompanyId) {
        return NextResponse.json(
          { error: "You can only assign tickets in your designated company." },
          { status: 403 },
        );
      }
      sectionScope = await resolveViewerOrgChartSectionScope(session.user.email);
      const ticketSectionId = (ticket.orgChartSectionId ?? "").trim();
      const inDepartment =
        Boolean(ticketSectionId) && sectionScope.sectionIds.includes(ticketSectionId);
      // Align with Assign Requests list: department membership is the primary gate.
      // Ticket.teamId can differ from the Admin's designated company when the same
      // org-chart department receives work for another company (e.g. NEO on ALI while
      // the Admin's designated company is AGC).
      if (sectionScope.sectionIds.length > 0) {
        if (!inDepartment) {
          return NextResponse.json(
            {
              error:
                "You can only assign tickets in your designated org-chart department.",
            },
            { status: 403 },
          );
        }
      } else if (ticket.teamId !== adminCompanyId) {
        return NextResponse.json(
          { error: "You can only assign tickets in your designated company." },
          { status: 403 },
        );
      }
    }
    let agent = null as null | { id: string; name: string; email: string; teamId: string };
    if (agentId) {
      const direct = await prisma.agent.findUnique({
        where: { id: agentId },
        select: {
          id: true,
          name: true,
          email: true,
          teamId: true,
          team: { select: { name: true } },
        },
      });
      if (!direct) return NextResponse.json({ error: "Personnel not found." }, { status: 404 });
      const targetPortal = await prisma.portalAccount.findFirst({
        where: { email: { equals: direct.email, mode: "insensitive" } },
        select: { role: true },
      });
      if (!isStaffPortalRole(targetPortal?.role)) {
        return NextResponse.json({ error: "You can assign only to staff agents." }, { status: 403 });
      }
      agent = direct;
    } else {
      const account = await prisma.portalAccount.findUnique({
        where: { id: portalAccountId! },
        select: { id: true, name: true, email: true, role: true },
      });
      if (!account) return NextResponse.json({ error: "Personnel account not found." }, { status: 404 });
      if (!isStaffPortalRole(account.role)) {
        return NextResponse.json({ error: "Account must use a staff role." }, { status: 400 });
      }

      const defaultTeamId = await getDefaultTeamId();
      if (!defaultTeamId) {
        return NextResponse.json({ error: "Create at least one team before assigning." }, { status: 400 });
      }

      const existing = await prisma.agent.findUnique({ where: { email: account.email } });
      agent =
        existing ??
        (await prisma.agent.create({
          data: {
            name: account.name,
            email: account.email,
            teamId: defaultTeamId,
          },
        }));
    }

    if (companyDeptLock) {
      const agentCompanyId = await resolveAgentDesignatedCompanyId(agent.id);
      const inDepartmentRoster = Boolean(
        sectionScope?.agentIds.includes(agent.id),
      );
      // Allow company roster or org-chart department roster (list page merges both).
      if (
        !adminCompanyId ||
        (agentCompanyId !== adminCompanyId && !inDepartmentRoster)
      ) {
        return NextResponse.json(
          { error: "You can only assign to personnel in your designated company." },
          { status: 403 },
        );
      }
    }

    const updated = await prisma.ticket.update({
      where: { id: ticketId },
      data: {
        assignedAgentId: agent.id,
        ...(ticket.status === "ESCALATED" ? { status: "IN_PROGRESS" as const } : {}),
      },
      include: {
        assignedAgent: true,
        team: true,
      },
    });

    await touchFirstResponse(ticket, "AGENT");
    await logActivity(
      ticketId,
      "AGENT",
      "Manual assignment",
      `Assigned to ${updated.assignedAgent?.name ?? agent.name}`,
    );
    if (ticket.status === "ESCALATED") {
      await logActivity(
        ticketId,
        "SYSTEM",
        "Transfer approved",
        `Reassigned from Transfer pending pool to ${updated.assignedAgent?.name ?? agent.name}.`,
      );
    }

    // RFP / IRS: board assignee becomes the current procedural approver for this cycle.
    let assignedAgentIdAfterSync: string | null = updated.assignedAgentId;
    let assignedAgentNameAfterSync: string | null = updated.assignedAgent?.name ?? agent.name;
    try {
      const requestTypeRows = await prisma.$queryRaw<Array<{ request_type: string | null }>>`
        SELECT request_type FROM tickets WHERE id = ${ticketId} LIMIT 1
      `;
      const requestType = (requestTypeRows[0]?.request_type ?? "").trim();
      if (requestType === "REQUEST_FOR_PAYMENT") {
        const meta = await initPaymentApprovalMetaIfNeeded(ticketId);
        if (meta.proceduralStep !== "DONE") {
          const uniqueness = canAssignPaymentApprover({
            meta,
            agentId: agent.id,
            forStep: meta.proceduralStep,
          });
          if (!uniqueness.ok) {
            return NextResponse.json({ error: uniqueness.error }, { status: 400 });
          }
          const field = assigneeFieldForStep(meta.proceduralStep);
          const nextMeta = applyPaymentApprovalAssignees(meta, { [field]: agent.id });
          await savePaymentApprovalMeta(ticketId, nextMeta);
          const pending = paymentProceduralStatusLabel(nextMeta.proceduralStep);
          await logActivity(
            ticketId,
            "SYSTEM",
            `Assigned for ${PAYMENT_APPROVAL_STEP_LABELS[meta.proceduralStep]}`,
            pending
              ? `${updated.assignedAgent?.name ?? agent.name} · ${pending}`
              : (updated.assignedAgent?.name ?? agent.name),
          );
        }
      } else if (requestType === "ITEM_REQUISITION_SLIP") {
        const meta = await initItemRequisitionApprovalMetaIfNeeded(ticketId);
        if (meta.proceduralStep === "CANVASSED_BY") {
          // Assignment Board assignee becomes Canvassed By.
          const nextMeta = applyItemRequisitionApprovalAssignees(meta, {
            canvassedByAgentId: agent.id,
          });
          await saveItemRequisitionApprovalMeta(ticketId, nextMeta);
          const pending = itemRequisitionProceduralStatusLabel(nextMeta.proceduralStep);
          await logActivity(
            ticketId,
            "SYSTEM",
            "Assigned as Canvassed By",
            pending
              ? `${updated.assignedAgent?.name ?? agent.name} · ${pending}`
              : (updated.assignedAgent?.name ?? agent.name),
          );
        } else if (meta.proceduralStep === "APPROVED_BY") {
          // Approved By is company-based (requestor company). Board assign only routes the ticket.
          if (meta.approvedByAgentId && meta.approvedByAgentId !== agent.id) {
            return NextResponse.json(
              {
                error:
                  "Approved By is set from the requestor’s company. Assign this request to that Approved By person, or update Approved By in Ticket Controls.",
              },
              { status: 400 },
            );
          }
          if (!meta.approvedByAgentId) {
            const nextMeta = applyItemRequisitionApprovalAssignees(meta, {
              approvedByAgentId: agent.id,
            });
            await saveItemRequisitionApprovalMeta(ticketId, nextMeta);
          }
          await logActivity(
            ticketId,
            "SYSTEM",
            `Assigned for ${ITEM_REQUISITION_APPROVAL_STEP_LABELS.APPROVED_BY}`,
            updated.assignedAgent?.name ?? agent.name,
          );
        }
      } else if (requestType === "FUND_TRANSFER_REQUEST") {
        const meta = await initFundTransferApprovalMetaIfNeeded(ticketId);
        if (meta.proceduralStep !== "DONE") {
          const field = fundTransferAssigneeFieldForStep(meta.proceduralStep);
          const nextMeta = applyFundTransferApprovalAssignees(meta, { [field]: agent.id });
          await saveFundTransferApprovalMeta(ticketId, nextMeta);
          const pending = fundTransferProceduralStatusLabel(nextMeta.proceduralStep);
          await logActivity(
            ticketId,
            "SYSTEM",
            `Assigned for ${FUND_TRANSFER_APPROVAL_STEP_LABELS[meta.proceduralStep]}`,
            pending
              ? `${updated.assignedAgent?.name ?? agent.name} · ${pending}`
              : (updated.assignedAgent?.name ?? agent.name),
          );
        }
      } else if (requestType === "JOB_ORDER") {
        const meta = await initJobOrderApprovalMetaIfNeeded(ticketId);
        if (meta.proceduralStep !== "DONE") {
          const field = jobOrderAssigneeFieldForStep(meta.proceduralStep);
          const nextMeta = applyJobOrderApprovalAssignees(meta, { [field]: agent.id });
          await saveJobOrderApprovalMeta(ticketId, nextMeta);
          const pending = jobOrderProceduralStatusLabel(nextMeta.proceduralStep);
          await logActivity(
            ticketId,
            "SYSTEM",
            `Assigned for ${JOB_ORDER_APPROVAL_STEP_LABELS[meta.proceduralStep]}`,
            pending
              ? `${updated.assignedAgent?.name ?? agent.name} · ${pending}`
              : (updated.assignedAgent?.name ?? agent.name),
          );
        } else {
          await saveJobOrderApprovalMeta(
            ticketId,
            markJobOrderExecutionAssigned({
              ...meta,
              pendingExecutionAssigneeAgentId: null,
            }),
          );
          await logActivity(
            ticketId,
            "SYSTEM",
            "Job order execution assignee set",
            `${updated.assignedAgent?.name ?? agent.name} assigned for execution.`,
          );
          if (ticket.status === "FOR_CONFIRMATION" || ticket.status === "OPEN" || ticket.status === "PENDING_INFO") {
            await prisma.ticket.update({
              where: { id: ticketId },
              data: { status: "IN_PROGRESS", resolvedAt: null },
            });
          }
        }
      }
    } catch (e) {
      console.warn("Procedural assignee sync after board assign failed", e);
    }

    return NextResponse.json({
      ok: true,
      ticketId,
      assignedAgentId: assignedAgentIdAfterSync,
      assignedAgentName: assignedAgentNameAfterSync,
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Could not assign ticket." }, { status: 500 });
  }
}
