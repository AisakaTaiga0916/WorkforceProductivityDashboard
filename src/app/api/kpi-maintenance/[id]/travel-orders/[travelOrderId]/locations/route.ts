import { NextResponse } from "next/server";
import { requireRole } from "@/lib/access";
import { resolveOpsPermissions } from "@/lib/ops-permissions";
import { prisma } from "@/lib/prisma";
import {
  isTravelOrderApproved,
  isTravelOrderTraveler,
  TRAVEL_ORDER_STATUS,
} from "@/lib/travel-order";
import {
  addTravelOrderLocation,
  findTravelOrderById,
  serializeTravelOrder,
} from "@/lib/travel-order-db";
import { isWorkPlanOrder } from "@/lib/work-plan";

const MAX_LOCATIONS_PER_ORDER = 30;

/**
 * POST /api/kpi-maintenance/:id/travel-orders/:travelOrderId/locations
 * Travelers may append a location while the order is approved/running (before KPI submit).
 */
export async function POST(
  req: Request,
  ctx: {
    params: Promise<{ id: string; travelOrderId: string }>;
  },
) {
  const { session, unauthorized } = await requireRole(["Admin", "Personnel"]);
  if (unauthorized || !session) return unauthorized;
  const perms = await resolveOpsPermissions(session);
  const { id, travelOrderId } = await ctx.params;

  const kpi = await prisma.kpiMaintenance.findUnique({
    where: { id },
    select: { id: true, assignedAgentId: true },
  });
  if (!kpi) {
    return NextResponse.json({ error: "Task not found." }, { status: 404 });
  }

  const order = await findTravelOrderById(travelOrderId);
  if (!order || order.kpiMaintenanceId !== id) {
    return NextResponse.json({ error: "Travel order not found." }, { status: 404 });
  }

  if (isWorkPlanOrder(order)) {
    return NextResponse.json(
      {
        error: "Locations are not used on Travel Orders for Management Approval.",
      },
      { status: 400 },
    );
  }

  const operatorId = perms.operator?.id ?? null;
  const canAccess =
    perms.canAssignWork ||
    kpi.assignedAgentId === operatorId ||
    isTravelOrderTraveler(operatorId, order);
  if (!canAccess) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!isTravelOrderTraveler(operatorId, order) && !perms.canAssignWork) {
    return NextResponse.json(
      { error: "Only travelers on this travel order can add a location." },
      { status: 403 },
    );
  }

  if (
    order.status === TRAVEL_ORDER_STATUS.REJECTED ||
    order.status === TRAVEL_ORDER_STATUS.CANCELLED ||
    order.status === TRAVEL_ORDER_STATUS.SUBMITTED
  ) {
    return NextResponse.json(
      { error: "Locations can only be added while the travel order is running (after approval)." },
      { status: 400 },
    );
  }

  if (!isTravelOrderApproved(order.status)) {
    return NextResponse.json(
      { error: "Locations can only be added after the travel order is approved." },
      { status: 400 },
    );
  }

  if (order.kpiSubmittedAt) {
    return NextResponse.json(
      { error: "Cannot add locations after the travel order KPI has been submitted." },
      { status: 400 },
    );
  }

  if (order.locations.length >= MAX_LOCATIONS_PER_ORDER) {
    return NextResponse.json(
      { error: `This travel order already has the maximum of ${MAX_LOCATIONS_PER_ORDER} locations.` },
      { status: 400 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as { label?: unknown };
  const label = typeof body.label === "string" ? body.label.trim() : "";
  if (!label) {
    return NextResponse.json({ error: "Enter a location name." }, { status: 400 });
  }

  try {
    const updated = await addTravelOrderLocation({ travelOrderId, label });
    return NextResponse.json({ travelOrder: serializeTravelOrder(updated) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Could not add location.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
