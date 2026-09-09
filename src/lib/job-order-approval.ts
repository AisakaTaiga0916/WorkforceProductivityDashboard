/** Sequential approval workflow for Job Order requests. */

import { formatNeedsToBeProceduralLabel } from "@/lib/procedural-status-label";

/**
 * Active procedural chain (PREPARED BY is intake-only, not a procedural step).
 * Assignees may be chosen from any company.
 */
export const JOB_ORDER_APPROVAL_STEPS = [
  "NOTED_BY",
  "APPROVED_BY",
  "APPROVED_BY_2",
] as const;

export type JobOrderApprovalStep = (typeof JOB_ORDER_APPROVAL_STEPS)[number];

export type JobOrderProceduralStep = JobOrderApprovalStep | "DONE";

export type JobOrderApprovalAssignees = {
  /** Intake “Submitted By” person — not part of the procedural chain. */
  preparedByAgentId: string | null;
  notedByAgentId: string | null;
  approvedByAgentId: string | null;
  /** Second Approved By seat (same display label; General roster). */
  approvedBy2AgentId: string | null;
};

export type JobOrderApprovalMeta = JobOrderApprovalAssignees & {
  proceduralStep: JobOrderProceduralStep;
  /** ISO timestamps when each step was completed. */
  completed: Partial<Record<JobOrderApprovalStep, string>>;
  /** Intake: skip Noted By (requestor head) and start at Approved By. */
  skipNotedBy?: boolean;
  /** Intake: skip first Approved By (send-to head); final Approved By still required. */
  skipApprovedBy?: boolean;
  /**
   * Chosen after prior seats green-lit, before the chain is fully DONE.
   * Applied to the ticket board assignee when approvals reach DONE.
   */
  pendingExecutionAssigneeAgentId?: string | null;
  /** Post-approval co-workers who share KPI credit with the execution assignee. */
  workerAgentIds?: string[];
  /** Set when an admin assigns execution; until then the board icon stays cleared. */
  executionAssignedAt?: string | null;
  /**
   * When the execution assignee is outside Send request to (department),
   * approvers can stage an assistance team scoped by department or company.
   */
  assistanceTeam?: JobOrderAssistanceTeam | null;
  /**
   * ISO timestamp when execution/assistance marked Job Done.
   * Final Approved By (and customer confirmation) wait for this.
   */
  jobDoneAt?: string | null;
};

export type JobOrderAssistanceScopeMode = "department" | "company";

export type JobOrderAssistanceTeam = {
  scopeMode: JobOrderAssistanceScopeMode;
  orgChartSectionId: string | null;
  companyTeamId: string | null;
  assigneeAgentId: string | null;
  workerAgentIds: string[];
};

export function defaultJobOrderAssistanceTeam(
  partial?: Partial<JobOrderAssistanceTeam>,
): JobOrderAssistanceTeam {
  return {
    scopeMode: partial?.scopeMode === "company" ? "company" : "department",
    orgChartSectionId: partial?.orgChartSectionId?.trim() || null,
    companyTeamId: partial?.companyTeamId?.trim() || null,
    assigneeAgentId: partial?.assigneeAgentId?.trim() || null,
    workerAgentIds: Array.isArray(partial?.workerAgentIds)
      ? [...new Set(partial.workerAgentIds.map((id) => id.trim()).filter(Boolean))]
      : [],
  };
}

export function parseJobOrderAssistanceTeam(raw: unknown): JobOrderAssistanceTeam | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  return defaultJobOrderAssistanceTeam({
    scopeMode: o.scopeMode === "company" ? "company" : "department",
    orgChartSectionId: typeof o.orgChartSectionId === "string" ? o.orgChartSectionId : null,
    companyTeamId: typeof o.companyTeamId === "string" ? o.companyTeamId : null,
    assigneeAgentId: typeof o.assigneeAgentId === "string" ? o.assigneeAgentId : null,
    workerAgentIds: Array.isArray(o.workerAgentIds)
      ? o.workerAgentIds.filter((id): id is string => typeof id === "string")
      : [],
  });
}

export const JOB_ORDER_APPROVAL_STEP_LABELS: Record<JobOrderApprovalStep, string> = {
  NOTED_BY: "NOTED BY",
  APPROVED_BY: "APPROVED BY",
  APPROVED_BY_2: "APPROVED BY",
};

/** Form / ticket-control labels. */
export const JOB_ORDER_APPROVAL_FIELD_LABELS: Record<keyof JobOrderApprovalAssignees, string> = {
  preparedByAgentId: "Submitted By",
  notedByAgentId: "Noted By",
  approvedByAgentId: "Approved By",
  approvedBy2AgentId: "Approved By",
};

