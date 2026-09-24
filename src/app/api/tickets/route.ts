import { isElevatedUserRole } from "@/lib/auth";
import type { Prisma } from "@prisma/client/primary";
import { TicketCategory, TicketPriority } from "@prisma/client/primary";
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/access";
import {
  customerTicketWhereBySessionEmail,
  issueConcernIntakeLockMessage,
  requestorHasIntakeBlockingTicket,
} from "@/lib/customer-pending-resolution";
import { ensureOutsideCompanyTeam } from "@/lib/outside-company-team";
import { logActivity } from "@/lib/ticket-actions";
import { prisma } from "@/lib/prisma";
import { resolveAgentDesignatedCompanyId, resolveStaffCompanyTeamId } from "@/lib/staff-company-scope";
import {
  orgChartSectionExists,
  resolveCompanyTeamIdForOrgChartSection,
} from "@/lib/org-chart-section-roster";
import { findSessionAgentId } from "@/lib/session-agent";
import { personnelRequestBoardWhere } from "@/lib/rfp-request-board";
import { addHours, getSlaPolicy } from "@/lib/sla";
import { nextTicketNumber } from "@/lib/ticket-number";
import { shouldNotifyAdminOnCreate, shouldNotifySuperAdminOnCreate } from "@/lib/triggers";
import {
  IntakeContactError,
  isValidWorkEmail,
  resolveTicketContactFields,
} from "@/lib/ticket-intake-contact";
import { resolveCustomerRequestTeam, resolveRosterTeamByExactName, resolveRosterTeamById } from "@/lib/ticket-intake-request-team";
import type { IntakeScreenshotMetaItem } from "@/lib/ticket-intake-screenshots-meta";
import { persistTicketScreenshots, validateScreenshotFiles } from "@/lib/ticket-intake-screenshots";
import { loadStaffAssignmentColorsForAgents } from "@/lib/assignee-assignment-color";
import { runForConfirmationReminderSweep } from "@/lib/confirmation-reminders";
import { parseRequestTypeId, requestTypeLabel } from "@/lib/request-types";
import { isRequestTypeHiddenFromIntake } from "@/lib/intake-request-type-visibility";
import { getIntakeRequestTypeVisibility } from "@/lib/intake-request-type-visibility-db";
import {
  formatPaymentRequestDescription,
  formatPaymentRequestTitle,
  formatPaymentPeso,
  normalizePaymentAmountInput,
  MODE_OF_PAYMENT_CHECK,
  paymentModeRequiresBankDetails,
} from "@/lib/request-for-payment";
import {
  formatItemRequisitionDescription,
  formatItemRequisitionTitle,
  parseRequisitionItemsPayload,
  validateItemRequisitionFields,
} from "@/lib/item-requisition";
import {
  applyPaymentApprovalAssignees,
  currentPaymentStepBoardAssigneeId,
  PAYMENT_APPROVAL_STEP_LABELS,
  paymentApprovalStartStep,
  paymentProceduralStatusLabel,
  type PaymentApprovalAssignees,
  type PaymentApprovalStep,
} from "@/lib/request-for-payment-approval";
import {
  initPaymentApprovalMetaIfNeeded,
  savePaymentApprovalMeta,
} from "@/lib/payment-approval-db";
import {
  applyItemRequisitionApprovalAssignees,
  itemRequisitionProceduralStatusLabel,
  type ItemRequisitionApprovalAssignees,
} from "@/lib/item-requisition-approval";
import {
  initItemRequisitionApprovalMetaIfNeeded,
  saveItemRequisitionApprovalMeta,
} from "@/lib/item-requisition-approval-db";
import {
  formatFundTransferRequestDescription,
  formatFundTransferRequestTitle,
  validateFundTransferRequestFields,
} from "@/lib/fund-transfer-request";
import {
  formatJobOrderDescription,
  formatJobOrderTitle,
  parseJobOrderNatureList,
  validateJobOrderFields,
} from "@/lib/job-order";
import {
  applyFundTransferApprovalAssignees,
  currentFundTransferStepBoardAssigneeId,
  fundTransferProceduralStatusLabel,
  type FundTransferApprovalAssignees,
} from "@/lib/fund-transfer-approval";
import {
  saveFundTransferApprovalMeta,
  stampFundTransferCreatorOnCreate,
} from "@/lib/fund-transfer-approval-db";
import {
  applyJobOrderApprovalAssignees,
  currentJobOrderStepBoardAssigneeId,
  jobOrderApprovalStartStep,
  jobOrderProceduralStatusLabel,
  type JobOrderApprovalAssignees,
} from "@/lib/job-order-approval";
import {
  saveJobOrderApprovalMeta,
  stampJobOrderCreatorOnCreate,
} from "@/lib/job-order-approval-db";
import { acaRecommendedByUsesRequestorCompanyLock, resolveAcaAuthority } from "@/lib/aca-authority-matrix";
import {
  formatAcaRequestDescription,
  formatAcaRequestTitle,
  normalizeAcaAmountInput,
  parseAcaAmountNumber,
  resolveAcaFormCode,
} from "@/lib/authority-to-conduct-activity";
import { acaProceduralStatusLabel, defaultAcaApprovalMeta } from "@/lib/aca-approval";
import { saveAcaApprovalMeta } from "@/lib/aca-approval-db";
import {
  resolveAcaAssigneesFromPositions,
  resolveFtrAssigneesFromPositions,
  resolveMergedSourceUserIdForSessionEmail,
} from "@/lib/approval-position-resolver";

function pickAgentId(v: unknown): string | null {
  if (v === null || v === "") return null;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function parseApprovalAssigneesPayload(raw: unknown): Record<string, string> | null {
  if (raw == null) return null;
  let obj: unknown = raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const id = pickAgentId(value);
    if (id) out[key] = id;
  }
  return Object.keys(out).length > 0 ? out : null;
}

const categories = new Set(Object.values(TicketCategory));
const priorities = new Set(Object.values(TicketPriority));

export async function GET(req: Request) {
  const startedAt = Date.now();
  const session = await requireSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  void runForConfirmationReminderSweep().catch((error) => {
    console.error("Confirmation reminder sweep failed", error);
  });

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const teamIdParam = searchParams.get("teamId");
  const limitParam = Number.parseInt(searchParams.get("limit") ?? "50", 10);
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 100) : 50;
  const operator =
    session.user.role === "Personnel" || session.user.role === "Admin" || isElevatedUserRole(session.user.role)
      ? await findSessionAgentId({ email: session.user.email, name: session.user.name })
      : null;

  const personnelWhere =
    session.user.role === "Personnel" ? await personnelRequestBoardWhere(operator?.id) : null;

  let sectionBoardWhere: Prisma.TicketWhereInput | null = null;
  if (
    session.user.role === "Personnel" ||
    session.user.role === "Admin" ||
    session.user.role === "HighAdmin"
  ) {
    const { sectionScopedTicketWhere } = await import("@/lib/org-chart-section-scope");
    sectionBoardWhere = await sectionScopedTicketWhere({
      email: session.user.email,
      agentId: operator?.id,
    });
  }

  const tickets = await prisma.ticket.findMany({
    where: {
      ...(status ? { status: status as never } : {}),
      ...(isElevatedUserRole(session.user.role) && teamIdParam ? { teamId: teamIdParam } : {}),
      ...(sectionBoardWhere ?? {}),
      ...(sectionBoardWhere ? {} : personnelWhere ?? {}),
      ...(session.user.role === "Customer"
        ? customerTicketWhereBySessionEmail(session.user.email ?? "")
        : {}),
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      ticketNumber: true,
      title: true,
      description: true,
      status: true,
      priority: true,
      category: true,
      contactName: true,
      contactEmail: true,
      createdAt: true,
      updatedAt: true,
      teamId: true,
      assignedAgentId: true,
      team: { select: { id: true, name: true } },
      assignedAgent: { select: { id: true, name: true, email: true } },
    },
    take: limit,
  });

  const colorMap = await loadStaffAssignmentColorsForAgents(
    tickets.map((t) => ({ email: t.assignedAgent?.email, name: t.assignedAgent?.name })),
  );
  const enriched = tickets.map((t) => {
    const email = t.assignedAgent?.email?.trim().toLowerCase();
    const staffAssignmentColor = email ? (colorMap.get(email) ?? null) : null;
    return {
      ...t,
      assignedAgent: t.assignedAgent
        ? { ...t.assignedAgent, staffAssignmentColor }
        : null,
    };
  });

  if (process.env.NODE_ENV === "development") {
    console.info(
      `[perf] GET /api/tickets ${Date.now() - startedAt}ms role=${session.user.role} rows=${enriched.length}`,
    );
  }
  return NextResponse.json(enriched);
}

function isFormFlag(raw: string | boolean | undefined): boolean {
  return raw === true || raw === "true" || raw === "1" || raw === "on";
}

