import { prisma } from "../../src/lib/prisma";
import { adminOutsideCompanyScope } from "../../src/lib/ticket-staff-access";

async function main() {
  const ticket = await prisma.ticket.findFirst({
    where: { ticketNumber: "REQ-2026-00013" },
    include: { assignedAgent: { select: { email: true, teamId: true } } },
  });
  if (!ticket) throw new Error("missing");

  // Simulate Lynneth still being the board assignee (Noted By on send-to ticket).
  const asLynnethAssignee = {
    ...ticket,
    assignedAgentId: "cmrbdhqpo011011jos69ve29s",
    assignedAgent: {
      email: "lmangolayon@mconpincohomeimprovement.com",
      teamId: ticket.assignedAgent?.teamId ?? null,
    },
  };

  const blockedAsAssignee = await adminOutsideCompanyScope({
    role: "Admin",
    email: "lmangolayon@mconpincohomeimprovement.com",
    ticketTeamId: ticket.teamId,
    ticket: asLynnethAssignee,
    operatorId: "cmrbdhqpo011011jos69ve29s",
  });
  const blockedWhenNotAssignee = await adminOutsideCompanyScope({
    role: "Admin",
    email: "lmangolayon@mconpincohomeimprovement.com",
    ticketTeamId: ticket.teamId,
    ticket,
    operatorId: "cmrbdhqpo011011jos69ve29s",
  });
  console.log({ blockedAsAssignee, blockedWhenNotAssignee });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
