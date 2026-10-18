import { NextResponse } from "next/server";
import { requireSession } from "@/lib/access";
import {
  canManageRequestBoardColumns,
  createRequestBoardColumn,
  isTicketStatus,
  listRequestBoardColumns,
  reorderRequestBoardColumns,
  requestBoardOwnerKey,
} from "@/modules/requests/request-board-columns";

export async function GET() {
  const session = await requireSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!["SuperAdmin", "HighAdmin", "Admin", "Personnel", "Personnel-Guard"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const ownerKey = requestBoardOwnerKey(session.user);
  const columns = await listRequestBoardColumns(ownerKey);
  return NextResponse.json({
    columns,
    canManage: canManageRequestBoardColumns(session.user.role),
  });
}

export async function POST(req: Request) {
  const session = await requireSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canManageRequestBoardColumns(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    name?: unknown;
    mappedStatus?: unknown;
    mappingLabel?: unknown;
    allowDrop?: unknown;
  };

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 80) {
    return NextResponse.json({ error: "Board name is required (max 80 characters)." }, { status: 400 });
  }
  if (!isTicketStatus(body.mappedStatus) || body.mappedStatus === "CLOSED") {
    return NextResponse.json(
      { error: "Choose a valid mapped status (not Closed)." },
      { status: 400 },
    );
  }

  const mappingLabel =
    typeof body.mappingLabel === "string" ? body.mappingLabel.trim() : "";
  if (mappingLabel.length > 80) {
    return NextResponse.json({ error: "Mapping name max 80 characters." }, { status: 400 });
  }

  if (!mappingLabel) {
    const defaults: Array<string> = ["OPEN", "IN_PROGRESS", "FOR_CONFIRMATION"];
    if (!defaults.includes(body.mappedStatus)) {
      return NextResponse.json(
        { error: "Default maps are Open, In progress, or For confirmation. Create a custom mapping for other labels." },
        { status: 400 },
      );
    }
  }

  const ownerKey = requestBoardOwnerKey(session.user);
  const created = await createRequestBoardColumn(ownerKey, {
    name,
    mappedStatus: mappingLabel ? "IN_PROGRESS" : body.mappedStatus,
    mappingLabel: mappingLabel || null,
    allowDrop: body.allowDrop === false ? false : true,
  });

  return NextResponse.json({ column: created });
}

/** Reorder columns: body.orderedIds = string[] of all column ids in desired order. */
export async function PUT(req: Request) {
  const session = await requireSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canManageRequestBoardColumns(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as { orderedIds?: unknown };
  if (!Array.isArray(body.orderedIds) || body.orderedIds.length === 0) {
    return NextResponse.json({ error: "orderedIds required." }, { status: 400 });
  }
  const orderedIds = body.orderedIds.filter((id): id is string => typeof id === "string");
  const ownerKey = requestBoardOwnerKey(session.user);
  const existing = await listRequestBoardColumns(ownerKey);
  if (orderedIds.length !== existing.length || new Set(orderedIds).size !== existing.length) {
    return NextResponse.json({ error: "orderedIds must include every board exactly once." }, { status: 400 });
  }
  const existingIds = new Set(existing.map((c) => c.id));
  if (orderedIds.some((id) => !existingIds.has(id))) {
    return NextResponse.json({ error: "Unknown board id in orderedIds." }, { status: 400 });
  }

  try {
    const columns = await reorderRequestBoardColumns(ownerKey, orderedIds);
    return NextResponse.json({ columns });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not reorder boards." },
      { status: 400 },
    );
  }
}
