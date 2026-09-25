import { isElevatedUserRole } from "@/lib/auth";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireSession } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { canViewerApproveTransfer, parseTransferRequestDetail } from "@/lib/ticket-transfer-request";
import { formatTicketStatusLabel } from "@/lib/ticket-status-label";
import { safeReturnToParam } from "@/lib/safe-return-to";
import { portalCompanyAdminPrivilegesForEmail } from "@/lib/portal-staff";
import { resolveStaffCompanyTeamId } from "@/lib/staff-company-scope";
import { AgentWorkspace } from "./workspace";
import { AgentTicketModalShell } from "@/components/ticket/AgentTicketModalShell";
import { TicketRequestMetaDetails } from "@/components/ticket/TicketRequestMetaDetails";
import { resolveTicketSendRequestToDisplay } from "@/lib/ticket-send-to-display";
import { TrackRecentSearchVisit } from "@/components/global-search/TrackRecentSearchVisit";
import { requestTypeLabel, requestTypeAcronym, requestTypeSupportsTransfer } from "@/lib/request-types";
import { TicketDetailBreadcrumbs } from "@/components/navigation/TicketDetailBreadcrumbs";
import { paymentProceduralStatusLabel } from "@/lib/request-for-payment-approval";
import { initPaymentApprovalMetaIfNeeded, loadPaymentApprovalMeta } from "@/lib/payment-approval-db";
import { itemRequisitionProceduralStatusLabel } from "@/lib/item-requisition-approval";
import {
  initItemRequisitionApprovalMetaIfNeeded,
  loadItemRequisitionApprovalMeta,
} from "@/lib/item-requisition-approval-db";
import { fundTransferProceduralStatusLabel } from "@/lib/fund-transfer-approval";
import { stampFundTransferCreatorOnCreate } from "@/lib/fund-transfer-approval-db";
import { jobOrderProceduralStatusLabel, isJobOrderAwaitingExecutionAssignee } from "@/lib/job-order-approval";
import {
  reconcileJobOrderAwaitingExecutionAssignee,
  stampJobOrderCreatorOnCreate,
} from "@/lib/job-order-approval-db";
import { getTicketLinkedKpiMaintenanceId } from "@/lib/job-order-project";
import { resolveAgentIdsForOrgChartSection } from "@/lib/org-chart-section-roster";
import { isViewerOrgChartHeadForSection } from "@/lib/org-chart-section-scope";
import { acaProceduralStatusLabel } from "@/lib/aca-approval";
import { loadAcaApprovalMeta } from "@/lib/aca-approval-db";
import { ensureTicketLinkedTravelOrderColumn } from "@/lib/ensure-ticket-linked-travel-order-column";
import { findTravelOrderById } from "@/lib/travel-order-db";
import { ensureLinkedRfpAccountingDefaults } from "@/lib/travel-order-rfp";

export const dynamic = "force-dynamic";

