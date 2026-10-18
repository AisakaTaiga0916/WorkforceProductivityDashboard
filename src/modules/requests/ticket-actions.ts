import type { ActivityActor, Ticket } from "@prisma/client/primary";
import { prisma } from "@/modules/platform/db/prisma";

export async function logActivity(
  ticketId: string,
  actor: ActivityActor,
  summary: string,
  detail?: string,
) {
  await prisma.ticketActivity.create({
    data: { ticketId, actor, summary, detail },
  });
}

export async function touchFirstResponse(ticket: Ticket, actor: ActivityActor) {
  if (ticket.firstResponseAt) return ticket;
  const updated = await prisma.ticket.update({
    where: { id: ticket.id },
    data: { firstResponseAt: new Date() },
  });
  await logActivity(
    ticket.id,
    actor,
    "First response recorded",
    "SLA first-response clock stops from this point.",
  );
  return updated;
}
