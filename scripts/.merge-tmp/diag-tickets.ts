import { prisma } from "../../src/lib/prisma";

async function main() {
const daily = await prisma.$queryRaw<any[]>`
    SELECT id, title, main_task, period_cycle_start_at as anchor, period_key as "periodKey",
           rolled_over_incomplete as "rolledOverIncomplete",
           last_full_completion_at as "lastFullCompletionAt", is_recurring, frequency
    FROM kpi_maintenance
    WHERE is_recurring = true AND frequency = 'DAILY'
    ORDER BY period_cycle_start_at DESC
    LIMIT 25
  `;
  console.log("=== DAILY TASKS ===");
  for (const r of daily ?? []) {
    console.log(JSON.stringify({ ...r, anchor: r.anchor?.toISOString?.() }));
  }

  const statuses = await prisma.$queryRaw<any[]>`
    SELECT status, count(*)::int AS cnt
    FROM travel_orders
    GROUP BY status
    ORDER BY cnt DESC
  `;
  console.log("\n=== TRAVEL ORDER STATUSES ===");
  console.log(statuses);

  const tos = await prisma.$queryRaw<any[]>`
    SELECT to2.id, to2.status, to2.order_request, to2.created_by_agent_id,
           to2.approved_by_agent_id, to2.approved_by_agent_ids, to2.confirmation_by_agent_id,
           to2.approval_levels, to2.company_team_id, to2.kpi_maintenance_id
    FROM travel_orders to2
    WHERE to2.status IN ('APPROVED','CONFIRMED','COMPLETED','SUBMITTED')
    ORDER BY to2.created_at DESC
    LIMIT 15
  `;
  console.log("\n=== TRAVEL ORDERS (approved/confirmed/submitted) ===");
  for (const r of tos ?? []) {
    console.log(JSON.stringify(r));
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });