import { isElevatedUserRole } from "@/lib/auth";
import type { Prisma, TicketPriority, TicketStatus } from "@prisma/client/primary";
import type { Session } from "next-auth";
import { ACTIVE_REQUEST_STATUSES, OPEN_PIPELINE_STATUSES } from "@/lib/active-request-statuses";
import { companyHasLocalLogo } from "@/lib/company-logo";
import { rosterTeamNameFilter, sortByRosterOrder } from "@/lib/company-roster";
import { ensureOutsideCompanyTeam } from "@/lib/outside-company-team";
import { ensureRosterTeamsInDb } from "@/lib/roster-teams";
import { prisma } from "@/lib/prisma";
import { findSessionAgentWithTeam } from "@/lib/session-agent";
import { portalCompanyAdminPrivilegesForEmail } from "@/lib/portal-staff";
import { resolveStaffCompanyTeamId } from "@/lib/staff-company-scope";
import { loadStaffAssignmentColorsForAgents } from "@/lib/assignee-assignment-color";
import {
  collectOrgChartSectionDescendantIds,
  filterOrgChartSectionsByCompanyTeam,
  orgChartMajorDepartments,
  orgChartRootSectionId,
  orgChartScopeRootDepartments,
  orgChartSectionCompanyTeamId,
  type OrgChartSectionOption,
} from "@/lib/org-chart-section-display";
import { listOrgChartSectionOptions } from "@/lib/org-chart-section-roster";
import { resolveMergedSourceUserIdForSessionEmail } from "@/lib/approval-position-resolver";
import {
  resolveOrgChartDownlineScopeForMergedUser,
  resolveViewerOrgChartSectionScope,
} from "@/lib/org-chart-section-scope";
import {
  applyGroupBoardDirectionFilters,
  type GroupBoardDirectionFilter,
} from "@/lib/group-board-direction-filters";

function mergeTeamWhereWithRoster(base?: Prisma.TeamWhereInput): Prisma.TeamWhereInput {
  const roster = rosterTeamNameFilter();
  if (!base) return roster;
  return { AND: [base, roster] };
}

/**
 * Companies linked to an org-chart department scope: section companyTeamId
 * (walking parents) plus staff designated companies of people in those sections.
 */
async function resolveCompanyTeamIdsForOrgChartSections(
  sectionIds: string[],
): Promise<string[]> {
  const ids = [...new Set(sectionIds.map((s) => s.trim()).filter(Boolean))];
  if (ids.length === 0) return [];

  const [sections, memberships, headed] = await Promise.all([
    prisma.orgChartSection.findMany({
      select: { id: true, parentId: true, companyTeamId: true, headNodeId: true },
    }),
    prisma.orgChartNodeSectionMembership.findMany({
      where: { sectionId: { in: ids } },
      select: { nodeId: true },
    }),
    prisma.orgChartSection.findMany({
      where: { id: { in: ids }, headNodeId: { not: null } },
      select: { headNodeId: true },
    }),
  ]);

  const companyIds = new Set<string>();
  for (const sid of ids) {
    const teamId = orgChartSectionCompanyTeamId(sections, sid);
    if (teamId) companyIds.add(teamId);
  }

  const nodeIds = new Set<string>();
  for (const m of memberships) nodeIds.add(m.nodeId);
  for (const h of headed) {
    if (h.headNodeId) nodeIds.add(h.headNodeId);
  }

  if (nodeIds.size > 0) {
    const nodes = await prisma.orgChartNode.findMany({
      where: { id: { in: [...nodeIds] } },
      select: { mergedSourceUserId: true },
    });
    const mergedBigints: bigint[] = [];
    for (const n of nodes) {
      const key = (n.mergedSourceUserId ?? "").trim();
      if (!key || !/^\d+$/.test(key)) continue;
      try {
        mergedBigints.push(BigInt(key));
      } catch {
        /* ignore */
      }
    }
    if (mergedBigints.length > 0) {
      const portals = await prisma.portalAccount.findMany({
        where: { mergedSourceUserId: { in: mergedBigints } },
        select: { staffDesignatedCompanyId: true },
      });
      for (const portal of portals) {
        if (portal.staffDesignatedCompanyId) companyIds.add(portal.staffDesignatedCompanyId);
      }
    }
  }

  if (companyIds.size === 0) return [];
  const roster = await prisma.team.findMany({
    where: { AND: [rosterTeamNameFilter(), { id: { in: [...companyIds] } }] },
    select: { id: true },
  });
  return roster.map((t) => t.id);
}

export type CompanyBoardCardMode = "staff" | "personnel";

export type CompanyBucketId = "unassigned" | "in_progress" | "for_confirmation" | "closed";

