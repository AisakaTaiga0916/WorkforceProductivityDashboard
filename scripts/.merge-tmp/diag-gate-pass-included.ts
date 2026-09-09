import { prisma } from "../../src/lib/prisma";

async function main() {
  const rows = await prisma.$queryRaw<
    Array<{ status: string; gpi: boolean; n: number }>
  >`
    SELECT status, COALESCE(gate_pass_included, false) AS gpi, COUNT(*)::int AS n
    FROM travel_orders
    GROUP BY 1, 2
    ORDER BY 1, 2
  `;
  console.log("byStatusGatePass", JSON.stringify(rows, null, 2));

  const approved = await prisma.$queryRaw<
    Array<{
      id: string;
      order_request: string;
      status: string;
      gpi: boolean;
      company_team_id: string | null;
    }>
  >`
    SELECT id, order_request, status,
           COALESCE(gate_pass_included, false) AS gpi,
           company_team_id
    FROM travel_orders
    WHERE status IN ('APPROVED', 'CONFIRMED')
    ORDER BY created_at DESC
    LIMIT 20
  `;
  console.log("approvedOrConfirmed", JSON.stringify(approved, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