const LEGACY_STEP_ALIASES: Record<string, JobOrderProceduralStep> = {
  PREPARED_BY: "NOTED_BY",
};

function normalizeProceduralStep(raw: unknown): JobOrderProceduralStep {
  if (raw === "DONE") return "DONE";
  if (typeof raw !== "string") return "NOTED_BY";
  if (isJobOrderApprovalStep(raw)) return raw;
  return LEGACY_STEP_ALIASES[raw] ?? "NOTED_BY";
}

export function jobOrderApprovalStartStep(
  skipNotedBy: boolean,
  skipApprovedBy: boolean,
): JobOrderApprovalStep {
  if (skipNotedBy && skipApprovedBy) return "APPROVED_BY_2";
  if (skipNotedBy) return "APPROVED_BY";
  return "NOTED_BY";
}

/** Procedural steps that apply for this request (Noted By / first Approved By may be skipped). */
export function jobOrderApprovalStepsFor(
  meta: Pick<JobOrderApprovalMeta, "skipApprovedBy" | "skipNotedBy"> | null | undefined,
): JobOrderApprovalStep[] {
  return JOB_ORDER_APPROVAL_STEPS.filter((step) => {
    if (meta?.skipNotedBy && step === "NOTED_BY") return false;
    if (meta?.skipApprovedBy && step === "APPROVED_BY") return false;
    return true;
  });
}

export function defaultJobOrderApprovalMeta(opts?: {
  skipNotedBy?: boolean;
  skipApprovedBy?: boolean;
}): JobOrderApprovalMeta {
  const skipNotedBy = opts?.skipNotedBy === true;
  const skipApprovedBy = opts?.skipApprovedBy === true;
  return {
    preparedByAgentId: null,
    notedByAgentId: null,
    approvedByAgentId: null,
    approvedBy2AgentId: null,
    proceduralStep: jobOrderApprovalStartStep(skipNotedBy, skipApprovedBy),
    completed: {},
    workerAgentIds: [],
    executionAssignedAt: null,
    ...(skipNotedBy ? { skipNotedBy: true } : {}),
    ...(skipApprovedBy ? { skipApprovedBy: true } : {}),
  };
}

export function isJobOrderApprovalStep(value: unknown): value is JobOrderApprovalStep {
  return typeof value === "string" && (JOB_ORDER_APPROVAL_STEPS as readonly string[]).includes(value);
}

export function parseJobOrderApprovalMeta(raw: unknown): JobOrderApprovalMeta | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const completed: JobOrderApprovalMeta["completed"] = {};
  if (o.completed && typeof o.completed === "object") {
    for (const key of JOB_ORDER_APPROVAL_STEPS) {
      const v = (o.completed as Record<string, unknown>)[key];
      if (typeof v === "string" && v.trim()) completed[key] = v.trim();
    }
  }
  return {
    preparedByAgentId: typeof o.preparedByAgentId === "string" ? o.preparedByAgentId : null,
    notedByAgentId: typeof o.notedByAgentId === "string" ? o.notedByAgentId : null,
    approvedByAgentId: typeof o.approvedByAgentId === "string" ? o.approvedByAgentId : null,
    approvedBy2AgentId: typeof o.approvedBy2AgentId === "string" ? o.approvedBy2AgentId : null,
    proceduralStep: normalizeProceduralStep(o.proceduralStep),
    completed,
    skipNotedBy: o.skipNotedBy === true,
    skipApprovedBy: o.skipApprovedBy === true,
    pendingExecutionAssigneeAgentId:
      typeof o.pendingExecutionAssigneeAgentId === "string" &&
      o.pendingExecutionAssigneeAgentId.trim()
        ? o.pendingExecutionAssigneeAgentId.trim()
        : null,
    workerAgentIds: Array.isArray(o.workerAgentIds)
      ? o.workerAgentIds.filter((id): id is string => typeof id === "string" && Boolean(id.trim()))
      : [],
    executionAssignedAt:
      typeof o.executionAssignedAt === "string" && o.executionAssignedAt.trim()
        ? o.executionAssignedAt.trim()
        : null,
    assistanceTeam: parseJobOrderAssistanceTeam(o.assistanceTeam),
    jobDoneAt:
      typeof o.jobDoneAt === "string" && o.jobDoneAt.trim() ? o.jobDoneAt.trim() : null,
  };
}