export type CompanyTicketCard = {
  id: string;
  ticketNumber: string;
  title: string;
  description: string;
  status: TicketStatus;
  priority: TicketPriority;
  updatedAt: Date;
  assignedAgentId: string | null;
  assignedAgentName: string | null;
  /** Portal registry rainbow tag for assigned staff (Admin/Personnel). */
  assigneeColorKey: string | null;
};

export type CompanyBoardColumn = {
  teamId: string;
  companyName: string;
  cardMode: CompanyBoardCardMode;
  /** True when a logo path or inlined image is stored for this company. */
  hasLogo: boolean;
  buckets: Record<CompanyBucketId, CompanyTicketCard[]>;
  /** company = Team card; department = org-chart section card. */
  entityKind?: "company" | "department";
  /** Department cards: true when this section has nested sub-departments. */
  canDrillDown?: boolean;
  /** Company team used for logos when entityKind is department (optional). */
  logoTeamId?: string | null;
};

export type DepartmentBoardBreadcrumb = { id: string; name: string };

const PERSONNEL_STATUS_FILTER: TicketStatus[] = ACTIVE_REQUEST_STATUSES;

function awaitingCustomer(status: TicketStatus) {
  return status === "FOR_CONFIRMATION" || status === "RESOLVED";
}

function bucketFor(t: CompanyTicketCard): CompanyBucketId {
  if (t.status === "CLOSED") return "closed";
  if (awaitingCustomer(t.status)) return "for_confirmation";
  if (!t.assignedAgentId) return "unassigned";
  return "in_progress";
}

function emptyBuckets(): Record<CompanyBucketId, CompanyTicketCard[]> {
  return { unassigned: [], in_progress: [], for_confirmation: [], closed: [] };
}

const CLOSED_CAP = 14;

type CompanyBoardScopeOpts = {
  session: Session;
  searchQuery?: string;
  priorityFilter?: TicketPriority | "ALL";
  companyTeamIds?: string[];
  requestTypeFilter?: string | "ALL";
  /** Group Board: requestor company/department filter. */
  sentByFilter?: GroupBoardDirectionFilter | null;
  /** Group Board: send-to company/department filter. */
  receivedFilter?: GroupBoardDirectionFilter | null;
};

type CompanyBoardScope =
  | {
      ok: true;
      cardMode: CompanyBoardCardMode;
      ticketWhereBase: Prisma.TicketWhereInput;
      displayTeamIds: string[];
      teams: { id: string; name: string; hasLogo: boolean }[];
      groupByRequestor: boolean;
      excludedTeamIds: string[];
      outsideId: string;
      /** Admin Group Board: bucket tickets under send-to company, not requestor roster. */
      scopeBySendToCompany: boolean;
      sendToCompanyTeamId: string | null;
      /**
       * When set (Admin with org-chart membership), tickets/columns are limited to
       * these section ids (membership + descendants ∩ company sections).
       */
      restrictSectionIds: string[] | null;
    }
  | { ok: false; cardMode: CompanyBoardCardMode; emptyHint: string | null };

