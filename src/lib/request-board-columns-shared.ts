import type { TicketStatus } from "@prisma/client/primary";
import { formatTicketStatusLabel } from "@/lib/ticket-status-label";

export type RequestBoardColumnDto = {
  id: string;
  name: string;
  sortOrder: number;
  isDefault: boolean;
  mappedStatus: TicketStatus;
  /** Custom mapping display name; when set, shown instead of the enum label. */
  mappingLabel: string | null;
  acceptStatuses: TicketStatus[];
  allowDrop: boolean;
};

export const DEFAULT_REQUEST_BOARD_COLUMNS: Array<{
  name: string;
  sortOrder: number;
  mappedStatus: TicketStatus;
  acceptStatuses: TicketStatus[];
  allowDrop: boolean;
}> = [
  {
    name: "Open",
    sortOrder: 0,
    mappedStatus: "OPEN",
    acceptStatuses: ["OPEN"],
    allowDrop: false,
  },
  {
    name: "In Progress",
    sortOrder: 1,
    mappedStatus: "IN_PROGRESS",
    acceptStatuses: ["IN_PROGRESS", "ESCALATED", "PENDING_INFO"],
    allowDrop: true,
  },
  {
    name: "For Confirmation",
    sortOrder: 2,
    mappedStatus: "FOR_CONFIRMATION",
    acceptStatuses: ["FOR_CONFIRMATION", "RESOLVED"],
    allowDrop: true,
  },
];

const ALL_TICKET_STATUSES: TicketStatus[] = [
  "OPEN",
  "IN_PROGRESS",
  "PENDING_INFO",
  "ESCALATED",
  "FOR_CONFIRMATION",
  "RESOLVED",
  "CLOSED",
];

export function canManageRequestBoardColumns(role: string | null | undefined): boolean {
  // Personal board layouts — any staff role that uses the Request Board can edit their own.
  return (
    role === "SuperAdmin" ||
    role === "HighAdmin" ||
    role === "Admin" ||
    role === "Personnel" ||
    role === "Personnel-Guard"
  );
}

/** Stable owner key for per-user board layouts (email preferred). */
export function requestBoardOwnerKey(user: {
  id?: string | null;
  email?: string | null;
}): string {
  const email = user.email?.trim().toLowerCase();
  if (email) return `email:${email}`;
  const id = user.id?.trim();
  if (id) return `user:${id}`;
  throw new Error("Missing user identity for request board layout.");
}

export function parseAcceptStatuses(value: unknown): TicketStatus[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (s): s is TicketStatus => typeof s === "string" && ALL_TICKET_STATUSES.includes(s as TicketStatus),
  );
}

export function isTicketStatus(value: unknown): value is TicketStatus {
  return typeof value === "string" && ALL_TICKET_STATUSES.includes(value as TicketStatus);
}

/**
 * Resolve which board lane a ticket belongs to.
 * Prefer explicit requestBoardColumnId; otherwise match default boards by status.
 * Custom (non-default) boards only receive cards via explicit column assignment on drop.
 */
export function resolveTicketBoardColumnId(
  columns: RequestBoardColumnDto[],
  ticket: { status: TicketStatus; requestBoardColumnId?: string | null },
): string | null {
  if (ticket.requestBoardColumnId) {
    const direct = columns.find((c) => c.id === ticket.requestBoardColumnId);
    if (direct) return direct.id;
  }

  const defaults = columns.filter((c) => c.isDefault);
  const pool = defaults.length > 0 ? defaults : columns;

  const byAccept = pool.find((c) => c.acceptStatuses.includes(ticket.status));
  if (byAccept) return byAccept.id;

  const byMapped = pool.find((c) => c.mappedStatus === ticket.status);
  if (byMapped) return byMapped.id;

  return columns[0]?.id ?? null;
}

export function targetStatusForBoardColumn(
  column: RequestBoardColumnDto,
  currentStatus: TicketStatus,
): TicketStatus {
  // Preserve transfer-pending when dropping into the default In Progress lane.
  if (column.mappedStatus === "IN_PROGRESS" && currentStatus === "ESCALATED") {
    return "ESCALATED";
  }
  return column.mappedStatus;
}

/**
 * Stable key for the Request Board lane a ticket currently occupies.
 * Used to detect lane changes for the 24h OVERDUE timer.
 */
export function requestBoardLaneKey(
  ticket: { status: TicketStatus; requestBoardColumnId?: string | null },
): string {
  const columnId = ticket.requestBoardColumnId?.trim();
  if (columnId) return `col:${columnId}`;
  if (ticket.status === "OPEN") return "lane:open";
  if (
    ticket.status === "IN_PROGRESS" ||
    ticket.status === "ESCALATED" ||
    ticket.status === "PENDING_INFO"
  ) {
    return "lane:progress";
  }
  if (ticket.status === "FOR_CONFIRMATION" || ticket.status === "RESOLVED") {
    return "lane:confirm";
  }
  return `lane:${ticket.status}`;
}

/** Human-readable mapping line for a board header. */
export function formatBoardMappingLabel(
  column: Pick<RequestBoardColumnDto, "mappedStatus" | "mappingLabel">,
): string {
  const custom = column.mappingLabel?.trim();
  if (custom) return custom;
  return formatTicketStatusLabel(column.mappedStatus);
}