export function jobOrderProceduralStatusLabel(
  step: JobOrderProceduralStep | null | undefined,
): string | null {
  if (!step || step === "DONE") return null;
  return formatNeedsToBeProceduralLabel(JOB_ORDER_APPROVAL_STEP_LABELS[step]);
}

/** True when at least one procedural approval seat has been marked Done. */
export function hasJobOrderFirstApprovalCompleted(
  meta: JobOrderApprovalMeta | null | undefined,
): boolean {
  if (!meta) return false;
  if (meta.proceduralStep === "DONE") return true;
  return JOB_ORDER_APPROVAL_STEPS.some((step) => Boolean(meta.completed[step]));
}

/** Final remaining procedural seat (the last Approver). */
export function jobOrderLastApprovalStep(
  meta: Pick<JobOrderApprovalMeta, "skipNotedBy" | "skipApprovedBy"> | null | undefined,
): JobOrderApprovalStep | null {
  const steps = jobOrderApprovalStepsFor(meta);
  return steps.length > 0 ? steps[steps.length - 1]! : null;
}

/**
 * Seats that must be green-lit before Execution / Task Board unlock
 * (everything before the last Approver).
 */
export function jobOrderUnlockPrerequisiteSteps(
  meta: Pick<JobOrderApprovalMeta, "skipNotedBy" | "skipApprovedBy"> | null | undefined,
): JobOrderApprovalStep[] {
  const steps = jobOrderApprovalStepsFor(meta);
  if (steps.length <= 1) return [];
  return steps.slice(0, -1);
}

/**
 * Execution team + Task Board open after Noted By (when present) and Approved By
 * are complete — i.e. all seats before the last Approver. If only the last seat
 * remains, open immediately so Job Output can be uploaded for that Done gate.
 */
export function isJobOrderExecutionWorkspaceOpen(
  meta: JobOrderApprovalMeta | null | undefined,
): boolean {
  if (!meta) return false;
  if (meta.proceduralStep === "DONE") return true;
  const prior = jobOrderUnlockPrerequisiteSteps(meta);
  if (prior.length === 0) return true;
  return prior.every((step) => Boolean(meta.completed[step]));
}

export function isJobOrderCurrentStepLastApprover(
  meta: JobOrderApprovalMeta | null | undefined,
): boolean {
  if (!meta || meta.proceduralStep === "DONE") return false;
  return jobOrderLastApprovalStep(meta) === meta.proceduralStep;
}

/** True when Noted By and both Approved By seats are complete (green-lit). */
export function isJobOrderProcedureGreenLit(
  meta: JobOrderApprovalMeta | null | undefined,
): boolean {
  return meta?.proceduralStep === "DONE";
}

export function jobOrderAssigneeFieldForStep(
  step: JobOrderApprovalStep,
): keyof JobOrderApprovalAssignees {
  switch (step) {
    case "NOTED_BY":
      return "notedByAgentId";
    case "APPROVED_BY":
      return "approvedByAgentId";
    case "APPROVED_BY_2":
      return "approvedBy2AgentId";
  }
}

export function jobOrderAssigneeIdForStep(
  meta: JobOrderApprovalMeta,
  step: JobOrderApprovalStep,
): string | null {
  return meta[jobOrderAssigneeFieldForStep(step)];
}

/** Board assignee who should own the request for the current procedural step. Empty when DONE (clears icon). */
export function currentJobOrderStepBoardAssigneeId(meta: JobOrderApprovalMeta): string | null {
  if (meta.proceduralStep === "DONE") return null;
  return jobOrderAssigneeIdForStep(meta, meta.proceduralStep);
}

export function nextJobOrderApprovalStep(
  step: JobOrderProceduralStep,
  meta?: Pick<JobOrderApprovalMeta, "skipApprovedBy" | "skipNotedBy"> | null,
): JobOrderProceduralStep {
  if (step === "DONE") return "DONE";
  const chain = jobOrderApprovalStepsFor(meta);
  const idx = chain.indexOf(step as JobOrderApprovalStep);
  if (idx < 0) {
    return jobOrderApprovalStartStep(meta?.skipNotedBy === true, meta?.skipApprovedBy === true);
  }
  if (idx >= chain.length - 1) return "DONE";
  return chain[idx + 1]!;
}

