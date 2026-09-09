import { prisma } from "../../src/lib/prisma";
import { logActivity } from "../../src/lib/ticket-actions";

async function main() {
  const ticketNumber = "REQ-2026-00010";
  const ticket = await prisma.ticket.findUnique({
    where: { ticketNumber },
    select: {
      id: true,
      ticketNumber: true,
      status: true,
      feedback: { select: { csat: true } },
    },
  });
  if (!ticket) throw new Error(`Not found: ${ticketNumber}`);

  await prisma.ticketFeedback.deleteMany({ where: { ticketId: ticket.id } });
  const updated = await prisma.ticket.update({
    where: { id: ticket.id },
    data: { status: "OPEN", closedAt: null, resolvedAt: null },
    select: {
      ticketNumber: true,
      status: true,
      closedAt: true,
      resolvedAt: true,
      assignedAgentId: true,
      team: { select: { name: true } },
    },
  });
  await logActivity(
    ticket.id,
    "SYSTEM",
    "Status → OPEN",
    "Reopened so it appears on active assignment/table views.",
  );
  console.log(JSON.stringify({ before: ticket, after: updated }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
