/**
 * Task Board (KpiMaintenance) completion verification gate.
 * Assignees submit Done → PENDING_VERIFICATION; verifier approve → Done / reject → Current.
 */

export const COMPLETION_VERIFICATION = {
  PENDING: "PENDING_VERIFICATION",
  VERIFIED: "VERIFIED",
  REJECTED: "REJECTED",
} as const;

export type CompletionVerificationStatus =
  (typeof COMPLETION_VERIFICATION)[keyof typeof COMPLETION_VERIFICATION];

export type KpiBoardLaneStatus = "CURRENT" | "PENDING_VERIFICATION" | "DONE" | "DELAYED";

export type CompletionVerificationFields = {
  completionVerificationStatus?: string | null;
  lastFullCompletionAt?: Date | string | null;
  pendingVerificationAt?: Date | string | null;
  verifiedAt?: Date | string | null;
  verifiedByAgentId?: string | null;
  verificationRejectionComment?: string | null;
  verifierAgentId?: string | null;
};

/** Legacy rows with lastFullCompletionAt and no status are treated as already verified. */
export function isCompletionEffectivelyVerified(
  row: Pick<CompletionVerificationFields, "completionVerificationStatus" | "lastFullCompletionAt">,
): boolean {
  const status = row.completionVerificationStatus?.trim() || null;
  if (status === COMPLETION_VERIFICATION.VERIFIED) return true;
  if (status === COMPLETION_VERIFICATION.PENDING || status === COMPLETION_VERIFICATION.REJECTED) {
    return false;
  }
  return row.lastFullCompletionAt != null;
}

export function isPendingCompletionVerification(
  row: Pick<CompletionVerificationFields, "completionVerificationStatus">,
): boolean {
  return row.completionVerificationStatus === COMPLETION_VERIFICATION.PENDING;
}

export function isRejectedCompletionVerification(
  row: Pick<CompletionVerificationFields, "completionVerificationStatus">,
): boolean {
  return row.completionVerificationStatus === COMPLETION_VERIFICATION.REJECTED;
}

/**
 * DB patch when checklist completeness changes.
 * Newly complete → pending verification (do not set lastFullCompletionAt), unless
 * verification is disabled — then go straight to verified Done.
 * Incomplete → clear verification gate.
 */
export function checklistCompletionDbPatch(args: {
  prevComplete: boolean;
  nextComplete: boolean;
  /** When false, newly complete checklists skip the pending gate. Default true. */
  verificationEnabled?: boolean;
}): {
  lastFullCompletionAt?: Date | null;
  completionVerificationStatus?: string | null;
  pendingVerificationAt?: Date | null;
  verifiedAt?: Date | null;
  verifiedByAgentId?: string | null;
  verificationRejectionComment?: string | null;
} {
  const { prevComplete, nextComplete, verificationEnabled = true } = args;
  if (!prevComplete && nextComplete) {
    if (!verificationEnabled) {
      const now = new Date();
      return {
        completionVerificationStatus: COMPLETION_VERIFICATION.VERIFIED,
        pendingVerificationAt: null,
        lastFullCompletionAt: now,
        verifiedAt: now,
        verifiedByAgentId: null,
        verificationRejectionComment: null,
      };
    }
    return {
      completionVerificationStatus: COMPLETION_VERIFICATION.PENDING,
      pendingVerificationAt: new Date(),
      lastFullCompletionAt: null,
      verifiedAt: null,
      verifiedByAgentId: null,
      verificationRejectionComment: null,
    };
  }
  if (prevComplete && !nextComplete) {
    return {
      completionVerificationStatus: null,
      pendingVerificationAt: null,
      lastFullCompletionAt: null,
      verifiedAt: null,
      verifiedByAgentId: null,
      verificationRejectionComment: null,
    };
  }
  return {};
}

/** Approve pending verification → fully Done. */
export function approveCompletionDbPatch(verifiedByAgentId: string | null): {
  completionVerificationStatus: string;
  lastFullCompletionAt: Date;
  verifiedAt: Date;
  verifiedByAgentId: string | null;
  verificationRejectionComment: null;
} {
  const now = new Date();
  return {
    completionVerificationStatus: COMPLETION_VERIFICATION.VERIFIED,
    lastFullCompletionAt: now,
    verifiedAt: now,
    verifiedByAgentId,
    verificationRejectionComment: null,
  };
}

