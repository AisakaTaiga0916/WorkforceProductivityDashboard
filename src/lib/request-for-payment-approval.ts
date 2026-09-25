/** Sequential approval workflow for Request for Payment. */

import { formatNeedsToBeProceduralLabel } from "@/lib/procedural-status-label";

/**
 * Active procedural chain (PREPARED BY is intake-only, not a procedural step).
 * Legacy keys RECEIVED_BY_* / PREPARED_BY are normalized in parse.
 */
export const PAYMENT_APPROVAL_STEPS = [
  "NOTED_BY",
  "APPROVED_BY",
  "APPROVED_BY_ACCOUNTING",
  "APPROVED_BY_FINANCE",
] as const;

export type PaymentApprovalStep = (typeof PAYMENT_APPROVAL_STEPS)[number];

export type PaymentProceduralStep = PaymentApprovalStep | "DONE";

/** Accounting / Finance must click Approved before Done can hand off the board. */
export const PAYMENT_APPROVAL_ACK_STEPS = [
  "APPROVED_BY_ACCOUNTING",
  "APPROVED_BY_FINANCE",
] as const;

export type PaymentApprovalAckStep = (typeof PAYMENT_APPROVAL_ACK_STEPS)[number];

export type PaymentApprovalAssignees = {
  /** Intake “PREPARED BY” person — not part of the procedural chain. */
  preparedByAgentId: string | null;
  notedByAgentId: string | null;
  approvedByAgentId: string | null;
  accountingAgentId: string | null;
  financeAgentId: string | null;
};

export type PaymentApprovalMeta = PaymentApprovalAssignees & {
  proceduralStep: PaymentProceduralStep;
  /** ISO timestamps when each step was completed (Done → handoff). */
  completed: Partial<Record<PaymentApprovalStep, string>>;
  /**
   * ISO timestamps when Accounting/Finance clicked Approved (approval recorded,
   * but board handoff waits for Done).
   */
  stepApproved: Partial<Record<PaymentApprovalAckStep, string>>;
  /**
   * Intake chose “Let Bookkeeper and Accounting handle it” — mode of payment is
   * filled on ticket details at APPROVED BY ACCOUNTING instead of at create.
   */
  deferPaymentModeToAccounting?: boolean;
  /**
   * Intake chose “Skip Noted by” — the NOTED BY step is hidden and the chain
   * starts at APPROVED BY.
   */
  skipNotedBy?: boolean;
  /**
   * Intake chose “Skip Approved By” — the APPROVED BY step is hidden; the chain
   * goes NOTED BY → APPROVED BY (Accounting) unless Noted By is also skipped.
   */
  skipApprovedBy?: boolean;
  /**
   * RFP was auto-created from a Travel Order / Work Plan and is held until that
   * order is fully APPROVED. Board / pending-approval queues ignore it while true.
   */
  awaitingTravelOrderApproval?: boolean;
};

export const PAYMENT_APPROVAL_STEP_LABELS: Record<PaymentApprovalStep, string> = {
  NOTED_BY: "NOTED BY",
  APPROVED_BY: "APPROVED BY",
  APPROVED_BY_ACCOUNTING: "PREPARED BY BOOKKEEPER",
  APPROVED_BY_FINANCE: "APPROVED BY ACCOUNTING",
};

export const PAYMENT_APPROVAL_FIELD_LABELS: Record<keyof PaymentApprovalAssignees, string> = {
  preparedByAgentId: "Prepared By",
  notedByAgentId: "Noted By",
  approvedByAgentId: "Approved By",
  accountingAgentId: "Prepared by Bookkeeper:",
  financeAgentId: "Approved By Accounting",
};

const LEGACY_STEP_ALIASES: Record<string, PaymentProceduralStep> = {
  PREPARED_BY: "NOTED_BY",
  RECEIVED_BY_ACCOUNTING: "APPROVED_BY_ACCOUNTING",
  RECEIVED_BY_FINANCE: "APPROVED_BY_FINANCE",
};

function normalizeProceduralStep(raw: unknown): PaymentProceduralStep {
  if (raw === "DONE") return "DONE";
  if (typeof raw !== "string") return "NOTED_BY";
  if (isPaymentApprovalStep(raw)) return raw;
  return LEGACY_STEP_ALIASES[raw] ?? "NOTED_BY";
}

