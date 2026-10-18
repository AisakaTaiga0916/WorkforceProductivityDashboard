import type { TicketStatus } from "@prisma/client/primary";

/** User-facing ticket status labels (ESCALATED = transfer pending approval). */
export function formatTicketStatusLabel(status: TicketStatus | string): string {
  const s = String(status);
  if (s === "ESCALATED") return "Transfer pending";
  if (s === "FOR_CONFIRMATION") return "For confirmation";
  if (s === "IN_PROGRESS" || s === "PENDING_INFO") return "In progress";
  if (s === "OPEN") return "Open";
  if (s === "CLOSED") return "Closed";
  if (s === "RESOLVED") return "Resolved";
  return s.replaceAll("_", " ");
}

/** Compact status labels for the company board (narrow columns, all visible at once). */
export function formatCompanyBoardStatusLabel(status: TicketStatus | string): string {
  const s = String(status);
  if (s === "ESCALATED") return "Transfer";
  if (s === "FOR_CONFIRMATION") return "Confirming";
  if (s === "IN_PROGRESS") return "In progress";
  if (s === "PENDING_INFO") return "In progress";
  if (s === "OPEN") return "Open";
  if (s === "CLOSED") return "Closed";
  if (s === "RESOLVED") return "Resolved";
  return formatTicketStatusLabel(status);
}
