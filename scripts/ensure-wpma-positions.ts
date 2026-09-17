/**
 * Ensure WPMA_COO / WPMA_CEO positions exist (Work Plan for Management Approval).
 */
import { PrismaClient } from "@prisma/client/primary";

async function main() {
  const prisma = new PrismaClient();
  try {
    await prisma.$executeRawUnsafe(`
      INSERT INTO "positions" ("id", "code", "name", "level_rank", "description", "is_active", "created_at", "updated_at") VALUES
        ('pos_wpma_coo', 'WPMA_COO', 'Travel Order — Chief Operating Officer (COO)', 2, 'Travel Order for Management Approval COO seat', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
        ('pos_wpma_ceo', 'WPMA_CEO', 'Travel Order — Chief Executive Officer (CEO)', 1, 'Travel Order for Management Approval CEO seat', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT ("code") DO NOTHING;
    `);
    const rows = await prisma.$queryRawUnsafe<Array<{ code: string; name: string }>>(
      `SELECT code, name FROM positions WHERE code IN ('WPMA_COO', 'WPMA_CEO') ORDER BY code`,
    );
    console.log("WPMA positions seeded:", rows);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
