import type { TicketStatus } from "@prisma/client/primary";

/**
 * Active request pipeline — shared by Request Board, Company Board totals,
 * and Insights “active requests” / queue mix (excludes CLOSED).
 */
export const ACTIVE_REQUEST_STATUSES: TicketStatus[] = [
  "OPEN",
  "IN_PROGRESS",
  "PENDING_INFO",
  "ESCALATED",
  "FOR_CONFIRMATION",
  "RESOLVED",
];

export const OPEN_PIPELINE_STATUSES: TicketStatus[] = ["OPEN", "IN_PROGRESS", "PENDING_INFO"];
