/** Format ticket activity `detail` for UI (hide machine JSON payloads). */

import {
  formatJobOrderProjectRequestDetail,
  JO_PROJECT_REQUESTED_SUMMARY,
} from "@/modules/requests/job-order-project-request";
import { formatTransferRequestDetail } from "@/modules/requests/ticket-transfer-request";

export function formatTicketActivityDetail(
  summary: string,
  detail: string | null | undefined,
): string | null {
  if (!detail?.trim()) return null;

  if (summary === JO_PROJECT_REQUESTED_SUMMARY) {
    return formatJobOrderProjectRequestDetail(detail) ?? "Task Project requested from company Admin.";
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