/** Reject pending verification → back to working (checklist stays; board shows Current). */
export function rejectCompletionDbPatch(comment: string): {
  completionVerificationStatus: string;
  lastFullCompletionAt: null;
  pendingVerificationAt: null;
  verifiedAt: null;
  verifiedByAgentId: null;
  verificationRejectionComment: string;
} {
  return {
    completionVerificationStatus: COMPLETION_VERIFICATION.REJECTED,
    lastFullCompletionAt: null,
    pendingVerificationAt: null,
    verifiedAt: null,
    verifiedByAgentId: null,
    verificationRejectionComment: comment.trim(),
  };
}

/** Assignee re-submits after rejection while checklist is still complete. */
export function resubmitCompletionDbPatch(): {
  completionVerificationStatus: string;
  pendingVerificationAt: Date;
  lastFullCompletionAt: null;
  verifiedAt: null;
  verifiedByAgentId: null;
  verificationRejectionComment: null;
} {
  return {
    completionVerificationStatus: COMPLETION_VERIFICATION.PENDING,
    pendingVerificationAt: new Date(),
    lastFullCompletionAt: null,
    verifiedAt: null,
    verifiedByAgentId: null,
    verificationRejectionComment: null,
  };
}

/**
 * Map checklist progress + verification into a board lane.
 * Call after delay checks would have returned DONE for a fully complete checklist.
 */
export function boardStatusAfterChecklistComplete(
  row: Pick<CompletionVerificationFields, "completionVerificationStatus" | "lastFullCompletionAt">,
  opts?: { verificationEnabled?: boolean },
): Exclude<KpiBoardLaneStatus, "DELAYED"> {
  if (opts?.verificationEnabled === false) return "DONE";
  const status = row.completionVerificationStatus?.trim() || null;
  if (status === COMPLETION_VERIFICATION.PENDING) return "PENDING_VERIFICATION";
  if (status === COMPLETION_VERIFICATION.REJECTED) return "CURRENT";
  if (isCompletionEffectivelyVerified(row)) return "DONE";
  // Complete but never gated (shouldn't happen for new writes) → treat as pending.
  return "PENDING_VERIFICATION";
}

export function laneStatusLabel(status: KpiBoardLaneStatus): string {
  switch (status) {
    case "PENDING_VERIFICATION":
      return "For verification";
    case "DONE":
      return "Done";
    case "DELAYED":
      return "Delayed";
    default:
      return "Current";
  }
}

/** Verification fields stored on each checklist / sub-task item (JSON). */
export type SubKpiVerificationFields = {
  done?: boolean;
  completionVerificationStatus?: string | null;
  pendingVerificationAt?: string | null;
  verifiedAt?: string | null;
  verifiedByAgentId?: string | null;
  verifiedByAgentName?: string | null;
  verificationRejectionComment?: string | null;
};

/**
 * Sub-task is waiting on department-head approval.
 * Legacy `done` with no status counts as pending unless the parent card is already verified.
 * When platform verification is disabled, never treat items as pending.
 */
export function isSubKpiPendingVerification(
  item: SubKpiVerificationFields,
  opts?: { parentCardEffectivelyVerified?: boolean; verificationEnabled?: boolean },
): boolean {
  if (opts?.verificationEnabled === false) return false;
  if (!item.done) return false;
  const status = item.completionVerificationStatus?.trim() || null;
  if (status === COMPLETION_VERIFICATION.PENDING) return true;
  if (status === COMPLETION_VERIFICATION.VERIFIED || status === COMPLETION_VERIFICATION.REJECTED) {
    return false;
  }
  return !opts?.parentCardEffectivelyVerified;
}

/**
 * Sub-task counts as finished for progress / Done only after head verification (or legacy closed card).
 * When platform verification is disabled, any done item counts as finished.
 */
export function isSubKpiEffectivelyVerified(
  item: SubKpiVerificationFields,
  opts?: { parentCardEffectivelyVerified?: boolean; verificationEnabled?: boolean },
): boolean {
  if (!item.done) return false;
  if (opts?.verificationEnabled === false) return true;
  const status = item.completionVerificationStatus?.trim() || null;
  if (status === COMPLETION_VERIFICATION.VERIFIED) return true;
  if (status === COMPLETION_VERIFICATION.PENDING || status === COMPLETION_VERIFICATION.REJECTED) {
    return false;
  }
  return Boolean(opts?.parentCardEffectivelyVerified);
}

export function isSubKpiVerificationRejected(item: SubKpiVerificationFields): boolean {
  return item.completionVerificationStatus === COMPLETION_VERIFICATION.REJECTED;
}

