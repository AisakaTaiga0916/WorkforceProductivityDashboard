/**
 * Dev/Windows: add tickets.remarks if migrations have not run yet.
 */
import { prisma } from "@/lib/prisma";

let ensured = false;

export async function ensureTicketRemarksColumn(): Promise<void> {
  if (ensured) return;
  try {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "remarks" TEXT;
    `);
    ensured = true;
  } catch {
    /* list/write still runs; missing column surfaces as a clear Prisma error */
  }
}
