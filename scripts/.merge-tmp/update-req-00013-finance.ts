import { prisma } from "../../src/lib/prisma";

const TICKET_NUMBER = "REQ-2026-00013";
/** Tanutan, Wyneth Maxine Deaño — selected in Ticket Controls */
const NEW_FINANCE_AGENT_ID = "cmrpyre14001f12w5bs5uvrfh";

async function main() {
  const ticket = await prisma.ticket.findFirst({
    where: { ticketNumber: TICKET_NUMBER },
    select: {
      id: true,
      ticketNumber: true,
      assignedAgentId: true,
      paymentApprovalMeta: true,
    },
  });
  if (!ticket) throw new Error(`Ticket ${TICKET_NUMBER} not found`);

  const meta =
    ticket.paymentApprovalMeta && typeof ticket.paymentApprovalMeta === "object"
      ? structuredClone(ticket.paymentApprovalMeta as Record<string, unknown>)
      : {};

  const previous = meta.financeAgentId;
  meta.financeAgentId = NEW_FINANCE_AGENT_ID;

  // Queenie already clicked Approved — new assignee must approve again.
  const stepApproved =
    meta.stepApproved && typeof meta.stepApproved === "object"
      ? { ...(meta.stepApproved as Record<string, unknown>) }
      : {};
  delete stepApproved.APPROVED_BY_FINANCE;
  meta.stepApproved = stepApproved;

  const agent = await prisma.agent.findUnique({
    where: { id: NEW_FINANCE_AGENT_ID },
    select: { id: true, name: true, email: true },
  });
  if (!agent) throw new Error(`Agent ${NEW_FINANCE_AGENT_ID} not found`);

  await prisma.ticket.update({
    where: { id: ticket.id },
    data: {
      paymentApprovalMeta: meta,
      assignedAgentId: NEW_FINANCE_AGENT_ID,
      status: "IN_PROGRESS",
      resolvedAt: null,
    },
  });

  await prisma.ticketActivity.create({
    data: {
      ticketId: ticket.id,
      actor: "AGENT",
      summary: "Approval requested · APPROVED BY ACCOUNTING",
      detail: `Approved By Accounting reassigned to ${agent.name}. Assigned for next step.`,
    },
  });

  console.log(
    JSON.stringify(
      {
        ticketNumber: ticket.ticketNumber,
        previousFinanceAgentId: previous,
        previousAssignedAgentId: ticket.assignedAgentId,
        newFinanceAgentId: NEW_FINANCE_AGENT_ID,
        newFinanceAgent: agent,
        clearedFinanceApprovedAck: true,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
