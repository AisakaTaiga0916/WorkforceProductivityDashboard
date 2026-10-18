import { runComputeUserEfficiencyBreakdowns } from "@/modules/tasks/efficiency/user-efficiency-breakdown";

/**
 * Fire-and-forget dump of overall user KPI into merged MySQL after primary
 * task/KPI progress, completion, or penalty changes.
 * Primary remains source of truth; merged is dump/fetch only.
 */
export function triggerEfficiencyRecomputeBackground(): void {
  void runComputeUserEfficiencyBreakdowns({
    dryRun: false,
    frequencies: ["MONTHLY", "WEEKLY"],
    lookbackPeriods: 1,
  }).catch((err) => {
    console.error("[efficiency-recompute]", err);
  });
}
