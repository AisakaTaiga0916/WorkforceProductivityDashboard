-- Multi-company access: `user_companies` (many per user, one default).
-- `portal_accounts.staff_designated_company_id` stays as a mirror of the default row.

-- CreateTable
CREATE TABLE IF NOT EXISTS "user_companies" (
    "portal_account_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_companies_pkey" PRIMARY KEY ("portal_account_id", "company_id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "user_companies_company_id_idx" ON "user_companies"("company_id");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_companies_portal_account_id_fkey') THEN
    ALTER TABLE "user_companies" ADD CONSTRAINT "user_companies_portal_account_id_fkey"
      FOREIGN KEY ("portal_account_id") REFERENCES "portal_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_companies_company_id_fkey') THEN
    ALTER TABLE "user_companies" ADD CONSTRAINT "user_companies_company_id_fkey"
      FOREIGN KEY ("company_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Backfill (staff only; customers keep `portal_accounts.company_id`).
-- Default = the company runtime scope resolved before this change: the HRIS company
-- name (matched by name or alias), else the designated company, else the Agent
-- roster company. The designated company is kept as an extra membership when it
-- differs, so nobody loses access. The OUTSIDE triage queue is never a membership.
WITH "staff" AS (
  SELECT
    pa."id",
    pa."email",
    pa."staff_designated_company_id" AS "designated_id",
    lower(regexp_replace(btrim(h."company_name"), '\s+', ' ', 'g')) AS "hris_label"
  FROM "portal_accounts" pa
  LEFT JOIN "hris_users" h ON h."source_user_id" = pa."merged_source_user_id"
  WHERE NOT (pa."role" = 'Customer' AND pa."role_id" IS NULL)
),
"resolved" AS (
  SELECT
    s."id",
    (
      SELECT t."id" FROM "teams" t
      WHERE t."is_active" AND t."code" IS DISTINCT FROM 'OUTSIDE'
        AND s."hris_label" IS NOT NULL AND s."hris_label" <> ''
        AND (lower(t."name") = s."hris_label" OR s."hris_label" = ANY(t."aliases"))
      ORDER BY t."sort_order", t."name"
      LIMIT 1
    ) AS "hris_id",
    (
      SELECT t."id" FROM "teams" t
      WHERE t."id" = s."designated_id" AND t."is_active" AND t."code" IS DISTINCT FROM 'OUTSIDE'
    ) AS "designated_id",
    (
      SELECT t."id" FROM "agents" a
      JOIN "teams" t ON t."id" = a."team_id" AND t."is_active" AND t."code" IS DISTINCT FROM 'OUTSIDE'
      WHERE lower(a."email") = lower(s."email")
      ORDER BY a."created_at" ASC
      LIMIT 1
    ) AS "agent_id"
  FROM "staff" s
),
"defaults" AS (
  SELECT "id", COALESCE("hris_id", "designated_id", "agent_id") AS "default_id", "designated_id"
  FROM "resolved"
)
INSERT INTO "user_companies" ("portal_account_id", "company_id", "is_default")
SELECT d."id", d."default_id", true FROM "defaults" d WHERE d."default_id" IS NOT NULL
UNION ALL
SELECT d."id", d."designated_id", false FROM "defaults" d
WHERE d."designated_id" IS NOT NULL AND d."default_id" IS NOT NULL AND d."designated_id" <> d."default_id"
ON CONFLICT ("portal_account_id", "company_id") DO NOTHING;

-- Mirror the default membership onto the legacy column.
UPDATE "portal_accounts" pa
SET "staff_designated_company_id" = uc."company_id"
FROM "user_companies" uc
WHERE uc."portal_account_id" = pa."id"
  AND uc."is_default"
  AND pa."staff_designated_company_id" IS DISTINCT FROM uc."company_id";