function normalizeCompletedKey(key: string): PaymentApprovalStep | null {
  if (isPaymentApprovalStep(key)) return key;
  // Only remap legacy accounting/finance completion stamps — do not fold old
  // APPROVED_BY / PREPARED_BY completions into the new procedural steps.
  if (key === "RECEIVED_BY_ACCOUNTING") return "APPROVED_BY_ACCOUNTING";
  if (key === "RECEIVED_BY_FINANCE") return "APPROVED_BY_FINANCE";
  return null;
}

export function isPaymentApprovalAckStep(value: unknown): value is PaymentApprovalAckStep {
  return (
    typeof value === "string" &&
    (PAYMENT_APPROVAL_ACK_STEPS as readonly string[]).includes(value)
  );
}

export function paymentApprovalStartStep(
  skipNotedBy: boolean,
  skipApprovedBy: boolean,
): PaymentApprovalStep {
  if (skipNotedBy && skipApprovedBy) return "APPROVED_BY_ACCOUNTING";
  if (skipNotedBy) return "APPROVED_BY";
  return "NOTED_BY";
}

export function defaultPaymentApprovalMeta(opts?: {
  skipNotedBy?: boolean;
  skipApprovedBy?: boolean;
  awaitingTravelOrderApproval?: boolean;
}): PaymentApprovalMeta {
  const skipNotedBy = opts?.skipNotedBy === true;
  const skipApprovedBy = opts?.skipApprovedBy === true;
  const awaitingTravelOrderApproval = opts?.awaitingTravelOrderApproval === true;
  return {
    preparedByAgentId: null,
    notedByAgentId: null,
    approvedByAgentId: null,
    accountingAgentId: null,
    financeAgentId: null,
    proceduralStep: paymentApprovalStartStep(skipNotedBy, skipApprovedBy),
    completed: {},
    stepApproved: {},
    ...(skipNotedBy ? { skipNotedBy: true } : {}),
    ...(skipApprovedBy ? { skipApprovedBy: true } : {}),
    ...(awaitingTravelOrderApproval ? { awaitingTravelOrderApproval: true } : {}),
  };
}

export function isPaymentApprovalStep(value: unknown): value is PaymentApprovalStep {
  return typeof value === "string" && (PAYMENT_APPROVAL_STEPS as readonly string[]).includes(value);
}

export function parsePaymentApprovalMeta(raw: unknown): PaymentApprovalMeta | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const step = normalizeProceduralStep(o.proceduralStep);
  const completed: PaymentApprovalMeta["completed"] = {};
  if (o.completed && typeof o.completed === "object") {
    for (const [key, v] of Object.entries(o.completed as Record<string, unknown>)) {
      if (typeof v !== "string" || !v.trim()) continue;
      const normalized = normalizeCompletedKey(key);
      if (normalized && !completed[normalized]) completed[normalized] = v.trim();
    }
  }
  const stepApproved: PaymentApprovalMeta["stepApproved"] = {};
  if (o.stepApproved && typeof o.stepApproved === "object") {
    for (const [key, v] of Object.entries(o.stepApproved as Record<string, unknown>)) {
      if (typeof v !== "string" || !v.trim()) continue;
      if (isPaymentApprovalAckStep(key) && !stepApproved[key]) stepApproved[key] = v.trim();
    }
  }
  return {
    preparedByAgentId: typeof o.preparedByAgentId === "string" ? o.preparedByAgentId : null,
    notedByAgentId: typeof o.notedByAgentId === "string" ? o.notedByAgentId : null,
    approvedByAgentId: typeof o.approvedByAgentId === "string" ? o.approvedByAgentId : null,
    accountingAgentId: typeof o.accountingAgentId === "string" ? o.accountingAgentId : null,
    financeAgentId: typeof o.financeAgentId === "string" ? o.financeAgentId : null,
    proceduralStep: step,
    completed,
    stepApproved,
    deferPaymentModeToAccounting: o.deferPaymentModeToAccounting === true,
    skipNotedBy: o.skipNotedBy === true,
    skipApprovedBy: o.skipApprovedBy === true,
    awaitingTravelOrderApproval: o.awaitingTravelOrderApproval === true,
  };
}

