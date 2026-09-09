import { prismaPrimary } from "../../src/lib/prisma";

async function main() {
  const portal = await prismaPrimary.portalAccount.findUnique({
    where: { id: "930280cb-3734-41da-ba5a-dd1b1bb52623" },
    select: { accountStatus: true, username: true, email: true },
  });
  const legacyAgent = await prismaPrimary.agent.findUnique({
    where: { id: "cmrpyuvty000111lydrm8c8qk" },
  });
  const ticket = await prismaPrimary.ticket.findFirst({
    where: { ticketNumber: "REQ-2026-00124" },
    select: {
      assignedAgentId: true,
      assignedAgent: { select: { name: true, email: true } },
    },
  });
  console.log(JSON.stringify({ portal, legacyAgentGone: !legacyAgent, ticket }, null, 2));
}

main().finally(() => prismaPrimary.$disconnect());
