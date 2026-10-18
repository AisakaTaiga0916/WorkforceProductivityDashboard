#!/usr/bin/env npx tsx
/**
 * Seed sample Task/KPI monitoring data in primary PostgreSQL (ticketing_system).
 * Usage: npx tsx scripts/seed-primary-tasks-kpi.ts
 */
import { prismaPrimary } from "../src/modules/platform/db/prisma";

const CREATED_BY = "seed-script";
const CREATED_BY_ROLE = "Admin";

async function main() {
  await prismaPrimary.$connect();

  const agents = await prismaPrimary.$queryRaw<{ id: string; name: string }[]>`
    SELECT id, name FROM "Agent" ORDER BY "createdAt" ASC LIMIT 3
  `;
  if (!agents.length) {
    throw new Error('No agents found in "Agent" table. Run npm run db:seed first.');
  }

  const agentA = agents[0]!.id;
  const agentB = agents[1]?.id ?? agentA;

  console.log("Clearing existing Task/KPI seed rows…");
  await prismaPrimary.$executeRaw`DELETE FROM "TaskActivity" WHERE author = ${CREATED_BY}`;
  await prismaPrimary.$executeRaw`
    DELETE FROM "TaskItem" WHERE "createdBy" = ${CREATED_BY}
  `;
  await prismaPrimary.$executeRaw`
    DELETE FROM "KpiMaintenancePeriodSnapshot"
    WHERE "kpiMaintenanceId" IN (
      SELECT id FROM "KpiMaintenance" WHERE "createdBy" = ${CREATED_BY}
    )
  `;
  await prismaPrimary.$executeRaw`
    DELETE FROM "KpiMaintenance" WHERE "createdBy" = ${CREATED_BY}
  `;

  const kpi1Id = "seed_kpi_daily_ops";
  const kpi2Id = "seed_kpi_it_project";
  const task1Id = "seed_task_network_audit";
  const task2Id = "seed_task_kpi_review";
  const task3Id = "seed_task_helpdesk_sync";
  const snap1Id = "seed_snap_kpi1_w27";
  const snap2Id = "seed_snap_kpi2_q3";

  const subKpis1 = JSON.stringify([
    { name: "Tickets resolved", target: 50 },
    { name: "SLA compliance %", target: 95 },
  ]);
  const subKpis2 = JSON.stringify([
    { name: "Milestone completion", target: 100 },
    { name: "Open defects", target: 0 },
  ]);

  console.log("Inserting KpiMaintenance rows…");
  await prismaPrimary.$executeRaw`
    INSERT INTO "KpiMaintenance" (
      id, title, "mainTask", "isRecurring", frequency, "subKpis",
      "assignedAgentId", "assignedRole", "periodKey", "createdBy", "createdByRole",
      "createdAt", "updatedAt"
    ) VALUES (
      ${kpi1Id}, 'Daily Operations KPI', 'Service desk throughput', true,
      'DAILY'::"KpiFrequency", ${subKpis1}::jsonb,
      ${agentA}, 'Agent', '2026-W27', ${CREATED_BY}, ${CREATED_BY_ROLE}, NOW(), NOW()
    )
  `;
  await prismaPrimary.$executeRaw`
    INSERT INTO "KpiMaintenance" (
      id, title, "mainTask", "isRecurring", frequency, "subKpis",
      "assignedAgentId", "itProjectName", "itProjectPhase", "createdBy", "createdByRole",
      "createdAt", "updatedAt"
    ) VALUES (
      ${kpi2Id}, 'IT Project Tracker', 'Portal modernization', true,
      'MONTHLY'::"KpiFrequency", ${subKpis2}::jsonb,
      ${agentB}, 'Ticketing System v3', 'UAT', ${CREATED_BY}, ${CREATED_BY_ROLE}, NOW(), NOW()
    )
  `;

  console.log("Inserting KPI period snapshots…");
  await prismaPrimary.$executeRaw`
    INSERT INTO "KpiMaintenancePeriodSnapshot" (
      id, "kpiMaintenanceId", "periodKey", frequency, "timeZone",
      total, done, missing, percent, "fullyComplete", "capturedAt"
    ) VALUES (
      ${snap1Id}, ${kpi1Id}, '2026-W27', 'DAILY'::"KpiFrequency", 'Asia/Manila',
      10, 8, 2, 80, false, NOW()
    )
  `;
  await prismaPrimary.$executeRaw`
    INSERT INTO "KpiMaintenancePeriodSnapshot" (
      id, "kpiMaintenanceId", "periodKey", frequency, "timeZone",
      total, done, missing, percent, "fullyComplete", "capturedAt"
    ) VALUES (
      ${snap2Id}, ${kpi2Id}, '2026-Q3', 'QUARTERLY'::"KpiFrequency", 'Asia/Manila',
      12, 9, 3, 75, false, NOW()
    )
  `;

  console.log("Inserting TaskItem rows…");
  await prismaPrimary.$executeRaw`
    INSERT INTO "TaskItem" (
      id, title, description, status, "assignedAgentId", priority, "dueAt",
      "createdBy", "createdByRole", "createdAt", "updatedAt"
    ) VALUES (
      ${task1Id}, 'Network access audit', 'Review firewall rules for branch offices',
      'CURRENT'::"TaskStatus", ${agentA}, 'HIGH', NOW() + interval '7 days',
      ${CREATED_BY}, ${CREATED_BY_ROLE}, NOW(), NOW()
    )
  `;
  await prismaPrimary.$executeRaw`
    INSERT INTO "TaskItem" (
      id, title, description, status, "assignedAgentId", priority, "dueAt",
      "createdBy", "createdByRole", "createdAt", "updatedAt"
    ) VALUES (
      ${task2Id}, 'Weekly KPI review', 'Validate KPI snapshots against helpdesk CSV',
      'DELAYED'::"TaskStatus", ${agentB}, 'MEDIUM', NOW() + interval '3 days',
      ${CREATED_BY}, ${CREATED_BY_ROLE}, NOW(), NOW()
    )
  `;
  await prismaPrimary.$executeRaw`
    INSERT INTO "TaskItem" (
      id, title, description, status, "assignedAgentId", priority,
      "createdBy", "createdByRole", "createdAt", "updatedAt"
    ) VALUES (
      ${task3Id}, 'MergeDatabase sync verification', 'Confirm task/KPI ETL into MySQL',
      'DONE'::"TaskStatus", ${agentA}, 'LOW',
      ${CREATED_BY}, ${CREATED_BY_ROLE}, NOW(), NOW()
    )
  `;

  console.log("Inserting TaskActivity rows…");
  const activities: [string, string, string, string][] = [
    ["seed_act_1", task1Id, "created", "Task opened from seed script"],
    ["seed_act_2", task1Id, "comment", "Waiting for branch inventory list"],
    ["seed_act_3", task2Id, "status_change", "Marked as DELAYED pending CSV export"],
    ["seed_act_4", task2Id, "assigned", `Assigned to agent ${agentB}`],
    ["seed_act_5", task3Id, "completed", "Sync script verified successfully"],
  ];

  for (const [id, taskId, action, detail] of activities) {
    await prismaPrimary.$executeRaw`
      INSERT INTO "TaskActivity" (id, "taskId", author, action, detail, "createdAt")
      VALUES (${id}, ${taskId}, ${CREATED_BY}, ${action}, ${detail}, NOW())
    `;
  }

  const counts = await prismaPrimary.$queryRaw<
    { kpis: bigint; snaps: bigint; tasks: bigint; acts: bigint }
  >`
    SELECT
      (SELECT COUNT(*) FROM "KpiMaintenance" WHERE "createdBy" = ${CREATED_BY}) AS kpis,
      (SELECT COUNT(*) FROM "KpiMaintenancePeriodSnapshot" s
         JOIN "KpiMaintenance" k ON k.id = s."kpiMaintenanceId"
         WHERE k."createdBy" = ${CREATED_BY}) AS snaps,
      (SELECT COUNT(*) FROM "TaskItem" WHERE "createdBy" = ${CREATED_BY}) AS tasks,
      (SELECT COUNT(*) FROM "TaskActivity" WHERE author = ${CREATED_BY}) AS acts
  `;

  console.log("\nSeed complete:\n", JSON.stringify(counts[0], (_, v) => (typeof v === "bigint" ? Number(v) : v), 2));
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prismaPrimary.$disconnect();
  });
