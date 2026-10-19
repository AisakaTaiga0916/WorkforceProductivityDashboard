import { isElevatedUserRole } from "@/modules/platform/auth";
import type { Prisma } from "@prisma/client/primary";
import type { Session } from "next-auth";
import { prisma } from "@/modules/platform/db/prisma";
import { findSessionAgentWithTeam } from "@/lib/session-agent";
import { portalCompanyAdminPrivilegesForEmail } from "@/lib/portal-staff";
import { listActiveCompanies } from "@/modules/platform/companies/company-directory";
import { resolveViewerCompanyId } from "@/modules/platform/scope/company-access";

export type TicketLogEntry = {
  id: string;
  createdAt: Date;
  actor: string;
  summary: string;
  detail: string | null;
  ticketNumber: string;
  ticketId: string;
};

async function ticketScopeWhere(session: Session): Promise<Prisma.TicketWhereInput | null> {
  const role = session.user.role;
  const companyAdminPrivileges = await portalCompanyAdminPrivilegesForEmail(session.user.email);
  const operator = await findSessionAgentWithTeam({ email: session.user.email, name: session.user.name });
  const staffCompanyId = await resolveViewerCompanyId(session);
  const rosterIds = (await listActiveCompanies()).map((t) => t.id);
  if (rosterIds.length === 0) return null;

  if (isElevatedUserRole(role)) {
    return staffCompanyId ? { teamId: staffCompanyId } : { teamId: { in: rosterIds } };
  }
  if (role === "Admin" || companyAdminPrivileges) {
    if (staffCompanyId && rosterIds.includes(staffCompanyId)) {
      return { teamId: staffCompanyId };
    }
    return null;
  }
  if (role === "Personnel") {
    if (!operator?.id) return null;
    return { assignedAgentId: operator.id, teamId: { in: rosterIds } };
  }
  return null;
}

/** Recent ticket activities scoped like the department board (roster departments only). */
export async function loadTicketActivityLogForSession(opts: {
  session: Session;
  limit?: number;
}): Promise<TicketLogEntry[]> {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 250);
  const ticketWhere = await ticketScopeWhere(opts.session);
  if (!ticketWhere) return [];

  const activities = await prisma.ticketActivity.findMany({
    where: { ticket: ticketWhere },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      createdAt: true,
      actor: true,
      summary: true,
      detail: true,
      ticketId: true,
      ticket: { select: { ticketNumber: true } },
    },
  });

  return activities.map((a) => ({
    id: a.id,
    createdAt: a.createdAt,
    actor: a.actor,
    summary: a.summary,
    detail: a.detail,
    ticketNumber: a.ticket.ticketNumber,
    ticketId: a.ticketId,
  }));
}
