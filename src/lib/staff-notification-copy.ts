/** Notable ticket-activity summaries that belong in the staff notification feed. */
const NOTIFIABLE_SUMMARY_PATTERNS: RegExp[] = [
  /^Ticket logged$/i,
  /^Ticket created$/i,
  /^Status\s*→/i,
  /^Manual assignment$/i,
  /^Assigned/i,
  /^Reassigned/i,
  /^Transfer/i,
  /^First response/i,
  /approval/i,
  /confirmation/i,
  /remark/i,
  /\bpin\b/i,
  /^Feedback/i,
  /^Message/i,
  /escalat/i,
  /^Priority/i,
  /Job Done/i,
  /verification/i,
  /reminder/i,
  /^Closed/i,
  /reopen/i,
  /cancelled/i,
  /canceled/i,
];

export function isNotifiableTicketActivity(summary: string): boolean {
  const s = summary.trim();
  if (!s) return false;
  return NOTIFIABLE_SUMMARY_PATTERNS.some((p) => p.test(s));
}

function titleCaseWords(value: string): string {
  return value
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Human-first notification title from a ticket activity row.
 * Prefer the action; keep system IDs out of the headline.
 */
export function formatTicketActivityNotificationTitle(
  summary: string,
  detail: string | null | undefined,
): string {
  const s = summary.trim();
  const d = (detail ?? "").trim();

  const statusMatch = /^Status\s*→\s*(.+)$/i.exec(s);
  if (statusMatch) {
    return `Moved to ${titleCaseWords(statusMatch[1].trim())}`;
  }

  if (/^Ticket logged$/i.test(s) || /^Ticket created$/i.test(s)) {
    return "New request submitted";
  }

  if (/^Manual assignment$/i.test(s)) {
    if (d) return d.startsWith("Assigned") ? d : `Assigned · ${d}`;
    return "Request assigned";
  }

  if (/approval pending$/i.test(s) && d && d.length <= 100) {
    return `${s} · ${d}`;
  }

  if (/^Transfer requested$/i.test(s)) return "Transfer requested";
  if (/^Transfer approved$/i.test(s)) {
    return d ? `Transfer approved · ${d}` : "Transfer approved";
  }

  if (/remark/i.test(s) || /\bpin\b/i.test(s)) {
    return d ? `${s} · ${d}` : s;
  }

  return s;
}

export type StaffNotifCategory = "all" | "action" | "requests";

export function staffNotifCategoryForKind(
  kind: string,
): Exclude<StaffNotifCategory, "all"> {
  if (
    kind === "travel_approval" ||
    kind === "travel_confirmation" ||
    kind === "phase_delay" ||
    kind === "account_request" ||
    kind === "task_verification" ||
    kind === "task_verification_result"
  ) {
    return "action";
  }
  return "requests";
}

export function groupStaffNotifTimeBucket(iso: string, nowMs = Date.now()): "today" | "earlier" {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "earlier";
  const startOfToday = new Date(nowMs);
  startOfToday.setHours(0, 0, 0, 0);
  return t >= startOfToday.getTime() ? "today" : "earlier";
}