/** Only the ticket’s Assignment Board assignee may complete the current procedural step. */
export function canCompleteJobOrderApprovalStep(opts: {
  meta: JobOrderApprovalMeta;
  actorAgentId: string | null;
  ticketAssignedAgentId: string | null;
  /** Required when completing the last Approver seat. */
  hasJobOutput?: boolean;
  /** Required when completing the last Approver seat (Job Done first). */
  hasJobDone?: boolean;
}): { ok: true } | { ok: false; error: string } {
  const { meta, actorAgentId, ticketAssignedAgentId } = opts;
  if (meta.proceduralStep === "DONE") {
    return { ok: false, error: "All job order approval steps are already complete." };
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
  if (isJobOrderCurrentStepLastApprover(meta)) {
    if (!(opts.hasJobDone === true || isJobOrderJobDone(meta))) {
      return {
        ok: false,
        error: "Mark Job Done before completing the final Approved By.",
      };
    }
    if (!opts.hasJobOutput) {
      return {
        ok: false,
        error: "Upload Job Output before completing the final approval.",
      };
    }
  }
  return { ok: true };
}

export function isJobOrderJobDone(meta: JobOrderApprovalMeta | null | undefined): boolean {
  return Boolean(meta?.jobDoneAt?.trim());
}

/** Stamp Job Done on meta (does not change ticket status). */
export function markJobOrderJobDone(meta: JobOrderApprovalMeta, atIso?: string): JobOrderApprovalMeta {
  if (isJobOrderJobDone(meta)) return meta;
  return { ...meta, jobDoneAt: atIso?.trim() || new Date().toISOString() };
}

/** Ready for customer confirmation: Job Done + full approval chain. */
export function isJobOrderReadyForConfirmation(
  meta: JobOrderApprovalMeta | null | undefined,
): boolean {
  return Boolean(meta && isJobOrderJobDone(meta) && meta.proceduralStep === "DONE");
}

export function completeJobOrderApprovalStep(meta: JobOrderApprovalMeta): JobOrderApprovalMeta {
  if (meta.proceduralStep === "DONE") return meta;
  const step = meta.proceduralStep;
  return {
    ...meta,
    proceduralStep: nextJobOrderApprovalStep(step, meta),
    completed: {
      ...meta.completed,
      [step]: new Date().toISOString(),
    },
  };
}

export function applyJobOrderApprovalAssignees(
  meta: JobOrderApprovalMeta,
  assignees: Partial<JobOrderApprovalAssignees>,
): JobOrderApprovalMeta {
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
    approvedBy2AgentId:
      assignees.approvedBy2AgentId !== undefined
        ? assignees.approvedBy2AgentId
        : meta.approvedBy2AgentId,
  };
}

/**
 * Stamp the request creator as Prepared By (intake only).
 * Does not advance the procedural chain — that starts at Noted By.
 */
export function stampJobOrderCreatorAsPreparedBy(
  meta: JobOrderApprovalMeta,
  creatorAgentId: string,
): JobOrderApprovalMeta {
  return applyJobOrderApprovalAssignees(meta, {
    preparedByAgentId: creatorAgentId,
  });
}

/** Green-lit and still waiting for an explicit execution assignee (board icon should be empty). */
export function isJobOrderAwaitingExecutionAssignee(
  meta: JobOrderApprovalMeta | null | undefined,
): boolean {
  return isJobOrderProcedureGreenLit(meta) && !meta?.executionAssignedAt;
}

export function clearJobOrderExecutionAssignment(
  meta: JobOrderApprovalMeta,
): JobOrderApprovalMeta {
  return { ...meta, executionAssignedAt: null };
}

export function markJobOrderExecutionAssigned(
  meta: JobOrderApprovalMeta,
  at: Date = new Date(),
): JobOrderApprovalMeta {
  return { ...meta, executionAssignedAt: at.toISOString() };
}

export function setJobOrderPendingExecutionAssignee(
  meta: JobOrderApprovalMeta,
  agentId: string | null,
): JobOrderApprovalMeta {
  const id = agentId?.trim() || null;
  return { ...meta, pendingExecutionAssigneeAgentId: id };
}

/**
 * When approvals finish, promote a pending execution assignee onto the board marker.
 * Does not set ticket.assignedAgentId — caller must connect the board assignee.
 */
export function promoteJobOrderPendingExecutionAssignee(
  meta: JobOrderApprovalMeta,
): { meta: JobOrderApprovalMeta; agentId: string | null } {
  const agentId = meta.pendingExecutionAssigneeAgentId?.trim() || null;
  if (!agentId) return { meta, agentId: null };
  return {
    agentId,
    meta: markJobOrderExecutionAssigned({
      ...meta,
      pendingExecutionAssigneeAgentId: null,
    }),
  };
}

