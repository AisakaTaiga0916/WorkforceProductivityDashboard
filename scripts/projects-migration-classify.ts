/**
 * Projects migration — classification dry run (read-only).
 *
 * Reads every `kpi_maintenance` row, applies the pure classification rules
 * (`src/modules/projects/project-migration-classify.ts`), and writes a CSV
 * report for manual review. Per the split plan, ambiguous rows are exported
 * as EXCEPTIONs (no admin UI), and nothing is written to the database.
 *
 * Usage:
 *   npx tsx scripts/projects-migration-classify.ts [--out=path/to/report.csv]
 *
 * The eventual apply step (separate script, after this report is reviewed)
 * inserts PROJECT rows into `projects` / `project_phases` / `project_items`
 * using `legacyKpiMaintenanceId` for idempotency.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { prisma } from "../src/modules/platform/db/prisma.ts";
import {
  classifyKpiRowForProjects,
  projectMigrationSignals,
} from "../src/modules/projects/project-migration-classify.ts";
import { IT_PROJECT_ENVELOPE_KIND } from "../src/modules/tasks/it-project-subkpis.ts";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function csvEscape(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function envelopeCounts(subKpis: unknown): { phases: number; items: number } {
  if (!isPlainObject(subKpis) || subKpis.kind !== IT_PROJECT_ENVELOPE_KIND) {
    return { phases: 0, items: 0 };
  }
  const phases = Array.isArray(subKpis.phases) ? subKpis.phases : [];
  let items = 0;
  for (const phase of phases) {
    if (isPlainObject(phase) && Array.isArray(phase.items)) items += phase.items.length;
  }
  return { phases: phases.length, items };
}

const outArg = process.argv.find((arg) => arg.startsWith("--out="));
const outPath = resolve(outArg ? outArg.slice("--out=".length) : join("scripts", "projects-migration-dry-run.csv"));

void (async () => {
  const rows = await prisma.kpiMaintenance.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      title: true,
      mainTask: true,
      isRecurring: true,
      frequency: true,
      itProjectName: true,
      subKpis: true,
      scopedCompanyTeamId: true,
      assignedAgentId: true,
      createdAt: true,
    },
  });

  const classified = rows.map((row) => {
    const result = classifyKpiRowForProjects({
      title: row.title,
      isRecurring: row.isRecurring,
      itProjectName: row.itProjectName,
      subKpis: row.subKpis,
    });
    const envelope = isPlainObject(row.subKpis) ? row.subKpis : null;
    const counts = envelopeCounts(row.subKpis);
    const linkedJobOrderId =
      typeof envelope?.linkedJobOrderTicketId === "string"
        ? envelope.linkedJobOrderTicketId.trim()
        : "";
    return {
      row,
      ...result,
      signals: projectMigrationSignals({
        title: row.title,
        isRecurring: row.isRecurring,
        itProjectName: row.itProjectName,
        subKpis: row.subKpis,
      }),
      phaseCount: counts.phases,
      itemCount: counts.items,
      linkedJobOrderId,
    };
  });

  const order = { EXCEPTION: 0, PROJECT: 1, TASK: 2 } as const;
  classified.sort(
    (a, b) =>
      order[a.classification] - order[b.classification] ||
      a.row.title.localeCompare(b.row.title) ||
      a.row.id.localeCompare(b.row.id),
  );

  const header = [
    "id",
    "classification",
    "reason",
    "signals",
    "title",
    "main_task",
    "it_project_name",
    "is_recurring",
    "frequency",
    "linked_job_order_ticket_id",
    "phase_count",
    "item_count",
    "scoped_company_team_id",
    "assigned_agent_id",
    "created_at",
  ];
  const lines = [header.join(",")];
  for (const entry of classified) {
    lines.push(
      [
        entry.row.id,
        entry.classification,
        entry.reason,
        entry.signals.join(";"),
        entry.row.title,
        entry.row.mainTask,
        entry.row.itProjectName,
        entry.row.isRecurring,
        entry.row.frequency,
        entry.linkedJobOrderId,
        entry.phaseCount,
        entry.itemCount,
        entry.row.scopedCompanyTeamId,
        entry.row.assignedAgentId,
        entry.row.createdAt.toISOString(),
      ]
        .map(csvEscape)
        .join(","),
    );
  }

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${lines.join("\n")}\n`, "utf8");

  const totals = { PROJECT: 0, EXCEPTION: 0, TASK: 0 };
  for (const entry of classified) totals[entry.classification] += 1;

  console.log("[projects-migration] DRY RUN — no writes performed");
  console.log(
    `[projects-migration] rows: ${rows.length} | PROJECT: ${totals.PROJECT} | EXCEPTION: ${totals.EXCEPTION} | TASK: ${totals.TASK}`,
  );
  const exceptions = classified.filter((entry) => entry.classification === "EXCEPTION");
  if (exceptions.length > 0) {
    console.log("[projects-migration] exceptions needing manual review:");
    for (const entry of exceptions) {
      console.log(`  - ${entry.row.id} "${entry.row.title}" — ${entry.reason}`);
    }
  }
  const projects = classified.filter((entry) => entry.classification === "PROJECT");
  if (projects.length > 0) {
    console.log("[projects-migration] projects to migrate:");
    for (const entry of projects) {
      console.log(
        `  - ${entry.row.id} "${entry.row.title}" [${entry.signals.join("; ")}] phases=${entry.phaseCount} items=${entry.itemCount}`,
      );
    }
  }
  const existing = await prisma.project.count();
  console.log(`[projects-migration] projects table currently holds ${existing} row(s)`);
  console.log(`[projects-migration] csv: ${outPath}`);
  await prisma.$disconnect();
})();
