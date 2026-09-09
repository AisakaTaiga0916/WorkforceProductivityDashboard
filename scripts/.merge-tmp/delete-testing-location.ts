import { rm } from "fs/promises";
import path from "path";
import { PrismaClient } from "@prisma/client/primary";

const prisma = new PrismaClient();

const TRAVEL_ORDER_ID = "c95f9183ae194cf3a4f084ad9";
const KPI_ID = "cmsh2vyca000jr7q6841pz3wm";

async function main() {
  const kpi = await prisma.kpiMaintenance.findUnique({
    where: { id: KPI_ID },
    select: { id: true, title: true, mainTask: true },
  });
  console.log("kpi:", kpi);

  const orders = await prisma.travelOrder.findMany({
    where: { kpiMaintenanceId: KPI_ID },
    select: { id: true, orderRequest: true, status: true },
  });
  console.log("orders on kpi:", orders);

  const target = await prisma.travelOrder.findUnique({
    where: { id: TRAVEL_ORDER_ID },
    select: { id: true, orderRequest: true, status: true, kpiMaintenanceId: true },
  });
  if (!target || target.orderRequest !== "Testing Location") {
    throw new Error(`Unexpected travel order: ${JSON.stringify(target)}`);
  }

  await prisma.travelOrder.delete({ where: { id: TRAVEL_ORDER_ID } });
  console.log("deleted travel order", TRAVEL_ORDER_ID);

  const remaining = await prisma.travelOrder.count({
    where: { kpiMaintenanceId: KPI_ID },
  });
  if (remaining === 0 && kpi) {
    await prisma.kpiMaintenance.delete({ where: { id: KPI_ID } });
    console.log("deleted orphan field-assignment kpi", KPI_ID, kpi.title);
  } else {
    console.log("remaining travel orders on kpi:", remaining);
  }

  const uploadDir = path.join(
    process.cwd(),
    "uploads",
    "travel-orders",
    KPI_ID,
    TRAVEL_ORDER_ID,
  );
  await rm(uploadDir, { recursive: true, force: true }).catch(() => undefined);
  console.log("cleared upload dir if present:", uploadDir);

  const gone = await prisma.travelOrder.findUnique({ where: { id: TRAVEL_ORDER_ID } });
  console.log("verify gone:", gone === null);
}

main().finally(() => prisma.$disconnect());
