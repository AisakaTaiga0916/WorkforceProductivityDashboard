-- Companies as data: the `teams` table is the company directory (Prisma model `Company`).
-- Replaces the hardcoded COMPANY_ROSTER / HRIS alias map with columns managed in
-- SuperAdmin Settings → Companies.

-- AlterTable
ALTER TABLE "teams" ADD COLUMN IF NOT EXISTS "code" TEXT;
ALTER TABLE "teams" ADD COLUMN IF NOT EXISTS "is_active" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "teams" ADD COLUMN IF NOT EXISTS "sort_order" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "teams" ADD COLUMN IF NOT EXISTS "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "teams_code_key" ON "teams"("code");
CREATE INDEX IF NOT EXISTS "teams_is_active_sort_order_idx" ON "teams"("is_active", "sort_order");

-- Seed: the legacy roster (display order, codes, HRIS / legacy aliases).
DROP TABLE IF EXISTS "_company_roster_seed";
CREATE TEMP TABLE "_company_roster_seed" (
  "name" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "sort_order" INTEGER NOT NULL,
  "aliases" TEXT[] NOT NULL
);

INSERT INTO "_company_roster_seed" ("name", "code", "sort_order", "aliases") VALUES
  ('AGC', 'AGC', 10, ARRAY[]::TEXT[]),
  ('ALI', 'ALI', 20, ARRAY[]::TEXT[]),
  ('ACI', 'ACI', 30, ARRAY['aci/apmc']),
  ('APMC', 'APMC', 40, ARRAY[]::TEXT[]),
  ('AWIC', 'AWIC', 60, ARRAY[]::TEXT[]),
  ('MCHISI LPG', 'MCHISI-LPG', 70, ARRAY['mconpinco', 'm.conpinco', 'm conpinco', 'mchisi']),
  ('MCHISI FAMES', 'MCHISI-FAMES', 80, ARRAY['fames']),
  ('EAZZYGAS', 'EAZZYGAS', 90, ARRAY['eazygaz', 'easygas', 'eazygas', 'eazy gaz', 'eazzy gas']),
  ('INDUSTRIES', 'INDUSTRIES', 100, ARRAY['amalgated industries', 'amalgamated industries']);

-- Create roster companies that do not exist yet.
INSERT INTO "teams" ("id", "name", "created_at")
SELECT gen_random_uuid()::text, s."name", CURRENT_TIMESTAMP
FROM "_company_roster_seed" s
WHERE NOT EXISTS (SELECT 1 FROM "teams" t WHERE lower(t."name") = lower(s."name"));

-- Code / order / aliases go on the oldest row per roster name (duplicates stay archived).
WITH "canonical" AS (
  SELECT DISTINCT ON (lower(t."name")) t."id", lower(t."name") AS "lname"
  FROM "teams" t
  ORDER BY lower(t."name"), t."created_at" ASC, t."id" ASC
)
UPDATE "teams" t
SET "code" = s."code", "sort_order" = s."sort_order", "aliases" = s."aliases", "is_active" = true
FROM "canonical" c
JOIN "_company_roster_seed" s ON lower(s."name") = c."lname"
WHERE t."id" = c."id" AND t."code" IS NULL;

-- Anything that was not on the runtime roster was already invisible: archive it (history kept).
UPDATE "teams" SET "is_active" = false WHERE "code" IS NULL;

DROP TABLE IF EXISTS "_company_roster_seed";

-- Permission catalog: company directory management (Super Admin holds all keys by default).
INSERT INTO "permissions" ("id", "key", "resource", "action", "description", "created_at") VALUES
  (gen_random_uuid()::text, 'companies.read', 'companies', 'read', 'View the company directory, including archived companies.', CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'companies.create', 'companies', 'create', 'Create companies.', CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'companies.update', 'companies', 'update', 'Rename, re-code, and reorder companies.', CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'companies.archive', 'companies', 'archive', 'Archive or restore companies (history is retained).', CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
