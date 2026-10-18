/** Sequential approval workflow for Item Requisition Slip. */

import { formatNeedsToBeProceduralLabel } from "@/modules/requests/procedural-status-label";

export const ITEM_REQUISITION_APPROVAL_STEPS = ["CANVASSED_BY", "APPROVED_BY"] as const;

export type ItemRequisitionApprovalStep = (typeof ITEM_REQUISITION_APPROVAL_STEPS)[number];

export type ItemRequisitionProceduralStep = ItemRequisitionApprovalStep | "DONE";

export type ItemRequisitionApprovalAssignees = {
  canvassedByAgentId: string | null;
  approvedByAgentId: string | null;
};

export type ItemRequisitionApprovalMeta = ItemRequisitionApprovalAssignees & {
  proceduralStep: ItemRequisitionProceduralStep;
  /** ISO timestamps when each step was completed. */
  completed: Partial<Record<ItemRequisitionApprovalStep, string>>;
};

export const ITEM_REQUISITION_APPROVAL_STEP_LABELS: Record<ItemRequisitionApprovalStep, string> = {
  CANVASSED_BY: "CANVASSED BY",
  APPROVED_BY: "APPROVED BY",
};

export const ITEM_REQUISITION_APPROVAL_FIELD_LABELS: Record<
  keyof ItemRequisitionApprovalAssignees,
  string
> = {
  canvassedByAgentId: "Canvassed By",
  approvedByAgentId: "Approved By",
};

export function defaultItemRequisitionApprovalMeta(): ItemRequisitionApprovalMeta {
  return {
    canvassedByAgentId: null,
    approvedByAgentId: null,
    proceduralStep: "CANVASSED_BY",
    completed: {},
  };
}

export function isItemRequisitionApprovalStep(
  value: unknown,
): value is ItemRequisitionApprovalStep {
  return (
    typeof value === "string" &&
    (ITEM_REQUISITION_APPROVAL_STEPS as readonly string[]).includes(value)
  );
}

export function parseItemRequisitionApprovalMeta(
  raw: unknown,
): ItemRequisitionApprovalMeta | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const step =
    o.proceduralStep === "DONE"
      ? "DONE"
      : isItemRequisitionApprovalStep(o.proceduralStep)
        ? o.proceduralStep
        : "CANVASSED_BY";
  const completed: ItemRequisitionApprovalMeta["completed"] = {};
  if (o.completed && typeof o.completed === "object") {
    for (const key of ITEM_REQUISITION_APPROVAL_STEPS) {
      const v = (o.completed as Record<string, unknown>)[key];
      if (typeof v === "string" && v.trim()) completed[key] = v.trim();
    }
  }
  return {
    canvassedByAgentId: typeof o.canvassedByAgentId === "string" ? o.canvassedByAgentId : null,
    approvedByAgentId: typeof o.approvedByAgentId === "string" ? o.approvedByAgentId : null,
    proceduralStep: step,
    completed,
  };
}

export function itemRequisitionProceduralStatusLabel(
  step: ItemRequisitionProceduralStep | null | undefined,
): string | null {
  if (!step || step === "DONE") return null;
  return formatNeedsToBeProceduralLabel(ITEM_REQUISITION_APPROVAL_STEP_LABELS[step]);
}

export function itemRequisitionAssigneeFieldForStep(
  step: ItemRequisitionApprovalStep,
): keyof ItemRequisitionApprovalAssignees {
  switch (step) {
    case "CANVASSED_BY":
      return "canvassedByAgentId";
    case "APPROVED_BY":
      return "approvedByAgentId";
  }
}

export function itemRequisitionAssigneeIdForStep(
  meta: ItemRequisitionApprovalMeta,
  step: ItemRequisitionApprovalStep,
): string | null {
  return meta[itemRequisitionAssigneeFieldForStep(step)];
}

/** Board assignee who should own the request for the current procedural step. */
export function currentItemRequisitionStepBoardAssigneeId(
  meta: ItemRequisitionApprovalMeta,
): string | null {
  if (meta.proceduralStep === "DONE") return null;
  return itemRequisitionAssigneeIdForStep(meta, meta.proceduralStep);
}

export function nextItemRequisitionApprovalStep(
  step: ItemRequisitionProceduralStep,
): ItemRequisitionProceduralStep {
  if (step === "DONE") return "DONE";
  const idx = ITEM_REQUISITION_APPROVAL_STEPS.indexOf(step);
  if (idx < 0) return "CANVASSED_BY";
  if (idx >= ITEM_REQUISITION_APPROVAL_STEPS.length - 1) return "DONE";
  return ITEM_REQUISITION_APPROVAL_STEPS[idx + 1]!;
}

/** Only the ticket’s Assignment Board assignee may complete the current procedural step. */
export function canCompleteItemRequisitionApprovalStep(opts: {
  meta: ItemRequisitionApprovalMeta;
  actorAgentId: string | null;
  ticketAssignedAgentId: string | null;
}): { ok: true } | { ok: false; error: string } {
  const { meta, actorAgentId, ticketAssignedAgentId } = opts;
  if (meta.proceduralStep === "DONE") {
    return { ok: false, error: "All item requisition approval steps are already complete." };
  }
  if (!ticketAssignedAgentId) {
    return {
      ok: false,
      error: "Assign this request on the Assignment Board before completing the approval step.",
    };
  }
  if (!actorAgentId || actorAgentId !== ticketAssignedAgentId) {
    return {
      ok: false,
      error: "Only the assigned personnel can complete this approval step.",
    };
  }
  return { ok: true };
}

export function completeItemRequisitionApprovalStep(
  meta: ItemRequisitionApprovalMeta,
): ItemRequisitionApprovalMeta {
  if (meta.proceduralStep === "DONE") return meta;
  const step = meta.proceduralStep;
  return {
    ...meta,
    proceduralStep: nextItemRequisitionApprovalStep(step),
    completed: {
      ...meta.completed,
      [step]: new Date().toISOString(),
    },
  };
}

/**
 * SuperAdmin undo of Canvassed By: clears the canvassed assignee/timestamp and
 * returns the workflow to CANVASSED_BY. Only allowed before Approved By completes.
 */
export function undoItemRequisitionCanvass(
  meta: ItemRequisitionApprovalMeta,
): { ok: true; meta: ItemRequisitionApprovalMeta } | { ok: false; error: string } {
  if (meta.proceduralStep === "DONE" || meta.completed.APPROVED_BY) {
    return {
      ok: false,
      error: "Cannot undo Canvassed By after Approved By has been completed.",
    };
  }
  if (!meta.completed.CANVASSED_BY && meta.proceduralStep === "CANVASSED_BY") {
    return { ok: false, error: "Canvassed By has not been completed yet." };
  }
  const { CANVASSED_BY: _removed, ...restCompleted } = meta.completed;
  return {
    ok: true,
    meta: {
      ...meta,
      canvassedByAgentId: null,
      proceduralStep: "CANVASSED_BY",
      completed: restCompleted,
    },
  };
}

export function applyItemRequisitionApprovalAssignees(
  meta: ItemRequisitionApprovalMeta,
  assignees: Partial<ItemRequisitionApprovalAssignees>,
): ItemRequisitionApprovalMeta {
  return {
    ...meta,
    canvassedByAgentId:
      assignees.canvassedByAgentId !== undefined
        ? assignees.canvassedByAgentId
        : meta.canvassedByAgentId,
    approvedByAgentId:
      assignees.approvedByAgentId !== undefined
        ? assignees.approvedByAgentId
        : meta.approvedByAgentId,
  };
}
