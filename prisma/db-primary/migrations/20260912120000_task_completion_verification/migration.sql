-- Task completion verification gate (KpiMaintenance Task Board + TaskItem status).

DO $$ BEGIN
  ALTER TYPE "TaskStatus" ADD VALUE 'PENDING_VERIFICATION';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "kpi_maintenance"
  ADD COLUMN IF NOT EXISTS "completion_verification_status" TEXT,
  ADD COLUMN IF NOT EXISTS "verifier_agent_id" TEXT,
  ADD COLUMN IF NOT EXISTS "pending_verification_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "verified_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "verified_by_agent_id" TEXT,
  ADD COLUMN IF NOT EXISTS "verification_rejection_comment" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'kpi_maintenance_verifier_agent_id_fkey'
  ) THEN
    ALTER TABLE "kpi_maintenance"
      ADD CONSTRAINT "kpi_maintenance_verifier_agent_id_fkey"
      FOREIGN KEY ("verifier_agent_id") REFERENCES "agents"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'kpi_maintenance_verified_by_agent_id_fkey'
  ) THEN
    ALTER TABLE "kpi_maintenance"
      ADD CONSTRAINT "kpi_maintenance_verified_by_agent_id_fkey"
      FOREIGN KEY ("verified_by_agent_id") REFERENCES "agents"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "kpi_maintenance_completion_verification_status_idx"
  ON "kpi_maintenance"("completion_verification_status");
CREATE INDEX IF NOT EXISTS "kpi_maintenance_verifier_agent_id_idx"
  ON "kpi_maintenance"("verifier_agent_id");
