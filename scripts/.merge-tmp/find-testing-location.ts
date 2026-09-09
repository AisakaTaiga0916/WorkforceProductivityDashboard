import { PrismaClient } from "@prisma/client/primary";

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.$queryRawUnsafe<
    Array<{
      travel_order_id: string;
      kpi_maintenance_id: string;
      order_request: string | null;
      status: string;
      location_id: string;
      label: string;
      sort_order: number;
      created_at: Date;
    }>
  >(`
    SELECT t.id AS travel_order_id, t.kpi_maintenance_id, t.order_request, t.status,
           l.id AS location_id, l.label, l.sort_order, t.created_at
    FROM travel_order_locations l
    JOIN travel_orders t ON t.id = l.travel_order_id
    WHERE l.label ILIKE '%Testing Location%'
       OR t.order_request ILIKE '%Testing Location%'
    ORDER BY t.created_at DESC
  `);
  console.log(JSON.stringify(rows, null, 2));

  const byName = await prisma.$queryRawUnsafe<
    Array<{ id: string; title: string | null; status: string | null }>
  >(`
    SELECT id, title, status
    FROM kpi_maintenances
    WHERE title ILIKE '%Testing Location%'
       OR title ILIKE '%Travel Order%'
    ORDER BY updated_at DESC
    LIMIT 20
  `);
  console.log("kpi matches:", JSON.stringify(byName, null, 2));
}

main().finally(() => prisma.$disconnect());
