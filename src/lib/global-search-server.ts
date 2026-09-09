import type { Prisma } from "@prisma/client/primary";
import type { Session } from "next-auth";
import { isElevatedUserRole } from "@/lib/auth";
import { rosterTeamNameFilter, sortByRosterOrder } from "@/lib/company-roster";
import type { GlobalSearchResult } from "@/lib/global-search";
import { isItProjectEnvelope } from "@/lib/it-project-subkpis";
import { kpiMainTaskLabel } from "@/lib/kpi-main-task";
import { hasSubKpiAssignedTo } from "@/lib/kpi-subkpis";
import { prisma } from "@/lib/prisma";
import { portalCompanyAdminPrivilegesForEmail } from "@/lib/portal-staff";
import { requestTypeAcronym } from "@/lib/request-types";
import { personnelRequestBoardWhere } from "@/lib/rfp-request-board";
import { findSessionAgentWithTeam } from "@/lib/session-agent";
import {
  loadAgentIdsForCompanyTeam,
  resolveAgentDesignatedCompanyId,
  resolveStaffCompanyTeamId,
} from "@/lib/staff-company-scope";
import {
  kpiRowInSectionAgentScope,
  resolveViewerOrgChartSectionScope,
  roleUsesCompanyDepartmentTaskAssignScope,
  roleUsesOrgChartSectionBoardScope,
  sectionScopedTicketWhere,
} from "@/lib/org-chart-section-scope";
import { filterOrgChartSectionsByCompanyTeam } from "@/lib/org-chart-section-display";
import { listOrgChartSectionOptions } from "@/lib/org-chart-section-roster";
import { isPersonnelGuardPortalRole } from "@/lib/staff-role";
import { resolveOpsPermissions } from "@/lib/ops-permissions";
import { loadHrisAssignableStaff } from "@/lib/hris-staff-roster";
import {
  findTravelOrdersVisibleToAgent,
  serializeTravelOrder,
} from "@/lib/travel-order-db";

const MAX_TOTAL = 10;

function matchesQuery(haystack: string, query: string): boolean {
  return haystack.toLowerCase().includes(query.trim().toLowerCase());
}

/** Admin Group Board–aligned ticket scope: designated company ∩ org-chart departments + personal. */
async function adminGroupBoardTicketWhere(input: {
  email: string | null | undefined;
  agentId: string | null | undefined;
}): Promise<Prisma.TicketWhereInput> {
  const staffCompanyId = await resolveStaffCompanyTeamId(input.email);
  const personal =
    input.agentId != null ? await personnelRequestBoardWhere(input.agentId) : null;
  if (!staffCompanyId) {
    return personal ?? { id: "__none__" };
  }
  const [allSections, viewerScope] = await Promise.all([
    listOrgChartSectionOptions(),
    resolveViewerOrgChartSectionScope(input.email),
  ]);
  const companySectionIds = filterOrgChartSectionsByCompanyTeam(
    allSections,
    staffCompanyId,
  ).map((s) => s.id);
  let sendToSectionIds = companySectionIds;
  if (viewerScope.sectionIds.length === 0) {
    // Match Group Board: Admins must be placed on the org chart.
    return personal ?? { id: "__none__" };
  }
  const allowed = new Set(viewerScope.sectionIds);
  sendToSectionIds = companySectionIds.filter((id) => allowed.has(id));
  const clauses: Prisma.TicketWhereInput[] = [];
  if (sendToSectionIds.length > 0) {
    clauses.push({ orgChartSectionId: { in: sendToSectionIds } });
  }
  if (personal) clauses.push(personal);
  if (clauses.length === 0) return { id: "__none__" };
  return { OR: clauses };
}

async function buildTicketWhere(session: Session, query: string): Promise<Prisma.TicketWhereInput | null> {
  const q = query.trim();
  if (!q) return null;

  const role = session.user.role;
  const operator = await findSessionAgentWithTeam({ email: session.user.email, name: session.user.name });
  const staffCompanyId = await resolveStaffCompanyTeamId(session.user.email);
  const companyAdminPrivileges = await portalCompanyAdminPrivilegesForEmail(session.user.email);

  const searchOr: Prisma.TicketWhereInput[] = [
    { ticketNumber: { contains: q, mode: "insensitive" } },
    { title: { contains: q, mode: "insensitive" } },
    { contactName: { contains: q, mode: "insensitive" } },
    { contactEmail: { contains: q, mode: "insensitive" } },
  ];

  const whereBase: Prisma.TicketWhereInput = {};

  if (roleUsesOrgChartSectionBoardScope(role)) {
    const sectionScope = await sectionScopedTicketWhere({
      email: session.user.email,
      agentId: operator?.id,
    });
    whereBase.AND = [sectionScope, { OR: searchOr }];
    return whereBase;
  }

  if (role === "Admin") {
    const groupScope = await adminGroupBoardTicketWhere({
      email: session.user.email,
      agentId: operator?.id,
    });
    whereBase.AND = [groupScope, { OR: searchOr }];
    return whereBase;
  }

  if (role === "Personnel") {
    const sectionScope = await sectionScopedTicketWhere({
      email: session.user.email,
      agentId: operator?.id,
    });
    whereBase.AND = [sectionScope, { OR: searchOr }];
    return whereBase;
  }

  if (isElevatedUserRole(role)) {
    const rosterTeams = sortByRosterOrder(
      await prisma.team.findMany({
        where: rosterTeamNameFilter(),
        select: { id: true, name: true },
      }),
    );
    const teamIds = rosterTeams.map((t) => t.id);
    whereBase.teamId = teamIds.length > 0 ? { in: teamIds } : { in: ["__none__"] };
  } else if (companyAdminPrivileges) {
    if (!staffCompanyId) return null;
    Object.assign(
      whereBase,
      await adminGroupBoardTicketWhere({
        email: session.user.email,
        agentId: operator?.id,
      }),
    );
  } else {
    return null;
  }

  whereBase.OR = searchOr;
  return whereBase;
}

