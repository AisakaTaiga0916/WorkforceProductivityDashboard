/** READ-ONLY: verify the ChartView hint data — per-pillar recordedRange from the DB. */
import { computeTaskChecklistPillarMetrics } from "../src/modules/tasks/kpi-period-snapshots";

async function main() {
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const pillars = await computeTaskChecklistPillarMetrics({
    metricsCadence: "MONTHLY",
    fromYmd: `${ym}-01`,
    toYmd: `${ym}-28`,
    timeZone: "Asia/Taipei",
    taskType: "task",
  });
  let withRange = 0;
  for (const [pillar, metric] of Object.entries(pillars)) {
    const rr = metric?.recordedRange ?? null;
    const histTasks = (metric?.includedTasks ?? []).filter((t) => (t.history?.length ?? 0) > 0).length;
    console.log(
      `  ${pillar}: recordedRange=${rr ? `${rr.fromYm} → ${rr.toYm}` : "null"} · tasks=${metric?.includedTasks?.length ?? 0} · withHistory=${histTasks}`,
    );
    if (rr) withRange++;
  }
  console.log(`\nPillars with a recorded range: ${withRange}/${Object.keys(pillars).length}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => process.exit(0));