export function applyJobOrderAssistanceTeam(
  meta: JobOrderApprovalMeta,
  team: Partial<JobOrderAssistanceTeam> | null,
): JobOrderApprovalMeta {
  if (team == null) {
    return { ...meta, assistanceTeam: null };
  }
  const current = meta.assistanceTeam ?? defaultJobOrderAssistanceTeam();
  const next = defaultJobOrderAssistanceTeam({
    ...current,
    ...team,
    workerAgentIds:
      team.workerAgentIds !== undefined ? team.workerAgentIds : current.workerAgentIds,
  });
  const assignee = next.assigneeAgentId;
  if (assignee) {
    next.workerAgentIds = next.workerAgentIds.filter((id) => id !== assignee);
  }
  return { ...meta, assistanceTeam: next };
}

export function isJobOrderAssistanceMember(
  agentId: string | null | undefined,
  meta: JobOrderApprovalMeta | null | undefined,
): boolean {
  const id = agentId?.trim();
  if (!id || !meta?.assistanceTeam) return false;
  if (meta.assistanceTeam.assigneeAgentId === id) return true;
  return meta.assistanceTeam.workerAgentIds.includes(id);
}

/** Execution / Assistance team (or Admin) marks work complete → then final Approved By → confirmation. */
export function canMarkJobOrderDone(opts: {
  meta: JobOrderApprovalMeta | null | undefined;
  ticketStatus: string;
  ticketAssignedAgentId: string | null;
  /** Staged assignee chosen before approvals finish. */
  pendingExecutionAssigneeAgentId?: string | null;
  actorAgentId: string | null;
  /** True when session matches the assignee via email / duplicate Agent rows. */
  actorIsExecutionAssignee?: boolean;
  isAdmin: boolean;
}): { ok: true } | { ok: false; error: string } {
  if (!isJobOrderExecutionWorkspaceOpen(opts.meta)) {
    return {
      ok: false,
      error: "Mark done unlocks after Noted By and Approved By are complete (when those seats apply).",
    };
  }
  if (isJobOrderJobDone(opts.meta)) {
    return {
      ok: false,
      error: isJobOrderReadyForConfirmation(opts.meta)
        ? "This Job Order is already marked done and awaiting customer confirmation."
        : "Job Done is already recorded. Waiting on the final Approved By.",
    };
  }
  if (
    opts.ticketStatus === "FOR_CONFIRMATION" ||
    opts.ticketStatus === "RESOLVED" ||
    opts.ticketStatus === "CLOSED"
  ) {
    return { ok: false, error: "This Job Order is already sent for customer confirmation." };
  }
  if (!["IN_PROGRESS", "OPEN", "PENDING_INFO", "ESCALATED"].includes(opts.ticketStatus)) {
    return { ok: false, error: "This Job Order cannot be marked done in its current status." };
  }
  if (opts.isAdmin) return { ok: true };
  if (opts.actorIsExecutionAssignee) return { ok: true };
  const executionId =
    opts.ticketAssignedAgentId?.trim() ||
    opts.pendingExecutionAssigneeAgentId?.trim() ||
    opts.meta?.pendingExecutionAssigneeAgentId?.trim() ||
    null;
  if (executionId && opts.actorAgentId === executionId) return { ok: true };
  if (opts.actorAgentId && isJobOrderWorkerAgent(opts.actorAgentId, opts.meta)) return { ok: true };
  if (opts.actorAgentId && isJobOrderAssistanceMember(opts.actorAgentId, opts.meta)) {
    return { ok: true };
  }
  return {
    ok: false,
    error:
      "Only the execution team, assistance team, or Admin can mark this Job Order done.",
  };
}

export function parseJobOrderWorkerAgentIds(meta: JobOrderApprovalMeta | null | undefined): string[] {
  if (!meta?.workerAgentIds?.length) return [];
  return meta.workerAgentIds.filter((id) => typeof id === "string" && Boolean(id.trim()));
}

/** Co-workers only — excludes the execution assignee when provided. */
export function applyJobOrderWorkerAgentIds(
  meta: JobOrderApprovalMeta,
  workerAgentIds: string[],
  executionAssigneeId?: string | null,
): JobOrderApprovalMeta {
  const assignee = executionAssigneeId?.trim() || null;
  const normalized = [
    ...new Set(workerAgentIds.map((id) => id.trim()).filter(Boolean)),
  ].filter((id) => id !== assignee);
  return { ...meta, workerAgentIds: normalized };
}

export function isJobOrderWorkerAgent(
  agentId: string | null | undefined,
  meta: JobOrderApprovalMeta | null | undefined,
): boolean {
  const id = agentId?.trim();
  if (!id) return false;
  return parseJobOrderWorkerAgentIds(meta).includes(id);
}
