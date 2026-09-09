import { PrismaClient } from "@prisma/client/primary";

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.$queryRawUnsafe<
    Array<Record<string, unknown>>
  >(`
    SELECT
      id,
      title,
      main_task,
      assigned_agent_id,
      rolled_over_incomplete,
      it_project_name,
      it_project_phase,
      period_key,
      last_full_completion_at,
      created_at,
      updated_at
    FROM kpi_maintenance
    WHERE title ILIKE '%cyber%'
       OR main_task ILIKE '%cyber%'
       OR it_project_name ILIKE '%cyber%'
    ORDER BY updated_at DESC
    LIMIT 30
  `);
  console.log(JSON.stringify(rows, null, 2));

  const acts = await prisma.$queryRawUnsafe<
    Array<Record<string, unknown>>
  >(`
    SELECT a.id, a.kpi_maintenance_id, a.author, a.summary, a.detail, a.created_at, k.title
    FROM kpi_maintenance_activities a
    JOIN kpi_maintenance k ON k.id = a.kpi_maintenance_id
    WHERE (k.title ILIKE '%cyber%' OR k.main_task ILIKE '%cyber%' OR a.summary ILIKE '%cyber%' OR a.detail ILIKE '%flag%')
      AND a.created_at >= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date
        - INTERVAL '1 day'
    ORDER BY a.created_at DESC
    LIMIT 40
  `);
  console.log("activities:", JSON.stringify(acts, null, 2));
}

main().finally(() => prisma.$disconnect());
