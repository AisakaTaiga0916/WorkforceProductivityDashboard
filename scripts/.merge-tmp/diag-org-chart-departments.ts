/**
 * Diagnose org-chart designated departments for Admin/Personnel portals.
 * Usage: npx tsx scripts/.merge-tmp/diag-org-chart-departments.ts
 */
import { prismaPrimary } from "../../src/lib/prisma";
import { resolveMergedSourceUserIdForSessionEmail } from "../../src/lib/approval-position-resolver";
import { resolveOrgChartSectionIdsForMergedUser } from "../../src/lib/org-chart-section-roster";
import { resolveViewerDepartmentScopeLabel } from "../../src/lib/org-chart-section-scope";
import { resolveStaffCompanyTeamId } from "../../src/lib/staff-company-scope";

async function main() {
  const portals = await prismaPrimary.portalAccount.findMany({
    where: {
      role: { in: ["Admin", "Personnel"] },
      accountStatus: { notIn: ["LEGACY_CONFLICT", "LEGACY_MERGED"] },
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      headPrivileges: true,
      mergedSourceUserId: true,
      staffDesignatedCompany: { select: { id: true, name: true } },
    },
    orderBy: { name: "asc" },
    take: 80,
  });

  const sections = await prismaPrimary.orgChartSection.findMany({
    select: {
      id: true,
      name: true,
      parentId: true,
      companyTeamId: true,
      headNodeId: true,
      headNode: { select: { mergedSourceUserId: true, personName: true } },
    },
    orderBy: { name: "asc" },
  });

  const rows = [];
  for (const p of portals) {
    const email = p.email;
    const mergedFromEmail = await resolveMergedSourceUserIdForSessionEmail(email);
    const mergedId =
      mergedFromEmail ??
      (p.mergedSourceUserId != null ? String(p.mergedSourceUserId) : null);
    const membershipIds = await resolveOrgChartSectionIdsForMergedUser(mergedId);
    const headed = sections
      .filter(
        (s) =>
          mergedId &&
          s.headNode?.mergedSourceUserId &&
          String(s.headNode.mergedSourceUserId) === mergedId,
      )
      .map((s) => ({ id: s.id, name: s.name }));
    const deptLabel = await resolveViewerDepartmentScopeLabel(email);
    const companyId = await resolveStaffCompanyTeamId(email);
    rows.push({
      name: p.name,
      email,
      role: p.role,
      headPrivileges: p.headPrivileges,
      portalMergedId: p.mergedSourceUserId?.toString() ?? null,
      resolvedMergedId: mergedId,
      company: p.staffDesignatedCompany?.name ?? null,
      companyTeamId: companyId,
      membershipSectionIds: membershipIds,
      headedSections: headed,
      departmentWidgetLabel: deptLabel,
      widgetWouldShowNotSet: !deptLabel,
      missingMembershipButIsHead: membershipIds.length === 0 && headed.length > 0,
    });
  }

  const summary = {
    sectionCount: sections.length,
    portalSample: rows.length,
    notSetCount: rows.filter((r) => r.widgetWouldShowNotSet).length,
    headWithoutMembership: rows.filter((r) => r.missingMembershipButIsHead).length,
    adminNotSet: rows.filter((r) => r.role === "Admin" && r.widgetWouldShowNotSet).length,
    personnelNotSet: rows.filter((r) => r.role === "Personnel" && r.widgetWouldShowNotSet)
      .length,
  };

  console.log(JSON.stringify({ summary, sampleNotSet: rows.filter((r) => r.widgetWouldShowNotSet).slice(0, 25), sampleOk: rows.filter((r) => !r.widgetWouldShowNotSet).slice(0, 10) }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prismaPrimary.$disconnect());
