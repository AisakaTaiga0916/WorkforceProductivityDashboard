import { isElevatedUserRole } from "@/lib/auth";
import type { Session } from "next-auth";
import { customerCanAccessTicket } from "@/lib/access";
import { findSessionAgentWithTeam } from "@/lib/session-agent";
import { prisma } from "@/lib/prisma";
import {
  adminOutsideCompanyScope,
  isCurrentProceduralStepAssignee,
  isSessionAssigneeOfTicket,
  isSessionJobOrderTeamMember,
  personnelForbiddenForTicket,
} from "@/lib/ticket-staff-access";

/** Aligns with GET /api/tickets/[id]: requestor, assignee/step, Admin company scope, SuperAdmin. */
export async function canAccessTicketScreenshot(
  session: Session | null,
  ticketRef: {
    id: string;
    contactEmail: string;
    requestorEmail: string | null;
    assignedAgentId: string | null;
    teamId: string | null;
  },
): Promise<boolean> {
  if (!session?.user) return false;
  const role = session.user.role;

  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketRef.id },
    select: {
      id: true,
      teamId: true,
      assignedAgentId: true,
      orgChartSectionId: true,
      contactEmail: true,
      requestorEmail: true,
      paymentApprovalMeta: true,
      itemRequisitionApprovalMeta: true,
      fundTransferApprovalMeta: true,
      jobOrderApprovalMeta: true,
      acaApprovalMeta: true,
      assignedAgent: { select: { email: true, teamId: true } },
    },
  });
  if (!ticket) return false;

  if (
    customerCanAccessTicket(
      { contactEmail: ticket.contactEmail, requestorEmail: ticket.requestorEmail },
      session.user.email,
    )
  ) {
    return true;
  }

  if (role === "Customer") return false;
  if (isElevatedUserRole(role)) return true;

  const operator = await findSessionAgentWithTeam({
    email: session.user.email,
    name: session.user.name,
  });

  if (
    await isSessionAssigneeOfTicket({
      operatorId: operator?.id,
      sessionEmail: session.user.email,
      ticket,
    })
  ) {
    return true;
  }

  if (isCurrentProceduralStepAssignee(ticket, operator?.id)) {
    return true;
  }

  // Job Order execution / assistance team (incl. duplicate Agent rows for same email).
  if (
    await isSessionJobOrderTeamMember({
      operatorId: operator?.id,
      sessionEmail: session.user.email,
      ticket,
    })
  ) {
    return true;
  }

  if (role === "Personnel") {
    return !(await personnelForbiddenForTicket({
      email: session.user.email,
      operatorId: operator?.id,
      ticket,
    }));
  }

  if (role === "Admin") {
    return !(await adminOutsideCompanyScope({
      role,
      email: session.user.email,
      ticketTeamId: ticket.teamId,
      ticket,
      operatorId: operator?.id,
    }));
  }

  return false;
}
