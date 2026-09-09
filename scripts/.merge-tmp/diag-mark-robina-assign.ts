/**
 * One-off: diagnose Mark Robina assign ability.
 */
import { prismaPrimary as prisma } from "../../src/lib/prisma";
import {
  loadAgentIdsForCompanyTeam,
  resolveStaffCompanyTeamId,
} from "../../src/lib/staff-company-scope";
import {
  resolveViewerOrgChartSectionScope,
  roleUsesCompanyDepartmentTaskAssignScope,
} from "../../src/lib/org-chart-section-scope";
import { portalCompanyAdminPrivilegesForEmail } from "../../src/lib/portal-staff";

async function main() {
  const accounts = await prisma.portalAccount.findMany({
    where: {
      OR: [
        { email: { contains: "robina", mode: "insensitive" } },
        { name: { contains: "Robina", mode: "insensitive" } },
      ],
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      headPrivileges: true,
      accountStatus: true,
      staffDesignatedCompanyId: true,
      staffDesignatedCompany: { select: { id: true, name: true } },
      mergedSourceUserId: true,
      companyId: true,
      company: { select: { id: true, name: true } },
    },
  });
  console.log(
    "ACCOUNTS",
    JSON.stringify(accounts, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2),
  );

  for (const a of accounts) {
    const companyId = await resolveStaffCompanyTeamId(a.email);
    const scope = await resolveViewerOrgChartSectionScope(a.email);
    const priv = await portalCompanyAdminPrivilegesForEmail(a.email);
    const companyAgents = companyId ? await loadAgentIdsForCompanyTeam(companyId) : [];
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
    const agents = await prisma.agent.findMany({
      where: { email: { equals: a.email, mode: "insensitive" } },
      select: {
        id: true,
        name: true,
        email: true,
        teamId: true,
        team: { select: { name: true } },
      },
    });

    const sections =
      scope.sectionIds.length > 0
        ? await prisma.orgChartSection.findMany({
            where: { id: { in: scope.sectionIds } },
            select: { id: true, name: true },
          })
        : [];

    console.log(
      "SCOPE",
      JSON.stringify(
        {
          email: a.email,
          role: a.role,
          headPrivileges: a.headPrivileges,
          accountStatus: a.accountStatus,
          designated: a.staffDesignatedCompany?.name ?? null,
          companyId,
          portalAdminPriv: priv,
          usesDeptScope: roleUsesCompanyDepartmentTaskAssignScope(a.role),
          sections,
          sectionCount: scope.sectionIds.length,
          agentCount: scope.agentIds.length,
          companyAgents: companyAgents.length,
          unassignedCompany,
          unassignedDept,
          agents,
        },
        null,
        2,
      ),
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
