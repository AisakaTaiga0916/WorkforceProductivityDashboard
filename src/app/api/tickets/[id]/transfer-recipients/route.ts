import { NextResponse } from "next/server";
import { requireSession } from "@/lib/access";
import { prisma } from "@/modules/platform/db/prisma";
import { findSessionAgentWithTeam } from "@/lib/session-agent";
import { loadAgentIdsForCompanyTeam } from "@/modules/platform/scope/staff-company-scope";

/**
 * GET /api/tickets/[id]/transfer-recipients
 * Company colleagues the current assignee can transfer this request to.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const ticket = await prisma.ticket.findUnique({
    where: { id },
    select: {
      id: true,
      teamId: true,
      assignedAgentId: true,
      assignedAgent: { select: { teamId: true } },
    },
  });
  if (!ticket) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const operator = await findSessionAgentWithTeam({ email: session.user.email, name: session.user.name });
  if (!operator || operator.id !== ticket.assignedAgentId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const companyTeamId = ticket.teamId ?? ticket.assignedAgent?.teamId ?? operator.teamId;
  if (!companyTeamId) {
    return NextResponse.json({ recipients: [] });
  }

  const agentIds = await loadAgentIdsForCompanyTeam(companyTeamId);
  const recipients =
    agentIds.length === 0
      ? []
      : await prisma.agent.findMany({
          where: {
            id: {
              in: agentIds.filter((aid) => aid !== ticket.assignedAgentId),
            },
          },
          orderBy: { name: "asc" },
          select: { id: true, name: true, email: true },
        });

  return NextResponse.json({ recipients });
}
