/**
 * Diagnose Assign Requests scoping for Admin portals.
 * Usage: npx tsx scripts/.merge-tmp/diag-admin-assign-scope.ts
 */
import { prismaPrimary as prisma } from "../../src/lib/prisma";
import {
  loadAgentIdsForCompanyTeam,
  resolveStaffCompanyTeamId,
} from "../../src/lib/staff-company-scope";
import { resolveViewerOrgChartSectionScope } from "../../src/lib/org-chart-section-scope";
import { filterOrgChartSectionsByCompanyTeam } from "../../src/lib/org-chart-section-display";
import { listOrgChartSectionOptions } from "../../src/lib/org-chart-section-roster";
import { loadHrisAssignableStaff } from "../../src/lib/hris-staff-roster";

async function main() {
  const admins = await prisma.portalAccount.findMany({
    where: {
      role: "Admin",
      accountStatus: { notIn: ["LEGACY_CONFLICT", "LEGACY_MERGED"] },
    },
    select: {
      name: true,
      email: true,
      staffDesignatedCompany: { select: { id: true, name: true } },
    },
    take: 10,
    orderBy: { name: "asc" },
  });
  const allSections = await listOrgChartSectionOptions();
  const unassignedAll = await prisma.ticket.count({
    where: {
      assignedAgentId: null,
      status: { in: ["OPEN", "IN_PROGRESS", "PENDING_INFO", "ESCALATED"] },
    },
  });

  const rows = [];
  for (const a of admins) {
    const companyId = await resolveStaffCompanyTeamId(a.email);
    const scope = await resolveViewerOrgChartSectionScope(a.email);
    const companySections = filterOrgChartSectionsByCompanyTeam(allSections, companyId);
    const companySectionIds = new Set(companySections.map((s) => s.id));
    const intersect = scope.sectionIds.filter((id) => companySectionIds.has(id));
    const companyAgents = companyId ? await loadAgentIdsForCompanyTeam(companyId) : [];
    const companyAgentSet = new Set(companyAgents);
    const deptAgents = scope.agentIds.filter((id) => companyAgentSet.has(id));
    const hris = companyId
      ? await loadHrisAssignableStaff({ companyTeamId: companyId })
      : [];
    const unassignedCompany = companyId
      ? await prisma.ticket.count({
          where: {
            assignedAgentId: null,
            teamId: companyId,
            status: { in: ["OPEN", "IN_PROGRESS", "PENDING_INFO", "ESCALATED"] },
          },
        })
      : 0;
    const unassignedDept =
      scope.sectionIds.length > 0
        ? await prisma.ticket.count({
            where: {
              assignedAgentId: null,
              ...(companyId ? { teamId: companyId } : {}),
              orgChartSectionId: { in: scope.sectionIds },
              status: { in: ["OPEN", "IN_PROGRESS", "PENDING_INFO", "ESCALATED"] },
            },
          })
        : 0;
    rows.push({
      name: a.name,
      email: a.email,
      designated: a.staffDesignatedCompany?.name ?? null,
      companyId,
      scopeSections: scope.sectionIds.length,
      companyLinkedSections: companySections.length,
      intersectSections: intersect.length,
      wouldBlockOnIntersect: scope.sectionIds.length > 0 && intersect.length === 0,
      scopeAgents: scope.agentIds.length,
      companyAgents: companyAgents.length,
      deptAgents: deptAgents.length,
      hrisCompany: hris.length,
      unassignedAll,
      unassignedCompany,
      unassignedDept,
      viewsWouldLookSame: deptAgents.length > 0 && deptAgents.length === hris.length,
    });
  }
  console.log(JSON.stringify({ count: rows.length, rows }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
