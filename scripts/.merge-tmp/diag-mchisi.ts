import { prisma } from "../../src/lib/prisma.ts";
import { computeTaskMetrics, parseKpiRangeFromQuery } from "../../src/lib/kpis.ts";
import { loadAgentIdsForCompanyTeam } from "../../src/lib/staff-company-scope.ts";

void (async () => {
  const mchisi = await prisma.team.findFirst({
    where: { name: "MCHISI" },
    select: { id: true, name: true },
  });
  if (!mchisi) {
    console.log("no mchisi");
    process.exit(1);
  }
  const ids = await loadAgentIdsForCompanyTeam(mchisi.id);
  for (const cadence of ["MONTHLY", "YEARLY"] as const) {
    const from = cadence === "MONTHLY" ? "2026-08-01" : "2026-01-01";
    const to = cadence === "MONTHLY" ? "2026-08-31" : "2026-12-31";
    const t0 = Date.now();
    const range = parseKpiRangeFromQuery(from, to);
    const payload = await computeTaskMetrics(
      range,
      { assignedAgentIds: ids },
      cadence,
      { timeZone: "Asia/Manila", taskType: "task" },
    );
    const json = JSON.stringify(payload);
    console.log(
      JSON.stringify({
        cadence,
        ms: Date.now() - t0,
        bytes: json.length,
        helpdesk: payload.taskMetricsHelpdesk?.percent,
        pillars: Object.entries(payload.taskChecklistPillars || {}).map(([k, v]) => [
          k,
          v.total,
          v.percent,
          v.includedTasks?.length ?? 0,
        ]),
      }),
    );
  }
  process.exit(0);
})();
