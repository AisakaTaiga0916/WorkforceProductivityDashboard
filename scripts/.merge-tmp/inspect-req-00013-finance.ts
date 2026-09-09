import { prisma } from "../../src/lib/prisma";

async function main() {
  const ticket = await prisma.ticket.findFirst({
    where: { ticketNumber: "REQ-2026-00013" },
    select: {
      id: true,
      ticketNumber: true,
      status: true,
      assignedAgentId: true,
      paymentApprovalMeta: true,
      assignedAgent: { select: { id: true, name: true, email: true } },
    },
  });
  console.log("TICKET", JSON.stringify(ticket, null, 2));

  const agents = await prisma.agent.findMany({
    where: {
      OR: [
        { name: { contains: "Wyneth", mode: "insensitive" } },
        { name: { contains: "Queenie", mode: "insensitive" } },
        { name: { contains: "Tanutan", mode: "insensitive" } },
        { name: { contains: "Palabrica", mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true, email: true, teamId: true },
  });
  console.log("AGENTS", JSON.stringify(agents, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
