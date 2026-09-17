import type { TicketStatus } from "@prisma/client/primary";
import { prisma } from "@/lib/prisma";
import {
  DEFAULT_REQUEST_BOARD_COLUMNS,
  parseAcceptStatuses,
  type RequestBoardColumnDto,
} from "@/lib/request-board-columns-shared";

export {
  DEFAULT_REQUEST_BOARD_COLUMNS,
  canManageRequestBoardColumns,
  formatBoardMappingLabel,
  isTicketStatus,
  parseAcceptStatuses,
  requestBoardOwnerKey,
  resolveTicketBoardColumnId,
  targetStatusForBoardColumn,
  type RequestBoardColumnDto,
} from "@/lib/request-board-columns-shared";

type ColumnRow = {
  id: string;
  name: string;
  sort_order: number;
  is_default: boolean;
  mapped_status: TicketStatus;
  mapping_label: string | null;
  accept_statuses: unknown;
  allow_drop: boolean;
};

function normalizeColumn(raw: Partial<RequestBoardColumnDto> & { id?: string }): RequestBoardColumnDto | null {
  if (!raw.id || typeof raw.id !== "string") return null;
  if (!raw.name || typeof raw.name !== "string") return null;
  const mappedStatus = raw.mappedStatus;
  if (typeof mappedStatus !== "string") return null;
  const isDefault = Boolean(raw.isDefault);
  const accept = parseAcceptStatuses(raw.acceptStatuses);
  return {
    id: raw.id,
    name: raw.name.trim() || "Board",
    sortOrder: Number(raw.sortOrder) || 0,
    isDefault,
    mappedStatus: mappedStatus as TicketStatus,
    mappingLabel: raw.mappingLabel?.trim() ? raw.mappingLabel.trim() : null,
    acceptStatuses: isDefault
      ? accept.length > 0
        ? accept
        : [mappedStatus as TicketStatus]
      : accept,
    allowDrop: raw.allowDrop !== false,
  };
}

function normalizeColumns(value: unknown): RequestBoardColumnDto[] {
  if (!Array.isArray(value)) return [];
  const out: RequestBoardColumnDto[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object") continue;
    const normalized = normalizeColumn(row as Partial<RequestBoardColumnDto>);
    if (normalized) out.push(normalized);
  }
  return out
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((col, index) => ({ ...col, sortOrder: index }));
}

function defaultSeedColumns(): RequestBoardColumnDto[] {
  return DEFAULT_REQUEST_BOARD_COLUMNS.map((col, index) => {
    const id =
      col.mappedStatus === "OPEN"
        ? "rbc_open"
        : col.mappedStatus === "IN_PROGRESS"
          ? "rbc_progress"
          : "rbc_feedback";
    return {
      id,
      name: col.name,
      sortOrder: index,
      isDefault: true,
      mappedStatus: col.mappedStatus,
      mappingLabel: null,
      acceptStatuses: [...col.acceptStatuses],
      allowDrop: col.allowDrop,
    };
  });
}

function toDtoFromGlobalRow(row: ColumnRow): RequestBoardColumnDto {
  const accept = parseAcceptStatuses(row.accept_statuses);
  const isDefault = Boolean(row.is_default);
  return {
    id: row.id,
    name: row.name,
    sortOrder: Number(row.sort_order),
    isDefault,
    mappedStatus: row.mapped_status,
    mappingLabel: row.mapping_label?.trim() ? row.mapping_label.trim() : null,
    acceptStatuses: isDefault
      ? accept.length > 0
        ? accept
        : [row.mapped_status]
      : accept,
    allowDrop: Boolean(row.allow_drop),
  };
}

/** One-time starting point: copy current global columns if present, else code defaults. */
async function seedColumnsFromGlobalOrDefaults(): Promise<RequestBoardColumnDto[]> {
  try {
    const rows = await prisma.$queryRawUnsafe<ColumnRow[]>(
      `SELECT id, name, sort_order, is_default, mapped_status, mapping_label, accept_statuses, allow_drop
       FROM request_board_columns
       ORDER BY sort_order ASC`,
    );
    if (rows.length > 0) return rows.map(toDtoFromGlobalRow);
  } catch {
    // Global table may be missing on fresh envs — fall through to defaults.
  }
  return defaultSeedColumns();
}

