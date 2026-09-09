import { prisma } from "@/lib/prisma";

async function main() {
  const t = await prisma.ticket.findFirst({
    where: { ticketNumber: "REQ-2026-00264" },
    select: {
      id: true,
      ticketNumber: true,
      teamId: true,
      assignedAgentId: true,
      paymentApprovalMeta: true,
      team: { select: { id: true, name: true } },
      activities: {
        where: { summary: { in: ["Requesting company", "Request type"] } },
        select: { id: true, summary: true, detail: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  console.log("ticket", JSON.stringify(t, null, 2));

  const teams = await prisma.team.findMany({
    where: {
      OR: [
        { name: { contains: "MCHISI", mode: "insensitive" } },
        { name: { contains: "MICHISI", mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true },
  });
  console.log("teams", JSON.stringify(teams, null, 2));

  const meta = t?.paymentApprovalMeta as Record<string, unknown> | null;
  const agentIds = [
    meta?.notedByAgentId,
    meta?.approvedByAgentId,
    meta?.accountingAgentId,
    meta?.financeAgentId,
    meta?.preparedByAgentId,
    t?.assignedAgentId,
  ].filter((id): id is string => typeof id === "string" && Boolean(id.trim()));

  if (agentIds.length) {
    const agents = await prisma.agent.findMany({
      where: { id: { in: agentIds } },
      select: { id: true, name: true, email: true },
    });
    console.log("currentAgents", JSON.stringify(agents, null, 2));
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
