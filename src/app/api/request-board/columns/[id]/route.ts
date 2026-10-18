import { NextResponse } from "next/server";
import { requireSession } from "@/lib/access";
import {
  canManageRequestBoardColumns,
  countTicketsInBoardColumn,
  deleteRequestBoardColumn,
  getRequestBoardColumnById,
  isTicketStatus,
  listRequestBoardColumns,
  parseAcceptStatuses,
  requestBoardOwnerKey,
  updateRequestBoardColumn,
} from "@/modules/requests/request-board-columns";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Params) {
  const session = await requireSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canManageRequestBoardColumns(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const ownerKey = requestBoardOwnerKey(session.user);
  const { id } = await params;
  const column = await getRequestBoardColumnById(ownerKey, id);
  if (!column) {
    return NextResponse.json({ error: "Board not found." }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    name?: unknown;
    mappedStatus?: unknown;
    mappingLabel?: unknown;
    allowDrop?: unknown;
    acceptStatuses?: unknown;
  };

  const data: {
    name?: string;
    mappedStatus?: import("@prisma/client/primary").TicketStatus;
    mappingLabel?: string | null;
    allowDrop?: boolean;
    acceptStatuses?: import("@prisma/client/primary").TicketStatus[];
  } = {};

  if (typeof body.name === "string") {
    const name = body.name.trim();
    if (!name || name.length > 80) {
      return NextResponse.json({ error: "Board name is required (max 80 characters)." }, { status: 400 });
    }
    data.name = name;
  }

  if (body.mappedStatus !== undefined) {
    if (!isTicketStatus(body.mappedStatus) || body.mappedStatus === "CLOSED") {
      return NextResponse.json({ error: "Invalid mapped status." }, { status: 400 });
    }
    data.mappedStatus = body.mappedStatus;
  }

  if (body.mappingLabel !== undefined) {
    if (body.mappingLabel === null) {
      data.mappingLabel = null;
    } else if (typeof body.mappingLabel === "string") {
      const label = body.mappingLabel.trim();
      if (label.length > 80) {
        return NextResponse.json({ error: "Mapping name max 80 characters." }, { status: 400 });
      }
      data.mappingLabel = label || null;
    } else {
      return NextResponse.json({ error: "Invalid mappingLabel." }, { status: 400 });
    }
  }

  if (typeof body.allowDrop === "boolean") {
    data.allowDrop = body.allowDrop;
  }

  if (body.acceptStatuses !== undefined && column.isDefault) {
    const accept = parseAcceptStatuses(body.acceptStatuses);
    if (accept.length === 0) {
      return NextResponse.json({ error: "acceptStatuses cannot be empty." }, { status: 400 });
    }
    data.acceptStatuses = accept;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No changes provided." }, { status: 400 });
  }

  try {
    const updated = await updateRequestBoardColumn(ownerKey, id, data);
    return NextResponse.json({ column: updated });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not update board." },
      { status: 400 },
    );
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  const session = await requireSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canManageRequestBoardColumns(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const ownerKey = requestBoardOwnerKey(session.user);
  const { id } = await params;
  const columns = await listRequestBoardColumns(ownerKey);
  const column = columns.find((c) => c.id === id);
  if (!column) {
    return NextResponse.json({ error: "Board not found." }, { status: 404 });
  }
  if (column.isDefault) {
    return NextResponse.json(
      { error: "Default boards cannot be removed. Rename them instead." },
      { status: 400 },
    );
  }

  const ticketCount = await countTicketsInBoardColumn(column);
  if (ticketCount > 0) {
    return NextResponse.json(
      {
        error: `This board still has ${ticketCount} request${ticketCount === 1 ? "" : "s"} assigned to it. Move them to another board before deleting.`,
        ticketCount,
      },
      { status: 409 },
    );
  }

  try {
    const remaining = await deleteRequestBoardColumn(ownerKey, id);
    return NextResponse.json({ ok: true, columns: remaining });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not delete board." },
      { status: 400 },
    );
  }
}
