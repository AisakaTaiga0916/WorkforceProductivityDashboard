import { prisma } from "@/lib/prisma";

const TO_ID = "cmrpsn1rd0005glcqpl4lewk6"; // Riezel Cua Lelis

async function main() {
  const ticket = await prisma.ticket.findFirst({
    where: {
      OR: [
        { ticketNumber: "REQ-2026-00314" },
        { ticketNumber: { endsWith: "00314" } },
      ],
    },
    select: {
      id: true,
      ticketNumber: true,
      assignedAgentId: true,
      paymentApprovalMeta: true,
      title: true,
    },
  });
  if (!ticket) throw new Error("Ticket ending in 00314 not found");

  const meta = (ticket.paymentApprovalMeta ?? {}) as Record<string, unknown>;
  if (!meta || typeof meta !== "object") {
    throw new Error(`${ticket.ticketNumber} has no paymentApprovalMeta`);
  }

  const prevApproved = typeof meta.approvedByAgentId === "string" ? meta.approvedByAgentId : null;
  const nextMeta = {
    ...meta,
    approvedByAgentId: TO_ID,
  };

  const shouldMoveBoard =
    ticket.assignedAgentId &&
    (ticket.assignedAgentId === prevApproved || meta.proceduralStep === "APPROVED_BY");

  const updated = await prisma.ticket.update({
    where: { id: ticket.id },
    data: {
      paymentApprovalMeta: nextMeta,
      ...(shouldMoveBoard ? { assignedAgentId: TO_ID } : {}),
    },
    select: {
      ticketNumber: true,
      assignedAgentId: true,
      paymentApprovalMeta: true,
    },
  });

  let prevName = prevApproved;
  if (prevApproved) {
    const a = await prisma.agent.findUnique({
      where: { id: prevApproved },
      select: { name: true },
    });
    prevName = a?.name ?? prevApproved;
  }

  await prisma.ticketActivity.create({
    data: {
      ticketId: ticket.id,
      actor: "SYSTEM",
      summary: "Approved By reassigned",
      detail: `${prevName ?? "—"} → Riezel Cua Lelis`,
    },
  });

  console.log(JSON.stringify({ before: ticket, after: updated }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
