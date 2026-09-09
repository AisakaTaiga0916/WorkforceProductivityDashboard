import { NextResponse } from "next/server";
import { requireRole } from "@/lib/access";
import { isElevatedUserRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { listOrgChartSectionOptions } from "@/lib/org-chart-section-roster";
import {
  resolveViewerOrgChartSectionScope,
  roleShowsDesignatedDepartmentLabel,
} from "@/lib/org-chart-section-scope";

/** Read-only org-chart sections for ticket intake + Insights department filter. */
export async function GET(req: Request) {
  const { session, unauthorized } = await requireRole([
    "Admin",
    "Personnel",
    "SuperAdmin",
    "HighAdmin",
  ]);
  if (unauthorized || !session) return unauthorized;

  const { searchParams } = new URL(req.url);
  /** Insights / metrics: limit Admin+Personnel to designated org-chart departments. */
  const viewerScoped = searchParams.get("scope") === "viewer";

  const [allSections, memberships, primaryNodes] = await Promise.all([
    listOrgChartSectionOptions(),
    prisma.orgChartNodeSectionMembership.findMany({
      select: {
        sectionId: true,
        node: { select: { mergedSourceUserId: true } },
      },
    }),
    prisma.orgChartNode.findMany({
      where: { sectionId: { not: null } },
      select: { sectionId: true, mergedSourceUserId: true },
    }),
  ]);

  let sections = allSections;
  let allowedSectionIds: Set<string> | null = null;
  if (
    viewerScoped &&
    roleShowsDesignatedDepartmentLabel(session.user.role) &&
    !isElevatedUserRole(session.user.role)
  ) {
    const scope = await resolveViewerOrgChartSectionScope(session.user.email);
    allowedSectionIds = new Set(scope.sectionIds);
    sections = allSections.filter((s) => allowedSectionIds!.has(s.id));
  }

  const membersBySection: Record<string, string[]> = {};
  const addMember = (sectionId: string | null | undefined, mergedSourceUserId: string) => {
    const sid = (sectionId ?? "").trim();
    const mid = mergedSourceUserId.trim();
    if (!sid || !mid) return;
    if (allowedSectionIds && !allowedSectionIds.has(sid)) return;
    const list = membersBySection[sid] ?? (membersBySection[sid] = []);
    if (!list.includes(mid)) list.push(mid);
  };
  for (const row of memberships) {
    addMember(row.sectionId, row.node.mergedSourceUserId);
  }
  for (const node of primaryNodes) {
    addMember(node.sectionId, node.mergedSourceUserId);
  }

  return NextResponse.json({ sections, membersBySection });
}
