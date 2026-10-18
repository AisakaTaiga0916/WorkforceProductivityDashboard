/** Job Order → Admin “Request Task Project” (activity-log pending state). */

export const JO_PROJECT_REQUESTED_SUMMARY = "Task project requested";
export const JO_PROJECT_REQUEST_FULFILLED_SUMMARY = "Task project request fulfilled";
export const JO_PROJECT_REQUEST_CANCELLED_SUMMARY = "Task project request cancelled";

export type JobOrderProjectRequestPayload = {
  /** Company Admin who should create the Task Board project. */
  targetAdminAgentId: string;
  targetAdminAgentName?: string | null;
  requestedByAgentId?: string | null;
  requestedByAgentName?: string | null;
  note?: string;
};

export function serializeJobOrderProjectRequest(payload: JobOrderProjectRequestPayload): string {
  return JSON.stringify({
    v: 1,
    ...payload,
  });
}

export function parseJobOrderProjectRequestDetail(
  detail: string | null | undefined,
): JobOrderProjectRequestPayload | null {
  if (!detail?.trim()) return null;
  try {
    const o = JSON.parse(detail) as Record<string, unknown>;
    if (!o || typeof o !== "object" || o.v !== 1) return null;
    const targetAdminAgentId =
      typeof o.targetAdminAgentId === "string" ? o.targetAdminAgentId.trim() : "";
    if (!targetAdminAgentId) return null;
    return {
      targetAdminAgentId,
      targetAdminAgentName:
        typeof o.targetAdminAgentName === "string" ? o.targetAdminAgentName : null,
      requestedByAgentId:
        typeof o.requestedByAgentId === "string" ? o.requestedByAgentId : null,
      requestedByAgentName:
        typeof o.requestedByAgentName === "string" ? o.requestedByAgentName : null,
      note: typeof o.note === "string" ? o.note : undefined,
    };
  } catch {
    return null;
  }
}

/** Human-readable line for activity feeds (avoids dumping JSON payloads). */
export function formatJobOrderProjectRequestDetail(
  detail: string | null | undefined,
): string | null {
  const parsed = parseJobOrderProjectRequestDetail(detail);
  if (!parsed) return null;
  const admin = parsed.targetAdminAgentName?.trim() || "company Admin";
  const by = parsed.requestedByAgentName?.trim();
  const base = by ? `Requested by ${by} → ${admin}` : `Requested from ${admin}`;
  const note = parsed.note?.trim();
  return note ? `${base}. ${note}` : base;
}

export type JobOrderProjectRequestPending = {
  pending: boolean;
  payload: JobOrderProjectRequestPayload | null;
};

/** Derive pending request from chronological activity rows (oldest → newest). */
export function jobOrderProjectRequestPendingFromActivities(
  activities: Array<{ summary: string; detail: string | null }>,
): JobOrderProjectRequestPending {
  let pending = false;
  let payload: JobOrderProjectRequestPayload | null = null;
  for (const a of activities) {
    if (a.summary === JO_PROJECT_REQUESTED_SUMMARY) {
      pending = true;
      payload = parseJobOrderProjectRequestDetail(a.detail);
    }
    if (
      a.summary === JO_PROJECT_REQUEST_FULFILLED_SUMMARY ||
      a.summary === JO_PROJECT_REQUEST_CANCELLED_SUMMARY
    ) {
      pending = false;
      payload = null;
    }
  }
  return { pending, payload };
}

/** Whether this viewer is the Admin asked to create the project (or SuperAdmin). */
export function canViewerFulfillJobOrderProjectRequest(opts: {
  sessionRole: string;
  sessionAgentId?: string | null;
  payload: JobOrderProjectRequestPayload | null;
}): boolean {
  const { sessionRole, sessionAgentId, payload } = opts;
  if (sessionRole === "SuperAdmin") return true;
  if (!payload?.targetAdminAgentId) return sessionRole === "Admin";
  return Boolean(sessionAgentId && sessionAgentId === payload.targetAdminAgentId);
}