export function paymentProceduralStatusLabel(
  step: PaymentProceduralStep | null | undefined,
): string | null {
  if (!step || step === "DONE") return null;
  return formatNeedsToBeProceduralLabel(PAYMENT_APPROVAL_STEP_LABELS[step]);
}

/** True when the full Noted → Approved → Accounting → Finance chain is complete (green-lit). */
export function isPaymentProcedureGreenLit(
  meta: PaymentApprovalMeta | null | undefined,
): boolean {
  return meta?.proceduralStep === "DONE";
}

export function assigneeFieldForStep(
  step: PaymentApprovalStep,
): keyof PaymentApprovalAssignees {
  switch (step) {
    case "NOTED_BY":
      return "notedByAgentId";
    case "APPROVED_BY":
      return "approvedByAgentId";
    case "APPROVED_BY_ACCOUNTING":
      return "accountingAgentId";
    case "APPROVED_BY_FINANCE":
      return "financeAgentId";
  }
}

export function assigneeIdForStep(
  meta: PaymentApprovalMeta,
  step: PaymentApprovalStep,
): string | null {
  return meta[assigneeFieldForStep(step)];
}

/** Board assignee who should own the request for the current procedural step (Request Board). */
export function currentPaymentStepBoardAssigneeId(
  meta: PaymentApprovalMeta,
): string | null {
  if (meta.awaitingTravelOrderApproval) return null;
  if (meta.proceduralStep === "DONE") return null;
  return assigneeIdForStep(meta, meta.proceduralStep);
}

/** Agent ids already assigned to a procedural approval role on this request. */
export function paymentApprovalParticipantIds(meta: PaymentApprovalMeta): Set<string> {
  const ids = new Set<string>();
  for (const step of paymentApprovalStepsFor(meta)) {
    const id = assigneeIdForStep(meta, step);
    if (id) ids.add(id);
  }
  return ids;
}

/**
 * One person may hold only one procedural approval role on a single Request for Payment.
 * Re-selecting the same person for the same step is allowed.
 * Open seats (no dedicated assignee) may be filled by someone who already completed an
 * earlier role — otherwise deferred Accounting work cannot proceed when Accounting /
 * Finance were left unset at intake.
 */
export function canAssignPaymentApprover(opts: {
  meta: PaymentApprovalMeta;
  agentId: string;
  forStep: PaymentApprovalStep;
}): { ok: true } | { ok: false; error: string } {
  const { meta, agentId, forStep } = opts;
  if (!agentId.trim()) {
    return { ok: false, error: "Select a company user for this approval step." };
  }
  const currentForStep = assigneeIdForStep(meta, forStep);
  if (currentForStep === agentId) return { ok: true };
  // Unset role seat: allow the current board holder to take it even after an earlier signature.
  if (!currentForStep) return { ok: true };

  for (const step of paymentApprovalStepsFor(meta)) {
    if (step === forStep) continue;
    const existing = assigneeIdForStep(meta, step);
    if (existing === agentId) {
      return {
        ok: false,
        error: `This user already has a role on this request (${PAYMENT_APPROVAL_STEP_LABELS[step]}). Each person may only approve once.`,
      };
    }
  }
  return { ok: true };
}

/** True when Accounting and Finance roles were left unset at intake. */
export function paymentAccountingFinanceAssigneesUnset(meta: PaymentApprovalMeta): boolean {
  return !meta.accountingAgentId?.trim() && !meta.financeAgentId?.trim();
}

/** Procedural steps that apply for this request (Approved By may be skipped at intake). */
export function paymentApprovalStepsFor(
  meta: Pick<PaymentApprovalMeta, "skipApprovedBy" | "skipNotedBy"> | null | undefined,
): PaymentApprovalStep[] {
  return PAYMENT_APPROVAL_STEPS.filter((step) => {
    if (meta?.skipNotedBy && step === "NOTED_BY") return false;
    if (meta?.skipApprovedBy && step === "APPROVED_BY") return false;
    return true;
  });
}

