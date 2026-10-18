import { isItProjectEnvelope, parseItProjectSubKpis } from "@/modules/tasks/it-project-subkpis";
import {
  getTaskTargetDueDate,
  normalizeSubKpis,
  resolveEffectiveSubKpiDueDate,
  subKpiDueDateRollsWithCycle,
  subKpiHasCustomDueDate,
  type SubKpiItem,
} from "@/modules/tasks/kpi-subkpis";
import { subKpiRequirementsMet } from "@/modules/tasks/sub-kpi-completion-mode";

/** Flat sub-task shape returned by the /kpi-maintenance/[id]/subtasks REST endpoints. */
export type SubTaskDto = {
  id: string;
  title: string;
  description: string | null;
  /** Optional free-text remarks / notes (never required). */
  remarks: string | null;
  /** Derived board status ("Done" / "Pending"), or the IT-project projectStatus when set. */
  status: string;
  done: boolean;
  assignee: { id: string; name: string } | null;
  startDate: string | null;
  /** Stored custom due date only (null when inheriting the main task target). */
  dueDate: string | null;
  /** When true, custom due date advances with each recurrence cycle. */
  dueDateRollsWithCycle: boolean;
  /** Effective date used for display/delay (custom or inherited). */
  effectiveDueDate: string | null;
  /** True when the subtask has no custom due date and uses the main task target. */
  inheritsDueDate: boolean;
  priority: SubKpiItem["projectPriority"];
  segmentId: string | null;
  segmentLabel: string | null;
  assistanceRequested: boolean;
};

export type SubTasksListPayload = {
  taskId: string;
  /** Main-task target date from the checklist envelope (`pillarDueDate`). */
  taskDueDate: string | null;
  /** True when the checklist is segmented (Kanban boards). */
  segmented: boolean;
  /** Segment definitions (includes empty boards + Unsegmented). */
  segments: Array<{ id: string; label: string }>;
  subtasks: SubTaskDto[];
};

export function subTaskToDto(
  item: SubKpiItem,
  segment?: { id: string; label: string } | null,
  parentDueYmd?: string | null,
): SubTaskDto {
  const done = subKpiRequirementsMet(item);
  const resolved = resolveEffectiveSubKpiDueDate(item, parentDueYmd);
  return {
    id: item.id,
    title: item.title,
    description: item.description?.trim() ? item.description.trim() : null,
    remarks: item.remarks?.trim() ? item.remarks.trim() : null,
    status: item.projectStatus ?? (done ? "Done" : "Pending"),
    done,
    assignee:
      item.assignedAgentId && item.assignedAgentId.trim()
        ? { id: item.assignedAgentId.trim(), name: item.assignedAgentName?.trim() || "Assignee" }
        : null,
    startDate: item.startDate ?? null,
    dueDate: subKpiHasCustomDueDate(item) ? (item.dueDate ?? null) : null,
    dueDateRollsWithCycle: subKpiDueDateRollsWithCycle(item),
    effectiveDueDate: resolved.dueDate,
    inheritsDueDate: resolved.inherits,
    priority: item.projectPriority ?? null,
    segmentId: segment?.id ?? null,
    segmentLabel: segment?.label ?? null,
    assistanceRequested: item.assistanceRequested === true,
  };
}

/** List all sub-tasks (flat, segmented, or IT-project envelopes) as REST DTOs. */
export function listSubTaskDtos(subKpisRaw: unknown): SubTaskDto[] {
  const parentDue = getTaskTargetDueDate(subKpisRaw);
  if (isItProjectEnvelope(subKpisRaw)) {
    const parsed = parseItProjectSubKpis(subKpisRaw);
    return parsed.phases.flatMap((phase) =>
      phase.items.map((item) => subTaskToDto(item, { id: phase.id, label: phase.name }, phase.dueDate)),
    );
  }
  const n = normalizeSubKpis(subKpisRaw);
  if (n.segmented) {
    return n.segments.flatMap((seg) =>
      seg.items.map((item) => subTaskToDto(item, { id: seg.id, label: seg.label }, parentDue)),
    );
  }
  return n.flat.map((item) => subTaskToDto(item, null, parentDue));
}

export function listSubTasksPayload(taskId: string, subKpisRaw: unknown): SubTasksListPayload {
  if (isItProjectEnvelope(subKpisRaw)) {
    const parsed = parseItProjectSubKpis(subKpisRaw);
    return {
      taskId,
      taskDueDate: getTaskTargetDueDate(subKpisRaw),
      segmented: true,
      segments: parsed.phases.map((phase) => ({ id: phase.id, label: phase.name })),
      subtasks: listSubTaskDtos(subKpisRaw),
    };
  }
  const n = normalizeSubKpis(subKpisRaw);
  if (n.segmented) {
    return {
      taskId,
      taskDueDate: getTaskTargetDueDate(subKpisRaw),
      segmented: true,
      segments: n.segments.map((seg) => ({ id: seg.id, label: seg.label })),
      subtasks: listSubTaskDtos(subKpisRaw),
    };
  }
  return {
    taskId,
    taskDueDate: getTaskTargetDueDate(subKpisRaw),
    segmented: false,
    segments: [],
    subtasks: listSubTaskDtos(subKpisRaw),
  };
}
