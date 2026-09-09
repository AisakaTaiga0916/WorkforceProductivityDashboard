import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { customerCanAccessTicket, requireSession } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { formatTicketStatusLabel } from "@/lib/ticket-status-label";
import { requestTypeLabel } from "@/lib/request-types";
import { paymentProceduralStatusLabel } from "@/lib/request-for-payment-approval";
import { initPaymentApprovalMetaIfNeeded, loadPaymentApprovalMeta } from "@/lib/payment-approval-db";
import { itemRequisitionProceduralStatusLabel } from "@/lib/item-requisition-approval";
import {
  initItemRequisitionApprovalMetaIfNeeded,
  loadItemRequisitionApprovalMeta,
} from "@/lib/item-requisition-approval-db";
import { fundTransferProceduralStatusLabel } from "@/lib/fund-transfer-approval";
import { stampFundTransferCreatorOnCreate } from "@/lib/fund-transfer-approval-db";
import { jobOrderProceduralStatusLabel } from "@/lib/job-order-approval";
import { stampJobOrderCreatorOnCreate } from "@/lib/job-order-approval-db";
import { AgentWorkspace } from "@/app/agent/tickets/[id]/workspace";
import { AgentTicketModalShell } from "@/components/ticket/AgentTicketModalShell";
import { TicketRequestMetaDetails } from "@/components/ticket/TicketRequestMetaDetails";
import { resolveTicketSendRequestToDisplay } from "@/lib/ticket-send-to-display";
import { CustomerTicketPanel } from "./ui";

export const dynamic = "force-dynamic";

