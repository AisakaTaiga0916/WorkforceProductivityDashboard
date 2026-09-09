import { PrismaClient } from "@prisma/client/primary";

const prisma = new PrismaClient();

const TRAVEL_ORDER_ID = "c95f9183ae194cf3a4f084ad9";
const KPI_ID = "cmsh2vyca000jr7q6841pz3wm";

async function main() {
  const kpi = await prisma.$queryRawUnsafe<
    Array<{
      id: string;
      title: string | null;
      main_task: string | null;
      status: string | null;
    }>
  >(
    `SELECT id, title, main_task, status FROM kpi_maintenance WHERE id = $1`,
    KPI_ID,
  );
  console.log("kpi:", JSON.stringify(kpi, null, 2));

  const orders = await prisma.$queryRawUnsafe<
    Array<{ id: string; order_request: string | null; status: string }>
  >(
    `SELECT id, order_request, status FROM travel_orders WHERE kpi_maintenance_id = $1`,
    KPI_ID,
  );
  console.log("orders on kpi:", JSON.stringify(orders, null, 2));

  const locs = await prisma.$queryRawUnsafe<Array<{ id: string; label: string }>>(
    `SELECT id, label FROM travel_order_locations WHERE travel_order_id = $1`,
    TRAVEL_ORDER_ID,
  );
  console.log("locations:", JSON.stringify(locs, null, 2));
}

main().finally(() => prisma.$disconnect());