async function resolveCompanyBoardScope(opts: CompanyBoardScopeOpts): Promise<CompanyBoardScope> {
  await ensureRosterTeamsInDb();
  const { session, searchQuery, priorityFilter, companyTeamIds, requestTypeFilter, sentByFilter, receivedFilter } =
    opts;
  const q = (searchQuery ?? "").trim();
  const role = session.user.role;
  const companyAdminPrivileges = await portalCompanyAdminPrivilegesForEmail(session.user.email);
  const operator = await findSessionAgentWithTeam({ email: session.user.email, name: session.user.name });
  const staffCompanyId = await resolveStaffCompanyTeamId(session.user.email);
  const outsideTeamRow = await ensureOutsideCompanyTeam();

  const cardMode: CompanyBoardCardMode =
    isElevatedUserRole(role) || role === "Admin" || companyAdminPrivileges ? "staff" : "personnel";

  const isAdminScope = !isElevatedUserRole(role) && (role === "Admin" || companyAdminPrivileges);
  /** HighAdmin Group Board: companies from report-to depts; dept view = those depts only. */
  const isHighAdminGroupScope = role === "HighAdmin";

  let teamWhere: Prisma.TeamWhereInput | undefined;
  let excludedTeamIds: string[] = [];
  let scopeBySendToCompany = false;
  let sendToCompanyTeamId: string | null = null;
  /** Pre-resolved HighAdmin downline — applied after teams load. */
  let highAdminRestrictSectionIds: string[] | null = null;
  let highAdminCompanyTeamIds: string[] | null = null;

  if (role === "SuperAdmin") {
    teamWhere = undefined;
  } else if (isHighAdminGroupScope) {
    const mergedId = await resolveMergedSourceUserIdForSessionEmail(session.user.email);
    const downline = await resolveOrgChartDownlineScopeForMergedUser(mergedId);
    if (downline.sectionIds.length === 0) {
      return {
        ok: false,
        cardMode,
        emptyHint:
          "No departments report to you on the org chart. Ask a SuperAdmin to set department Reports-to.",
      };
    }
    const companyIds = await resolveCompanyTeamIdsForOrgChartSections(downline.sectionIds);
    if (companyIds.length === 0) {
      return {
        ok: false,
        cardMode,
        emptyHint:
          "Departments that report to you have no linked companies yet. Set company on those departments or staff designated companies.",
      };
    }
    highAdminRestrictSectionIds = downline.sectionIds;
    highAdminCompanyTeamIds = companyIds;
    teamWhere = { id: { in: companyIds } };
    excludedTeamIds = [];
  } else if (isAdminScope) {
    if (!staffCompanyId) {
      return {
        ok: false,
        cardMode,
        emptyHint:
          "Set a designated company for your account to view the group board.",
      };
    }
    /** Admin Group Board: one company card; tickets filtered by send-to department tree. */
    teamWhere = { id: staffCompanyId };
    excludedTeamIds = [];
    scopeBySendToCompany = true;
    sendToCompanyTeamId = staffCompanyId;
  } else if (role === "Personnel") {
    if (!operator?.teamId) {
      return {
        ok: false,
        cardMode,
        emptyHint:
          cardMode === "personnel"
            ? "Your account is not linked to a company roster yet. Ask an administrator to assign you in Personnel registry."
            : null,
      };
    }
    teamWhere =
      operator.teamId === outsideTeamRow.id
        ? { id: operator.teamId }
        : { id: { in: [operator.teamId, outsideTeamRow.id] } };
  } else {
    return { ok: false, cardMode, emptyHint: null };
  }

  const mergedTeamWhere = mergeTeamWhereWithRoster(teamWhere);
  const selectedIds = (companyTeamIds ?? []).map((s) => s.trim()).filter(Boolean);
  const selectedNonAll = selectedIds.filter((s) => s !== "ALL");
  const filterBySpecificCompany = selectedNonAll.length > 0;

  const teamsRaw = sortByRosterOrder(
    await prisma.team.findMany({
      where: mergedTeamWhere,
      select: { id: true, name: true },
    }),
  );

  // Logo columns may exist before Prisma client is regenerated — use raw SQL.
  const logoRows =
    teamsRaw.length > 0
      ? await prisma.$queryRawUnsafe<{ id: string; has_logo: boolean }[]>(
          `SELECT id,
                  (COALESCE(NULLIF(TRIM(logo_path), ''), NULL) IS NOT NULL
                   OR COALESCE(NULLIF(TRIM(logo_image), ''), NULL) IS NOT NULL) AS has_logo
           FROM teams
           WHERE id = ANY($1::text[])`,
          teamsRaw.map((t) => t.id),
        )
      : [];
  const hasLogoById = new Map(logoRows.map((r) => [r.id, Boolean(r.has_logo)]));
  const teams = teamsRaw.map((t) => ({
    ...t,
    hasLogo: companyHasLocalLogo(t.name) || (hasLogoById.get(t.id) ?? false),
  }));

  const ticketWhereBase: Prisma.TicketWhereInput = {};
  if (priorityFilter && priorityFilter !== "ALL" && cardMode === "staff") {
    ticketWhereBase.priority = priorityFilter;
  }
  if (requestTypeFilter && requestTypeFilter !== "ALL") {
    ticketWhereBase.requestType = requestTypeFilter;
  }
  if (q) {
    ticketWhereBase.AND = [
      {
        OR: [
          { ticketNumber: { contains: q, mode: "insensitive" } },
          { title: { contains: q, mode: "insensitive" } },
          { contactName: { contains: q, mode: "insensitive" } },
          { contactEmail: { contains: q, mode: "insensitive" } },
        ],
      },
    ];
  }
  if (cardMode === "personnel") {
    ticketWhereBase.status = { in: PERSONNEL_STATUS_FILTER };
    ticketWhereBase.assignedAgentId = operator?.id ?? "__none__";
  }

  await applyGroupBoardDirectionFilters(ticketWhereBase, {
    sentBy: sentByFilter ?? null,
    received: receivedFilter ?? null,
  });

  if (highAdminRestrictSectionIds && highAdminCompanyTeamIds) {
    ticketWhereBase.OR = [{ orgChartSectionId: { in: highAdminRestrictSectionIds } }];
    const allowedTeamIds = teams.map((t) => t.id);
    const displayTeamIds = highAdminCompanyTeamIds.filter((id) => allowedTeamIds.includes(id));
    if (displayTeamIds.length === 0) {
      return {
        ok: false,
        cardMode,
        emptyHint:
          "Departments that report to you have no linked companies yet. Set company on those departments or staff designated companies.",
      };
    }
    // Optional company filter from the UI still applies within HighAdmin scope.
    const filteredDisplay =
      filterBySpecificCompany
        ? displayTeamIds.filter((id) => selectedNonAll.includes(id))
        : displayTeamIds;
    if (filterBySpecificCompany && filteredDisplay.length === 0) {
      return { ok: false, cardMode, emptyHint: "No matching company filter in your scope." };
    }
    return {
      ok: true,
      cardMode,
      ticketWhereBase,
      displayTeamIds: filteredDisplay,
      teams,
      groupByRequestor: false,
      excludedTeamIds,
      outsideId: outsideTeamRow.id,
      scopeBySendToCompany: false,
      sendToCompanyTeamId: null,
      restrictSectionIds: highAdminRestrictSectionIds,
    };
  }

  if (scopeBySendToCompany && sendToCompanyTeamId) {
    let restrictSectionIds: string[] | null = null;
    let sendToSectionIds: string[] = [];

    const viewerScope = await resolveViewerOrgChartSectionScope(session.user.email);

    if (viewerScope.sectionIds.length > 0) {
      // Same rule as Assign Requests: department membership is the primary gate.
      // Do not intersect with section.companyTeamId — many live sections are unlinked
      // and that emptied Group Board for department heads (e.g. NEO / Accounting).
      restrictSectionIds = viewerScope.sectionIds;
      sendToSectionIds = viewerScope.sectionIds;
    } else if (isAdminScope) {
      return {
        ok: false,
        cardMode,
        emptyHint:
          "Your account is not placed on the org chart. Ask a SuperAdmin to assign your department.",
      };
    } else {
      const allSections = await listOrgChartSectionOptions();
      sendToSectionIds = filterOrgChartSectionsByCompanyTeam(
        allSections,
        sendToCompanyTeamId,
      ).map((s) => s.id);
    }

    const sendToClauses: Prisma.TicketWhereInput[] = [];
    if (sendToSectionIds.length > 0) {
      sendToClauses.push({ orgChartSectionId: { in: sendToSectionIds } });
    }
    // Company-level tickets with no department only for elevated/unscoped admins.
    if (!restrictSectionIds) {
      sendToClauses.push({ teamId: sendToCompanyTeamId, orgChartSectionId: null });
    }
    if (sendToClauses.length === 0) {
      return {
        ok: false,
        cardMode,
        emptyHint:
          "No requests in your designated department yet. Your Group Board is limited to your org-chart department tree.",
      };
    }
    ticketWhereBase.OR = sendToClauses;

    const allowedTeamIds = teams.map((t) => t.id);

    let displayTeamIds: string[];
    if (allowedTeamIds.includes(sendToCompanyTeamId)) {
      displayTeamIds = [sendToCompanyTeamId];
    } else {
      return {
        ok: false,
        cardMode,
        emptyHint: "Your designated company is not on the roster.",
      };
    }

    const groupByRequestor = false;
    // When department-scoped, do not also require ticket.teamId === designated company.
    // Send-to department tickets often live on another company team.
    if (!restrictSectionIds) {
      ticketWhereBase.teamId =
        displayTeamIds.length > 0 ? { in: displayTeamIds } : { in: ["__none__"] };
    }

    return {
      ok: true,
      cardMode,
      ticketWhereBase,
      displayTeamIds,
      teams,
      groupByRequestor,
      excludedTeamIds,
      outsideId: outsideTeamRow.id,
      scopeBySendToCompany,
      sendToCompanyTeamId,
      restrictSectionIds,
    };
  }

  const allowedTeamIds = teams.map((t) => t.id);
  const selectedFilterTeamIds =
    selectedNonAll.length > 0
      ? selectedNonAll.filter((id) => allowedTeamIds.includes(id))
      : [];

  let displayTeamIds: string[];
  if (isAdminScope) {
    const baseDisplay = allowedTeamIds.filter((id) => !excludedTeamIds.includes(id));
    displayTeamIds = filterBySpecificCompany
      ? baseDisplay.filter((id) => selectedFilterTeamIds.includes(id))
      : baseDisplay;
    if (filterBySpecificCompany && displayTeamIds.length === 0) {
      return { ok: false, cardMode, emptyHint: "No matching company filter in your scope." };
    }
  } else if (filterBySpecificCompany) {
    if (selectedFilterTeamIds.length === 0) {
      return { ok: false, cardMode, emptyHint: "No matching company filter in your scope." };
    }
    displayTeamIds = selectedFilterTeamIds.filter((id) => allowedTeamIds.includes(id));
    ticketWhereBase.teamId = { in: selectedFilterTeamIds };
  } else {
    displayTeamIds = allowedTeamIds;
  }

  const groupByRequestor = isAdminScope || filterBySpecificCompany;

  if (!groupByRequestor) {
    ticketWhereBase.teamId =
      displayTeamIds.length > 0 ? { in: displayTeamIds } : { in: ["__none__"] };
  }

  return {
    ok: true,
    cardMode,
    ticketWhereBase,
    displayTeamIds,
    teams,
    groupByRequestor,
    excludedTeamIds,
    outsideId: outsideTeamRow.id,
    scopeBySendToCompany,
    sendToCompanyTeamId,
    restrictSectionIds: null,
  };
}

/** Counts cards actually placed on the board (includes capped closed cards). */
export function summarizeCompanyBoardColumns(columns: CompanyBoardColumn[]): {
  total: number;
  critical: number;
  openPipeline: number;
  slaEscalated: number;
} {
  let total = 0;
  let critical = 0;
  let openPipeline = 0;
  let slaEscalated = 0;
  for (const col of columns) {
    for (const cards of Object.values(col.buckets)) {
      for (const t of cards) {
        total += 1;
        if (t.priority === "URGENT") critical += 1;
        if ((OPEN_PIPELINE_STATUSES as TicketStatus[]).includes(t.status)) {
          openPipeline += 1;
        }
        if (t.status === "ESCALATED") slaEscalated += 1;
      }
    }
  }
  return { total, critical, openPipeline, slaEscalated };
}

export async function loadCompanyBoard(opts: CompanyBoardScopeOpts): Promise<{
  columns: CompanyBoardColumn[];
  cardMode: CompanyBoardCardMode;
  emptyHint: string | null;
}> {
  const scope = await resolveCompanyBoardScope(opts);
  if (!scope.ok) {
    return { columns: [], cardMode: scope.cardMode, emptyHint: scope.emptyHint };
  }

  const {
    cardMode,
    ticketWhereBase,
    displayTeamIds,
    teams,
    groupByRequestor,
    excludedTeamIds,
    outsideId,
    scopeBySendToCompany,
    sendToCompanyTeamId,
    restrictSectionIds,
  } = scope;
  const teamById = new Map(teams.map((t) => [t.id, t]));

  const sectionCompanyById = new Map<string, string>();
  if (restrictSectionIds && restrictSectionIds.length > 0) {
    const allSections = await listOrgChartSectionOptions();
    for (const sid of restrictSectionIds) {
      const companyId = orgChartSectionCompanyTeamId(allSections, sid);
      if (companyId) sectionCompanyById.set(sid, companyId);
    }
  }

  const rawTickets = await prisma.ticket.findMany({
    where: ticketWhereBase,
    orderBy: { updatedAt: "desc" },
    take: 800,
    select: {
      id: true,
      teamId: true,
      orgChartSectionId: true,
      ticketNumber: true,
      title: true,
      description: true,
      status: true,
      priority: true,
      updatedAt: true,
      assignedAgentId: true,
      assignedAgent: { select: { name: true, email: true } },
      requestorEmail: true,
      contactEmail: true,
    },
  });
  const assigneeColorByEmail = await loadStaffAssignmentColorsForAgents(
    rawTickets.map((x) => ({ email: x.assignedAgent?.email, name: x.assignedAgent?.name })),
  );
  const requestorEmails = Array.from(
    new Set(
      rawTickets
        .map((x) => (x.requestorEmail?.trim() || x.contactEmail?.trim() || "").toLowerCase())
        .filter(Boolean),
    ),
  );
  const requestorAccounts =
    requestorEmails.length > 0
      ? await prisma.portalAccount.findMany({
          where: { email: { in: requestorEmails } },
          select: {
            email: true,
            companyId: true,
            staffDesignatedCompanyId: true,
          },
        })
      : [];
  const requestorCompanyByEmail = new Map<string, string>();
  for (const a of requestorAccounts) {
    const e = a.email.trim().toLowerCase();
    const cid = a.companyId ?? a.staffDesignatedCompanyId ?? null;
    if (e && cid) requestorCompanyByEmail.set(e, cid);
  }

  const columnsByTeam = new Map<string, CompanyBoardColumn>();
  for (const t of teams) {
    if (!displayTeamIds.includes(t.id)) continue;
    columnsByTeam.set(t.id, {
      teamId: t.id,
      companyName: t.name,
      cardMode,
      hasLogo: t.hasLogo,
      entityKind: "company",
      canDrillDown: false,
      buckets: emptyBuckets(),
    });
  }

  const seenTicketIds = new Set<string>();

  for (const x of rawTickets) {
    if (seenTicketIds.has(x.id)) continue;

    let teamIdForColumn: string | null;
    if (groupByRequestor) {
      const email = (x.requestorEmail?.trim() || x.contactEmail?.trim() || "").toLowerCase();
      const requestorCompanyId = email ? requestorCompanyByEmail.get(email) : undefined;
      if (requestorCompanyId && !excludedTeamIds.includes(requestorCompanyId)) {
        teamIdForColumn = requestorCompanyId;
        if (!displayTeamIds.includes(teamIdForColumn) && displayTeamIds.includes(outsideId)) {
          teamIdForColumn = outsideId;
        } else if (!displayTeamIds.includes(teamIdForColumn)) {
          continue;
        }
      } else if (displayTeamIds.includes(outsideId)) {
        teamIdForColumn = outsideId;
      } else {
        continue;
      }
    } else if (scopeBySendToCompany && sendToCompanyTeamId) {
      teamIdForColumn = sendToCompanyTeamId;
    } else if (restrictSectionIds && restrictSectionIds.length > 0) {
      // HighAdmin (and similar): place under ticket company when in scope, else
      // the send-to department's linked company.
      if (x.teamId && displayTeamIds.includes(x.teamId)) {
        teamIdForColumn = x.teamId;
      } else {
        const sectionId = (x.orgChartSectionId ?? "").trim();
        const fromSection = sectionId ? sectionCompanyById.get(sectionId) : undefined;
        teamIdForColumn =
          fromSection && displayTeamIds.includes(fromSection) ? fromSection : null;
      }
    } else {
      teamIdForColumn = x.teamId;
    }

    if (!teamIdForColumn || !displayTeamIds.includes(teamIdForColumn)) continue;
    const team = teamById.get(teamIdForColumn);
    if (!team) continue;
    const col = columnsByTeam.get(team.id);
    if (!col) continue;

    const assigneeEmail = x.assignedAgent?.email?.trim().toLowerCase();
    const assigneeColorKey = assigneeEmail ? (assigneeColorByEmail.get(assigneeEmail) ?? null) : null;
    const card: CompanyTicketCard = {
      id: x.id,
      ticketNumber: x.ticketNumber,
      title: x.title,
      description: x.description,
      status: x.status,
      priority: x.priority,
      updatedAt: x.updatedAt,
      assignedAgentId: x.assignedAgentId,
      assignedAgentName: x.assignedAgent?.name ?? null,
      assigneeColorKey,
    };
    const b = bucketFor(card);
    if (b === "closed" && col.buckets.closed.length >= CLOSED_CAP) continue;
    col.buckets[b].push(card);
    seenTicketIds.add(x.id);
  }

  const columns = teams
    .map((t) => columnsByTeam.get(t.id))
    .filter((c): c is CompanyBoardColumn => Boolean(c));

  return {
    columns,
    cardMode,
    emptyHint: columns.length === 0 ? "No companies found for your account." : null,
  };
}

