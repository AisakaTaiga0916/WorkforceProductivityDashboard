import { prisma } from "../../src/lib/prisma";
import { findTravelOrdersVisibleToAgent } from "../../src/lib/travel-order-db";
import { serializeTravelOrder } from "../../src/lib/travel-order-db";
import { resolveAgentDesignatedCompanyId } from "../../src/lib/staff-company-scope";

async function main() {
  const emails = [
    "lmangolayon@mconpincohomeimprovement.com",
    "edmunmagbanua@gmail.com",
    "mira26luna@gmail.com",
  ];
  for (const email of emails) {
    const agent = await prisma.agent.findUnique({
      where: { email },
      select: { id: true, name: true, email: true },
    });
    if (!agent) {
      console.log(`\n[${email}] no agent row`);
      continue;
    }
    const companyTeamId = await resolveAgentDesignatedCompanyId(agent.id);
    const rows = await findTravelOrdersVisibleToAgent({
      companyTeamId,
      agentId: agent.id,
      gatePassOnly: false,
    });
    console.log(`\n[${agent.name}] agent=${agent.id} companyTeam=${companyTeamId}`);
    for (const r of rows) {
      const s = serializeTravelOrder(r);
      console.log(`   ${s.status.padEnd(9)} ${s.id}  kpi=${s.kpiMaintenanceId}  req="${(s.orderRequest ?? "").slice(0, 42)}"`);
    }
    if (rows.length === 0) console.log("   (no orders visible)");
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
