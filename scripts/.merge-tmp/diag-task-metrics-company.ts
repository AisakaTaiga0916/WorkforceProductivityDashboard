import { prisma } from "../../src/modules/platform/db/prisma.ts";
import { computeTaskMetrics, parseKpiRangeFromQuery } from "../../src/modules/tasks/kpis.ts";
import { loadAgentIdsForCompanyTeam } from "../../src/modules/platform/scope/staff-company-scope.ts";

void (async () => {
  const teams = await prisma.company.findMany({ select: { id: true, name: true }, take: 5 });
  console.log("teams", teams.map((t) => t.name));
  for (const t of teams.slice(0, 2)) {
    const ids = await loadAgentIdsForCompanyTeam(t.id);
    const range = parseKpiRangeFromQuery("2026-08-01", "2026-08-31");
    const payload = await computeTaskMetrics(
      range,
      { assignedAgentIds: ids },
      "MONTHLY",
      { timeZone: "Asia/Manila", taskType: "task" },
    );
    const pillars = Object.entries(payload.taskChecklistPillars || {}).map(([k, v]) => [
      k,
      v.total,
      v.percent,
      v.includedTasks?.length || 0,
    ]);
    console.log(
      JSON.stringify({
        company: t.name,
        agents: ids.length,
        helpdesk: payload.taskMetricsHelpdesk?.percent,
        pillars,
      }),
    );
  }
  process.exit(0);
})();
