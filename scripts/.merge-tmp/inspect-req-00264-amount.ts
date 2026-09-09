import { prisma } from "@/lib/prisma";

async function main() {
  const ticket = await prisma.ticket.findFirst({
    where: { ticketNumber: "REQ-2026-00264" },
    select: {
      id: true,
      title: true,
      description: true,
      paymentApprovalMeta: true,
    },
  });
  console.log(JSON.stringify(ticket, null, 2));

  const agents = await prisma.agent.findMany({
    where: {
      OR: [
        { name: { contains: "Galapin", mode: "insensitive" } },
        { name: { contains: "Madarag", mode: "insensitive" } },
        { name: { contains: "Michael", mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true, email: true },
    take: 30,
  });
  console.log("agents", JSON.stringify(agents, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
