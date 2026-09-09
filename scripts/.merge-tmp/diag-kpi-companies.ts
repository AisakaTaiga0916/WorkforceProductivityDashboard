import { prisma } from "../../src/lib/prisma.ts";
import { loadAgentIdsForCompanyTeam } from "../../src/lib/staff-company-scope.ts";

void (async () => {
  const teams = await prisma.team.findMany({ select: { id: true, name: true } });
  const kpis = await prisma.kpiMaintenance.findMany({
    where: {
      OR: [
        { isRecurring: true },
        { isRecurring: false, lastFullCompletionAt: { not: null } },
      ],
    },
    select: {
      id: true,
      title: true,
      frequency: true,
      isRecurring: true,
      assignedAgentId: true,
      assignedAgent: { select: { id: true, name: true, email: true, teamId: true } },
      mainTask: true,
    },
  });

  console.log("kpi count", kpis.length);
  for (const k of kpis) {
    console.log(
      JSON.stringify({
        title: k.title,
        freq: k.frequency,
        recurring: k.isRecurring,
        assignee: k.assignedAgent?.name ?? null,
        assigneeTeamId: k.assignedAgent?.teamId ?? null,
        mainTask: k.mainTask,
      }),
    );
  }

  for (const t of teams) {
    const ids = await loadAgentIdsForCompanyTeam(t.id);
    const assigned = kpis.filter((k) => k.assignedAgentId && ids.includes(k.assignedAgentId));
    console.log(
      JSON.stringify({
        team: t.name,
        agents: ids.length,
        kpisAssigned: assigned.length,
        titles: assigned.map((k) => k.title),
      }),
    );
  }

  // tickets for AGC team
  const agc = teams.find((t) => t.name === "AGC");
  if (agc) {
    const ticketCounts = await prisma.ticket.groupBy({
      by: ["status"],
      where: { teamId: agc.id },
      _count: true,
    });
    console.log("AGC tickets by status", ticketCounts);
    const closedAug = await prisma.ticket.count({
      where: {
        teamId: agc.id,
        closedAt: { gte: new Date("2026-08-01T00:00:00Z"), lte: new Date("2026-08-31T23:59:59Z") },
      },
    });
    console.log("AGC closed in Aug UTC", closedAug);
  }
  process.exit(0);
})();
