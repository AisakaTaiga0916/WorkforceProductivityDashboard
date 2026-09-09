import { prisma } from "../../src/lib/prisma";
import {
  canAssignPaymentApprover,
  canCompletePaymentApprovalStep,
  parsePaymentApprovalMeta,
} from "../../src/lib/request-for-payment-approval";

async function main() {
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      ticket_number: string;
      assigned_agent_id: string | null;
      payment_approval_meta: unknown;
    }>
  >`
    SELECT id, ticket_number, assigned_agent_id, payment_approval_meta
    FROM tickets
    WHERE ticket_number = 'REQ-2026-00013'
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) {
    console.log("not found");
    return;
  }
  const meta = parsePaymentApprovalMeta(row.payment_approval_meta);
  const assigned = row.assigned_agent_id
    ? await prisma.agent.findUnique({
        where: { id: row.assigned_agent_id },
        select: { id: true, name: true, email: true },
      })
    : null;
  console.log(
    JSON.stringify(
      {
        ticket: row.ticket_number,
        assigned,
        meta,
        gateSelf: assigned
          ? canCompletePaymentApprovalStep({
              meta: meta!,
              actorAgentId: assigned.id,
              ticketAssignedAgentId: assigned.id,
            })
          : null,
        uniqueness: assigned
          ? canAssignPaymentApprover({
              meta: meta!,
              agentId: assigned.id,
              forStep: meta!.proceduralStep === "DONE" ? "NOTED_BY" : meta!.proceduralStep,
            })
          : null,
      },
      null,
      2,
    ),
  );

  // Duplicate agents for assigned email?
  if (assigned?.email) {
    const dups = await prisma.agent.findMany({
      where: { email: { equals: assigned.email, mode: "insensitive" } },
      select: { id: true, name: true, email: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
    console.log("dup agents", JSON.stringify(dups, null, 2));
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
