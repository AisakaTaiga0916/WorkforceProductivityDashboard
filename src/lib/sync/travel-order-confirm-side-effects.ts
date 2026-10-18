import { triggerEfficiencyRecomputeBackground } from "@/modules/tasks/efficiency/trigger-efficiency-recompute";
import { syncConfirmedTravelOrderToMerged } from "@/lib/sync/travel-order-to-merged";
import type { TravelOrderRow } from "@/modules/work-plans/travel-order-db";
import { findTravelOrderById } from "@/modules/work-plans/travel-order-db";
import { finalizeFieldAssignmentKpiFromTravelOrder } from "@/modules/work-plans/travel-order-kpi-finalize";

/**
 * After a Travel Order reaches CONFIRMED: finalize Field Assignment KPI if needed,
 * push timestamps to MergeDatabase, and refresh personnel efficiency KPIs.
 * Fire-and-forget — never throws to the HTTP confirm handler.
 */
export function triggerTravelOrderConfirmedSideEffects(order: TravelOrderRow): void {
  void runTravelOrderConfirmedSideEffects(order).catch((err) => {
    console.error("[travel-order-confirm] side effects failed:", err);
  });
}

async function runTravelOrderConfirmedSideEffects(order: TravelOrderRow): Promise<void> {
  let working: TravelOrderRow = order;

  try {
    const finalized = await finalizeFieldAssignmentKpiFromTravelOrder(working);
    if (finalized?.updatedOrder) {
      working = finalized.updatedOrder;
    } else if (!working.kpiSubmittedAt) {
      console.warn(
        "[travel-order-confirm] KPI finalize skipped (no locations or task missing)",
        working.id,
      );
    }
  } catch (err) {
    console.error("[travel-order-confirm] KPI finalize failed:", err);
    // Reload best-effort so merge still gets latest status fields.
    const reloaded = await findTravelOrderById(working.id).catch(() => null);
    if (reloaded) working = reloaded;
  }

  try {
    const sync = await syncConfirmedTravelOrderToMerged(working);
    if (!sync.ok) {
      console.error("[travel-order-confirm] merge sync failed:", sync.error);
    }
  } catch (err) {
    console.error("[travel-order-confirm] merge sync threw:", err);
  }

  try {
    triggerEfficiencyRecomputeBackground();
  } catch (err) {
    console.error("[travel-order-confirm] efficiency recompute trigger failed:", err);
  }
}
