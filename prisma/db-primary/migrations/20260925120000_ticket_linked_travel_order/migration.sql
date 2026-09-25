-- AlterTable
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "linked_travel_order_id" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "tickets_linked_travel_order_id_idx" ON "tickets"("linked_travel_order_id");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tickets_linked_travel_order_id_fkey'
  ) THEN
    ALTER TABLE "tickets"
      ADD CONSTRAINT "tickets_linked_travel_order_id_fkey"
      FOREIGN KEY ("linked_travel_order_id")
      REFERENCES "travel_orders"("id")
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;
END $$;