function orgChartDirectChildren(
  sections: OrgChartSectionOption[],
  parentId: string,
): OrgChartSectionOption[] {
  return sections.filter((s) => s.parentId === parentId);
}

function sectionHasChildren(
  sections: Array<Pick<OrgChartSectionOption, "id" | "parentId">>,
  sectionId: string,
): boolean {
  return sections.some((s) => s.parentId === sectionId);
}

/**
 * Department overview for Company Board: major departments (or children of
 * `parentSectionId`), with request counts rolled up from each section tree.
 */
export async function loadDepartmentBoard(
  opts: CompanyBoardScopeOpts & { parentSectionId?: string | null },
): Promise<{
  columns: CompanyBoardColumn[];
  cardMode: CompanyBoardCardMode;
  emptyHint: string | null;
  parentSection: DepartmentBoardBreadcrumb | null;
  breadcrumb: DepartmentBoardBreadcrumb[];
}> {
  const scope = await resolveCompanyBoardScope(opts);
  if (!scope.ok) {
    return {
      columns: [],
      cardMode: scope.cardMode,
      emptyHint: scope.emptyHint,
      parentSection: null,
      breadcrumb: [],
    };
  }

  const { cardMode, ticketWhereBase, displayTeamIds, restrictSectionIds } = scope;
  const allSections = await listOrgChartSectionOptions();
  const restrictSectionIdSet =
    restrictSectionIds && restrictSectionIds.length > 0
      ? new Set(restrictSectionIds)
      : null;

  const companyFilterIds = (opts.companyTeamIds ?? []).map((s) => s.trim()).filter(Boolean);
  const companyFilter =
    companyFilterIds.length > 0 && !companyFilterIds.includes("ALL")
      ? companyFilterIds[0]!
      : displayTeamIds.length === 1
        ? displayTeamIds[0]!
        : null;

  let sections = restrictSectionIdSet
    ? allSections.filter((s) => restrictSectionIdSet.has(s.id))
    : companyFilter
      ? filterOrgChartSectionsByCompanyTeam(allSections, companyFilter)
      : allSections;

  if (!restrictSectionIdSet && displayTeamIds.length > 0 && !companyFilter) {
    const allowed = new Set(displayTeamIds);
    sections = sections.filter((s) => {
      const team = s.companyTeamId;
      if (!team) return true;
      return allowed.has(team);
    });
  }

  if (restrictSectionIds && restrictSectionIds.length === 0) {
    return {
      columns: [],
      cardMode,
      emptyHint:
        "No departments in your org-chart scope. Ask a SuperAdmin to place you on the chart.",
      parentSection: null,
      breadcrumb: [],
    };
  }

  const parentId = (opts.parentSectionId ?? "").trim() || null;
  let columnSections: OrgChartSectionOption[] = [];
  let parentSection: DepartmentBoardBreadcrumb | null = null;
  const breadcrumb: DepartmentBoardBreadcrumb[] = [];

  if (parentId) {
    const parent = sections.find((s) => s.id === parentId) ?? allSections.find((s) => s.id === parentId);
    if (!parent) {
      return {
        columns: [],
        cardMode,
        emptyHint: "Department not found.",
        parentSection: null,
        breadcrumb: [],
      };
    }
    parentSection = { id: parent.id, name: parent.name };
    // Walk ancestors for breadcrumb (root → parent).
    const byId = new Map(allSections.map((s) => [s.id, s]));
    const chain: DepartmentBoardBreadcrumb[] = [];
    let cur: OrgChartSectionOption | undefined = parent;
    const seen = new Set<string>();
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      chain.unshift({ id: cur.id, name: cur.name });
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    breadcrumb.push(...chain);

    columnSections = orgChartDirectChildren(allSections, parent.id);
    if (restrictSectionIdSet) {
      columnSections = columnSections.filter((s) => restrictSectionIdSet.has(s.id));
    }
    // Include the parent as its own card for requests sent directly to it.
    columnSections = [parent, ...columnSections];
  } else {
    // Company-wide: major departments. Scoped viewers (e.g. sub-department heads):
    // tops of their membership tree so the sub shows as a Group Board column.
    columnSections =
      restrictSectionIds != null
        ? orgChartScopeRootDepartments(sections)
        : orgChartMajorDepartments(sections);
  }

  const columnsBySection = new Map<string, CompanyBoardColumn>();
  const treeIdsByColumn = new Map<string, Set<string>>();

  for (const section of columnSections) {
    const isParentSelfCard = Boolean(parentId && section.id === parentId);
    const treeIds = isParentSelfCard
      ? new Set([section.id])
      : collectOrgChartSectionDescendantIds(section.id, allSections);
    // When showing children under a parent, exclude the parent id from child trees
    // (parent has its own card for direct tickets only).
    if (parentId && section.id !== parentId) {
      treeIds.delete(parentId);
    }
    // Scope ticket rollups to sections the viewer is allowed to see.
    if (restrictSectionIdSet) {
      for (const id of [...treeIds]) {
        if (!restrictSectionIdSet.has(id)) treeIds.delete(id);
      }
    }
    treeIdsByColumn.set(section.id, treeIds);
    columnsBySection.set(section.id, {
      teamId: section.id,
      companyName: isParentSelfCard ? `${section.name} (direct)` : section.name,
      cardMode,
      hasLogo: false,
      logoTeamId: section.companyTeamId,
      entityKind: "department",
      // Use full chart for children detection so majors with nested subs always drill.
      canDrillDown: !isParentSelfCard && sectionHasChildren(allSections, section.id),
      buckets: emptyBuckets(),
    });
  }

  const rawTickets = await prisma.ticket.findMany({
    where: {
      ...ticketWhereBase,
      orgChartSectionId: { not: null },
    },
    orderBy: { updatedAt: "desc" },
    take: 800,
    select: {
      id: true,
      orgChartSectionId: true,
      ticketNumber: true,
      title: true,
      description: true,
      status: true,
      priority: true,
      updatedAt: true,
      assignedAgentId: true,
      assignedAgent: { select: { name: true, email: true } },
    },
  });

  const assigneeColorByEmail = await loadStaffAssignmentColorsForAgents(
    rawTickets.map((x) => ({ email: x.assignedAgent?.email, name: x.assignedAgent?.name })),
  );

  const sectionIdSet = new Set(sections.map((s) => s.id));
  const seenTicketIds = new Set<string>();

  for (const x of rawTickets) {
    if (seenTicketIds.has(x.id)) continue;
    const sectionId = (x.orgChartSectionId ?? "").trim();
    if (!sectionId || !sectionIdSet.has(sectionId)) continue;

    let columnId: string | null = null;
    if (parentId) {
      // Prefer deepest matching child column, else parent direct card.
      let bestDepth = -1;
      for (const [colId, treeIds] of treeIdsByColumn) {
        if (!treeIds.has(sectionId)) continue;
        const depth = sections.find((s) => s.id === colId)?.depth ?? 0;
        if (colId === parentId) {
          if (sectionId === parentId && columnId === null) columnId = parentId;
          continue;
        }
        if (depth >= bestDepth) {
          bestDepth = depth;
          columnId = colId;
        }
      }
      if (!columnId && sectionId === parentId) columnId = parentId;
      // Ticket under this major but not matching a listed child (deeper nested under
      // a child we already matched via tree) — walk to nearest column ancestor.
      if (!columnId) {
        let walk = sectionId;
        const byId = new Map(sections.map((s) => [s.id, s]));
        const seen = new Set<string>();
        while (walk && !seen.has(walk)) {
          seen.add(walk);
          if (columnsBySection.has(walk)) {
            columnId = walk;
            break;
          }
          walk = byId.get(walk)?.parentId ?? "";
        }
      }
    } else {
      const majorId = orgChartRootSectionId(sections, sectionId);
      if (columnsBySection.has(majorId)) columnId = majorId;
    }

    if (!columnId) continue;
    const col = columnsBySection.get(columnId);
    if (!col) continue;

    const assigneeEmail = x.assignedAgent?.email?.trim().toLowerCase();
    const assigneeColorKey = assigneeEmail ? (assigneeColorByEmail.get(assigneeEmail) ?? null) : null;
    const card: CompanyTicketCard = {
      id: x.id,
      ticketNumber: x.ticketNumber,
      title: x.title,
      description: x.description,
      status: x.status,
      priority: x.priority,
      updatedAt: x.updatedAt,
      assignedAgentId: x.assignedAgentId,
      assignedAgentName: x.assignedAgent?.name ?? null,
      assigneeColorKey,
    };
    const b = bucketFor(card);
    if (b === "closed" && col.buckets.closed.length >= CLOSED_CAP) continue;
    col.buckets[b].push(card);
    seenTicketIds.add(x.id);
  }

  const columns = columnSections
    .map((s) => columnsBySection.get(s.id))
    .filter((c): c is CompanyBoardColumn => Boolean(c));

  return {
    columns,
    cardMode,
    emptyHint:
      columns.length === 0
        ? parentId
          ? "No sub-departments under this department."
          : "No major departments found for this view."
        : null,
    parentSection,
    breadcrumb,
  };
}