export default async function AgentTicketPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
  const session = await requireSession();
  if (!session?.user) redirect("/signin");
  if (!["SuperAdmin", "HighAdmin", "Admin", "Personnel"].includes(session.user.role)) redirect("/");

  const { id } = await params;
  const sp = await searchParams;
  const backHref = safeReturnToParam(sp.returnTo, "/agent");

  const ticket = await prisma.ticket.findUnique({
    where: { id },
    include: {
      team: true,
      assignedAgent: true,
      activities: { orderBy: { createdAt: "asc" } },
      messages: { orderBy: { createdAt: "asc" } },
      feedback: { select: { csat: true, comment: true } },
    },
  });
  if (!ticket) notFound();

  const rfpSectionRows = await prisma.$queryRaw<
    Array<{ org_chart_section_id: string | null; requestor_org_chart_section_id: string | null }>
  >`
    SELECT org_chart_section_id, requestor_org_chart_section_id
    FROM tickets
    WHERE id = ${id}
    LIMIT 1
  `;
  let rfpOrgChartSectionId = rfpSectionRows[0]?.org_chart_section_id ?? null;
  const rfpRequestorOrgChartSectionId =
    rfpSectionRows[0]?.requestor_org_chart_section_id ?? null;
  let rfpSectionName = rfpOrgChartSectionId
    ? (
        await prisma.orgChartSection.findUnique({
          where: { id: rfpOrgChartSectionId },
          select: { name: true },
        })
      )?.name ?? null
    : null;
  const jobOrderSendToSectionAgentIds = rfpOrgChartSectionId
    ? await resolveAgentIdsForOrgChartSection(rfpOrgChartSectionId)
    : [];
  const isJobOrderSendToDepartmentHead = await isViewerOrgChartHeadForSection(
    session.user.email,
    rfpOrgChartSectionId,
  );

  const ticketForWorkspace = {
    ...ticket,
    orgChartSectionId: rfpOrgChartSectionId,
    requestorOrgChartSectionId: rfpRequestorOrgChartSectionId,
  };
  const requestorEmail = (ticketForWorkspace.requestorEmail ?? ticketForWorkspace.contactEmail ?? "").trim();
  const requestorAccount = requestorEmail
    ? await prisma.portalAccount.findFirst({
        where: { email: { equals: requestorEmail, mode: "insensitive" } },
        select: {
          company: { select: { id: true, name: true } },
          staffDesignatedCompany: { select: { id: true, name: true } },
        },
      })
    : null;
  const requestorCompanyName =
    requestorAccount?.company?.name?.trim() ||
    requestorAccount?.staffDesignatedCompany?.name?.trim() ||
    null;
  const requestorCompanyTeamId =
    (await resolveStaffCompanyTeamId(requestorEmail)) ||
    requestorAccount?.staffDesignatedCompany?.id ||
    requestorAccount?.company?.id ||
    null;
  const branchActivity = ticketForWorkspace.activities.find((a) => a.summary === "Branch");
  const branch = branchActivity?.detail?.trim() ?? null;
  const requestingCompanyActivity = ticketForWorkspace.activities.find(
    (a) => a.summary === "Requesting company",
  );
  let requestingCompany = requestingCompanyActivity?.detail?.trim() ?? null;
  const departmentActivity = ticketForWorkspace.activities.find(
    (a) =>
      a.summary === "Department" ||
      a.summary === "Section" ||
      a.summary === "Requesting department" ||
      a.summary === "Requesting department/business unit",
  );
  let sendRequestToDisplay = resolveTicketSendRequestToDisplay({
    activities: ticketForWorkspace.activities,
    orgChartSectionId: rfpOrgChartSectionId,
    orgChartSectionName: rfpSectionName,
    teamName: ticketForWorkspace.team?.name ?? null,
  });
  const rfpRequestorSectionName = rfpRequestorOrgChartSectionId
    ? (
        await prisma.orgChartSection.findUnique({
          where: { id: rfpRequestorOrgChartSectionId },
          select: { name: true },
        })
      )?.name ?? null
    : null;
  const requestTypeActivity = ticketForWorkspace.activities.find((a) => a.summary === "Request type");
  const requestTypeId =
    "requestType" in ticketForWorkspace &&
    typeof (ticketForWorkspace as { requestType?: string }).requestType === "string"
      ? (ticketForWorkspace as { requestType: string }).requestType
      : null;
  const isPaymentRequest =
    requestTypeId === "REQUEST_FOR_PAYMENT" ||
    (requestTypeActivity?.detail?.trim().toUpperCase() ?? "").includes("REQUEST FOR PAYMENT");
  let department =
    departmentActivity?.detail?.trim() ?? rfpRequestorSectionName ?? null;
  const isRequisitionRequest =
    requestTypeId === "ITEM_REQUISITION_SLIP" ||
    (requestTypeActivity?.detail?.trim().toUpperCase() ?? "").includes("ITEM REQUISITION");
  const isFundTransferRequest =
    requestTypeId === "FUND_TRANSFER_REQUEST" ||
    (requestTypeActivity?.detail?.trim().toUpperCase() ?? "").includes("FUND TRANSFER");
  const isJobOrderRequest =
    requestTypeId === "JOB_ORDER" ||
    (requestTypeActivity?.detail?.trim().toUpperCase() ?? "").includes("JOB ORDER");
  const isAcaRequest =
    requestTypeId === "AUTHORITY_TO_CONDUCT_ACTIVITY" ||
    (requestTypeActivity?.detail?.trim().toUpperCase() ?? "").includes(
      "AUTHORITY TO CONDUCT ACTIVITY",
    );
  let paymentApprovalMeta = isPaymentRequest
    ? ((await loadPaymentApprovalMeta(ticketForWorkspace.id)) ??
      (await initPaymentApprovalMetaIfNeeded(ticketForWorkspace.id)))
    : null;

  let linkedTravelOrderRef: {
    travelOrderId: string;
    kpiMaintenanceId: string;
  } | null = null;
  if (isPaymentRequest) {
    await ensureTicketLinkedTravelOrderColumn();
    try {
      const linkRows = await prisma.$queryRaw<
        Array<{ linked_travel_order_id: string | null }>
      >`
        SELECT linked_travel_order_id FROM tickets WHERE id = ${ticketForWorkspace.id} LIMIT 1
      `;
      const toId = linkRows[0]?.linked_travel_order_id?.trim() || "";
      if (toId) {
        const order = await findTravelOrderById(toId);
        if (order) {
          linkedTravelOrderRef = {
            travelOrderId: order.id,
            kpiMaintenanceId: order.kpiMaintenanceId,
          };
        }
        const ensured = await ensureLinkedRfpAccountingDefaults({
          ticketId: ticketForWorkspace.id,
          companyTeamId: ticketForWorkspace.teamId || order?.companyTeamId,
          requestorName: ticketForWorkspace.contactName,
          requestorEmail:
            ticketForWorkspace.requestorEmail ?? ticketForWorkspace.contactEmail,
          requestorAgentId: order?.createdByAgentId ?? order?.createdByAgent?.id ?? null,
        });
        if (ensured?.orgChartSectionId) {
          rfpOrgChartSectionId = ensured.orgChartSectionId;
          rfpSectionName = ensured.orgChartSectionName;
          ticketForWorkspace.orgChartSectionId = ensured.orgChartSectionId;
          sendRequestToDisplay = {
            label: "Send request to (department)",
            value: (ensured.orgChartSectionName ?? "").trim() || "Accounting",
          };
        }
        if (ensured?.requestorOrgChartSectionId) {
          ticketForWorkspace.requestorOrgChartSectionId =
            ensured.requestorOrgChartSectionId;
          department =
            (ensured.requestorOrgChartSectionName ?? "").trim() || department;
        }
        if (ensured?.requestBudgetFromCompanyName) {
          requestingCompany = ensured.requestBudgetFromCompanyName;
        }
        // Reload payment meta so Prepared by Bookkeeper is visible after backfill.
        paymentApprovalMeta =
          (await loadPaymentApprovalMeta(ticketForWorkspace.id)) ?? paymentApprovalMeta;
        const refreshed = await prisma.ticket.findUnique({
          where: { id: ticketForWorkspace.id },
          select: { title: true, description: true, contactName: true, teamId: true },
        });
        if (refreshed) {
          Object.assign(ticketForWorkspace, refreshed);
        }
      }
    } catch (err) {
      console.error("[ticket] load linked Work Plan failed:", err);
    }
  }
  const itemRequisitionApprovalMeta = isRequisitionRequest
    ? ((await loadItemRequisitionApprovalMeta(ticketForWorkspace.id)) ??
      (await initItemRequisitionApprovalMetaIfNeeded(ticketForWorkspace.id)))
    : null;
  const fundTransferApprovalMeta = isFundTransferRequest
    ? await stampFundTransferCreatorOnCreate({
        ticketId: ticketForWorkspace.id,
        email:
          ticketForWorkspace.requestorEmail ??
          ticketForWorkspace.contactEmail ??
          null,
        name: ticketForWorkspace.contactName,
        teamId: ticketForWorkspace.teamId,
      })
    : null;
  const jobOrderApprovalMeta = isJobOrderRequest
    ? await stampJobOrderCreatorOnCreate({
        ticketId: ticketForWorkspace.id,
        email:
          ticketForWorkspace.requestorEmail ??
          ticketForWorkspace.contactEmail ??
          null,
        name: ticketForWorkspace.contactName,
        teamId: ticketForWorkspace.teamId,
      })
    : null;
  if (isJobOrderRequest && isJobOrderAwaitingExecutionAssignee(jobOrderApprovalMeta)) {
    if (await reconcileJobOrderAwaitingExecutionAssignee(id)) {
      const assigneeRefresh = await prisma.ticket.findUnique({
        where: { id },
        select: {
          assignedAgentId: true,
          assignedAgent: true,
          status: true,
          resolvedAt: true,
        },
      });
      if (assigneeRefresh) {
        Object.assign(ticketForWorkspace, assigneeRefresh);
      }
    }
  }
  const acaApprovalMeta = isAcaRequest
    ? await loadAcaApprovalMeta(ticketForWorkspace.id)
    : null;
  const paymentProceduralLabel = paymentApprovalMeta
    ? paymentProceduralStatusLabel(paymentApprovalMeta.proceduralStep)
    : null;
  const requisitionProceduralLabel = itemRequisitionApprovalMeta
    ? itemRequisitionProceduralStatusLabel(itemRequisitionApprovalMeta.proceduralStep)
    : null;
  const fundTransferProceduralLabel = fundTransferApprovalMeta
    ? fundTransferProceduralStatusLabel(fundTransferApprovalMeta.proceduralStep)
    : null;
  const jobOrderProceduralLabel = jobOrderApprovalMeta
    ? jobOrderProceduralStatusLabel(jobOrderApprovalMeta.proceduralStep)
    : null;
  const acaProceduralLabel = acaApprovalMeta ? acaProceduralStatusLabel(acaApprovalMeta) : null;
  const proceduralStatusLabel =
    paymentProceduralLabel ??
    requisitionProceduralLabel ??
    fundTransferProceduralLabel ??
    jobOrderProceduralLabel ??
    acaProceduralLabel;
  const paymentApprovalAgentNames: Record<string, string> = {};
  if (paymentApprovalMeta) {
    const ids = [
      paymentApprovalMeta.preparedByAgentId,
      paymentApprovalMeta.notedByAgentId,
      paymentApprovalMeta.approvedByAgentId,
      paymentApprovalMeta.accountingAgentId,
      paymentApprovalMeta.financeAgentId,
    ].filter((v): v is string => Boolean(v));
    if (ids.length > 0) {
      const agents = await prisma.agent.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true },
      });
      for (const a of agents) paymentApprovalAgentNames[a.id] = a.name;
    }
  }
  const itemRequisitionApprovalAgentNames: Record<string, string> = {};
  if (itemRequisitionApprovalMeta) {
    const ids = [
      itemRequisitionApprovalMeta.canvassedByAgentId,
      itemRequisitionApprovalMeta.approvedByAgentId,
    ].filter((v): v is string => Boolean(v));
    if (ids.length > 0) {
      const agents = await prisma.agent.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true },
      });
      for (const a of agents) itemRequisitionApprovalAgentNames[a.id] = a.name;
    }
  }
  const fundTransferApprovalAgentNames: Record<string, string> = {};
  if (fundTransferApprovalMeta) {
    const ids = [
      fundTransferApprovalMeta.preparedByAgentId,
      fundTransferApprovalMeta.recommendingApprovalAgentId,
      fundTransferApprovalMeta.approvedByAgentId,
    ].filter((v): v is string => Boolean(v));
    if (ids.length > 0) {
      const agents = await prisma.agent.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true },
      });
      for (const a of agents) fundTransferApprovalAgentNames[a.id] = a.name;
    }
  }
  const jobOrderApprovalAgentNames: Record<string, string> = {};
  if (jobOrderApprovalMeta) {
    const ids = [
      jobOrderApprovalMeta.preparedByAgentId,
      jobOrderApprovalMeta.notedByAgentId,
      jobOrderApprovalMeta.approvedByAgentId,
      jobOrderApprovalMeta.approvedBy2AgentId,
      jobOrderApprovalMeta.pendingExecutionAssigneeAgentId,
      ...(jobOrderApprovalMeta.workerAgentIds ?? []),
      jobOrderApprovalMeta.assistanceTeam?.assigneeAgentId,
      ...(jobOrderApprovalMeta.assistanceTeam?.workerAgentIds ?? []),
    ].filter((v): v is string => Boolean(v));
    if (ids.length > 0) {
      const agents = await prisma.agent.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true },
      });
      for (const a of agents) jobOrderApprovalAgentNames[a.id] = a.name;
    }
  }
  const acaApprovalAgentNames: Record<string, string> = {};
  if (acaApprovalMeta) {
    const ids = acaApprovalMeta.levels
      .map((l) => l.agentId)
      .filter((v): v is string => Boolean(v));
    if (ids.length > 0) {
      const agents = await prisma.agent.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true },
      });
      for (const a of agents) acaApprovalAgentNames[a.id] = a.name;
    }
  }
  const requestTypeLabelText =
    requestTypeActivity?.detail?.trim() ||
    requestTypeLabel(requestTypeId ?? "");
  let transferPending = false;
  let lastTransferDetail: string | null = null;
  for (const a of ticketForWorkspace.activities) {
    if (a.summary === "Transfer requested") {
      transferPending = true;
      lastTransferDetail = a.detail ?? null;
    }
    if (a.summary === "Transfer approved" || a.summary === "Transfer rejected") {
      transferPending = false;
      lastTransferDetail = null;
    }
  }

  const normalizedEmail = (session.user.email ?? "").trim().toLowerCase();
  const normalizedName = (session.user.name ?? "").trim();
  const operatorByEmail = normalizedEmail
    ? await prisma.agent.findUnique({
        where: { email: normalizedEmail },
        include: { team: true },
      })
    : null;
  const operatorByName =
    !operatorByEmail && normalizedName
      ? await prisma.agent.findFirst({
          where: { name: normalizedName },
          include: { team: true },
        })
      : null;
  const operator = operatorByEmail ?? operatorByName;
  const companyCoordinator = await portalCompanyAdminPrivilegesForEmail(session.user.email);
  const isAdmin = isElevatedUserRole(session.user.role) || session.user.role === "Admin";
  const isSuperAdmin = isElevatedUserRole(session.user.role);
  const isPersonnel = session.user.role === "Personnel";
  const adminCompanyTeamId =
    session.user.role === "Admin" ? await resolveStaffCompanyTeamId(session.user.email) : null;
  const canAssignPaymentAccountingFinance =
    isSuperAdmin ||
    (session.user.role === "Admin" &&
      Boolean(adminCompanyTeamId) &&
      adminCompanyTeamId === ticketForWorkspace.teamId);
  const isAssignedOperator = !!operator && operator.id === ticketForWorkspace.assignedAgentId;
  const canUpdatePriority = isAdmin || companyCoordinator || isAssignedOperator;
  const canRequestTransfer =
    isAssignedOperator && requestTypeSupportsTransfer(requestTypeId);
  const myPortal = normalizedEmail
    ? await prisma.portalAccount.findFirst({
        where: { email: { equals: normalizedEmail, mode: "insensitive" } },
        select: { id: true },
      })
    : null;
  const canApproveTransfer = transferPending
    ? canViewerApproveTransfer({
        sessionRole: session.user.role,
        reviewerPortalAccountId: myPortal?.id ?? null,
        sessionAgentId: operator?.id ?? null,
        parsed: parseTransferRequestDetail(lastTransferDetail),
      })
    : false;

  let linkedJobOrderProjectAssigneeId: string | null = null;
  let linkedJobOrderProjectAssigneeName: string | null = null;
  if (isJobOrderRequest) {
    const linkedProjectId = await getTicketLinkedKpiMaintenanceId(ticketForWorkspace.id);
    if (linkedProjectId) {
      const linkedProject = await prisma.kpiMaintenance.findUnique({
        where: { id: linkedProjectId },
        select: {
          assignedAgentId: true,
          assignedAgent: { select: { id: true, name: true } },
        },
      });
      linkedJobOrderProjectAssigneeId = linkedProject?.assignedAgentId ?? null;
      linkedJobOrderProjectAssigneeName = linkedProject?.assignedAgent?.name ?? null;
    }
  }

  return (
    <AgentTicketModalShell>
      <TrackRecentSearchVisit
        id={`ticket-${ticketForWorkspace.id}`}
        kind="ticket"
        title={ticketForWorkspace.title?.trim() || ticketForWorkspace.ticketNumber}
        subtitle={`${ticketForWorkspace.ticketNumber}${ticketForWorkspace.contactName ? ` · ${ticketForWorkspace.contactName}` : ""}`}
        href={`/agent/tickets/${ticketForWorkspace.id}`}
        status={formatTicketStatusLabel(ticketForWorkspace.status)}
        requestType={requestTypeId ?? undefined}
        badge={requestTypeId ? requestTypeAcronym(requestTypeId) : undefined}
      />
      <TicketDetailBreadcrumbs
        ticketNumber={ticketForWorkspace.ticketNumber}
        title={ticketForWorkspace.title}
        ticketId={ticketForWorkspace.id}
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-3 text-zinc-950 sm:p-6 dark:text-zinc-100">
        <div className="mb-4 flex shrink-0 flex-col gap-3 rounded-xl border border-zinc-200 bg-zinc-950 p-3 text-white shadow-sm sm:mb-5 sm:rounded-2xl sm:p-5 dark:border-zinc-800/90 dark:bg-[#181716]/80">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <Link href={backHref} className="text-xs font-semibold text-orange-300 hover:text-orange-200 hover:underline">
                {backHref === "/agent" ? "← Back to queue" : "← Back"}
              </Link>
              <h1 className="mt-2 break-words text-lg font-semibold leading-tight text-zinc-100 sm:text-2xl">
                {ticketForWorkspace.ticketNumber}{" "}
                <span className="text-sm font-normal text-zinc-400 sm:text-base">· {ticketForWorkspace.title}</span>
              </h1>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
              {linkedTravelOrderRef ? (
                <span className="w-fit rounded-full border border-sky-400/50 bg-sky-500/20 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-sky-100">
                  Work Plan
                </span>
              ) : null}
              <span className="w-fit rounded-full bg-white/12 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-zinc-100 dark:bg-zinc-700 dark:text-zinc-200">
                {formatTicketStatusLabel(ticketForWorkspace.status)}
              </span>
              <Link
                href={backHref}
                className="inline-flex h-8 items-center justify-center rounded-full border border-white/15 bg-black/30 px-3 text-xs font-semibold text-zinc-100 hover:bg-black/45 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Close
              </Link>
            </div>
          </div>

          <TicketRequestMetaDetails
            preparedByLabel={
              isPaymentRequest
                ? "Requested By"
                : isFundTransferRequest
                  ? "Prepared By"
                  : isAcaRequest
                    ? "Submitted By"
                    : "Requestor"
            }
            contactName={ticketForWorkspace.contactName}
            email={
              ticketForWorkspace.requestorEmail ?? ticketForWorkspace.contactEmail ?? "—"
            }
            company={requestorCompanyName ?? "Not assigned"}
            requestingCompany={
              isPaymentRequest && linkedTravelOrderRef ? null : requestingCompany
            }
            branch={branch ?? "—"}
            sendRequestTo={sendRequestToDisplay.value}
            sendRequestToLabel={sendRequestToDisplay.label}
            departmentLabel="Requesting department"
            department={department ?? "—"}
            requestType={requestTypeLabelText}
            proceduralStatus={proceduralStatusLabel}
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
          <AgentWorkspace
            ticket={ticketForWorkspace}
            canUpdatePriority={canUpdatePriority}
            canRequestTransfer={canRequestTransfer}
            canApproveTransfer={canApproveTransfer}
            transferPending={transferPending}
            isPaymentRequest={isPaymentRequest}
            paymentApprovalMeta={paymentApprovalMeta}
            paymentApprovalAgentNames={paymentApprovalAgentNames}
            linkedTravelOrderRef={linkedTravelOrderRef}
            requestBudgetFromCompanyName={
              isPaymentRequest && linkedTravelOrderRef ? requestingCompany : null
            }
            isRequisitionRequest={isRequisitionRequest}
            itemRequisitionApprovalMeta={itemRequisitionApprovalMeta}
            itemRequisitionApprovalAgentNames={itemRequisitionApprovalAgentNames}
            isFundTransferRequest={isFundTransferRequest}
            fundTransferApprovalMeta={fundTransferApprovalMeta}
            fundTransferApprovalAgentNames={fundTransferApprovalAgentNames}
            isJobOrderApprovalRequest={isJobOrderRequest}
            jobOrderApprovalMeta={jobOrderApprovalMeta}
            jobOrderApprovalAgentNames={jobOrderApprovalAgentNames}
            isAcaRequest={isAcaRequest}
            acaApprovalMeta={acaApprovalMeta}
            acaApprovalAgentNames={acaApprovalAgentNames}
            sessionAgentId={operator?.id ?? null}
            sessionEmail={session.user.email ?? null}
            isSuperAdmin={isSuperAdmin}
            canSetApprovalAssignees={isSuperAdmin}
            requestorCompanyTeamId={requestorCompanyTeamId}
            isPersonnel={isPersonnel}
            canAssignPaymentAccountingFinance={canAssignPaymentAccountingFinance}
            canCreateJobOrderProject={isAdmin || companyCoordinator}
            canRequestJobOrderProject={isPersonnel && isAssignedOperator && !isAdmin && !companyCoordinator}
            linkedJobOrderProjectAssigneeId={linkedJobOrderProjectAssigneeId}
            linkedJobOrderProjectAssigneeName={linkedJobOrderProjectAssigneeName}
            jobOrderSendToSectionAgentIds={jobOrderSendToSectionAgentIds}
            jobOrderSendToSectionName={rfpSectionName}
            isJobOrderSendToDepartmentHead={isJobOrderSendToDepartmentHead}
          />
        </div>
      </div>
    </AgentTicketModalShell>
  );
}
