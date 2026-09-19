"use client";

import { CompanyUserSearchField } from "@/components/tickets/CompanyUserSearchField";
import { TicketDetailsPrintButton } from "@/components/tickets/TicketDetailsPrintButton";
import type { Agent, Team, Ticket, TicketActivity, TicketMessage } from "@prisma/client/primary";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { FileText, Paperclip, Loader2 } from "lucide-react";
import {
  INTAKE_ATTACHMENT_ACCEPT,
  MAX_SCREENSHOT_BYTES,
  MAX_SCREENSHOT_COUNT,
  isAllowedIntakeAttachment,
} from "@/lib/ticket-intake-screenshots-constants";
import { ACTIVE_REQUEST_STATUSES } from "@/lib/active-request-statuses";
import { formatTicketPriorityLabel } from "@/lib/ticket-priority-label";
import { formatTicketStatusLabel } from "@/lib/ticket-status-label";
import { formatTicketActivityDetail } from "@/lib/ticket-activity-display";
import { requestTypeLabel, requestTypeSupportsTransfer } from "@/lib/request-types";
import type { TicketPrintField, TicketPrintModel } from "@/lib/ticket-details-print";
import { parsePaymentRequestDescription, formatPaymentPeso, formatPaymentRequestTitle, MODE_OF_PAYMENT_CHECK, MODE_OF_PAYMENT_OPTIONS, DELIVERY_OF_CHECK_OPTIONS, paymentModeRequiresBankDetails, paymentModeShowsBankDetails } from "@/lib/request-for-payment";
import {
  parseItemRequisitionDescription,
  computeRequisitionPriceQuotation,
  applyRequisitionPricingDerivedFields,
  sanitizeRequisitionFloatInput,
  sanitizeRequisitionIntegerInput,
  sumRequisitionListedItemsTotal,
  formatRequisitionPeso,
  normalizeRequisitionMoneyInput,
} from "@/lib/item-requisition";
import {
  assigneeIdForStep,
  canEditDeferredPaymentMode,
  canAssignDeferredPaymentAccountingFinance,
  isPaymentStepApprovedAck,
  PAYMENT_APPROVAL_STEP_LABELS,
  paymentApprovalStepsFor,
  paymentApprovalParticipantIds,
  paymentProceduralStatusLabel,
  paymentStepAllowsRepeatSigner,
  paymentStepRequiresApprovedAck,
  paymentStepShowsApprovedButton,
  paymentStepShowsDoneButton,
  type PaymentApprovalAssignees,
  type PaymentApprovalMeta,
  type PaymentApprovalStep,
} from "@/lib/request-for-payment-approval";
import {
  itemRequisitionAssigneeIdForStep,
  ITEM_REQUISITION_APPROVAL_STEPS,
  ITEM_REQUISITION_APPROVAL_STEP_LABELS,
  itemRequisitionProceduralStatusLabel,
  type ItemRequisitionApprovalAssignees,
  type ItemRequisitionApprovalMeta,
  type ItemRequisitionApprovalStep,
} from "@/lib/item-requisition-approval";
import {
  fundTransferAssigneeIdForStep,
  FUND_TRANSFER_APPROVAL_STEPS,
  FUND_TRANSFER_APPROVAL_STEP_LABELS,
  fundTransferProceduralStatusLabel,
  type FundTransferApprovalAssignees,
  type FundTransferApprovalMeta,
  type FundTransferApprovalStep,
} from "@/lib/fund-transfer-approval";
import { parseFundTransferRequestDescription, formatFundTransferPeso } from "@/lib/fund-transfer-request";
import {
  JOB_ORDER_APPROVAL_STEP_LABELS,
  isJobOrderAssistanceMember,
  isJobOrderCurrentStepLastApprover,
  isJobOrderJobDone,
  jobOrderApprovalStepsFor,
  jobOrderAssigneeIdForStep,
  jobOrderProceduralStatusLabel,
  isJobOrderExecutionWorkspaceOpen,
  isJobOrderProcedureGreenLit,
  type JobOrderApprovalAssignees,
  type JobOrderApprovalMeta,
  type JobOrderApprovalStep,
} from "@/lib/job-order-approval";
import { isJobOrderExecutionOutsideSendToDepartment } from "@/lib/job-order-assistance-scope";
import {
  hasJobOrderJobOutputUploaded,
  JOB_ORDER_ATTACHMENT_SECTION_LABELS,
  partitionJobOrderAttachments,
  type JobOrderAttachmentSection,
} from "@/lib/job-order-attachments";
import { isJobOrderExecutionMember } from "@/lib/job-order-workers";
import { parseJobOrderDescription } from "@/lib/job-order";
import { parseAcaRequestDescription, formatAcaPeso } from "@/lib/authority-to-conduct-activity";
import {
  acaHorizontalApprovalLabel,
  acaLevelRequiresFeedback,
  acaLevelShowsInExeComTable,
  acaLevelShowsInHorizontalApproval,
  acaProceduralStatusLabel,
  currentAcaLevel,
  isAcaProcedureGreenLit,
  type AcaApprovalMeta,
} from "@/lib/aca-approval";
import {
  isIntakeAttachmentImage,
  parseIntakeScreenshotMeta,
  type IntakeScreenshotMetaItem,
} from "@/lib/ticket-intake-screenshots-meta";
import { parseTransferRequestDetail } from "@/lib/ticket-transfer-request";
import { JobOrderPostApprovalNav } from "@/components/tickets/JobOrderPostApprovalNav";
import { JobOrderProjectLinkPanel } from "@/components/tickets/JobOrderProjectLinkPanel";
import { JobOrderWorkersPanel } from "@/components/tickets/JobOrderWorkersPanel";
import { JobOrderAssistanceTeamPanel } from "@/components/tickets/JobOrderAssistanceTeamPanel";
import { RequestChatPanel } from "@/components/tickets/RequestChatPanel";
import type { JobOrderScrollSection } from "@/lib/job-order-section-ids";

type TransferRecipient = { id: string; name: string; email: string };

type TicketDetail = Ticket & {
  team: Team | null;
  assignedAgent: Agent | null;
  activities: TicketActivity[];
  messages: TicketMessage[];
  feedback?: {
    csat: number;
    comment: string | null;
  } | null;
  orgChartSectionId?: string | null;
  /** Present after `tickets.remarks` migration / ensure. */
  remarks?: string | null;
};

