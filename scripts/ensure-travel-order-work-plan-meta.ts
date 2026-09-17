/**
 * Ensure travel_orders.work_plan_meta exists (dev / Windows when migrations lag).
 */
import { PrismaClient } from "@prisma/client/primary";

async function main() {
  const prisma = new PrismaClient();
  try {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "travel_orders" ADD COLUMN IF NOT EXISTS "work_plan_meta" JSONB;
    `);
    console.log("travel_orders.work_plan_meta ensured.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
