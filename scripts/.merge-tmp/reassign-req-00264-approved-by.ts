import { prisma } from "@/lib/prisma";

const TICKET = "REQ-2026-00264";
const FROM_ID = "cmrbdhqpo011011jos69ve29s"; // Lynneth Bautista Mangolayon
const TO_ID = "cmrpsn1rd0005glcqpl4lewk6"; // Riezel Cua Lelis

async function main() {
  const ticket = await prisma.ticket.findFirst({
    where: { ticketNumber: TICKET },
    select: {
      id: true,
      assignedAgentId: true,
      paymentApprovalMeta: true,
    },
  });
  if (!ticket) throw new Error(`Ticket ${TICKET} not found`);

  const meta = (ticket.paymentApprovalMeta ?? {}) as Record<string, unknown>;
  const nextMeta = {
    ...meta,
    approvedByAgentId: TO_ID,
  };

  const updated = await prisma.ticket.update({
    where: { id: ticket.id },
    data: {
      paymentApprovalMeta: nextMeta,
      ...(ticket.assignedAgentId === FROM_ID ? { assignedAgentId: TO_ID } : {}),
    },
    select: {
      ticketNumber: true,
      assignedAgentId: true,
      paymentApprovalMeta: true,
    },
  });

  await prisma.ticketActivity.create({
    data: {
      ticketId: ticket.id,
      actor: "SYSTEM",
      summary: "Approved By reassigned",
      detail: "Lynneth Bautista Mangolayon → Riezel Cua Lelis",
    },
  });

  console.log(JSON.stringify(updated, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