export default async function TicketPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireSession();
  if (!session?.user) {
    redirect("/signin");
  }

  const { id } = await params;
  const ticket = await prisma.ticket.findUnique({
    where: { id },
    include: {
      team: true,
      assignedAgent: true,
      activities: { orderBy: { createdAt: "asc" } },
      messages: { orderBy: { createdAt: "asc" } },
      feedback: true,
    },
  });
  if (!ticket) notFound();
  if (
    session.user.role === "Customer" &&
    !customerCanAccessTicket(
      { contactEmail: ticket.contactEmail, requestorEmail: ticket.requestorEmail },
      session.user.email,
    )
  ) {
    redirect("/");
  }

  const backHref = session.user.role === "Customer" ? "/my-tickets" : "/agent?pane=mine";

  const requestorEmail = (ticket.requestorEmail ?? ticket.contactEmail ?? "").trim();
  const requestorAccount = requestorEmail
    ? await prisma.portalAccount.findFirst({
        where: { email: { equals: requestorEmail, mode: "insensitive" } },
        select: {
          company: { select: { name: true } },
          staffDesignatedCompany: { select: { name: true } },
        },
      })
    : null;
  const requestorCompanyName =
    requestorAccount?.company?.name?.trim() ||
    requestorAccount?.staffDesignatedCompany?.name?.trim() ||
    null;
  const branchActivity = ticket.activities.find((a) => a.summary === "Branch");
  const branch = branchActivity?.detail?.trim() ?? null;
  const requestingCompanyActivity = ticket.activities.find((a) => a.summary === "Requesting company");
  const requestingCompany = requestingCompanyActivity?.detail?.trim() ?? null;
  const departmentActivity = ticket.activities.find(
    (a) =>
      a.summary === "Department" ||
      a.summary === "Section" ||
      a.summary === "Requesting department" ||
      a.summary === "Requesting department/business unit",
  );
  const department = departmentActivity?.detail?.trim() ?? null;
  const sendToSectionRows = await prisma.$queryRaw<
    Array<{ org_chart_section_id: string | null }>
  >`
    SELECT org_chart_section_id
    FROM tickets
    WHERE id = ${id}
    LIMIT 1
  `;
  const sendToOrgChartSectionId = sendToSectionRows[0]?.org_chart_section_id ?? null;
  const sendToSectionName = sendToOrgChartSectionId
    ? (
        await prisma.orgChartSection.findUnique({
          where: { id: sendToOrgChartSectionId },
          select: { name: true },
        })
      )?.name?.trim() ?? null
    : null;
  const sendRequestToDisplay = resolveTicketSendRequestToDisplay({
    activities: ticket.activities,
    orgChartSectionId: sendToOrgChartSectionId,
    orgChartSectionName: sendToSectionName,
    teamName: ticket.team?.name ?? null,
  });
  const requestTypeActivity = ticket.activities.find((a) => a.summary === "Request type");
  const requestTypeId =
    "requestType" in ticket && typeof (ticket as { requestType?: string }).requestType === "string"
      ? (ticket as { requestType: string }).requestType
      : null;
  const isAcaRequest =
    requestTypeId === "AUTHORITY_TO_CONDUCT_ACTIVITY" ||
    (requestTypeActivity?.detail?.trim().toUpperCase() ?? "").includes("AUTHORITY TO CONDUCT");
  const isPaymentRequest =
    requestTypeId === "REQUEST_FOR_PAYMENT" ||
    (requestTypeActivity?.detail?.trim().toUpperCase() ?? "").includes("REQUEST FOR PAYMENT");
  const isRequisitionRequest =
    requestTypeId === "ITEM_REQUISITION_SLIP" ||
    (requestTypeActivity?.detail?.trim().toUpperCase() ?? "").includes("ITEM REQUISITION");
  const isFundTransferRequest =
    requestTypeId === "FUND_TRANSFER_REQUEST" ||
    (requestTypeActivity?.detail?.trim().toUpperCase() ?? "").includes("FUND TRANSFER");
  const isJobOrderRequest =
    requestTypeId === "JOB_ORDER" ||
    (requestTypeActivity?.detail?.trim().toUpperCase() ?? "").includes("JOB ORDER");

  const paymentApprovalMeta = isPaymentRequest
    ? ((await loadPaymentApprovalMeta(ticket.id)) ??
      (await initPaymentApprovalMetaIfNeeded(ticket.id)))
    : null;
  const itemRequisitionApprovalMeta = isRequisitionRequest
    ? ((await loadItemRequisitionApprovalMeta(ticket.id)) ??
      (await initItemRequisitionApprovalMetaIfNeeded(ticket.id)))
    : null;
  const fundTransferApprovalMeta = isFundTransferRequest
    ? await stampFundTransferCreatorOnCreate({
        ticketId: ticket.id,
        email: ticket.requestorEmail ?? ticket.contactEmail ?? null,
        name: ticket.contactName,
        teamId: ticket.teamId,
      })
    : null;
  const jobOrderApprovalMeta = isJobOrderRequest
    ? await stampJobOrderCreatorOnCreate({
        ticketId: ticket.id,
        email: ticket.requestorEmail ?? ticket.contactEmail ?? null,
        name: ticket.contactName,
        teamId: ticket.teamId,
      })
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
  const proceduralStatusLabel =
    paymentProceduralLabel ??
    requisitionProceduralLabel ??
    fundTransferProceduralLabel ??
    jobOrderProceduralLabel;

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
    ].filter((v): v is string => Boolean(v));
    if (ids.length > 0) {
      const agents = await prisma.agent.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true },
      });
      for (const a of agents) jobOrderApprovalAgentNames[a.id] = a.name;
    }
  }

  const requestTypeLabelText =
    requestTypeActivity?.detail?.trim() || requestTypeLabel(requestTypeId ?? "");

  const isRequestorSession = customerCanAccessTicket(
    { contactEmail: ticket.contactEmail, requestorEmail: ticket.requestorEmail },
    session.user.email,
  );
  const canCancelRequest =
    isRequestorSession && !ticket.assignedAgentId && ticket.status !== "CLOSED";

  const ticketForWorkspace = {
    ...ticket,
    feedback: ticket.feedback
      ? { csat: ticket.feedback.csat, comment: ticket.feedback.comment }
      : null,
  };

  return (
    <AgentTicketModalShell>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-3 text-zinc-950 sm:p-6 dark:text-zinc-100">
        <div className="mb-4 flex shrink-0 flex-col gap-3 rounded-xl border border-zinc-200 bg-zinc-950 p-3 text-white shadow-sm sm:mb-5 sm:rounded-2xl sm:p-5 dark:border-zinc-800/90 dark:bg-[#181716]/80">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
              <Link
                href={backHref}
                className="text-xs font-semibold text-orange-300 hover:text-orange-200 hover:underline"
              >
                {backHref === "/my-tickets" ? "← Back to my tickets" : "← Back to my requests"}
              </Link>
              <h1 className="mt-2 break-words text-lg font-semibold leading-tight text-zinc-100 sm:text-2xl">
                {ticket.ticketNumber}{" "}
                <span className="text-sm font-normal text-zinc-400 sm:text-base">
                  · {ticket.title}
                </span>
          </h1>
        </div>
            <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
              <span className="w-fit rounded-full bg-white/12 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-zinc-100 dark:bg-zinc-700 dark:text-zinc-200">
                {formatTicketStatusLabel(ticket.status)}
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
            contactName={ticket.contactName}
            email={ticket.requestorEmail ?? ticket.contactEmail ?? "—"}
            company={requestorCompanyName ?? "Not assigned"}
            requestingCompany={requestingCompany}
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
            canUpdatePriority={false}
            canRequestTransfer={false}
            canApproveTransfer={false}
            transferPending={false}
            isPaymentRequest={isPaymentRequest}
            paymentApprovalMeta={paymentApprovalMeta}
            paymentApprovalAgentNames={paymentApprovalAgentNames}
            isRequisitionRequest={isRequisitionRequest}
            itemRequisitionApprovalMeta={itemRequisitionApprovalMeta}
            itemRequisitionApprovalAgentNames={itemRequisitionApprovalAgentNames}
            isFundTransferRequest={isFundTransferRequest}
            fundTransferApprovalMeta={fundTransferApprovalMeta}
            fundTransferApprovalAgentNames={fundTransferApprovalAgentNames}
            isJobOrderApprovalRequest={isJobOrderRequest}
            jobOrderApprovalMeta={jobOrderApprovalMeta}
            jobOrderApprovalAgentNames={jobOrderApprovalAgentNames}
            viewerMode="requestor"
            requestorAside={
              <CustomerTicketPanel ticket={ticket} canCancelRequest={canCancelRequest} />
            }
          />
              </div>
              </div>
    </AgentTicketModalShell>
  );
}
