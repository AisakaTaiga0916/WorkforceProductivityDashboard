import { NextResponse } from "next/server";
import { requireRole } from "@/lib/access";
import { isElevatedUserRole } from "@/modules/platform/auth";
import { rosterTeamNameFilter, sortByRosterOrder } from "@/lib/company-roster";
import { buildOrgChartDepartmentFilterOptions } from "@/modules/hierarchy/org-chart-section-display";
import { listOrgChartSectionOptions } from "@/modules/hierarchy/org-chart-section-roster";
import {
  resolveViewerOrgChartSectionScope,
  roleUsesCompanyDepartmentTaskAssignScope,
} from "@/modules/platform/scope/org-chart-section-scope";
import { prisma } from "@/modules/platform/db/prisma";
import { resolveOpsPermissions } from "@/lib/ops-permissions";
import {
  loadAgentIdsForCompanyTeam,
  resolveStaffCompanyTeamId,
} from "@/modules/platform/scope/staff-company-scope";

/**
 * Roster scope for Task Board reassignment:
 * - Elevated (SuperAdmin / HighAdmin): all companies + org-chart departments; pick either scope.
 * - Admin / Personnel: locked to designated company ∩ org-chart department tree.
 */
export async function GET() {
  const { session, unauthorized } = await requireRole([
    "Admin",
    "Personnel",
    "SuperAdmin",
    "HighAdmin",
  ]);
  if (unauthorized || !session) return unauthorized;

  const perms = await resolveOpsPermissions(session);
  if (!perms.canAssignWork) {
    return NextResponse.json({
      elevated: false,
      companies: [],
      departments: [],
      lockedCompanyId: null,
      lockedCompanyName: null,
      lockedAgentIds: [],
    });
  }

  const elevated = isElevatedUserRole(session.user.role);
  const [teams, sections] = await Promise.all([
    sortByRosterOrder(
      await prisma.team.findMany({
        where: rosterTeamNameFilter(),
        select: { id: true, name: true },
      }),
    ),
    listOrgChartSectionOptions(),
  ]);

  const departments = buildOrgChartDepartmentFilterOptions(sections);

  if (elevated) {
    return NextResponse.json({
      elevated: true,
      companies: teams,
      departments,
      lockedCompanyId: null,
      lockedCompanyName: null,
      lockedAgentIds: [],
    });
  }

  if (!roleUsesCompanyDepartmentTaskAssignScope(session.user.role)) {
    return NextResponse.json({
      elevated: false,
      companies: teams,
      departments,
      lockedCompanyId: null,
      lockedCompanyName: null,
      lockedAgentIds: [],
    });
  }

  const companyId = await resolveStaffCompanyTeamId(session.user.email);
  const companyName = companyId
    ? (teams.find((t) => t.id === companyId)?.name ?? null)
    : null;
  const sectionScope = await resolveViewerOrgChartSectionScope(session.user.email);
  const sectionAgentIds = new Set(sectionScope.agentIds);
  const companyAgentIds = companyId
    ? new Set(await loadAgentIdsForCompanyTeam(companyId))
    : new Set<string>();

  const lockedAgentIds =
    companyId && sectionAgentIds.size > 0
      ? [...sectionAgentIds].filter((id) => companyAgentIds.has(id))
      : companyId
        ? [...companyAgentIds]
        : [...sectionAgentIds];

  return NextResponse.json({
    elevated: false,
    companies: companyId
      ? teams.filter((t) => t.id === companyId)
      : [],
    departments: departments.filter((d) => sectionScope.sectionIds.includes(d.value)),
    lockedCompanyId: companyId,
    lockedCompanyName: companyName,
    lockedAgentIds,
  });
}
