-- Teams = org-chart groups (`org_chart_sections`) owned by one company.
-- Membership source of truth: `org_chart_node_section_memberships` (+ `org_chart_nodes.section_id` primary mirror).

-- AlterTable
ALTER TABLE "org_chart_sections" ADD COLUMN IF NOT EXISTS "is_active" BOOLEAN NOT NULL DEFAULT true;

-- Backfill owning company, top-down: the members' majority default company;
-- ties prefer the parent team's company, then company display order.
-- Teams without resolvable members inherit the parent's company.
DO $$
DECLARE
  r RECORD;
  parent_company TEXT;
  pick TEXT;
BEGIN
  FOR r IN
    WITH RECURSIVE "tree" AS (
      SELECT s."id", s."parent_id", 0 AS "depth"
      FROM "org_chart_sections" s WHERE s."parent_id" IS NULL
      UNION ALL
      SELECT s."id", s."parent_id", t."depth" + 1
      FROM "org_chart_sections" s JOIN "tree" t ON s."parent_id" = t."id"
      WHERE t."depth" < 64
    )
    SELECT t."id", t."parent_id"
    FROM "tree" t
    JOIN "org_chart_sections" s ON s."id" = t."id"
    WHERE s."company_team_id" IS NULL
    ORDER BY t."depth"
  LOOP
    SELECT "company_team_id" INTO parent_company FROM "org_chart_sections" WHERE "id" = r."parent_id";

    SELECT m."company_id" INTO pick
    FROM (
      SELECT uc."company_id", count(DISTINCT n."id") AS "cnt"
      FROM "org_chart_nodes" n
      JOIN "portal_accounts" pa ON pa."merged_source_user_id"::text = n."merged_source_user_id"
      JOIN "user_companies" uc ON uc."portal_account_id" = pa."id" AND uc."is_default"
      WHERE n."id" IN (
        SELECT mm."node_id" FROM "org_chart_node_section_memberships" mm WHERE mm."section_id" = r."id"
        UNION SELECT n2."id" FROM "org_chart_nodes" n2 WHERE n2."section_id" = r."id"
        UNION SELECT s2."head_node_id" FROM "org_chart_sections" s2 WHERE s2."id" = r."id" AND s2."head_node_id" IS NOT NULL
      )
      GROUP BY uc."company_id"
    ) m
    JOIN "teams" t ON t."id" = m."company_id"
    ORDER BY m."cnt" DESC, (m."company_id" = parent_company) DESC NULLS LAST, t."sort_order" ASC
    LIMIT 1;

    UPDATE "org_chart_sections" SET "company_team_id" = COALESCE(pick, parent_company) WHERE "id" = r."id";
    pick := NULL;
  END LOOP;
END $$;
