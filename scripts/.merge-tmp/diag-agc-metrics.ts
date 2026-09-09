import { prisma } from "../../src/lib/prisma.ts";
import { computeTaskMetrics, parseKpiRangeFromQuery } from "../../src/lib/kpis.ts";
import { loadAgentIdsForCompanyTeam } from "../../src/lib/staff-company-scope.ts";

void (async () => {
  const agc = await prisma.team.findFirst({
    where: { OR: [{ name: "AGC" }, { name: { contains: "AGC", mode: "insensitive" } }] },
    select: { id: true, name: true },
  });
  console.log("team", agc);
  if (!agc) {
    process.exit(1);
  }
  const ids = await loadAgentIdsForCompanyTeam(agc.id);
  console.log("agentCount", ids.length, "sample", ids.slice(0, 5));

  const agents = await prisma.agent.findMany({
    where: { id: { in: ids.slice(0, 20) } },
    select: { id: true, name: true, email: true, teamId: true },
  });
  console.log("agents", agents);

  const kpiCount = await prisma.kpiMaintenance.count({
    where: {
      OR: [
        { isRecurring: true },
        { isRecurring: false, lastFullCompletionAt: { not: null } },
      ],
      assignedAgentId: { in: ids.length ? ids : ["__none__"] },
    },
  });
  console.log("kpis assigned to AGC agents", kpiCount);

  const anyKpis = await prisma.kpiMaintenance.count({
    where: {
      OR: [
        { isRecurring: true },
        { isRecurring: false, lastFullCompletionAt: { not: null } },
      ],
    },
  });
  console.log("total recurring/completed kpis", anyKpis);

  // KPIs with no assignee but company somehow related?
  const unassigned = await prisma.kpiMaintenance.count({
    where: {
      assignedAgentId: null,
      OR: [{ isRecurring: true }, { isRecurring: false, lastFullCompletionAt: { not: null } }],
    },
  });
  console.log("unassigned kpis", unassigned);

  for (const taskType of ["task", "project", "field", "requests"] as const) {
    for (const cadence of ["MONTHLY", "YEARLY"] as const) {
      const from = cadence === "MONTHLY" ? "2026-08-01" : "2026-01-01";
      const to = cadence === "MONTHLY" ? "2026-08-31" : "2026-12-31";
      const payload = await computeTaskMetrics(
        parseKpiRangeFromQuery(from, to),
        { assignedAgentIds: ids },
        cadence,
        { timeZone: "Asia/Manila", taskType },
      );
      const pillars = Object.entries(payload.taskChecklistPillars || {}).map(([k, v]) => [
        k,
        v.total,
        v.percent,
        v.includedTasks?.length ?? 0,
      ]);
      console.log(
        JSON.stringify({
          taskType,
          cadence,
          helpdesk: payload.taskMetricsHelpdesk?.percent,
          helpdeskClosed: payload.taskMetricsHelpdesk?.closedCount,
          helpdeskOpen: payload.taskMetricsHelpdesk?.openTicketsInPeriod,
          userSupport: payload.taskMetricsUserSupport?.averageRating,
          pillars,
        }),
      );
    }
  }
  process.exit(0);
})();
