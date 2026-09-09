import { computeTaskMetrics, parseKpiRangeFromQuery } from "../../src/lib/kpis.ts";

void (async () => {
  for (const cadence of ["MONTHLY", "YEARLY"] as const) {
    const from = cadence === "MONTHLY" ? "2026-08-01" : "2026-01-01";
    const to = cadence === "MONTHLY" ? "2026-08-31" : "2026-12-31";
    const range = parseKpiRangeFromQuery(from, to);
    const payload = await computeTaskMetrics(range, {}, cadence, {
      timeZone: "Asia/Manila",
      taskType: "task",
    });
    const json = JSON.stringify(payload);
    const pillars = Object.entries(payload.taskChecklistPillars || {}).map(([k, v]) => ({
      k,
      csvRows: v.subtaskCsvRows?.length ?? 0,
      csvCols: v.subtaskCsvColumns?.length ?? 0,
      included: v.includedTasks?.length ?? 0,
      dailyProgress: v.dailyProgressRows?.length ?? 0,
    }));
    console.log(
      JSON.stringify(
        {
          cadence,
          bytes: json.length,
          mb: Number((json.length / 1024 / 1024).toFixed(2)),
          pillars,
        },
        null,
        2,
      ),
    );
  }
  process.exit(0);
})();
