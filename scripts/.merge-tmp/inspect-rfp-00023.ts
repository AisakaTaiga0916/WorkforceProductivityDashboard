import { PrismaClient } from "@prisma/client/primary";

const prisma = new PrismaClient();

async function main() {
  const t = await prisma.ticket.findFirst({
    where: { ticketNumber: "REQ-2026-00023" },
    select: {
      id: true,
      ticketNumber: true,
      assignedAgentId: true,
      status: true,
      teamId: true,
      description: true,
      paymentApprovalMeta: true,
      assignedAgent: { select: { id: true, name: true, email: true } },
    },
  });
  console.log(JSON.stringify(t, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
