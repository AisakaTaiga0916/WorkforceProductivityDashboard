import { NextResponse } from "next/server";
import { requireSession } from "@/lib/access";
import {
  expandOrgChartSectionsWithAncestors,
  orderOrgChartSectionsTree,
  resolveOrgChartSectionIdsForMergedUser,
} from "@/modules/hierarchy/org-chart-section-roster";
import { resolveMergedSourceUserIdForSessionEmail } from "@/modules/platform/approvals/approval-position-resolver";
import { prisma } from "@/modules/platform/db/prisma";

/** Org-chart sections the signed-in user belongs to (for RFP requestor section). */
export async function GET() {
  const session = await requireSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const mergedSourceUserId = await resolveMergedSourceUserIdForSessionEmail(session.user.email);
  const memberSectionIds = await resolveOrgChartSectionIdsForMergedUser(mergedSourceUserId);
  const memberSet = new Set(memberSectionIds);

  const rows = await prisma.orgChartSection.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, parentId: true, companyTeamId: true, sortOrder: true },
  });

  const expanded =
    memberSectionIds.length > 0
      ? expandOrgChartSectionsWithAncestors(rows, memberSectionIds)
      : rows;
  const sections = orderOrgChartSectionsTree(expanded);

  const defaultSectionId = sections.find((s) => memberSet.has(s.id))?.id ?? sections[0]?.id ?? null;

  return NextResponse.json({
    sections,
    defaultSectionId,
    mergedSourceUserId,
  });
}
