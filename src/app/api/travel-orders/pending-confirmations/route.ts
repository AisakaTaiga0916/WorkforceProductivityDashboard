import { NextResponse } from "next/server";
import { requireRole } from "@/lib/access";
import { resolveOpsPermissions } from "@/lib/ops-permissions";
import {
  listPendingTravelConfirmationsForAgent,
  serializeTravelOrder,
} from "@/modules/work-plans/travel-order-db";

/**
 * GET /api/travel-orders/pending-confirmations
 * Travel orders waiting on the current user (as designated confirmer) to confirm.
 */
export async function GET() {
  const { session, unauthorized } = await requireRole(["Admin", "Personnel"]);
  if (unauthorized || !session) return unauthorized;
  const perms = await resolveOpsPermissions(session);
  const agentId = perms.operator?.id ?? null;
  if (!agentId) {
    return NextResponse.json({ pendingConfirmations: [] });
  }

  const rows = await listPendingTravelConfirmationsForAgent(agentId);
  return NextResponse.json({
    pendingConfirmations: rows.map((row) => ({
      ...serializeTravelOrder(row),
      href: `/agent/tasks?task=${encodeURIComponent(row.kpiMaintenanceId)}`,
    })),
  });
}
