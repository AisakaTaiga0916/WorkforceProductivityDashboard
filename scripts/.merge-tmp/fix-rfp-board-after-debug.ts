import { prisma } from "../../src/lib/prisma";
import { adminOutsideCompanyScope } from "../../src/lib/ticket-staff-access";
import {
  currentPaymentStepBoardAssigneeId,
  parsePaymentApprovalMeta,
} from "../../src/lib/request-for-payment-approval";

async function main() {
  const ticket = await prisma.ticket.findFirst({
    where: { ticketNumber: "REQ-2026-00013" },
    include: {
      assignedAgent: { select: { email: true, teamId: true } },
    },
  });
  if (!ticket) throw new Error("missing ticket");
  const meta = parsePaymentApprovalMeta(ticket.paymentApprovalMeta);
  const nextId = meta ? currentPaymentStepBoardAssigneeId(meta) : null;
  console.log("before", {
    step: meta?.proceduralStep,
    assigned: ticket.assignedAgentId,
    nextShouldBe: nextId,
  });

  if (nextId && nextId !== ticket.assignedAgentId) {
    await prisma.ticket.update({
      where: { id: ticket.id },
      data: { assignedAgent: { connect: { id: nextId } } },
    });
    console.log("reassigned board to", nextId);
  }

  const refreshed = await prisma.ticket.findUnique({
    where: { id: ticket.id },
    include: { assignedAgent: { select: { email: true, teamId: true } } },
  });

  // Lynneth was noted-by; verify she would no longer be blocked if still assignee
  const lynnethBlocked = await adminOutsideCompanyScope({
    role: "Admin",
    email: "lmangolayon@mconpincohomeimprovement.com",
    ticketTeamId: refreshed!.teamId,
    ticket: refreshed!,
    operatorId: "cmrbdhqpo011011jos69ve29s",
  });
  const riezelBlocked = await adminOutsideCompanyScope({
    role: "Admin",
    email: "lelisriezel@gmail.com",
    ticketTeamId: refreshed!.teamId,
    ticket: refreshed!,
    operatorId: nextId,
  });
  console.log({
    afterAssigned: refreshed?.assignedAgentId,
    lynnethBlockedIfAssignee: lynnethBlocked,
    riezelBlockedAsAssignee: riezelBlocked,
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