/** Noted By and Approved By have both been marked Done (green-lit). */
export function paymentNotedAndApprovedByComplete(meta: PaymentApprovalMeta): boolean {
  if (!meta.completed.NOTED_BY) return false;
  if (meta.skipApprovedBy) return true;
  return Boolean(meta.completed.APPROVED_BY);
}

function paymentModeDeferredOrEmpty(
  meta: PaymentApprovalMeta,
  modeOfPayment: string | null | undefined,
): boolean {
  return meta.deferPaymentModeToAccounting === true || !(modeOfPayment ?? "").trim();
}

/**
 * Board holder / Admin may set or change Mode of payment after Noted By + Approved By
 * are green-lit:
 * - On APPROVED BY ACCOUNTING (set initially or edit an existing mode)
 * - On APPROVED BY when mode was deferred and Accounting/Finance seats are still unset
 */
export function canEditDeferredPaymentMode(opts: {
  meta: PaymentApprovalMeta;
  proceduralStep: PaymentProceduralStep | PaymentApprovalStep | "DONE" | null;
  modeOfPayment: string | null | undefined;
}): boolean {
  const { meta, proceduralStep, modeOfPayment } = opts;
  if (!proceduralStep || proceduralStep === "DONE") return false;
  if (!paymentNotedAndApprovedByComplete(meta)) return false;
  if (proceduralStep === "APPROVED_BY_ACCOUNTING") return true;
  if (!paymentModeDeferredOrEmpty(meta, modeOfPayment)) return false;
  return paymentAccountingFinanceAssigneesUnset(meta) && proceduralStep === "APPROVED_BY";
}

/**
 * After Noted By + Approved By are green-lit, missing Bookkeeper / Accounting seats
 * may be assigned on the ticket (intake no longer collects those roles).
 */
export function canAssignDeferredPaymentAccountingFinance(opts: {
  meta: PaymentApprovalMeta;
  modeOfPayment?: string | null | undefined;
}): boolean {
  const { meta } = opts;
  if (!paymentNotedAndApprovedByComplete(meta)) return false;
  return !meta.accountingAgentId?.trim() || !meta.financeAgentId?.trim();
}

/**
 * When the current step has no dedicated role assignee, allow the board assignee to
 * continue even if they already signed an earlier role (releases Approved By signee lock).
 */
export function paymentStepAllowsRepeatSigner(
  meta: PaymentApprovalMeta,
  step: PaymentApprovalStep,
): boolean {
  return !assigneeIdForStep(meta, step)?.trim();
}

export function nextPaymentApprovalStep(
  step: PaymentProceduralStep,
  meta?: Pick<PaymentApprovalMeta, "skipApprovedBy"> | null,
): PaymentProceduralStep {
  if (step === "DONE") return "DONE";
  if (step === "NOTED_BY" && meta?.skipApprovedBy) {
    return "APPROVED_BY_ACCOUNTING";
  }
  if (step === "APPROVED_BY" && meta?.skipApprovedBy) {
    return "APPROVED_BY_ACCOUNTING";
  }
  const idx = PAYMENT_APPROVAL_STEPS.indexOf(step);
  if (idx < 0) return "NOTED_BY";
  if (idx >= PAYMENT_APPROVAL_STEPS.length - 1) return "DONE";
  return PAYMENT_APPROVAL_STEPS[idx + 1]!;
}

/**
 * Only the ticket’s Assignment Board assignee may complete the current procedural step.
 * When a role assignee is already set, that person must be the board assignee.
 */
