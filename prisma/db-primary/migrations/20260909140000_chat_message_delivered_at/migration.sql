-- Request chat delivery receipts
ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "delivered_at" TIMESTAMP(3);
