import { prismaPrimary as prisma } from "../../src/lib/prisma";
import { resolveStaffCompanyTeamId } from "../../src/lib/staff-company-scope";
import { resolveViewerOrgChartSectionScope } from "../../src/lib/org-chart-section-scope";
import { listOrgChartSectionOptions } from "../../src/lib/org-chart-section-roster";
import { filterOrgChartSectionsByCompanyTeam } from "../../src/lib/org-chart-section-display";
import { resolveMergedSourceUserIdForSessionEmail } from "../../src/lib/approval-position-resolver";

async function main() {
  const admins = await prisma.portalAccount.findMany({
    where: { role: "Admin", accountStatus: "ACTIVE" },
    select: { name: true, email: true, headPrivileges: true },
    orderBy: { name: "asc" },
    take: 50,
  });
  const allSections = await listOrgChartSectionOptions();
  const statuses = [
    "OPEN",
    "IN_PROGRESS",
    "PENDING_INFO",
    "ESCALATED",
    "FOR_CONFIRMATION",
    "RESOLVED",
  ] as const;
  const rows = [];
  for (const a of admins) {
    const companyId = await resolveStaffCompanyTeamId(a.email);
    const scope = await resolveViewerOrgChartSectionScope(a.email);
    const companySections = filterOrgChartSectionsByCompanyTeam(allSections, companyId);
    const companySectionIds = new Set(companySections.map((s) => s.id));
    const intersect = scope.sectionIds.filter((id) => companySectionIds.has(id));
    const mergedId = await resolveMergedSourceUserIdForSessionEmail(a.email);
    const headed = mergedId
      ? await prisma.orgChartSection.findMany({
          where: { headNode: { mergedSourceUserId: mergedId } },
          select: { id: true, name: true },
        })
      : [];
    const bySection = scope.sectionIds.length
      ? await prisma.ticket.count({
          where: {
            orgChartSectionId: { in: scope.sectionIds },
            status: { in: [...statuses] },
          },
        })
      : 0;
    const bySectionAndCompany =
      scope.sectionIds.length && companyId
        ? await prisma.ticket.count({
            where: {
              orgChartSectionId: { in: scope.sectionIds },
              teamId: companyId,
              status: { in: [...statuses] },
            },
          })
        : 0;
    const intersectTickets = intersect.length
      ? await prisma.ticket.count({
          where: {
            orgChartSectionId: { in: intersect },
            ...(companyId ? { teamId: companyId } : {}),
            status: { in: [...statuses] },
          },
        })
      : 0;
    const broken =
      scope.sectionIds.length === 0 ||
      intersect.length === 0 ||
      bySection > bySectionAndCompany;
    if (!broken && headed.length === 0) continue;
    rows.push({
      name: a.name,
      email: a.email,
      headPriv: a.headPrivileges,
      headed: headed.map((h) => h.name),
      scopeN: scope.sectionIds.length,
      companySecN: companySections.length,
      intersectN: intersect.length,
      bySection,
      bySectionAndCompany,
      intersectTickets,
      broken,
    });
  }
  console.log(JSON.stringify(rows, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
