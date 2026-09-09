import { prisma } from "../../src/lib/prisma";
import { findTravelOrdersVisibleToAgent } from "../../src/lib/travel-order-db";
import { resolveAgentDesignatedCompanyId } from "../../src/lib/staff-company-scope";

async function main() {
  // Every agent that appears as an approver/confirmer on any travel order
  const ags: any[] = await prisma.$queryRaw`
    SELECT DISTINCT agent_id
    FROM (
      SELECT approved_by_agent_id AS agent_id FROM travel_orders WHERE approved_by_agent_id IS NOT NULL
      UNION
      SELECT confirmation_by_agent_id AS agent_id FROM travel_orders WHERE confirmation_by_agent_id IS NOT NULL
    ) x
    WHERE agent_id IS NOT NULL
  `;
  for (const a of ags) {
    const companyTeamId = await resolveAgentDesignatedCompanyId(a.agent_id);
    const rows = await findTravelOrdersVisibleToAgent({
      companyTeamId,
      agentId: a.agent_id,
    });
    const summary = rows.map((r) => `${r.status}:${r.id.slice(0, 6)}`);
    const agent = await prisma.agent.findUnique({ where: { id: a.agent_id }, select: { name: true } });
    console.log(
      `${a.agent_id} ${agent?.name ?? ""} company=${companyTeamId?.slice(0, 8) ?? "null"} visible=[${summary.join(", ")}]`,
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