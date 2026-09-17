import type { Ticket, TicketStatus } from "@prisma/client/primary";
import { requestBoardLaneKey } from "@/lib/request-board-columns-shared";
import { DEFAULT_REQUEST_TYPE, parseRequestTypeId, type RequestTypeId } from "@/lib/request-types";

/** OVERDUE threshold shared by all request-type clocks. */
export const BOARD_LANE_OVERDUE_MS = 24 * 60 * 60 * 1000;

/** Hours before the 24h overdue mark when a ticket is considered AT_RISK. */
export const BOARD_LANE_AT_RISK_HOURS = 4;
export const BOARD_LANE_AT_RISK_MS = BOARD_LANE_AT_RISK_HOURS * 60 * 60 * 1000;

export function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

export type SlaState = "ON_TRACK" | "AT_RISK" | "BREACHED";

export type OverdueTicketInput = {
  status: TicketStatus;
  requestType?: string | null;
  boardLaneEnteredAt?: Date | string | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
  /** Set when the ticket entered FOR_CONFIRMATION (often `resolvedAt`). */
  resolvedAt?: Date | string | null;
  /** Latest audit-trail (`TicketActivity`) timestamp — Job Order clock. */
  lastActivityAt?: Date | string | null;
  /** Explicit FOR_CONFIRMATION enter time when known (activity / lane stamp). */
  forConfirmationAt?: Date | string | null;
};

/** @deprecated Prefer OverdueTicketInput — kept for call-site compatibility. */
export type BoardLaneTicket = OverdueTicketInput;

function toMs(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function requestTypeOf(ticket: OverdueTicketInput): RequestTypeId {
  return parseRequestTypeId(ticket.requestType ?? DEFAULT_REQUEST_TYPE);
}

/** Instant the ticket entered its current Request Board lane. */
export function boardLaneEnteredAtMs(ticket: OverdueTicketInput): number {
  return (
    toMs(ticket.boardLaneEnteredAt) ??
    toMs(ticket.updatedAt) ??
    toMs(ticket.createdAt) ??
    Date.now()
  );
}

export function isUnresolvedRequestStatus(status: TicketStatus): boolean {
  return status !== "FOR_CONFIRMATION" && status !== "RESOLVED" && status !== "CLOSED";
}

/** Still on the Request Board (any column except fully closed). */
export function isOnRequestBoard(status: TicketStatus): boolean {
  return status !== "CLOSED";
}

const CONFIRMATION_OVERDUE_TYPES = new Set<RequestTypeId>([
  "REQUEST_FOR_PAYMENT",
  "FUND_TRANSFER_REQUEST",
  "ITEM_REQUISITION_SLIP",
  "AUTHORITY_TO_CONDUCT_ACTIVITY",
]);

/**
 * Start of the 24h overdue clock for this ticket, or `null` when the tag
 * does not apply yet (e.g. RFP still in progress before FOR_CONFIRMATION).
 *
 * Rules:
 * - ISSUE/CONCERN: last Request Board update (`boardLaneEnteredAt`)
 * - JOB_ORDER: last audit-trail activity
 * - RFP / FTR / R.S. / A.C.A.: only after FOR_CONFIRMATION
 */
export function overdueClockStartedAtMs(ticket: OverdueTicketInput): number | null {
  if (!isOnRequestBoard(ticket.status)) return null;

  const type = requestTypeOf(ticket);

  if (type === "JOB_ORDER") {
    return (
      toMs(ticket.lastActivityAt) ??
      toMs(ticket.updatedAt) ??
      toMs(ticket.createdAt)
    );
  }

  if (CONFIRMATION_OVERDUE_TYPES.has(type)) {
    if (ticket.status !== "FOR_CONFIRMATION") return null;
    return (
      toMs(ticket.forConfirmationAt) ??
      toMs(ticket.resolvedAt) ??
      toMs(ticket.boardLaneEnteredAt) ??
      toMs(ticket.updatedAt) ??
      toMs(ticket.createdAt)
    );
  }

  // ISSUE_CONCERN_TICKET (and unknown): 24h without board updates.
  return boardLaneEnteredAtMs(ticket);
}

/**
 * OVERDUE tag: request-type-specific 24h clock (see `overdueClockStartedAtMs`).
 */
export function isBoardLaneOverdue(ticket: OverdueTicketInput, nowMs = Date.now()): boolean {
  const started = overdueClockStartedAtMs(ticket);
  if (started == null) return false;
  return nowMs - started > BOARD_LANE_OVERDUE_MS;
}

export function getTicketSlaState(ticket: Ticket | OverdueTicketInput): SlaState {
  const now = Date.now();
  if (!isOnRequestBoard(ticket.status)) return "ON_TRACK";

  const started = overdueClockStartedAtMs(ticket);
  if (started == null) return "ON_TRACK";

  const dwellMs = now - started;
  if (dwellMs > BOARD_LANE_OVERDUE_MS) return "BREACHED";
  if (dwellMs > BOARD_LANE_OVERDUE_MS - BOARD_LANE_AT_RISK_MS) return "AT_RISK";
  return "ON_TRACK";
}

/** Whether a status / board-column change moves the ticket to a different lane. */
export function didRequestBoardLaneChange(
  before: { status: TicketStatus; requestBoardColumnId?: string | null },
  after: { status: TicketStatus; requestBoardColumnId?: string | null },
): boolean {
  return requestBoardLaneKey(before) !== requestBoardLaneKey(after);
}
