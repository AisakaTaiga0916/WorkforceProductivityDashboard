import { computeTaskMetrics, parseKpiRangeFromQuery } from "../../src/lib/kpis.ts";

async function run(cadence: "MONTHLY" | "YEARLY") {
  const from = cadence === "MONTHLY" ? "2026-08-01" : "2026-01-01";
  const to = cadence === "MONTHLY" ? "2026-08-31" : "2026-12-31";
  const range = parseKpiRangeFromQuery(from, to);
  const t0 = Date.now();
  try {
    const payload = await computeTaskMetrics(range, {}, cadence, {
      timeZone: "Asia/Manila",
      taskType: "task",
    });
    const pillars = Object.entries(payload.taskChecklistPillars || {}).map(([k, v]) => ({
      k,
      total: v.total,
      done: v.done,
      percent: v.percent,
      periodsCounted: v.periodsCounted,
      included: v.includedTasks?.length ?? 0,
    }));
    console.log(
      JSON.stringify(
        {
          cadence,
          ms: Date.now() - t0,
          helpdeskPercent: payload.taskMetricsHelpdesk?.percent,
          helpdeskClosed: payload.taskMetricsHelpdesk?.closedCount,
          pillarCount: pillars.length,
          pillars,
        },
        null,
        2,
      ),
    );
  } catch (e) {
    console.log(
      JSON.stringify(
        {
          cadence,
          ms: Date.now() - t0,
          error: e instanceof Error ? e.message : String(e),
          stack: e instanceof Error ? e.stack?.split("\n").slice(0, 12) : undefined,
        },
        null,
        2,
      ),
    );
  }
}

void (async () => {
  await run("MONTHLY");
  await run("YEARLY");
  process.exit(0);
})();
