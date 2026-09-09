import { prisma } from "../../src/lib/prisma";

async function main() {
  const exact = await prisma.ticket.findMany({
    where: {
      OR: [
        { ticketNumber: { equals: "REQ-2026-00010", mode: "insensitive" } },
        { ticketNumber: { equals: "REQ-2026-0010", mode: "insensitive" } },
        { ticketNumber: { contains: "REQ-2026-00010", mode: "insensitive" } },
        { ticketNumber: { contains: "REQ-2026-0010", mode: "insensitive" } },
      ],
    },
    select: {
      id: true,
      ticketNumber: true,
      status: true,
      teamId: true,
      assignedAgentId: true,
      requestType: true,
      contactEmail: true,
      requestorEmail: true,
      closedAt: true,
      resolvedAt: true,
      createdAt: true,
      team: { select: { name: true } },
      assignedAgent: { select: { name: true, email: true } },
    },
  });
  console.log("matches", JSON.stringify(exact, null, 2));

  const openReqs = await prisma.ticket.findMany({
    where: { ticketNumber: { startsWith: "REQ-2026-" }, status: "OPEN" },
    select: { ticketNumber: true, status: true, teamId: true, assignedAgentId: true, requestType: true },
    orderBy: { ticketNumber: "asc" },
    take: 30,
  });
  console.log("open REQs", JSON.stringify(openReqs, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
