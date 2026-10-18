import { prismaPrimary } from "../src/modules/platform/db/prisma";

async function main() {
  const total = await prismaPrimary.ticket.count();
  const counts = await prismaPrimary.ticket.groupBy({ by: ["status"], _count: true });
  const teams = await prismaPrimary.team.findMany({ select: { id: true, name: true } });
  const agents = await prismaPrimary.agent.findMany({
    select: { id: true, name: true, email: true, teamId: true },
    take: 10,
  });
  const portals = await prismaPrimary.portalAccount.findMany({
    select: { email: true, role: true, staffDesignatedCompanyId: true, companyId: true },
    take: 10,
  });
  const sample = await prismaPrimary.ticket.findMany({
    take: 5,
    orderBy: { createdAt: "desc" },
    select: {
      ticketNumber: true,
      status: true,
      teamId: true,
      assignedAgentId: true,
      contactEmail: true,
      createdAt: true,
    },
  });
  console.log(JSON.stringify({ total, counts, teams, agents, portals, sample }, null, 2));
}

main()
  .finally(() => prismaPrimary.$disconnect());
