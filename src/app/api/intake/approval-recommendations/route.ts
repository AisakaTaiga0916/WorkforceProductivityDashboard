import { NextResponse } from "next/server";
import { requireRole } from "@/lib/access";
import {
  resolveMergedSourceUserIdForSessionEmail,
} from "@/modules/hierarchy/approval-position-resolver";
import { resolveIntakeApprovalRecommendations } from "@/modules/requests/intake-approval-recommendations";
import { resolveDeepestOrgChartSectionIdForMergedUser } from "@/modules/hierarchy/org-chart-section-roster";
import { parseRequestTypeId, type RequestTypeId } from "@/modules/requests/request-types";

const SUPPORTED: RequestTypeId[] = [
  "REQUEST_FOR_PAYMENT",
  "FUND_TRANSFER_REQUEST",
  "JOB_ORDER",
  "ITEM_REQUISITION_SLIP",
];

function isTruthyFlag(raw: string | null): boolean {
  return raw === "1" || raw === "true";
}

/**
 * GET /api/intake/approval-recommendations
 * Section/position-based suggested approvers for intake forms.
 */
export async function GET(req: Request) {
  const { session, unauthorized } = await requireRole(["Admin", "Personnel"]);
  if (unauthorized || !session) return unauthorized;

  const searchParams = new URL(req.url).searchParams;
  const requestType = parseRequestTypeId(searchParams.get("requestType"));
  if (!SUPPORTED.includes(requestType)) {
    return NextResponse.json({ error: "Unsupported request type." }, { status: 400 });
  }

  let requestorSectionId = searchParams.get("requestorSectionId")?.trim() || "";
  const sendToSectionId = searchParams.get("sendToSectionId")?.trim() || "";
  const requestingCompanyTeamId = searchParams.get("requestingCompanyTeamId")?.trim() || "";
  const skipNotedBy = isTruthyFlag(searchParams.get("skipNotedBy"));
  const skipApprovedBy = isTruthyFlag(searchParams.get("skipApprovedBy"));
  const deferBookkeeper = isTruthyFlag(searchParams.get("deferBookkeeper"));

  const mergedSourceUserId = await resolveMergedSourceUserIdForSessionEmail(session.user.email);
  if (!requestorSectionId) {
    requestorSectionId =
      (await resolveDeepestOrgChartSectionIdForMergedUser(mergedSourceUserId)) ?? "";
  }

  const guide = await resolveIntakeApprovalRecommendations({
    requestType,
    requestorSectionId: requestorSectionId || null,
    sendToSectionId: sendToSectionId || null,
    requestorEmail: session.user.email,
    requestingCompanyTeamId: requestingCompanyTeamId || null,
    requestorMergedSourceUserId: mergedSourceUserId,
    skipNotedBy,
    skipApprovedBy,
    deferBookkeeper,
  });

  return NextResponse.json(guide);
}
