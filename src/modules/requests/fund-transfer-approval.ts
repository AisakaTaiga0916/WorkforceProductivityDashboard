/** Sequential approval workflow for Fund Transfer Request Form. */

import { formatNeedsToBeProceduralLabel } from "@/modules/requests/procedural-status-label";

export const FUND_TRANSFER_APPROVAL_STEPS = [
  "PREPARED_BY",
  "RECOMMENDING_APPROVAL",
  "APPROVED_BY",
] as const;

export type FundTransferApprovalStep = (typeof FUND_TRANSFER_APPROVAL_STEPS)[number];

export type FundTransferProceduralStep = FundTransferApprovalStep | "DONE";

export type FundTransferApprovalAssignees = {
  preparedByAgentId: string | null;
  recommendingApprovalAgentId: string | null;
  approvedByAgentId: string | null;
};

export type FundTransferApprovalMeta = FundTransferApprovalAssignees & {
  proceduralStep: FundTransferProceduralStep;
  /** ISO timestamps when each step was completed. */
  completed: Partial<Record<FundTransferApprovalStep, string>>;
};

export const FUND_TRANSFER_APPROVAL_STEP_LABELS: Record<FundTransferApprovalStep, string> = {
  PREPARED_BY: "PREPARED BY",
  RECOMMENDING_APPROVAL: "RECOMMENDING APPROVAL",
  APPROVED_BY: "APPROVED BY",
};

export const FUND_TRANSFER_APPROVAL_FIELD_LABELS: Record<
  keyof FundTransferApprovalAssignees,
  string
> = {
  preparedByAgentId: "Prepared By",
  recommendingApprovalAgentId: "Recommending Approval",
  approvedByAgentId: "Approved By",
};

export function defaultFundTransferApprovalMeta(): FundTransferApprovalMeta {
  return {
    preparedByAgentId: null,
    recommendingApprovalAgentId: null,
    approvedByAgentId: null,
    proceduralStep: "PREPARED_BY",
    completed: {},
  };
}

export function isFundTransferApprovalStep(value: unknown): value is FundTransferApprovalStep {
  return (
    typeof value === "string" &&
    (FUND_TRANSFER_APPROVAL_STEPS as readonly string[]).includes(value)
  );
}

export function parseFundTransferApprovalMeta(raw: unknown): FundTransferApprovalMeta | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const step =
    o.proceduralStep === "DONE"
      ? "DONE"
      : isFundTransferApprovalStep(o.proceduralStep)
        ? o.proceduralStep
        : "PREPARED_BY";
  const completed: FundTransferApprovalMeta["completed"] = {};
  if (o.completed && typeof o.completed === "object") {
    for (const key of FUND_TRANSFER_APPROVAL_STEPS) {
      const v = (o.completed as Record<string, unknown>)[key];
      if (typeof v === "string" && v.trim()) completed[key] = v.trim();
    }
  }
  return {
    preparedByAgentId: typeof o.preparedByAgentId === "string" ? o.preparedByAgentId : null,
    recommendingApprovalAgentId:
      typeof o.recommendingApprovalAgentId === "string" ? o.recommendingApprovalAgentId : null,
    approvedByAgentId: typeof o.approvedByAgentId === "string" ? o.approvedByAgentId : null,
    proceduralStep: step,
    completed,
  };
}

export function fundTransferProceduralStatusLabel(
  step: FundTransferProceduralStep | null | undefined,
): string | null {
  if (!step || step === "DONE") return null;
  return formatNeedsToBeProceduralLabel(FUND_TRANSFER_APPROVAL_STEP_LABELS[step]);
}

export function fundTransferAssigneeFieldForStep(
  step: FundTransferApprovalStep,
): keyof FundTransferApprovalAssignees {
  switch (step) {
    case "PREPARED_BY":
      return "preparedByAgentId";
    case "RECOMMENDING_APPROVAL":
      return "recommendingApprovalAgentId";
    case "APPROVED_BY":
      return "approvedByAgentId";
  }
}

export function fundTransferAssigneeIdForStep(
  meta: FundTransferApprovalMeta,
  step: FundTransferApprovalStep,
): string | null {
  return meta[fundTransferAssigneeFieldForStep(step)];
}

/** Board assignee who should own the request for the current procedural step. */
export function currentFundTransferStepBoardAssigneeId(
  meta: FundTransferApprovalMeta,
): string | null {
  if (meta.proceduralStep === "DONE") return null;
  return fundTransferAssigneeIdForStep(meta, meta.proceduralStep);
}

export function nextFundTransferApprovalStep(
  step: FundTransferProceduralStep,
): FundTransferProceduralStep {
  if (step === "DONE") return "DONE";
  const idx = FUND_TRANSFER_APPROVAL_STEPS.indexOf(step);
  if (idx < 0) return "PREPARED_BY";
  if (idx >= FUND_TRANSFER_APPROVAL_STEPS.length - 1) return "DONE";
  return FUND_TRANSFER_APPROVAL_STEPS[idx + 1]!;
}

/** Only the ticket’s Assignment Board assignee may complete the current procedural step. */
export function canCompleteFundTransferApprovalStep(opts: {
  meta: FundTransferApprovalMeta;
  actorAgentId: string | null;
  ticketAssignedAgentId: string | null;
}): { ok: true } | { ok: false; error: string } {
  const { meta, actorAgentId, ticketAssignedAgentId } = opts;
  if (meta.proceduralStep === "DONE") {
    return { ok: false, error: "All fund transfer approval steps are already complete." };
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

export function completeFundTransferApprovalStep(
  meta: FundTransferApprovalMeta,
): FundTransferApprovalMeta {
  if (meta.proceduralStep === "DONE") return meta;
  const step = meta.proceduralStep;
  return {
    ...meta,
    proceduralStep: nextFundTransferApprovalStep(step),
    completed: {
      ...meta.completed,
      [step]: new Date().toISOString(),
    },
  };
}

export function applyFundTransferApprovalAssignees(
  meta: FundTransferApprovalMeta,
  assignees: Partial<FundTransferApprovalAssignees>,
): FundTransferApprovalMeta {
  return {
    ...meta,
    preparedByAgentId:
      assignees.preparedByAgentId !== undefined
        ? assignees.preparedByAgentId
        : meta.preparedByAgentId,
    recommendingApprovalAgentId:
      assignees.recommendingApprovalAgentId !== undefined
        ? assignees.recommendingApprovalAgentId
        : meta.recommendingApprovalAgentId,
    approvedByAgentId:
      assignees.approvedByAgentId !== undefined
        ? assignees.approvedByAgentId
        : meta.approvedByAgentId,
  };
}

/**
 * Stamp the request creator as Prepared By and mark that step complete
 * (form submission is the prepare action). Advances to Recommending Approval.
 */
export function stampFundTransferCreatorAsPreparedBy(
  meta: FundTransferApprovalMeta,
  creatorAgentId: string,
): FundTransferApprovalMeta {
  const withAssignee = applyFundTransferApprovalAssignees(meta, {
    preparedByAgentId: creatorAgentId,
  });
  if (withAssignee.completed.PREPARED_BY) {
    return withAssignee;
  }
  if (withAssignee.proceduralStep !== "PREPARED_BY") {
    return {
      ...withAssignee,
      completed: {
        ...withAssignee.completed,
        PREPARED_BY: withAssignee.completed.PREPARED_BY ?? new Date().toISOString(),
      },
    };
  }
  return {
    ...withAssignee,
    proceduralStep: "RECOMMENDING_APPROVAL",
    completed: {
      ...withAssignee.completed,
      PREPARED_BY: new Date().toISOString(),
    },
  };
}
