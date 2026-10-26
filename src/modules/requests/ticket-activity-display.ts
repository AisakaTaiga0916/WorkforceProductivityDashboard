/** Format ticket activity `detail` for UI (hide machine JSON payloads). */

import { formatTransferRequestDetail } from "@/modules/requests/ticket-transfer-request";

/** Retired Job Order → Task Project request flow; rows remain in activity history. */
const LEGACY_JO_PROJECT_REQUESTED_SUMMARY = "Task project requested";

function formatLegacyJobOrderProjectRequestDetail(detail: string): string {
  try {
    const o = JSON.parse(detail) as Record<string, unknown>;
    const admin =
      typeof o.targetAdminAgentName === "string" && o.targetAdminAgentName.trim()
        ? o.targetAdminAgentName.trim()
        : "company Admin";
    const by =
      typeof o.requestedByAgentName === "string" ? o.requestedByAgentName.trim() : "";
    const base = by ? `Requested by ${by} → ${admin}` : `Requested from ${admin}`;
    const note = typeof o.note === "string" ? o.note.trim() : "";
    return note ? `${base}. ${note}` : base;
  } catch {
    return "Task Project requested from company Admin.";
  }
}

export function formatTicketActivityDetail(
  summary: string,
  detail: string | null | undefined,
): string | null {
  if (!detail?.trim()) return null;

  if (summary === LEGACY_JO_PROJECT_REQUESTED_SUMMARY) {
    return formatLegacyJobOrderProjectRequestDetail(detail);
  }

  if (summary === "Transfer requested") {
    return formatTransferRequestDetail(detail) ?? detail.trim();
  }

  const trimmed = detail.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const o = JSON.parse(trimmed) as Record<string, unknown>;
      if (o && typeof o === "object") {
        if (typeof o.reason === "string" && o.reason.trim()) return o.reason.trim();
        if (typeof o.note === "string" && o.note.trim()) return o.note.trim();
        if (typeof o.message === "string" && o.message.trim()) return o.message.trim();
      }
    } catch {
      /* keep raw */
    }
  }

  return trimmed;
}
