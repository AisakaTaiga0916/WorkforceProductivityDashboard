import { redirect } from "next/navigation";
import { requireSession } from "@/lib/access";
import { sortByRosterOrder, rosterTeamNameFilter } from "@/lib/company-roster";
import { loadPersonnelAccountsPayload } from "@/lib/personnel-accounts-data";
import { loadOnDutySnapshot } from "@/lib/load-on-duty-snapshot";
import { prisma } from "@/lib/prisma";
import { resolveAdminOnDutyCompanyFilter } from "@/lib/staff-company-scope";
import {
  reconcilePortalStaffRolesFromOrgChart,
  resolvePortalTechnicalRolesByMergedSourceUserIds,
  resolveViewerOrgChartSectionScope,
} from "@/lib/org-chart-section-scope";
import { WorkforceClient } from "./ui";
import type { OrgChartSectionRow } from "../superadmin-settings/OrgChartSectionsPanel";
import {
  firstVisibleWorkforceView,
  isWorkforceViewVisible,
} from "@/lib/workforce-view-visibility";
import { getWorkforceViewVisibility } from "@/lib/workforce-view-visibility-db";

export const dynamic = "force-dynamic";

// Activity cards render in a 3×5 grid (3 columns × 5 rows = 15 per page).
const ON_DUTY_PAGE_SIZE = 15;