/** Assignee marks a sub-task done → pending verification (not Finished yet). */
export function applySubKpiSubmitForVerification<T extends SubKpiVerificationFields>(
  item: T,
  opts?: { verificationEnabled?: boolean; verifier?: { id: string | null; name: string | null } },
): T & {
  done: true;
  completionVerificationStatus: string;
  pendingVerificationAt: string | null;
  verifiedAt: string | null;
  verifiedByAgentId: string | null;
  verifiedByAgentName: string | null;
  verificationRejectionComment: null;
} {
  const now = new Date().toISOString();
  if (opts?.verificationEnabled === false) {
    return {
      ...item,
      done: true,
      completionVerificationStatus: COMPLETION_VERIFICATION.VERIFIED,
      pendingVerificationAt: null,
      verifiedAt: now,
      verifiedByAgentId: opts.verifier?.id ?? null,
      verifiedByAgentName: opts.verifier?.name ?? null,
      verificationRejectionComment: null,
    };
  }
  return {
    ...item,
    done: true,
    completionVerificationStatus: COMPLETION_VERIFICATION.PENDING,
    pendingVerificationAt: now,
    verifiedAt: null,
    verifiedByAgentId: null,
    verifiedByAgentName: null,
    verificationRejectionComment: null,
  };
}

export function applySubKpiClearVerification<T extends SubKpiVerificationFields>(item: T): T {
  const next: T = {
    ...item,
    done: false,
    completionVerificationStatus: null,
    pendingVerificationAt: null,
    verifiedAt: null,
    verifiedByAgentId: null,
    verifiedByAgentName: null,
    verificationRejectionComment: null,
  };
  return next;
}

export function applySubKpiApproveVerification<T extends SubKpiVerificationFields>(
  item: T,
  verifier: { id: string | null; name: string | null },
): T {
  const now = new Date().toISOString();
  return {
    ...item,
    done: true,
    completionVerificationStatus: COMPLETION_VERIFICATION.VERIFIED,
    verifiedAt: now,
    verifiedByAgentId: verifier.id,
    verifiedByAgentName: verifier.name,
    verificationRejectionComment: null,
  };
}

export function applySubKpiRejectVerification<T extends SubKpiVerificationFields>(
  item: T,
  comment: string,
): T {
  return {
    ...item,
    done: true,
    completionVerificationStatus: COMPLETION_VERIFICATION.REJECTED,
    pendingVerificationAt: null,
    verifiedAt: null,
    verifiedByAgentId: null,
    verifiedByAgentName: null,
    verificationRejectionComment: comment.trim(),
  };
}

export function applySubKpiResubmitVerification<T extends SubKpiVerificationFields>(item: T): T {
  return applySubKpiSubmitForVerification({ ...item, done: true });
}

/** Backfill: done items with no status become PENDING when the parent card is not closed. */
export function coerceSubKpiItemVerificationStatus<T extends SubKpiVerificationFields>(
  item: T,
  opts?: { parentCardEffectivelyVerified?: boolean },
): { item: T; changed: boolean } {
  if (!item.done) return { item, changed: false };
  const status = item.completionVerificationStatus?.trim() || null;
  if (status) return { item, changed: false };
  if (opts?.parentCardEffectivelyVerified) {
    return {
      item: {
        ...item,
        completionVerificationStatus: COMPLETION_VERIFICATION.VERIFIED,
      },
      changed: true,
    };
  }
  return {
    item: applySubKpiSubmitForVerification(item),
    changed: true,
  };
}

/** Card-level patch while any sub-task awaits verification (checklist may still be incomplete). */
export function cardPendingFromSubKpiDbPatch(): {
  completionVerificationStatus: string;
  pendingVerificationAt: Date;
  lastFullCompletionAt: null;
  verifiedAt: null;
  verifiedByAgentId: null;
  verificationRejectionComment: null;
} {
  return {
    completionVerificationStatus: COMPLETION_VERIFICATION.PENDING,
    pendingVerificationAt: new Date(),
    lastFullCompletionAt: null,
    verifiedAt: null,
    verifiedByAgentId: null,
    verificationRejectionComment: null,
  };
}

/** Clear card gate when no sub-tasks (and card) await verification and checklist is incomplete. */
export function clearCardVerificationDbPatch(): {
  completionVerificationStatus: null;
  pendingVerificationAt: null;
  lastFullCompletionAt: null;
  verifiedAt: null;
  verifiedByAgentId: null;
  verificationRejectionComment: null;
} {
  return {
    completionVerificationStatus: null,
    pendingVerificationAt: null,
    lastFullCompletionAt: null,
    verifiedAt: null,
    verifiedByAgentId: null,
    verificationRejectionComment: null,
  };
}
