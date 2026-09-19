-- Ticket remarks (shown above audit trail; requestor confirmation pin).
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "remarks" TEXT;