function firstQuery(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

export default async function WorkforcePage({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string | string[];
    q?: string | string[];
    role?: string | string[];
    company?: string | string[];
    onDutyCompany?: string | string[];
  }>;
}) {
  const session = await requireSession();
  if (!session?.user) redirect("/signin");
  if (!["SuperAdmin", "HighAdmin", "Admin"].includes(session.user.role)) redirect("/");

  const params = await searchParams;
  const isSuperAdmin = session.user.role === "SuperAdmin";
  const viewVisibility = await getWorkforceViewVisibility();
  const visibleViews = {
    list: isWorkforceViewVisible(viewVisibility, "list"),
    activity: isWorkforceViewVisible(viewVisibility, "activity"),
    sections: isWorkforceViewVisible(viewVisibility, "sections"),
  };
  const viewParam = firstQuery(params.view);
  const initialView = firstVisibleWorkforceView(viewVisibility, viewParam);
  const initialSearchQuery = firstQuery(params.q)?.trim() ?? "";
  const initialRoleFilter = firstQuery(params.role)?.trim() ?? "";
  const initialCompanyFilter = firstQuery(params.company)?.trim() ?? "";
  const initialOnDutyCompanyFilter = firstQuery(params.onDutyCompany)?.trim() ?? "";

  const lockedCompanyFilter = await resolveAdminOnDutyCompanyFilter(
    session.user.role,
    session.user.email,
  );

  const [payload, assignableTeams, onDuty, orgPayload] = await Promise.all([
    loadPersonnelAccountsPayload({
      role: session.user.role,
      email: session.user.email,
    }),
    prisma.team.findMany({
      where: rosterTeamNameFilter(),
      select: { id: true, name: true },
    }),
    loadOnDutySnapshot({
      page: 1,
      pageSize: ON_DUTY_PAGE_SIZE,
      ...(lockedCompanyFilter ? { companyFilter: lockedCompanyFilter } : {}),
    }),
    visibleViews.sections
      ? Promise.all([
          prisma.orgChartNode.findMany({
            include: {
              sectionMemberships: {
                select: {
                  sectionId: true,
                  roleId: true,
                  role: { select: { id: true, label: true } },
                },
                orderBy: { createdAt: "asc" },
              },
            },
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          }),
          prisma.orgChartSection.findMany({
            orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
            include: {
              companyTeam: { select: { id: true, name: true } },
              headNode: {
                select: {
                  id: true,
                  personName: true,
                  personRole: true,
                  companyName: true,
                  mergedSourceUserId: true,
                },
              },
              reportsToNode: {
                select: {
                  id: true,
                  personName: true,
                  personRole: true,
                  companyName: true,
                },
              },
              roles: {
                select: { id: true, label: true, sortOrder: true },
                orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
              },
              _count: { select: { memberships: true } },
            },
          }),
          prisma.orgChartEitherOrLink.findMany({
            orderBy: { createdAt: "asc" },
          }),
        ])
      : Promise.resolve(null),
  ]);

  const orderedCompanies = sortByRosterOrder(assignableTeams);

  if (isSuperAdmin && visibleViews.sections && orgPayload) {
    await reconcilePortalStaffRolesFromOrgChart();
  }

  /** Admins (and non-elevated heads): org chart is read-only and limited to their dept tree. */
  const scopeOrgChartToViewer =
    Boolean(orgPayload) &&
    !isSuperAdmin &&
    session.user.role === "Admin";
  const viewerSectionScope = scopeOrgChartToViewer
    ? await resolveViewerOrgChartSectionScope(session.user.email)
    : null;
  const allowedSectionIdSet =
    viewerSectionScope && viewerSectionScope.sectionIds.length > 0
      ? new Set(viewerSectionScope.sectionIds)
      : scopeOrgChartToViewer
        ? new Set<string>()
        : null;

  let scopedOrgNodes = orgPayload?.[0] ?? [];
  let scopedOrgSections = orgPayload?.[1] ?? [];
  let scopedEitherOr = orgPayload?.[2] ?? [];

  if (allowedSectionIdSet) {
    scopedOrgSections = scopedOrgSections.filter((s) => allowedSectionIdSet.has(s.id));
    // Keep parent links only when parent is also in scope; otherwise treat as root.
    scopedOrgSections = scopedOrgSections.map((s) =>
      s.parentId && !allowedSectionIdSet.has(s.parentId) ? { ...s, parentId: null } : s,
    );
    scopedOrgNodes = scopedOrgNodes.filter((n) =>
      (n.sectionMemberships ?? []).some((m) => allowedSectionIdSet.has(m.sectionId)),
    );
    const nodeIdSet = new Set(scopedOrgNodes.map((n) => n.id));
    scopedEitherOr = scopedEitherOr.filter(
      (l) => nodeIdSet.has(l.nodeAId) && nodeIdSet.has(l.nodeBId),
    );
  }

  const headMergedIds = scopedOrgSections
    .map((s) => s.headNode?.mergedSourceUserId)
    .filter((id): id is string => Boolean(id?.trim()));
  const memberMergedIds = scopedOrgNodes
    .map((n) => n.mergedSourceUserId?.trim())
    .filter((id): id is string => Boolean(id));
  const portalRoleLookupIds = [...new Set([...headMergedIds, ...memberMergedIds])];
  const portalRoleByMergedId =
    portalRoleLookupIds.length > 0
      ? await resolvePortalTechnicalRolesByMergedSourceUserIds(portalRoleLookupIds)
      : new Map<string, string>();

  const initialOrgSections: OrgChartSectionRow[] | undefined = orgPayload
    ? scopedOrgSections.map((s) => {
        const mergedId = s.headNode?.mergedSourceUserId?.trim() ?? "";
        const portalRole = mergedId ? portalRoleByMergedId.get(mergedId) ?? null : null;
        return {
          id: s.id,
          name: s.name,
          description: s.description,
          sortOrder: s.sortOrder,
          parentId: s.parentId,
          companyTeamId: s.companyTeamId,
          companyName: s.companyTeam?.name ?? null,
          headNodeId: s.headNodeId,
          headName: s.headNode?.personName ?? null,
          headRole: portalRole ?? s.headNode?.personRole ?? null,
          headCompanyName: s.headNode?.companyName ?? null,
          reportsToNodeId: s.reportsToNodeId,
          reportsToName: s.reportsToNode?.personName ?? null,
          reportsToRole: s.reportsToNode?.personRole ?? null,
          reportsToCompanyName: s.reportsToNode?.companyName ?? null,
          roles: s.roles,
          memberCount: s._count.memberships,
        };
      })
    : undefined;
  const initialOrgEitherOrLinks = scopedEitherOr.map((l) => ({
    id: l.id,
    nodeAId: l.nodeAId,
    nodeBId: l.nodeBId,
  }));

  const initialPortalRoleByMergedId = Object.fromEntries(portalRoleByMergedId);

  return (
    <WorkforceClient
      initialView={initialView}
      initialSearchQuery={initialSearchQuery}
      initialRoleFilter={initialRoleFilter}
      initialCompanyFilter={initialCompanyFilter}
      initialOnDutyCompanyFilter={initialOnDutyCompanyFilter}
      initialTeams={payload.teams}
      initialPersonnel={payload.personnel}
      initialAssignableCompanies={orderedCompanies}
      viewerMode={payload.viewerMode}
      scopeUnavailable={payload.scopeUnavailable}
      scopedCompanyName={payload.scopedCompanyName}
      secondaryDatabaseName={payload.secondaryDatabaseName}
      initialOnDutyAgents={onDuty.agents}
      initialOnDutyPage={onDuty.page}
      onDutyTotalPages={onDuty.totalPages}
      onDutyTotal={onDuty.total}
      onDutyActiveCount={onDuty.onDutyCount}
      initialOnDutyCompanies={
        lockedCompanyFilter && lockedCompanyFilter !== "__none__"
          ? [lockedCompanyFilter]
          : onDuty.companies
      }
      onDutyPageSize={ON_DUTY_PAGE_SIZE}
      lockedCompanyFilter={lockedCompanyFilter}
      userEmail={session.user.email}
      visibleViews={visibleViews}
      canManageSections={isSuperAdmin}
      canSetPortalRoles={isSuperAdmin}
      initialOrgSections={initialOrgSections}
      initialOrgNodes={orgPayload ? scopedOrgNodes : undefined}
      initialOrgEitherOrLinks={orgPayload ? initialOrgEitherOrLinks : undefined}
      initialPortalRoleByMergedId={initialPortalRoleByMergedId}
      sectionCompanyOptions={orderedCompanies}
    />
  );
}