async function readOwnerLayout(ownerKey: string): Promise<RequestBoardColumnDto[] | null> {
  const rows = await prisma.$queryRawUnsafe<Array<{ columns: unknown }>>(
    `SELECT columns FROM request_board_user_layouts WHERE owner_key = $1 LIMIT 1`,
    ownerKey,
  );
  if (!rows[0]) return null;
  const cols = normalizeColumns(rows[0].columns);
  return cols.length > 0 ? cols : null;
}

async function writeOwnerLayout(
  ownerKey: string,
  columns: RequestBoardColumnDto[],
): Promise<RequestBoardColumnDto[]> {
  const normalized = columns
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((col, index) => ({ ...col, sortOrder: index }));
  const now = new Date().toISOString();
  const id = `rbul_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  await prisma.$executeRawUnsafe(
    `INSERT INTO request_board_user_layouts (id, owner_key, columns, created_at, updated_at)
     VALUES ($1, $2, $3::jsonb, $4::timestamptz, $4::timestamptz)
     ON CONFLICT (owner_key) DO UPDATE
       SET columns = EXCLUDED.columns,
           updated_at = EXCLUDED.updated_at`,
    id,
    ownerKey,
    JSON.stringify(normalized),
    now,
  );
  return normalized;
}

export async function listRequestBoardColumns(
  ownerKey: string,
): Promise<RequestBoardColumnDto[]> {
  const existing = await readOwnerLayout(ownerKey);
  if (existing) return existing;
  const seeded = await seedColumnsFromGlobalOrDefaults();
  return writeOwnerLayout(ownerKey, seeded);
}

export async function getRequestBoardColumnById(
  ownerKey: string,
  id: string,
): Promise<RequestBoardColumnDto | null> {
  const columns = await listRequestBoardColumns(ownerKey);
  return columns.find((c) => c.id === id) ?? null;
}

export async function createRequestBoardColumn(
  ownerKey: string,
  input: {
    name: string;
    mappedStatus: TicketStatus;
    mappingLabel?: string | null;
    allowDrop?: boolean;
  },
): Promise<RequestBoardColumnDto> {
  const columns = await listRequestBoardColumns(ownerKey);
  const sortOrder = columns.length;
  const allowDrop = input.allowDrop !== false;
  const mappingLabel = input.mappingLabel?.trim() || null;
  const id = `rbc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const created: RequestBoardColumnDto = {
    id,
    name: input.name,
    sortOrder,
    isDefault: false,
    mappedStatus: input.mappedStatus,
    mappingLabel,
    acceptStatuses: [],
    allowDrop,
  };
  await writeOwnerLayout(ownerKey, [...columns, created]);
  return created;
}

export async function updateRequestBoardColumn(
  ownerKey: string,
  id: string,
  data: {
    name?: string;
    mappedStatus?: TicketStatus;
    mappingLabel?: string | null;
    allowDrop?: boolean;
    acceptStatuses?: TicketStatus[];
  },
): Promise<RequestBoardColumnDto> {
  const columns = await listRequestBoardColumns(ownerKey);
  const index = columns.findIndex((c) => c.id === id);
  if (index < 0) throw new Error("Board not found.");
  const current = columns[index]!;

  const name = data.name ?? current.name;
  const mappedStatus = data.mappedStatus ?? current.mappedStatus;
  const mappingLabel =
    data.mappingLabel !== undefined
      ? data.mappingLabel?.trim() || null
      : current.mappingLabel;
  const allowDrop = data.allowDrop ?? current.allowDrop;
  const acceptStatuses =
    data.acceptStatuses ??
    (current.isDefault
      ? current.acceptStatuses
      : data.mappedStatus
        ? []
        : current.acceptStatuses);

  const updated: RequestBoardColumnDto = {
    ...current,
    name,
    mappedStatus,
    mappingLabel,
    allowDrop,
    acceptStatuses: current.isDefault
      ? acceptStatuses.length > 0
        ? acceptStatuses
        : [mappedStatus]
      : acceptStatuses,
  };
  const next = columns.slice();
  next[index] = updated;
  await writeOwnerLayout(ownerKey, next);
  return updated;
}

