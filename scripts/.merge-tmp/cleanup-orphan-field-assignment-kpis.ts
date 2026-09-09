/**
 * Remove Field Assignment kanban cards with no travel orders,
 * plus leftover travel orders and their linked cards.
 * Usage: npx tsx scripts/.merge-tmp/cleanup-orphan-field-assignment-kpis.ts --apply
 */
import { prismaPrimary } from "../../src/lib/prisma";
import { isFieldAssignmentTask } from "../../src/lib/kpi-subkpis";

const APPLY = process.argv.includes("--apply");

async function deleteKpiIds(ids: string[]) {
  if (ids.length === 0) return { snaps: 0, acts: 0, tickets: 0, kpis: 0 };
  const snaps = await prismaPrimary.kpiMaintenancePeriodSnapshot.deleteMany({
    where: { kpiMaintenanceId: { in: ids } },
  });
  const acts = await prismaPrimary.kpiMaintenanceActivity.deleteMany({
    where: { kpiMaintenanceId: { in: ids } },
  });
  const tickets = await prismaPrimary.ticket.updateMany({
    where: { linkedKpiMaintenanceId: { in: ids } },
    data: { linkedKpiMaintenanceId: null },
  });
  const kpis = await prismaPrimary.kpiMaintenance.deleteMany({
    where: { id: { in: ids } },
  });
  return {
    snaps: snaps.count,
    acts: acts.count,
    tickets: tickets.count,
    kpis: kpis.count,
  };
}

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
  });

  const field = all.filter((k) => isFieldAssignmentTask(k.subKpis));
  const orphans = field.filter((k) => k.travelOrders.length === 0);
  const withOrders = field.filter((k) => k.travelOrders.length > 0);
  const travelOrders = await prismaPrimary.travelOrder.findMany({
    select: { id: true, kpiMaintenanceId: true, orderRequest: true, status: true },
  });

  console.log(
    JSON.stringify(
      {
        apply: APPLY,
        orphanCards: orphans.map((o) => ({ id: o.id, title: o.title })),
        cardsWithTravelOrders: withOrders.map((o) => ({
          id: o.id,
          title: o.title,
          travelOrders: o.travelOrders,
        })),
        remainingTravelOrders: travelOrders,
      },
      null,
      2,
    ),
  );

  if (!APPLY) {
    console.log("\nDry run. Pass --apply to delete orphans + remaining travel orders/cards.");
    return;
  }

  // 1) Delete travel orders first (locations cascade)
  const toDeleted = await prismaPrimary.travelOrder.deleteMany({});
  // 2) Delete all Field Assignment-marked KPIs (orphans + former linked cards)
  const kpiIds = [...new Set([...orphans.map((o) => o.id), ...withOrders.map((o) => o.id)])];
  const kpiResult = await deleteKpiIds(kpiIds);

  console.log(
    JSON.stringify(
      {
        deletedTravelOrders: toDeleted.count,
        deletedFieldAssignmentKpis: kpiResult.kpis,
        deletedSnapshots: kpiResult.snaps,
        deletedActivities: kpiResult.acts,
        unlinkedTickets: kpiResult.tickets,
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
