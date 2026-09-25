/**
 * Dev/Windows: add tickets.linked_travel_order_id if migrations have not run yet.
 */
import { prisma } from "@/lib/prisma";

let ensured = false;

export async function ensureTicketLinkedTravelOrderColumn(): Promise<void> {
  if (ensured) return;
  try {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "linked_travel_order_id" TEXT;
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "tickets_linked_travel_order_id_idx"
      ON "tickets"("linked_travel_order_id");
    `);
    ensured = true;
  } catch {
    /* create/write still runs; missing column surfaces clearly */
  }
}