export function AgentWorkspace({
  ticket,
  canUpdatePriority,
  canRequestTransfer,
  canApproveTransfer,
  transferPending,
  isPaymentRequest = false,
  paymentApprovalMeta = null,
  paymentApprovalAgentNames = {},
  isRequisitionRequest = false,
  itemRequisitionApprovalMeta = null,
  itemRequisitionApprovalAgentNames = {},
  isFundTransferRequest = false,
  fundTransferApprovalMeta = null,
  fundTransferApprovalAgentNames = {},
  isJobOrderApprovalRequest = false,
  jobOrderApprovalMeta = null,
  jobOrderApprovalAgentNames = {},
  isAcaRequest = false,
  acaApprovalMeta = null,
  acaApprovalAgentNames = {},
  sessionAgentId = null,
  sessionEmail = null,
  isSuperAdmin = false,
  canSetApprovalAssignees = false,
  requestorCompanyTeamId = null,
  isPersonnel = false,
  canAssignPaymentAccountingFinance = false,
  canCreateJobOrderProject = false,
  canRequestJobOrderProject = false,
  linkedJobOrderProjectAssigneeId = null,
  linkedJobOrderProjectAssigneeName = null,
  jobOrderSendToSectionAgentIds = [],
  jobOrderSendToSectionName = null,
  isJobOrderSendToDepartmentHead = false,
  viewerMode = "agent",
  requestorAside = null,
}: {
  ticket: TicketDetail;
  canUpdatePriority: boolean;
  canRequestTransfer: boolean;
  canApproveTransfer: boolean;
  transferPending: boolean;
  isPaymentRequest?: boolean;
  paymentApprovalMeta?: PaymentApprovalMeta | null;
  /** Agent id → display name for payment approval roles. */
  paymentApprovalAgentNames?: Record<string, string>;
  isRequisitionRequest?: boolean;
  itemRequisitionApprovalMeta?: ItemRequisitionApprovalMeta | null;
  itemRequisitionApprovalAgentNames?: Record<string, string>;
  isFundTransferRequest?: boolean;
  fundTransferApprovalMeta?: FundTransferApprovalMeta | null;
  fundTransferApprovalAgentNames?: Record<string, string>;
  /** Procedural approval workflow for Job Order (distinct from display-only `isJobOrderRequest`). */
  isJobOrderApprovalRequest?: boolean;
  jobOrderApprovalMeta?: JobOrderApprovalMeta | null;
  jobOrderApprovalAgentNames?: Record<string, string>;
  isAcaRequest?: boolean;
  acaApprovalMeta?: AcaApprovalMeta | null;
  acaApprovalAgentNames?: Record<string, string>;
  sessionAgentId?: string | null;
  /** Session email — matches execution assignee across duplicate Agent rows. */
  sessionEmail?: string | null;
  isSuperAdmin?: boolean;
  /** Admin / SuperAdmin / Personnel: set RFP / IRS / FTR / JO approval role assignees. */
  canSetApprovalAssignees?: boolean;
  /** Requestor's company team id (Noted By roster for RFP). */
  requestorCompanyTeamId?: string | null;
  isPersonnel?: boolean;
  /** SuperAdmin or Admin of the Send request to company. */
  canAssignPaymentAccountingFinance?: boolean;
  /** Admin / SuperAdmin / company coordinator: create Task Board project from this Job Order. */
  canCreateJobOrderProject?: boolean;
  /** Assigned Personnel: request a company Admin to create the Task Project. */
  canRequestJobOrderProject?: boolean;
  /** Linked Task Board project assignee (primary KPI credit after approval). */
  linkedJobOrderProjectAssigneeId?: string | null;
  linkedJobOrderProjectAssigneeName?: string | null;
  /** Agent ids in Send request to (department) — used for Assistance Team visibility. */
  jobOrderSendToSectionAgentIds?: string[];
  jobOrderSendToSectionName?: string | null;
  /** Viewer is org-chart head of the Send-to department (or an ancestor). */
  isJobOrderSendToDepartmentHead?: boolean;
  /**
   * `requestor` = My Requests / customer ticket detail: same request body layout,
   * without agent controls. Pass `requestorAside` for cancel / reply / verify.
   */
  viewerMode?: "agent" | "requestor";
  requestorAside?: ReactNode;
}) {
  const isAgentViewer = viewerMode === "agent";
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const planningAttachmentInputRef = useRef<HTMLInputElement | null>(null);
  const jobOutputAttachmentInputRef = useRef<HTMLInputElement | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const [attachmentInputKey, setAttachmentInputKey] = useState(0);
  const [priority, setPriority] = useState(ticket.priority);
  const [transferReason, setTransferReason] = useState("");
  const [logModalOpen, setLogModalOpen] = useState(false);
  const [remarksDraft, setRemarksDraft] = useState(() => ticket.remarks ?? "");
  const [remarksSaving, setRemarksSaving] = useState(false);

  useEffect(() => {
    setRemarksDraft(ticket.remarks ?? "");
  }, [ticket.id, ticket.remarks]);
  const [transferRecipients, setTransferRecipients] = useState<TransferRecipient[]>([]);
  const [transferRecipientId, setTransferRecipientId] = useState("");
  const [acaDoneComment, setAcaDoneComment] = useState("");
  const [approvalAgents, setApprovalAgents] = useState<Array<{ id: string; name: string; email: string }>>([]);
  const [requestorApprovalAgents, setRequestorApprovalAgents] = useState<
    Array<{ id: string; name: string; email: string }>
  >([]);
  const [sendToApprovalAgents, setSendToApprovalAgents] = useState<
    Array<{ id: string; name: string; email: string }>
  >([]);
  const [approvalDraft, setApprovalDraft] = useState<PaymentApprovalAssignees>({
    preparedByAgentId: paymentApprovalMeta?.preparedByAgentId ?? null,
    notedByAgentId: paymentApprovalMeta?.notedByAgentId ?? null,
    approvedByAgentId: paymentApprovalMeta?.approvedByAgentId ?? null,
    accountingAgentId: paymentApprovalMeta?.accountingAgentId ?? null,
    financeAgentId: paymentApprovalMeta?.financeAgentId ?? null,
  });
  const [requisitionApprovalDraft, setRequisitionApprovalDraft] =
    useState<ItemRequisitionApprovalAssignees>({
      canvassedByAgentId: itemRequisitionApprovalMeta?.canvassedByAgentId ?? null,
      approvedByAgentId: itemRequisitionApprovalMeta?.approvedByAgentId ?? null,
    });
  const [fundTransferApprovalDraft, setFundTransferApprovalDraft] =
    useState<FundTransferApprovalAssignees>({
      preparedByAgentId: fundTransferApprovalMeta?.preparedByAgentId ?? null,
      recommendingApprovalAgentId: fundTransferApprovalMeta?.recommendingApprovalAgentId ?? null,
      approvedByAgentId: fundTransferApprovalMeta?.approvedByAgentId ?? null,
    });
  const [jobOrderApprovalDraft, setJobOrderApprovalDraft] = useState<JobOrderApprovalAssignees>({
    preparedByAgentId: jobOrderApprovalMeta?.preparedByAgentId ?? null,
    notedByAgentId: jobOrderApprovalMeta?.notedByAgentId ?? null,
    approvedByAgentId: jobOrderApprovalMeta?.approvedByAgentId ?? null,
    approvedBy2AgentId: jobOrderApprovalMeta?.approvedBy2AgentId ?? null,
  });
  const [joPostApprovalSection, setJoPostApprovalSection] =
    useState<JobOrderScrollSection | null>(null);
  const [requestApproverId, setRequestApproverId] = useState("");
  const [pricingDraft, setPricingDraft] = useState<
    Array<{
      priceQuotation: string;
      unitPrice: string;
      total: string;
      nameOfSupplier: string;
      terms: string;
    }>
  >([]);
  const [paymentModeDraft, setPaymentModeDraft] = useState({
    modeOfPayment: "",
    deliveryOfCheck: "",
    bankNameAccountNumber: "",
  });
  /** When true, Mode of payment fields are editable; Save returns them to read-only. */
  const [paymentModeEditing, setPaymentModeEditing] = useState(false);
  /** When true, IRS pricing columns are editable; Save Pricing returns them to read-only. */
  const [requisitionPricingEditing, setRequisitionPricingEditing] = useState(false);

  useEffect(() => {
    setApprovalDraft({
      preparedByAgentId: paymentApprovalMeta?.preparedByAgentId ?? null,
      notedByAgentId: paymentApprovalMeta?.notedByAgentId ?? null,
      approvedByAgentId: paymentApprovalMeta?.approvedByAgentId ?? null,
      accountingAgentId: paymentApprovalMeta?.accountingAgentId ?? null,
      financeAgentId: paymentApprovalMeta?.financeAgentId ?? null,
    });
  }, [paymentApprovalMeta]);

  useEffect(() => {
    setRequisitionApprovalDraft({
      canvassedByAgentId: itemRequisitionApprovalMeta?.canvassedByAgentId ?? null,
      approvedByAgentId: itemRequisitionApprovalMeta?.approvedByAgentId ?? null,
    });
  }, [itemRequisitionApprovalMeta]);

  useEffect(() => {
    setFundTransferApprovalDraft({
      preparedByAgentId: fundTransferApprovalMeta?.preparedByAgentId ?? null,
      recommendingApprovalAgentId: fundTransferApprovalMeta?.recommendingApprovalAgentId ?? null,
      approvedByAgentId: fundTransferApprovalMeta?.approvedByAgentId ?? null,
    });
  }, [fundTransferApprovalMeta]);

  useEffect(() => {
    setJobOrderApprovalDraft({
      preparedByAgentId: jobOrderApprovalMeta?.preparedByAgentId ?? null,
      notedByAgentId: jobOrderApprovalMeta?.notedByAgentId ?? null,
      approvedByAgentId: jobOrderApprovalMeta?.approvedByAgentId ?? null,
      approvedBy2AgentId: jobOrderApprovalMeta?.approvedBy2AgentId ?? null,
    });
  }, [jobOrderApprovalMeta]);

  const needsApprovalAgentList =
    isAgentViewer &&
    (isPaymentRequest ||
      isRequisitionRequest ||
      isFundTransferRequest ||
      isJobOrderApprovalRequest) &&
    (canSetApprovalAssignees ||
      canAssignPaymentAccountingFinance ||
      isPersonnel ||
      Boolean(sessionAgentId && ticket.assignedAgentId === sessionAgentId));

  useEffect(() => {
    if (!needsApprovalAgentList) return;
    let cancelled = false;

    void (async () => {
      const anyRes = await fetch("/api/agents?anyCompany=1", { cache: "no-store" });
      const anyRows = anyRes.ok
        ? ((await anyRes.json()) as Array<{ id: string; name: string; email: string }>)
        : [];
      if (cancelled) return;
      const roster = Array.isArray(anyRows) ? anyRows : [];
      setApprovalAgents(roster);
      setRequestorApprovalAgents(roster);
      setSendToApprovalAgents(roster);
    })().catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [
    needsApprovalAgentList,
    canSetApprovalAssignees,
    canAssignPaymentAccountingFinance,
    isPaymentRequest,
    isJobOrderApprovalRequest,
    isFundTransferRequest,
    ticket.teamId,
    ticket.assignedAgentId,
    sessionAgentId,
    requestorCompanyTeamId,
  ]);

  useEffect(() => {
    if (!isAgentViewer || !canRequestTransfer || transferPending) return;
    let cancelled = false;
    void fetch(`/api/tickets/${ticket.id}/transfer-recipients`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { recipients?: TransferRecipient[] } | null) => {
        if (cancelled) return;
        const recipients = data?.recipients ?? [];
        setTransferRecipients(recipients);
        setTransferRecipientId(recipients[0]?.id ?? "");
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isAgentViewer, canRequestTransfer, transferPending, ticket.id]);

  const cleanedDescription = useMemo(() => {
    return ticket.description
      .replace(/\s*Request to Company\/SBU:\s*.+$/i, "")
      .replace(/\s*Department\/Business Unit:\s*.+$/i, "")
      .trim();
  }, [ticket.description]);

  const paymentDetails = useMemo(
    () => parsePaymentRequestDescription(ticket.description),
    [ticket.description],
  );

  useEffect(() => {
    if (!paymentDetails) {
      setPaymentModeDraft({
        modeOfPayment: "",
        deliveryOfCheck: "",
        bankNameAccountNumber: "",
      });
      setPaymentModeEditing(false);
      return;
    }
    setPaymentModeDraft({
      modeOfPayment: paymentDetails.modeOfPayment || "",
      deliveryOfCheck: paymentDetails.deliveryOfCheck || "",
      bankNameAccountNumber: paymentDetails.bankNameAccountNumber || "",
    });
    // After a successful save (or initial load with a mode set), stay read-only until Edit.
    if (paymentDetails.modeOfPayment?.trim()) {
      setPaymentModeEditing(false);
    }
  }, [paymentDetails]);

  const requisitionDetails = useMemo(
    () => parseItemRequisitionDescription(ticket.description),
    [ticket.description],
  );

  const fundTransferDetails = useMemo(
    () => parseFundTransferRequestDescription(ticket.description),
    [ticket.description],
  );

  const acaDetails = useMemo(() => {
    // Never treat Job Order descriptions as ACA (layout collision).
    if (ticket.requestType === "JOB_ORDER") return null;
    return parseAcaRequestDescription(ticket.description);
  }, [ticket.description, ticket.requestType]);

  const jobOrderDetails = useMemo(
    () => parseJobOrderDescription(ticket.description),
    [ticket.description],
  );
  const isJobOrderRequest =
    ticket.requestType === "JOB_ORDER" || Boolean(jobOrderDetails);
  const showAcaLayout =
    Boolean(isAcaRequest) || (Boolean(acaDetails) && !isJobOrderRequest);

  const canEditRequisitionPricing = Boolean(
    isAgentViewer &&
      isRequisitionRequest &&
      sessionAgentId &&
      ticket.assignedAgentId === sessionAgentId &&
      itemRequisitionApprovalMeta &&
      itemRequisitionApprovalMeta.proceduralStep !== "DONE",
  );
  const requisitionPricingNeedsInitialSet = Boolean(
    canEditRequisitionPricing &&
      !(
        requisitionDetails?.items.some(
          (i) =>
            Boolean(i.unitPrice?.trim()) ||
            Boolean(i.priceQuotation?.trim()) ||
            Boolean(i.nameOfSupplier?.trim()) ||
            Boolean(i.terms?.trim()),
        ) ?? false
      ),
  );
  const showRequisitionPricingEditor = Boolean(
    canEditRequisitionPricing &&
      (requisitionPricingEditing || requisitionPricingNeedsInitialSet),
  );
  const showRequisitionPricingColumns = Boolean(
    canEditRequisitionPricing ||
      (requisitionDetails?.items.some(
        (i) =>
          i.priceQuotation || i.unitPrice || i.total || i.nameOfSupplier || i.terms,
      ) ??
        false) ||
      (isRequisitionRequest && ticket.assignedAgentId),
  );

  const requisitionListedItemsTotal = useMemo(() => {
    if (!requisitionDetails) return "";
    const lines = requisitionDetails.items.map((item, index) => {
      const draft = pricingDraft[index];
      if (!draft) return item;
      return {
        ...item,
        priceQuotation: draft.priceQuotation,
        unitPrice: draft.unitPrice,
        total: draft.total,
      };
    });
    return sumRequisitionListedItemsTotal(lines);
  }, [requisitionDetails, pricingDraft]);

  useEffect(() => {
    if (!requisitionDetails) {
      setPricingDraft([]);
      setRequisitionPricingEditing(false);
      return;
    }
    setPricingDraft(
      requisitionDetails.items.map((item) => {
        const derived = applyRequisitionPricingDerivedFields(item);
        return {
          priceQuotation: derived.priceQuotation ?? "",
          unitPrice: derived.unitPrice ?? "",
          total: derived.total ?? "",
          nameOfSupplier: derived.nameOfSupplier ?? "",
          terms: derived.terms ?? "",
        };
      }),
    );
    // After a successful save (or load with pricing already set), stay read-only until Edit.
    const hasPricing = requisitionDetails.items.some(
      (i) =>
        Boolean(i.unitPrice?.trim()) ||
        Boolean(i.priceQuotation?.trim()) ||
        Boolean(i.nameOfSupplier?.trim()) ||
        Boolean(i.terms?.trim()),
    );
    if (hasPricing) {
      setRequisitionPricingEditing(false);
    }
  }, [requisitionDetails]);

  const intakeScreenshots = useMemo(
    () => parseIntakeScreenshotMeta(ticket.intakeScreenshotMeta),
    [ticket.intakeScreenshotMeta],
  );
  const isJobOrderGreenLit = Boolean(
    isJobOrderApprovalRequest && isJobOrderProcedureGreenLit(jobOrderApprovalMeta),
  );
  const isJobOrderExecutionOpen = Boolean(
    isJobOrderApprovalRequest && isJobOrderExecutionWorkspaceOpen(jobOrderApprovalMeta),
  );
  const jobOrderPendingExecutionAssigneeId =
    jobOrderApprovalMeta?.pendingExecutionAssigneeAgentId?.trim() || null;
  const jobOrderExecutionAssigneeId =
    (isJobOrderGreenLit ? ticket.assignedAgentId?.trim() : null) ||
    jobOrderPendingExecutionAssigneeId ||
    null;
  const jobOrderExecutionAssigneeName = (() => {
    if (
      isJobOrderGreenLit &&
      ticket.assignedAgentId?.trim() &&
      ticket.assignedAgent?.name?.trim()
    ) {
      return ticket.assignedAgent.name.trim();
    }
    if (jobOrderPendingExecutionAssigneeId) {
      return (
        jobOrderApprovalAgentNames[jobOrderPendingExecutionAssigneeId]?.trim() ||
        "Selected for execution"
      );
    }
    return ticket.assignedAgent?.name?.trim() || null;
  })();
  const assignedAgentEmail = ticket.assignedAgent?.email?.trim().toLowerCase() || null;
  const sessionEmailNorm = sessionEmail?.trim().toLowerCase() || null;
  const isJobOrderExecutionAssignee = Boolean(
    (sessionAgentId && sessionAgentId === jobOrderExecutionAssigneeId) ||
      (isJobOrderGreenLit &&
        assignedAgentEmail &&
        sessionEmailNorm &&
        assignedAgentEmail === sessionEmailNorm),
  );
  const isJobOrderExecutionTeamMember = Boolean(
    isJobOrderExecutionAssignee ||
      (sessionAgentId &&
        isJobOrderExecutionMember({
          agentId: sessionAgentId,
          meta: jobOrderApprovalMeta,
          ticketAssignedAgentId: jobOrderExecutionAssigneeId,
          linkedProjectAssigneeId: linkedJobOrderProjectAssigneeId,
        })),
  );
  const canAssignJobOrderExecutionAssignee = Boolean(
    isJobOrderExecutionOpen &&
      (canCreateJobOrderProject || isSuperAdmin || canSetApprovalAssignees),
  );
  const canManageJobOrderCoWorkers = Boolean(
    isJobOrderExecutionOpen &&
      jobOrderExecutionAssigneeId &&
      (canCreateJobOrderProject ||
        isSuperAdmin ||
        canSetApprovalAssignees ||
        isJobOrderExecutionAssignee),
  );
  const isJobOrderAssistanceTeamMember = Boolean(
    sessionAgentId && isJobOrderAssistanceMember(sessionAgentId, jobOrderApprovalMeta),
  );
  const canMarkJobOrderDone = Boolean(
    isJobOrderExecutionOpen &&
      !isJobOrderJobDone(jobOrderApprovalMeta) &&
      !["FOR_CONFIRMATION", "RESOLVED", "CLOSED"].includes(ticket.status) &&
      (canCreateJobOrderProject ||
        isSuperAdmin ||
        canSetApprovalAssignees ||
        isJobOrderExecutionAssignee ||
        isJobOrderExecutionTeamMember ||
        isJobOrderAssistanceTeamMember),
  );
  const executionOutsideSendTo = Boolean(
    jobOrderExecutionAssigneeId &&
      isJobOrderExecutionOutsideSendToDepartment({
        executionAssigneeAgentId: jobOrderExecutionAssigneeId,
        sendToOrgChartSectionId: ticket.orgChartSectionId,
        sendToSectionAgentIds: jobOrderSendToSectionAgentIds,
      }),
  );
  const showJobOrderAssistanceTeam = Boolean(
    isJobOrderApprovalRequest &&
      isJobOrderExecutionOpen &&
      (executionOutsideSendTo ||
        Boolean(jobOrderApprovalMeta?.assistanceTeam) ||
        isJobOrderSendToDepartmentHead),
  );
  const canManageJobOrderAssistanceTeam = Boolean(
    showJobOrderAssistanceTeam &&
      (canCreateJobOrderProject ||
        isSuperAdmin ||
        canSetApprovalAssignees ||
        isJobOrderSendToDepartmentHead ||
        (sessionAgentId && ticket.assignedAgentId === sessionAgentId)),
  );
  const jobOrderAttachmentPartitions = useMemo(
    () => partitionJobOrderAttachments(intakeScreenshots),
    [intakeScreenshots],
  );
  const hasJobOrderJobOutput = hasJobOrderJobOutputUploaded(intakeScreenshots);
  const canAddPlanningAttachments = (() => {
    if (!ACTIVE_REQUEST_STATUSES.includes(ticket.status)) return false;
    if (!isJobOrderApprovalRequest) return true;
    if (!isJobOrderExecutionOpen) return false;
    return (
      canCreateJobOrderProject ||
      isSuperAdmin ||
      canSetApprovalAssignees ||
      isJobOrderExecutionTeamMember ||
      isJobOrderAssistanceTeamMember
    );
  })();
  const canAddJobOutputAttachments = Boolean(
    isJobOrderApprovalRequest &&
      isJobOrderExecutionOpen &&
      ACTIVE_REQUEST_STATUSES.includes(ticket.status) &&
      (canCreateJobOrderProject ||
        isSuperAdmin ||
        canSetApprovalAssignees ||
        isJobOrderExecutionTeamMember ||
        isJobOrderAssistanceTeamMember),
  );
  const canAddAttachments = isJobOrderApprovalRequest
    ? canAddPlanningAttachments || canAddJobOutputAttachments
    : canAddPlanningAttachments;
  const attachmentSlotsRemaining = Math.max(0, MAX_SCREENSHOT_COUNT - intakeScreenshots.length);

  async function uploadTicketAttachments(
    fileList: FileList | null,
    section?: JobOrderAttachmentSection,
  ) {
    const allow =
      !isJobOrderApprovalRequest
        ? canAddAttachments
        : section === "job_output"
          ? canAddJobOutputAttachments
          : canAddPlanningAttachments;
    if (!fileList || fileList.length === 0 || !allow) return;
    const files = Array.from(fileList);
    if (attachmentSlotsRemaining <= 0) {
      setAttachmentError(`You can attach at most ${MAX_SCREENSHOT_COUNT} files.`);
      return;
    }
    for (const file of files) {
      if (file.size > MAX_SCREENSHOT_BYTES) {
        setAttachmentError("Each attachment must be at most 5MB.");
        return;
      }
      if (!isAllowedIntakeAttachment(file.type || "", file.name)) {
        setAttachmentError(
          "Attachments must be images or documents (PDF, Word, Excel, CSV, TXT).",
        );
        return;
      }
    }

    setAttachmentBusy(true);
    setAttachmentError(null);
    try {
      const form = new FormData();
      if (isJobOrderApprovalRequest && section) {
        form.append("section", section);
      }
      for (const file of files.slice(0, attachmentSlotsRemaining)) {
        form.append("screenshots", file);
      }
      const res = await fetch(`/api/tickets/${ticket.id}/screenshots`, {
        method: "POST",
        body: form,
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(payload.error ?? "Could not upload attachments.");
      }
      setAttachmentInputKey((k) => k + 1);
      router.refresh();
    } catch (err) {
      setAttachmentError(err instanceof Error ? err.message : "Could not upload attachments.");
    } finally {
      setAttachmentBusy(false);
      if (attachmentInputRef.current) attachmentInputRef.current.value = "";
      if (planningAttachmentInputRef.current) planningAttachmentInputRef.current.value = "";
      if (jobOutputAttachmentInputRef.current) jobOutputAttachmentInputRef.current.value = "";
    }
  }

  const pendingTransfer = useMemo(() => {
    let detail: string | null = null;
    for (const a of ticket.activities) {
      if (a.summary === "Transfer requested") detail = a.detail ?? null;
      if (a.summary === "Transfer approved" || a.summary === "Transfer rejected") detail = null;
    }
    return parseTransferRequestDetail(detail);
  }, [ticket.activities]);

  const paymentProceduralLabel = paymentApprovalMeta
    ? paymentProceduralStatusLabel(paymentApprovalMeta.proceduralStep)
    : null;
  const currentPaymentStep =
    paymentApprovalMeta && paymentApprovalMeta.proceduralStep !== "DONE"
      ? (paymentApprovalMeta.proceduralStep as PaymentApprovalStep)
      : null;
  const isTicketAssignee = Boolean(sessionAgentId && ticket.assignedAgentId === sessionAgentId);
  const currentStepAssigneeId = currentPaymentStep
    ? assigneeIdForStep(paymentApprovalMeta!, currentPaymentStep)
    : null;
  /** People who already completed a prior RFP step (blocks Done for a second role). */
  const paymentCompletedApproverIds = useMemo(() => {
    if (!paymentApprovalMeta) return new Set<string>();
    const ids = new Set<string>();
    for (const step of paymentApprovalStepsFor(paymentApprovalMeta)) {
      if (!paymentApprovalMeta.completed[step]) continue;
      const id = assigneeIdForStep(paymentApprovalMeta, step);
      if (id) ids.add(id);
    }
    return ids;
  }, [paymentApprovalMeta]);

  /** True when the signed-in user already completed another approval role on this RFP. */
  const sessionAlreadyApprovedThisRequest = Boolean(
    sessionAgentId && paymentCompletedApproverIds.has(sessionAgentId),
  );
  /** Open Accounting/Finance seats unlock the prior-signee lock for the board assignee. */
  const currentPaymentStepAllowsRepeatSigner = Boolean(
    paymentApprovalMeta &&
      currentPaymentStep &&
      paymentStepAllowsRepeatSigner(paymentApprovalMeta, currentPaymentStep),
  );

  const canCompleteCurrentPaymentStep = Boolean(
    currentPaymentStep &&
      sessionAgentId &&
      ticket.assignedAgentId === sessionAgentId &&
      (!sessionAlreadyApprovedThisRequest || currentPaymentStepAllowsRepeatSigner),
  );
  const canEditPaymentMode = Boolean(
    isAgentViewer &&
      isPaymentRequest &&
      paymentApprovalMeta &&
      (isTicketAssignee || canSetApprovalAssignees || canAssignPaymentAccountingFinance) &&
      canEditDeferredPaymentMode({
        meta: paymentApprovalMeta,
        proceduralStep: currentPaymentStep,
        modeOfPayment: paymentDetails?.modeOfPayment,
      }),
  );
  const paymentModeNeedsInitialSet = Boolean(
    canEditPaymentMode && !(paymentDetails?.modeOfPayment ?? "").trim(),
  );
  const showPaymentModeEditor = Boolean(
    canEditPaymentMode && (paymentModeEditing || paymentModeNeedsInitialSet),
  );
  const canAssignDeferredAccountingFinance = Boolean(
    isAgentViewer &&
      isPaymentRequest &&
      paymentApprovalMeta &&
      (isTicketAssignee || canSetApprovalAssignees || canAssignPaymentAccountingFinance) &&
      canAssignDeferredPaymentAccountingFinance({
        meta: paymentApprovalMeta,
        modeOfPayment: paymentDetails?.modeOfPayment,
      }),
  );
  const deferredAccountingFinanceRoster =
    sendToApprovalAgents.length > 0 ? sendToApprovalAgents : approvalAgents;
  const deferredAccountingFinanceExcludedIds = useMemo(() => {
    if (!paymentApprovalMeta) return new Set<string>();
    return paymentApprovalParticipantIds(paymentApprovalMeta);
  }, [paymentApprovalMeta]);
  const currentStepNeedsApprovedAck = Boolean(
    currentPaymentStep && paymentStepRequiresApprovedAck(currentPaymentStep),
  );
  const currentStepApprovedAck = Boolean(
    paymentApprovalMeta &&
      currentPaymentStep &&
      isPaymentStepApprovedAck(paymentApprovalMeta, currentPaymentStep),
  );
  const canMarkCurrentPaymentApproved = Boolean(
    canCompleteCurrentPaymentStep &&
      currentPaymentStep &&
      paymentStepShowsApprovedButton(currentPaymentStep) &&
      !currentStepApprovedAck,
  );
  const canMarkCurrentPaymentDone = Boolean(
    canCompleteCurrentPaymentStep &&
      currentPaymentStep &&
      paymentStepShowsDoneButton(currentPaymentStep) &&
      (!currentStepNeedsApprovedAck || currentStepApprovedAck),
  );
  /** Assignee (or Personnel) can submit the current step to the next approver without returning to Unassigned. */
  const canRequestPaymentApproval = Boolean(
    currentPaymentStep && (isPersonnel || isTicketAssignee || canSetApprovalAssignees),
  );

  const acaProceduralLabelText = acaApprovalMeta
    ? acaProceduralStatusLabel(acaApprovalMeta)
    : null;
  const currentAcaStep = acaApprovalMeta ? currentAcaLevel(acaApprovalMeta) : null;
  const canCompleteCurrentAcaStep = Boolean(
    isAcaRequest &&
      acaApprovalMeta &&
      currentAcaStep &&
      sessionAgentId &&
      ticket.assignedAgentId === sessionAgentId &&
      acaApprovalMeta.proceduralStep !== "DONE",
  );
  const acaRequiresFeedback = acaLevelRequiresFeedback(currentAcaStep?.roleCode);
  /** Hide transfer for procedural types (RFP, FTR, JO) and while ACA is not green-lit. */
  const acaTransferBlocked = Boolean(
    isAcaRequest && acaApprovalMeta && acaApprovalMeta.proceduralStep !== "DONE",
  );
  const showRequestTransfer = Boolean(
    canRequestTransfer &&
      requestTypeSupportsTransfer(ticket.requestType) &&
      !transferPending &&
      !acaTransferBlocked,
  );
  /**
   * Assignee must mark Done on the current step; handoff goes to the next
   * procedural assignee automatically (no Submit for Next Approval on RFP).
   */

  const requisitionProceduralLabel = itemRequisitionApprovalMeta
    ? itemRequisitionProceduralStatusLabel(itemRequisitionApprovalMeta.proceduralStep)
    : null;
  const currentRequisitionStep =
    itemRequisitionApprovalMeta && itemRequisitionApprovalMeta.proceduralStep !== "DONE"
      ? (itemRequisitionApprovalMeta.proceduralStep as ItemRequisitionApprovalStep)
      : null;
  const canCompleteCurrentRequisitionStep = Boolean(
    currentRequisitionStep &&
      currentRequisitionStep !== "CANVASSED_BY" &&
      sessionAgentId &&
      ticket.assignedAgentId === sessionAgentId,
  );
  const canRequestRequisitionApproval = Boolean(
    currentRequisitionStep === "APPROVED_BY" &&
      (isPersonnel || isTicketAssignee || canSetApprovalAssignees),
  );
  const canUndoRequisitionCanvass = Boolean(
    isSuperAdmin &&
      itemRequisitionApprovalMeta &&
      (itemRequisitionApprovalMeta.completed.CANVASSED_BY ||
        itemRequisitionApprovalMeta.canvassedByAgentId) &&
      !itemRequisitionApprovalMeta.completed.APPROVED_BY &&
      itemRequisitionApprovalMeta.proceduralStep !== "DONE",
  );
  const currentRequisitionStepAssigneeId = currentRequisitionStep
    ? itemRequisitionAssigneeIdForStep(itemRequisitionApprovalMeta!, currentRequisitionStep)
    : null;

  const fundTransferProceduralLabel = fundTransferApprovalMeta
    ? fundTransferProceduralStatusLabel(fundTransferApprovalMeta.proceduralStep)
    : null;
  const currentFundTransferStep =
    fundTransferApprovalMeta && fundTransferApprovalMeta.proceduralStep !== "DONE"
      ? (fundTransferApprovalMeta.proceduralStep as FundTransferApprovalStep)
      : null;
  const canCompleteCurrentFundTransferStep = Boolean(
    currentFundTransferStep && sessionAgentId && ticket.assignedAgentId === sessionAgentId,
  );
  const canRequestFundTransferApproval = Boolean(
    currentFundTransferStep && (isPersonnel || isTicketAssignee || canSetApprovalAssignees),
  );
  const currentFundTransferStepAssigneeId = currentFundTransferStep
    ? fundTransferAssigneeIdForStep(fundTransferApprovalMeta!, currentFundTransferStep)
    : null;

  const jobOrderProceduralLabel = jobOrderApprovalMeta
    ? jobOrderProceduralStatusLabel(jobOrderApprovalMeta.proceduralStep)
    : null;
  const currentJobOrderStep =
    jobOrderApprovalMeta && jobOrderApprovalMeta.proceduralStep !== "DONE"
      ? (jobOrderApprovalMeta.proceduralStep as JobOrderApprovalStep)
      : null;
  const canCompleteCurrentJobOrderStep = Boolean(
    currentJobOrderStep && sessionAgentId && ticket.assignedAgentId === sessionAgentId,
  );
  const jobOrderLastStepNeedsJobOutput = Boolean(
    jobOrderApprovalMeta &&
      isJobOrderCurrentStepLastApprover(jobOrderApprovalMeta) &&
      !hasJobOrderJobOutput,
  );
  const jobOrderLastStepNeedsJobDone = Boolean(
    jobOrderApprovalMeta &&
      isJobOrderCurrentStepLastApprover(jobOrderApprovalMeta) &&
      !isJobOrderJobDone(jobOrderApprovalMeta),
  );
  const canRequestJobOrderApproval = Boolean(
    currentJobOrderStep && (isPersonnel || isTicketAssignee || canSetApprovalAssignees),
  );
  const currentJobOrderStepAssigneeId = currentJobOrderStep
    ? jobOrderAssigneeIdForStep(jobOrderApprovalMeta!, currentJobOrderStep)
    : null;

  function updatePricingRow(
    index: number,
    patch: Partial<{
      priceQuotation: string;
      unitPrice: string;
      total: string;
      nameOfSupplier: string;
      terms: string;
    }>,
  ) {
    setPricingDraft((prev) =>
      prev.map((row, i) => {
        if (i !== index) return row;
        const qty = requisitionDetails?.items[index]?.quantity ?? "";
        let next = { ...row, ...patch };
        // PRICE QUOTATION = QUANTITY × UNIT PRICE (unit price is editable).
        if (patch.unitPrice !== undefined) {
          const quote = computeRequisitionPriceQuotation({
            quantity: qty,
            unitPrice: next.unitPrice,
            priceQuotation: next.priceQuotation,
            total: next.total,
          });
          next.priceQuotation = quote;
          next.total = quote;
        }
        return next;
      }),
    );
  }

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/tickets/${ticket.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Request failed");
      return;
    }
    if (body.action === "complete_aca_approval_step") {
      setAcaDoneComment("");
    }
    router.refresh();
  }

  async function saveRemarks() {
    if (!isAgentViewer) return;
    setRemarksSaving(true);
    setError(null);
    const res = await fetch(`/api/tickets/${ticket.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "remarks", remarks: remarksDraft }),
    });
    setRemarksSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Could not save remarks.");
      return;
    }
    router.refresh();
  }

  const verificationState = useMemo(() => {
    let state: "pending" | "verified" | "rejected" = "pending";
    let rejectedReason: string | null = null;
    for (const a of ticket.activities) {
      if (a.summary === "Resolution verification approved") {
        state = "verified";
        rejectedReason = null;
      }
      if (a.summary === "Resolution verification rejected") {
        state = "rejected";
        rejectedReason = a.detail?.trim() || "No reason provided.";
      }
    }
    return { state, rejectedReason };
  }, [ticket.activities]);

  const createdAtLabel = (
    ticket.createdAt instanceof Date ? ticket.createdAt : new Date(ticket.createdAt)
  ).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });

  const printModel = useMemo((): TicketPrintModel => {
    const requestType =
      ticket.requestType && typeof ticket.requestType === "string"
        ? requestTypeLabel(ticket.requestType)
        : paymentDetails
          ? requestTypeLabel("REQUEST_FOR_PAYMENT")
          : requisitionDetails
            ? requestTypeLabel("ITEM_REQUISITION_SLIP")
            : fundTransferDetails
              ? requestTypeLabel("FUND_TRANSFER_REQUEST")
              : isJobOrderRequest
                ? requestTypeLabel("JOB_ORDER")
                : showAcaLayout
                  ? requestTypeLabel("AUTHORITY_TO_CONDUCT_ACTIVITY")
                  : requestTypeLabel("ISSUE_CONCERN_TICKET");

    const title = paymentDetails
      ? formatPaymentRequestTitle({
          payee: paymentDetails.payee,
          inPaymentOf: paymentDetails.inPaymentOf,
          amount: paymentDetails.amount,
        }) || ticket.title
      : ticket.title;

    const proceduralLabel =
      paymentProceduralLabel ??
      requisitionProceduralLabel ??
      fundTransferProceduralLabel ??
      jobOrderProceduralLabel ??
      acaProceduralLabelText ??
      null;

    const fields: TicketPrintField[] = [];
    let table: TicketPrintModel["table"] = null;
    let notes: string | null = null;
    const approvals: NonNullable<TicketPrintModel["approvals"]> = [];

    if (paymentDetails) {
      fields.push(
        { label: "Payee", value: paymentDetails.payee || "—" },
        { label: "In payment of", value: paymentDetails.inPaymentOf || "—" },
        { label: "Account title", value: paymentDetails.accountTitle || "—" },
        {
          label: "Amount",
          value: paymentDetails.amount
            ? formatPaymentPeso(paymentDetails.amount) || paymentDetails.amount
            : "—",
        },
        { label: "Mode of payment", value: paymentDetails.modeOfPayment || "—" },
      );
      if (paymentDetails.deliveryOfCheck) {
        fields.push({ label: "Delivery of check", value: paymentDetails.deliveryOfCheck });
      }
      if (paymentDetails.bankNameAccountNumber) {
        fields.push({
          label: "Bank name / account number",
          value: paymentDetails.bankNameAccountNumber,
        });
      }
      if (paymentDetails.notes) notes = paymentDetails.notes;
      if (paymentApprovalMeta) {
        for (const step of paymentApprovalStepsFor(paymentApprovalMeta)) {
          const agentId = assigneeIdForStep(paymentApprovalMeta, step);
          const name = agentId
            ? paymentApprovalAgentNames[agentId]?.trim() || "Unknown"
            : "—";
          approvals.push({
            label: PAYMENT_APPROVAL_STEP_LABELS[step],
            name,
            done: Boolean(paymentApprovalMeta.completed[step]),
          });
        }
      }
    } else if (requisitionDetails) {
      const showPricing =
        requisitionDetails.items.some(
          (i) => i.priceQuotation || i.unitPrice || i.total || i.nameOfSupplier || i.terms,
        ) || Boolean(isRequisitionRequest && ticket.assignedAgentId);
      table = {
        headers: showPricing
          ? ["Item #", "Qty", "Unit", "Particular", "Unit price", "Quotation", "Supplier", "Terms"]
          : ["Item #", "Qty", "Unit", "Particular"],
        rows: requisitionDetails.items.map((item) => {
          const base = [
            item.itemNumber || "—",
            item.quantity || "—",
            item.unit || "—",
            item.particular || "—",
          ];
          if (!showPricing) return base;
          return [
            ...base,
            formatRequisitionPeso(item.unitPrice) || "—",
            formatRequisitionPeso(
              item.priceQuotation || computeRequisitionPriceQuotation(item),
            ) || "—",
            item.nameOfSupplier || "—",
            item.terms || "—",
          ];
        }),
      };
      fields.push({
        label: "Grand total",
        value: formatRequisitionPeso(requisitionListedItemsTotal) || "—",
      });
      if (requisitionDetails.purposeOfRequest) {
        notes = requisitionDetails.purposeOfRequest;
      }
      if (itemRequisitionApprovalMeta) {
        for (const step of ITEM_REQUISITION_APPROVAL_STEPS) {
          const agentId = itemRequisitionAssigneeIdForStep(itemRequisitionApprovalMeta, step);
          approvals.push({
            label: ITEM_REQUISITION_APPROVAL_STEP_LABELS[step],
            name: agentId
              ? itemRequisitionApprovalAgentNames[agentId]?.trim() || "Unknown"
              : "—",
            done: Boolean(itemRequisitionApprovalMeta.completed[step]),
          });
        }
      }
    } else if (fundTransferDetails) {
      fields.push(
        {
          label: "Requesting department",
          value: fundTransferDetails.requestingDepartmentBusinessUnit || "—",
        },
        {
          label: "Fund transfer amount",
          value: formatFundTransferPeso(fundTransferDetails.fundTransferAmount) || "—",
        },
        {
          label: "From account",
          value: [
            fundTransferDetails.fromAccountName,
            fundTransferDetails.fromAccountNumber,
          ]
            .filter(Boolean)
            .join(" · ") || "—",
        },
        {
          label: "To account",
          value: [
            fundTransferDetails.toAccountName,
            fundTransferDetails.toAccountNumber,
          ]
            .filter(Boolean)
            .join(" · ") || "—",
        },
        { label: "Bank name", value: fundTransferDetails.bankName || "—" },
        { label: "Bank address", value: fundTransferDetails.bankAddress || "—" },
      );
      if (fundTransferDetails.reason) notes = fundTransferDetails.reason;
      if (fundTransferApprovalMeta) {
        // Prepared By is intake-only (ticket header); do not repeat in approvals.
        for (const step of FUND_TRANSFER_APPROVAL_STEPS) {
          if (step === "PREPARED_BY") continue;
          const agentId = fundTransferAssigneeIdForStep(fundTransferApprovalMeta, step);
          const assigneeName = agentId
            ? fundTransferApprovalAgentNames[agentId]?.trim() || null
            : null;
          approvals.push({
            label: FUND_TRANSFER_APPROVAL_STEP_LABELS[step],
            name: assigneeName || "—",
            done: Boolean(fundTransferApprovalMeta.completed[step]),
          });
        }
      }
    } else if (isJobOrderRequest && jobOrderDetails) {
      fields.push(
        {
          label: "Nature of concern",
          value:
            jobOrderDetails.natureOfConcern.length > 0
              ? jobOrderDetails.natureOfConcern.join(", ")
              : "—",
        },
        { label: "Building", value: jobOrderDetails.building || "—" },
        { label: "Expected duration", value: jobOrderDetails.expectedDuration || "—" },
        { label: "Start date", value: jobOrderDetails.startDate || "—" },
        { label: "Target date", value: jobOrderDetails.targetDate || "—" },
      );
      if (jobOrderDetails.notes) notes = jobOrderDetails.notes;
      if (jobOrderApprovalMeta) {
        for (const step of jobOrderApprovalStepsFor(jobOrderApprovalMeta)) {
          const agentId = jobOrderAssigneeIdForStep(jobOrderApprovalMeta, step);
          const assigneeName = agentId
            ? jobOrderApprovalAgentNames[agentId]?.trim() || null
            : null;
          approvals.push({
            label: step === "NOTED_BY" ? "Noted By" : "Approved By",
            name: assigneeName || "—",
            done: Boolean(jobOrderApprovalMeta.completed[step]),
          });
        }
      }
    } else if (showAcaLayout) {
      fields.push(
        {
          label: "Department / Store",
          value: acaDetails?.departmentStore || acaApprovalMeta?.departmentStore || "—",
        },
        {
          label: "Nature of request",
          value: acaDetails?.natureOfRequest || acaApprovalMeta?.natureOfRequest || "—",
        },
        {
          label: "Estimated cost",
          value:
            formatAcaPeso(acaDetails?.estimatedCost) ||
            formatAcaPeso(acaApprovalMeta?.estimatedCost) ||
            "—",
        },
        {
          label: "Budget amount",
          value:
            formatAcaPeso(acaDetails?.budgetAmount) ||
            formatAcaPeso(acaApprovalMeta?.budgetAmount) ||
            "—",
        },
        { label: "Date submitted", value: acaDetails?.dateSubmitted || "—" },
        {
          label: "Implementation date",
          value: acaDetails?.implementationDate || acaApprovalMeta?.implementationDate || "—",
        },
      );
      const desc = acaDetails?.description || acaApprovalMeta?.description || "";
      const objective = acaDetails?.objective || acaApprovalMeta?.objective || "";
      notes = [desc && `Description:\n${desc}`, objective && `Objective:\n${objective}`]
        .filter(Boolean)
        .join("\n\n");
      if (acaApprovalMeta) {
        for (const level of acaApprovalMeta.levels) {
          if (level.key === "SUBMITTED_BY") continue;
          if (!acaLevelShowsInExeComTable(level.roleCode)) continue;
          approvals.push({
            label: level.label,
            name: level.agentId
              ? acaApprovalAgentNames[level.agentId]?.trim() || "Unknown"
              : "—",
            done: Boolean(level.approvedAt),
          });
        }
      }
    } else {
      notes = cleanedDescription || ticket.description || null;
    }

    return {
      ticketNumber: ticket.ticketNumber,
      requestTypeLabel: requestType,
      priority: formatTicketPriorityLabel(ticket.priority),
      status: formatTicketStatusLabel(ticket.status),
      proceduralLabel,
      createdAtLabel,
      title,
      fields,
      table,
      notes,
      approvals,
      meta: [
        { label: isAcaRequest ? "Submitted By" : "Requestor", value: ticket.contactName?.trim() || "—" },
        { label: "Company", value: ticket.team?.name?.trim() || "—" },
        {
          label: "Assignee",
          value: ticket.assignedAgent?.name?.trim() || "Unassigned",
        },
      ],
    };
  }, [
    ticket,
    paymentDetails,
    requisitionDetails,
    fundTransferDetails,
    acaDetails,
    jobOrderDetails,
    isJobOrderRequest,
    isAcaRequest,
    cleanedDescription,
    paymentProceduralLabel,
    requisitionProceduralLabel,
    fundTransferProceduralLabel,
    jobOrderProceduralLabel,
    acaProceduralLabelText,
    paymentApprovalMeta,
    paymentApprovalAgentNames,
    itemRequisitionApprovalMeta,
    itemRequisitionApprovalAgentNames,
    fundTransferApprovalMeta,
    fundTransferApprovalAgentNames,
    jobOrderApprovalMeta,
    jobOrderApprovalAgentNames,
    acaApprovalMeta,
    acaApprovalAgentNames,
    isRequisitionRequest,
    isJobOrderRequest,
    showAcaLayout,
    requisitionListedItemsTotal,
    createdAtLabel,
  ]);

  return (
    <div className="grid min-w-0 gap-4 pb-1 sm:gap-5 xl:grid-cols-[minmax(0,1.85fr)_minmax(280px,1fr)] xl:items-start">
      <div className="min-w-0 space-y-4">
      <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-[0_18px_45px_rgba(15,23,42,0.10)] dark:border-zinc-800 dark:bg-[#0a101d] dark:shadow-[0_14px_40px_rgba(0,0,0,0.3)]">
        <div className="flex flex-col">
        <div className="border-b border-zinc-200 px-3 py-3 sm:px-5 sm:py-4 dark:border-zinc-800/90">
          <div className="flex flex-wrap items-start justify-between gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-500">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="break-all text-zinc-700 dark:text-zinc-300">{ticket.ticketNumber}</span>
            <span className="rounded-full bg-zinc-200 px-2 py-0.5 text-[10px] text-zinc-700 dark:bg-zinc-700/70 dark:text-zinc-200">
              {formatTicketPriorityLabel(ticket.priority)}
            </span>
            <TicketDetailsPrintButton model={printModel} />
          </div>
            <time
              dateTime={
                ticket.createdAt instanceof Date
                  ? ticket.createdAt.toISOString()
                  : new Date(ticket.createdAt).toISOString()
              }
              className="shrink-0 text-right text-xs font-semibold normal-case tracking-normal text-zinc-600 dark:text-zinc-300 sm:text-sm"
              title="Request created"
            >
              {createdAtLabel}
            </time>
          </div>
          <h2 className="mt-2 break-words text-lg font-bold tracking-tight text-zinc-950 sm:text-2xl md:text-3xl dark:text-zinc-100">
            {paymentDetails
              ? formatPaymentRequestTitle({
                  payee: paymentDetails.payee,
                  inPaymentOf: paymentDetails.inPaymentOf,
                  amount: paymentDetails.amount,
                }) || ticket.title
              : ticket.title}
          </h2>
          {paymentProceduralLabel ? (
            <p className="mt-2 inline-flex rounded-full border border-amber-400/40 bg-amber-500/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-amber-800 dark:text-amber-200">
              {paymentProceduralLabel}
            </p>
          ) : requisitionProceduralLabel ? (
            <p className="mt-2 inline-flex rounded-full border border-amber-400/40 bg-amber-500/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-amber-800 dark:text-amber-200">
              {requisitionProceduralLabel}
            </p>
          ) : fundTransferProceduralLabel ? (
            <p className="mt-2 inline-flex rounded-full border border-amber-400/40 bg-amber-500/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-amber-800 dark:text-amber-200">
              {fundTransferProceduralLabel}
            </p>
          ) : jobOrderProceduralLabel ? (
            <p className="mt-2 inline-flex rounded-full border border-amber-400/40 bg-amber-500/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-amber-800 dark:text-amber-200">
              {jobOrderProceduralLabel}
            </p>
          ) : acaProceduralLabelText ? (
            <p className="mt-2 inline-flex rounded-full border border-amber-400/40 bg-amber-500/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-amber-800 dark:text-amber-200">
              {acaProceduralLabelText}
            </p>
          ) : null}
          {paymentDetails ? (
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6">
              <dl className="space-y-2 text-sm">
                <div>
                  <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-500">
                    Payee
                  </dt>
                  <dd className="mt-0.5 break-words font-medium text-zinc-800 dark:text-zinc-200">
                    {paymentDetails.payee || "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-500">
                    In payment of
                  </dt>
                  <dd className="mt-0.5 break-words font-medium text-zinc-800 dark:text-zinc-200">
                    {paymentDetails.inPaymentOf || "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-500">
                    Account title
                  </dt>
                  <dd className="mt-0.5 break-words font-medium text-zinc-800 dark:text-zinc-200">
                    {paymentDetails.accountTitle || "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-500">
                    Amount
                  </dt>
                  <dd className="mt-0.5 break-words font-medium text-zinc-800 dark:text-zinc-200">
                    {paymentDetails.amount
                      ? formatPaymentPeso(paymentDetails.amount) || paymentDetails.amount
                      : "—"}
                  </dd>
                </div>
              </dl>
              <dl className="space-y-2 text-sm">
                {showPaymentModeEditor ? (
                  <>
                    <div>
                      <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-500">
                        Mode of payment
                      </dt>
                      <dd className="mt-1">
                        <select
                          value={paymentModeDraft.modeOfPayment}
                          onChange={(e) => {
                            const next = e.target.value;
                            setPaymentModeDraft((prev) => ({
                              ...prev,
                              modeOfPayment: next,
                              deliveryOfCheck:
                                next === MODE_OF_PAYMENT_CHECK ? prev.deliveryOfCheck : "",
                              bankNameAccountNumber: paymentModeShowsBankDetails(
                                next,
                                next === MODE_OF_PAYMENT_CHECK ? prev.deliveryOfCheck : "",
                              )
                                ? prev.bankNameAccountNumber
                                : "",
                            }));
                          }}
                          className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 outline-none focus:border-orange-500 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
                        >
                          <option value="">Select mode of payment</option>
                          {MODE_OF_PAYMENT_OPTIONS.map((mode) => (
                            <option key={mode} value={mode}>
                              {mode}
                            </option>
                          ))}
                        </select>
                      </dd>
                    </div>
                    {paymentModeDraft.modeOfPayment === MODE_OF_PAYMENT_CHECK ? (
                      <div>
                        <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-500">
                          Delivery of check
                        </dt>
                        <dd className="mt-1">
                          <select
                            value={paymentModeDraft.deliveryOfCheck}
                            onChange={(e) => {
                              const next = e.target.value;
                              setPaymentModeDraft((prev) => ({
                                ...prev,
                                deliveryOfCheck: next,
                                bankNameAccountNumber: paymentModeShowsBankDetails(
                                  prev.modeOfPayment,
                                  next,
                                )
                                  ? prev.bankNameAccountNumber
                                  : "",
                              }));
                            }}
                            className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 outline-none focus:border-orange-500 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
                          >
                            <option value="">Select delivery of check</option>
                            {DELIVERY_OF_CHECK_OPTIONS.map((opt) => (
                              <option key={opt} value={opt}>
                                {opt}
                              </option>
                            ))}
                          </select>
                        </dd>
                      </div>
                    ) : null}
                    {paymentModeShowsBankDetails(
                      paymentModeDraft.modeOfPayment,
                      paymentModeDraft.deliveryOfCheck,
                    ) ? (
                      <div>
                        <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-500">
                          Bank name / account number
                          {!paymentModeRequiresBankDetails(
                            paymentModeDraft.modeOfPayment,
                            paymentModeDraft.deliveryOfCheck,
                          ) ? (
                            <span className="ml-1 font-normal normal-case tracking-normal text-zinc-400">
                              (optional)
                            </span>
                          ) : null}
                        </dt>
                        <dd className="mt-1">
                          <input
                            type="text"
                            value={paymentModeDraft.bankNameAccountNumber}
                            onChange={(e) =>
                              setPaymentModeDraft((prev) => ({
                                ...prev,
                                bankNameAccountNumber: e.target.value,
                              }))
                            }
                            maxLength={200}
                            placeholder="e.g. BDO · 0012-3456-7890"
                            className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 outline-none focus:border-orange-500 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
                          />
                        </dd>
                      </div>
                    ) : null}
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          patch({
                            action: "update_payment_mode",
                            modeOfPayment: paymentModeDraft.modeOfPayment,
                            deliveryOfCheck: paymentModeDraft.deliveryOfCheck,
                            bankNameAccountNumber: paymentModeDraft.bankNameAccountNumber,
                          })
                        }
                        className="min-h-9 rounded-lg border border-orange-500/40 bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-500 disabled:opacity-60"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        disabled={busy || paymentModeNeedsInitialSet}
                        onClick={() => setPaymentModeEditing(true)}
                        className="min-h-9 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900"
                      >
                        Edit
                      </button>
                      <p className="basis-full text-[11px] text-zinc-500 dark:text-zinc-400">
                        {canAssignDeferredAccountingFinance
                          ? "Save mode of payment, then assign Bookkeeper and Accounting below before continuing."
                          : "Save locks this section to read-only. Use Edit to change it again afterward."}
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-500">
                        Mode of payment
                      </dt>
                      <dd className="mt-0.5 break-words font-medium text-zinc-800 dark:text-zinc-200">
                        {paymentDetails.modeOfPayment ||
                          (paymentApprovalMeta?.deferPaymentModeToAccounting
                            ? "To be set by Finance"
                            : "—")}
                      </dd>
                    </div>
                    {paymentDetails.deliveryOfCheck ? (
                      <div>
                        <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-500">
                          Delivery of check
                        </dt>
                        <dd className="mt-0.5 break-words font-medium text-zinc-800 dark:text-zinc-200">
                          {paymentDetails.deliveryOfCheck}
                        </dd>
                      </div>
                    ) : null}
                    {paymentDetails.bankNameAccountNumber ? (
                      <div>
                        <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-500">
                          Bank name / account number
                        </dt>
                        <dd className="mt-0.5 break-words font-medium text-zinc-800 dark:text-zinc-200">
                          {paymentDetails.bankNameAccountNumber}
                        </dd>
                      </div>
                    ) : null}
                    {canEditPaymentMode ? (
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <button
                          type="button"
                          disabled={busy || !paymentModeEditing}
                          onClick={() =>
                            patch({
                              action: "update_payment_mode",
                              modeOfPayment: paymentModeDraft.modeOfPayment,
                              deliveryOfCheck: paymentModeDraft.deliveryOfCheck,
                              bankNameAccountNumber: paymentModeDraft.bankNameAccountNumber,
                            })
                          }
                          className="min-h-9 rounded-lg border border-orange-500/40 bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-500 disabled:opacity-60"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setPaymentModeEditing(true)}
                          className="min-h-9 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900"
                        >
                          Edit
                        </button>
                        <p className="basis-full text-[11px] text-zinc-500 dark:text-zinc-400">
                          Click Edit to change mode of payment, then Save to lock it again.
                        </p>
                      </div>
                    ) : null}
                  </>
                )}
                {paymentDetails.notes ? (
                  <div>
                    <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-500">
                      Additional notes
                    </dt>
                    <dd className="mt-0.5 whitespace-pre-wrap break-words font-medium text-zinc-800 dark:text-zinc-200">
                      {paymentDetails.notes}
                    </dd>
                  </div>
                ) : null}
              </dl>
            </div>
          ) : requisitionDetails ? (
            <div className="mt-3 space-y-4">
              <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-zinc-100 text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-500 dark:bg-zinc-900/60 dark:text-zinc-400">
                    <tr>
                      <th className="px-3 py-2">Item #</th>
                      <th className="px-3 py-2">Qty</th>
                      <th className="px-3 py-2">Unit</th>
                      <th className="px-3 py-2">Particular / material / specification</th>
                      {showRequisitionPricingColumns ? (
                        <>
                          <th className="px-3 py-2">Unit price</th>
                          <th className="px-3 py-2">Price quotation</th>
                          <th className="px-3 py-2">Name of supplier</th>
                          <th className="px-3 py-2">Terms</th>
                        </>
                      ) : null}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                    {requisitionDetails.items.map((item, index) => {
                      const draft = pricingDraft[index];
                      return (
                        <tr key={`req-view-${index}`} className="align-top">
                          <td className="px-3 py-2 font-medium text-zinc-800 dark:text-zinc-200">
                            {item.itemNumber || "—"}
                          </td>
                          <td className="px-3 py-2 text-zinc-800 dark:text-zinc-200">
                            {item.quantity || "—"}
                          </td>
                          <td className="px-3 py-2 text-zinc-800 dark:text-zinc-200">
                            {item.unit || "—"}
                          </td>
                          <td className="px-3 py-2 whitespace-pre-wrap text-zinc-800 dark:text-zinc-200">
                            {item.particular || "—"}
                          </td>
                          {showRequisitionPricingColumns ? (
                            showRequisitionPricingEditor ? (
                              <>
                                <td className="px-3 py-2">
                                  <div className="flex min-w-[6.5rem] items-center gap-1">
                                    <span className="shrink-0 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                                      ₱
                                    </span>
                                    <input
                                      type="text"
                                      inputMode="decimal"
                                      value={draft?.unitPrice ?? ""}
                                      onChange={(e) =>
                                        updatePricingRow(index, {
                                          unitPrice: sanitizeRequisitionFloatInput(e.target.value),
                                        })
                                      }
                                      onBlur={() => {
                                        const normalized = normalizeRequisitionMoneyInput(
                                          draft?.unitPrice ?? "",
                                        );
                                        if (normalized !== (draft?.unitPrice ?? "")) {
                                          updatePricingRow(index, { unitPrice: normalized });
                                        }
                                      }}
                                      className="min-w-0 flex-1 rounded border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-900 outline-none focus:border-orange-500 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
                                      placeholder="0.00"
                                    />
                                  </div>
                                </td>
                                <td className="px-3 py-2">
                                  <div className="flex min-w-[7.5rem] items-center gap-1">
                                    <span className="shrink-0 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                                      ₱
                                    </span>
                                    <input
                                      type="text"
                                      inputMode="decimal"
                                      value={draft?.priceQuotation ?? ""}
                                      readOnly
                                      title="Auto-computed: Quantity × Unit Price"
                                      className="min-w-0 flex-1 cursor-default rounded border border-zinc-300 bg-zinc-100 px-2 py-1 text-sm text-zinc-900 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
                                      placeholder="0.00"
                                    />
                                  </div>
                                </td>
                                <td className="px-3 py-2">
                                  <input
                                    type="text"
                                    value={draft?.nameOfSupplier ?? ""}
                                    onChange={(e) =>
                                      updatePricingRow(index, { nameOfSupplier: e.target.value })
                                    }
                                    className="min-w-[8rem] rounded border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-900 outline-none focus:border-orange-500 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
                                    placeholder="—"
                                  />
                                </td>
                                <td className="px-3 py-2">
                                  <input
                                    type="text"
                                    inputMode="numeric"
                                    value={draft?.terms ?? ""}
                                    onChange={(e) =>
                                      updatePricingRow(index, {
                                        terms: sanitizeRequisitionIntegerInput(e.target.value),
                                      })
                                    }
                                    className="min-w-[5rem] rounded border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-900 outline-none focus:border-orange-500 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
                                    placeholder="0"
                                  />
                                </td>
                              </>
                            ) : (
                              <>
                                <td className="px-3 py-2 text-zinc-800 dark:text-zinc-200">
                                  {formatRequisitionPeso(item.unitPrice) || "—"}
                                </td>
                                <td className="px-3 py-2 text-zinc-800 dark:text-zinc-200">
                                  {formatRequisitionPeso(
                                    item.priceQuotation || computeRequisitionPriceQuotation(item),
                                  ) || "—"}
                                </td>
                                <td className="px-3 py-2 text-zinc-800 dark:text-zinc-200">
                                  {item.nameOfSupplier || "—"}
                                </td>
                                <td className="px-3 py-2 text-zinc-800 dark:text-zinc-200">
                                  {item.terms || "—"}
                                </td>
                              </>
                            )
                          ) : null}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {canEditRequisitionPricing ? (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={busy || !showRequisitionPricingEditor}
                      onClick={() =>
                        patch({
                          action: "update_item_requisition_pricing",
                          items: pricingDraft,
                        })
                      }
                      className="min-h-9 rounded-lg border border-orange-500/40 bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-500 disabled:opacity-60"
                    >
                      Save Pricing
                    </button>
                    <button
                      type="button"
                      disabled={busy || requisitionPricingNeedsInitialSet}
                      onClick={() => setRequisitionPricingEditing(true)}
                      className="min-h-9 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900"
                    >
                      Edit
                    </button>
                  </div>
                  {currentRequisitionStep === "CANVASSED_BY" ? (
                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                      Saving pricing stamps you as Canvassed By and returns this request to the
                      Assignment Board for Approved By.
                    </p>
                  ) : (
                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                      {showRequisitionPricingEditor
                        ? "Save Pricing locks this section to read-only. Use Edit to change it again afterward."
                        : "Click Edit to change pricing, then Save Pricing to lock it again."}
                    </p>
                  )}
                </div>
              ) : null}
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-500">
                  Grand Total
                </p>
                <p className="mt-1 break-words text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  {formatRequisitionPeso(requisitionListedItemsTotal) || "—"}
                </p>
              </div>
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-500">
                  Purpose of request
                </p>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm font-medium text-zinc-800 dark:text-zinc-200">
                  {requisitionDetails.purposeOfRequest || "—"}
                </p>
              </div>
            </div>
          ) : fundTransferDetails ? (
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6">
              <dl className="space-y-2 text-sm">
                <div>
                  <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-500">
                    Requesting department
                  </dt>
                  <dd className="mt-0.5 break-words font-medium text-zinc-800 dark:text-zinc-200">
                    {fundTransferDetails.requestingDepartmentBusinessUnit || "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-500">
                    Fund transfer amount
                  </dt>
                  <dd className="mt-0.5 break-words font-medium text-zinc-800 dark:text-zinc-200">
                    {formatFundTransferPeso(fundTransferDetails.fundTransferAmount) || "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-500">
                    From account
                  </dt>
                  <dd className="mt-0.5 break-words font-medium text-zinc-800 dark:text-zinc-200">
                    {fundTransferDetails.fromAccountName || "—"}
                    {fundTransferDetails.fromAccountNumber
                      ? ` · ${fundTransferDetails.fromAccountNumber}`
                      : ""}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-500">
                    To account
                  </dt>
                  <dd className="mt-0.5 break-words font-medium text-zinc-800 dark:text-zinc-200">
                    {fundTransferDetails.toAccountName || "—"}
                    {fundTransferDetails.toAccountNumber
                      ? ` · ${fundTransferDetails.toAccountNumber}`
                      : ""}
                  </dd>
                </div>
              </dl>
              <dl className="space-y-2 text-sm">
                <div>
                  <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-500">
                    Bank name
                  </dt>
                  <dd className="mt-0.5 break-words font-medium text-zinc-800 dark:text-zinc-200">
                    {fundTransferDetails.bankName || "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-500">
                    Bank address
                  </dt>
                  <dd className="mt-0.5 break-words font-medium text-zinc-800 dark:text-zinc-200">
                    {fundTransferDetails.bankAddress || "—"}
                  </dd>
                </div>
                {fundTransferDetails.reason ? (
                  <div>
                    <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-500">
                      Reason / special instruction
                    </dt>
                    <dd className="mt-0.5 whitespace-pre-wrap break-words font-medium text-zinc-800 dark:text-zinc-200">
                      {fundTransferDetails.reason}
                    </dd>
                  </div>
                ) : null}
              </dl>
            </div>
          ) : isJobOrderRequest ? (
            <div className="mt-3 space-y-3 text-sm">
              {jobOrderDetails ? (
                <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-500">
                      Nature of concern
                    </dt>
                    <dd className="mt-0.5 break-words font-medium text-zinc-800 dark:text-zinc-200">
                      {jobOrderDetails.natureOfConcern.length > 0
                        ? jobOrderDetails.natureOfConcern.join(", ")
                        : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-500">
                      Building
                    </dt>
                    <dd className="mt-0.5 break-words font-medium text-zinc-800 dark:text-zinc-200">
                      {jobOrderDetails.building || "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-500">
                      Expected duration
                    </dt>
                    <dd className="mt-0.5 break-words font-medium text-zinc-800 dark:text-zinc-200">
                      {jobOrderDetails.expectedDuration || "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-500">
                      Start date
                    </dt>
                    <dd className="mt-0.5 break-words font-medium text-zinc-800 dark:text-zinc-200">
                      {jobOrderDetails.startDate || "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-500">
                      Target date
                    </dt>
                    <dd className="mt-0.5 break-words font-medium text-zinc-800 dark:text-zinc-200">
                      {jobOrderDetails.targetDate || "—"}
                    </dd>
                  </div>
                </dl>
              ) : (
                <p className="whitespace-pre-wrap break-words text-zinc-800 dark:text-zinc-200">
                  {cleanedDescription || ticket.description || "—"}
                </p>
              )}
              {jobOrderDetails?.notes ? (
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-500">
                    Additional notes
                  </p>
                  <p className="mt-1 whitespace-pre-wrap break-words font-medium text-zinc-800 dark:text-zinc-200">
                    {jobOrderDetails.notes}
                  </p>
                </div>
              ) : null}
            </div>
          ) : showAcaLayout ? (
            <div className="mt-3 grid grid-cols-1 gap-4 border border-zinc-300 bg-white p-3 text-sm dark:border-zinc-700 dark:bg-zinc-950/40 sm:grid-cols-2 sm:gap-6 sm:p-4">
              <dl className="space-y-2">
                <div>
                  <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-zinc-500">
                    Department / Store
                  </dt>
                  <dd className="mt-0.5 font-medium text-zinc-800 dark:text-zinc-200">
                    {acaDetails?.departmentStore || acaApprovalMeta?.departmentStore || "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-zinc-500">
                    Nature of Request
                  </dt>
                  <dd className="mt-0.5 font-medium text-zinc-800 dark:text-zinc-200">
                    {acaDetails?.natureOfRequest || acaApprovalMeta?.natureOfRequest || "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-zinc-500">
                    Estimated Cost
                  </dt>
                  <dd className="mt-0.5 font-medium text-zinc-800 dark:text-zinc-200">
                    {formatAcaPeso(acaDetails?.estimatedCost) ||
                      formatAcaPeso(acaApprovalMeta?.estimatedCost) ||
                      "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-zinc-500">
                    Budget Amount
                  </dt>
                  <dd className="mt-0.5 font-medium text-zinc-800 dark:text-zinc-200">
                    {formatAcaPeso(acaDetails?.budgetAmount) ||
                      formatAcaPeso(acaApprovalMeta?.budgetAmount) ||
                      "—"}
                  </dd>
                </div>
              </dl>
              <dl className="space-y-2">
                <div>
                  <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-zinc-500">
                    Date Submitted
                  </dt>
                  <dd className="mt-0.5 font-medium text-zinc-800 dark:text-zinc-200">
                    {acaDetails?.dateSubmitted || "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-zinc-500">
                    Implementation Date
                  </dt>
                  <dd className="mt-0.5 font-medium text-zinc-800 dark:text-zinc-200">
                    {acaDetails?.implementationDate || acaApprovalMeta?.implementationDate || "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-zinc-500">
                    Description
                  </dt>
                  <dd className="mt-0.5 whitespace-pre-wrap font-medium text-zinc-800 dark:text-zinc-200">
                    {acaDetails?.description || acaApprovalMeta?.description || "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-zinc-500">
                    Objective
                  </dt>
                  <dd className="mt-0.5 whitespace-pre-wrap font-medium text-zinc-800 dark:text-zinc-200">
                    {acaDetails?.objective || acaApprovalMeta?.objective || "—"}
                  </dd>
                </div>
              </dl>
            </div>
          ) : (
            <p className="mt-2 max-w-4xl whitespace-pre-wrap break-words text-sm leading-relaxed text-zinc-700 sm:text-base dark:text-zinc-300">
              {cleanedDescription}
            </p>
          )}
          {paymentDetails && paymentApprovalMeta ? (
            <div
              className={`mt-4 grid grid-cols-1 items-start gap-x-4 gap-y-3 border-t border-zinc-200 pt-4 sm:grid-cols-2 dark:border-zinc-800/80 ${
                paymentApprovalMeta.skipApprovedBy || paymentApprovalMeta.skipNotedBy
                  ? "lg:grid-cols-3"
                  : "lg:grid-cols-5"
              }`}
            >
              {paymentApprovalStepsFor(paymentApprovalMeta).map((step) => {
                const completedAt = paymentApprovalMeta.completed[step];
                const agentId = assigneeIdForStep(paymentApprovalMeta, step);
                const name = agentId
                  ? paymentApprovalAgentNames[agentId]?.trim() || "Unknown"
                  : null;
                const showApprovedAndDone =
                  Boolean(completedAt) &&
                  (step === "APPROVED_BY_ACCOUNTING" || step === "APPROVED_BY_FINANCE");
                return (
                  <div key={step} className="min-w-0 self-start">
                    <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-500">
                      {PAYMENT_APPROVAL_STEP_LABELS[step]}
                    </p>
                    <p
                      className={`mt-1 break-words text-sm font-medium leading-snug ${
                        completedAt
                          ? "text-emerald-800 dark:text-emerald-300"
                          : name
                            ? "text-zinc-800 dark:text-zinc-200"
                            : "text-zinc-400 dark:text-zinc-600"
                      }`}
                    >
                      {completedAt ? (name ?? "Completed") : (name ?? "—")}
                    </p>
                    {showApprovedAndDone ? (
                      <p className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-emerald-700 dark:text-emerald-400">
                        Approved and Done
                      </p>
                    ) : null}
                    {step === currentPaymentStep && canCompleteCurrentPaymentStep ? (
                      <div className="mt-2 space-y-1.5">
                        {canMarkCurrentPaymentApproved ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => patch({ action: "approve_payment_step" })}
                            className="min-h-9 w-full rounded-lg border border-sky-500/50 bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-60"
                          >
                            Approved
                          </button>
                        ) : null}
                        {currentStepNeedsApprovedAck && !currentStepApprovedAck ? (
                          <p className="text-[11px] font-medium text-amber-700 dark:text-amber-300">
                            Click Approved first. Done hands the request to the next role.
                          </p>
                        ) : currentStepNeedsApprovedAck && currentStepApprovedAck ? (
                          <p className="text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                            Approved recorded. Click Done to hand off to the next role.
                          </p>
                        ) : null}
                        <button
                          type="button"
                          disabled={busy || !canMarkCurrentPaymentDone}
                          onClick={() => patch({ action: "complete_payment_approval_step" })}
                          className="min-h-9 w-full rounded-lg border border-emerald-500/50 bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
                        >
                          {currentStepNeedsApprovedAck
                            ? "Done"
                            : `Complete ${PAYMENT_APPROVAL_STEP_LABELS[currentPaymentStep]}`}
                        </button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}
          {requisitionDetails && itemRequisitionApprovalMeta ? (
            <div className="mt-4 grid grid-cols-1 items-start gap-x-4 gap-y-3 border-t border-zinc-200 pt-4 sm:grid-cols-2 dark:border-zinc-800/80">
              {ITEM_REQUISITION_APPROVAL_STEPS.map((step) => {
                const completedAt = itemRequisitionApprovalMeta.completed[step];
                const agentId = itemRequisitionAssigneeIdForStep(itemRequisitionApprovalMeta, step);
                const name = agentId
                  ? itemRequisitionApprovalAgentNames[agentId]?.trim() || "Unknown"
                  : null;
                return (
                  <div key={step} className="min-w-0 self-start">
                    <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-500">
                      {ITEM_REQUISITION_APPROVAL_STEP_LABELS[step]}
                    </p>
                    <p
                      className={`mt-1 break-words text-sm font-medium leading-snug ${
                        completedAt && name
                          ? "text-emerald-800 dark:text-emerald-300"
                          : name
                            ? "text-zinc-800 dark:text-zinc-200"
                            : "text-zinc-400 dark:text-zinc-600"
                      }`}
                    >
                      {name ?? "—"}
                    </p>
                    {step === currentRequisitionStep && canCompleteCurrentRequisitionStep ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          patch({
                            action: "complete_item_requisition_approval_step",
                            items: pricingDraft,
                          })
                        }
                        className="mt-2 min-h-9 w-full rounded-lg border border-emerald-500/50 bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
                      >
                        Complete {ITEM_REQUISITION_APPROVAL_STEP_LABELS[currentRequisitionStep]}
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}
          {fundTransferDetails && fundTransferApprovalMeta ? (
            <div className="mt-4 grid grid-cols-1 items-start gap-x-4 gap-y-3 border-t border-zinc-200 pt-4 sm:grid-cols-2 dark:border-zinc-800/80">
              {/* Prepared By is intake-only (ticket header); form shows procedural roles only. */}
              {FUND_TRANSFER_APPROVAL_STEPS.filter((step) => step !== "PREPARED_BY").map((step) => {
                const completedAt = fundTransferApprovalMeta.completed[step];
                const agentId = fundTransferAssigneeIdForStep(fundTransferApprovalMeta, step);
                const name = agentId
                  ? fundTransferApprovalAgentNames[agentId]?.trim() || null
                  : null;
                return (
                  <div key={step} className="min-w-0 self-start">
                    <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-500">
                      {FUND_TRANSFER_APPROVAL_STEP_LABELS[step]}
                    </p>
                    <p
                      className={`mt-1 break-words text-sm font-medium leading-snug ${
                        completedAt && name
                          ? "text-emerald-800 dark:text-emerald-300"
                          : name
                            ? "text-zinc-800 dark:text-zinc-200"
                            : "text-zinc-400 dark:text-zinc-600"
                      }`}
                    >
                      {name ?? "—"}
                    </p>
                    {step === currentFundTransferStep && canCompleteCurrentFundTransferStep ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => patch({ action: "complete_fund_transfer_approval_step" })}
                        className="mt-2 min-h-9 w-full rounded-lg border border-emerald-500/50 bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
                      >
                        Complete {FUND_TRANSFER_APPROVAL_STEP_LABELS[currentFundTransferStep]}
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}
          {isJobOrderRequest && jobOrderApprovalMeta ? (
            <div className="mt-4 grid grid-cols-1 items-start gap-x-4 gap-y-3 border-t border-zinc-200 pt-4 sm:grid-cols-2 lg:grid-cols-3 dark:border-zinc-800/80">
              {jobOrderApprovalStepsFor(jobOrderApprovalMeta).map((step) => {
                const completedAt = jobOrderApprovalMeta.completed[step];
                const agentId = jobOrderAssigneeIdForStep(jobOrderApprovalMeta, step);
                const assigneeName = agentId
                  ? jobOrderApprovalAgentNames[agentId]?.trim() || null
                  : null;
                const name = assigneeName;
                const fieldLabel =
                  step === "NOTED_BY"
                    ? "Noted By"
                    : "Approved By";
                return (
                  <div key={step} className="min-w-0 self-start">
                    <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-500">
                      {fieldLabel}
                    </p>
                    <p
                      className={`mt-1 break-words text-sm font-medium leading-snug ${
                        completedAt && name
                          ? "text-emerald-800 dark:text-emerald-300"
                          : name
                            ? "text-zinc-800 dark:text-zinc-200"
                            : "text-zinc-400 dark:text-zinc-600"
                      }`}
                    >
                      {name ?? "—"}
                    </p>
                    {step === currentJobOrderStep && canCompleteCurrentJobOrderStep ? (
                      <div className="mt-2 space-y-1">
                        {jobOrderLastStepNeedsJobDone ? (
                          <p className="text-[10px] font-medium text-amber-800 dark:text-amber-200">
                            Mark Job Done before completing the final Approved By.
                          </p>
                        ) : null}
                        {jobOrderLastStepNeedsJobOutput ? (
                          <p className="text-[10px] font-medium text-amber-800 dark:text-amber-200">
                            Upload Job Output before completing the final approval.
                          </p>
                        ) : null}
                        <button
                          type="button"
                          disabled={
                            busy || jobOrderLastStepNeedsJobOutput || jobOrderLastStepNeedsJobDone
                          }
                          onClick={() => patch({ action: "complete_job_order_approval_step" })}
                          className="min-h-9 w-full rounded-lg border border-emerald-500/50 bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
                        >
                          Done
                        </button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}
          {acaApprovalMeta ? (
            <div className="mt-4 space-y-3 border-t border-zinc-200 pt-4 dark:border-zinc-800/80">
              {(() => {
                const proceduralLevels = acaApprovalMeta.levels.filter((level) =>
                  acaLevelShowsInHorizontalApproval(level.roleCode, level.key),
                );
                const tableLevels = acaApprovalMeta.levels.filter((level) =>
                  acaLevelShowsInExeComTable(level.roleCode),
                );
                return (
                  <>
                    {proceduralLevels.length > 0 ? (
                      <div className="grid grid-cols-1 items-start gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
                        {proceduralLevels.map((level) => {
                          const name = level.agentId
                            ? acaApprovalAgentNames[level.agentId]?.trim() || "Unknown"
                            : "—";
                          const done = Boolean(level.approvedAt);
                          const current = acaApprovalMeta.proceduralStep === level.key;
                          return (
                            <div key={level.key} className="min-w-0 self-start">
                              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-500">
                                {acaHorizontalApprovalLabel(level)}
                              </p>
                              <p
                                className={`mt-1 break-words text-sm font-medium leading-snug ${
                                  done
                                    ? "text-emerald-800 dark:text-emerald-300"
                                    : current
                                      ? "text-amber-800 dark:text-amber-300"
                                      : name !== "—"
                                        ? "text-zinc-800 dark:text-zinc-200"
                                        : "text-zinc-400 dark:text-zinc-600"
                                }`}
                              >
                                {name}
                              </p>
                              {done && level.approvedAt ? (
                                <p className="mt-0.5 text-[10px] text-zinc-500 dark:text-zinc-500">
                                  {new Date(level.approvedAt).toLocaleString(undefined, {
                                    dateStyle: "medium",
                                    timeStyle: "short",
                                  })}
                                </p>
                              ) : current ? (
                                <p className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-amber-700 dark:text-amber-400">
                                  Current
                                </p>
                              ) : null}
                              {current && canCompleteCurrentAcaStep && !acaRequiresFeedback ? (
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => patch({ action: "complete_aca_approval_step" })}
                                  className="mt-2 min-h-9 w-full rounded-lg border border-emerald-500/50 bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
                                >
                                  Done
                                </button>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    ) : null}

                    {tableLevels.length > 0 ? (
                      <div className="overflow-x-auto rounded-lg border border-zinc-300 dark:border-zinc-700">
                        <table className="min-w-full text-left text-sm">
                          <thead className="bg-zinc-100 text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-500 dark:bg-zinc-900/60 dark:text-zinc-400">
                            <tr>
                              <th className="border-b border-zinc-300 px-3 py-2 dark:border-zinc-700">
                                Role
                              </th>
                              <th className="border-b border-zinc-300 px-3 py-2 dark:border-zinc-700">
                                Name
                              </th>
                              <th className="border-b border-zinc-300 px-3 py-2 dark:border-zinc-700">
                                Comment
                              </th>
                              <th className="border-b border-zinc-300 px-3 py-2 dark:border-zinc-700">
                                Action / Date
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                            {tableLevels.map((level) => {
                              const name = level.agentId
                                ? acaApprovalAgentNames[level.agentId]?.trim() || "Unknown"
                                : "—";
                              const done = Boolean(level.approvedAt);
                              const current = acaApprovalMeta.proceduralStep === level.key;
                              return (
                                <tr
                                  key={level.key}
                                  className={
                                    current ? "bg-amber-50/80 dark:bg-amber-950/20" : undefined
                                  }
                                >
                                  <td className="px-3 py-2 font-medium text-zinc-800 dark:text-zinc-200">
                                    {level.label}
                                  </td>
                                  <td
                                    className={`px-3 py-2 ${
                                      done
                                        ? "text-emerald-800 dark:text-emerald-300"
                                        : "text-zinc-800 dark:text-zinc-200"
                                    }`}
                                  >
                                    {name}
                                  </td>
                                  <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300">
                                    {level.comment?.trim() || "—"}
                                  </td>
                                  <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300">
                                    {level.approvedAt
                                      ? new Date(level.approvedAt).toLocaleString(undefined, {
                                          dateStyle: "medium",
                                          timeStyle: "short",
                                        })
                                      : current
                                        ? "Current"
                                        : "—"}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : null}
                  </>
                );
              })()}
              {isAcaProcedureGreenLit(acaApprovalMeta) ? (
                <div className="space-y-1">
                  <p className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                    Procedural flow complete — request is green-lit
                  </p>
                  <p className="text-[11px] text-zinc-600 dark:text-zinc-400">
                    Valid only for this activity, amount, and implementation period
                    {acaApprovalMeta.implementationDate
                      ? ` (${acaApprovalMeta.implementationDate})`
                      : ""}
                    {acaApprovalMeta.estimatedCost
                      ? ` · ${formatAcaPeso(acaApprovalMeta.estimatedCost)}`
                      : ""}
                    .
                  </p>
                  {(acaApprovalMeta.relatedTicketIds?.length ?? 0) > 0 ||
                  intakeScreenshots.length > 0 ? (
                    <div className="space-y-1">
                      {(acaApprovalMeta.relatedTicketIds?.length ?? 0) > 0 ? (
                        <p className="text-[11px] text-zinc-600 dark:text-zinc-400">
                          Related ticket refs: {acaApprovalMeta.relatedTicketIds!.join(", ")}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className="text-[11px] font-medium text-amber-700 dark:text-amber-300">
                  Not green-lit until Recommended By, Finance Manager, and all approving seats are
                  Done
                  {acaApprovalMeta.matrixSnapshot?.guidance
                    ? ` · ${acaApprovalMeta.matrixSnapshot.guidance}`
                    : ""}
                </p>
              )}
              {canCompleteCurrentAcaStep && acaRequiresFeedback ? (
                <div className="mt-4 space-y-2 rounded-lg border border-orange-300/50 bg-orange-50/80 p-3 dark:border-orange-800/60 dark:bg-orange-950/20">
                  <p className="text-xs font-semibold text-orange-900 dark:text-orange-200">
                    Feedback required before approval
                  </p>
                  <p className="text-[11px] text-orange-800/90 dark:text-orange-300/90">
                    AP 4 / 4 ExeComs / All ExeCom seats must leave feedback before marking Done.
                    Current seat: {currentAcaStep?.label}
                  </p>
                  <label className="block text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">
                    Feedback
                    <textarea
                      value={acaDoneComment}
                      onChange={(e) => setAcaDoneComment(e.target.value)}
                      rows={3}
                      required
                      className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-orange-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                      placeholder="Enter your feedback / comments for this approval"
                    />
                  </label>
                  <button
                    type="button"
                    disabled={busy || !acaDoneComment.trim()}
                    onClick={() =>
                      patch({
                        action: "complete_aca_approval_step",
                        comment: acaDoneComment.trim(),
                      })
                    }
                    className="min-h-9 w-full rounded-lg border border-emerald-500/50 bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
                  >
                    Done
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
          {intakeScreenshots.length > 0 || canAddAttachments || (isJobOrderApprovalRequest && !isJobOrderExecutionOpen) ? (
            <div className="mt-4 border-t border-zinc-200 pt-4 dark:border-zinc-800/80">
              {isJobOrderApprovalRequest ? (
                <div className="space-y-4">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-500">
                      Attachments
                    </p>
                    <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                      {isJobOrderExecutionOpen
                        ? `Planning and Job Output files (${intakeScreenshots.length}/${MAX_SCREENSHOT_COUNT}).`
                        : "Planning files from intake are shown below. Additional uploads unlock after Noted By and Approved By are complete."}
                    </p>
                  </div>
                  {attachmentError ? (
                    <p className="text-xs text-rose-600 dark:text-rose-300">{attachmentError}</p>
                  ) : null}
                  {(
                    [
                      {
                        key: "planning" as const,
                        items: jobOrderAttachmentPartitions.planning,
                        canUpload: canAddPlanningAttachments,
                        inputRef: planningAttachmentInputRef,
                        hint: "Intake files and additional planning documents while this Job Order is running.",
                      },
                      {
                        key: "job_output" as const,
                        items: jobOrderAttachmentPartitions.jobOutput,
                        canUpload: canAddJobOutputAttachments,
                        inputRef: jobOutputAttachmentInputRef,
                        hint: "Files uploaded by the Execution or Assistance team. Required before the final Approver can mark Done.",
                      },
                    ] as const
                  ).map((section) => (
                    <div
                      key={section.key}
                      className="rounded-lg border border-zinc-200 bg-zinc-50/80 p-3 dark:border-zinc-700 dark:bg-zinc-950/40"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-zinc-600 dark:text-zinc-400">
                            {JOB_ORDER_ATTACHMENT_SECTION_LABELS[section.key]}
                          </p>
                          <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                            {section.hint}
                          </p>
                        </div>
                        {section.canUpload && attachmentSlotsRemaining > 0 ? (
                          <div className="shrink-0">
                            <input
                              key={`${section.key}-${attachmentInputKey}`}
                              ref={section.inputRef}
                              type="file"
                              accept={INTAKE_ATTACHMENT_ACCEPT}
                              multiple
                              className="sr-only"
                              disabled={attachmentBusy}
                              onChange={(e) => {
                                void uploadTicketAttachments(e.target.files, section.key);
                              }}
                            />
                            <button
                              type="button"
                              disabled={attachmentBusy}
                              onClick={() => section.inputRef.current?.click()}
                              className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-orange-300/70 bg-orange-50 px-2.5 py-1.5 text-xs font-semibold text-orange-900 transition hover:bg-orange-100 disabled:opacity-60 dark:border-orange-500/40 dark:bg-orange-950/30 dark:text-orange-100 dark:hover:bg-orange-950/50"
                            >
                              {attachmentBusy ? (
                                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                              ) : (
                                <Paperclip className="size-3.5" aria-hidden />
                              )}
                              {attachmentBusy ? "Uploading…" : "Add files"}
                            </button>
                          </div>
                        ) : null}
                      </div>
                      {section.items.length > 0 ? (
                        <ul className="mt-2 flex flex-wrap gap-3">
                          {section.items.map((m: IntakeScreenshotMetaItem) => {
                            const href = `/api/tickets/${ticket.id}/screenshots/${encodeURIComponent(m.storedFileName)}`;
                            const isImage = isIntakeAttachmentImage(m);
                            return (
                              <li key={m.storedFileName} className="w-[5.5rem]">
                                <a
                                  href={href}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="group flex flex-col items-center gap-1.5 rounded-lg p-1 outline-none transition hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-orange-500/40 dark:hover:bg-zinc-800/60"
                                  title={m.originalName}
                                >
                                  {isImage ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img
                                      src={href}
                                      alt={m.originalName}
                                      className="size-12 rounded-md border border-zinc-200 object-cover object-top dark:border-zinc-700"
                                      loading="lazy"
                                    />
                                  ) : (
                                    <span className="flex size-12 items-center justify-center rounded-md border border-zinc-200 bg-zinc-50 text-orange-600 dark:border-zinc-700 dark:bg-zinc-950 dark:text-orange-400">
                                      <FileText className="size-7" strokeWidth={1.5} aria-hidden />
                                      <span className="sr-only">Document</span>
                                    </span>
                                  )}
                                  <span className="w-full truncate text-center text-[10px] text-zinc-600 group-hover:text-zinc-900 dark:text-zinc-500 dark:group-hover:text-zinc-200">
                                    {m.originalName}
                                  </span>
                                </a>
                              </li>
                            );
                          })}
                        </ul>
                      ) : (
                        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                          No {JOB_ORDER_ATTACHMENT_SECTION_LABELS[section.key].toLowerCase()} files yet.
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-500">
                        {isAcaRequest ? "Related documents" : "Attachments"}
                      </p>
                      {(acaApprovalMeta?.relatedTicketIds?.length ?? 0) > 0 && isAcaRequest ? (
                        <p className="mt-1 text-[11px] text-zinc-600 dark:text-zinc-400">
                          Ticket refs: {acaApprovalMeta!.relatedTicketIds!.join(", ")}
                        </p>
                      ) : null}
                      {canAddAttachments ? (
                        <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                          {`Add images or documents while this request is open (${intakeScreenshots.length}/${MAX_SCREENSHOT_COUNT}).`}
                        </p>
                      ) : null}
                    </div>
                    {canAddAttachments && attachmentSlotsRemaining > 0 ? (
                      <div className="shrink-0">
                        <input
                          key={attachmentInputKey}
                          ref={attachmentInputRef}
                          type="file"
                          accept={INTAKE_ATTACHMENT_ACCEPT}
                          multiple
                          className="sr-only"
                          disabled={attachmentBusy}
                          onChange={(e) => {
                            void uploadTicketAttachments(e.target.files);
                          }}
                        />
                        <button
                          type="button"
                          disabled={attachmentBusy}
                          onClick={() => attachmentInputRef.current?.click()}
                          className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-orange-300/70 bg-orange-50 px-2.5 py-1.5 text-xs font-semibold text-orange-900 transition hover:bg-orange-100 disabled:opacity-60 dark:border-orange-500/40 dark:bg-orange-950/30 dark:text-orange-100 dark:hover:bg-orange-950/50"
                        >
                          {attachmentBusy ? (
                            <Loader2 className="size-3.5 animate-spin" aria-hidden />
                          ) : (
                            <Paperclip className="size-3.5" aria-hidden />
                          )}
                          {attachmentBusy ? "Uploading…" : "Add files"}
                        </button>
                      </div>
                    ) : null}
                  </div>
                  {attachmentError ? (
                    <p className="mt-2 text-xs text-rose-600 dark:text-rose-300">{attachmentError}</p>
                  ) : null}
                  {intakeScreenshots.length > 0 ? (
                    <ul className="mt-2 flex flex-wrap gap-3">
                      {intakeScreenshots.map((m) => {
                        const href = `/api/tickets/${ticket.id}/screenshots/${encodeURIComponent(m.storedFileName)}`;
                        const isImage = isIntakeAttachmentImage(m);
                        return (
                          <li key={m.storedFileName} className="w-[5.5rem]">
                            <a
                              href={href}
                              target="_blank"
                              rel="noreferrer"
                              className="group flex flex-col items-center gap-1.5 rounded-lg p-1 outline-none transition hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-orange-500/40 dark:hover:bg-zinc-800/60"
                              title={m.originalName}
                            >
                              {isImage ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={href}
                                  alt={m.originalName}
                                  className="size-12 rounded-md border border-zinc-200 object-cover object-top dark:border-zinc-700"
                                  loading="lazy"
                                />
                              ) : (
                                <span className="flex size-12 items-center justify-center rounded-md border border-zinc-200 bg-zinc-50 text-orange-600 dark:border-zinc-700 dark:bg-zinc-950 dark:text-orange-400">
                                  <FileText className="size-7" strokeWidth={1.5} aria-hidden />
                                  <span className="sr-only">Document</span>
                                </span>
                              )}
                              <span className="w-full truncate text-center text-[10px] text-zinc-600 group-hover:text-zinc-900 dark:text-zinc-500 dark:group-hover:text-zinc-200">
                                {m.originalName}
                              </span>
                            </a>
                          </li>
                        );
                      })}
                    </ul>
                  ) : canAddAttachments ? (
                    <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                      No files yet. Use Add files to attach supporting documents.
                    </p>
                  ) : null}
                </>
              )}
            </div>
          ) : isAcaRequest && (acaApprovalMeta?.relatedTicketIds?.length ?? 0) > 0 ? (
            <div className="mt-4 border-t border-zinc-200 pt-4 dark:border-zinc-800/80">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-500">
                Related documents
              </p>
              <p className="mt-1 text-[11px] text-zinc-600 dark:text-zinc-400">
                Ticket refs: {acaApprovalMeta!.relatedTicketIds!.join(", ")}
              </p>
            </div>
          ) : null}
        </div>

        {ticket.status === "FOR_CONFIRMATION" ? (
          <>
        <div className="border-b border-zinc-200 px-3 sm:px-5 dark:border-zinc-800/90">
          <div className="flex gap-5 text-sm font-medium">
                <span className="border-b-2 border-orange-500 py-3 text-orange-700 dark:text-orange-300">
                  Verification outcome
                </span>
          </div>
        </div>

        <div className="space-y-3 px-3 py-3 sm:px-5 sm:py-4">
          {verificationState.state === "verified" ? (
            <article className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-700/50 dark:bg-emerald-950/20">
              <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">Verified by requestor</p>
              <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-200">
                {ticket.feedback
                  ? "Star rating and feedback have been submitted."
                  : "Verification complete. Waiting for star rating and feedback."}
              </p>
              {ticket.feedback ? (
                <div className="mt-3 rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900/60">
                  <p className="text-sm text-zinc-900 dark:text-zinc-100">
                    Star rating: <span className="font-semibold">{ticket.feedback.csat}/5</span>
                  </p>
                  <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">
                    {ticket.feedback.comment?.trim() || "No written feedback submitted."}
                  </p>
                </div>
              ) : null}
            </article>
          ) : null}

          {verificationState.state === "rejected" ? (
            <article className="rounded-xl border border-rose-200 bg-rose-50 p-4 dark:border-rose-700/50 dark:bg-rose-950/20">
              <p className="text-sm font-semibold text-rose-700 dark:text-rose-300">Not verified by requestor</p>
              <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-200">
                    The requestor did not verify the resolution. Request workflow returns to active handling.
              </p>
              <div className="mt-3 rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900/60">
                <p className="text-xs uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">Reason provided</p>
                <p className="mt-1 text-sm text-zinc-900 dark:text-zinc-100">{verificationState.rejectedReason}</p>
              </div>
            </article>
          ) : null}

          {verificationState.state === "pending" ? (
            <article className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-900/60">
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Awaiting requestor verification</p>
              <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">
                A verification email was sent. This tab will automatically reflect rating and feedback once verified,
                or show the requestor&apos;s rejection reason when not verified.
              </p>
            </article>
          ) : null}
        </div>
          </>
        ) : null}

        <div className="border-t border-zinc-200 bg-zinc-50 px-3 py-3 sm:px-5 sm:py-4 dark:border-zinc-800/90 dark:bg-zinc-950/35">
          <div className="text-sm text-zinc-600 dark:text-zinc-400">
            {isAgentViewer
              ? "Use the right-side controls to update priority or transfer this request to a colleague."
              : "Use request chat on the right, or cancel an unassigned request / verify the resolution when asked."}
          </div>
        </div>
        </div>
      </div>

      </div>

      <aside className="min-w-0 space-y-4">
        <RequestChatPanel
          requestId={ticket.id}
          entityLabel="Request chat"
          closed={ticket.status === "CLOSED"}
        />
        {!isAgentViewer ? (
          requestorAside
        ) : (
          <>
        <article className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-[0_12px_32px_rgba(15,23,42,0.08)] sm:p-5 dark:border-zinc-800 dark:bg-surface dark:shadow-[0_10px_30px_rgba(0,0,0,0.25)]">
          <h2 className="text-xs font-bold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-500">Request controls</h2>
          {isJobOrderApprovalRequest && isJobOrderExecutionOpen ? (
            <div className="mt-2">
              <JobOrderPostApprovalNav
                compact
                showTaskBoard={canCreateJobOrderProject || canRequestJobOrderProject}
                showExecutionTeam
                showAssistanceTeam={showJobOrderAssistanceTeam}
                activeSection={joPostApprovalSection}
                onSelectSection={setJoPostApprovalSection}
              />
            </div>
          ) : null}
          <div className="mt-3 flex flex-col gap-2">
            {canUpdatePriority ? (
              <div className="space-y-2 rounded-xl border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-900/50">
                <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">Priority level</label>
                <div className="flex min-w-0 flex-col gap-2">
                  <select
                    value={priority}
                    onChange={(e) => setPriority(e.target.value as typeof ticket.priority)}
                    className="min-h-10 w-full min-w-0 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                  >
                    {(ticket.priority === "UNSET"
                      ? (["UNSET", "LOW", "MEDIUM", "HIGH", "URGENT"] as const)
                      : (["LOW", "MEDIUM", "HIGH", "URGENT"] as const)
                    ).map((p) => (
                      <option key={p} value={p}>
                        {formatTicketPriorityLabel(p)}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={busy || priority === ticket.priority}
                    onClick={() =>
                      patch({
                        action: "priority",
                        priority,
                        note: "Priority updated",
                      })
                    }
                    className="min-h-10 w-full shrink-0 rounded-lg border border-orange-500/40 bg-orange-600 px-4 py-2 text-xs font-semibold text-white hover:bg-orange-500 disabled:opacity-60 dark:border-orange-500/60 dark:bg-orange-600/20 dark:text-orange-100 dark:hover:bg-orange-600/30"
                  >
                    Update
                  </button>
                </div>
              </div>
            ) : null}

            {transferPending ? (
              <div className="space-y-2 rounded-xl border border-rose-300 bg-rose-50 p-3 dark:border-rose-700/60 dark:bg-rose-950/20">
                <p className="text-xs font-semibold text-rose-800 dark:text-rose-200">
                  {canApproveTransfer
                    ? pendingTransfer?.fromAgentName
                      ? `Transfer pending from ${pendingTransfer.fromAgentName} — in the Assign Requests unassigned pool.`
                      : "Transfer pending — this request is in the Assign Requests unassigned pool."
                    : "Transfer pending — waiting for reassignment from the Assign Requests unassigned pool."}
                </p>
                {pendingTransfer?.reason ? (
                  <p className="text-xs text-rose-700 dark:text-rose-100/80">{pendingTransfer.reason}</p>
                ) : null}
                {pendingTransfer?.recipientAgentName ? (
                  <p className="text-[11px] text-rose-700 dark:text-rose-200/80">
                    Preferred recipient: {pendingTransfer.recipientAgentName}
                  </p>
                ) : null}
                {canApproveTransfer ? (
                  <div className="flex flex-col gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                        patch({
                          action: "approve_transfer",
                          note: "Transfer accepted — assigned to preferred recipient.",
                        })
                }
                      className="min-h-10 w-full rounded-lg border border-emerald-500/70 bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
              >
                      Assign to preferred recipient
              </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        patch({
                          action: "reject_transfer",
                          note: "Transfer declined — returned to requester.",
                        })
                      }
                      className="min-h-10 w-full rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900"
                    >
                      Return to requester
                    </button>
                  </div>
                ) : (
                  <p className="text-[11px] text-rose-700 dark:text-rose-200/80">
                    An admin can reassign this from Assign Requests, or return it to the original
                    assignee from Ticket Controls.
                  </p>
                )}
              </div>
            ) : null}

            {isPaymentRequest && canAssignDeferredAccountingFinance ? (
              <div className="space-y-2 rounded-xl border border-orange-400/40 bg-orange-500/5 p-3 dark:border-orange-500/30 dark:bg-orange-500/10">
                <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                  {paymentApprovalMeta?.accountingAgentId?.trim()
                    ? "Set Accounting assignee"
                    : "Set Bookkeeper and Accounting assignees"}
                </p>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  {paymentApprovalMeta?.accountingAgentId?.trim() ? (
                    <>
                      Prepared by Bookkeeper was set at intake. Assign Approved By Accounting after
                      Noted By
                      {paymentApprovalMeta?.skipApprovedBy ? "" : " and Approved By"}{" "}
                      {paymentApprovalMeta?.skipApprovedBy ? "is" : "are"} complete
                      {paymentApprovalMeta?.deferPaymentModeToAccounting
                        ? ", and set mode of payment in the request details above if it is still pending"
                        : ""}
                      .
                    </>
                  ) : (
                    <>
                      Prepared by Bookkeeper and Approved By Accounting are set on the ticket after
                      Noted By
                      {paymentApprovalMeta?.skipApprovedBy ? "" : " and Approved By"}{" "}
                      {paymentApprovalMeta?.skipApprovedBy ? "is" : "are"} complete. Assign different
                      people for each role
                      {paymentApprovalMeta?.deferPaymentModeToAccounting
                        ? ", and set mode of payment in the request details above if it is still pending"
                        : ""}
                      .
                    </>
                  )}
                </p>
                {!paymentApprovalMeta?.accountingAgentId?.trim() ? (
                  <CompanyUserSearchField
                    label="Prepared by Bookkeeper:"
                    users={deferredAccountingFinanceRoster}
                    value={approvalDraft.accountingAgentId || ""}
                    excludedIds={
                      new Set(
                        [
                          ...deferredAccountingFinanceExcludedIds,
                          approvalDraft.financeAgentId || "",
                        ].filter((id) => id && id !== approvalDraft.accountingAgentId),
                      )
                    }
                    disabled={busy}
                    placeholder="Search by name or email…"
                    onChange={(agentId) =>
                      setApprovalDraft((prev) => ({
                        ...prev,
                        accountingAgentId: agentId || null,
                      }))
                    }
                  />
                ) : null}
                <CompanyUserSearchField
                  label="Approved By Accounting"
                  users={deferredAccountingFinanceRoster}
                  value={approvalDraft.financeAgentId || ""}
                  excludedIds={
                    new Set(
                      [
                        ...deferredAccountingFinanceExcludedIds,
                        approvalDraft.accountingAgentId || "",
                      ].filter((id) => id && id !== approvalDraft.financeAgentId),
                    )
                  }
                  disabled={busy}
                  placeholder="Search by name or email…"
                  onChange={(agentId) =>
                    setApprovalDraft((prev) => ({
                      ...prev,
                      financeAgentId: agentId || null,
                    }))
                  }
                />
                <button
                  type="button"
                  disabled={
                    busy ||
                    !(
                      approvalDraft.accountingAgentId ||
                      paymentApprovalMeta?.accountingAgentId
                    ) ||
                    !approvalDraft.financeAgentId
                  }
                  onClick={() =>
                    patch({
                      action: "set_payment_approval_assignees",
                      accountingAgentId:
                        approvalDraft.accountingAgentId ||
                        paymentApprovalMeta?.accountingAgentId ||
                        null,
                      financeAgentId: approvalDraft.financeAgentId,
                    })
                  }
                  className="min-h-10 w-full rounded-lg border border-orange-500/40 bg-orange-600 px-4 py-2 text-xs font-semibold text-white hover:bg-orange-500 disabled:opacity-60"
                >
                  Save Bookkeeper and Accounting assignees
                </button>
              </div>
            ) : null}

            {isPaymentRequest && canSetApprovalAssignees ? (
              <div className="space-y-3 rounded-xl border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-900/50">
                <div>
                  <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                    Payment approval
                  </p>
                  {paymentProceduralLabel ? (
                    <p className="mt-1 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                      {paymentProceduralLabel}
                    </p>
                  ) : paymentApprovalMeta?.proceduralStep === "DONE" ? (
                    <p className="mt-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                      All approval roles complete
                    </p>
                  ) : null}
                  <p className="mt-1 text-[11px] font-normal text-zinc-500 dark:text-zinc-400">
                    Noted By
                    {paymentApprovalMeta?.skipApprovedBy ? "" : " / Approved By"}
                    {paymentApprovalMeta?.accountingAgentId?.trim()
                      ? " / Prepared by Bookkeeper"
                      : ""}{" "}
                    are set at create.
                    {paymentApprovalMeta?.accountingAgentId?.trim()
                      ? " Approved By Accounting is assigned on this ticket"
                      : " Prepared by Bookkeeper and Approved By Accounting are assigned on this ticket"}
                    after those steps. Complete the current step (Approved / Done under your name)
                    to hand off to the next role.
                  </p>
                </div>
                {currentPaymentStep && canCompleteCurrentPaymentStep ? (
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    Use the buttons under your name in the approvals above to complete this step.
                  </p>
                ) : currentPaymentStep &&
                  sessionAlreadyApprovedThisRequest &&
                  isTicketAssignee &&
                  !currentPaymentStepAllowsRepeatSigner ? (
                  <p className="text-[11px] text-amber-700 dark:text-amber-300">
                    You already approved an earlier step on this request, so Done is hidden.
                    Wait for the assigned next-role approver to continue.
                  </p>
                ) : currentPaymentStep ? (
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    Only the assigned {PAYMENT_APPROVAL_STEP_LABELS[currentPaymentStep]} approver can mark Done.
                    Completing Done moves the request onto the next role’s Request Board.
                  </p>
                ) : null}
              </div>
            ) : null}

            {isPaymentRequest && canRequestPaymentApproval && !canSetApprovalAssignees ? (
              <div className="space-y-3 rounded-xl border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-900/50">
                <div>
                  <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                    {currentPaymentStep
                      ? PAYMENT_APPROVAL_STEP_LABELS[currentPaymentStep]
                      : "Payment approval"}
                  </p>
                  {paymentProceduralLabel ? (
                    <p className="mt-1 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                      {paymentProceduralLabel}
                    </p>
                  ) : paymentApprovalMeta?.proceduralStep === "DONE" ? (
                    <p className="mt-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                      All approval roles complete — awaiting customer confirmation
                    </p>
                  ) : null}
                </div>
                {currentPaymentStep ? (
                  <>
                    <p className="text-[11px] font-normal text-zinc-500 dark:text-zinc-400">
                      Mark Done when finished. The request moves to the next procedural assignee
                      automatically.
                    </p>
                    {canCompleteCurrentPaymentStep &&
                    paymentStepShowsDoneButton(currentPaymentStep) ? (
                      <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                        Use the buttons under your name in the approvals above to complete this step.
                      </p>
                    ) : sessionAlreadyApprovedThisRequest &&
                      isTicketAssignee &&
                      !currentPaymentStepAllowsRepeatSigner ? (
                      <p className="text-[11px] text-amber-700 dark:text-amber-300">
                        You already approved an earlier step on this request, so Done is hidden.
                        Wait for the assigned next-role approver to continue.
                      </p>
                    ) : ticket.assignedAgentId ? (
                      <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                        Waiting on the assigned personnel to mark Done for{" "}
                        {PAYMENT_APPROVAL_STEP_LABELS[currentPaymentStep]}. Done moves the request to
                        the next procedural assignee’s Request Board.
                      </p>
                    ) : (
                      <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                        Wait for Admin to assign this request on the Assignment Board.
                      </p>
                    )}
                  </>
                ) : null}
              </div>
            ) : null}

            {isPaymentRequest &&
            !canSetApprovalAssignees &&
            !canRequestPaymentApproval &&
            !canAssignDeferredAccountingFinance &&
            paymentProceduralLabel ? (
              <p className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-[11px] font-medium text-amber-800 dark:text-amber-200">
                {paymentProceduralLabel} — not green-lit yet. Bookkeeper and Accounting must click
                Approved, then Done to hand off (Accounting Done green-lights the request).
                {paymentApprovalMeta?.skipApprovedBy
                  ? paymentApprovalMeta?.skipNotedBy
                    ? " The request starts at Accounting."
                    : " Noted By uses Approve beside their name."
                  : paymentApprovalMeta?.skipNotedBy
                    ? " Approved By uses Approve beside their name."
                    : " Noted By and Approved By use Approve beside their name."}
              </p>
            ) : null}

            {isAcaRequest && canCompleteCurrentAcaStep ? (
              <p className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-[11px] text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/50 dark:text-zinc-300">
                {acaRequiresFeedback
                  ? "This seat needs your feedback before approval — use the feedback box and Done button under your name in the approvals above."
                  : "Use the Done button under your name in the approvals above to complete this seat."}
              </p>
            ) : null}

            {isAcaRequest && !canCompleteCurrentAcaStep && acaProceduralLabelText ? (
              <p className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-[11px] font-medium text-amber-800 dark:text-amber-200">
                {acaProceduralLabelText} — not green-lit yet. Waiting on the current ACA assignee to
                mark Done.
              </p>
            ) : null}

            {showRequestTransfer ? (
              <div className="space-y-2 rounded-xl border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-900/50">
                <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                  Request for transfer
                </label>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  Releases this request to the Assign Requests unassigned pool as Transfer pending
                  (red outline). Note a preferred colleague for admins.
                </p>
                <CompanyUserSearchField
                  label="Transfer to"
                  users={transferRecipients}
                  value={transferRecipientId}
                  onChange={setTransferRecipientId}
                  placeholder="Search company users…"
                  disabled={busy || transferRecipients.length === 0}
                />
                <textarea
                  value={transferReason}
                  onChange={(e) => setTransferReason(e.target.value)}
                  rows={2}
                  className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                  placeholder="Why this request needs transfer"
                />
                <button
                  type="button"
                  disabled={busy || !transferRecipientId}
                  onClick={() =>
                    patch({
                      action: "request_transfer",
                      reason: transferReason || "Unable to resolve with current assignment.",
                      recipientAgentId: transferRecipientId,
                    })
                  }
                  className="min-h-10 w-full rounded-lg border border-orange-500/40 bg-orange-600 px-4 py-2 text-xs font-semibold text-white hover:bg-orange-500 disabled:opacity-60"
                >
                  Send transfer request
                </button>
              </div>
            ) : null}

            {isRequisitionRequest && canSetApprovalAssignees ? (
              <div className="space-y-3 rounded-xl border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-900/50">
                <div>
                  <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                    Item requisition approval
                  </p>
                  {requisitionProceduralLabel ? (
                    <p className="mt-1 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                      {requisitionProceduralLabel}
                    </p>
                  ) : itemRequisitionApprovalMeta?.proceduralStep === "DONE" ? (
                    <p className="mt-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                      All approval roles complete
                    </p>
                  ) : null}
                  <p className="mt-1 text-[11px] font-normal text-zinc-500 dark:text-zinc-400">
                    Assign Canvassed By on the Assignment Board. That assignee fills pricing, then
                    selects who will Approve.
                  </p>
                </div>
                {canUndoRequisitionCanvass ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => patch({ action: "undo_item_requisition_canvass" })}
                    className="min-h-10 w-full rounded-lg border border-rose-500/50 bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-500 disabled:opacity-60"
                  >
                    Undo Canvassed By
                  </button>
                ) : null}
                {currentRequisitionStep === "CANVASSED_BY" ? (
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    {ticket.assignedAgentId
                      ? "Canvassed By completes automatically when the assignee saves pricing. After that, they can select Approved By."
                      : "Assign this request on the Assignment Board so the assignee becomes Canvassed By and can fill pricing."}
                  </p>
                ) : currentRequisitionStep && canCompleteCurrentRequisitionStep ? (
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    Use the Complete button under your name in the approvals above to finish this step.
                  </p>
                ) : currentRequisitionStep ? (
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    Only the Assignment Board assignee can complete Approved By. After completion, use
                    Submit for Next Approval to advance (request stays assigned).
                  </p>
                ) : null}
                {canRequestRequisitionApproval && currentRequisitionStep === "APPROVED_BY" ? (
                  <div className="space-y-2 border-t border-zinc-200 pt-3 dark:border-zinc-700">
                    <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                      Select Approved By
                    </p>
                    <CompanyUserSearchField
                      label="Approved By — company user"
                      users={approvalAgents}
                      value={requestApproverId || currentRequisitionStepAssigneeId || ""}
                      onChange={setRequestApproverId}
                      disabled={busy}
                      placeholder="Search company users…"
                    />
                    <button
                      type="button"
                      disabled={busy || !(requestApproverId || currentRequisitionStepAssigneeId)}
                      onClick={() =>
                        patch({
                          action: "request_item_requisition_approval",
                          approverAgentId: requestApproverId || currentRequisitionStepAssigneeId,
                        })
                      }
                      className="min-h-10 w-full rounded-lg border border-orange-500/40 bg-orange-600 px-4 py-2 text-xs font-semibold text-white hover:bg-orange-500 disabled:opacity-60"
                    >
                      Assign Approved By
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}

            {isRequisitionRequest && canRequestRequisitionApproval && !canSetApprovalAssignees ? (
              <div className="space-y-3 rounded-xl border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-900/50">
                <div>
                  <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                    Select Approved By
                  </p>
                  {requisitionProceduralLabel ? (
                    <p className="mt-1 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                      {requisitionProceduralLabel}
                    </p>
                  ) : itemRequisitionApprovalMeta?.proceduralStep === "DONE" ? (
                    <p className="mt-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                      All approval roles complete — awaiting customer confirmation
                    </p>
                  ) : null}
                  <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                    Choose who will Approve this request, then assign them.
                  </p>
                </div>
                {currentRequisitionStep === "APPROVED_BY" ? (
                  <>
                    <label className="block text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">
                      Approved By — company user
                      <select
                        value={requestApproverId || currentRequisitionStepAssigneeId || ""}
                        onChange={(e) => setRequestApproverId(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                      >
                        <option value="">Select user from your company</option>
                        {approvalAgents.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                            {a.email ? ` (${a.email})` : ""}
                            </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      disabled={busy || !(requestApproverId || currentRequisitionStepAssigneeId)}
                      onClick={() =>
                        patch({
                          action: "request_item_requisition_approval",
                          approverAgentId: requestApproverId || currentRequisitionStepAssigneeId,
                        })
                      }
                      className="min-h-10 w-full rounded-lg border border-orange-500/40 bg-orange-600 px-4 py-2 text-xs font-semibold text-white hover:bg-orange-500 disabled:opacity-60"
                    >
                      Assign Approved By
                    </button>
                    {canCompleteCurrentRequisitionStep ? (
                      <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                        Use the Complete button under your name in the approvals above to finish this step.
                      </p>
                    ) : ticket.assignedAgentId ? (
                      <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                        Waiting on the assigned personnel to complete Approved By.
                      </p>
                    ) : null}
                  </>
                ) : null}
                </div>
            ) : null}

            {isRequisitionRequest &&
            !canSetApprovalAssignees &&
            !canRequestRequisitionApproval &&
            requisitionProceduralLabel ? (
              <p className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-[11px] font-medium text-amber-800 dark:text-amber-200">
                {currentRequisitionStep === "CANVASSED_BY"
                  ? `${requisitionProceduralLabel} — assign on the Assignment Board; that person becomes Canvassed By and completes the role by saving pricing.`
                  : `${requisitionProceduralLabel} — the Canvassed By assignee selects who will Approve from Ticket Controls.`}
              </p>
            ) : null}

            {isFundTransferRequest && canSetApprovalAssignees ? (
              <div className="space-y-3 rounded-xl border border-zinc-200 bg-zinc-50 p-3 pb-4 dark:border-zinc-700 dark:bg-zinc-900/50">
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                    Fund transfer approval
                  </p>
                  {fundTransferProceduralLabel ? (
                    <p className="inline-flex max-w-full rounded-md border border-amber-400/40 bg-amber-500/10 px-2 py-1 text-[11px] font-medium leading-snug text-amber-800 dark:text-amber-200">
                      {fundTransferProceduralLabel}
                    </p>
                  ) : fundTransferApprovalMeta?.proceduralStep === "DONE" ? (
                    <p className="inline-flex max-w-full rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[11px] font-medium leading-snug text-emerald-800 dark:text-emerald-300">
                      All approval roles complete
                    </p>
                  ) : null}
                  <p className="text-[11px] font-normal text-zinc-500 dark:text-zinc-400">
                    Assignees are set when the request is created.
                  </p>
                </div>
                {currentFundTransferStep && canCompleteCurrentFundTransferStep ? (
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    Use the Complete button under your name in the approvals above to finish this step.
                  </p>
                ) : currentFundTransferStep ? (
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    Only the Assignment Board assignee can complete this step. After completion, use
                    Submit for Next Approval to send the request to the next role (it stays assigned).
                  </p>
                ) : null}
                {canRequestFundTransferApproval && currentFundTransferStep ? (
                  <div className="space-y-2 border-t border-zinc-200 pt-3 dark:border-zinc-700">
                    <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                      Submit for Next Approval
                    </p>
                    <CompanyUserSearchField
                      label={`${FUND_TRANSFER_APPROVAL_STEP_LABELS[currentFundTransferStep]} — user`}
                      users={approvalAgents}
                      value={requestApproverId || currentFundTransferStepAssigneeId || ""}
                      onChange={setRequestApproverId}
                      disabled={busy}
                      placeholder="Search by name or email…"
                    />
                    <button
                      type="button"
                      disabled={busy || !(requestApproverId || currentFundTransferStepAssigneeId)}
                      onClick={() =>
                        patch({
                          action: "request_fund_transfer_approval",
                          approverAgentId: requestApproverId || currentFundTransferStepAssigneeId,
                        })
                      }
                      className="min-h-10 w-full rounded-lg border border-orange-500/40 bg-orange-600 px-4 py-2 text-xs font-semibold text-white hover:bg-orange-500 disabled:opacity-60"
                    >
                      Submit for Next Approval
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}

            {isFundTransferRequest && canRequestFundTransferApproval && !canSetApprovalAssignees ? (
              <div className="space-y-3 rounded-xl border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-900/50">
                <div>
                  <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                    Submit for Next Approval
                  </p>
                  {fundTransferProceduralLabel ? (
                    <p className="mt-1 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                      {fundTransferProceduralLabel}
                    </p>
                  ) : fundTransferApprovalMeta?.proceduralStep === "DONE" ? (
                    <p className="mt-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                      All approval roles complete — awaiting customer confirmation
                    </p>
                  ) : null}
              </div>
                {currentFundTransferStep ? (
                  <>
                    <label className="block text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">
                      {FUND_TRANSFER_APPROVAL_STEP_LABELS[currentFundTransferStep]} — user
                      <select
                        value={requestApproverId || currentFundTransferStepAssigneeId || ""}
                        onChange={(e) => setRequestApproverId(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                      >
                        <option value="">Select user by name or email</option>
                        {approvalAgents.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                            {a.email ? ` (${a.email})` : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      disabled={busy || !(requestApproverId || currentFundTransferStepAssigneeId)}
                      onClick={() =>
                        patch({
                          action: "request_fund_transfer_approval",
                          approverAgentId: requestApproverId || currentFundTransferStepAssigneeId,
                        })
                      }
                      className="min-h-10 w-full rounded-lg border border-orange-500/40 bg-orange-600 px-4 py-2 text-xs font-semibold text-white hover:bg-orange-500 disabled:opacity-60"
                    >
                      Submit for Next Approval
                    </button>
                    {canCompleteCurrentFundTransferStep ? (
                      <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                        Use the Complete button under your name in the approvals above to finish this step.
                      </p>
                    ) : ticket.assignedAgentId ? (
                      <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                        Waiting on the assigned personnel to complete{" "}
                        {FUND_TRANSFER_APPROVAL_STEP_LABELS[currentFundTransferStep]}. After
                        completion, they can submit for the next approval without returning to
                        Unassigned.
                      </p>
                    ) : (
                      <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                        Choose a company user and submit for approval, or wait for Admin to assign
                        this request on the Assignment Board.
                      </p>
                    )}
                  </>
            ) : null}
          </div>
            ) : null}

            {isFundTransferRequest &&
            canCompleteCurrentFundTransferStep &&
            !canSetApprovalAssignees &&
            !canRequestFundTransferApproval ? (
              <p className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-[11px] text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/50 dark:text-zinc-300">
                Use the Complete button under your name in the approvals above to finish this step.
              </p>
            ) : null}

            {isFundTransferRequest &&
            !canSetApprovalAssignees &&
            !canRequestFundTransferApproval &&
            fundTransferProceduralLabel ? (
              <p className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-[11px] font-medium text-amber-800 dark:text-amber-200">
                {fundTransferProceduralLabel} — assign on the Assignment Board. After each approval,
                the assignee can submit for the next role from Ticket Controls (request stays
                assigned).
              </p>
            ) : null}

            {isJobOrderApprovalRequest && canSetApprovalAssignees ? (
              <div className="space-y-3 rounded-xl border border-zinc-200 bg-zinc-50 p-3 pb-4 dark:border-zinc-700 dark:bg-zinc-900/50">
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                    Job order approval
                  </p>
                  {jobOrderProceduralLabel ? (
                    <p className="inline-flex max-w-full rounded-md border border-amber-400/40 bg-amber-500/10 px-2 py-1 text-[11px] font-medium leading-snug text-amber-800 dark:text-amber-200">
                      {jobOrderProceduralLabel}
                    </p>
                  ) : jobOrderApprovalMeta?.proceduralStep === "DONE" ? (
                    <p className="inline-flex max-w-full rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[11px] font-medium leading-snug text-emerald-800 dark:text-emerald-300">
                      All approval roles complete — request is green-lit
                    </p>
                  ) : null}
                </div>
                {jobOrderApprovalMeta && jobOrderApprovalMeta.proceduralStep !== "DONE" ? (
                  <div className="space-y-2 border-t border-zinc-200 pt-3 dark:border-zinc-700">
                    {!jobOrderApprovalMeta.skipNotedBy ? (
                      <CompanyUserSearchField
                        label="Noted By"
                        users={approvalAgents}
                        value={jobOrderApprovalDraft.notedByAgentId || ""}
                        onChange={(id) =>
                          setJobOrderApprovalDraft((prev) => ({
                            ...prev,
                            notedByAgentId: id || null,
                          }))
                        }
                        disabled={busy}
                        placeholder="Search by name or email…"
                      />
                    ) : null}
                    {!jobOrderApprovalMeta.skipApprovedBy ? (
                      <CompanyUserSearchField
                        label="Approved By"
                        users={approvalAgents}
                        value={jobOrderApprovalDraft.approvedByAgentId || ""}
                        onChange={(id) =>
                          setJobOrderApprovalDraft((prev) => ({
                            ...prev,
                            approvedByAgentId: id || null,
                          }))
                        }
                        disabled={busy}
                        placeholder="Search by name or email…"
                      />
                    ) : null}
                    <CompanyUserSearchField
                      label="Approved By"
                      users={approvalAgents}
                      value={jobOrderApprovalDraft.approvedBy2AgentId || ""}
                      onChange={(id) =>
                        setJobOrderApprovalDraft((prev) => ({
                          ...prev,
                          approvedBy2AgentId: id || null,
                        }))
                      }
                      disabled={busy}
                      placeholder="Search by name or email…"
                    />
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        patch({
                          action: "set_job_order_approval_assignees",
                          notedByAgentId: jobOrderApprovalDraft.notedByAgentId,
                          approvedByAgentId: jobOrderApprovalDraft.approvedByAgentId,
                          approvedBy2AgentId: jobOrderApprovalDraft.approvedBy2AgentId,
                          preparedByAgentId: jobOrderApprovalDraft.preparedByAgentId,
                        })
                      }
                      className="min-h-10 w-full rounded-lg border border-orange-500/40 bg-orange-600 px-4 py-2 text-xs font-semibold text-white hover:bg-orange-500 disabled:opacity-60"
                    >
                      Save approval assignees
                    </button>
                  </div>
                ) : null}
                {currentJobOrderStep && canCompleteCurrentJobOrderStep ? (
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    Use the Done button under your name in the approvals above to finish this step.
                  </p>
                ) : currentJobOrderStep ? (
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    Only the Assignment Board assignee can mark Done for{" "}
                    {JOB_ORDER_APPROVAL_STEP_LABELS[currentJobOrderStep]}.
                  </p>
                ) : null}
                {canRequestJobOrderApproval && currentJobOrderStep ? (
                  <div className="space-y-2 border-t border-zinc-200 pt-3 dark:border-zinc-700">
                    <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                      Submit for Next Approval
                    </p>
                    <CompanyUserSearchField
                      label={`${JOB_ORDER_APPROVAL_STEP_LABELS[currentJobOrderStep]} — company user`}
                      users={approvalAgents}
                      value={requestApproverId || currentJobOrderStepAssigneeId || ""}
                      onChange={setRequestApproverId}
                      disabled={busy}
                      placeholder="Search company users…"
                    />
                    <button
                      type="button"
                      disabled={busy || !(requestApproverId || currentJobOrderStepAssigneeId)}
                      onClick={() =>
                        patch({
                          action: "request_job_order_approval",
                          approverAgentId: requestApproverId || currentJobOrderStepAssigneeId,
                        })
                      }
                      className="min-h-10 w-full rounded-lg border border-orange-500/40 bg-orange-600 px-4 py-2 text-xs font-semibold text-white hover:bg-orange-500 disabled:opacity-60"
                    >
                      Submit for Next Approval
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}

            {isJobOrderApprovalRequest &&
            canRequestJobOrderApproval &&
            !canSetApprovalAssignees ? (
              <div className="space-y-3 rounded-xl border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-900/50">
                <div>
                  <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                    Submit for Next Approval
                  </p>
                  {jobOrderProceduralLabel ? (
                    <p className="mt-1 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                      {jobOrderProceduralLabel}
                    </p>
                  ) : jobOrderApprovalMeta?.proceduralStep === "DONE" ? (
                    <p className="mt-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                      All approval roles complete — awaiting customer confirmation
                    </p>
                  ) : null}
                </div>
                {currentJobOrderStep ? (
                  <>
                    <label className="block text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">
                      {JOB_ORDER_APPROVAL_STEP_LABELS[currentJobOrderStep]} — company user
                      <select
                        value={requestApproverId || currentJobOrderStepAssigneeId || ""}
                        onChange={(e) => setRequestApproverId(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                      >
                        <option value="">Select user from your company</option>
                        {approvalAgents.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                            {a.email ? ` (${a.email})` : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      disabled={busy || !(requestApproverId || currentJobOrderStepAssigneeId)}
                      onClick={() =>
                        patch({
                          action: "request_job_order_approval",
                          approverAgentId: requestApproverId || currentJobOrderStepAssigneeId,
                        })
                      }
                      className="min-h-10 w-full rounded-lg border border-orange-500/40 bg-orange-600 px-4 py-2 text-xs font-semibold text-white hover:bg-orange-500 disabled:opacity-60"
                    >
                      Submit for Next Approval
                    </button>
                    {canCompleteCurrentJobOrderStep ? (
                      <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                        Use the Done button under your name in the approvals above to finish this step.
                      </p>
                    ) : ticket.assignedAgentId ? (
                      <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                        Waiting on the assigned personnel to mark Done for{" "}
                        {JOB_ORDER_APPROVAL_STEP_LABELS[currentJobOrderStep]}.
                      </p>
                    ) : (
                      <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                        Choose a company user and submit for approval, or wait for Admin to assign
                        this request on the Assignment Board.
                      </p>
                    )}
                  </>
                ) : null}
              </div>
            ) : null}

            {isJobOrderApprovalRequest &&
            canCompleteCurrentJobOrderStep &&
            !canSetApprovalAssignees &&
            !canRequestJobOrderApproval ? (
              <p className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-[11px] text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/50 dark:text-zinc-300">
                Use the Done button under your name in the approvals above to finish this step.
              </p>
            ) : null}

            {isJobOrderApprovalRequest &&
            !canSetApprovalAssignees &&
            !canRequestJobOrderApproval &&
            jobOrderProceduralLabel ? (
              <p className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-[11px] font-medium text-amber-800 dark:text-amber-200">
                {jobOrderProceduralLabel} — not green-lit yet. Assign on the Assignment Board. After
                each approval, the assignee can submit for the next role from Ticket Controls.
              </p>
            ) : null}

            {isJobOrderApprovalRequest &&
            isJobOrderExecutionOpen &&
            joPostApprovalSection === "task-board" &&
            (canCreateJobOrderProject || canRequestJobOrderProject) ? (
              <JobOrderProjectLinkPanel
                ticketId={ticket.id}
                canCreateProject={canCreateJobOrderProject}
                canRequestProject={canRequestJobOrderProject}
                sessionAgentId={sessionAgentId}
              />
            ) : null}

            {isJobOrderApprovalRequest &&
            isJobOrderExecutionOpen &&
            jobOrderApprovalMeta &&
            joPostApprovalSection === "execution-team" ? (
              <JobOrderWorkersPanel
                ticketId={ticket.id}
                ticketStatus={ticket.status}
                jobOrderApprovalMeta={jobOrderApprovalMeta}
                assigneeAgentId={jobOrderExecutionAssigneeId}
                assigneeName={jobOrderExecutionAssigneeName}
                approvalsComplete={isJobOrderGreenLit}
                canAssignExecutionAssignee={canAssignJobOrderExecutionAssignee}
                canManageCoWorkers={canManageJobOrderCoWorkers}
                canMarkJobDone={canMarkJobOrderDone}
                jobDoneRecorded={isJobOrderJobDone(jobOrderApprovalMeta)}
              />
            ) : null}

            {isJobOrderApprovalRequest &&
            showJobOrderAssistanceTeam &&
            jobOrderApprovalMeta &&
            joPostApprovalSection === "assistance-team" ? (
              <JobOrderAssistanceTeamPanel
                ticketId={ticket.id}
                ticketStatus={ticket.status}
                jobOrderApprovalMeta={jobOrderApprovalMeta}
                canManage={canManageJobOrderAssistanceTeam}
                canMarkJobDone={canMarkJobOrderDone}
                jobDoneRecorded={isJobOrderJobDone(jobOrderApprovalMeta)}
                sendToDepartmentName={jobOrderSendToSectionName}
              />
            ) : null}

          </div>
        </article>

        {error ? <p className="text-sm text-red-600 dark:text-red-300">{error}</p> : null}
          </>
        )}
      </aside>

      <div className="space-y-4 xl:col-span-2">
        <article className="rounded-2xl border border-zinc-200 bg-white p-4 text-xs text-zinc-600 shadow-[0_12px_32px_rgba(15,23,42,0.08)] sm:p-5 dark:border-zinc-800 dark:bg-surface dark:text-zinc-300 dark:shadow-[0_10px_30px_rgba(0,0,0,0.25)]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xs font-bold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-500">
              Remarks
            </h2>
            {isAgentViewer ? (
              <button
                type="button"
                disabled={remarksSaving || busy || remarksDraft.trim() === (ticket.remarks ?? "").trim()}
                onClick={() => void saveRemarks()}
                className="rounded-full border border-zinc-300 bg-zinc-900 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-white hover:bg-zinc-800 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                {remarksSaving ? "Saving…" : "Save remarks"}
              </button>
            ) : null}
          </div>
          {isAgentViewer ? (
            <>
              <textarea
                value={remarksDraft}
                onChange={(e) => setRemarksDraft(e.target.value)}
                rows={4}
                maxLength={8000}
                placeholder="Add remarks for this request (visible to the requestor when confirmation is needed)…"
                className="mt-3 w-full resize-y rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 outline-none ring-orange-500/40 placeholder:text-zinc-400 focus:ring-2 dark:border-zinc-700 dark:bg-zinc-950/50 dark:text-zinc-100 dark:placeholder:text-zinc-500"
              />
              <p className="mt-1.5 text-[11px] text-zinc-500 dark:text-zinc-500">
                When this request is For Confirmation, the requestor sees a pin to open these remarks.
              </p>
            </>
          ) : (ticket.remarks ?? "").trim() ? (
            <p className="mt-3 whitespace-pre-wrap rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-800 dark:border-zinc-700 dark:bg-zinc-950/50 dark:text-zinc-200">
              {(ticket.remarks ?? "").trim()}
            </p>
          ) : (
            <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-500">No remarks yet.</p>
          )}
        </article>

        <article className="rounded-2xl border border-zinc-200 bg-white p-4 text-xs text-zinc-600 shadow-[0_12px_32px_rgba(15,23,42,0.08)] sm:p-5 dark:border-zinc-800 dark:bg-surface dark:text-zinc-300 dark:shadow-[0_10px_30px_rgba(0,0,0,0.25)]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xs font-bold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-500">Audit log</h2>
          <button
            type="button"
            onClick={() => setLogModalOpen(true)}
            className="rounded-full border border-zinc-300 bg-zinc-900 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-white hover:bg-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            View all log
          </button>
        </div>
        <ul className="mt-3 space-y-2">
          {ticket.activities.slice(-6).map((a) => (
            <li key={a.id}>
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">{a.summary}</span>
              <div className="text-[11px] text-zinc-500 dark:text-zinc-400">{a.createdAt.toLocaleString()}</div>
            </li>
          ))}
        </ul>
      </article>
      </div>

      {logModalOpen ? (
        <div className="fixed inset-0 z-[70]">
          <button
            type="button"
            onClick={() => setLogModalOpen(false)}
            className="absolute inset-0 bg-zinc-950/55 dark:bg-black/70"
            aria-label="Close request logs"
          />
          <section className="absolute inset-x-2 bottom-2 top-2 flex flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-[0_25px_90px_rgba(15,23,42,0.35)] sm:inset-auto sm:left-1/2 sm:top-1/2 sm:h-[80vh] sm:w-[min(920px,94vw)] sm:-translate-x-1/2 sm:-translate-y-1/2 dark:border-zinc-700 dark:bg-surface dark:shadow-[0_25px_90px_rgba(0,0,0,0.65)]">
            <header className="flex items-center justify-between gap-3 border-b border-zinc-200 px-3 py-3 sm:px-5 sm:py-4 dark:border-zinc-800">
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-500">Request logs</p>
                <h3 className="mt-1 break-all text-base font-semibold text-zinc-950 dark:text-zinc-100">{ticket.ticketNumber}</h3>
              </div>
              <button
                type="button"
                onClick={() => setLogModalOpen(false)}
                className="rounded-md border border-zinc-300 bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                Close
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-5 sm:py-4">
              <ul className="space-y-3">
                {ticket.activities.map((a) => {
                  const detail = formatTicketActivityDetail(a.summary, a.detail);
                  return (
                  <li key={a.id} className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/40">
                    <p className="text-sm font-semibold text-zinc-950 dark:text-zinc-100">{a.summary}</p>
                    {detail ? <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">{detail}</p> : null}
                    <p className="mt-2 text-[11px] uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-500">
                      {a.actor} · {a.createdAt.toLocaleString()}
                    </p>
                  </li>
                  );
                })}
              </ul>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
