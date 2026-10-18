import { isElevatedUserRole } from "@/modules/platform/auth";
import type { Prisma } from "@prisma/client/primary";
import type { Session } from "next-auth";
import { prisma } from "@/modules/platform/db/prisma";
import { findSessionAgentWithTeam } from "@/lib/session-agent";
import { portalCompanyAdminPrivilegesForEmail } from "@/lib/portal-staff";
import { rosterTeamNameFilter } from "@/lib/company-roster";
import { resolveStaffCompanyTeamId } from "@/modules/platform/scope/staff-company-scope";

export type TicketLogEntry = {
  id: string;
  createdAt: Date;
  actor: string;
  summary: string;
  detail: string | null;
  ticketNumber: string;
  ticketId: string;
};

async function rosterTeamIds(): Promise<string[]> {
  const teams = await prisma.team.findMany({
    where: rosterTeamNameFilter(),
    select: { id: true },
  });
  return teams.map((t) => t.id);
}

async function ticketScopeWhere(session: Session): Promise<Prisma.TicketWhereInput | null> {
  const role = session.user.role;
  const companyAdminPrivileges = await portalCompanyAdminPrivilegesForEmail(session.user.email);
  const operator = await findSessionAgentWithTeam({ email: session.user.email, name: session.user.name });
  const staffCompanyId = await resolveStaffCompanyTeamId(session.user.email);
  const rosterIds = await rosterTeamIds();
  if (rosterIds.length === 0) return null;

  const rosterTicket: Prisma.TicketWhereInput = { teamId: { in: rosterIds } };

  if (isElevatedUserRole(role)) {
    return rosterTicket;
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
