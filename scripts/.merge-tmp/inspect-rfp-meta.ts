import { prisma } from "../../src/lib/prisma";

async function main() {
  const rows = await prisma.$queryRaw<
    Array<{
      ticket_number: string;
      status: string;
      meta_type: string | null;
      step: string | null;
      completed: unknown;
      assigned_agent_id: string | null;
    }>
  >`
    SELECT ticket_number, status::text as status,
      jsonb_typeof(payment_approval_meta) as meta_type,
      payment_approval_meta->>'proceduralStep' as step,
      payment_approval_meta->'completed' as completed,
      assigned_agent_id
    FROM tickets
    WHERE request_type = 'REQUEST_FOR_PAYMENT'
    ORDER BY updated_at DESC
    LIMIT 10
  `;
  console.log(JSON.stringify(rows, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
