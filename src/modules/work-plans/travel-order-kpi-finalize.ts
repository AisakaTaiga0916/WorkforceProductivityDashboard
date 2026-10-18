import { prisma } from "@/modules/platform/db/prisma";
import {
  markFieldAssignmentTask,
  setPillarDone,
  setPillarWorkMeta,
} from "@/modules/tasks/kpi-subkpis";
import {
  fieldAssignmentKpiPercent,
  recordTravelOrderKpiSubmit,
  type TravelOrderRow,
} from "@/modules/work-plans/travel-order-db";

export type FieldAssignmentKpiFinalizeResult = {
  updatedOrder: TravelOrderRow;
  kpiPercent: number;
  checked: number;
  total: number;
  alreadySubmitted: boolean;
};

/**
 * Record Field Assignment KPI from travel-order location completion and mark the
 * linked KPI maintenance row done. Idempotent when kpiSubmittedAt is already set.
 */
export async function finalizeFieldAssignmentKpiFromTravelOrder(
  order: TravelOrderRow,
): Promise<FieldAssignmentKpiFinalizeResult | null> {
  if (order.kpiSubmittedAt) {
    return {
      updatedOrder: order,
      kpiPercent: order.kpiPercent ?? 0,
      checked: fieldAssignmentKpiPercent(order.locations).checked,
      total: order.locations.length,
      alreadySubmitted: true,
    };
  }

  const { checked, total, percent } = fieldAssignmentKpiPercent(order.locations);
  if (total <= 0) return null;

  const kpi = await prisma.kpiMaintenance.findUnique({
    where: { id: order.kpiMaintenanceId },
    select: { id: true, subKpis: true },
  });
  if (!kpi) return null;

  const updatedOrder = await recordTravelOrderKpiSubmit({
    travelOrderId: order.id,
    kpiMaintenanceId: order.kpiMaintenanceId,
    kpiPercent: percent,
  });
  if (!updatedOrder) return null;

  let subKpis = setPillarWorkMeta(kpi.subKpis, {
    numericalTarget: 100,
    numericalValue: percent,
  });
  subKpis = setPillarDone(subKpis, true);
  subKpis = markFieldAssignmentTask(subKpis);

  await prisma.kpiMaintenance.update({
    where: { id: kpi.id },
    data: {
      subKpis,
      lastFullCompletionAt: new Date(),
    },
  });

  return {
    updatedOrder,
    kpiPercent: percent,
    checked,
    total,
    alreadySubmitted: false,
  };
}
