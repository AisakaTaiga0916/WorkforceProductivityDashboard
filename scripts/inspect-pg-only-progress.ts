import { samePersonName } from "../src/modules/platform/auth/person-match";
import { prismaPrimary } from "../src/modules/platform/db/prisma";

async function main() {
  const pgOnly = await prismaPrimary.portalAccount.findMany({
    where: {
      mergedSourceUserId: null,
      accountStatus: "ACTIVE",
      role: { in: ["Admin", "Personnel", "SuperAdmin"] },
    },
    select: { id: true, email: true, name: true, username: true },
  });
  const hris = await prismaPrimary.portalAccount.findMany({
    where: { mergedSourceUserId: { not: null }, accountStatus: "ACTIVE" },
    select: { id: true, email: true, name: true, username: true },
  });
  const agents = await prismaPrimary.agent.findMany({
    select: { id: true, email: true, name: true },
  });

  for (const pg of pgOnly) {
    const match = hris.find((h) => samePersonName(h.name, pg.name));
    const pgAgents = agents.filter(
      (a) =>
        a.email.trim().toLowerCase() === pg.email.trim().toLowerCase() ||
        samePersonName(a.name, pg.name),
    );
    let tickets = 0;
    let kpis = 0;
    for (const a of pgAgents) {
      tickets += await prismaPrimary.ticket.count({ where: { assignedAgentId: a.id } });
      kpis += await prismaPrimary.kpiMaintenance.count({ where: { assignedAgentId: a.id } });
    }
    console.log({
      pg: { username: pg.username, email: pg.email, name: pg.name },
      hrisMatch: match
        ? { username: match.username, email: match.email, name: match.name }
        : null,
      agents: pgAgents.length,
      tickets,
      kpis,
    });
  }
}

main().finally(() => prismaPrimary.$disconnect());
