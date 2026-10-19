import type { TicketCategory } from "@prisma/client/primary";
import { prisma } from "@/modules/platform/db/prisma";

const CATEGORY_TEAM_HINT: Record<TicketCategory, string> = {
  IT: "IT Support",
  HR: "HR Services",
  FINANCE: "Finance Desk",
  OPERATIONS: "General Queue",
  GENERAL: "General Queue",
};

export async function resolveTeamForCategory(category: TicketCategory) {
  const hint = CATEGORY_TEAM_HINT[category];
  const team = await prisma.company.findFirst({
    where: { name: hint },
    include: { agents: true },
  });
  return team;
}

export async function pickAgentForTeam(teamId: string) {
  const agents = await prisma.agent.findMany({
    where: { teamId },
    select: {
      id: true,
      _count: {
        select: {
          tickets: {
            where: {
              status: { notIn: ["CLOSED"] },
            },
          },
        },
      },
    },
    orderBy: { name: "asc" },
  });
  if (agents.length === 0) return null;
  agents.sort((a, b) => a._count.tickets - b._count.tickets);
  return agents[0].id;
}