export async function POST(req: Request) {
  const startedAt = Date.now();
  const session = await requireSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const contentType = req.headers.get("content-type") ?? "";
    let title: string | undefined;
    let description: string | undefined;
    let issue: string | undefined;
    let screenshotNames: unknown;
    let category: string | undefined;
    let priority: string | undefined;
    let contactPhone: string | undefined;
    let companyTeamIdRaw: string | undefined;
    let orgChartSectionIdRaw: string | undefined;
    let requestorOrgChartSectionIdRaw: string | undefined;
    let sendToModeRaw: string | undefined;
    let sendToCompanyTeamIdRaw: string | undefined;
    let customerOrgRoleRaw: string | undefined;
    let branchRaw: string | undefined;
    let requestingCompanyTeamIdRaw: string | undefined;
    let departmentRaw: string | undefined;
    let assignedCompanyTextRaw: string | undefined;
    let contactNameRaw: string | undefined;
    let contactEmailRaw: string | undefined;
    let requestToCompanySbuRaw: string | undefined;
    let requestTypeRaw: string | undefined;
    let payeeRaw: string | undefined;
    let inPaymentOfRaw: string | undefined;
    let accountTitleRaw: string | undefined;
    let amountRaw: string | undefined;
    let modeOfPaymentRaw: string | undefined;
    let deliveryOfCheckRaw: string | undefined;
    let bankNameAccountNumberRaw: string | undefined;
    let deferPaymentModeToAccountingRaw: string | boolean | undefined;
    let skipApprovedByRaw: string | boolean | undefined;
    let skipPaymentNotedByRaw: string | boolean | undefined;
    let skipPaymentApprovedByRaw: string | boolean | undefined;
    let skipJobOrderNotedByRaw: string | boolean | undefined;
    let skipJobOrderApprovedByRaw: string | boolean | undefined;
    let requisitionItemsRaw: unknown;
    let purposeOfRequestRaw: string | undefined;
    let fundTransferAmountRaw: string | undefined;
    let requestingDepartmentBusinessUnitRaw: string | undefined;
    let fromAccountNameRaw: string | undefined;
    let fromAccountNumberRaw: string | undefined;
    let toAccountNameRaw: string | undefined;
    let toAccountNumberRaw: string | undefined;
    let bankNameRaw: string | undefined;
    let bankAddressRaw: string | undefined;
    let natureOfConcernRaw: unknown;
    let buildingRaw: string | undefined;
    let startDateRaw: string | undefined;
    let targetDateRaw: string | undefined;
    let expectedDurationRaw: string | undefined;
    let approvalAssigneesRaw: unknown;
    let acaCategoryRaw: string | undefined;
    let acaNatureOfRequestRaw: string | undefined;
    let acaEstimatedCostRaw: string | undefined;
    let acaBudgetAmountRaw: string | undefined;
    let acaDescriptionRaw: string | undefined;
    let acaObjectiveRaw: string | undefined;
    let acaDateSubmittedRaw: string | undefined;
    let acaImplementationDateRaw: string | undefined;
    let acaSubmittedByNameRaw: string | undefined;
    let acaRelatedTicketIdsRaw: string | undefined;
    let acaRecommendedByAgentIdRaw: string | undefined;
    let acaFinanceManagerAgentIdRaw: string | undefined;
    let acaApprovingAgentIdsRaw: unknown;
    let screenshotFiles: File[] | undefined;

    if (contentType.includes("multipart/form-data")) {
      const fd = await req.formData();
      issue = String(fd.get("issue") || "");
      const pri = fd.get("priority");
      priority = pri != null ? String(pri) : undefined;
      const ct = fd.get("companyTeamId");
      companyTeamIdRaw = ct != null ? String(ct) : undefined;
      const ocs = fd.get("orgChartSectionId");
      orgChartSectionIdRaw = ocs != null ? String(ocs) : undefined;
      const rocs = fd.get("requestorOrgChartSectionId");
      requestorOrgChartSectionIdRaw = rocs != null ? String(rocs) : undefined;
      const stm = fd.get("sendToMode");
      sendToModeRaw = stm != null ? String(stm) : undefined;
      const stc = fd.get("sendToCompanyTeamId");
      sendToCompanyTeamIdRaw = stc != null ? String(stc) : undefined;
      const pct = fd.get("portalCompanyTeamId");
      if (!companyTeamIdRaw && pct != null) {
        companyTeamIdRaw = String(pct);
      }
      const cor = fd.get("customerOrgRole");
      customerOrgRoleRaw = cor != null ? String(cor) : undefined;
      const br = fd.get("branch");
      branchRaw = br != null ? String(br) : undefined;
      const rc = fd.get("requestingCompanyTeamId");
      requestingCompanyTeamIdRaw = rc != null ? String(rc) : undefined;
      const dep = fd.get("department");
      departmentRaw = dep != null ? String(dep) : undefined;
      const ac = fd.get("assignedCompanyText");
      assignedCompanyTextRaw = ac != null ? String(ac) : undefined;
      const cn = fd.get("contactName");
      contactNameRaw = cn != null ? String(cn) : undefined;
      const cem = fd.get("contactEmail");
      contactEmailRaw = cem != null ? String(cem) : undefined;
      const rts = fd.get("requestToCompanySbu");
      requestToCompanySbuRaw = rts != null ? String(rts) : undefined;
      const rt = fd.get("requestType");
      requestTypeRaw = rt != null ? String(rt) : undefined;
      const py = fd.get("payee");
      payeeRaw = py != null ? String(py) : undefined;
      const ipo = fd.get("inPaymentOf");
      inPaymentOfRaw = ipo != null ? String(ipo) : undefined;
      const at = fd.get("accountTitle");
      accountTitleRaw = at != null ? String(at) : undefined;
      const amt = fd.get("amount");
      amountRaw = amt != null ? String(amt) : undefined;
      const mop = fd.get("modeOfPayment");
      modeOfPaymentRaw = mop != null ? String(mop) : undefined;
      const doc = fd.get("deliveryOfCheck");
      deliveryOfCheckRaw = doc != null ? String(doc) : undefined;
      const bna = fd.get("bankNameAccountNumber");
      bankNameAccountNumberRaw = bna != null ? String(bna) : undefined;
      const deferMop = fd.get("deferPaymentModeToAccounting");
      deferPaymentModeToAccountingRaw = deferMop != null ? String(deferMop) : undefined;
      const skipAb = fd.get("skipApprovedBy");
      skipApprovedByRaw = skipAb != null ? String(skipAb) : undefined;
      const skipNoted = fd.get("skipPaymentNotedBy");
      skipPaymentNotedByRaw = skipNoted != null ? String(skipNoted) : undefined;
      const skipApproved = fd.get("skipPaymentApprovedBy");
      skipPaymentApprovedByRaw = skipApproved != null ? String(skipApproved) : undefined;
      const skipJoNoted = fd.get("skipJobOrderNotedBy");
      skipJobOrderNotedByRaw = skipJoNoted != null ? String(skipJoNoted) : undefined;
      const skipJoApproved = fd.get("skipJobOrderApprovedBy");
      skipJobOrderApprovedByRaw = skipJoApproved != null ? String(skipJoApproved) : undefined;
      const ri = fd.get("requisitionItems");
      if (typeof ri === "string" && ri.trim()) {
        try {
          requisitionItemsRaw = JSON.parse(ri);
        } catch {
          return NextResponse.json({ error: "Invalid requisition items payload." }, { status: 400 });
        }
      }
      const por = fd.get("purposeOfRequest");
      purposeOfRequestRaw = por != null ? String(por) : undefined;
      const fta = fd.get("fundTransferAmount");
      fundTransferAmountRaw = fta != null ? String(fta) : undefined;
      const rdbu = fd.get("requestingDepartmentBusinessUnit");
      requestingDepartmentBusinessUnitRaw = rdbu != null ? String(rdbu) : undefined;
      const fan = fd.get("fromAccountName");
      fromAccountNameRaw = fan != null ? String(fan) : undefined;
      const fac = fd.get("fromAccountNumber");
      fromAccountNumberRaw = fac != null ? String(fac) : undefined;
      const tan = fd.get("toAccountName");
      toAccountNameRaw = tan != null ? String(tan) : undefined;
      const tac = fd.get("toAccountNumber");
      toAccountNumberRaw = tac != null ? String(tac) : undefined;
      const bn = fd.get("bankName");
      bankNameRaw = bn != null ? String(bn) : undefined;
      const ba = fd.get("bankAddress");
      bankAddressRaw = ba != null ? String(ba) : undefined;
      const noc = fd.get("natureOfConcern");
      if (typeof noc === "string" && noc.trim()) {
        try {
          natureOfConcernRaw = JSON.parse(noc);
        } catch {
          natureOfConcernRaw = noc;
        }
      }
      const bld = fd.get("building");
      buildingRaw = bld != null ? String(bld) : undefined;
      const sd = fd.get("startDate");
      startDateRaw = sd != null ? String(sd) : undefined;
      const td = fd.get("targetDate");
      targetDateRaw = td != null ? String(td) : undefined;
      const ed = fd.get("expectedDuration");
      expectedDurationRaw = ed != null ? String(ed) : undefined;
      const aa = fd.get("approvalAssignees");
      approvalAssigneesRaw = aa != null ? String(aa) : undefined;
      const acaCat = fd.get("acaCategory");
      acaCategoryRaw = acaCat != null ? String(acaCat) : undefined;
      const acaNat = fd.get("acaNatureOfRequest");
      acaNatureOfRequestRaw = acaNat != null ? String(acaNat) : undefined;
      const acaEst = fd.get("acaEstimatedCost");
      acaEstimatedCostRaw = acaEst != null ? String(acaEst) : undefined;
      const acaBud = fd.get("acaBudgetAmount");
      acaBudgetAmountRaw = acaBud != null ? String(acaBud) : undefined;
      const acaDesc = fd.get("acaDescription");
      acaDescriptionRaw = acaDesc != null ? String(acaDesc) : undefined;
      const acaObj = fd.get("acaObjective");
      acaObjectiveRaw = acaObj != null ? String(acaObj) : undefined;
      const acaDs = fd.get("acaDateSubmitted");
      acaDateSubmittedRaw = acaDs != null ? String(acaDs) : undefined;
      const acaImpl = fd.get("acaImplementationDate");
      acaImplementationDateRaw = acaImpl != null ? String(acaImpl) : undefined;
      const acaSub = fd.get("acaSubmittedByName");
      acaSubmittedByNameRaw = acaSub != null ? String(acaSub) : undefined;
      const acaRel = fd.get("acaRelatedTicketIds");
      acaRelatedTicketIdsRaw = acaRel != null ? String(acaRel) : undefined;
      const acaRec = fd.get("acaRecommendedByAgentId");
      acaRecommendedByAgentIdRaw = acaRec != null ? String(acaRec) : undefined;
      const acaFin = fd.get("acaFinanceManagerAgentId");
      acaFinanceManagerAgentIdRaw = acaFin != null ? String(acaFin) : undefined;
      const acaApp = fd.get("acaApprovingAgentIds");
      if (typeof acaApp === "string" && acaApp.trim()) {
        try {
          acaApprovingAgentIdsRaw = JSON.parse(acaApp);
        } catch {
          return NextResponse.json({ error: "Invalid ACA approving assignees payload." }, { status: 400 });
        }
      }
      const raw = fd.getAll("screenshots");
      screenshotFiles = raw.filter((x): x is File => x instanceof File && x.size > 0);
      const v = validateScreenshotFiles(screenshotFiles);
      if (!v.ok) {
        return NextResponse.json({ error: v.error }, { status: 400 });
      }
    } else {
      const body = (await req.json()) as Record<string, unknown>;
      title = typeof body.title === "string" ? body.title : undefined;
      description = typeof body.description === "string" ? body.description : undefined;
      issue = typeof body.issue === "string" ? body.issue : undefined;
      screenshotNames = body.screenshotNames;
      category = typeof body.category === "string" ? body.category : undefined;
      priority = typeof body.priority === "string" ? body.priority : undefined;
      contactPhone = typeof body.contactPhone === "string" ? body.contactPhone : undefined;
      companyTeamIdRaw =
        typeof body.companyTeamId === "string"
          ? body.companyTeamId
          : typeof body.portalCompanyTeamId === "string"
            ? body.portalCompanyTeamId
            : undefined;
      orgChartSectionIdRaw =
        typeof body.orgChartSectionId === "string" ? body.orgChartSectionId : undefined;
      requestorOrgChartSectionIdRaw =
        typeof body.requestorOrgChartSectionId === "string"
          ? body.requestorOrgChartSectionId
          : undefined;
      sendToModeRaw = typeof body.sendToMode === "string" ? body.sendToMode : undefined;
      sendToCompanyTeamIdRaw =
        typeof body.sendToCompanyTeamId === "string" ? body.sendToCompanyTeamId : undefined;
      customerOrgRoleRaw =
        typeof body.customerOrgRole === "string" ? body.customerOrgRole : undefined;
      branchRaw = typeof body.branch === "string" ? body.branch : undefined;
      requestingCompanyTeamIdRaw =
        typeof body.requestingCompanyTeamId === "string" ? body.requestingCompanyTeamId : undefined;
      departmentRaw = typeof body.department === "string" ? body.department : undefined;
      assignedCompanyTextRaw =
        typeof body.assignedCompanyText === "string" ? body.assignedCompanyText : undefined;
      contactNameRaw = typeof body.contactName === "string" ? body.contactName : undefined;
      contactEmailRaw = typeof body.contactEmail === "string" ? body.contactEmail : undefined;
      requestToCompanySbuRaw =
        typeof body.requestToCompanySbu === "string" ? body.requestToCompanySbu : undefined;
      requestTypeRaw = typeof body.requestType === "string" ? body.requestType : undefined;
      payeeRaw = typeof body.payee === "string" ? body.payee : undefined;
      inPaymentOfRaw = typeof body.inPaymentOf === "string" ? body.inPaymentOf : undefined;
      accountTitleRaw = typeof body.accountTitle === "string" ? body.accountTitle : undefined;
      amountRaw = typeof body.amount === "string" ? body.amount : undefined;
      modeOfPaymentRaw = typeof body.modeOfPayment === "string" ? body.modeOfPayment : undefined;
      deliveryOfCheckRaw =
        typeof body.deliveryOfCheck === "string" ? body.deliveryOfCheck : undefined;
      bankNameAccountNumberRaw =
        typeof body.bankNameAccountNumber === "string" ? body.bankNameAccountNumber : undefined;
      deferPaymentModeToAccountingRaw =
        typeof body.deferPaymentModeToAccounting === "boolean" ||
        typeof body.deferPaymentModeToAccounting === "string"
          ? body.deferPaymentModeToAccounting
          : undefined;
      skipApprovedByRaw =
        typeof body.skipApprovedBy === "boolean" || typeof body.skipApprovedBy === "string"
          ? body.skipApprovedBy
          : undefined;
      skipPaymentNotedByRaw =
        typeof body.skipPaymentNotedBy === "boolean" ||
        typeof body.skipPaymentNotedBy === "string"
          ? body.skipPaymentNotedBy
          : undefined;
      skipPaymentApprovedByRaw =
        typeof body.skipPaymentApprovedBy === "boolean" ||
        typeof body.skipPaymentApprovedBy === "string"
          ? body.skipPaymentApprovedBy
          : undefined;
      skipJobOrderNotedByRaw =
        typeof body.skipJobOrderNotedBy === "boolean" ||
        typeof body.skipJobOrderNotedBy === "string"
          ? body.skipJobOrderNotedBy
          : undefined;
      skipJobOrderApprovedByRaw =
        typeof body.skipJobOrderApprovedBy === "boolean" ||
        typeof body.skipJobOrderApprovedBy === "string"
          ? body.skipJobOrderApprovedBy
          : undefined;
      requisitionItemsRaw = body.requisitionItems;
      purposeOfRequestRaw =
        typeof body.purposeOfRequest === "string" ? body.purposeOfRequest : undefined;
      fundTransferAmountRaw =
        typeof body.fundTransferAmount === "string" ? body.fundTransferAmount : undefined;
      requestingDepartmentBusinessUnitRaw =
        typeof body.requestingDepartmentBusinessUnit === "string"
          ? body.requestingDepartmentBusinessUnit
          : undefined;
      fromAccountNameRaw =
        typeof body.fromAccountName === "string" ? body.fromAccountName : undefined;
      fromAccountNumberRaw =
        typeof body.fromAccountNumber === "string" ? body.fromAccountNumber : undefined;
      toAccountNameRaw = typeof body.toAccountName === "string" ? body.toAccountName : undefined;
      toAccountNumberRaw =
        typeof body.toAccountNumber === "string" ? body.toAccountNumber : undefined;
      bankNameRaw = typeof body.bankName === "string" ? body.bankName : undefined;
      bankAddressRaw = typeof body.bankAddress === "string" ? body.bankAddress : undefined;
      natureOfConcernRaw = body.natureOfConcern;
      buildingRaw = typeof body.building === "string" ? body.building : undefined;
      startDateRaw = typeof body.startDate === "string" ? body.startDate : undefined;
      targetDateRaw = typeof body.targetDate === "string" ? body.targetDate : undefined;
      expectedDurationRaw =
        typeof body.expectedDuration === "string" ? body.expectedDuration : undefined;
      approvalAssigneesRaw = body.approvalAssignees;
      acaCategoryRaw = typeof body.acaCategory === "string" ? body.acaCategory : undefined;
      acaNatureOfRequestRaw =
        typeof body.acaNatureOfRequest === "string" ? body.acaNatureOfRequest : undefined;
      acaEstimatedCostRaw =
        typeof body.acaEstimatedCost === "string" ? body.acaEstimatedCost : undefined;
      acaBudgetAmountRaw =
        typeof body.acaBudgetAmount === "string" ? body.acaBudgetAmount : undefined;
      acaDescriptionRaw =
        typeof body.acaDescription === "string" ? body.acaDescription : undefined;
      acaObjectiveRaw = typeof body.acaObjective === "string" ? body.acaObjective : undefined;
      acaDateSubmittedRaw =
        typeof body.acaDateSubmitted === "string" ? body.acaDateSubmitted : undefined;
      acaImplementationDateRaw =
        typeof body.acaImplementationDate === "string" ? body.acaImplementationDate : undefined;
      acaSubmittedByNameRaw =
        typeof body.acaSubmittedByName === "string" ? body.acaSubmittedByName : undefined;
      acaRelatedTicketIdsRaw =
        typeof body.acaRelatedTicketIds === "string" ? body.acaRelatedTicketIds : undefined;
      acaRecommendedByAgentIdRaw =
        typeof body.acaRecommendedByAgentId === "string" ? body.acaRecommendedByAgentId : undefined;
      acaFinanceManagerAgentIdRaw =
        typeof body.acaFinanceManagerAgentId === "string"
          ? body.acaFinanceManagerAgentId
          : undefined;
      acaApprovingAgentIdsRaw = body.acaApprovingAgentIds;
    }

    const parsedIntakeApprovalAssignees = parseApprovalAssigneesPayload(approvalAssigneesRaw);
    let intakeApprovalAssignees: Record<string, string> | null = parsedIntakeApprovalAssignees;
    const canSetIntakeApprovalAssignees =
      isElevatedUserRole(session.user.role) ||
      session.user.role === "Admin" ||
      session.user.role === "Personnel";
    if (intakeApprovalAssignees && !canSetIntakeApprovalAssignees) {
      return NextResponse.json(
        { error: "Only Admin, SuperAdmin, or Personnel can set approval assignees on create." },
        { status: 403 },
      );
    }

    const accountEmail = (session.user.email || "").trim().toLowerCase();
    if (!accountEmail) {
      return NextResponse.json({ error: "Signed-in account email is required." }, { status: 400 });
    }

    let effectiveContactEmail: string;
    let effectiveRequestorEmail: string;
    try {
      const resolved = await resolveTicketContactFields({
        sessionEmail: accountEmail,
        authProvider: session.user.authProvider,
        bodyRequestorEmail: undefined,
      });
      effectiveContactEmail = resolved.contactEmail;
      effectiveRequestorEmail = resolved.requestorEmail;
    } catch (e) {
      if (e instanceof IntakeContactError) {
        return NextResponse.json({ error: e.message }, { status: 400 });
      }
      throw e;
    }

    let effectiveName =
      (session.user.name || "").trim() ||
      (effectiveRequestorEmail.includes("@") ? effectiveRequestorEmail.split("@")[0] : "") ||
      "User";

    const staffIntakeRoles = new Set(["SuperAdmin", "HighAdmin", "Admin", "Personnel"]);
    const intakeNameTrimmed = (contactNameRaw ?? "").trim();
    const intakeEmailTrimmed = (contactEmailRaw ?? "").trim().toLowerCase();
    if (staffIntakeRoles.has(session.user.role)) {
      if (intakeNameTrimmed) {
        effectiveName = intakeNameTrimmed.slice(0, 200);
      }
      if (intakeEmailTrimmed && isValidWorkEmail(intakeEmailTrimmed)) {
        effectiveContactEmail = intakeEmailTrimmed;
        effectiveRequestorEmail = intakeEmailTrimmed;
      }
    }

    const identityEmails = [
      ...new Set(
        [effectiveRequestorEmail, effectiveContactEmail]
          .map((e) => e.trim().toLowerCase())
          .filter((e) => e.length > 0),
      ),
    ];

    const effectiveCategory = (category || "GENERAL").trim();
    const rawPriority = (priority && String(priority).trim() ? String(priority).trim() : "LOW").toUpperCase();
    // Intake defaults to LOW; treat blank/UNSET the same so creates never land as unset.
    const effectivePriority = rawPriority === "UNSET" ? "LOW" : rawPriority;
    const issueText = (issue || description || "").trim();
    const branch = (branchRaw ?? "").trim();
    if (branch.length > 120) {
      return NextResponse.json({ error: "Branch must be at most 120 characters." }, { status: 400 });
    }
    const requestingCompanyTeamId = (requestingCompanyTeamIdRaw ?? "").trim();
    let requestingCompanyName: string | null = null;
    if (requestingCompanyTeamId) {
      const requestingCompany = await prisma.team.findUnique({
        where: { id: requestingCompanyTeamId },
        select: { id: true, name: true },
      });
      if (!requestingCompany) {
        return NextResponse.json({ error: "Invalid requesting company." }, { status: 400 });
      }
      requestingCompanyName = requestingCompany.name;
    }
    const requestType = parseRequestTypeId(requestTypeRaw);
    const intakeVisibility = await getIntakeRequestTypeVisibility();
    if (isRequestTypeHiddenFromIntake(requestType, intakeVisibility.hiddenTypeIds)) {
      return NextResponse.json(
        { error: "This request type is not available for new submissions." },
        { status: 400 },
      );
    }
    const skipPaymentNotedBy = isFormFlag(skipPaymentNotedByRaw);
    const skipApprovedBy =
      isFormFlag(skipApprovedByRaw) || isFormFlag(skipPaymentApprovedByRaw);
    const skipJobOrderNotedBy = isFormFlag(skipJobOrderNotedByRaw);
    const skipJobOrderApprovedBy = isFormFlag(skipJobOrderApprovedByRaw);

    const requestorMergedSourceUserId = await resolveMergedSourceUserIdForSessionEmail(accountEmail);
    const requestorCompanyTeamId = await resolveStaffCompanyTeamId(session.user.email);
    const sendToOrgChartSectionId = (orgChartSectionIdRaw ?? "").trim();
    const requestorOrgChartSectionId = (requestorOrgChartSectionIdRaw ?? "").trim();
    const staffSendToMode = sendToModeRaw === "company" ? "company" : "department";
    const sendToCompanyTeamId = (sendToCompanyTeamIdRaw ?? "").trim();
    let intakeCompanyTeamId = (companyTeamIdRaw ?? "").trim() || requestorCompanyTeamId;
    // Staff intake routes the company queue from the send-to org-chart section when set.
    if (staffSendToMode === "company" && sendToCompanyTeamId) {
      intakeCompanyTeamId = sendToCompanyTeamId;
    } else if (sendToOrgChartSectionId) {
      const sectionCompanyId = await resolveCompanyTeamIdForOrgChartSection(sendToOrgChartSectionId);
      if (sectionCompanyId) intakeCompanyTeamId = sectionCompanyId;
    }

    if (canSetIntakeApprovalAssignees && requestType === "FUND_TRANSFER_REQUEST") {
      const assignees = { ...(intakeApprovalAssignees ?? {}) };
      const resolved = await resolveFtrAssigneesFromPositions({
        companyTeamId: intakeCompanyTeamId,
        requestorMergedSourceUserId,
      });
      if (!pickAgentId(assignees.recommendingApprovalAgentId) && resolved.RECOMMENDING_APPROVAL) {
        assignees.recommendingApprovalAgentId = resolved.RECOMMENDING_APPROVAL;
      }
      if (Object.keys(assignees).length > 0) {
        intakeApprovalAssignees = assignees;
      }
    }

    if (canSetIntakeApprovalAssignees && requestType === "ITEM_REQUISITION_SLIP" && intakeApprovalAssignees) {
      // Canvassed By comes from Assignment Board assignee later — do not prefill from positions.
      const assignees = { ...intakeApprovalAssignees };
      delete assignees.canvassedByAgentId;
      intakeApprovalAssignees = assignees;
    }

    if (
      canSetIntakeApprovalAssignees &&
      (requestType === "REQUEST_FOR_PAYMENT" ||
        requestType === "FUND_TRANSFER_REQUEST" ||
        requestType === "JOB_ORDER")
    ) {
      const requiredByType: Record<string, Array<{ key: string; label: string }>> = {
        REQUEST_FOR_PAYMENT: [
          ...(skipPaymentNotedBy ? [] : [{ key: "notedByAgentId", label: "Noted By" }]),
          ...(skipApprovedBy ? [] : [{ key: "approvedByAgentId", label: "Approved By" }]),
          ...(isFormFlag(deferPaymentModeToAccountingRaw)
            ? []
            : [{ key: "accountingAgentId", label: "Prepared by Bookkeeper" }]),
        ],
        FUND_TRANSFER_REQUEST: [
          { key: "recommendingApprovalAgentId", label: "Recommending Approval" },
          { key: "approvedByAgentId", label: "Approved By" },
        ],
        JOB_ORDER: [
          ...(skipJobOrderNotedBy ? [] : [{ key: "notedByAgentId", label: "Noted By" }]),
          ...(skipJobOrderApprovedBy
            ? []
            : [{ key: "approvedByAgentId", label: "Approved By" }]),
          { key: "approvedBy2AgentId", label: "Approved By" },
        ],
      };
      const requiredRoles = requiredByType[requestType] ?? [];
      const missing = requiredRoles.filter(
        (role) => !pickAgentId(intakeApprovalAssignees?.[role.key]),
      );
      if (missing.length > 0) {
        return NextResponse.json(
          {
            error: `${missing.map((m) => m.label).join(", ")} ${
              missing.length === 1 ? "is" : "are"
            } required.`,
          },
          { status: 400 },
        );
      }
    }

    // Intake lock applies only to Issue/Concern tickets.
    if (requestType === "ISSUE_CONCERN_TICKET") {
      const blocking = await requestorHasIntakeBlockingTicket(identityEmails);
      if (blocking) {
        return NextResponse.json(
          {
            error: issueConcernIntakeLockMessage(blocking.ticketNumber),
            pendingTicketId: blocking.id,
            pendingTicketNumber: blocking.ticketNumber,
          },
          { status: 409 },
        );
      }
    }

    const departmentFromRequest =
      requestType === "FUND_TRANSFER_REQUEST"
        ? (requestingDepartmentBusinessUnitRaw ?? departmentRaw ?? "").trim()
        : (departmentRaw ?? "").trim();
    const department = departmentFromRequest;
    if (department.length > 200) {
      return NextResponse.json({ error: "Requesting department must be at most 200 characters." }, { status: 400 });
    }
    const payee = (payeeRaw ?? "").trim();
    const inPaymentOf = (inPaymentOfRaw ?? "").trim();
    const accountTitle = (accountTitleRaw ?? "").trim();
    const amount = (amountRaw ?? "").trim();
    const modeOfPayment = (modeOfPaymentRaw ?? "").trim();
    const deliveryOfCheck = (deliveryOfCheckRaw ?? "").trim();
    const bankNameAccountNumber = (bankNameAccountNumberRaw ?? "").trim();
    const deferPaymentModeToAccounting = isFormFlag(deferPaymentModeToAccountingRaw);
    if (requestType === "REQUEST_FOR_PAYMENT") {
      if (!payee || !inPaymentOf || !amount) {
        return NextResponse.json(
          {
            error: "Payee, In payment of, and Amount are required for a payment request.",
          },
          { status: 400 },
        );
      }
      if (!deferPaymentModeToAccounting) {
        if (!modeOfPayment) {
          return NextResponse.json(
            {
              error:
                "Mode of payment is required, or enable Let Bookkeeper and Accounting handle it.",
            },
            { status: 400 },
          );
        }
        if (modeOfPayment === MODE_OF_PAYMENT_CHECK && !deliveryOfCheck) {
          return NextResponse.json(
            { error: "Delivery of check is required when Mode of payment is Check." },
            { status: 400 },
          );
        }
        if (paymentModeRequiresBankDetails(modeOfPayment, deliveryOfCheck) && !bankNameAccountNumber) {
          return NextResponse.json(
            {
              error:
                "Bank name / account number is required for Online direct to Payee's Bank Account #.",
            },
            { status: 400 },
          );
        }
      }
      if (
        payee.length > 200 ||
        inPaymentOf.length > 500 ||
        accountTitle.length > 200 ||
        amount.length > 80 ||
        modeOfPayment.length > 120 ||
        deliveryOfCheck.length > 80 ||
        bankNameAccountNumber.length > 200
      ) {
        return NextResponse.json({ error: "A payment field exceeds the maximum length." }, { status: 400 });
      }
    }

    const requisitionFields =
      requestType === "ITEM_REQUISITION_SLIP"
        ? {
            items: parseRequisitionItemsPayload(requisitionItemsRaw),
            purposeOfRequest: (purposeOfRequestRaw ?? issueText).trim(),
          }
        : null;
    if (requisitionFields) {
      const check = validateItemRequisitionFields(requisitionFields);
      if (!check.ok) {
        return NextResponse.json({ error: check.error }, { status: 400 });
      }
    }

    const fundTransferFields =
      requestType === "FUND_TRANSFER_REQUEST"
        ? {
            requestingDepartmentBusinessUnit: (requestingDepartmentBusinessUnitRaw ?? "").trim(),
            fundTransferAmount: (fundTransferAmountRaw ?? "").trim(),
            fromAccountName: (fromAccountNameRaw ?? "").trim(),
            fromAccountNumber: (fromAccountNumberRaw ?? "").trim(),
            toAccountName: (toAccountNameRaw ?? "").trim(),
            toAccountNumber: (toAccountNumberRaw ?? "").trim(),
            bankName: (bankNameRaw ?? "").trim(),
            bankAddress: (bankAddressRaw ?? "").trim(),
            reason: issueText,
          }
        : null;
    if (fundTransferFields) {
      const check = validateFundTransferRequestFields(fundTransferFields);
      if (!check.ok) {
        return NextResponse.json({ error: check.error }, { status: 400 });
      }
    }

    const jobOrderFields =
      requestType === "JOB_ORDER"
        ? {
            natureOfConcern: parseJobOrderNatureList(natureOfConcernRaw),
            building: (buildingRaw ?? "").trim(),
            startDate: (startDateRaw ?? "").trim(),
            targetDate: (targetDateRaw ?? "").trim(),
            expectedDuration: (expectedDurationRaw ?? "").trim(),
            notes: issueText,
          }
        : null;
    if (jobOrderFields) {
      const check = validateJobOrderFields(jobOrderFields);
      if (!check.ok) {
        return NextResponse.json({ error: check.error }, { status: 400 });
      }
    }

    let acaCreateSeed: ReturnType<typeof defaultAcaApprovalMeta> | null = null;
    let acaFormattedTitle: string | null = null;
    let acaFormattedDescription: string | null = null;
    if (requestType === "AUTHORITY_TO_CONDUCT_ACTIVITY") {
      const departmentStore = (departmentRaw ?? "").trim();
      const acaCategory = (acaCategoryRaw ?? "").trim();
      const acaNature = (acaNatureOfRequestRaw ?? "").trim();
      const estimatedCostNormalized =
        normalizeAcaAmountInput(acaEstimatedCostRaw ?? "") || (acaEstimatedCostRaw ?? "").trim();
      const budgetAmountNormalized =
        normalizeAcaAmountInput(acaBudgetAmountRaw ?? "") || (acaBudgetAmountRaw ?? "").trim();
      const acaDescription = (acaDescriptionRaw ?? issueText).trim();
      const acaObjective = (acaObjectiveRaw ?? "").trim();
      const dateSubmitted = (acaDateSubmittedRaw ?? "").trim();
      const implementationDate = (acaImplementationDateRaw ?? "").trim();
      const submittedByName =
        (acaSubmittedByNameRaw ?? "").trim() || (session.user.name ?? "").trim() || "Requester";
      const relatedTicketIds = (acaRelatedTicketIdsRaw ?? "").trim();
      let recommendedByAgentId = (acaRecommendedByAgentIdRaw ?? "").trim();
      let financeManagerAgentId = (acaFinanceManagerAgentIdRaw ?? "").trim();
      let approvingAgentIds = Array.isArray(acaApprovingAgentIdsRaw)
        ? acaApprovingAgentIdsRaw
            .map((v) => (typeof v === "string" ? v.trim() : ""))
            .filter(Boolean)
        : typeof acaApprovingAgentIdsRaw === "string" && acaApprovingAgentIdsRaw.trim()
          ? (() => {
              try {
                const parsed = JSON.parse(acaApprovingAgentIdsRaw) as unknown;
                return Array.isArray(parsed)
                  ? parsed.map((v) => (typeof v === "string" ? v.trim() : "")).filter(Boolean)
                  : [];
              } catch {
                return [];
              }
            })()
          : [];

      if (
        !acaCategory ||
        !acaNature ||
        !estimatedCostNormalized ||
        !budgetAmountNormalized ||
        !acaDescription ||
        !acaObjective ||
        !dateSubmitted ||
        !implementationDate
      ) {
        return NextResponse.json(
          {
            error:
              "Category, Nature of Request, Estimated Cost, Budget Amount, Description, Objective, Date Submitted, and Implementation Date are required for ACA.",
          },
          { status: 400 },
        );
      }

      const estimatedCostNum = parseAcaAmountNumber(estimatedCostNormalized);
      if (estimatedCostNum == null) {
        return NextResponse.json({ error: "Estimated cost must be a valid amount." }, { status: 400 });
      }

      const resolution = resolveAcaAuthority({
        category: acaCategory,
        natureOfRequest: acaNature,
        estimatedCost: estimatedCostNum,
      });
      if (!resolution.ok) {
        return NextResponse.json(
          { error: resolution.error || "Could not resolve Authority Matrix requirements." },
          { status: 400 },
        );
      }
      if (!resolution.requiresAca) {
        return NextResponse.json(
          {
            error:
              resolution.guidance ||
              "ACA is not required for this amount. Do not submit an Authority to Conduct Activity.",
          },
          { status: 400 },
        );
      }

      if (!resolution.recommendingLevel || !resolution.approvingPath) {
        return NextResponse.json(
          { error: "Authority Matrix path is incomplete for this request." },
          { status: 400 },
        );
      }

      const acaCompanyTeamId = intakeCompanyTeamId;
      const positionAssignees = await resolveAcaAssigneesFromPositions({
        recommendingLevel: resolution.recommendingLevel,
        approvingPath: resolution.approvingPath,
        approvingSeatCount: resolution.approvingSeatCount,
        companyTeamId: acaCompanyTeamId,
        requestorMergedSourceUserId,
        useRequestorCompanyLock: acaRecommendedByUsesRequestorCompanyLock(resolution.recommendingLevel),
      });
      if (!recommendedByAgentId && positionAssignees.recommendedByAgentId) {
        recommendedByAgentId = positionAssignees.recommendedByAgentId;
      }
      if (!financeManagerAgentId && positionAssignees.financeManagerAgentId) {
        financeManagerAgentId = positionAssignees.financeManagerAgentId;
      }
      if (
        approvingAgentIds.length === 0 &&
        positionAssignees.approvingAgentIds.length === resolution.approvingSeatCount
      ) {
        approvingAgentIds = positionAssignees.approvingAgentIds;
      } else if (approvingAgentIds.length < resolution.approvingSeatCount) {
        for (const agentId of positionAssignees.approvingAgentIds) {
          if (approvingAgentIds.length >= resolution.approvingSeatCount) break;
          if (!approvingAgentIds.includes(agentId)) approvingAgentIds.push(agentId);
        }
      }

      if (!recommendedByAgentId || !financeManagerAgentId) {
        return NextResponse.json(
          { error: "Recommended By and Finance Manager assignees are required." },
          { status: 400 },
        );
      }
      if (approvingAgentIds.length !== resolution.approvingSeatCount) {
        return NextResponse.json(
          {
            error: `Assign exactly ${resolution.approvingSeatCount} approving seat(s) for ${resolution.approvingLabel ?? "this path"}.`,
          },
          { status: 400 },
        );
      }
      if (approvingAgentIds.some((id) => !id)) {
        return NextResponse.json({ error: "All approving seats must be assigned." }, { status: 400 });
      }

      const roleIds = [recommendedByAgentId, financeManagerAgentId, ...approvingAgentIds];
      if (new Set(roleIds).size !== roleIds.length) {
        return NextResponse.json(
          { error: "Each ACA approval seat must be assigned to a different person." },
          { status: 400 },
        );
      }

      const found = await prisma.agent.findMany({
        where: { id: { in: roleIds } },
        select: { id: true },
      });
      if (found.length !== new Set(roleIds).size) {
        return NextResponse.json(
          { error: "One or more selected ACA approvers were not found." },
          { status: 400 },
        );
      }

      if (acaRecommendedByUsesRequestorCompanyLock(resolution.recommendingLevel)) {
        const requestorCompanyId = await resolveStaffCompanyTeamId(session.user.email);
        if (!requestorCompanyId) {
          return NextResponse.json(
            {
              error:
                "Your company must be assigned before selecting Recommended By for RA 1–2.",
            },
            { status: 400 },
          );
        }
        const recommendedCompanyId = await resolveAgentDesignatedCompanyId(recommendedByAgentId);
        if (!recommendedCompanyId || recommendedCompanyId !== requestorCompanyId) {
          return NextResponse.json(
            {
              error:
                "Recommended By for RA 1–2 must be someone from your company.",
            },
            { status: 400 },
          );
        }
      }

      const acaFields = {
        departmentStore,
        category: acaCategory,
        natureOfRequest: acaNature,
        estimatedCost: estimatedCostNormalized,
        budgetAmount: budgetAmountNormalized,
        description: acaDescription,
        objective: acaObjective,
        dateSubmitted,
        implementationDate,
        submittedByName,
        relatedTicketIds,
      };
      acaFormattedTitle = formatAcaRequestTitle(acaFields);
      acaFormattedDescription = formatAcaRequestDescription(acaFields);

      const creatorAgent = await findSessionAgentId({
        email: session.user.email,
        name: session.user.name,
      });
      acaCreateSeed = defaultAcaApprovalMeta({
        resolution,
        submittedByAgentId: creatorAgent?.id ?? null,
        recommendedByAgentId,
        financeManagerAgentId,
        approvingAgentIds,
        fields: {
          implementationDate,
          estimatedCost: estimatedCostNormalized,
          budgetAmount: budgetAmountNormalized,
          departmentStore,
          category: acaCategory,
          natureOfRequest: acaNature,
          submittedByName,
          description: acaDescription,
          objective: acaObjective,
          relatedTicketIds: relatedTicketIds
            ? relatedTicketIds
                .split(/[,;\s]+/)
                .map((s) => s.trim())
                .filter(Boolean)
            : [],
        },
      });
    }

    const sessionCompanyId =
      typeof session.user.companyId === "string" && session.user.companyId.trim()
        ? session.user.companyId.trim()
        : null;
    const screenshotList = Array.isArray(screenshotNames)
      ? screenshotNames.map((v) => String(v).trim()).filter(Boolean)
      : [];
    let normalizedTitle = (
      title ||
      issueText.split("\n")[0]?.trim() ||
      `${effectiveName} request`
    ).trim();
    let normalizedDescription = issueText;

    if (requestType === "REQUEST_FOR_PAYMENT") {
      const amountNormalized = normalizePaymentAmountInput(amount) || amount;
      const paymentFields = {
        payee,
        inPaymentOf,
        accountTitle,
        amount: amountNormalized,
        modeOfPayment: deferPaymentModeToAccounting ? "" : modeOfPayment,
        deliveryOfCheck: deferPaymentModeToAccounting ? "" : deliveryOfCheck,
        bankNameAccountNumber: deferPaymentModeToAccounting ? "" : bankNameAccountNumber,
        notes: issueText,
      };
      normalizedTitle = (title || formatPaymentRequestTitle(paymentFields)).trim();
      normalizedDescription = formatPaymentRequestDescription(paymentFields);
    } else if (requisitionFields) {
      normalizedTitle = (title || formatItemRequisitionTitle(requisitionFields)).trim();
      normalizedDescription = formatItemRequisitionDescription(requisitionFields);
    } else if (fundTransferFields) {
      normalizedTitle = (title || formatFundTransferRequestTitle(fundTransferFields)).trim();
      normalizedDescription = formatFundTransferRequestDescription(fundTransferFields);
    } else if (jobOrderFields) {
      normalizedTitle = (title || formatJobOrderTitle(jobOrderFields)).trim();
      normalizedDescription = formatJobOrderDescription(jobOrderFields);
    } else if (acaFormattedTitle && acaFormattedDescription) {
      normalizedTitle = (title || acaFormattedTitle).trim();
      normalizedDescription = acaFormattedDescription;
    }

    if (!normalizedTitle || !normalizedDescription || !effectiveName || !effectiveRequestorEmail || !effectiveContactEmail) {
      return NextResponse.json(
        { error: "Missing required fields." },
        { status: 400 },
      );
    }
    if (!categories.has(effectiveCategory as TicketCategory)) {
      return NextResponse.json({ error: "Invalid category." }, { status: 400 });
    }
    if (!priorities.has(effectivePriority as TicketPriority)) {
      return NextResponse.json({ error: "Invalid priority." }, { status: 400 });
    }

    const policy = await getSlaPolicy(effectivePriority as TicketPriority);
    const now = new Date();
    const firstResponseDueAt = addHours(now, policy.firstResponseHours);
    const resolutionDueAt = addHours(now, policy.resolutionHours);

    const googleOAuthCustomer =
      session.user.role === "Customer" &&
      (session.user.authProvider ?? "").trim().toLowerCase() === "google";

    let team: { id: string; name: string } | null = null;
    let customerRequestSbuText: string | null = null;
    let customerAssignedCompanyText: string | null = null;
    let customerAssignedOutsideQueue = false;
    let customerRequestOutsideQueue = false;
    let intakeRequestorSectionId: string | null = null;
    let intakeSendToSectionId: string | null = null;

    if (session.user.role === "Customer") {
      const assignedCompanyText = (assignedCompanyTextRaw ?? "").trim();
      if (!assignedCompanyText) {
        return NextResponse.json({ error: "Assigned company is required." }, { status: 400 });
      }
      if (assignedCompanyText.length > 500) {
        return NextResponse.json(
          { error: "Assigned company must be at most 500 characters." },
          { status: 400 },
        );
      }
      customerAssignedCompanyText = assignedCompanyText;

      const resolvedAssigned = await resolveCustomerRequestTeam({
        requestText: assignedCompanyText,
        fallbackTeamId: sessionCompanyId,
      });
      const outsideTeam = await ensureOutsideCompanyTeam();
      customerAssignedOutsideQueue = !resolvedAssigned;
      const effectivePortalCompanyId = resolvedAssigned?.team.id ?? outsideTeam.id;

      if (googleOAuthCustomer) {
        const trimmedOrgRole =
          (customerOrgRoleRaw ?? "").trim() ||
          (typeof session.user.customerOrgRole === "string" ? session.user.customerOrgRole.trim() : "");
        const effectiveOrgRole = trimmedOrgRole || "Personnel";
        if (effectiveOrgRole.length > 120) {
          return NextResponse.json({ error: "Your role must be at most 120 characters." }, { status: 400 });
        }
        await prisma.portalAccount.updateMany({
          where: { email: { equals: accountEmail, mode: "insensitive" } },
          data: {
            companyId: effectivePortalCompanyId,
            customerOrgRole: effectiveOrgRole,
          },
        });
      } else {
        await prisma.portalAccount.updateMany({
          where: { email: { equals: accountEmail, mode: "insensitive" } },
          data: { companyId: effectivePortalCompanyId },
        });
      }

      const requestToCompanySbu = (requestToCompanySbuRaw ?? "").trim();
      if (!requestToCompanySbu) {
        return NextResponse.json({ error: "Request to Company/SBU is required." }, { status: 400 });
      }
      if (requestToCompanySbu.length > 500) {
        return NextResponse.json(
          { error: "Request to Company/SBU must be at most 500 characters." },
          { status: 400 },
        );
      }
      customerRequestSbuText = requestToCompanySbu;

      // Target queue = "Send request to" only — never fall back to the requestor's company.
      const routed = await resolveCustomerRequestTeam({
        requestText: requestToCompanySbu,
        fallbackTeamId: null,
      });
      customerRequestOutsideQueue = !routed?.matched;
      team = routed?.matched ? routed.team : outsideTeam;
    } else {
      const rawCompanyTeamId = (companyTeamIdRaw || "").trim();
      const requestToCompanySbu = (requestToCompanySbuRaw ?? "").trim();
      if (requestToCompanySbu.length > 500) {
        return NextResponse.json(
          { error: "Request to Company/SBU must be at most 500 characters." },
          { status: 400 },
        );
      }

      const isStaffIntake =
        session.user.role === "Personnel" ||
        session.user.role === "Admin" ||
        isElevatedUserRole(session.user.role);

      if (isStaffIntake) {
        if (!requestorOrgChartSectionId) {
          return NextResponse.json(
            { error: "Requesting department is required." },
            { status: 400 },
          );
        }
        if (!(await orgChartSectionExists(requestorOrgChartSectionId))) {
          return NextResponse.json({ error: "Invalid requesting department." }, { status: 400 });
        }

        if (staffSendToMode === "company") {
          if (!sendToCompanyTeamId) {
            return NextResponse.json(
              { error: "Send request to (company) is required." },
              { status: 400 },
            );
          }
          const selectedTeam = await resolveRosterTeamById(sendToCompanyTeamId);
          if (!selectedTeam) {
            return NextResponse.json({ error: "Invalid company selection." }, { status: 400 });
          }
          team = selectedTeam;
          customerRequestSbuText = selectedTeam.name;
          intakeRequestorSectionId = requestorOrgChartSectionId;
          intakeSendToSectionId = null;
        } else {
          if (!sendToOrgChartSectionId) {
            return NextResponse.json(
              { error: "Send request to (department) is required." },
              { status: 400 },
            );
          }
          if (!(await orgChartSectionExists(sendToOrgChartSectionId))) {
            return NextResponse.json({ error: "Invalid send-to department." }, { status: 400 });
          }
          const sendToSection = await prisma.orgChartSection.findUnique({
            where: { id: sendToOrgChartSectionId },
            select: { name: true },
          });
          const teamIdFromSection = await resolveCompanyTeamIdForOrgChartSection(sendToOrgChartSectionId);
          const resolvedTeamId = teamIdFromSection ?? requestorCompanyTeamId;
          if (!resolvedTeamId) {
            return NextResponse.json(
              { error: "Could not resolve a company queue for the selected section." },
              { status: 400 },
            );
          }
          const selectedTeam = await resolveRosterTeamById(resolvedTeamId);
          if (!selectedTeam) {
            return NextResponse.json(
              { error: "Invalid company queue for the selected section." },
              { status: 400 },
            );
          }
          team = selectedTeam;
          customerRequestSbuText = sendToSection?.name ?? selectedTeam.name;
          intakeRequestorSectionId = requestorOrgChartSectionId;
          intakeSendToSectionId = sendToOrgChartSectionId;
        }
      } else if (rawCompanyTeamId) {
        const selectedTeam = await resolveRosterTeamById(rawCompanyTeamId);
        if (!selectedTeam) {
          return NextResponse.json({ error: "Invalid company/SBU selection." }, { status: 400 });
        }
        team = selectedTeam;
        customerRequestSbuText = selectedTeam.name;
      } else if (isStaffIntake && requestToCompanySbu) {
        // Legacy / name-only payloads: exact roster match only (no creator-company fallback).
        const exact = await resolveRosterTeamByExactName(requestToCompanySbu);
        if (!exact) {
          return NextResponse.json(
            { error: "Invalid company/SBU selection. Choose a roster company from Send request to." },
            { status: 400 },
          );
        }
        team = exact;
        customerRequestSbuText = requestToCompanySbu;
      } else {
        return NextResponse.json(
          { error: "Request to Company/SBU is required." },
          { status: 400 },
        );
      }
    }

    if (intakeApprovalAssignees) {
      const candidateIds = Object.values(intakeApprovalAssignees).filter(
        (id, idx, arr) => arr.indexOf(id) === idx,
      );
      // Prepared By is not set from intake assignees UI.
      const paymentScopedIds =
        requestType === "REQUEST_FOR_PAYMENT"
          ? [
              ...(skipPaymentNotedBy
                ? []
                : [pickAgentId(intakeApprovalAssignees.notedByAgentId)]),
              ...(skipApprovedBy
                ? []
                : [pickAgentId(intakeApprovalAssignees.approvedByAgentId)]),
              ...(isFormFlag(deferPaymentModeToAccountingRaw)
                ? []
                : [pickAgentId(intakeApprovalAssignees.accountingAgentId)]),
            ].filter((v): v is string => Boolean(v))
          : candidateIds;
      const idsToValidate =
        requestType === "REQUEST_FOR_PAYMENT" ? paymentScopedIds : candidateIds;
      if (idsToValidate.length > 0) {
        const found = await prisma.agent.findMany({
          where: { id: { in: idsToValidate } },
          select: { id: true },
        });
        if (found.length !== new Set(idsToValidate).size) {
          return NextResponse.json(
            { error: "One or more selected approval assignees were not found." },
            { status: 400 },
          );
        }
      }
      if (requestType === "REQUEST_FOR_PAYMENT") {
        const roleEntries: Array<[PaymentApprovalStep, string | null]> = [
          ...(skipPaymentNotedBy
            ? []
            : ([["NOTED_BY", pickAgentId(intakeApprovalAssignees.notedByAgentId)]] as Array<
                [PaymentApprovalStep, string | null]
              >)),
          ...(skipApprovedBy
            ? []
            : ([
                ["APPROVED_BY", pickAgentId(intakeApprovalAssignees.approvedByAgentId)],
              ] as Array<[PaymentApprovalStep, string | null]>)),
          ...(isFormFlag(deferPaymentModeToAccountingRaw)
            ? []
            : ([
                [
                  "APPROVED_BY_ACCOUNTING",
                  pickAgentId(intakeApprovalAssignees.accountingAgentId),
                ],
              ] as Array<[PaymentApprovalStep, string | null]>)),
        ];
        const seen = new Map<string, PaymentApprovalStep>();
        for (const [step, agentId] of roleEntries) {
          if (!agentId) continue;
          const prior = seen.get(agentId);
          if (prior) {
            return NextResponse.json(
              {
                error: `Each person may only approve once. The same user is set for both ${PAYMENT_APPROVAL_STEP_LABELS[prior]} and ${PAYMENT_APPROVAL_STEP_LABELS[step]}.`,
              },
              { status: 400 },
            );
          }
          seen.set(agentId, step);
        }
      }
    }

    const ticketNumber = await nextTicketNumber();

    const createData: Prisma.TicketCreateInput = {
      ticketNumber,
      title: normalizedTitle,
      description: normalizedDescription,
      category: effectiveCategory as TicketCategory,
      priority: effectivePriority as TicketPriority,
      contactName: effectiveName,
      contactEmail: effectiveContactEmail,
      contactPhone: contactPhone || null,
      team: team ? { connect: { id: team.id } } : undefined,
      firstResponseDueAt,
      resolutionDueAt,
    };
    (createData as Record<string, unknown>).requestorEmail = effectiveRequestorEmail;

    const ticket = await prisma.ticket.create({ data: createData });

    // Persist request type via raw SQL so this works even if Prisma Client wasn't regenerated yet.
    await prisma.$executeRaw`
      UPDATE tickets
      SET request_type = ${requestType}
      WHERE id = ${ticket.id}
    `;
    if (intakeRequestorSectionId || intakeSendToSectionId) {
      await prisma.$executeRaw`
        UPDATE tickets
        SET
          requestor_org_chart_section_id = ${intakeRequestorSectionId},
          org_chart_section_id = ${intakeSendToSectionId}
        WHERE id = ${ticket.id}
      `;
    }
    if (intakeRequestorSectionId) {
      const requestorSection = await prisma.orgChartSection.findUnique({
        where: { id: intakeRequestorSectionId },
        select: { name: true },
      });
      if (requestorSection?.name) {
        await logActivity(ticket.id, "USER", "Requesting department", requestorSection.name);
      }
    }
    if (intakeSendToSectionId) {
      const sendToSection = await prisma.orgChartSection.findUnique({
        where: { id: intakeSendToSectionId },
        select: { name: true },
      });
      if (sendToSection?.name) {
        await logActivity(ticket.id, "USER", "Send request to department", sendToSection.name);
      }
    } else if (staffSendToMode === "company" && sendToCompanyTeamId) {
      const sendToTeam = await prisma.team.findUnique({
        where: { id: sendToCompanyTeamId },
        select: { name: true },
      });
      if (sendToTeam?.name) {
        await logActivity(ticket.id, "USER", "Send request to company", sendToTeam.name);
      }
    }

    let uploadedMeta: IntakeScreenshotMetaItem[] | null = null;
    if (screenshotFiles && screenshotFiles.length > 0) {
      uploadedMeta = await persistTicketScreenshots(ticket.id, screenshotFiles, {
        section: requestType === "JOB_ORDER" ? "planning" : undefined,
      });
      await prisma.ticket.update({
        where: { id: ticket.id },
        data: { intakeScreenshotMeta: uploadedMeta },
      });
    }

    await logActivity(
      ticket.id,
      "SYSTEM",
      "Ticket logged",
      `Queued for ${team?.name ?? "triage"}. SLA: first response by ${firstResponseDueAt.toISOString()}, resolution by ${resolutionDueAt.toISOString()}.`,
    );
    await logActivity(ticket.id, "USER", "Request type", requestTypeLabel(requestType));
    if (requestType === "REQUEST_FOR_PAYMENT") {
      let meta = await initPaymentApprovalMetaIfNeeded(ticket.id);
      if (skipPaymentNotedBy || skipApprovedBy) {
        meta = {
          ...meta,
          proceduralStep: paymentApprovalStartStep(skipPaymentNotedBy, skipApprovedBy),
          ...(skipPaymentNotedBy ? { skipNotedBy: true, notedByAgentId: null } : {}),
          ...(skipApprovedBy ? { skipApprovedBy: true, approvedByAgentId: null } : {}),
        };
      }
      if (deferPaymentModeToAccounting) {
        meta = { ...meta, deferPaymentModeToAccounting: true };
      }
      if (deferPaymentModeToAccounting || skipApprovedBy || skipPaymentNotedBy) {
        await savePaymentApprovalMeta(ticket.id, meta);
      }
      if (deferPaymentModeToAccounting) {
        await logActivity(
          ticket.id,
          "USER",
          "Payment mode deferred",
          "Mode of payment will be set by Accounting on the ticket.",
        );
      }
      if (skipPaymentNotedBy) {
        await logActivity(
          ticket.id,
          "USER",
          "Noted By skipped",
          skipApprovedBy
            ? "This request starts at Approved By Accounting."
            : "This request starts at Approved By.",
        );
      }
      if (skipApprovedBy) {
        await logActivity(
          ticket.id,
          "USER",
          "Approved By skipped",
          skipPaymentNotedBy
            ? "This request starts at Approved By Accounting."
            : "After Noted By, this request continues at Prepared by Bookkeeper.",
        );
      }
      if (intakeApprovalAssignees) {
        const nextAssignees: Partial<PaymentApprovalAssignees> = {
          notedByAgentId: skipPaymentNotedBy
            ? null
            : pickAgentId(intakeApprovalAssignees.notedByAgentId),
          approvedByAgentId: skipApprovedBy
            ? null
            : pickAgentId(intakeApprovalAssignees.approvedByAgentId),
          accountingAgentId: deferPaymentModeToAccounting
            ? null
            : pickAgentId(intakeApprovalAssignees.accountingAgentId),
          financeAgentId: null,
        };
        meta = applyPaymentApprovalAssignees(meta, nextAssignees);
        if (deferPaymentModeToAccounting) {
          meta = { ...meta, deferPaymentModeToAccounting: true };
        }
        if (skipPaymentNotedBy) {
          meta = { ...meta, skipNotedBy: true, notedByAgentId: null };
        }
        if (skipApprovedBy) {
          meta = { ...meta, skipApprovedBy: true, approvedByAgentId: null };
        }
        await savePaymentApprovalMeta(ticket.id, meta);
        const boardAssigneeId = currentPaymentStepBoardAssigneeId(meta);
        if (boardAssigneeId) {
          await prisma.ticket.update({
            where: { id: ticket.id },
            data: {
              assignedAgent: { connect: { id: boardAssigneeId } },
              status: "IN_PROGRESS",
              resolvedAt: null,
            },
          });
        }
        await logActivity(
          ticket.id,
          "AGENT",
          "Payment approval assignees set at intake",
          "Procedural roles assigned when the request was created.",
        );
      }
      await logActivity(
        ticket.id,
        "SYSTEM",
        "Payment approval started",
        paymentProceduralStatusLabel(meta.proceduralStep) ?? "NOTED BY IS MISSING",
      );
    }
    if (requestType === "ITEM_REQUISITION_SLIP") {
      let meta = await initItemRequisitionApprovalMetaIfNeeded(ticket.id);
      if (intakeApprovalAssignees) {
        const nextAssignees: Partial<ItemRequisitionApprovalAssignees> = {
          // Canvassed By is set when the request is assigned on the Assignment Board.
          approvedByAgentId: pickAgentId(intakeApprovalAssignees.approvedByAgentId),
        };
        const agentIds = Object.values(nextAssignees).filter((v): v is string => Boolean(v));
        if (agentIds.length > 0) {
          const found = await prisma.agent.findMany({
            where: { id: { in: agentIds } },
            select: { id: true },
          });
          if (found.length !== new Set(agentIds).size) {
            return NextResponse.json(
              { error: "One or more selected item requisition assignees were not found." },
              { status: 400 },
            );
          }
        }
        meta = applyItemRequisitionApprovalAssignees(meta, nextAssignees);
        await saveItemRequisitionApprovalMeta(ticket.id, meta);
        await logActivity(
          ticket.id,
          "AGENT",
          "Item requisition approval assignees set at intake",
          meta.approvedByAgentId
            ? "Approved By set from the requestor’s company. Canvassed By will follow Assignment Board assignee."
            : "Canvassed By will follow Assignment Board assignee. Approved By will resolve from the requestor’s company when available.",
        );
      }
      await logActivity(
        ticket.id,
        "SYSTEM",
        "Item requisition approval started",
        itemRequisitionProceduralStatusLabel(meta.proceduralStep) ??
          "Assign on the Assignment Board to set Canvassed By",
      );
    }
    if (requestType === "FUND_TRANSFER_REQUEST") {
      let meta = await stampFundTransferCreatorOnCreate({
        ticketId: ticket.id,
        email: session.user.email ?? effectiveRequestorEmail ?? effectiveContactEmail,
        name: session.user.name ?? effectiveName,
        teamId: team?.id ?? null,
      });
      if (intakeApprovalAssignees) {
        const nextAssignees: Partial<FundTransferApprovalAssignees> = {
          recommendingApprovalAgentId: pickAgentId(
            intakeApprovalAssignees.recommendingApprovalAgentId,
          ),
          approvedByAgentId: pickAgentId(intakeApprovalAssignees.approvedByAgentId),
        };
        const agentIds = Object.values(nextAssignees).filter((v): v is string => Boolean(v));
        if (agentIds.length > 0) {
          const found = await prisma.agent.findMany({
            where: { id: { in: agentIds } },
            select: { id: true },
          });
          if (found.length !== new Set(agentIds).size) {
            return NextResponse.json(
              { error: "One or more selected fund transfer assignees were not found." },
              { status: 400 },
            );
          }
        }
        meta = applyFundTransferApprovalAssignees(meta, nextAssignees);
        await saveFundTransferApprovalMeta(ticket.id, meta);
        const boardAssigneeId = currentFundTransferStepBoardAssigneeId(meta);
        if (boardAssigneeId) {
          await prisma.ticket.update({
            where: { id: ticket.id },
            data: {
              assignedAgent: { connect: { id: boardAssigneeId } },
              status: "IN_PROGRESS",
              resolvedAt: null,
            },
          });
        }
        await logActivity(
          ticket.id,
          "AGENT",
          "Fund transfer approval assignees set at intake",
          "Procedural roles assigned when the request was created.",
        );
      }
      await logActivity(
        ticket.id,
        "SYSTEM",
        "Fund transfer approval started",
        fundTransferProceduralStatusLabel(meta.proceduralStep) ??
          "RECOMMENDING APPROVAL IS MISSING",
      );
    }
    if (requestType === "JOB_ORDER") {
      let meta = await stampJobOrderCreatorOnCreate({
        ticketId: ticket.id,
        email: session.user.email ?? effectiveRequestorEmail ?? effectiveContactEmail,
        name: session.user.name ?? effectiveName,
        teamId: team?.id ?? null,
      });
      if (skipJobOrderNotedBy || skipJobOrderApprovedBy) {
        meta = {
          ...meta,
          proceduralStep: jobOrderApprovalStartStep(
            skipJobOrderNotedBy,
            skipJobOrderApprovedBy,
          ),
          ...(skipJobOrderNotedBy ? { skipNotedBy: true, notedByAgentId: null } : {}),
          ...(skipJobOrderApprovedBy ? { skipApprovedBy: true, approvedByAgentId: null } : {}),
        };
        await saveJobOrderApprovalMeta(ticket.id, meta);
      }
      if (intakeApprovalAssignees) {
        const nextAssignees: Partial<JobOrderApprovalAssignees> = {
          notedByAgentId: skipJobOrderNotedBy
            ? null
            : pickAgentId(intakeApprovalAssignees.notedByAgentId),
          approvedByAgentId: skipJobOrderApprovedBy
            ? null
            : pickAgentId(intakeApprovalAssignees.approvedByAgentId),
          approvedBy2AgentId: pickAgentId(intakeApprovalAssignees.approvedBy2AgentId),
        };
        const agentIds = Object.values(nextAssignees).filter((v): v is string => Boolean(v));
        if (agentIds.length > 0) {
          const found = await prisma.agent.findMany({
            where: { id: { in: agentIds } },
            select: { id: true },
          });
          if (found.length !== new Set(agentIds).size) {
            return NextResponse.json(
              { error: "One or more selected job order assignees were not found." },
              { status: 400 },
            );
          }
        }
        meta = applyJobOrderApprovalAssignees(meta, nextAssignees);
        if (skipJobOrderNotedBy) {
          meta = { ...meta, skipNotedBy: true, notedByAgentId: null };
        }
        if (skipJobOrderApprovedBy) {
          meta = { ...meta, skipApprovedBy: true, approvedByAgentId: null };
        }
        await saveJobOrderApprovalMeta(ticket.id, meta);
        const boardAssigneeId = currentJobOrderStepBoardAssigneeId(meta);
        if (boardAssigneeId) {
          await prisma.ticket.update({
            where: { id: ticket.id },
            data: {
              assignedAgent: { connect: { id: boardAssigneeId } },
              status: "IN_PROGRESS",
              resolvedAt: null,
            },
          });
        }
        await logActivity(
          ticket.id,
          "AGENT",
          "Job order approval assignees set at intake",
          "Procedural roles assigned when the request was created.",
        );
      }
      if (skipJobOrderNotedBy || skipJobOrderApprovedBy) {
        const skipped: string[] = [];
        if (skipJobOrderNotedBy) skipped.push("Noted By");
        if (skipJobOrderApprovedBy) skipped.push("Approved By (Send-to)");
        await logActivity(
          ticket.id,
          "SYSTEM",
          "Job order approval seats skipped",
          `${skipped.join(" and ")} skipped at intake.`,
        );
      }
      await logActivity(
        ticket.id,
        "SYSTEM",
        "Job order approval started",
        jobOrderProceduralStatusLabel(meta.proceduralStep) ?? "NOTED BY IS MISSING",
      );
    }
    if (requestType === "AUTHORITY_TO_CONDUCT_ACTIVITY" && acaCreateSeed) {
      const requestorCompanyId = await resolveStaffCompanyTeamId(session.user.email);
      const requestorCompany = requestorCompanyId
        ? await prisma.team.findUnique({
            where: { id: requestorCompanyId },
            select: { name: true },
          })
        : null;
      const meta = {
        ...acaCreateSeed,
        formCode: resolveAcaFormCode(requestorCompany?.name ?? null),
      };
      await saveAcaApprovalMeta(ticket.id, meta);
      const boardAssigneeId =
        meta.levels.find((l) => l.key === meta.proceduralStep)?.agentId ?? null;
      if (boardAssigneeId) {
        await prisma.ticket.update({
          where: { id: ticket.id },
          data: {
            assignedAgent: { connect: { id: boardAssigneeId } },
            status: "IN_PROGRESS",
          },
        });
      }
      await logActivity(
        ticket.id,
        "SYSTEM",
        "ACA approval started",
        acaProceduralStatusLabel(meta) ?? "RECOMMENDED BY IS MISSING",
      );
      await logActivity(
        ticket.id,
        "SYSTEM",
        "ACA approvers assigned",
        `${meta.matrixSnapshot.guidance} Request is not green-lit until all seats mark Done.`,
      );
    }
    const requestSbuFreeText = customerRequestSbuText;
    if (team) {
      if (requestSbuFreeText) {
        await logActivity(ticket.id, "USER", "Request to Company/SBU", requestSbuFreeText);
        if (customerRequestOutsideQueue) {
          await logActivity(
            ticket.id,
            "SYSTEM",
            "Routing note",
            `No roster SBU matched the request text; ticket queued under ${team.name}.`,
          );
        }
      } else {
        await logActivity(ticket.id, "USER", "Request to Company/SBU", team.name);
      }
    }
    if (session.user.role === "Customer") {
      if (customerAssignedOutsideQueue) {
        await logActivity(
          ticket.id,
          "SYSTEM",
          "Assigned company routing",
          "Could not map typed assigned company to a roster SBU; account company set to OUTSIDE COMPANY for triage.",
        );
      }
      if (customerAssignedCompanyText) {
        await logActivity(ticket.id, "USER", "Assigned company", customerAssignedCompanyText);
      }
      const orgRole = googleOAuthCustomer
        ? (customerOrgRoleRaw ?? "").trim() ||
          (typeof session.user.customerOrgRole === "string" ? session.user.customerOrgRole.trim() : "") ||
          "Personnel"
        : session.user.customerOrgRole?.trim();
      if (orgRole) {
        await logActivity(ticket.id, "USER", "Customer org role", orgRole);
      }
    }
    if (branch) {
      await logActivity(ticket.id, "USER", "Branch", branch);
    }
    if (requestingCompanyName) {
      await logActivity(ticket.id, "USER", "Requesting company", requestingCompanyName);
    }
    if (department) {
      await logActivity(
        ticket.id,
        "USER",
        "Requesting department",
        department,
      );
    }
    if (requestType === "REQUEST_FOR_PAYMENT") {
      await logActivity(ticket.id, "USER", "Payee", payee);
      await logActivity(ticket.id, "USER", "In payment of", inPaymentOf);
      if (accountTitle) {
        await logActivity(ticket.id, "USER", "Account title", accountTitle);
      }
      await logActivity(
        ticket.id,
        "USER",
        "Amount",
        formatPaymentPeso(amount) || amount,
      );
      if (modeOfPayment && !deferPaymentModeToAccounting) {
        await logActivity(ticket.id, "USER", "Mode of payment", modeOfPayment);
      }
      if (deliveryOfCheck && !deferPaymentModeToAccounting) {
        await logActivity(ticket.id, "USER", "Delivery of check", deliveryOfCheck);
      }
      if (bankNameAccountNumber && !deferPaymentModeToAccounting) {
        await logActivity(ticket.id, "USER", "Bank name / account number", bankNameAccountNumber);
      }
    }
    if (fundTransferFields) {
      await logActivity(ticket.id, "USER", "Fund transfer amount", fundTransferFields.fundTransferAmount);
      await logActivity(ticket.id, "USER", "From account name", fundTransferFields.fromAccountName);
      await logActivity(ticket.id, "USER", "From account number", fundTransferFields.fromAccountNumber);
      await logActivity(ticket.id, "USER", "To account name", fundTransferFields.toAccountName);
      await logActivity(ticket.id, "USER", "To account number", fundTransferFields.toAccountNumber);
      await logActivity(ticket.id, "USER", "Bank name", fundTransferFields.bankName);
      await logActivity(ticket.id, "USER", "Bank address", fundTransferFields.bankAddress);
    }
    if (uploadedMeta && uploadedMeta.length > 0) {
      const label = uploadedMeta.map((m) => m.originalName).join(", ");
      await logActivity(ticket.id, "USER", "Screenshots attached", label);
    } else if (screenshotList.length > 0) {
      await logActivity(
        ticket.id,
        "USER",
        "Screenshots attached",
        screenshotList.join(", "),
      );
    }

    if (team) {
      await logActivity(
        ticket.id,
        "SYSTEM",
        "Auto-routed to team queue",
        team.name,
      );
    }
    if (await shouldNotifyAdminOnCreate(effectivePriority as TicketPriority)) {
      await logActivity(
        ticket.id,
        "SYSTEM",
        "Priority alert sent",
        "Priority-based trigger notified Admin visibility channel.",
      );
    }
    if (await shouldNotifySuperAdminOnCreate(effectivePriority as TicketPriority)) {
      await logActivity(
        ticket.id,
        "SYSTEM",
        "Priority alert sent",
        "Priority-based trigger notified SuperAdmin visibility channel.",
      );
    }

    if (process.env.NODE_ENV === "development") {
      console.info(
        `[perf] POST /api/tickets ${Date.now() - startedAt}ms ticket=${ticket.ticketNumber}`,
      );
    }
    const responsePayload =
      uploadedMeta && uploadedMeta.length > 0 ? { ...ticket, intakeScreenshotMeta: uploadedMeta } : ticket;
    return NextResponse.json(responsePayload, { status: 201 });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: "Could not create ticket." },
      { status: 500 },
    );
  }
}
