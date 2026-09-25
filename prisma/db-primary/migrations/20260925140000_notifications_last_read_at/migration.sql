-- AlterTable
ALTER TABLE "portal_accounts" ADD COLUMN IF NOT EXISTS "notifications_last_read_at" TIMESTAMP(3);
