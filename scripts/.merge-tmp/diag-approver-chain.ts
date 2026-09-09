import { prisma } from "../../src/lib/prisma";
import { findTravelOrdersVisibleToAgent } from "../../src/lib/travel-order-db";
import { resolveAgentDesignatedCompanyId } from "../../src/lib/staff-company-scope";

async function main() {
  const order = await prisma.travelOrder.findUnique({
    where: { id: "0ea5deba7e314ef3b6b226b75" },
    select: {
      id: true,
      status: true,
      approvedByAgentId: true,
      approvedByAgentIds: true,
      approvalLevels: true,
      confirmationByAgentId: true,
      companyTeamId: true,
    },
  });
  console.log("order 0ea5de:", JSON.stringify(order, null, 2));

  const involved = new Set<string>();
  if (order?.approvedByAgentId) involved.add(order.approvedByAgentId);
  for (const id of (order?.approvedByAgentIds ?? []) as string[]) involved.add(id);
  if (order?.confirmationByAgentId) involved.add(order.confirmationByAgentId);
  for (const lvl of (order?.approvalLevels ?? []) as Array<{ agentId?: string }>) {
    if (lvl.agentId) involved.add(lvl.agentId);
  }

  for (const agentId of involved) {
    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      select: { id: true, name: true, email: true },
    });
    if (!agent) continue;
    const companyTeamId = await resolveAgentDesignatedCompanyId(agent.id);
    const rows = await findTravelOrdersVisibleToAgent({
      companyTeamId,
      agentId: agent.id,
      gatePassOnly: false,
    });
    const sees = rows.some((r) => r.id === order!.id);
    console.log(
      `${sees ? "SEES   " : "MISSES "} ${agent.name} (${agent.email}) role-checked via agent ${agent.id}`,
    );
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