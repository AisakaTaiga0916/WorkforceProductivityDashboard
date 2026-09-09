import { prisma } from "../../src/lib/prisma";
import { findTravelOrdersVisibleToAgent } from "../../src/lib/travel-order-db";
import { resolveAgentDesignatedCompanyId } from "../../src/lib/staff-company-scope";

async function main() {
  const accounts = await prisma.portalAccount.findMany({
    where: { role: { in: ["SuperAdmin", "HighAdmin", "Admin"] } },
    select: { email: true, name: true, role: true, accountStatus: true },
    orderBy: { role: "asc" },
  });
  console.table(accounts);

  for (const acc of accounts) {
    if (acc.accountStatus !== "ACTIVE") continue;
    const agent = await prisma.agent.findUnique({
      where: { email: acc.email! },
      select: { id: true, name: true, email: true },
    });
    const companyTeamId = agent ? await resolveAgentDesignatedCompanyId(agent.id) : null;
    const rows = agent
      ? await findTravelOrdersVisibleToAgent({
          companyTeamId,
          agentId: agent.id,
          gatePassOnly: false,
        })
      : [];
    console.log(
      `\n[${acc.role}] ${acc.email}  agent=${agent?.id ?? "NONE"}  company=${companyTeamId ?? "NONE"}  orders=${rows.length}`,
    );
    for (const r of rows) {
      console.log(`   ${r.status.padEnd(9)} ${r.id}  req="${(r.orderRequest ?? "").slice(0, 40)}"`);
    }
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
