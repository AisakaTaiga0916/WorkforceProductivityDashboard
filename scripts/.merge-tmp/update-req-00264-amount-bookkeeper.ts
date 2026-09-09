import { prisma } from "@/lib/prisma";

const TICKET = "REQ-2026-00264";
const BOOKKEEPER_ID = "cmrpro8a3002j10lf3uguet0d"; // michael madarang galapin
const OLD_AMOUNT = "₱14,000.00";
const NEW_AMOUNT = "₱10,500.00";

async function main() {
  const ticket = await prisma.ticket.findFirst({
    where: { ticketNumber: TICKET },
    select: {
      id: true,
      title: true,
      description: true,
      paymentApprovalMeta: true,
    },
  });
  if (!ticket) throw new Error(`Ticket ${TICKET} not found`);

  const title = ticket.title.replace(OLD_AMOUNT, NEW_AMOUNT);
  const description = (ticket.description ?? "").replace(OLD_AMOUNT, NEW_AMOUNT);
  if (!title.includes(NEW_AMOUNT) || !description.includes(NEW_AMOUNT)) {
    throw new Error("Could not locate old amount ₱14,000.00 in title/description");
  }

  const meta = (ticket.paymentApprovalMeta ?? {}) as Record<string, unknown>;
  const nextMeta = {
    ...meta,
    accountingAgentId: BOOKKEEPER_ID,
  };

  const updated = await prisma.ticket.update({
    where: { id: ticket.id },
    data: {
      title,
      description,
      paymentApprovalMeta: nextMeta,
    },
    select: {
      ticketNumber: true,
      title: true,
      description: true,
      paymentApprovalMeta: true,
    },
  });

  await prisma.ticketActivity.create({
    data: {
      ticketId: ticket.id,
      actor: "SYSTEM",
      summary: "Payment request updated",
      detail: "Amount ₱14,000.00 → ₱10,500.00; Bookkeeper → michael madarang galapin",
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
