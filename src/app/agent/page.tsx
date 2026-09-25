import { isElevatedUserRole } from "@/lib/auth";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { TicketPriority, TicketStatus } from "@prisma/client/primary";
import { Prisma } from "@prisma/client/primary";
import { requireSession } from "@/lib/access";
import { rosterTeamNameFilter, sortByRosterOrder } from "@/lib/company-roster";
import { getCompanyBoardAggregates, loadCompanyBoard, loadDepartmentBoard } from "@/lib/company-board";
import { ACTIVE_REQUEST_STATUSES, OPEN_PIPELINE_STATUSES } from "@/lib/active-request-statuses";
import { loadTicketActivityLogForSession } from "@/lib/ticket-activity-log";
import { prisma } from "@/lib/prisma";
import { loadStaffAssignmentColorsForAgents } from "@/lib/assignee-assignment-color";
import { personnelAssigneeHighlightStyleFromKey } from "@/lib/personnel-assignment-colors";
import { portalCompanyAdminPrivilegesForEmail } from "@/lib/portal-staff";
import { resolveStaffCompanyTeamId } from "@/lib/staff-company-scope";
import { findSessionAgentWithTeam } from "@/lib/session-agent";
import {
  getOperatorActionableApprovalLevel,
  hasHierarchicalApprovals,
  travelOrderApprovedByLabel,
} from "@/lib/travel-order";
import { listPendingTravelApprovalsForAgent } from "@/lib/travel-order-db";
import { AgentTicketDeepLink } from "@/components/AgentTicketDeepLink";
import { AssigneeColorHighlight } from "@/components/ticket/AssigneeColorHighlight";
import { OrchestrationQueueNav } from "@/components/OrchestrationQueueNav";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BRAND_TITLE } from "@/lib/brand";
import { formatTicketPriorityLabel } from "@/lib/ticket-priority-label";
import { isRequestTypeId } from "@/lib/request-types";
import { visibleIntakeRequestTypes } from "@/lib/intake-request-type-visibility";
import { getIntakeRequestTypeVisibility } from "@/lib/intake-request-type-visibility-db";
import {
  listOrgChartSectionOptions,
  resolveAgentIdsForOrgChartSection,
} from "@/lib/org-chart-section-roster";
import {
  roleUsesOrgChartSectionBoardScope,
  sectionScopedTicketWhere,
  resolveViewerOrgChartSectionScope,
  resolveOrgChartDownlineScopeForMergedUser,
  ticketWhereForOrgChartSectionFilter,
} from "@/lib/org-chart-section-scope";
import {
  buildGroupBoardDirectionFilterOptions,
  encodeGroupBoardDirectionFilter,
  parseGroupBoardDirectionFilter,
} from "@/lib/group-board-direction-filters";
import { resolveMergedSourceUserIdForSessionEmail } from "@/lib/approval-position-resolver";
import { MyRequestsBoard } from "@/components/my-requests/MyRequestsBoard";
import { AgentKanban, type KanbanTicket } from "./agent-kanban";
import {
  RequestBoardEditModeProvider,
  RequestBoardManageToolbar,
} from "./request-board-edit-mode";
import {
  canManageRequestBoardColumns,
  listRequestBoardColumns,
  loadTicketForConfirmationEnteredAtMap,
  loadTicketLastActivityAtMap,
  requestBoardOwnerKey,
  resolveTicketBoardColumnId,
} from "@/lib/request-board-columns";
import { paymentProceduralStatusLabel, type PaymentApprovalMeta } from "@/lib/request-for-payment-approval";
import { loadPaymentApprovalMetaMap } from "@/lib/payment-approval-db";
import { loadAcaApprovalMetaMap } from "@/lib/aca-approval-db";
import { acaProceduralStatusLabel } from "@/lib/aca-approval";
import type { AcaApprovalMeta } from "@/lib/aca-approval";
import { personnelRequestBoardWhere } from "@/lib/rfp-request-board";
import {
  itemRequisitionProceduralStatusLabel,
  type ItemRequisitionApprovalMeta,
} from "@/lib/item-requisition-approval";
import { loadItemRequisitionApprovalMetaMap } from "@/lib/item-requisition-approval-db";
import {
  fundTransferProceduralStatusLabel,
  type FundTransferApprovalMeta,
} from "@/lib/fund-transfer-approval";
import { loadFundTransferApprovalMetaMap } from "@/lib/fund-transfer-approval-db";
import {
  jobOrderProceduralStatusLabel,
  isJobOrderAwaitingExecutionAssignee,
  type JobOrderApprovalMeta,
} from "@/lib/job-order-approval";
import {
  loadJobOrderApprovalMetaMap,
  reconcileJobOrdersAwaitingExecutionAssignee,
} from "@/lib/job-order-approval-db";
import { CompanyKanban } from "./company-kanban";
import { RequestKanbanFlowToggle } from "./request-kanban-flow-toggle";
import { AgentKpiKanbanFlow } from "./kpi-kanban-flow";
import { BoardTableToggle } from "./board-table-toggle";
import { RequestBoardPanes } from "./request-board-panes";
import { TicketActivityLogPanel } from "./ticket-activity-log-panel";
import { TicketBoardFilterBar } from "./ticket-board-filter-bar";

export const dynamic = "force-dynamic";

type AgentTicketWithTeam = Prisma.TicketGetPayload<{
  include: { team: true; assignedAgent: true; feedback: { select: { csat: true } } };
}>;

type EnrichedAssignedAgent = AgentTicketWithTeam["assignedAgent"] & {
  staffAssignmentColor?: string | null;
  profileImage?: string | null;
  profileImageZoom?: number | null;
  profileImagePosX?: number | null;
  profileImagePosY?: number | null;
};

const STATUS_PIPELINE = ACTIVE_REQUEST_STATUSES;

const statusOptions: Array<{ label: string; value: TicketStatus | "ALL" }> = [
  { label: "All", value: "ALL" },
  { label: "Open", value: "OPEN" },
  { label: "In Progress", value: "IN_PROGRESS" },
  { label: "Transfer pending", value: "ESCALATED" },
  { label: "For confirmation", value: "FOR_CONFIRMATION" },
  { label: "Resolved (legacy)", value: "RESOLVED" },
  { label: "Closed", value: "CLOSED" },
];

const priorityOptions: Array<{ label: string; value: TicketPriority | "ALL" }> = [
  { label: "All", value: "ALL" },
  { label: "Set Priority Level", value: "UNSET" },
  { label: "Low", value: "LOW" },
  { label: "Medium", value: "MEDIUM" },
  { label: "High", value: "HIGH" },
  { label: "Urgent", value: "URGENT" },
];

