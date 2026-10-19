/**
 * Projects migration classification (pure).
 *
 * Decides whether a `kpi_maintenance` row becomes a project, stays an
 * operational task, or needs manual review during the Tasks vs Projects split.
 * Used by the dry-run CSV report and the later apply script; no DB access here.
 */

import { IT_PROJECT_ENVELOPE_KIND } from "@/modules/tasks/it-project-subkpis";
import {
  isItProjectImplementationPillar,
  isJobOrderRequestPillar,
} from "@/modules/tasks/it-task-pillar-titles";

export type ProjectMigrationSignal =
  | "it_project_envelope"
  | "is_project_flag"
  | "linked_job_order"
  | "it_project_name"
  | "it_pillar_title"
  | "jo_request_pillar"
  | "field_assignment";

export type ProjectMigrationClassification = "PROJECT" | "TASK" | "EXCEPTION";

export type ProjectMigrationClassifyInput = {
  title: string;
  isRecurring: boolean;
  itProjectName?: string | null;
  subKpis: unknown;
};

export type ProjectMigrationClassifyResult = {
  classification: ProjectMigrationClassification;
  reason: string;
  signals: ProjectMigrationSignal[];
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** All detected signals for a row, in stable order. */
export function projectMigrationSignals(
  input: ProjectMigrationClassifyInput,
): ProjectMigrationSignal[] {
  const signals: ProjectMigrationSignal[] = [];
  const envelope = isPlainObject(input.subKpis) ? input.subKpis : null;

  if (envelope?.kind === IT_PROJECT_ENVELOPE_KIND) signals.push("it_project_envelope");
  if (envelope?.isProject === true) signals.push("is_project_flag");
  if (
    typeof envelope?.linkedJobOrderTicketId === "string" &&
    envelope.linkedJobOrderTicketId.trim()
  ) {
    signals.push("linked_job_order");
  }
  if (input.itProjectName?.trim()) signals.push("it_project_name");
  if (isItProjectImplementationPillar(input.title)) signals.push("it_pillar_title");
  if (isJobOrderRequestPillar(input.title)) signals.push("jo_request_pillar");
  if (envelope?.isFieldAssignment === true) signals.push("field_assignment");

  return signals;
}

export function classifyKpiRowForProjects(
  input: ProjectMigrationClassifyInput,
): ProjectMigrationClassifyResult {
  const signals = projectMigrationSignals(input);
  const projectSignals = signals.filter((s) => s !== "field_assignment");
  const isFieldAssignment = signals.includes("field_assignment");

  if (isFieldAssignment && projectSignals.length > 0) {
    return {
      classification: "EXCEPTION",
      reason: "Field assignment with project signals — review required.",
      signals,
    };
  }
  if (isFieldAssignment) {
    return { classification: "TASK", reason: "Field assignment (operational).", signals };
  }
  if (projectSignals.length === 0) {
    return { classification: "TASK", reason: "No project signals.", signals };
  }
  if (input.isRecurring) {
    return {
      classification: "EXCEPTION",
      reason: "Project signals on a recurring row (hybrid).",
      signals,
    };
  }
  if (signals.includes("is_project_flag") && !signals.includes("it_project_envelope")) {
    return {
      classification: "EXCEPTION",
      reason: "Project flag without timeline envelope — phases must be synthesized.",
      signals,
    };
  }

  return {
    classification: "PROJECT",
    reason: `Project signals: ${projectSignals.join(", ")}.`,
    signals,
  };
}