async function searchTickets(session: Session, query: string, limit: number): Promise<GlobalSearchResult[]> {
  const where = await buildTicketWhere(session, query);
  if (!where) return [];
  const rows = await prisma.ticket.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: limit,
    select: {
      id: true,
      ticketNumber: true,
      title: true,
      status: true,
      requestType: true,
      contactName: true,
    },
  });
  return rows.map((row) => ({
    id: `ticket-${row.id}`,
    kind: "ticket" as const,
    title: row.title?.trim() || row.ticketNumber,
    subtitle: `${row.ticketNumber}${row.contactName ? ` · ${row.contactName}` : ""}`,
    href: `/agent/tickets/${row.id}`,
    status: row.status.replaceAll("_", " "),
    requestType: row.requestType ?? undefined,
    badge: requestTypeAcronym(row.requestType),
  }));
}

async function searchTasks(
  session: Session,
  query: string,
  limit: number,
  operatorId: string | null,
  canAssignWork: boolean,
  companyTeamId: string | null,
): Promise<GlobalSearchResult[]> {
  const q = query.trim();
  if (!q) return [];

  let where: Prisma.KpiMaintenanceWhereInput = canAssignWork ? {} : {};
  let sectionAgentIds: Set<string> | null = null;

  if (canAssignWork && roleUsesCompanyDepartmentTaskAssignScope(session.user.role)) {
    const companyId = companyTeamId ?? (await resolveStaffCompanyTeamId(session.user.email));
    const sectionScope = await resolveViewerOrgChartSectionScope(session.user.email);
    if (sectionScope.agentIds.length === 0 && !companyId) return [];
    sectionAgentIds = new Set(sectionScope.agentIds);
    const companyAgents = companyId
      ? new Set(await loadAgentIdsForCompanyTeam(companyId))
      : null;
    const allowed =
      companyAgents && sectionAgentIds.size > 0
        ? [...sectionAgentIds].filter((id) => companyAgents.has(id))
        : companyAgents
          ? [...companyAgents]
          : [...sectionAgentIds];
    if (allowed.length === 0) return [];
    sectionAgentIds = new Set(allowed);
    where = { assignedAgentId: { in: allowed } };
  } else if (canAssignWork && companyTeamId) {
    const agentIds = await loadAgentIdsForCompanyTeam(companyTeamId);
    const companyScopeOr: Prisma.KpiMaintenanceWhereInput[] = [
      { assignedAgentId: null, scopedCompanyTeamId: companyTeamId },
    ];
    if (agentIds.length > 0) companyScopeOr.unshift({ assignedAgentId: { in: agentIds } });
    where = { AND: [where, { OR: companyScopeOr }] };
  } else if (canAssignWork && !isElevatedUserRole(session.user.role)) {
    // Non-elevated assigners without a company/section lock must not see all tasks.
    return [];
  }

  const rows = await prisma.kpiMaintenance.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: 80,
    select: {
      id: true,
      title: true,
      mainTask: true,
      assignedAgentId: true,
      subKpis: true,
      frequency: true,
    },
  });

  const filtered = rows.filter((row) => {
    if (sectionAgentIds && !kpiRowInSectionAgentScope(row, sectionAgentIds)) return false;
    if (!canAssignWork && operatorId) {
      const visible =
        row.assignedAgentId === operatorId || hasSubKpiAssignedTo(row.subKpis, operatorId);
      if (!visible) return false;
    }
    const label = kpiMainTaskLabel(row);
    return matchesQuery(`${row.title} ${label}`, q);
  });

  return filtered.slice(0, limit).map((row) => ({
    id: `task-${row.id}`,
    kind: "task" as const,
    title: kpiMainTaskLabel(row) || row.title,
    subtitle: row.title,
    href: `/agent/tasks?task=${encodeURIComponent(row.id)}`,
    badge: row.frequency.replaceAll("_", " "),
  }));
}