function firstQuery(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

export default async function AgentHome({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string | string[];
    priority?: string | string[];
    q?: string | string[];
    sort?: string | string[];
    dir?: string | string[];
    page?: string | string[];
    logsPage?: string | string[];
    notifications?: string | string[];
    view?: string | string[];
    assigned?: string | string[];
    board?: string | string[];
    company?: string | string[];
    section?: string | string[];
    layer?: string | string[];
    task?: string | string[];
    requestType?: string | string[];
    pane?: string | string[];
    submitted?: string | string[];
    sentBy?: string | string[];
    received?: string | string[];
  }>;
}) {
  const session = await requireSession();
  if (!session?.user) redirect("/signin");
  if (!["SuperAdmin", "HighAdmin", "Personnel", "Admin"].includes(session.user.role)) redirect("/");

  const params = await searchParams;
  if (firstQuery(params.view) === "approvals") {
    redirect("/agent");
  }
  const paneMine = firstQuery(params.pane) === "mine";
  const submittedBanner = firstQuery(params.submitted) === "1";
  const rawBoard = firstQuery(params.board);
  if (rawBoard === "department") {
    redirect("/agent?board=company&layer=department");
  }
  if (rawBoard === "kpi" || rawBoard === "it-tasks") {
    const qs = new URLSearchParams();
    const assigned = firstQuery(params.assigned);
    const task = firstQuery(params.task);
    if (assigned) qs.set("assigned", assigned);
    if (task) qs.set("task", task);
    const s = qs.toString();
    redirect(s ? `/agent/tasks?${s}` : "/agent/tasks");
  }
  /** Personnel cannot view the Company Board: force them back to the Request Board. */
  if (rawBoard === "company" && session.user.role === "Personnel") {
    redirect("/agent?board=ticket");
  }
  const companyCoordinator = await portalCompanyAdminPrivilegesForEmail(session.user.email);
  const operator = await findSessionAgentWithTeam({ email: session.user.email, name: session.user.name });
  // Personnel must use board view to be able to drag cards and change status inline.
  const requestedViewMode = firstQuery(params.view) === "table" ? "table" : "board";
  const boardTab = rawBoard === "kpi" ? "kpi" : rawBoard === "company" ? "company" : "ticket";
  const isCompanyBoard = boardTab === "company";
  const companyBoardLayer =
    isCompanyBoard && firstQuery(params.layer) === "department" ? "department" : "company";
  const selectedCompany = firstQuery(params.company) ?? "ALL";
  const sectionParam = firstQuery(params.section)?.trim() ?? "ALL";
  const selectedSection = sectionParam || "ALL";
  const departmentParentSectionId =
    companyBoardLayer === "department" && selectedSection !== "ALL" ? selectedSection : null;
  const sentByRaw = isCompanyBoard ? firstQuery(params.sentBy)?.trim() ?? "ALL" : "ALL";
  const receivedRaw = isCompanyBoard ? firstQuery(params.received)?.trim() ?? "ALL" : "ALL";
  const sentByFilter = isCompanyBoard ? parseGroupBoardDirectionFilter(sentByRaw) : null;
  const receivedFilter = isCompanyBoard ? parseGroupBoardDirectionFilter(receivedRaw) : null;
  const viewMode = session.user.role === "Personnel" ? "board" : requestedViewMode;
  const isBoard = viewMode === "board";
  if (paneMine && (boardTab !== "ticket" || !isBoard)) {
    const qs = new URLSearchParams();
    qs.set("pane", "mine");
    const qKeep = firstQuery(params.q)?.trim();
    if (qKeep) qs.set("q", qKeep);
    if (submittedBanner) qs.set("submitted", "1");
    redirect(`/agent?${qs.toString()}`);
  }
  const selectedAssigned = firstQuery(params.assigned) ?? "ALL";
  const selectedStatus = firstQuery(params.status) ?? "ALL";
  const selectedPriority = firstQuery(params.priority) ?? "ALL";
  const requestTypeParam = firstQuery(params.requestType) ?? "ALL";
  const requestTypeVisibility = await getIntakeRequestTypeVisibility();
  const visibleRequestTypes = visibleIntakeRequestTypes(requestTypeVisibility.hiddenTypeIds);
  const requestTypeFilterOptions = [
    { value: "ALL", label: "All request types" },
    ...visibleRequestTypes.map((t) => ({
      value: t.id,
      label: `${t.acronym} · ${t.label}`,
    })),
  ];
  const selectedRequestTypeRaw =
    requestTypeParam === "ALL" || isRequestTypeId(requestTypeParam) ? requestTypeParam : "ALL";
  /** Hidden intake types must not remain selected in board filters. */
  const selectedRequestType =
    selectedRequestTypeRaw === "ALL" ||
    visibleRequestTypes.some((t) => t.id === selectedRequestTypeRaw)
      ? selectedRequestTypeRaw
      : "ALL";
  const queryRaw = firstQuery(params.q)?.trim() ?? "";
  const query = queryRaw.replace(/^#/, "").trim();
  const sort = firstQuery(params.sort) ?? "updatedAt";
  const dir = firstQuery(params.dir) === "asc" ? "asc" : "desc";
  const page = Math.max(1, Number.parseInt(firstQuery(params.page) ?? "1", 10) || 1);
  const companyLogPage = Math.max(1, Number.parseInt(firstQuery(params.logsPage) ?? "1", 10) || 1);
  const notificationsOpen = firstQuery(params.notifications) === "1";
  const focusTaskId = firstQuery(params.task)?.trim() || null;
  const boardTicketsPerStatus = 5;
  const pageSize = isBoard && boardTab === "ticket" ? boardTicketsPerStatus : 20;
  const companyLogPageSize = 10;
  const hideCompanyPriorityFilter =
    !companyCoordinator && session.user.role === "Personnel";

  let companyBoardPayload: Awaited<ReturnType<typeof loadCompanyBoard>> | null = null;
  let departmentBoardPayload: Awaited<ReturnType<typeof loadDepartmentBoard>> | null = null;
  let companyAggregates: Awaited<ReturnType<typeof getCompanyBoardAggregates>> | null = null;
  let companyActivityLogs: Awaited<ReturnType<typeof loadTicketActivityLogForSession>> = [];

  const showTopTicketFilters = boardTab !== "kpi";

  const adminScopedCompanyId =
    isCompanyBoard &&
    !isElevatedUserRole(session.user.role) &&
    (session.user.role === "Admin" || companyCoordinator)
      ? await resolveStaffCompanyTeamId(session.user.email)
      : null;

  /** Admin/coordinator own queue — used on Company Board only. */
  const adminTicketQueueCompanyId =
    !isElevatedUserRole(session.user.role) &&
    (session.user.role === "Admin" || companyCoordinator)
      ? await resolveStaffCompanyTeamId(session.user.email)
      : null;

  const rosterTeamsForFilter = isCompanyBoard
    ? sortByRosterOrder(
        await prisma.team.findMany({
          where: rosterTeamNameFilter(),
          select: { id: true, name: true },
        }),
      ).filter((t) => (adminScopedCompanyId ? t.id === adminScopedCompanyId : true))
    : [];

  const viewerSectionScopeForFilter =
    session.user.role === "Personnel" || session.user.role === "Admin"
      ? await resolveViewerOrgChartSectionScope(session.user.email)
      : null;
  const orgChartSectionsForTicketFilter =
    boardTab === "ticket"
      ? viewerSectionScopeForFilter
        ? await (async () => {
            if (viewerSectionScopeForFilter.sectionIds.length === 0) return [];
            const all = await listOrgChartSectionOptions();
            return all.filter((s) => viewerSectionScopeForFilter.sectionIds.includes(s.id));
          })()
        : await listOrgChartSectionOptions()
      : [];

  /** Departments available for Group Board Sent by / Received filters. */
  const orgChartSectionsForGroupBoardFilter = isCompanyBoard
    ? await (async () => {
        const all = await listOrgChartSectionOptions();
        if (session.user.role === "HighAdmin") {
          const mergedId = await resolveMergedSourceUserIdForSessionEmail(session.user.email);
          const downline = await resolveOrgChartDownlineScopeForMergedUser(mergedId);
          if (downline.sectionIds.length === 0) return [];
          const allowed = new Set(downline.sectionIds);
          return all.filter((s) => allowed.has(s.id));
        }
        if (session.user.role === "Admin" || companyCoordinator) {
          const scope =
            viewerSectionScopeForFilter ??
            (await resolveViewerOrgChartSectionScope(session.user.email));
          if (scope.sectionIds.length === 0) return [];
          const allowed = new Set(scope.sectionIds);
          return all.filter((s) => allowed.has(s.id));
        }
        return all;
      })()
    : [];
  const groupBoardDirectionFilterOptions = isCompanyBoard
    ? buildGroupBoardDirectionFilterOptions({
        companies: rosterTeamsForFilter,
        sections: orgChartSectionsForGroupBoardFilter,
      })
    : [{ value: "ALL", label: "All" }];
  const groupBoardDirectionValueSet = new Set(
    groupBoardDirectionFilterOptions.map((o) => o.value),
  );
  const sentByEncoded = encodeGroupBoardDirectionFilter(sentByFilter);
  const receivedEncoded = encodeGroupBoardDirectionFilter(receivedFilter);
  const selectedSentBy =
    sentByEncoded && groupBoardDirectionValueSet.has(sentByEncoded) ? sentByEncoded : "ALL";
  const selectedReceived =
    receivedEncoded && groupBoardDirectionValueSet.has(receivedEncoded) ? receivedEncoded : "ALL";
  const effectiveSentByFilter =
    selectedSentBy === "ALL" ? null : parseGroupBoardDirectionFilter(selectedSentBy);
  const effectiveReceivedFilter =
    selectedReceived === "ALL" ? null : parseGroupBoardDirectionFilter(selectedReceived);

  const selectedSectionValid =
    selectedSection === "ALL" ||
    (boardTab === "ticket"
      ? orgChartSectionsForTicketFilter.some((s) => s.id === selectedSection)
      : true);
  const effectiveSection = selectedSectionValid ? selectedSection : "ALL";
  const ticketSectionSelected = boardTab === "ticket" && effectiveSection !== "ALL";
  const ticketAssignedFilterActive =
    boardTab === "ticket" && session.user.role !== "Personnel" && ticketSectionSelected;

  if (isCompanyBoard) {
    const priorityForCompany = (selectedPriority === "ALL" ? "ALL" : selectedPriority) as TicketPriority | "ALL";
    const companyBoardOpts = {
      session,
      searchQuery: query,
      priorityFilter: priorityForCompany,
      companyTeamIds: selectedCompany === "ALL" ? [] : [selectedCompany],
      requestTypeFilter: selectedRequestType,
      sentByFilter: effectiveSentByFilter,
      receivedFilter: effectiveReceivedFilter,
    } as const;
    if (companyBoardLayer === "department") {
      const [dep, agg, logs] = await Promise.all([
        loadDepartmentBoard({
          ...companyBoardOpts,
          parentSectionId: departmentParentSectionId,
        }),
        getCompanyBoardAggregates(companyBoardOpts),
        loadTicketActivityLogForSession({ session, limit: 120 }),
      ]);
      departmentBoardPayload = dep;
      companyBoardPayload = { columns: dep.columns, cardMode: dep.cardMode, emptyHint: dep.emptyHint };
      companyAggregates = agg;
      companyActivityLogs = logs;
    } else {
      const [dep, agg, logs] = await Promise.all([
        loadCompanyBoard(companyBoardOpts),
        getCompanyBoardAggregates(companyBoardOpts),
        loadTicketActivityLogForSession({ session, limit: 120 }),
      ]);
      companyBoardPayload = dep;
      companyAggregates = agg;
      companyActivityLogs = logs;
    }
  }

  const fetchTicketPipeline = !isCompanyBoard && boardTab !== "kpi";

  async function loadAgentsForSectionFilter(sectionId: string) {
    const agentIds = await resolveAgentIdsForOrgChartSection(sectionId);
    if (agentIds.length === 0) return [];
    return prisma.agent.findMany({
      where: { id: { in: agentIds } },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
  }

  const agentsForTicketAssigneeFilter =
    ticketSectionSelected && fetchTicketPipeline
      ? await loadAgentsForSectionFilter(effectiveSection)
      : [];

  const effectiveAssigned =
    ticketAssignedFilterActive &&
    selectedAssigned !== "ALL" &&
    selectedAssigned !== "UNASSIGNED" &&
    !agentsForTicketAssigneeFilter.some((a) => a.id === selectedAssigned)
      ? "ALL"
      : ticketAssignedFilterActive
        ? selectedAssigned
        : "ALL";

  const whereBase: Prisma.TicketWhereInput = {};
  if (session.user.role === "Admin") {
    /** Admin Request Board: assigned to me OR send-to in my org-chart / downline tree. */
    Object.assign(
      whereBase,
      await sectionScopedTicketWhere({
        email: session.user.email,
        agentId: operator?.id,
      }),
    );
  } else if (session.user.role === "Personnel") {
    Object.assign(whereBase, await sectionScopedTicketWhere({
      email: session.user.email,
      agentId: operator?.id,
    }));
  } else if (isElevatedUserRole(session.user.role)) {
    /** SuperAdmin / HighAdmin: all departments (no company roster scope). */
  } else {
    let companyScope: Prisma.TicketWhereInput | null = null;
    if (adminTicketQueueCompanyId) {
      companyScope = { teamId: adminTicketQueueCompanyId };
    }

    const personalRfpScope =
      operator?.id != null ? await personnelRequestBoardWhere(operator.id) : null;

    if (companyScope && personalRfpScope) {
      whereBase.OR = [companyScope, personalRfpScope];
    } else if (companyScope) {
      Object.assign(whereBase, companyScope);
    } else if (personalRfpScope) {
      Object.assign(whereBase, personalRfpScope);
    }
  }
  if (effectiveAssigned === "UNASSIGNED") {
    if (session.user.role !== "Personnel") {
      whereBase.assignedAgentId = null;
    }
  } else if (effectiveAssigned !== "ALL") {
    if (session.user.role !== "Personnel") {
      whereBase.assignedAgentId = effectiveAssigned;
    }
  }
  if (selectedPriority !== "ALL") {
    whereBase.priority = selectedPriority as TicketPriority;
  }
  if (!isCompanyBoard && selectedRequestType !== "ALL") {
    whereBase.requestType = selectedRequestType;
  }
  if (!isCompanyBoard && effectiveSection !== "ALL") {
    Object.assign(
      whereBase,
      await ticketWhereForOrgChartSectionFilter({
        sectionId: effectiveSection,
        allowedSectionIds: viewerSectionScopeForFilter?.sectionIds ?? null,
      }),
    );
  }
  if (query) {
    const searchOr: Prisma.TicketWhereInput[] = [
      { ticketNumber: { contains: query, mode: "insensitive" } },
      { title: { contains: query, mode: "insensitive" } },
      { contactName: { contains: query, mode: "insensitive" } },
      { contactEmail: { contains: query, mode: "insensitive" } },
    ];
    // Personnel board may already use OR (assigned + RFP current-step). Nest with AND.
    if (whereBase.OR) {
      whereBase.AND = [{ OR: whereBase.OR }, { OR: searchOr }];
      delete whereBase.OR;
    } else {
      whereBase.OR = searchOr;
    }
  }

  const tableWhere: Prisma.TicketWhereInput = { ...whereBase };
  if (selectedStatus !== "ALL") {
    if (selectedStatus === "IN_PROGRESS") {
      tableWhere.status = { in: ["IN_PROGRESS", "PENDING_INFO"] };
    } else {
      tableWhere.status = selectedStatus as TicketStatus;
    }
  }

  const boardWhere: Prisma.TicketWhereInput = {
    ...whereBase,
    status: { in: STATUS_PIPELINE },
  };

  const dataWhere = isBoard ? boardWhere : tableWhere;

  const allowedSorts: Record<string, Prisma.TicketOrderByWithRelationInput> = {
    updatedAt: { updatedAt: dir },
    createdAt: { createdAt: dir },
    priority: { priority: dir },
    status: { status: dir },
  };
  const orderBy = allowedSorts[sort] ?? { updatedAt: "desc" };

  const [
    ticketsTable,
    ticketsBoard,
    boardStatusCounts,
    totalCount,
    critical,
    open,
    slaAtRisk,
    recentUpdated,
  ] = await Promise.all([
    fetchTicketPipeline && !isBoard
      ? prisma.ticket.findMany({
          where: tableWhere,
          orderBy,
          include: { team: true, assignedAgent: true, feedback: { select: { csat: true } } },
          skip: (page - 1) * pageSize,
          take: pageSize,
        })
      : Promise.resolve([] as AgentTicketWithTeam[]),
    fetchTicketPipeline && isBoard
      ? Promise.all(
          STATUS_PIPELINE.map((status) =>
            prisma.ticket.findMany({
              where: { ...whereBase, status },
              orderBy: { updatedAt: "desc" },
              skip: (page - 1) * boardTicketsPerStatus,
              take: boardTicketsPerStatus,
              include: { team: true, assignedAgent: true, feedback: { select: { csat: true } } },
            }),
          ),
        ).then((groups) => groups.flat())
      : Promise.resolve([] as AgentTicketWithTeam[]),
    fetchTicketPipeline && isBoard
      ? Promise.all(
          STATUS_PIPELINE.map(async (status) => {
            const count = await prisma.ticket.count({ where: { ...whereBase, status } });
            return [status, count] as const;
          }),
        ).then((entries) => Object.fromEntries(entries) as Partial<Record<TicketStatus, number>>)
      : Promise.resolve({} as Partial<Record<TicketStatus, number>>),
    fetchTicketPipeline ? prisma.ticket.count({ where: dataWhere }) : Promise.resolve(0),
    fetchTicketPipeline
      ? prisma.ticket.count({
          where: { ...dataWhere, priority: "URGENT" },
        })
      : Promise.resolve(0),
    fetchTicketPipeline
      ? prisma.ticket.count({
          where: {
            ...dataWhere,
            status: { in: OPEN_PIPELINE_STATUSES },
          },
        })
      : Promise.resolve(0),
    fetchTicketPipeline
      ? prisma.ticket.count({
          where: { ...dataWhere, status: "ESCALATED" },
        })
      : Promise.resolve(0),
    fetchTicketPipeline
      ? prisma.ticket.findMany({
          where: dataWhere,
          orderBy: { updatedAt: "desc" },
          take: 4,
          select: {
            id: true,
            ticketNumber: true,
            title: true,
            status: true,
            updatedAt: true,
            assignedAgent: { select: { email: true, name: true } },
          },
        })
      : Promise.resolve([]),
  ]);

  const pendingTravelApprovals =
    notificationsOpen && operator?.id
      ? await listPendingTravelApprovalsForAgent(operator.id)
      : [];

  const pipelineRows = [...ticketsTable, ...ticketsBoard];
  const assigneeColorIdentities = [
    ...pipelineRows.map((t) => ({ email: t.assignedAgent?.email, name: t.assignedAgent?.name })),
    ...recentUpdated.map((r) => ({ email: r.assignedAgent?.email, name: r.assignedAgent?.name })),
  ];
  const assigneeColorByEmail = assigneeColorIdentities.some((x) => (x.email ?? "").trim())
    ? await loadStaffAssignmentColorsForAgents(assigneeColorIdentities)
    : new Map<string, string | null>();
  const assigneeEmails = Array.from(
    new Set(
      assigneeColorIdentities
        .map((x) => x.email?.trim().toLowerCase())
        .filter((email): email is string => Boolean(email)),
    ),
  );
  const assigneeProfiles = assigneeEmails.length
    ? await prisma.portalAccount.findMany({
        where: { email: { in: assigneeEmails } },
        select: {
          email: true,
          profileImage: true,
          profileImageZoom: true,
          profileImagePosX: true,
          profileImagePosY: true,
        },
      })
    : [];
  const assigneeProfileByEmail = new Map(
    assigneeProfiles.map((profile) => [profile.email.trim().toLowerCase(), profile]),
  );
  const withAssigneeColor = (t: AgentTicketWithTeam): AgentTicketWithTeam => {
    const email = t.assignedAgent?.email?.trim().toLowerCase();
    const staffAssignmentColor = email ? (assigneeColorByEmail.get(email) ?? null) : null;
    const profile = email ? assigneeProfileByEmail.get(email) : null;
    return {
      ...t,
      assignedAgent: t.assignedAgent
        ? {
            ...t.assignedAgent,
            staffAssignmentColor,
            profileImage: profile?.profileImage ?? null,
            profileImageZoom: profile?.profileImageZoom ?? 1,
            profileImagePosX: profile?.profileImagePosX ?? 50,
            profileImagePosY: profile?.profileImagePosY ?? 50,
          }
        : null,
    } as AgentTicketWithTeam;
  };
  const ticketsTableEnriched = ticketsTable.map(withAssigneeColor);
  let ticketsBoardEnriched = ticketsBoard.map(withAssigneeColor);

  const boardRequestTypeById = new Map<string, string>();
  let boardPaymentMetaById = new Map<string, PaymentApprovalMeta>();
  let boardRequisitionMetaById = new Map<string, ItemRequisitionApprovalMeta>();
  let boardFundTransferMetaById = new Map<string, FundTransferApprovalMeta>();
  let boardJobOrderMetaById = new Map<string, JobOrderApprovalMeta>();
  let boardAcaMetaById = new Map<string, AcaApprovalMeta>();
  if (isBoard && ticketsBoardEnriched.length > 0) {
    const ids = ticketsBoardEnriched.map((t) => t.id);
    const rows = await prisma.$queryRaw<Array<{ id: string; request_type: string | null }>>`
      SELECT id, request_type FROM tickets WHERE id IN (${Prisma.join(ids)})
    `;
    for (const row of rows) {
      boardRequestTypeById.set(row.id, row.request_type ?? "ISSUE_CONCERN_TICKET");
    }
    boardPaymentMetaById = await loadPaymentApprovalMetaMap(ids);
    boardRequisitionMetaById = await loadItemRequisitionApprovalMetaMap(ids);
    boardFundTransferMetaById = await loadFundTransferApprovalMetaMap(ids);
    boardJobOrderMetaById = await loadJobOrderApprovalMetaMap(ids);
    boardAcaMetaById = await loadAcaApprovalMetaMap(ids);

    const joAwaitingExecutionIds = ids.filter((ticketId) => {
      if (boardRequestTypeById.get(ticketId) !== "JOB_ORDER") return false;
      return isJobOrderAwaitingExecutionAssignee(boardJobOrderMetaById.get(ticketId));
    });
    if (joAwaitingExecutionIds.length > 0) {
      await reconcileJobOrdersAwaitingExecutionAssignee(joAwaitingExecutionIds);
      const refreshedBoardTickets = await prisma.ticket.findMany({
        where: { id: { in: joAwaitingExecutionIds } },
        include: { team: true, assignedAgent: true, feedback: { select: { csat: true } } },
      });
      const refreshedById = new Map(refreshedBoardTickets.map((t) => [t.id, t]));
      ticketsBoardEnriched = ticketsBoardEnriched.map((t) => {
        const refreshed = refreshedById.get(t.id);
        return refreshed ? withAssigneeColor(refreshed) : t;
      });
    }
  }

  const tickets = isBoard ? ticketsBoardEnriched : ticketsTableEnriched;
  const totalPages =
    isBoard && boardTab === "ticket"
      ? Math.max(
          1,
          ...STATUS_PIPELINE.map((status) => Math.ceil((boardStatusCounts[status] ?? 0) / boardTicketsPerStatus)),
        )
      : Math.max(1, Math.ceil(totalCount / pageSize));
  const start = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, totalCount);

  function buildHref(next: Record<string, string | null>) {
    const qs = new URLSearchParams();
    if (viewMode === "table") qs.set("view", "table");
    if (ticketAssignedFilterActive && effectiveAssigned !== "ALL") {
      qs.set("assigned", effectiveAssigned);
    }
    if (!isBoard) {
      if (selectedStatus !== "ALL") qs.set("status", selectedStatus);
    }
    if (boardTab !== "kpi" && selectedPriority !== "ALL") qs.set("priority", selectedPriority);
    if (boardTab !== "kpi" && selectedRequestType !== "ALL") {
      qs.set("requestType", selectedRequestType);
    }
    if (boardTab === "ticket" && effectiveSection !== "ALL") {
      qs.set("section", effectiveSection);
    }
    if (isCompanyBoard && companyBoardLayer === "department") {
      qs.set("layer", "department");
      if (departmentParentSectionId) qs.set("section", departmentParentSectionId);
    }
    if (query) qs.set("q", query);
    if (sort !== "updatedAt") qs.set("sort", sort);
    if (dir !== "desc") qs.set("dir", dir);
    if (page !== 1) qs.set("page", String(page));
    if (isCompanyBoard && companyLogPage !== 1) qs.set("logsPage", String(companyLogPage));
    if (notificationsOpen) qs.set("notifications", "1");
    if (boardTab !== "ticket") qs.set("board", boardTab);
    if (isCompanyBoard && selectedCompany !== "ALL") {
      qs.set("company", selectedCompany);
    }
    if (isCompanyBoard && selectedSentBy !== "ALL") {
      qs.set("sentBy", selectedSentBy);
    }
    if (isCompanyBoard && selectedReceived !== "ALL") {
      qs.set("received", selectedReceived);
    }

    for (const [key, value] of Object.entries(next)) {
      if (value === null || value === "") qs.delete(key);
      else qs.set(key, value);
    }
    const s = qs.toString();
    return s ? `/agent?${s}` : "/agent";
  }

  function sortHref(column: string) {
    const nextDir = sort === column && dir === "desc" ? "asc" : "desc";
    return buildHref({ sort: column, dir: nextDir, page: "1" });
  }

  const ticketsResultLabel =
    totalCount === 0
      ? "No results"
      : isBoard && boardTab === "ticket"
        ? `Page ${page} of ${totalPages} · ${boardTicketsPerStatus} requests per status · ${totalCount} total`
        : `Showing ${start}-${end} of ${totalCount} results`;

  const ticketsEmpty = tickets.length === 0;
  const isSorted = (column: string) => sort === column;
  const sortMarker = (column: string) => {
    if (!isSorted(column)) return "";
    return dir === "asc" ? " ▲" : " ▼";
  };
  const searchFieldQuery = query;
  const currentPage = page;
  const canPrev = currentPage > 1;
  const canNext = currentPage < totalPages;
  const prevHref = buildHref({ page: String(currentPage - 1) });
  const nextHref = buildHref({ page: String(currentPage + 1) });
  const applySortClass = (column: string) =>
    `px-4 py-3 ${isSorted(column) ? "text-zinc-900 dark:text-zinc-100" : "text-zinc-600 dark:text-zinc-400"} hover:text-zinc-950 dark:hover:text-zinc-200`;
  const tableRows = tickets;
  const ratingLabel = (csat: number | null | undefined) =>
    typeof csat === "number" ? `${"★".repeat(csat)}${"☆".repeat(5 - csat)} ${csat}/5` : "Not rated";
  const showPageLinks = totalPages > 1 && boardTab === "ticket";
  const pageLinks = Array.from(
    { length: Math.min(totalPages, 5) },
    (_, i) => Math.max(1, Math.min(totalPages - 4, currentPage - 2)) + i,
  ).filter((n, i, arr) => n >= 1 && n <= totalPages && arr.indexOf(n) === i);

  const boardColumns =
    isBoard && boardTab === "ticket"
      ? await listRequestBoardColumns(requestBoardOwnerKey(session.user))
      : [];
  const canManageBoardColumns = canManageRequestBoardColumns(session.user.role);

  let boardColumnTotals: Record<string, number> | undefined;
  const boardColumnIdByTicketId = new Map<string, string | null>();
  const boardLaneEnteredAtByTicketId = new Map<string, string | null>();
  const lastActivityAtByTicketId = new Map<string, string | null>();
  const forConfirmationAtByTicketId = new Map<string, string | null>();

  if (isBoard && boardColumns.length > 0) {
    const laneTickets = await prisma.ticket.findMany({
      where: { ...whereBase, status: { in: STATUS_PIPELINE } },
      select: { id: true, status: true },
    });
    const laneIds = laneTickets.map((t) => t.id);
    if (laneIds.length > 0) {
      const rows = await prisma.$queryRawUnsafe<
        Array<{
          id: string;
          request_board_column_id: string | null;
          board_lane_entered_at: Date | string | null;
        }>
      >(
        `SELECT id, request_board_column_id, board_lane_entered_at FROM tickets WHERE id = ANY($1::text[])`,
        laneIds,
      );
      for (const row of rows) {
        boardColumnIdByTicketId.set(row.id, row.request_board_column_id);
        boardLaneEnteredAtByTicketId.set(
          row.id,
          row.board_lane_entered_at
            ? new Date(row.board_lane_entered_at).toISOString()
            : null,
        );
      }
      const [activityMap, confirmationMap] = await Promise.all([
        loadTicketLastActivityAtMap(laneIds),
        loadTicketForConfirmationEnteredAtMap(laneIds),
      ]);
      for (const [id, at] of activityMap) {
        lastActivityAtByTicketId.set(id, at.toISOString());
      }
      for (const [id, at] of confirmationMap) {
        forConfirmationAtByTicketId.set(id, at.toISOString());
      }
    }
    boardColumnTotals = Object.fromEntries(boardColumns.map((c) => [c.id, 0]));
    for (const t of laneTickets) {
      const colId = resolveTicketBoardColumnId(boardColumns, {
        status: t.status,
        requestBoardColumnId: boardColumnIdByTicketId.get(t.id) ?? null,
      });
      if (colId && boardColumnTotals[colId] != null) {
        boardColumnTotals[colId] += 1;
      }
    }
  } else if (isBoard && ticketsBoardEnriched.length > 0) {
    const ids = ticketsBoardEnriched.map((t) => t.id);
    const rows = await prisma.$queryRawUnsafe<
      Array<{
        id: string;
        request_board_column_id: string | null;
        board_lane_entered_at: Date | string | null;
      }>
    >(
      `SELECT id, request_board_column_id, board_lane_entered_at FROM tickets WHERE id = ANY($1::text[])`,
      ids,
    );
    for (const row of rows) {
      boardColumnIdByTicketId.set(row.id, row.request_board_column_id);
      boardLaneEnteredAtByTicketId.set(
        row.id,
        row.board_lane_entered_at
          ? new Date(row.board_lane_entered_at).toISOString()
          : null,
      );
    }
    const [activityMap, confirmationMap] = await Promise.all([
      loadTicketLastActivityAtMap(ids),
      loadTicketForConfirmationEnteredAtMap(ids),
    ]);
    for (const [id, at] of activityMap) {
      lastActivityAtByTicketId.set(id, at.toISOString());
    }
    for (const [id, at] of confirmationMap) {
      forConfirmationAtByTicketId.set(id, at.toISOString());
    }
  }

  const boardCards: KanbanTicket[] = isBoard
    ? ticketsBoardEnriched.map((t) => ({
        id: t.id,
        ticketNumber: t.ticketNumber,
        title: t.title,
        description: t.description,
        priority: t.priority,
        status: t.status,
        requestBoardColumnId: boardColumnIdByTicketId.get(t.id) ?? null,
        boardLaneEnteredAt:
          boardLaneEnteredAtByTicketId.get(t.id) ?? t.updatedAt.toISOString(),
        requestType: boardRequestTypeById.get(t.id) ?? "ISSUE_CONCERN_TICKET",
        lastActivityAt: lastActivityAtByTicketId.get(t.id) ?? null,
        forConfirmationAt:
          forConfirmationAtByTicketId.get(t.id) ??
          (t.status === "FOR_CONFIRMATION"
            ? (t.resolvedAt?.toISOString?.() ??
              boardLaneEnteredAtByTicketId.get(t.id) ??
              null)
            : null),
        resolvedAt: t.resolvedAt?.toISOString?.() ?? null,
        createdAt: t.createdAt.toISOString(),
        proceduralStatusLabel: (() => {
          const rt = boardRequestTypeById.get(t.id) ?? "";
          if (rt === "REQUEST_FOR_PAYMENT") {
            return paymentProceduralStatusLabel(
              boardPaymentMetaById.get(t.id)?.proceduralStep ?? "NOTED_BY",
            );
          }
          if (rt === "ITEM_REQUISITION_SLIP") {
            return itemRequisitionProceduralStatusLabel(
              boardRequisitionMetaById.get(t.id)?.proceduralStep ?? "CANVASSED_BY",
            );
          }
          if (rt === "FUND_TRANSFER_REQUEST") {
            return fundTransferProceduralStatusLabel(
              boardFundTransferMetaById.get(t.id)?.proceduralStep ?? "PREPARED_BY",
            );
          }
          if (rt === "JOB_ORDER") {
            return jobOrderProceduralStatusLabel(
              boardJobOrderMetaById.get(t.id)?.proceduralStep ?? "NOTED_BY",
            );
          }
          if (rt === "AUTHORITY_TO_CONDUCT_ACTIVITY") {
            return acaProceduralStatusLabel(boardAcaMetaById.get(t.id) ?? null);
          }
          return null;
        })(),
        updatedAt: t.updatedAt.toISOString(),
        agentName: t.assignedAgent?.name ?? null,
        assigneeColorKey:
          (t.assignedAgent as EnrichedAssignedAgent | null)?.staffAssignmentColor ?? null,
        assigneeProfileImage:
          (t.assignedAgent as EnrichedAssignedAgent | null)?.profileImage ?? null,
        assigneeProfileImageZoom:
          (t.assignedAgent as EnrichedAssignedAgent | null)?.profileImageZoom ?? null,
        assigneeProfileImagePosX:
          (t.assignedAgent as EnrichedAssignedAgent | null)?.profileImagePosX ?? null,
        assigneeProfileImagePosY:
          (t.assignedAgent as EnrichedAssignedAgent | null)?.profileImagePosY ?? null,
      }))
    : [];

  const ticketPagination = (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-zinc-800 dark:text-zinc-300">
      <p>{ticketsResultLabel}</p>
      {showPageLinks ? (
        <div className="flex items-center gap-1">
          <Link
            href={canPrev ? prevHref : "#"}
            className={`rounded-md px-2.5 py-1.5 ${
              canPrev
                ? "border border-zinc-300 bg-white hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
                : "cursor-not-allowed text-zinc-400 dark:text-zinc-500"
            }`}
            aria-disabled={!canPrev}
          >
            Prev
          </Link>
          {pageLinks.map((p) => (
            <Link
              key={p}
              href={buildHref({ page: String(p) })}
              className={`rounded-md px-2.5 py-1.5 ${
                p === currentPage
                  ? "bg-orange-600 text-white"
                  : "border border-zinc-300 bg-white hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
              }`}
            >
              {p}
            </Link>
          ))}
          <Link
            href={canNext ? nextHref : "#"}
            className={`rounded-md px-2.5 py-1.5 ${
              canNext
                ? "border border-zinc-300 bg-white hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
                : "cursor-not-allowed text-zinc-400 dark:text-zinc-500"
            }`}
            aria-disabled={!canNext}
          >
            Next
          </Link>
        </div>
      ) : null}
    </div>
  );

  const activeEvents = isCompanyBoard ? (companyAggregates?.total ?? 0) : totalCount;
  const statCritical = isCompanyBoard ? (companyAggregates?.critical ?? 0) : critical;
  const statOpen = isCompanyBoard ? (companyAggregates?.openPipeline ?? 0) : open;
  const statSla = isCompanyBoard ? (companyAggregates?.slaEscalated ?? 0) : slaAtRisk;
  const companyLogTotal = companyActivityLogs.length;
  const companyLogTotalPages = Math.max(1, Math.ceil(companyLogTotal / companyLogPageSize));
  const safeCompanyLogPage = Math.min(companyLogPage, companyLogTotalPages);
  const pagedCompanyActivityLogs = companyActivityLogs.slice(
    (safeCompanyLogPage - 1) * companyLogPageSize,
    safeCompanyLogPage * companyLogPageSize,
  );

  const isTicketBoardView = isBoard && boardTab === "ticket" && !isCompanyBoard;

  return (
    <main
      className={`flex flex-col bg-zinc-50 text-zinc-900 dark:bg-background dark:text-zinc-100 ${
        isTicketBoardView
          ? "min-h-[calc(100dvh-3.5rem)] px-3 py-2 sm:px-4 sm:py-3 lg:px-5"
          : "min-h-[calc(100vh-56px)] px-3 py-4 sm:px-4"
      }`}
    >
      <div
        className={`mx-auto flex w-full flex-1 flex-col ${
          isTicketBoardView ? "space-y-2 sm:space-y-4" : "space-y-4"
        } ${isCompanyBoard ? "max-w-none" : "max-w-[112rem]"}`}
      >
        <section className={isTicketBoardView ? "space-y-2 sm:space-y-4" : "space-y-4"}>
          {notificationsOpen ? (
            <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-[0_8px_28px_rgba(0,0,0,0.06)] dark:border-zinc-800 dark:bg-surface dark:shadow-[0_10px_30px_rgba(0,0,0,0.25)]">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-zinc-700 dark:text-zinc-300">
                  Notifications
                </h2>
                <Link href={buildHref({ notifications: null })} className="text-xs text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200">
                  Close
                </Link>
              </div>
              <div className="mt-3 space-y-2">
                {pendingTravelApprovals.length > 0 ? (
                  <div className="space-y-2">
                    <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-orange-700 dark:text-orange-300">
                      Travel order approvals
                    </p>
                    {pendingTravelApprovals.map((order) => {
                      const levels = order.approvalLevels ?? [];
                      const pending = hasHierarchicalApprovals(levels)
                        ? getOperatorActionableApprovalLevel(levels, operator?.id ?? null)
                        : null;
                      const label = order.kpiMainTask || order.kpiTitle || "Travel Order";
                      return (
                        <Link
                          key={`to-approve-${order.id}`}
                          href={`/agent/tasks?task=${encodeURIComponent(order.kpiMaintenanceId)}`}
                          className="block rounded-lg border border-orange-500/40 bg-orange-500/10 px-3 py-2 hover:bg-orange-500/15 dark:border-orange-500/30 dark:bg-orange-500/10 dark:hover:bg-orange-500/15"
                        >
                          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                            Pending approval
                            {pending
                              ? ` · ${travelOrderApprovedByLabel(pending.optional === true, pending.level, levels.length)}`
                              : ""}
                          </p>
                          <p className="text-xs text-zinc-700 dark:text-zinc-300">{label}</p>
                          {order.orderRequest ? (
                            <p className="mt-0.5 line-clamp-2 text-[11px] text-zinc-600 dark:text-zinc-400">
                              {order.orderRequest}
                            </p>
                          ) : null}
                          <p className="mt-1 text-[11px] uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
                            Awaiting you · {relativeTime(order.updatedAt)}
                          </p>
                        </Link>
                      );
                    })}
                  </div>
                ) : null}
                {recentUpdated.length === 0 && pendingTravelApprovals.length === 0 ? (
                  <p className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400">
                    No recent queue activity.
                  </p>
                ) : recentUpdated.length === 0 ? null : (
                  recentUpdated.map((item) => {
                    const notifyAssigneeKey = item.assignedAgent?.email
                      ? (assigneeColorByEmail.get(item.assignedAgent.email.trim().toLowerCase()) ?? null)
                      : null;
                    return (
                      <AssigneeColorHighlight
                        key={item.id}
                        assigneeColorKey={notifyAssigneeKey}
                        className="block rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900"
                      >
                        <AgentTicketDeepLink
                          ticketId={item.id}
                          className="block px-3 py-2 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                        >
                          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{item.ticketNumber}</p>
                          <p className="text-xs text-zinc-700 dark:text-zinc-300">{item.title}</p>
                          <p className="mt-1 text-[11px] uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
                            {item.status.replaceAll("_", " ")} · {relativeTime(item.updatedAt)}
                          </p>
                        </AgentTicketDeepLink>
                      </AssigneeColorHighlight>
                    );
                  })
                )}
              </div>
            </section>
          ) : null}

          <div className={`flex flex-col ${isTicketBoardView ? "gap-2 sm:gap-3" : "gap-3"}`}>
            <OrchestrationQueueNav />

            {!isTicketBoardView ? (
            <div
              className={`flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4`}
            >
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-orange-700 dark:text-orange-400/95">
                  {BRAND_TITLE} ·{" "}
                  {isCompanyBoard ? "Group" : boardTab === "kpi" ? "Tasks" : "Requests"}
                </p>
                <div className="flex items-end justify-between gap-3">
                  <div className="min-w-0">
                    <h1 className="mt-1.5 text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
                      {isCompanyBoard
                        ? companyBoardLayer === "department"
                          ? "Department overview"
                          : "Group overview"
                        : boardTab === "kpi"
                          ? "Task Board"
                          : "Requests"}
                    </h1>
                    <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                      <span className="font-semibold text-orange-700 dark:text-orange-400">
                        {activeEvents.toLocaleString()}
                      </span>{" "}
                      {!isCompanyBoard
                        ? `active ${boardTab === "kpi" ? "task" : isBoard ? "pipeline" : ""} event${activeEvents !== 1 ? "s" : ""}`
                        : `request${activeEvents !== 1 ? "s" : ""}`}
                    </p>
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-stretch gap-3 lg:items-end">
                {boardTab !== "kpi" ? (
                  <div className="flex flex-wrap gap-3">
                    <StatCard label="Critical" value={statCritical} valueClass="text-rose-400" />
                    <StatCard label="Open" value={statOpen} valueClass="text-orange-400" />
                    <StatCard
                      label={isCompanyBoard ? "Transfer pending" : "SLA at Risk"}
                      value={statSla}
                      valueClass="text-amber-400"
                    />
                  </div>
                ) : null}
              </div>
            </div>
            ) : null}
          </div>

          <section
            className={
              boardTab === "kpi"
                ? "min-w-0"
                : isTicketBoardView
                  ? "min-w-0"
                  : "rounded-xl border border-zinc-200 bg-white p-2.5 shadow-[0_8px_28px_rgba(0,0,0,0.06)] sm:p-5 dark:border-zinc-800 dark:bg-surface dark:shadow-[0_10px_30px_rgba(0,0,0,0.25)]"
            }
          >
            {showTopTicketFilters && !isTicketBoardView ? (
              <div
                className={`flex flex-col gap-2 sm:gap-3 ${
                  isTicketBoardView
                    ? "sticky top-0 z-20 -mx-2 mb-2 border-b border-zinc-200/80 bg-white/95 px-2 pb-2 backdrop-blur-md sm:static sm:mx-0 sm:mb-4 sm:border-0 sm:bg-transparent sm:px-0 sm:pb-0 sm:backdrop-blur-none dark:border-zinc-800 dark:bg-surface/95"
                    : "mb-3 sm:mb-4"
                }`}
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                  <div className="min-w-0 flex-1">
                    <TicketBoardFilterBar
                  initialQuery={searchFieldQuery}
                  placeholder={
                    isTicketBoardView
                      ? "Search requests…"
                      : "Search request number, subject, customer…"
                  }
                  savedFilterStorageKey={`saved-ticket-filters:${session.user.email}:v1`}
                  company={{
                    visible: isCompanyBoard,
                    value: selectedCompany,
                    options: [
                      { value: "ALL", label: "All companies" },
                      ...rosterTeamsForFilter.map((t) => ({ value: t.id, label: t.name })),
                    ],
                  }}
                  section={{
                    visible: boardTab === "ticket",
                    value: effectiveSection,
                    options: [
                      { value: "ALL", label: "All departments" },
                      ...orgChartSectionsForTicketFilter.map((s) => ({
                        value: s.id,
                        label: s.name,
                      })),
                    ],
                  }}
                  sentBy={{
                    visible: isCompanyBoard,
                    value: selectedSentBy,
                    options: groupBoardDirectionFilterOptions,
                  }}
                  received={{
                    visible: isCompanyBoard,
                    value: selectedReceived,
                    options: groupBoardDirectionFilterOptions,
                  }}
                  assigned={{
                    visible: ticketAssignedFilterActive,
                    value: effectiveAssigned,
                    options: [
                      { value: "ALL", label: "All" },
                      { value: "UNASSIGNED", label: "Unassigned" },
                      ...agentsForTicketAssigneeFilter.map((a) => ({
                        value: a.id,
                        label: a.name,
                      })),
                    ],
                  }}
                  priority={{
                    visible: !(isCompanyBoard && hideCompanyPriorityFilter),
                    value: selectedPriority,
                    options: priorityOptions,
                  }}
                  requestType={{
                    visible: true,
                    value: selectedRequestType,
                    options: requestTypeFilterOptions,
                  }}
                  status={{
                    visible: !isBoard && !isCompanyBoard,
                    value: selectedStatus,
                    options: statusOptions,
                  }}
                  />
                  </div>
                  <div className="flex flex-wrap items-center justify-center gap-1.5 sm:justify-end sm:gap-2">
                  {/* Already on Board — hide the solitary Board chip on mobile. Table link is in the subtitle. */}
                  {session.user.role === "Personnel" || isCompanyBoard ? null : (
                    <BoardTableToggle
                      value={isBoard ? "board" : "table"}
                      boardHref={buildHref({ view: null, page: "1" })}
                      tableHref={buildHref({ view: "table", page: "1" })}
                      className={isTicketBoardView ? "hidden sm:inline-flex sm:w-auto" : "w-full sm:w-auto"}
                    />
                  )}
                  {isCompanyBoard ? (
                    <div className="flex w-full flex-col gap-1.5 sm:w-auto sm:flex-row sm:items-center sm:gap-2">
                      <div className="inline-flex w-full rounded-lg border border-orange-300/80 bg-orange-100 p-0.5 text-xs font-semibold sm:w-auto dark:border-orange-500/35 dark:bg-orange-950/40">
                        <Link
                          href={buildHref({ layer: null, section: null })}
                          className={
                            companyBoardLayer === "company"
                              ? "flex-1 rounded-md bg-orange-600 px-3 py-1.5 text-center text-white sm:flex-none"
                              : "flex-1 rounded-md px-3 py-1.5 text-center text-orange-950/80 hover:bg-orange-200/60 sm:flex-none dark:text-orange-100/90 dark:hover:bg-orange-900/50"
                          }
                        >
                          Company view
                        </Link>
                        <Link
                          href={buildHref({ layer: "department", section: null })}
                          className={
                            companyBoardLayer === "department"
                              ? "flex-1 rounded-md bg-orange-600 px-3 py-1.5 text-center text-white sm:flex-none"
                              : "flex-1 rounded-md px-3 py-1.5 text-center text-orange-950/80 hover:bg-orange-200/60 sm:flex-none dark:text-orange-100/90 dark:hover:bg-orange-900/50"
                          }
                        >
                          Department view
                        </Link>
                      </div>
                      <RequestKanbanFlowToggle />
                    </div>
                  ) : null}
                </div>
                </div>
                {isBoard && !isCompanyBoard ? (
                  <p className="hidden text-[11px] text-zinc-600 sm:block dark:text-zinc-500">
                    Board view uses lanes (Open, In progress, Feedback) for active pipeline work. Use Table for resolved
                    items and full filters.
                    {session.user.role !== "Personnel" && !ticketSectionSelected
                      ? " Select a department to filter by assignee."
                      : null}
                  </p>
                ) : isCompanyBoard ? (
                  <p className="text-[11px] text-zinc-600 dark:text-zinc-500">
                    {companyBoardLayer === "department"
                      ? "Department cards roll up major + sub-department requests. Double-click a major for sub-departments. "
                      : "Company cards with priority breakdowns. Double-click a company for a status kanban. "}
                    Filter by <span className="font-medium text-zinc-700 dark:text-zinc-300">Sent by</span> or{" "}
                    <span className="font-medium text-zinc-700 dark:text-zinc-300">Received</span>{" "}
                    (company or department). Use{" "}
                    <span className="font-medium text-zinc-700 dark:text-zinc-300">Kanban flow</span> to choose
                    company or department grouping on Assign Requests drag-and-drop.
                  </p>
                ) : null}
              </div>
            ) : null}

            {isCompanyBoard && companyBoardPayload ? (
              <>
                {companyBoardPayload.emptyHint ? (
                  <p className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2 text-xs text-amber-900 dark:text-amber-100/90">
                    {companyBoardPayload.emptyHint}
                  </p>
                ) : null}
                <CompanyKanban
                  columns={companyBoardPayload.columns}
                  boardLayer={companyBoardLayer}
                  breadcrumb={departmentBoardPayload?.breadcrumb ?? []}
                  overviewHref={
                    companyBoardLayer === "department"
                      ? buildHref({ layer: "department", section: null })
                      : undefined
                  }
                  sectionHrefTemplate={
                    companyBoardLayer === "department"
                      ? buildHref({ layer: "department", section: "__SECTION__" })
                      : undefined
                  }
                />
                <TicketActivityLogPanel
                  entries={pagedCompanyActivityLogs}
                  linkTickets
                  pagination={{
                    page: safeCompanyLogPage,
                    pageSize: companyLogPageSize,
                    total: companyLogTotal,
                    prevHref: buildHref({ logsPage: String(Math.max(1, safeCompanyLogPage - 1)) }),
                    nextHref: buildHref({
                      logsPage: String(Math.min(companyLogTotalPages, safeCompanyLogPage + 1)),
                    }),
                  }}
                />
              </>
            ) : isBoard && boardTab === "ticket" ? (
              <RequestBoardEditModeProvider canManage={canManageBoardColumns}>
              <RequestBoardPanes
                initialPane={paneMine ? "mine" : "board"}
                myRequests={
                  <MyRequestsBoard
                    email={session.user.email ?? ""}
                    authProvider={session.user.authProvider}
                    query={paneMine ? query : ""}
                    selectedPriority={paneMine ? selectedPriority : "ALL"}
                    selectedStatus={paneMine ? selectedStatus : "ALL"}
                    selectedRequestType={paneMine ? selectedRequestType : "ALL"}
                    submitted={Boolean(paneMine && submittedBanner)}
                    savedFilterStorageKey={`saved-my-request-filters:${session.user.email}:v1`}
                  />
                }
              >
                <div className="flex flex-col gap-4 sm:gap-5">
                  <header className="rounded-2xl border border-zinc-200 bg-gradient-to-br from-white via-white to-orange-50/40 p-4 shadow-[0_12px_36px_rgba(0,0,0,0.05)] dark:border-zinc-800/90 dark:from-[#171614] dark:via-[#131313] dark:to-[#10100f] dark:shadow-[0_18px_48px_rgba(0,0,0,0.35)] sm:p-5 md:p-7">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-orange-700 dark:text-orange-400/95">
                          {BRAND_TITLE} · Requests
                        </p>
                        <h2 className="mt-1.5 text-[1.5rem] font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-[1.85rem]">
                          Requests
                        </h2>
                        <p className="mt-1 max-w-xl text-sm text-zinc-700 dark:text-zinc-300">
                          Assigned pipeline work in Open, In progress, and Feedback lanes.
                          {session.user.role !== "Personnel" ? (
                            <>
                              {" "}
                              <Link
                                href={buildHref({ view: "table", page: "1" })}
                                className="font-semibold text-orange-700 hover:underline dark:text-orange-400"
                              >
                                Open table view
                              </Link>
                              {" "}
                              for resolved items and full filters.
                            </>
                          ) : null}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center gap-2">
                        {session.user.role === "Personnel" ? null : (
                          <BoardTableToggle
                            value="board"
                            boardHref={buildHref({ view: null, page: "1" })}
                            tableHref={buildHref({ view: "table", page: "1" })}
                            className="hidden sm:inline-flex"
                          />
                        )}
                      </div>
                    </div>
                    <div className="mt-4 flex items-center gap-2.5 sm:gap-3">
                      <div className="min-w-0 flex-1">
                      <TicketBoardFilterBar
                        initialQuery={searchFieldQuery}
                        placeholder="Search requests…"
                        savedFilterStorageKey={`saved-ticket-filters:${session.user.email}:v1`}
                        company={{
                          visible: false,
                          value: selectedCompany,
                          options: [
                            { value: "ALL", label: "All companies" },
                            ...rosterTeamsForFilter.map((t) => ({ value: t.id, label: t.name })),
                          ],
                        }}
                        section={{
                          visible: true,
                          value: effectiveSection,
                          options: [
                            { value: "ALL", label: "All departments" },
                            ...orgChartSectionsForTicketFilter.map((s) => ({
                              value: s.id,
                              label: s.name,
                            })),
                          ],
                        }}
                        assigned={{
                          visible: ticketAssignedFilterActive,
                          value: effectiveAssigned,
                          options: [
                            { value: "ALL", label: "All" },
                            { value: "UNASSIGNED", label: "Unassigned" },
                            ...agentsForTicketAssigneeFilter.map((a) => ({
                              value: a.id,
                              label: a.name,
                            })),
                          ],
                        }}
                        priority={{
                          visible: true,
                          value: selectedPriority,
                          options: priorityOptions,
                        }}
                        requestType={{
                          visible: true,
                          value: selectedRequestType,
                          options: requestTypeFilterOptions,
                        }}
                        status={{
                          visible: false,
                          value: selectedStatus,
                          options: statusOptions,
                        }}
                      />
                      </div>
                      <RequestBoardManageToolbar columns={boardColumns} />
                    </div>
                  </header>
                  {ticketsEmpty ? (
                    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-300 py-20 text-center dark:border-zinc-800">
                      <p className="text-sm font-medium text-zinc-700 dark:text-zinc-400">No requests in the pipeline</p>
                      <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-600">
                        {query ||
                        selectedPriority !== "ALL" ||
                        selectedRequestType !== "ALL" ||
                        ticketSectionSelected ||
                        (ticketAssignedFilterActive && effectiveAssigned !== "ALL")
                          ? "Adjust filters or switch to Table view for resolved requests."
                          : "The queue is clear — new requests will land in Open."}
                      </p>
                    </div>
                  ) : (
                    <>
                      <AgentKanban
                        tickets={boardCards}
                        columns={boardColumns}
                        canManageColumns={canManageBoardColumns}
                        columnTotals={boardColumnTotals}
                      />
                      {ticketPagination}
                    </>
                  )}
                </div>
              </RequestBoardPanes>
              </RequestBoardEditModeProvider>
            ) : isBoard && boardTab === "kpi" ? (
              <>
                <AgentKpiKanbanFlow
                  companyFilterTeamId={null}
                  showAdminTaskManagement={
                    isElevatedUserRole(session.user.role) || session.user.role === "Admin"
                  }
                  sessionRole={session.user.role}
                  focusTaskId={focusTaskId}
                />
              </>
            ) : (
              <>
                <div className="w-full overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
                  <table className="w-full min-w-[980px] table-fixed border-collapse divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
                    <colgroup>
                      <col className="w-[9%]" />
                      <col className="w-[28%]" />
                      <col className="w-[16%]" />
                      <col className="w-[10%]" />
                      <col className="w-[12%]" />
                      <col className="w-[11%]" />
                      <col className="w-[14%]" />
                    </colgroup>
                    <thead className="bg-zinc-100 text-left text-xs font-semibold uppercase tracking-[0.16em] text-zinc-700 dark:bg-zinc-900 dark:text-zinc-400">
                      <tr>
                        <th className="px-4 py-3">ID</th>
                        <th className="px-4 py-3 min-w-0">Subject</th>
                        <th className="px-4 py-3">Customer</th>
                        <th className={applySortClass("priority")}>
                          <Link href={sortHref("priority")}>Priority{sortMarker("priority")}</Link>
                        </th>
                        <th className={applySortClass("status")}>
                          <Link href={sortHref("status")}>Status{sortMarker("status")}</Link>
                        </th>
                        <th className="px-4 py-3">Rating</th>
                        <th className={applySortClass("updatedAt")}>
                          <Link href={sortHref("updatedAt")}>Updated{sortMarker("updatedAt")}</Link>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-200 bg-white dark:divide-zinc-800 dark:bg-surface">
                      {ticketsEmpty ? (
                        <tr>
                          <td colSpan={7} className="px-4 py-14 text-center">
                            <div className="flex flex-col items-center gap-2">
                              <p className="text-sm font-medium text-zinc-700 dark:text-zinc-400">
                                No tickets match this view
                              </p>
                              <p className="text-xs text-zinc-600 dark:text-zinc-600">
                                Try different filters or return to the board.
                              </p>
                            </div>
                          </td>
                        </tr>
                      ) : (
                        tableRows.map((t) => {
                          const assigneeColorKey =
                            (t.assignedAgent as { staffAssignmentColor?: string | null } | null)
                              ?.staffAssignmentColor ?? null;
                          return (
                          <tr
                            key={t.id}
                            className="hover:bg-zinc-50 dark:hover:bg-zinc-900/80"
                            style={personnelAssigneeHighlightStyleFromKey(assigneeColorKey)}
                          >
                            <td className="px-4 py-3 font-mono text-xs text-zinc-600 dark:text-zinc-400">
                              {t.ticketNumber}
                            </td>
                            <td className="min-w-0 px-4 py-3 break-words">
                              <AgentTicketDeepLink
                                ticketId={t.id}
                                className="font-semibold text-zinc-900 hover:underline dark:text-zinc-100"
                              >
                                {t.title}
                              </AgentTicketDeepLink>
                              <p className="text-xs text-zinc-600 dark:text-zinc-400">
                                Company: {t.team?.name ?? "Queue"}
                              </p>
                            </td>
                            <td className="px-4 py-3 text-zinc-800 dark:text-zinc-300">
                              {t.contactName || t.contactEmail || "Customer"}
                            </td>
                            <td className="px-4 py-3">
                              <span
                                className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${t.priority === "UNSET" ? "normal-case" : "uppercase"} ${priorityPill(t.priority)}`}
                              >
                                {formatTicketPriorityLabel(t.priority)}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${statusTone(t.status)}`}>
                                <span className="inline-block size-1.5 rounded-full bg-current" />
                                {t.status.replaceAll("_", " ")}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <span
                                className={`whitespace-nowrap text-sm font-medium ${
                                  t.feedback?.csat
                                    ? "text-amber-600 dark:text-amber-300"
                                    : "text-zinc-500 dark:text-zinc-500"
                                }`}
                              >
                                {ratingLabel(t.feedback?.csat)}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-zinc-700 dark:text-zinc-300">{relativeTime(t.updatedAt)}</td>
                          </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
                {ticketPagination}
              </>
            )}
          </section>
        </section>
      </div>
    </main>
  );
}

function StatCard({
  label,
  value,
  valueClass,
  compact = false,
}: {
  label: string;
  value: number;
  valueClass: string;
  compact?: boolean;
}) {
  return (
    <article
      className={
        compact
          ? "min-w-0 flex-1 rounded-lg border border-zinc-200 bg-white px-2 py-1.5 dark:border-zinc-800 dark:bg-surface"
          : "min-w-[96px] rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-[0_6px_20px_rgba(0,0,0,0.06)] dark:border-zinc-800 dark:bg-surface dark:shadow-[0_10px_30px_rgba(0,0,0,0.25)]"
      }
    >
      <p
        className={
          compact
            ? "truncate text-[9px] font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-500"
            : "text-[10px] font-semibold uppercase tracking-widest text-zinc-600 dark:text-zinc-500"
        }
      >
        {label}
      </p>
      <p className={`${compact ? "mt-0 text-lg" : "mt-0.5 text-2xl"} font-bold tabular-nums ${valueClass}`}>
        {String(value).padStart(2, "0")}
      </p>
    </article>
  );
}

function relativeTime(date: Date) {
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function priorityPill(priority: string) {
  if (priority === "UNSET")
    return "bg-amber-500/15 text-amber-950 dark:bg-amber-500/15 dark:text-amber-200";
  if (priority === "URGENT" || priority === "HIGH")
    return "bg-rose-500/15 text-rose-900 dark:bg-rose-500/20 dark:text-rose-200";
  if (priority === "MEDIUM")
    return "bg-orange-500/15 text-orange-900 dark:bg-orange-500/20 dark:text-orange-200";
  return "bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-zinc-200";
}

function statusTone(status: string) {
  if (status === "FOR_CONFIRMATION" || status === "RESOLVED" || status === "CLOSED")
    return "text-orange-800 dark:text-orange-300";
  if (status === "IN_PROGRESS") return "text-orange-800 dark:text-orange-300";
  if (status === "ESCALATED") return "text-amber-800 dark:text-amber-300";
  return "text-zinc-700 dark:text-zinc-300";
}
