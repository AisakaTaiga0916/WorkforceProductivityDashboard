export type TransferRequestPayload = {
  /** Agent who should receive the ticket when they accept. */
  recipientAgentId: string | null;
  recipientAgentName?: string | null;
  /** Assignee who initiated the transfer (restored on decline). */
  fromAgentId?: string | null;
  fromAgentName?: string | null;
  /** @deprecated Legacy admin-reviewer portal id (queue transfer). */
  recipientPortalAccountId: string | null;
  /** @deprecated Legacy SuperAdmin reviewer flag. */
  recipientSuperAdmin: boolean;
  targetTeamId?: string | null;
  targetTeamName?: string | null;
  reason?: string;
};

export function serializeTransferRequest(payload: TransferRequestPayload): string {
  return JSON.stringify({
    v: 2,
    ...payload,
  });
}

export function parseTransferRequestDetail(detail: string | null | undefined): TransferRequestPayload | null {
  if (!detail?.trim()) return null;
  try {
    const o = JSON.parse(detail) as Record<string, unknown>;
    if (o && typeof o === "object" && (o.v === 1 || o.v === 2)) {
      return {
        recipientAgentId: typeof o.recipientAgentId === "string" ? o.recipientAgentId : null,
        recipientAgentName: typeof o.recipientAgentName === "string" ? o.recipientAgentName : null,
        fromAgentId: typeof o.fromAgentId === "string" ? o.fromAgentId : null,
        fromAgentName: typeof o.fromAgentName === "string" ? o.fromAgentName : null,
        recipientPortalAccountId:
          typeof o.recipientPortalAccountId === "string" ? o.recipientPortalAccountId : null,
        recipientSuperAdmin: o.recipientSuperAdmin === true,
        targetTeamId: typeof o.targetTeamId === "string" ? o.targetTeamId : null,
        targetTeamName: typeof o.targetTeamName === "string" ? o.targetTeamName : null,
        reason: typeof o.reason === "string" ? o.reason : undefined,
      };
    }
  } catch {
    /* legacy plain-text detail */
  }
  return {
    recipientAgentId: null,
    recipientAgentName: null,
    fromAgentId: null,
    fromAgentName: null,
    recipientPortalAccountId: null,
    recipientSuperAdmin: false,
    targetTeamId: null,
    targetTeamName: null,
    reason: detail.trim(),
  };
}

/** Human-readable line for activity feeds (avoids dumping JSON payloads). */
export function formatTransferRequestDetail(detail: string | null | undefined): string | null {
  const parsed = parseTransferRequestDetail(detail);
  if (!parsed) return null;
  // Plain-text legacy: parseTransferRequestDetail always returns an object; detect JSON vs plain.
  if (detail?.trim().startsWith("{")) {
    const who =
      parsed.recipientAgentName?.trim() ||
      (parsed.recipientSuperAdmin ? "SuperAdmin" : null) ||
      "a colleague";
    const reason = parsed.reason?.trim();
    const base = reason ? `Transfer to ${who}: ${reason}` : `Transfer to ${who}`;
    const from = parsed.fromAgentName?.trim();
    return from ? `${base} (from ${from})` : base;
  }
  return parsed.reason?.trim() || detail?.trim() || null;
}

/** Whether this viewer may accept/reject the pending transfer. */
export function canViewerApproveTransfer(opts: {
  sessionRole: string;
  reviewerPortalAccountId: string | null;
  sessionAgentId?: string | null;
  parsed: TransferRequestPayload | null;
}): boolean {
  const { sessionRole, reviewerPortalAccountId, sessionAgentId, parsed } = opts;
  // Transfer pending lives in Assign Requests — admins may resolve from Ticket Controls too.
  if (
    sessionRole === "SuperAdmin" ||
    sessionRole === "HighAdmin" ||
    sessionRole === "Admin"
  ) {
    return true;
  }
  if (!parsed) return false;

  // Preferred recipient may still claim via Ticket Controls.
  if (parsed.recipientAgentId) {
    return Boolean(sessionAgentId && sessionAgentId === parsed.recipientAgentId);
  }

  // Legacy: company Admin / SuperAdmin reviews a queue move.
  if (parsed.recipientSuperAdmin) return false;
  if (parsed.recipientPortalAccountId && reviewerPortalAccountId) {
    return parsed.recipientPortalAccountId === reviewerPortalAccountId;
  }
  return false;
}