export function canCompletePaymentApprovalStep(opts: {
  meta: PaymentApprovalMeta;
  actorAgentId: string | null;
  ticketAssignedAgentId: string | null;
}): { ok: true } | { ok: false; error: string } {
  const { meta, actorAgentId, ticketAssignedAgentId } = opts;
  if (meta.proceduralStep === "DONE") {
    return { ok: false, error: "All payment approval steps are already complete." };
  }
  if (meta.skipApprovedBy && meta.proceduralStep === "APPROVED_BY") {
    return {
      ok: false,
      error: "Approved By was skipped for this request. Refresh to continue at Accounting.",
    };
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
  const roleAssignee = assigneeIdForStep(meta, meta.proceduralStep);
  if (roleAssignee && roleAssignee !== actorAgentId) {
    return {
      ok: false,
      error: `Only the ${PAYMENT_APPROVAL_STEP_LABELS[meta.proceduralStep]} assignee can complete this step.`,
    };
  }
  return { ok: true };
}

/** Accounting / Finance must click Approved before Done can advance the chain. */
export function paymentStepRequiresApprovedAck(step: PaymentApprovalStep): boolean {
  return isPaymentApprovalAckStep(step);
}

export function isPaymentStepApprovedAck(
  meta: PaymentApprovalMeta,
  step: PaymentApprovalStep,
): boolean {
  if (!isPaymentApprovalAckStep(step)) return true;
  return Boolean(meta.stepApproved[step]);
}

export function canMarkPaymentStepApproved(opts: {
  meta: PaymentApprovalMeta;
  actorAgentId: string | null;
  ticketAssignedAgentId: string | null;
}): { ok: true } | { ok: false; error: string } {
  const gate = canCompletePaymentApprovalStep(opts);
  if (!gate.ok) return gate;
  const step = opts.meta.proceduralStep;
  if (step === "DONE" || !paymentStepRequiresApprovedAck(step)) {
    return { ok: false, error: "Approved applies only to Accounting and Finance steps." };
  }
  if (isPaymentStepApprovedAck(opts.meta, step)) {
    return { ok: false, error: "This step is already approved. Click Done to hand off." };
  }
  return { ok: true };
}

/** Record Approved for the current Accounting/Finance step without advancing. */
export function markPaymentStepApproved(meta: PaymentApprovalMeta): PaymentApprovalMeta {
  if (meta.proceduralStep === "DONE") return meta;
  const step = meta.proceduralStep;
  if (!isPaymentApprovalAckStep(step)) return meta;
  if (meta.stepApproved[step]) return meta;
  return {
    ...meta,
    stepApproved: {
      ...meta.stepApproved,
      [step]: new Date().toISOString(),
    },
  };
}

export function completePaymentApprovalStep(meta: PaymentApprovalMeta): PaymentApprovalMeta {
  if (meta.proceduralStep === "DONE") return meta;
  const step = meta.proceduralStep;
  return {
    ...meta,
    proceduralStep: nextPaymentApprovalStep(step, meta),
    completed: {
      ...meta.completed,
      [step]: new Date().toISOString(),
    },
  };
}

export function applyPaymentApprovalAssignees(
  meta: PaymentApprovalMeta,
  assignees: Partial<PaymentApprovalAssignees>,
): PaymentApprovalMeta {
  return {
    ...meta,
    preparedByAgentId:
      assignees.preparedByAgentId !== undefined
        ? assignees.preparedByAgentId
        : meta.preparedByAgentId,
    notedByAgentId:
      assignees.notedByAgentId !== undefined ? assignees.notedByAgentId : meta.notedByAgentId,
    approvedByAgentId:
      assignees.approvedByAgentId !== undefined
        ? assignees.approvedByAgentId
        : meta.approvedByAgentId,
    accountingAgentId:
      assignees.accountingAgentId !== undefined
        ? assignees.accountingAgentId
        : meta.accountingAgentId,
    financeAgentId:
      assignees.financeAgentId !== undefined ? assignees.financeAgentId : meta.financeAgentId,
  };
}

/**
 * @deprecated PREPARED BY is no longer a procedural step. Kept for callers that
 * still stamp the preparer identity without advancing the chain.
 */
export function stampPaymentAssigneeAsPreparedBy(
  meta: PaymentApprovalMeta,
  assigneeAgentId: string,
): PaymentApprovalMeta {
  return applyPaymentApprovalAssignees(meta, {
    preparedByAgentId: assigneeAgentId,
  });
}

/** Steps that show a dedicated “Done” control once the request is running on that role. */
export function paymentStepShowsDoneButton(step: PaymentApprovalStep): boolean {
  return (
    step === "NOTED_BY" ||
    step === "APPROVED_BY" ||
    step === "APPROVED_BY_ACCOUNTING" ||
    step === "APPROVED_BY_FINANCE"
  );
}

/** Accounting / Finance show Approved before Done. */
export function paymentStepShowsApprovedButton(step: PaymentApprovalStep): boolean {
  return paymentStepRequiresApprovedAck(step);
}
