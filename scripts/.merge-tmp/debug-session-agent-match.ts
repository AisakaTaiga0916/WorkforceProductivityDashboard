import { prisma } from "../../src/lib/prisma";
import { findSessionAgentWithTeam } from "../../src/lib/session-agent";

async function main() {
  const rows = await prisma.$queryRaw<
    Array<{
      ticket_number: string;
      status: string;
      assigned_agent_id: string | null;
      step: string | null;
      noted: string | null;
      approved: string | null;
      completed: unknown;
    }>
  >`
    SELECT ticket_number, status::text as status, assigned_agent_id,
           payment_approval_meta->>'proceduralStep' as step,
           payment_approval_meta->>'notedByAgentId' as noted,
           payment_approval_meta->>'approvedByAgentId' as approved,
           payment_approval_meta->'completed' as completed
    FROM tickets
    WHERE request_type = 'REQUEST_FOR_PAYMENT'
      AND payment_approval_meta IS NOT NULL
    ORDER BY created_at DESC
    LIMIT 15
  `;
  console.log(JSON.stringify(rows, null, 2));

  for (const row of rows.slice(0, 5)) {
    if (!row.assigned_agent_id) continue;
    const agent = await prisma.agent.findUnique({
      where: { id: row.assigned_agent_id },
      select: { id: true, email: true, name: true },
    });
    if (!agent) continue;
    const viaUnique = await prisma.agent.findUnique({
      where: { email: agent.email.trim().toLowerCase() },
      select: { id: true },
    });
    const viaSession = await findSessionAgentWithTeam({
      email: agent.email.trim().toLowerCase(),
      name: agent.name,
    });
    const viaSessionMixed = await findSessionAgentWithTeam({
      email: agent.email,
      name: agent.name,
    });
    console.log({
      ticket: row.ticket_number,
      step: row.step,
      agentEmail: agent.email,
      pageWouldGet: viaUnique?.id,
      apiWouldGet: viaSession?.id,
      apiWithRawEmail: viaSessionMixed?.id,
      match: viaUnique?.id === viaSession?.id && viaSession?.id === agent.id,
    });
  }

  // Agents whose email casing differs from lowercased form
  const casing = await prisma.$queryRaw<Array<{ id: string; email: string }>>`
    SELECT id, email FROM agents WHERE email <> lower(email) LIMIT 20
  `;
  console.log("mixed-case emails", casing.length, casing.slice(0, 5));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