/**
 * Active pipeline totals for the company board (excludes CLOSED).
 * Matches Request Board “active events” / Insights active requests for the same team scope.
 */
export async function getCompanyBoardAggregates(opts: CompanyBoardScopeOpts): Promise<{
  total: number;
  critical: number;
  openPipeline: number;
  slaEscalated: number;
}> {
  const empty = { total: 0, critical: 0, openPipeline: 0, slaEscalated: 0 };
  const scope = await resolveCompanyBoardScope(opts);
  if (!scope.ok) return empty;

  const activeWhere: Prisma.TicketWhereInput = {
    ...scope.ticketWhereBase,
    ...(scope.cardMode === "personnel"
      ? {}
      : { status: { in: ACTIVE_REQUEST_STATUSES } }),
  };

  const [total, critical, openPipeline, slaEscalated] = await Promise.all([
    prisma.ticket.count({ where: activeWhere }),
    prisma.ticket.count({ where: { ...activeWhere, priority: "URGENT" } }),
    prisma.ticket.count({
      where: { ...activeWhere, status: { in: OPEN_PIPELINE_STATUSES } },
    }),
    prisma.ticket.count({ where: { ...activeWhere, status: "ESCALATED" } }),
  ]);

  return { total, critical, openPipeline, slaEscalated };
}
