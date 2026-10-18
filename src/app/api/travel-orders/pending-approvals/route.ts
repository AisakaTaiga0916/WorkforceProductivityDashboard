import { NextResponse } from "next/server";
import { requireRole } from "@/lib/access";
import { resolveOpsPermissions } from "@/lib/ops-permissions";
import {
  getOperatorActionableApprovalLevel,
  hasHierarchicalApprovals,
} from "@/modules/work-plans/travel-order";
import {
  listPendingTravelApprovalsForAgent,
  serializeTravelOrder,
} from "@/modules/work-plans/travel-order-db";

/**
 * GET /api/travel-orders/pending-approvals
 * Travel orders waiting on the current user to approve.
 */
export async function GET() {
  const { session, unauthorized } = await requireRole(["Admin", "Personnel"]);
  if (unauthorized || !session) return unauthorized;
  const perms = await resolveOpsPermissions(session);
  const agentId = perms.operator?.id ?? null;
  if (!agentId) {
    return NextResponse.json({ pendingApprovals: [] });
  }

  const rows = await listPendingTravelApprovalsForAgent(agentId);
  return NextResponse.json({
    pendingApprovals: rows.map((row) => {
      const serialized = serializeTravelOrder(row);
      const levels = row.approvalLevels ?? [];
      const pending = hasHierarchicalApprovals(levels)
        ? getOperatorActionableApprovalLevel(levels, agentId)
        : null;
      return {
        ...serialized,
        pendingLevel: pending?.level ?? null,
        pendingLevelOptional: pending?.optional === true,
        href: `/agent/tasks?task=${encodeURIComponent(row.kpiMaintenanceId)}`,
      };
    }),
  });
}
