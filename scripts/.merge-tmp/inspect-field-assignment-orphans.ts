import { prismaPrimary } from "../../src/lib/prisma";
import { isFieldAssignmentTask } from "../../src/lib/kpi-subkpis";

async function main() {
  const all = await prismaPrimary.kpiMaintenance.findMany({
    select: {
      id: true,
      title: true,
      mainTask: true,
      createdAt: true,
      subKpis: true,
      travelOrders: { select: { id: true, status: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const field = all.filter((k) => isFieldAssignmentTask(k.subKpis));
  const orphans = field.filter((k) => k.travelOrders.length === 0);
  const withOrders = field.filter((k) => k.travelOrders.length > 0);

  // Also: KPIs that still have travel orders (linked cards on board)
  const linkedByTravel = await prismaPrimary.travelOrder.findMany({
    select: {
      id: true,
      status: true,
      orderRequest: true,
      kpiMaintenanceId: true,
      kpiMaintenance: { select: { id: true, title: true, mainTask: true, subKpis: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  console.log(
    JSON.stringify(
      {
        fieldAssignmentMarked: field.length,
        fieldWithTravelOrders: withOrders.length,
        orphanFieldCards: orphans.length,
        orphans: orphans.map((o) => ({
          id: o.id,
          title: o.title,
          mainTask: o.mainTask,
          createdAt: o.createdAt,
        })),
        remainingTravelOrders: linkedByTravel.map((t) => ({
          travelOrderId: t.id,
          status: t.status,
          orderRequest: t.orderRequest,
          kpiId: t.kpiMaintenanceId,
          kpiTitle: t.kpiMaintenance.title,
          isFieldAssignment: isFieldAssignmentTask(t.kpiMaintenance.subKpis),
        })),
      },
      null,
      2,
    ),
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