export async function reorderRequestBoardColumns(
  ownerKey: string,
  orderedIds: string[],
): Promise<RequestBoardColumnDto[]> {
  const columns = await listRequestBoardColumns(ownerKey);
  const byId = new Map(columns.map((c) => [c.id, c]));
  const next = orderedIds
    .map((id, index) => {
      const col = byId.get(id);
      return col ? { ...col, sortOrder: index } : null;
    })
    .filter((c): c is RequestBoardColumnDto => c != null);
  if (next.length !== columns.length) {
    throw new Error("orderedIds must include every board exactly once.");
  }
  return writeOwnerLayout(ownerKey, next);
}

export async function deleteRequestBoardColumn(
  ownerKey: string,
  id: string,
): Promise<RequestBoardColumnDto[]> {
  const columns = await listRequestBoardColumns(ownerKey);
  const column = columns.find((c) => c.id === id);
  if (!column) throw new Error("Board not found.");
  if (column.isDefault) throw new Error("Default boards cannot be removed.");

  await prisma.$executeRawUnsafe(
    `UPDATE tickets SET request_board_column_id = NULL WHERE request_board_column_id = $1`,
    id,
  );

  const next = columns
    .filter((c) => c.id !== id)
    .map((c, index) => ({ ...c, sortOrder: index }));
  return writeOwnerLayout(ownerKey, next);
}

