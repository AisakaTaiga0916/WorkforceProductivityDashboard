import { NextResponse } from "next/server";
import { requireRole } from "@/lib/access";
import { resolveOpsPermissions } from "@/lib/ops-permissions";
import { resolveAgentDesignatedCompanyId } from "@/lib/staff-company-scope";
import { resolveWorkPlanOrgChartApprovalPath } from "@/lib/work-plan-org-chart-path";

/**
 * GET /api/travel-orders/work-plan-org-chart-path?agentId=
 * Recommended Work Plan approvers: org-chart walk from requestor up to Layer 2.
 */
export async function GET(req: Request) {
  const { session, unauthorized } = await requireRole(["Admin", "Personnel"]);
  if (unauthorized || !session) return unauthorized;

  try {
    const perms = await resolveOpsPermissions(session);
    const searchParams = new URL(req.url).searchParams;
    const requestedAgentId = searchParams.get("agentId")?.trim() || "";
    const agentId = requestedAgentId || perms.operator?.id || "";
    if (!agentId) {
      return NextResponse.json(
        {
          requestorAgentId: "",
          requestorOrgLayer: null,
          seats: [],
          usedFallback: true,
          defaults: {},
          recommendedConfirmation: {
            agentId: null,
            agentName: null,
            sectionId: null,
            sectionName: null,
            hint: null,
          },
          error: "Could not identify the requestor for org-chart recommendations.",
        },
        { status: 200 },
      );
    }

    if (!perms.canAssignWork && perms.operator?.id && agentId !== perms.operator.id) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    const companyTeamId = await resolveAgentDesignatedCompanyId(agentId);
    const path = await resolveWorkPlanOrgChartApprovalPath(agentId, { companyTeamId });
    return NextResponse.json(path);
  } catch (error) {
    console.error("[work-plan-org-chart-path]", error);
    return NextResponse.json(
      {
        requestorAgentId: "",
        requestorOrgLayer: null,
        seats: [],
        usedFallback: true,
        defaults: {},
        recommendedConfirmation: {
          agentId: null,
          agentName: null,
          sectionId: null,
          sectionName: null,
          hint: null,
        },
        error: "Could not load org-chart recommendations.",
      },
      { status: 500 },
    );
  }
}
