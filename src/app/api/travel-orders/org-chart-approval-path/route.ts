import { NextResponse } from "next/server";
import { requireRole } from "@/lib/access";
import { resolveOpsPermissions } from "@/lib/ops-permissions";
import { resolveTravelOrderOrgChartApprovalPath } from "@/modules/work-plans/travel-order-org-chart-path";

/**
 * GET /api/travel-orders/org-chart-approval-path?agentId=
 * Recommended travel-order approval seats from the requestor's org-chart path.
 */
export async function GET(req: Request) {
  const { session, unauthorized } = await requireRole(["Admin", "Personnel"]);
  if (unauthorized || !session) return unauthorized;

  const perms = await resolveOpsPermissions(session);
  const searchParams = new URL(req.url).searchParams;
  const requestedAgentId = searchParams.get("agentId")?.trim() || "";
  const agentId = requestedAgentId || perms.operator?.id || "";
  if (!agentId) {
    return NextResponse.json({
      requestorAgentId: "",
      requestorOrgLayer: null,
      seats: [],
      recommendedConfirmation: {
        agentId: null,
        agentName: null,
        sectionId: null,
        sectionName: null,
        hint: null,
      },
    });
  }

  // Non-admins may only resolve their own path (or the company-scoped operator).
  if (
    !perms.canAssignWork &&
    perms.operator?.id &&
    agentId !== perms.operator.id
  ) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const path = await resolveTravelOrderOrgChartApprovalPath(agentId);
  return NextResponse.json(path);
}
