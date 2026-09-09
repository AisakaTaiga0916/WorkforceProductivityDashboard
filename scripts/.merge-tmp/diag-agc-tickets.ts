import { prisma } from "../../src/lib/prisma.ts";
import { loadAgentIdsForCompanyTeam } from "../../src/lib/staff-company-scope.ts";

void (async () => {
  const agc = await prisma.team.findFirst({ where: { name: "AGC" }, select: { id: true } });
  if (!agc) process.exit(1);
  const ids = await loadAgentIdsForCompanyTeam(agc.id);

  const byTeam = await prisma.ticket.count({
    where: {
      teamId: agc.id,
      closedAt: { gte: new Date("2026-08-01"), lte: new Date("2026-08-31T23:59:59.999Z") },
    },
  });
  const byAgent = await prisma.ticket.count({
    where: {
      assignedAgentId: { in: ids },
      closedAt: { gte: new Date("2026-08-01"), lte: new Date("2026-08-31T23:59:59.999Z") },
    },
  });
  const sample = await prisma.ticket.findMany({
    where: { teamId: agc.id },
    select: {
      ticketNumber: true,
      status: true,
      assignedAgentId: true,
      assignedAgent: { select: { name: true, email: true } },
      closedAt: true,
    },
    take: 10,
    orderBy: { createdAt: "desc" },
  });
  console.log(JSON.stringify({ byTeamAug: byTeam, byAgentAug: byAgent, sample }, null, 2));

  // Name overlap: AGC agents vs KPI assignees
  const agcAgents = await prisma.agent.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, email: true },
  });
  const kpiAssignees = await prisma.kpiMaintenance.findMany({
    where: { assignedAgentId: { not: null } },
    select: { assignedAgent: { select: { id: true, name: true, email: true } }, title: true },
  });
  for (const a of agcAgents) {
    const matches = kpiAssignees.filter((k) => {
      const n = k.assignedAgent?.name?.toLowerCase() ?? "";
      const e = k.assignedAgent?.email?.toLowerCase() ?? "";
      return (
        n.includes(a.name.split(" ")[0]!.toLowerCase()) ||
        e.split("@")[0] === a.email.split("@")[0]?.toLowerCase()
      );
    });
    if (matches.length) {
      console.log(
        JSON.stringify({
          agcAgent: a,
          similarKpiAssignees: matches.map((m) => ({
            title: m.title,
            id: m.assignedAgent?.id,
            name: m.assignedAgent?.name,
            email: m.assignedAgent?.email,
          })),
        }),
      );
    }
  }
  process.exit(0);
})();
