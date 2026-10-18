-- Drop Authority to Conduct Activity (ACA) request type support.
ALTER TABLE "tickets" DROP COLUMN IF EXISTS "aca_approval_meta";