/** Tickets explicitly assigned to this board lane (not status-fallback matches). */
export async function countTicketsAssignedToBoardColumn(columnId: string): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT COUNT(*)::bigint AS count FROM tickets WHERE request_board_column_id = $1`,
    columnId,
  );
  return Number(rows[0]?.count ?? 0);
}

export async function countTicketsInBoardColumn(
  column: RequestBoardColumnDto,
  whereBase?: { teamId?: string | null },
): Promise<number> {
  if (!column.isDefault) {
    return countTicketsAssignedToBoardColumn(column.id);
  }

  const statusFilter = column.acceptStatuses.length > 0 ? column.acceptStatuses : [column.mappedStatus];
  const statusSql = statusFilter.map((s) => `'${s}'`).join(", ");
  const teamId = whereBase?.teamId ?? null;

  if (teamId) {
    const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*)::bigint AS count
       FROM tickets
       WHERE team_id = $1
         AND (
           request_board_column_id = $2
           OR (
             request_board_column_id IS NULL
             AND status IN (${statusSql})
           )
         )`,
      teamId,
      column.id,
    );
    return Number(rows[0]?.count ?? 0);
  }

  const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT COUNT(*)::bigint AS count
     FROM tickets
     WHERE request_board_column_id = $1
        OR (
          request_board_column_id IS NULL
          AND status IN (${statusSql})
        )`,
    column.id,
  );
  return Number(rows[0]?.count ?? 0);
}

/** Set or clear a ticket's board lane without requiring the Prisma model delegate. */
export async function setTicketRequestBoardColumnId(
  ticketId: string,
  boardColumnId: string | null,
  opts?: { touchLaneEnteredAt?: boolean },
): Promise<void> {
  const now = new Date().toISOString();
  const touchLane = opts?.touchLaneEnteredAt !== false;
  if (boardColumnId == null) {
    await prisma.$executeRawUnsafe(
      touchLane
        ? `UPDATE tickets SET request_board_column_id = NULL, board_lane_entered_at = $2::timestamptz, updated_at = $2::timestamptz WHERE id = $1`
        : `UPDATE tickets SET request_board_column_id = NULL, updated_at = $2::timestamptz WHERE id = $1`,
      ticketId,
      now,
    );
    return;
  }
  await prisma.$executeRawUnsafe(
    touchLane
      ? `UPDATE tickets SET request_board_column_id = $2, board_lane_entered_at = $3::timestamptz, updated_at = $3::timestamptz WHERE id = $1`
      : `UPDATE tickets SET request_board_column_id = $2, updated_at = $3::timestamptz WHERE id = $1`,
    ticketId,
    boardColumnId,
    now,
  );
}

/** Stamp lane-enter time without requiring Prisma Client to know the field yet. */
export async function touchTicketBoardLaneEnteredAt(ticketId: string, at = new Date()): Promise<void> {
  await prisma.$executeRawUnsafe(
    `UPDATE tickets SET board_lane_entered_at = $2::timestamptz WHERE id = $1`,
    ticketId,
    at.toISOString(),
  );
}

/** Load board_lane_entered_at for ticket ids (raw SQL — HMR-safe). */
export async function loadTicketBoardLaneEnteredAtMap(
  ticketIds: string[],
): Promise<Map<string, Date>> {
  const map = new Map<string, Date>();
  if (ticketIds.length === 0) return map;
  const rows = await prisma.$queryRawUnsafe<
    Array<{ id: string; board_lane_entered_at: Date | string | null }>
  >(
    `SELECT id, board_lane_entered_at FROM tickets WHERE id = ANY($1::text[])`,
    ticketIds,
  );
  for (const row of rows) {
    if (!row.board_lane_entered_at) continue;
    const at =
      row.board_lane_entered_at instanceof Date
        ? row.board_lane_entered_at
        : new Date(row.board_lane_entered_at);
    if (Number.isFinite(at.getTime())) map.set(row.id, at);
  }
  return map;
}

/** Latest audit-trail timestamp per ticket (Job Order overdue clock). */
export async function loadTicketLastActivityAtMap(
  ticketIds: string[],
): Promise<Map<string, Date>> {
  const map = new Map<string, Date>();
  if (ticketIds.length === 0) return map;
  const rows = await prisma.$queryRawUnsafe<
    Array<{ ticket_id: string; last_at: Date | string | null }>
  >(
    `SELECT ticket_id, MAX(created_at) AS last_at
     FROM ticket_activities
     WHERE ticket_id = ANY($1::text[])
     GROUP BY ticket_id`,
    ticketIds,
  );
  for (const row of rows) {
    if (!row.last_at) continue;
    const at = row.last_at instanceof Date ? row.last_at : new Date(row.last_at);
    if (Number.isFinite(at.getTime())) map.set(row.ticket_id, at);
  }
  return map;
}

/**
 * When each ticket first entered FOR_CONFIRMATION (from audit trail).
 * Used as fallback when `resolvedAt` / lane stamp is missing.
 */
export async function loadTicketForConfirmationEnteredAtMap(
  ticketIds: string[],
): Promise<Map<string, Date>> {
  const map = new Map<string, Date>();
  if (ticketIds.length === 0) return map;
  const rows = await prisma.$queryRawUnsafe<
    Array<{ ticket_id: string; entered_at: Date | string | null }>
  >(
    `SELECT ticket_id, MIN(created_at) AS entered_at
     FROM ticket_activities
     WHERE ticket_id = ANY($1::text[])
       AND summary = 'Status → FOR_CONFIRMATION'
     GROUP BY ticket_id`,
    ticketIds,
  );
  for (const row of rows) {
    if (!row.entered_at) continue;
    const at = row.entered_at instanceof Date ? row.entered_at : new Date(row.entered_at);
    if (Number.isFinite(at.getTime())) map.set(row.ticket_id, at);
  }
  return map;
}

/** Stamp board lane when a ticket enters FOR_CONFIRMATION (starts confirmation overdue clock). */
export async function stampForConfirmationBoardLane(ticketId: string, at = new Date()): Promise<void> {
  await touchTicketBoardLaneEnteredAt(ticketId, at);
}