async function searchProjects(
  session: Session,
  query: string,
  limit: number,
  operatorId: string | null,
  canAssignWork: boolean,
  companyTeamId: string | null,
): Promise<GlobalSearchResult[]> {
  const tasks = await searchTasks(session, query, limit * 3, operatorId, canAssignWork, companyTeamId);
  if (tasks.length === 0) return [];

  const ids = tasks.map((t) => t.id.replace(/^task-/, ""));
  const rows = await prisma.kpiMaintenance.findMany({
    where: { id: { in: ids } },
    select: { id: true, title: true, mainTask: true, subKpis: true, frequency: true },
  });
  const projectIds = new Set(
    rows.filter((row) => isItProjectEnvelope(row.subKpis)).map((row) => row.id),
  );

  return tasks
    .filter((t) => projectIds.has(t.id.replace(/^task-/, "")))
    .slice(0, limit)
    .map((row) => ({
      ...row,
      id: row.id.replace(/^task-/, "project-"),
      kind: "project" as const,
      badge: "PROJECT",
    }));
}

async function searchTravelOrders(
  session: Session,
  query: string,
  limit: number,
  operatorId: string | null,
  allVisible: boolean,
  gatePassOnly: boolean,
  companyTeamId: string | null,
): Promise<GlobalSearchResult[]> {
  const q = query.trim();
  if (!q) return [];
  if (!operatorId && !allVisible) return [];

  const rows = await findTravelOrdersVisibleToAgent({
    companyTeamId,
    agentId: operatorId,
    gatePassOnly,
    allVisible,
  });

  return rows
    .filter((row) => {
      const label = `${row.orderRequest} ${row.kpiMainTask ?? ""} ${row.kpiTitle ?? ""}`;
      return matchesQuery(label, q);
    })
    .slice(0, limit)
    .map((row) => {
      const dto = serializeTravelOrder(row);
      return {
        id: `travel-${dto.id}`,
        kind: "travel_order" as const,
        title: dto.orderRequest?.trim() || dto.kpiMainTask || "Travel Order",
        subtitle: dto.kpiMainTask || dto.kpiTitle || undefined,
        href: dto.kpiMaintenanceId
          ? `/agent/tasks?task=${encodeURIComponent(dto.kpiMaintenanceId)}`
          : "/travel-orders",
        status: dto.status,
        badge: "T.O.",
      };
    });
}

async function searchUsers(
  session: Session,
  query: string,
  limit: number,
  companyTeamId: string | null,
): Promise<GlobalSearchResult[]> {
  const q = query.trim();
  if (!q) return [];
  const role = session.user.role;
  if (role !== "SuperAdmin" && role !== "HighAdmin" && role !== "Admin") return [];

  const staff = await loadHrisAssignableStaff({
    companyTeamId: isElevatedUserRole(role) ? null : companyTeamId,
  });

  return staff
    .filter((person) => matchesQuery(`${person.name} ${person.email} ${person.teamLabel}`, q))
    .slice(0, limit)
    .map((person) => ({
      id: `user-${person.agentId}`,
      kind: "user" as const,
      title: person.name,
      subtitle: [person.teamLabel, person.email].filter(Boolean).join(" · "),
      href: `/admin/workforce?q=${encodeURIComponent(person.name)}`,
      badge: person.portalRole ?? "STAFF",
    }));
}

export async function runGlobalSearch(
  session: Session,
  query: string,
  opts?: { limit?: number },
): Promise<GlobalSearchResult[]> {
  const q = query.trim();
  if (!q || q.length < 2) return [];

  const limit = Math.min(Math.max(opts?.limit ?? MAX_TOTAL, 1), 20);
  const perKind = {
    ticket: Math.min(4, limit),
    task: Math.min(2, limit),
    travel: Math.min(2, limit),
    user: Math.min(2, limit),
    project: Math.min(1, limit),
  };

  const perms = await resolveOpsPermissions(session);
  const operatorId = perms.operator?.id ?? null;
  const gatePassOnly = isPersonnelGuardPortalRole(session.user.role);
  const allVisible = !operatorId && isElevatedUserRole(session.user.role);
  const companyTeamId = gatePassOnly
    ? null
    : operatorId
      ? await resolveAgentDesignatedCompanyId(operatorId)
      : null;

  const companyAdminPrivileges = await portalCompanyAdminPrivilegesForEmail(session.user.email);
  const canSearchTickets =
    isElevatedUserRole(session.user.role) ||
    session.user.role === "Admin" ||
    session.user.role === "Personnel" ||
    companyAdminPrivileges;

  const canSearchTasks =
    session.user.role === "Admin" ||
    session.user.role === "Personnel" ||
    isElevatedUserRole(session.user.role);

  const [tickets, tasks, travelOrders, users, projects] = await Promise.all([
    canSearchTickets ? searchTickets(session, q, perKind.ticket) : Promise.resolve([]),
    canSearchTasks
      ? searchTasks(session, q, perKind.task, operatorId, perms.canAssignWork, companyTeamId)
      : Promise.resolve([]),
    searchTravelOrders(session, q, perKind.travel, operatorId, allVisible, gatePassOnly, companyTeamId),
    searchUsers(session, q, perKind.user, companyTeamId),
    canSearchTasks
      ? searchProjects(session, q, perKind.project, operatorId, perms.canAssignWork, companyTeamId)
      : Promise.resolve([]),
  ]);

  const merged = [...tickets, ...tasks, ...travelOrders, ...projects, ...users];
  return merged.slice(0, limit);
}
