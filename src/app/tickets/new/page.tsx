"use client";

import { isElevatedPlatformRole } from "@/lib/staff-role";

import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useMemo, useRef, useState, Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input, Select, Textarea } from "@/components/ui/field";
import { ChevronDown } from "lucide-react";
import { RequestTypeSelection } from "@/components/tickets/RequestTypeSelection";
import { BRAND_TITLE } from "@/lib/brand";
import { issueConcernIntakeLockMessage } from "@/lib/issue-concern-intake-lock";
import {
  DEFAULT_REQUEST_TYPE,
  isIssueConcernTicket,
  parseRequestTypeId,
  recommendedSendToDepartmentName,
  requestTypeLabel,
  type RequestTypeId,
} from "@/lib/request-types";
import {
  firstVisibleIntakeRequestType,
  isRequestTypeHiddenFromIntake,
} from "@/lib/intake-request-type-visibility";
import {
  DELIVERY_OF_CHECK_OPTIONS,
  MODE_OF_PAYMENT_CHECK,
  MODE_OF_PAYMENT_OPTIONS,
  paymentModeRequiresBankDetails,
  paymentModeShowsBankDetails,
} from "@/lib/request-for-payment";
import {
  emptyRequisitionLineItem,
  REQUISITION_UNIT_OPTIONS,
  validateItemRequisitionFields,
  type RequisitionLineItem,
} from "@/lib/item-requisition";
import { validateFundTransferRequestFields } from "@/lib/fund-transfer-request";
import {
  JOB_ORDER_NATURE_GROUPS,
  computeJobOrderDurationDays,
  formatJobOrderDurationLabel,
  validateJobOrderFields,
} from "@/lib/job-order";
import {
  INTAKE_ATTACHMENT_ACCEPT,
  isAllowedIntakeAttachment,
  isIntakeImageMimeOrName,
  MAX_SCREENSHOT_BYTES,
  MAX_SCREENSHOT_COUNT,
} from "@/lib/ticket-intake-screenshots-constants";
import { isTicketRequestorRole } from "@/lib/ticket-requestor";
import { DatePickerField } from "@/components/ui/DatePickerField";
import { CompanyUserSearchField } from "@/components/tickets/CompanyUserSearchField";
import { AcaIntakeFields } from "@/components/tickets/AcaIntakeFields";
import { FileText, Paperclip, Plus, Trash2 } from "lucide-react";
import { acaRecommendedByUsesRequestorCompanyLock, resolveAcaAuthority } from "@/lib/aca-authority-matrix";
import { parseAcaAmountNumber } from "@/lib/authority-to-conduct-activity";
import {
  findOrgChartSectionByName,
  orgChartMajorDepartments,
  orgChartSectionOptionText,
  orgChartSubDepartments,
  resolveSendToDepartmentSelection,
  type OrgChartSectionOption,
} from "@/lib/org-chart-section-display";
import { IntakeApprovalRecommendationGuide } from "@/components/tickets/IntakeApprovalRecommendationGuide";

function todayIsoDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function pickImageFiles(list: File[]) {
  return list.filter((f) => isIntakeImageMimeOrName(f.type || "", f.name));
}

function pickAttachmentFiles(list: File[]) {
  return list.filter((f) => isAllowedIntakeAttachment(f.type || "", f.name));
}

function mergeApprovalAgentOptions<T extends { id: string; name: string; email: string }>(
  prev: T[],
  extras: Array<{ id: string; name: string }>,
): T[] {
  if (extras.length === 0) return prev;
  const ids = new Set(prev.map((a) => a.id));
  const next = [...prev];
  for (const extra of extras) {
    const id = extra.id.trim();
    if (!id || ids.has(id)) continue;
    ids.add(id);
    next.push({ ...({ id, name: extra.name.trim() || id, email: "" } as T) });
  }
  return next;
}
export default function NewTicketPage() {
  return <NewTicketIntake mode="page" />;
}

export type NewTicketIntakeProps = {
  mode?: "page" | "modal";
  controlledType?: RequestTypeId | null;
  onControlledTypeChange?: (type: RequestTypeId | null) => void;
  onClose?: () => void;
  onCreated?: () => void;
};

export function NewTicketIntake({
  mode = "page",
  controlledType = null,
  onControlledTypeChange,
  onClose,
  onCreated,
}: NewTicketIntakeProps) {
  return (
    <Suspense
      fallback={
        mode === "modal" ? (
          <p className="px-1 py-6 text-sm text-zinc-600 dark:text-zinc-400">Loading request intake…</p>
        ) : (
          <main className="min-h-[calc(100vh-56px)] bg-zinc-50 px-3 py-8 text-zinc-900 dark:bg-[#0e0e0d] dark:text-zinc-100">
            <p className="mx-auto max-w-5xl text-sm text-zinc-600 dark:text-zinc-400">Loading request intake…</p>
          </main>
        )
      }
    >
      <NewTicketPageInner
        mode={mode}
        controlledType={controlledType}
        onControlledTypeChange={onControlledTypeChange}
        onClose={onClose}
        onCreated={onCreated}
      />
    </Suspense>
  );
}

function NewTicketPageInner({
  mode = "page",
  controlledType = null,
  onControlledTypeChange,
  onClose,
  onCreated,
}: NewTicketIntakeProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session, status: sessionStatus } = useSession();
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [screenshots, setScreenshots] = useState<File[]>([]);
  const [priority, setPriority] = useState<"LOW" | "MEDIUM" | "HIGH" | "URGENT">("LOW");
  const [modeOfPayment, setModeOfPayment] = useState("");
  const [deliveryOfCheck, setDeliveryOfCheck] = useState("");
  const [letAccountingHandlePaymentMode, setLetAccountingHandlePaymentMode] = useState(false);
  const [draftRequestType, setDraftRequestType] =
    useState<RequestTypeId>(DEFAULT_REQUEST_TYPE);
  const [hiddenRequestTypeIds, setHiddenRequestTypeIds] = useState<RequestTypeId[]>([]);
  const [hiddenRequestTypesReady, setHiddenRequestTypesReady] = useState(false);
  const urlRequestType = useMemo(() => {
    const raw = searchParams.get("type");
    return raw ? parseRequestTypeId(raw) : null;
  }, [searchParams]);
  const activeRequestType = mode === "modal" ? controlledType : urlRequestType;
  const showTypeSelection = activeRequestType == null;
  const showRequestForm = activeRequestType != null;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/public/intake-request-types", { cache: "no-store" });
        const data = (await res.json().catch(() => ({}))) as { hiddenTypeIds?: RequestTypeId[] };
        if (cancelled) return;
        setHiddenRequestTypeIds(Array.isArray(data.hiddenTypeIds) ? data.hiddenTypeIds : []);
      } finally {
        if (!cancelled) setHiddenRequestTypesReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hiddenRequestTypesReady) return;
    const firstVisible = firstVisibleIntakeRequestType(hiddenRequestTypeIds);
    setDraftRequestType((current) =>
      isRequestTypeHiddenFromIntake(current, hiddenRequestTypeIds) ? firstVisible : current,
    );
  }, [hiddenRequestTypesReady, hiddenRequestTypeIds]);

  useEffect(() => {
    if (!hiddenRequestTypesReady || activeRequestType == null) return;
    if (isRequestTypeHiddenFromIntake(activeRequestType, hiddenRequestTypeIds)) {
      setError("That request type is not available.");
      if (mode === "modal") onControlledTypeChange?.(null);
      else router.replace("/tickets/new");
    }
  }, [
    hiddenRequestTypesReady,
    activeRequestType,
    hiddenRequestTypeIds,
    router,
    mode,
    onControlledTypeChange,
  ]);

  const isPaymentRequest = activeRequestType === "REQUEST_FOR_PAYMENT";
  const isAcaRequest = activeRequestType === "AUTHORITY_TO_CONDUCT_ACTIVITY";
  const isRequisitionRequest = activeRequestType === "ITEM_REQUISITION_SLIP";
  const isFundTransferRequest = activeRequestType === "FUND_TRANSFER_REQUEST";
  const isJobOrderRequest = activeRequestType === "JOB_ORDER";
  const [requisitionItems, setRequisitionItems] = useState<RequisitionLineItem[]>([
    emptyRequisitionLineItem(0),
  ]);
  const [jobOrderNatures, setJobOrderNatures] = useState<string[]>([]);
  const [jobOrderStartDate, setJobOrderStartDate] = useState("");
  const [jobOrderTargetDate, setJobOrderTargetDate] = useState("");
  const [jobOrderExpectedDuration, setJobOrderExpectedDuration] = useState("");

  useEffect(() => {
    if (!isJobOrderRequest) return;
    const days = computeJobOrderDurationDays(jobOrderStartDate, jobOrderTargetDate);
    const label = formatJobOrderDurationLabel(days);
    if (label) setJobOrderExpectedDuration(label);
  }, [isJobOrderRequest, jobOrderStartDate, jobOrderTargetDate]);
  const [purposeOfRequest, setPurposeOfRequest] = useState("");
  const [selectedCompanyTeamId, setSelectedCompanyTeamId] = useState("");
  const [sendToMode, setSendToMode] = useState<"company" | "department">("department");
  const [selectedSendToCompanyTeamId, setSelectedSendToCompanyTeamId] = useState("");
  const [approvalAgents, setApprovalAgents] = useState<
    Array<{
      id: string;
      name: string;
      email: string;
      subtitle?: string | null;
      group?: string | null;
      optionKey?: string | null;
    }>
  >([]);
  const [orgChartSectionOptions, setOrgChartSectionOptions] = useState<
    OrgChartSectionOption[]
  >([]);
  const [requestorSectionOptions, setRequestorSectionOptions] = useState<
    OrgChartSectionOption[]
  >([]);
  const [sectionsLoading, setSectionsLoading] = useState(false);
  const [selectedRequestorOrgChartSectionId, setSelectedRequestorOrgChartSectionId] = useState("");
  const [selectedSendToMajorDepartmentId, setSelectedSendToMajorDepartmentId] = useState("");
  const [selectedSendToSubDepartmentId, setSelectedSendToSubDepartmentId] = useState("");
  const selectedSendToOrgChartSectionId =
    selectedSendToSubDepartmentId.trim() || selectedSendToMajorDepartmentId.trim();
  const [useCustomRequestingCompany, setUseCustomRequestingCompany] = useState(false);
  const [selectedRequestingCompanyTeamId, setSelectedRequestingCompanyTeamId] = useState("");
  const [paymentAssignees, setPaymentAssignees] = useState({
    notedByAgentId: "",
    approvedByAgentId: "",
    accountingAgentId: "",
    financeAgentId: "",
  });
  const [skipPaymentNotedBy, setSkipPaymentNotedBy] = useState(false);
  const [skipPaymentApprovedBy, setSkipPaymentApprovedBy] = useState(false);
  const [skipJobOrderNotedBy, setSkipJobOrderNotedBy] = useState(false);
  const [skipJobOrderApprovedBy, setSkipJobOrderApprovedBy] = useState(false);
  const [fundTransferAssignees, setFundTransferAssignees] = useState({
    recommendingApprovalAgentId: "",
    approvedByAgentId: "",
  });
  const [jobOrderAssignees, setJobOrderAssignees] = useState({
    notedByAgentId: "",
    approvedByAgentId: "",
    approvedBy2AgentId: "",
  });
  const [itemRequisitionAssignees, setItemRequisitionAssignees] = useState({
    approvedByAgentId: "",
  });
  const detailsField = useMemo(
    () => ({
      label: "Issue",
      placeholder: "Describe the issue, impact, and any steps already taken.",
    }),
    [],
  );
  const [intake, setIntake] = useState<{
    canCreateIssueConcern: boolean;
    authProvider: string | null;
    pendingConfirmation: { verificationHref: string; ticketNumber: string } | null;
    message: string | null;
  }>({ canCreateIssueConcern: true, authProvider: null, pendingConfirmation: null, message: null });
  /** False until `/api/me/intake-lock` returns (Customer + Personnel as requestor). */
  const [intakeGateReady, setIntakeGateReady] = useState(true);
  const [companyTeams, setCompanyTeams] = useState<{ id: string; name: string }[]>([]);
  const [companiesLoading, setCompaniesLoading] = useState(false);
  const [staffDesignatedCompany, setStaffDesignatedCompany] = useState<{ id: string; name: string } | null>(null);
  const [staffDesignatedLoading, setStaffDesignatedLoading] = useState(false);
  const [acaCategory, setAcaCategory] = useState("");
  const [acaNatureOfRequest, setAcaNatureOfRequest] = useState("");
  const [acaEstimatedCost, setAcaEstimatedCost] = useState("");
  const [acaBudgetAmount, setAcaBudgetAmount] = useState("");
  const [acaDescription, setAcaDescription] = useState("");
  const [acaObjective, setAcaObjective] = useState("");
  const [acaDateSubmitted, setAcaDateSubmitted] = useState(todayIsoDate);
  const [acaImplementationDate, setAcaImplementationDate] = useState("");
  const [acaRelatedTicketIds, setAcaRelatedTicketIds] = useState("");
  const [acaRecommendedByAgentId, setAcaRecommendedByAgentId] = useState("");
  const [acaFinanceManagerAgentId, setAcaFinanceManagerAgentId] = useState("");
  const [acaApprovingAgentIds, setAcaApprovingAgentIds] = useState<string[]>([]);
  const [acaAnyCompanyAgents, setAcaAnyCompanyAgents] = useState<
    Array<{ id: string; name: string; email?: string | null }>
  >([]);
  const [acaRequestorCompanyAgents, setAcaRequestorCompanyAgents] = useState<
    Array<{ id: string; name: string; email?: string | null }>
  >([]);
  const [acaApproversLoading, setAcaApproversLoading] = useState(false);

  const screenshotPreviews = useMemo(
    () =>
      screenshots.map((file, index) => {
        const isImage = isIntakeImageMimeOrName(file.type || "", file.name);
        return {
          key: `${index}-${file.name}-${file.size}-${file.lastModified}`,
          name: file.name,
          url: isImage ? URL.createObjectURL(file) : "",
        };
      }),
    [screenshots],
  );

  useEffect(
    () => () => {
      screenshotPreviews.forEach((s) => {
        if (s.url) URL.revokeObjectURL(s.url);
      });
    },
    [screenshotPreviews],
  );

  useEffect(() => {
    let cancelled = false;
    async function loadIntakeLock() {
      if (sessionStatus !== "authenticated") return;
      const role = session?.user?.role;
      if (!isTicketRequestorRole(role)) {
        setIntakeGateReady(true);
        return;
      }
      setIntakeGateReady(false);
      try {
        const res = await fetch("/api/me/intake-lock", { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const j = (await res.json().catch(() => ({}))) as {
          canCreateTickets?: boolean;
          canCreateIssueConcern?: boolean;
          authProvider?: string | null;
          pendingConfirmation?: { verificationHref: string; ticketNumber: string } | null;
          message?: string | null;
        };
        if (cancelled) return;
        const canCreateIssueConcern =
          typeof j.canCreateIssueConcern === "boolean"
            ? j.canCreateIssueConcern
            : Boolean(j.canCreateTickets);
        setIntake({
          canCreateIssueConcern,
          authProvider: typeof j.authProvider === "string" ? j.authProvider : null,
          pendingConfirmation: j.pendingConfirmation ?? null,
          message:
            typeof j.message === "string" && j.message.trim()
              ? j.message
              : canCreateIssueConcern
                ? null
                : issueConcernIntakeLockMessage(j.pendingConfirmation?.ticketNumber),
        });
      } catch {
        // Network/HMR failures — leave defaults; gate still opens in finally.
      } finally {
        if (!cancelled) setIntakeGateReady(true);
      }
    }
    void loadIntakeLock();
    return () => {
      cancelled = true;
    };
  }, [sessionStatus, session?.user?.role]);

  useEffect(() => {
    let cancelled = false;
    async function loadCompanies() {
      if (sessionStatus !== "authenticated") return;
      setCompaniesLoading(true);
      try {
        const res = await fetch("/api/public/companies", { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const list = (await res.json().catch(() => [])) as { id: string; name: string }[];
        if (cancelled || !Array.isArray(list)) return;
        setCompanyTeams(list);
      } catch {
        if (!cancelled) setCompanyTeams([]);
      } finally {
        if (!cancelled) setCompaniesLoading(false);
      }
    }
    void loadCompanies();
    return () => {
      cancelled = true;
    };
  }, [sessionStatus, session?.user?.role]);

  useEffect(() => {
    let cancelled = false;
    async function loadStaffDesignatedCompany() {
      if (sessionStatus !== "authenticated") return;
      if (session?.user?.role === "Customer") return;
      setStaffDesignatedLoading(true);
      try {
        const res = await fetch("/api/me/staff-designated-company", { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const j = (await res.json().catch(() => ({}))) as {
          designatedCompanyTeamId?: string | null;
          designatedCompanyName?: string | null;
        };
        const id = typeof j.designatedCompanyTeamId === "string" ? j.designatedCompanyTeamId.trim() : null;
        const name = typeof j.designatedCompanyName === "string" ? j.designatedCompanyName.trim() : null;
        setStaffDesignatedCompany(
          id ? { id, name: name || id } : null,
        );
      } catch {
        if (!cancelled) setStaffDesignatedCompany(null);
      } finally {
        if (!cancelled) setStaffDesignatedLoading(false);
      }
    }
    void loadStaffDesignatedCompany();
    return () => {
      cancelled = true;
    };
  }, [sessionStatus, session?.user?.role, session?.user?.email]);

  useEffect(() => {
    if (!staffDesignatedCompany?.id) return;
    setSelectedSendToCompanyTeamId((prev) => prev || staffDesignatedCompany.id);
  }, [staffDesignatedCompany?.id]);

  useEffect(() => {
    if (!isAcaRequest) {
      setAcaAnyCompanyAgents([]);
      setAcaRequestorCompanyAgents([]);
      setAcaRecommendedByAgentId("");
      setAcaFinanceManagerAgentId("");
      setAcaApprovingAgentIds([]);
      return;
    }
    let cancelled = false;
    setAcaApproversLoading(true);

    async function loadCompanyAgents(companyId: string | null | undefined) {
      const id = (companyId ?? "").trim();
      if (!id) return [] as Array<{ id: string; name: string; email?: string | null }>;
      const res = await fetch(`/api/agents?company=${encodeURIComponent(id)}`, { cache: "no-store" });
      if (!res.ok) return [];
      const rows = (await res.json()) as Array<{ id: string; name: string; email?: string | null }>;
      return Array.isArray(rows) ? rows : [];
    }

    void (async () => {
      const [anyRows, requestorRows] = await Promise.all([
        fetch("/api/agents?anyCompany=1", { cache: "no-store" })
          .then((r) => (r.ok ? r.json() : []))
          .then((rows: Array<{ id: string; name: string; email?: string | null }>) =>
            Array.isArray(rows) ? rows : [],
          )
          .catch(() => [] as Array<{ id: string; name: string; email?: string | null }>),
        loadCompanyAgents(staffDesignatedCompany?.id),
      ]);
      if (cancelled) return;
      setAcaAnyCompanyAgents(anyRows);
      setAcaRequestorCompanyAgents(requestorRows);
      const anyIds = new Set(anyRows.map((a) => a.id));
      setAcaFinanceManagerAgentId((prev) => (prev && anyIds.has(prev) ? prev : ""));
      setAcaApprovingAgentIds((prev) => prev.map((id) => (id && anyIds.has(id) ? id : "")));
    })()
      .catch(() => {
        if (!cancelled) {
          setAcaAnyCompanyAgents([]);
          setAcaRequestorCompanyAgents([]);
        }
      })
      .finally(() => {
        if (!cancelled) setAcaApproversLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isAcaRequest, staffDesignatedCompany?.id]);

  const acaResolution = useMemo(() => {
    if (!isAcaRequest || !acaCategory || !acaNatureOfRequest) return null;
    const amount = parseAcaAmountNumber(acaEstimatedCost);
    if (amount == null) return null;
    return resolveAcaAuthority({
      category: acaCategory,
      natureOfRequest: acaNatureOfRequest,
      estimatedCost: amount,
    });
  }, [isAcaRequest, acaCategory, acaNatureOfRequest, acaEstimatedCost]);

  const acaRaLockedToRequestor = acaRecommendedByUsesRequestorCompanyLock(
    acaResolution?.recommendingLevel,
  );
  const acaRecommendedByUsers = useMemo(
    () => (acaRaLockedToRequestor ? acaRequestorCompanyAgents : acaAnyCompanyAgents),
    [acaRaLockedToRequestor, acaRequestorCompanyAgents, acaAnyCompanyAgents],
  );

  useEffect(() => {
    if (!isAcaRequest || acaApproversLoading) return;
    const ids = new Set(acaRecommendedByUsers.map((a) => a.id));
    setAcaRecommendedByAgentId((prev) => (prev && ids.has(prev) ? prev : ""));
  }, [isAcaRequest, acaApproversLoading, acaRaLockedToRequestor, acaRecommendedByUsers]);

  useEffect(() => {
    if (!isAcaRequest) return;
    const seats = acaResolution?.requiresAca ? acaResolution.approvingSeatCount : 0;
    setAcaApprovingAgentIds((prev) => {
      const next = Array.from({ length: seats }, (_, i) => prev[i] ?? "");
      if (next.length === prev.length && next.every((v, i) => v === prev[i])) return prev;
      return next;
    });
  }, [isAcaRequest, acaResolution?.requiresAca, acaResolution?.approvingSeatCount]);

  const isCustomer = session?.user?.role === "Customer";
  const isPersonnelIntake = session?.user?.role === "Personnel";
  const isAdminStaffIntake =
    isElevatedPlatformRole(session?.user?.role) || session?.user?.role === "Admin";
  /** Admin/SuperAdmin use the same intake field layout as Personnel. */
  const isStaffRequestorIntake = isPersonnelIntake || isAdminStaffIntake;
  const canSetIntakeAssignees =
    isStaffRequestorIntake &&
    (isPaymentRequest ||
      isFundTransferRequest ||
      isJobOrderRequest ||
      isRequisitionRequest);
  const canShowAcaRecommendations =
    isStaffRequestorIntake &&
    isAcaRequest &&
    Boolean(acaResolution?.requiresAca && acaResolution.recommendingLevel && acaResolution.approvingPath);
  const isRequestorIntakeLockRole = isTicketRequestorRole(session?.user?.role);

  useEffect(() => {
    if (!isStaffRequestorIntake) {
      setOrgChartSectionOptions([]);
      setRequestorSectionOptions([]);
      setSelectedRequestorOrgChartSectionId("");
      setSelectedSendToMajorDepartmentId("");
      setSelectedSendToSubDepartmentId("");
      setSendToMode("department");
      setSelectedSendToCompanyTeamId("");
      setUseCustomRequestingCompany(false);
      setSelectedRequestingCompanyTeamId("");
      return;
    }
    let cancelled = false;
    setSectionsLoading(true);
    void (async () => {
      try {
        const [allRes, mineRes] = await Promise.all([
          fetch("/api/org-chart-sections", { cache: "no-store" }),
          fetch("/api/me/org-chart-sections", { cache: "no-store" }),
        ]);
        if (cancelled) return;
        const allJson = allRes.ok
          ? ((await allRes.json()) as {
              sections?: OrgChartSectionOption[];
            })
          : { sections: [] };
        const mineJson = mineRes.ok
          ? ((await mineRes.json()) as {
              sections?: OrgChartSectionOption[];
              defaultSectionId?: string | null;
            })
          : { sections: [], defaultSectionId: null };
        const allSections = Array.isArray(allJson.sections) ? allJson.sections : [];
        const mineSections = Array.isArray(mineJson.sections) ? mineJson.sections : [];
        setOrgChartSectionOptions(allSections);
        setRequestorSectionOptions(mineSections.length > 0 ? mineSections : allSections);
        setSelectedRequestorOrgChartSectionId((prev) => {
          if (
            prev &&
            (mineSections.some((s) => s.id === prev) || allSections.some((s) => s.id === prev))
          ) {
            return prev;
          }
          const def =
            typeof mineJson.defaultSectionId === "string" ? mineJson.defaultSectionId.trim() : "";
          if (def) return def;
          return mineSections[0]?.id ?? "";
        });
      } finally {
        if (!cancelled) setSectionsLoading(false);
      }
    })().catch(() => {
      if (cancelled) return;
      setOrgChartSectionOptions([]);
      setRequestorSectionOptions([]);
    });
    return () => {
      cancelled = true;
    };
  }, [isStaffRequestorIntake, sessionStatus]);

  const sendToMajorDepartments = useMemo(
    () => orgChartMajorDepartments(orgChartSectionOptions),
    [orgChartSectionOptions],
  );
  const sendToSubDepartments = useMemo(
    () =>
      orgChartSubDepartments(orgChartSectionOptions, selectedSendToMajorDepartmentId),
    [orgChartSectionOptions, selectedSendToMajorDepartmentId],
  );
  const recommendedSendToName = useMemo(
    () => recommendedSendToDepartmentName(activeRequestType),
    [activeRequestType],
  );

  useEffect(() => {
    if (!isStaffRequestorIntake || orgChartSectionOptions.length === 0) return;
    if (sendToMode !== "department") return;
    const recommendedName = recommendedSendToDepartmentName(activeRequestType);
    if (!recommendedName) {
      setSelectedSendToMajorDepartmentId("");
      setSelectedSendToSubDepartmentId("");
      return;
    }
    const match = findOrgChartSectionByName(orgChartSectionOptions, recommendedName);
    if (!match) {
      setSelectedSendToMajorDepartmentId("");
      setSelectedSendToSubDepartmentId("");
      return;
    }
    const selection = resolveSendToDepartmentSelection(orgChartSectionOptions, match.id);
    setSelectedSendToMajorDepartmentId(selection.majorId);
    setSelectedSendToSubDepartmentId(selection.subId);
  }, [isStaffRequestorIntake, activeRequestType, orgChartSectionOptions, sendToMode]);

  const effectiveSendToCompanyTeamId = useMemo(() => {
    if (sendToMode === "company") return selectedSendToCompanyTeamId.trim();
    return "";
  }, [sendToMode, selectedSendToCompanyTeamId]);

  useEffect(() => {
    if (!isPaymentRequest) {
      setUseCustomRequestingCompany(false);
      setSelectedRequestingCompanyTeamId("");
    }
  }, [isPaymentRequest]);

  const bookkeeperCompanyTeamId = useMemo(() => {
    if (useCustomRequestingCompany) return selectedRequestingCompanyTeamId.trim();
    return staffDesignatedCompany?.id?.trim() ?? "";
  }, [useCustomRequestingCompany, selectedRequestingCompanyTeamId, staffDesignatedCompany?.id]);

  useEffect(() => {
    if (!canSetIntakeAssignees) {
      setApprovalAgents([]);
      return;
    }
    let cancelled = false;

    async function loadAnyCompanyAgents() {
      const res = await fetch("/api/agents?anyCompany=1", { cache: "no-store" });
      if (!res.ok) return [] as Array<{ id: string; name: string; email: string }>;
      const rows = (await res.json()) as Array<{ id: string; name: string; email: string }>;
      return Array.isArray(rows) ? rows : [];
    }

    void (async () => {
      // Approval seats are never roster-locked at intake — pick from any company.
      // Recommendations still use org-chart / position logic; only Recommending Approval
      // (FTR) and Recommended By (ACA) are auto-filled from positions when left empty.
      const rows = await loadAnyCompanyAgents();
      if (cancelled) return;
      setApprovalAgents(rows);
    })().catch(() => {
      if (cancelled) return;
      setApprovalAgents([]);
    });

    return () => {
      cancelled = true;
    };
  }, [canSetIntakeAssignees]);
  /** Issue/Concern only — other request types stay creatable. */
  const issueConcernLocked =
    isRequestorIntakeLockRole && intakeGateReady && !intake.canCreateIssueConcern;
  const issueConcernSubmitLocked =
    isIssueConcernTicket(activeRequestType) &&
    isRequestorIntakeLockRole &&
    (!intakeGateReady || !intake.canCreateIssueConcern);
  const myTicketsHref = isCustomer ? "/my-tickets" : "/agent?pane=mine";

  useEffect(() => {
    if (!issueConcernLocked) return;
    if (!isIssueConcernTicket(activeRequestType)) return;
    setError(
      intake.message ??
        issueConcernIntakeLockMessage(intake.pendingConfirmation?.ticketNumber),
    );
    if (mode === "modal") onControlledTypeChange?.(null);
    else router.replace("/tickets/new");
  }, [
    issueConcernLocked,
    activeRequestType,
    intake.message,
    intake.pendingConfirmation?.ticketNumber,
    router,
    mode,
    onControlledTypeChange,
  ]);

  const portalCustomer = (session?.user ?? {}) as {
    companyName?: string | null;
    customerOrgRole?: string | null;
    companyId?: string | null;
  };
  const googleOAuthCustomer =
    Boolean(isCustomer) &&
    typeof session?.user?.authProvider === "string" &&
    session.user.authProvider.trim().toLowerCase() === "google";

  function goToRequestType(id: RequestTypeId) {
    if (isRequestTypeHiddenFromIntake(id, hiddenRequestTypeIds)) {
      setError("That request type is not available.");
      return;
    }
    if (isIssueConcernTicket(id) && issueConcernLocked) {
      setError(
        intake.message ??
          issueConcernIntakeLockMessage(intake.pendingConfirmation?.ticketNumber),
      );
      return;
    }
    setError(null);
    setModeOfPayment("");
    setDeliveryOfCheck("");
    setLetAccountingHandlePaymentMode(false);
    setSkipPaymentNotedBy(false);
    setSkipPaymentApprovedBy(false);
    setSkipJobOrderNotedBy(false);
    setSkipJobOrderApprovedBy(false);
    setSelectedRequestorOrgChartSectionId("");
    setSelectedSendToMajorDepartmentId("");
    setSelectedSendToSubDepartmentId("");
    setUseCustomRequestingCompany(false);
    setSelectedRequestingCompanyTeamId("");
    setRequisitionItems([emptyRequisitionLineItem(0)]);
    setPurposeOfRequest("");
    setScreenshots([]);
    setPaymentAssignees({
      notedByAgentId: "",
      approvedByAgentId: "",
      accountingAgentId: "",
      financeAgentId: "",
    });
    setFundTransferAssignees({ recommendingApprovalAgentId: "", approvedByAgentId: "" });
    setJobOrderAssignees({ notedByAgentId: "", approvedByAgentId: "", approvedBy2AgentId: "" });
    setItemRequisitionAssignees({ approvedByAgentId: "" });
    if (mode === "modal") {
      onControlledTypeChange?.(id);
      return;
    }
    router.push(`/tickets/new?type=${encodeURIComponent(id)}`);
  }

  function goToTypeSelection() {
    setError(null);
    if (mode === "modal") {
      onControlledTypeChange?.(null);
      return;
    }
    router.push("/tickets/new");
  }

  async function redirectAfterCreate() {
    if (mode === "modal") {
      onCreated?.();
      onClose?.();
      return;
    }
    const role = session?.user?.role;
    if (role === "Customer") {
      router.push("/my-tickets?submitted=1");
    } else if (isTicketRequestorRole(role)) {
      router.push("/agent?pane=mine&submitted=1");
    } else {
      router.push("/");
    }
  }

  /** Send-to roster: Admin/SuperAdmin see full company list; Personnel use public roster. */
  const sendRequestToOptions = useMemo(() => {
    if (!isStaffRequestorIntake) return [];
    const teams = [...companyTeams];
    if (
      isAdminStaffIntake &&
      staffDesignatedCompany &&
      !teams.some((t) => t.id === staffDesignatedCompany.id)
    ) {
      return [{ id: staffDesignatedCompany.id, name: staffDesignatedCompany.name }, ...teams];
    }
    return teams;
  }, [isStaffRequestorIntake, isAdminStaffIntake, companyTeams, staffDesignatedCompany]);

  const mergeScreenshotFiles = useCallback((picked: File[]) => {
    setScreenshots((prev) => {
      const next = [...prev];
      for (const f of picked) {
        const dup = next.some(
          (p) => p.name === f.name && p.size === f.size && p.lastModified === f.lastModified,
        );
        if (!dup) next.push(f);
      }
      return next.slice(0, MAX_SCREENSHOT_COUNT);
    });
  }, []);

  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items;
      if (!items?.length) return;
      const files: File[] = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind !== "file") continue;
        const f = item.getAsFile();
        if (f) files.push(f);
      }
      const images = pickImageFiles(files);
      if (images.length === 0) return;
      e.preventDefault();
      mergeScreenshotFiles(images);
    }
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [mergeScreenshotFiles]);

  function renderOptionalFieldAttachments(inputId: string) {
    return (
      <div className="mt-2 space-y-2">
        {/*
          Do not use Tailwind `sr-only` (clip-path) on file inputs — Chromium/Windows
          paints a large dark focus block when the native picker opens. Keep the input
          off-layout and open it via button.click() from a user gesture instead.
        */}
        <input
          ref={attachmentInputRef}
          id={inputId}
          type="file"
          accept={INTAKE_ATTACHMENT_ACCEPT}
          multiple
          onChange={(e) => {
            mergeScreenshotFiles(pickAttachmentFiles(Array.from(e.target.files ?? [])));
            e.target.value = "";
          }}
          className="pointer-events-none absolute h-0 w-0 overflow-hidden opacity-0"
          tabIndex={-1}
          aria-hidden
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => attachmentInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-zinc-800 shadow-sm transition hover:border-orange-500/60 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            <Paperclip className="size-3.5 shrink-0" aria-hidden />
            {screenshots.length === 0 ? "Attach documents / images" : "Add more attachments"}
          </button>
          {screenshots.length > 0 ? (
            <button
              type="button"
              onClick={() => setScreenshots([])}
              className="rounded-md border border-zinc-300 bg-transparent px-2.5 py-1.5 text-xs font-semibold text-zinc-600 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-400 dark:hover:bg-zinc-800"
            >
              Remove all
            </button>
          ) : null}
          <span className="text-[11px] text-zinc-500 dark:text-zinc-500">
            Optional · up to {MAX_SCREENSHOT_COUNT} files, 5MB each · PDF, Word, Excel, images
            {screenshots.length > 0 ? ` · ${screenshots.length} attached` : ""}
          </span>
        </div>
        {screenshotPreviews.length > 0 ? (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {screenshotPreviews.map((s, index) => {
              const file = screenshots[index];
              const isImage = file ? pickImageFiles([file]).length > 0 : false;
              return (
                <div
                  key={s.key}
                  className="rounded-lg border border-zinc-200 bg-white p-2 dark:border-zinc-700 dark:bg-zinc-900"
                >
                  <div className="relative flex h-16 w-full items-center justify-center overflow-hidden rounded bg-zinc-100 dark:bg-zinc-950">
                    {isImage && s.url ? (
                      <Image
                        src={s.url}
                        alt={s.name}
                        fill
                        className="object-cover"
                        sizes="(max-width: 640px) 100vw, 33vw"
                        unoptimized
                      />
                    ) : (
                      <span className="flex flex-col items-center gap-1 text-orange-500 dark:text-orange-400">
                        <FileText className="size-7" strokeWidth={1.5} aria-hidden />
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                          File
                        </span>
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex items-start justify-between gap-2">
                    <p className="min-w-0 truncate text-[11px] text-zinc-400">{s.name}</p>
                    <button
                      type="button"
                      onClick={() => setScreenshots((prev) => prev.filter((_, i) => i !== index))}
                      className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold text-orange-700 hover:underline dark:text-orange-400"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    );
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (issueConcernSubmitLocked) {
      if (issueConcernLocked) {
        setError(
          intake.message ??
            issueConcernIntakeLockMessage(intake.pendingConfirmation?.ticketNumber),
        );
      } else {
        setError("Checking whether you can open a new Issue/Concern ticket… try again in a moment.");
      }
      return;
    }
    if (screenshots.length > MAX_SCREENSHOT_COUNT) {
      setError(`You can attach at most ${MAX_SCREENSHOT_COUNT} files.`);
      return;
    }
    for (const f of screenshots) {
      if (f.size > MAX_SCREENSHOT_BYTES) {
        setError("Each attachment must be at most 5MB.");
        return;
      }
      if (pickAttachmentFiles([f]).length === 0) {
        setError("Attachments must be images or documents (PDF, Word, Excel, CSV, TXT).");
        return;
      }
    }

    setLoading(true);
    try {
      const form = new FormData(e.currentTarget);
      const issue = String(form.get("issue") || "");
      const payee = String(form.get("payee") || "").trim();
      const inPaymentOf = String(form.get("inPaymentOf") || "").trim();
      const accountTitle = String(form.get("accountTitle") || "").trim();
      const amount = String(form.get("amount") || "").trim();
      const modeOfPaymentValue = String(form.get("modeOfPayment") || "").trim();
      const deliveryOfCheckValue = String(form.get("deliveryOfCheck") || "").trim();
      const bankNameAccountNumber = String(form.get("bankNameAccountNumber") || "").trim();
      const fundTransferAmount = String(form.get("fundTransferAmount") || "").trim();
      const fromAccountName = String(form.get("fromAccountName") || "").trim();
      const fromAccountNumber = String(form.get("fromAccountNumber") || "").trim();
      const toAccountName = String(form.get("toAccountName") || "").trim();
      const toAccountNumber = String(form.get("toAccountNumber") || "").trim();
      const bankName = String(form.get("bankName") || "").trim();
      const bankAddress = String(form.get("bankAddress") || "").trim();

      if (isPaymentRequest) {
        if (!payee || !inPaymentOf || !amount) {
          setError("Payee, In payment of, and Amount are required.");
          setLoading(false);
          return;
        }
        if (!letAccountingHandlePaymentMode) {
          if (!modeOfPaymentValue) {
            setError("Mode of payment is required, or check Let Bookkeeper and Accounting handle it.");
            setLoading(false);
            return;
          }
          if (modeOfPaymentValue === MODE_OF_PAYMENT_CHECK && !deliveryOfCheckValue) {
            setError("Delivery of check is required when Mode of payment is Check.");
            setLoading(false);
            return;
          }
          if (
            paymentModeRequiresBankDetails(modeOfPaymentValue, deliveryOfCheckValue) &&
            !bankNameAccountNumber
          ) {
            setError(
              "Bank name / account number is required for Online direct to Payee's Bank Account #.",
            );
            setLoading(false);
            return;
          }
        }
      } else if (isRequisitionRequest) {
        const requisitionCheck = validateItemRequisitionFields({
          items: requisitionItems,
          purposeOfRequest,
        });
        if (!requisitionCheck.ok) {
          setError(requisitionCheck.error);
          setLoading(false);
          return;
        }
      } else if (isFundTransferRequest) {
        const fundCheck = validateFundTransferRequestFields({
          requestingDepartmentBusinessUnit: "",
          fundTransferAmount,
          fromAccountName,
          fromAccountNumber,
          toAccountName,
          toAccountNumber,
          bankName,
          bankAddress,
          reason: issue,
        });
        if (!fundCheck.ok) {
          setError(fundCheck.error);
          setLoading(false);
          return;
        }
      } else if (isJobOrderRequest) {
        const building = String(form.get("building") || "").trim();
        const jobCheck = validateJobOrderFields({
          natureOfConcern: jobOrderNatures,
          building,
          startDate: jobOrderStartDate,
          targetDate: jobOrderTargetDate,
          expectedDuration: jobOrderExpectedDuration,
          notes: issue,
        });
        if (!jobCheck.ok) {
          setError(jobCheck.error);
          setLoading(false);
          return;
        }
      } else if (isAcaRequest) {
        if (
          !acaCategory.trim() ||
          !acaNatureOfRequest.trim() ||
          !acaEstimatedCost.trim() ||
          !acaBudgetAmount.trim() ||
          !acaDescription.trim() ||
          !acaObjective.trim() ||
          !acaDateSubmitted.trim() ||
          !acaImplementationDate.trim()
        ) {
          setError("Complete all required ACA fields before submitting.");
          setLoading(false);
          return;
        }
        if (!acaResolution?.ok) {
          setError(acaResolution?.error || "Select a valid Nature of Request and Estimated Cost.");
          setLoading(false);
          return;
        }
        if (!acaResolution.requiresAca) {
          setError(
            acaResolution.guidance ||
              "ACA is not required for this amount. Do not submit this request type.",
          );
          setLoading(false);
          return;
        }
        if (!acaRecommendedByAgentId || !acaFinanceManagerAgentId) {
          setError("Assign Recommended By and Finance Manager before submitting.");
          setLoading(false);
          return;
        }
        if (
          acaApprovingAgentIds.length !== acaResolution.approvingSeatCount ||
          acaApprovingAgentIds.some((id) => !id.trim())
        ) {
          setError(
            `Assign all ${acaResolution.approvingSeatCount} approving seat(s) before submitting.`,
          );
          setLoading(false);
          return;
        }
        const roleIds = [
          acaRecommendedByAgentId,
          acaFinanceManagerAgentId,
          ...acaApprovingAgentIds,
        ];
        if (new Set(roleIds).size !== roleIds.length) {
          setError("Each ACA approval seat must be a different person.");
          setLoading(false);
          return;
        }
      } else if (!issue.trim()) {
        setError("Please describe the request.");
        setLoading(false);
        return;
      }

      if (isStaffRequestorIntake) {
        if (!selectedRequestorOrgChartSectionId.trim()) {
          setError("Requesting department is required.");
          setLoading(false);
          return;
        }
        if (sendToMode === "department" && !selectedSendToOrgChartSectionId.trim()) {
          setError("Send request to (department) is required.");
          setLoading(false);
          return;
        }
        if (sendToMode === "company" && !selectedSendToCompanyTeamId.trim()) {
          setError("Send request to (company) is required.");
          setLoading(false);
          return;
        }
      }

      if (canSetIntakeAssignees) {
        if (isPaymentRequest) {
          const { notedByAgentId, approvedByAgentId, accountingAgentId } = paymentAssignees;
          if (
            (!skipPaymentNotedBy && !notedByAgentId) ||
            (!skipPaymentApprovedBy && !approvedByAgentId) ||
            (!letAccountingHandlePaymentMode && !accountingAgentId)
          ) {
            setError(
              [
                skipPaymentNotedBy ? null : "Noted By",
                skipPaymentApprovedBy ? null : "Approved By",
                letAccountingHandlePaymentMode ? null : "Prepared by Bookkeeper",
              ]
                .filter(Boolean)
                .join(", ") + " are required.",
            );
            setLoading(false);
            return;
          }
          const roleIds = [
            ...(skipPaymentNotedBy ? [] : [notedByAgentId]),
            ...(skipPaymentApprovedBy ? [] : [approvedByAgentId]),
            ...(letAccountingHandlePaymentMode ? [] : [accountingAgentId]),
          ].filter(Boolean);
          if (new Set(roleIds).size !== roleIds.length) {
            setError("Each approval role must be a different person.");
            setLoading(false);
            return;
          }
        } else if (isFundTransferRequest) {
          if (
            !fundTransferAssignees.recommendingApprovalAgentId ||
            !fundTransferAssignees.approvedByAgentId
          ) {
            setError("Recommending Approval and Approved By are required.");
            setLoading(false);
            return;
          }
        } else if (isJobOrderRequest) {
          if (
            (!skipJobOrderNotedBy && !jobOrderAssignees.notedByAgentId) ||
            (!skipJobOrderApprovedBy && !jobOrderAssignees.approvedByAgentId) ||
            !jobOrderAssignees.approvedBy2AgentId
          ) {
            setError(
              [
                skipJobOrderNotedBy ? null : "Noted By",
                skipJobOrderApprovedBy ? null : "Approved By (Send-to)",
                "Approved By",
              ]
                .filter(Boolean)
                .join(", ") + " are required.",
            );
            setLoading(false);
            return;
          }
          const roleIds = [
            ...(skipJobOrderNotedBy ? [] : [jobOrderAssignees.notedByAgentId]),
            ...(skipJobOrderApprovedBy ? [] : [jobOrderAssignees.approvedByAgentId]),
            jobOrderAssignees.approvedBy2AgentId,
          ].filter(Boolean);
          if (new Set(roleIds).size !== roleIds.length) {
            setError("Each approval role must be a different person.");
            setLoading(false);
            return;
          }
        }
      }

      const appendPaymentFields = (target: FormData | Record<string, unknown>) => {
        if (!isPaymentRequest) return;
        if (target instanceof FormData) {
          target.append("payee", payee);
          target.append("inPaymentOf", inPaymentOf);
          target.append("accountTitle", accountTitle);
          target.append("amount", amount);
          target.append(
            "deferPaymentModeToAccounting",
            letAccountingHandlePaymentMode ? "true" : "false",
          );
          target.append("skipPaymentNotedBy", skipPaymentNotedBy ? "true" : "false");
          target.append("skipPaymentApprovedBy", skipPaymentApprovedBy ? "true" : "false");
          if (!letAccountingHandlePaymentMode) {
            target.append("modeOfPayment", modeOfPaymentValue);
            if (deliveryOfCheckValue) target.append("deliveryOfCheck", deliveryOfCheckValue);
            if (bankNameAccountNumber) target.append("bankNameAccountNumber", bankNameAccountNumber);
          }
        } else {
          target.payee = payee;
          target.inPaymentOf = inPaymentOf;
          target.accountTitle = accountTitle;
          target.amount = amount;
          target.deferPaymentModeToAccounting = letAccountingHandlePaymentMode;
          target.skipPaymentNotedBy = skipPaymentNotedBy;
          target.skipPaymentApprovedBy = skipPaymentApprovedBy;
          if (!letAccountingHandlePaymentMode) {
            target.modeOfPayment = modeOfPaymentValue;
            if (deliveryOfCheckValue) target.deliveryOfCheck = deliveryOfCheckValue;
            if (bankNameAccountNumber) target.bankNameAccountNumber = bankNameAccountNumber;
          }
        }
      };

      const appendRequisitionFields = (target: FormData | Record<string, unknown>) => {
        if (!isRequisitionRequest) return;
        const itemsJson = JSON.stringify(requisitionItems);
        if (target instanceof FormData) {
          target.append("requisitionItems", itemsJson);
          target.append("purposeOfRequest", purposeOfRequest.trim());
          target.append("issue", purposeOfRequest.trim());
        } else {
          target.requisitionItems = requisitionItems;
          target.purposeOfRequest = purposeOfRequest.trim();
          target.issue = purposeOfRequest.trim();
        }
      };

      const appendFundTransferFields = (target: FormData | Record<string, unknown>) => {
        if (!isFundTransferRequest) return;
        if (target instanceof FormData) {
          target.append("fundTransferAmount", fundTransferAmount);
          target.append("fromAccountName", fromAccountName);
          target.append("fromAccountNumber", fromAccountNumber);
          target.append("toAccountName", toAccountName);
          target.append("toAccountNumber", toAccountNumber);
          target.append("bankName", bankName);
          target.append("bankAddress", bankAddress);
        } else {
          target.fundTransferAmount = fundTransferAmount;
          target.fromAccountName = fromAccountName;
          target.fromAccountNumber = fromAccountNumber;
          target.toAccountName = toAccountName;
          target.toAccountNumber = toAccountNumber;
          target.bankName = bankName;
          target.bankAddress = bankAddress;
        }
      };

      const appendJobOrderFields = (target: FormData | Record<string, unknown>) => {
        if (!isJobOrderRequest) return;
        const building = String(form.get("building") || "").trim();
        const naturesJson = JSON.stringify(jobOrderNatures);
        if (target instanceof FormData) {
          target.append("natureOfConcern", naturesJson);
          target.append("building", building);
          target.append("startDate", jobOrderStartDate);
          target.append("targetDate", jobOrderTargetDate);
          target.append("expectedDuration", jobOrderExpectedDuration.trim());
          target.append("skipJobOrderNotedBy", skipJobOrderNotedBy ? "true" : "false");
          target.append("skipJobOrderApprovedBy", skipJobOrderApprovedBy ? "true" : "false");
        } else {
          target.natureOfConcern = jobOrderNatures;
          target.building = building;
          target.startDate = jobOrderStartDate;
          target.targetDate = jobOrderTargetDate;
          target.expectedDuration = jobOrderExpectedDuration.trim();
          target.skipJobOrderNotedBy = skipJobOrderNotedBy;
          target.skipJobOrderApprovedBy = skipJobOrderApprovedBy;
        }
      };

      const appendRequestingCompanyField = (target: FormData | Record<string, unknown>) => {
        if (!isPaymentRequest || !useCustomRequestingCompany) return;
        const id = selectedRequestingCompanyTeamId.trim();
        if (!id) return;
        if (target instanceof FormData) {
          target.append("requestingCompanyTeamId", id);
        } else {
          target.requestingCompanyTeamId = id;
        }
      };

      const appendSectionFields = (target: FormData | Record<string, unknown>) => {
        if (!isStaffRequestorIntake) return;
        const requestorId = selectedRequestorOrgChartSectionId.trim();
        if (target instanceof FormData) {
          target.append("requestorOrgChartSectionId", requestorId);
          target.append("sendToMode", sendToMode);
          if (sendToMode === "department") {
            target.append("orgChartSectionId", selectedSendToOrgChartSectionId.trim());
          } else {
            target.append("sendToCompanyTeamId", selectedSendToCompanyTeamId.trim());
          }
        } else {
          target.requestorOrgChartSectionId = requestorId;
          target.sendToMode = sendToMode;
          if (sendToMode === "department") {
            target.orgChartSectionId = selectedSendToOrgChartSectionId.trim();
          } else {
            target.sendToCompanyTeamId = selectedSendToCompanyTeamId.trim();
          }
        }
      };

      const appendApprovalAssignees = (target: FormData | Record<string, unknown>) => {
        if (!canSetIntakeAssignees) return;
        const assignees = isPaymentRequest
          ? paymentAssignees
          : isJobOrderRequest
            ? jobOrderAssignees
            : isRequisitionRequest
              ? itemRequisitionAssignees
              : fundTransferAssignees;
        const cleaned = Object.fromEntries(
          Object.entries(assignees).filter(([key, v]) => {
            if (typeof v !== "string" || !v.trim()) return false;
            if (isPaymentRequest) {
              if (key === "financeAgentId") return false;
              if (key === "accountingAgentId" && letAccountingHandlePaymentMode) return false;
            }
            return true;
          }),
        );
        if (isPaymentRequest) {
          if (skipPaymentNotedBy) delete cleaned.notedByAgentId;
          if (skipPaymentApprovedBy) delete cleaned.approvedByAgentId;
        }
        if (isJobOrderRequest) {
          if (skipJobOrderNotedBy) delete cleaned.notedByAgentId;
          if (skipJobOrderApprovedBy) delete cleaned.approvedByAgentId;
        }
        if (Object.keys(cleaned).length === 0) return;
        if (target instanceof FormData) {
          target.append("approvalAssignees", JSON.stringify(cleaned));
        } else {
          target.approvalAssignees = cleaned;
        }
      };

      const appendAcaFields = (target: FormData | Record<string, unknown>) => {
        if (!isAcaRequest) return;
        const submittedByName =
          String(form.get("contactName") || "").trim() ||
          session?.user?.name?.trim() ||
          "";
        const approvingJson = JSON.stringify(acaApprovingAgentIds);
        if (target instanceof FormData) {
          target.append("acaCategory", acaCategory.trim());
          target.append("acaNatureOfRequest", acaNatureOfRequest.trim());
          target.append("acaEstimatedCost", acaEstimatedCost.trim());
          target.append("acaBudgetAmount", acaBudgetAmount.trim());
          target.append("acaDescription", acaDescription.trim());
          target.append("acaObjective", acaObjective.trim());
          target.append("acaDateSubmitted", acaDateSubmitted.trim());
          target.append("acaImplementationDate", acaImplementationDate.trim());
          target.append("acaSubmittedByName", submittedByName);
          if (acaRelatedTicketIds.trim()) {
            target.append("acaRelatedTicketIds", acaRelatedTicketIds.trim());
          }
          target.append("acaRecommendedByAgentId", acaRecommendedByAgentId);
          target.append("acaFinanceManagerAgentId", acaFinanceManagerAgentId);
          target.append("acaApprovingAgentIds", approvingJson);
          target.append("issue", acaDescription.trim());
        } else {
          target.acaCategory = acaCategory.trim();
          target.acaNatureOfRequest = acaNatureOfRequest.trim();
          target.acaEstimatedCost = acaEstimatedCost.trim();
          target.acaBudgetAmount = acaBudgetAmount.trim();
          target.acaDescription = acaDescription.trim();
          target.acaObjective = acaObjective.trim();
          target.acaDateSubmitted = acaDateSubmitted.trim();
          target.acaImplementationDate = acaImplementationDate.trim();
          target.acaSubmittedByName = submittedByName;
          if (acaRelatedTicketIds.trim()) {
            target.acaRelatedTicketIds = acaRelatedTicketIds.trim();
          }
          target.acaRecommendedByAgentId = acaRecommendedByAgentId;
          target.acaFinanceManagerAgentId = acaFinanceManagerAgentId;
          target.acaApprovingAgentIds = acaApprovingAgentIds;
          target.issue = acaDescription.trim();
        }
      };

      let res: Response;
      if (screenshots.length > 0) {
        const fd = new FormData();
        if (!isRequisitionRequest && !isAcaRequest) {
          fd.append("issue", issue);
        }
        fd.append("requestType", activeRequestType ?? DEFAULT_REQUEST_TYPE);
        fd.append("priority", priority);
        appendPaymentFields(fd);
        appendRequisitionFields(fd);
        appendFundTransferFields(fd);
        appendJobOrderFields(fd);
        appendSectionFields(fd);
        appendRequestingCompanyField(fd);
        appendApprovalAssignees(fd);
        appendAcaFields(fd);
        if (isCustomer) {
          fd.append("requestToCompanySbu", String(form.get("requestToCompanySbu") || "").trim());
          fd.append("branch", String(form.get("branch") || "").trim());
          fd.append("assignedCompanyText", String(form.get("assignedCompanyText") || "").trim());
          if (googleOAuthCustomer) {
            fd.append("customerOrgRole", String(form.get("customerOrgRole") || "").trim() || "Personnel");
          }
        } else if (isStaffRequestorIntake) {
          fd.append("contactName", String(form.get("contactName") || "").trim());
          fd.append("contactEmail", String(form.get("contactEmail") || "").trim());
          fd.append("branch", String(form.get("branch") || "").trim());
        } else {
          fd.append("companyTeamId", String(form.get("companyTeamId") || ""));
          fd.append("contactName", String(form.get("contactName") || "").trim());
          fd.append("contactEmail", String(form.get("contactEmail") || "").trim());
        }
        for (const f of screenshots) {
          fd.append("screenshots", f);
        }
        res = await fetch("/api/tickets", {
          method: "POST",
          body: fd,
        });
      } else {
        const payload: Record<string, unknown> = {
          issue: isAcaRequest ? acaDescription.trim() : issue,
          requestType: activeRequestType ?? DEFAULT_REQUEST_TYPE,
          priority,
        };
        appendPaymentFields(payload);
        appendRequisitionFields(payload);
        appendFundTransferFields(payload);
        appendJobOrderFields(payload);
        appendSectionFields(payload);
        appendRequestingCompanyField(payload);
        appendApprovalAssignees(payload);
        appendAcaFields(payload);
        if (isCustomer) {
          payload.requestToCompanySbu = String(form.get("requestToCompanySbu") || "").trim();
          payload.branch = String(form.get("branch") || "").trim();
          payload.assignedCompanyText = String(form.get("assignedCompanyText") || "").trim();
          if (googleOAuthCustomer) {
            payload.customerOrgRole = String(form.get("customerOrgRole") || "").trim() || "Personnel";
          }
        } else if (isStaffRequestorIntake) {
          payload.contactName = String(form.get("contactName") || "").trim();
          payload.contactEmail = String(form.get("contactEmail") || "").trim();
          payload.branch = String(form.get("branch") || "").trim();
        } else {
          payload.companyTeamId = String(form.get("companyTeamId") || "");
          payload.contactName = String(form.get("contactName") || "").trim();
          payload.contactEmail = String(form.get("contactEmail") || "").trim();
        }
        res = await fetch("/api/tickets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(
          res.status === 409 && typeof data.error === "string"
            ? data.error
            : data.error ?? "Could not create ticket.",
        );
        return;
      }
      await res.json();
      await redirectAfterCreate();
    } catch {
      setError("Could not create ticket.");
    } finally {
      setLoading(false);
    }
  }

  const intakeBody = (
      <>
        {mode === "page" ? (
          <div className="mb-4 rounded-md border border-zinc-200 bg-white p-4 shadow-[0_14px_28px_rgba(0,0,0,0.06)] dark:border-zinc-700/80 dark:bg-[#10100f] dark:shadow-[0_14px_28px_rgba(0,0,0,0.24)]">
            <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-orange-400">
              {BRAND_TITLE} · Request intake
            </p>
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-zinc-950 dark:text-zinc-100">
              {showTypeSelection ? "Choose request type" : "Submit a request"}
            </h1>
            {!showTypeSelection && activeRequestType ? (
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                Type:{" "}
                <span className="font-semibold text-zinc-900 dark:text-zinc-200">
                  {requestTypeLabel(activeRequestType)}
                </span>
                {" · "}
                <button
                  type="button"
                  onClick={goToTypeSelection}
                  className="font-semibold text-orange-700 underline-offset-2 hover:underline dark:text-orange-300"
                >
                  Change type
                </button>
              </p>
            ) : null}
          </div>
        ) : showTypeSelection ? null : (
          <div className="mb-3 pr-8">
            <h2 className="text-left text-lg font-bold text-zinc-950 dark:text-zinc-100">
              Submit a request
            </h2>
            {activeRequestType ? (
              <p className="mt-1 text-left text-sm text-zinc-600 dark:text-zinc-400">
                {requestTypeLabel(activeRequestType)}
              </p>
            ) : null}
          </div>
        )}

        {isRequestorIntakeLockRole && !intakeGateReady ? (
          <div className="mb-4 rounded-md border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-700 dark:border-zinc-700/80 dark:bg-[#10100f] dark:text-zinc-300">
            Checking whether you already have an Issue/Concern ticket in progress…
          </div>
        ) : null}

        {issueConcernLocked && intake.pendingConfirmation ? (
          <div className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-950 dark:text-amber-100">
            <p className="font-semibold">
              Issue/Concern locked — ticket {intake.pendingConfirmation.ticketNumber}
            </p>
            <p className="mt-1 text-xs text-amber-900/90 dark:text-amber-200/90">
              {intake.message ??
                issueConcernIntakeLockMessage(intake.pendingConfirmation.ticketNumber)}
            </p>
            <Link
              href={intake.pendingConfirmation.verificationHref}
              className="mt-3 inline-flex text-sm font-semibold text-orange-700 underline-offset-4 hover:underline dark:text-orange-300"
            >
              {intake.pendingConfirmation.verificationHref.includes("/verification")
                ? "Go to confirmation"
                : "Open ticket"}
            </Link>
          </div>
        ) : issueConcernLocked ? (
          <div className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-950 dark:text-amber-100">
            <p className="font-semibold">Issue/Concern tickets are temporarily locked</p>
            <p className="mt-1 text-xs text-amber-900/90 dark:text-amber-200/90">
              {intake.message ?? issueConcernIntakeLockMessage()}
            </p>
            <Link
              href={myTicketsHref}
              className="mt-3 inline-flex text-sm font-semibold text-orange-700 underline-offset-4 hover:underline dark:text-orange-300"
            >
              {isPersonnelIntake ? "Open my ticket dashboard" : "Open my tickets"}
            </Link>
          </div>
        ) : null}

        <Card
          className={cn(
            "rounded-md border-zinc-200 bg-white p-4 shadow-[0_14px_28px_rgba(0,0,0,0.06)] dark:border-zinc-700/80 dark:bg-[#10100f] dark:shadow-[0_14px_28px_rgba(0,0,0,0.24)] sm:p-5",
            mode === "modal" &&
              "border-0 bg-transparent p-0 shadow-none dark:border-0 dark:bg-transparent dark:shadow-none",
          )}
        >
          {showTypeSelection ? (
            <RequestTypeSelection
              value={draftRequestType}
              onChange={setDraftRequestType}
              onContinue={goToRequestType}
              disabled={!intakeGateReady && isRequestorIntakeLockRole}
              hiddenTypeIds={hiddenRequestTypeIds}
              disabledTypeIds={issueConcernLocked ? (["ISSUE_CONCERN_TICKET"] as const) : []}
              disabledTypeHint={
                issueConcernLocked
                  ? (intake.message ?? issueConcernIntakeLockMessage(intake.pendingConfirmation?.ticketNumber))
                  : null
              }
            />
          ) : showRequestForm && activeRequestType ? (
          <form onSubmit={onSubmit} className="space-y-4">
            <input type="hidden" name="requestType" value={activeRequestType ?? DEFAULT_REQUEST_TYPE} />
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-zinc-50/80 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950/40">
              <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                Step 2 · {requestTypeLabel(activeRequestType)}
              </p>
              <button
                type="button"
                onClick={goToTypeSelection}
                className="text-xs font-semibold text-orange-700 hover:underline dark:text-orange-300"
              >
                Back to type selection
              </button>
            </div>

            {!isStaffRequestorIntake ? (
              <label className="block text-sm font-medium text-zinc-800 dark:text-zinc-200">
                Priority level{" "}
                <span className="font-normal text-zinc-500 dark:text-zinc-400">(optional)</span>
                <Select
                  name="priority"
                  value={priority}
                  onChange={(e) =>
                    setPriority(e.target.value as "LOW" | "MEDIUM" | "HIGH" | "URGENT")
                  }
                  className="mt-1.5 border-zinc-300 bg-white text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                >
                  <option value="LOW">Low</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="HIGH">High</option>
                  <option value="URGENT">Urgent</option>
                </Select>
                <span className="mt-1 block text-[11px] text-zinc-500 dark:text-zinc-400">
                  Defaults to Low if you leave it as-is.
                </span>
              </label>
            ) : null}
            {isStaffRequestorIntake ? (
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="block min-w-0 text-sm font-medium text-zinc-800 dark:text-zinc-200">
                    {isAcaRequest
                      ? "Submitted by:"
                      : isPaymentRequest
                        ? "REQUESTED BY:"
                        : isFundTransferRequest || isJobOrderRequest
                          ? "PREPARED BY:"
                          : "Requestor"}
                    <Input
                      name="contactName"
                      required
                      maxLength={200}
                      defaultValue={
                        session?.user?.name?.trim() ||
                        (session?.user?.email?.includes("@") ? session.user.email.split("@")[0] : "") ||
                        ""
                      }
                      autoComplete="name"
                      className="mt-1.5 border-zinc-300 bg-white text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                    />
                  </label>
                  <label className="block min-w-0 text-sm font-medium text-zinc-800 dark:text-zinc-200">
                    Email
                    <Input
                      type="email"
                      name="contactEmail"
                      required
                      defaultValue={session?.user?.email?.trim() ?? ""}
                      autoComplete="email"
                      className="mt-1.5 border-zinc-300 bg-white text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                    />
                  </label>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <label
                      htmlFor="intake-requestor-section"
                      className="flex h-5 items-center text-sm font-medium text-zinc-800 dark:text-zinc-200"
                    >
                      Requesting department
                    </label>
                    <select
                      id="intake-requestor-section"
                      name="requestorOrgChartSectionId"
                      required
                      value={selectedRequestorOrgChartSectionId}
                      onChange={(e) => setSelectedRequestorOrgChartSectionId(e.target.value)}
                      disabled={sectionsLoading}
                      className="box-border h-10 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm leading-none text-zinc-900 outline-none ring-orange-500/40 focus:border-orange-500 focus:ring disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                    >
                      <option value="">
                        {sectionsLoading ? "Loading departments…" : "Select requesting department"}
                      </option>
                      {requestorSectionOptions.map((section) => (
                        <option key={section.id} value={section.id}>
                          {orgChartSectionOptionText(section)}
                        </option>
                      ))}
                    </select>
                  </div>
                  {isPaymentRequest ? (
                    <div className="flex min-w-0 flex-col gap-1.5">
                      <label className="flex h-5 cursor-pointer select-none items-center gap-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">
                        <input
                          type="checkbox"
                          checked={useCustomRequestingCompany}
                          onChange={(event) => {
                            const checked = event.target.checked;
                            setUseCustomRequestingCompany(checked);
                            if (!checked) {
                              setSelectedRequestingCompanyTeamId("");
                              setPaymentAssignees((prev) => ({
                                ...prev,
                                accountingAgentId: "",
                              }));
                            }
                          }}
                          className="size-3.5 accent-orange-600"
                        />
                        Company
                      </label>
                      {useCustomRequestingCompany ? (
                        <select
                          id="intake-requesting-company"
                          name="requestingCompanyTeamId"
                          value={selectedRequestingCompanyTeamId}
                          onChange={(e) => setSelectedRequestingCompanyTeamId(e.target.value)}
                          disabled={companiesLoading}
                          className="box-border h-10 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm leading-none text-zinc-900 outline-none ring-orange-500/40 focus:border-orange-500 focus:ring disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                        >
                          <option value="">
                            {companiesLoading ? "Loading companies…" : "Select requesting company"}
                          </option>
                          {sendRequestToOptions.map((team) => (
                            <option key={team.id} value={team.id}>
                              {team.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <div className="box-border flex h-10 w-full items-center truncate rounded-lg border border-zinc-300 bg-zinc-50 px-3 text-sm leading-none text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/40 dark:text-zinc-400">
                          {staffDesignatedLoading
                            ? "Loading…"
                            : staffDesignatedCompany?.name?.trim()
                              ? staffDesignatedCompany.name
                              : "Not yet assigned"}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex min-w-0 flex-col gap-1.5">
                      <span className="flex h-5 items-center text-sm font-medium text-zinc-800 dark:text-zinc-200">
                        Company
                      </span>
                      <div className="box-border flex h-10 w-full items-center truncate rounded-lg border border-zinc-300 bg-zinc-50 px-3 text-sm leading-none text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900/40 dark:text-zinc-100">
                        {staffDesignatedLoading
                          ? "Loading…"
                          : staffDesignatedCompany?.name?.trim() || "Not yet assigned"}
                      </div>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <label
                      htmlFor="intake-branch"
                      className="flex h-5 items-center text-sm font-medium text-zinc-800 dark:text-zinc-200"
                    >
                      Branch{" "}
                      <span className="ml-1 font-normal text-zinc-500 dark:text-zinc-400">(optional)</span>
                    </label>
                    <input
                      id="intake-branch"
                      name="branch"
                      maxLength={120}
                      placeholder="e.g. Main Office, Cebu Branch"
                      className="box-border h-10 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm leading-none text-zinc-900 outline-none ring-orange-500/40 placeholder:text-zinc-500 focus:border-orange-500 focus:ring dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                    />
                  </div>
                  <label className="block min-w-0 text-sm font-medium text-zinc-800 dark:text-zinc-200">
                    Priority level{" "}
                    <span className="font-normal text-zinc-500 dark:text-zinc-400">(optional)</span>
                    <Select
                      name="priority"
                      value={priority}
                      onChange={(e) =>
                        setPriority(e.target.value as "LOW" | "MEDIUM" | "HIGH" | "URGENT")
                      }
                      className="mt-1.5 border-zinc-300 bg-white text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                    >
                      <option value="LOW">Low</option>
                      <option value="MEDIUM">Medium</option>
                      <option value="HIGH">High</option>
                      <option value="URGENT">Urgent</option>
                    </Select>
                    <span className="mt-1 block text-[11px] text-zinc-500 dark:text-zinc-400">
                      Defaults to Low if you leave it as-is.
                    </span>
                  </label>
                </div>

                <div className="flex min-w-0 flex-col gap-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                      Send request to
                    </span>
                    <div
                      role="tablist"
                      aria-label="Send request to company or department"
                      className="inline-flex rounded-lg border border-orange-300/80 bg-orange-100 p-0.5 text-xs font-semibold dark:border-orange-500/35 dark:bg-orange-950/40"
                    >
                      <button
                        type="button"
                        role="tab"
                        aria-selected={sendToMode === "company"}
                        onClick={() => {
                          setSendToMode("company");
                          setSelectedSendToMajorDepartmentId("");
                          setSelectedSendToSubDepartmentId("");
                        }}
                        className={
                          sendToMode === "company"
                            ? "rounded-md bg-orange-600 px-2.5 py-1 text-white"
                            : "rounded-md px-2.5 py-1 text-orange-950/80 hover:bg-orange-200/60 dark:text-orange-100/90 dark:hover:bg-orange-900/50"
                        }
                      >
                        Company
                      </button>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={sendToMode === "department"}
                        onClick={() => {
                          setSendToMode("department");
                        }}
                        className={
                          sendToMode === "department"
                            ? "rounded-md bg-orange-600 px-2.5 py-1 text-white"
                            : "rounded-md px-2.5 py-1 text-orange-950/80 hover:bg-orange-200/60 dark:text-orange-100/90 dark:hover:bg-orange-900/50"
                        }
                      >
                        Department
                      </button>
                    </div>
                  </div>
                  {sendToMode === "company" ? (
                    <select
                      id="intake-send-request-to-company"
                      required
                      value={selectedSendToCompanyTeamId}
                      onChange={(e) => setSelectedSendToCompanyTeamId(e.target.value)}
                      disabled={companiesLoading}
                      className="box-border h-10 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm leading-none text-zinc-900 outline-none ring-orange-500/40 focus:border-orange-500 focus:ring disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                    >
                      <option value="">
                        {companiesLoading ? "Loading companies…" : "Select a company"}
                      </option>
                      {sendRequestToOptions.map((team) => (
                        <option key={team.id} value={team.id}>
                          {team.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <select
                        id="intake-send-request-to-department"
                        required
                        value={selectedSendToMajorDepartmentId}
                        onChange={(e) => {
                          setSelectedSendToMajorDepartmentId(e.target.value);
                          setSelectedSendToSubDepartmentId("");
                        }}
                        disabled={sectionsLoading}
                        className="box-border h-10 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm leading-none text-zinc-900 outline-none ring-orange-500/40 focus:border-orange-500 focus:ring disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                      >
                        <option value="">
                          {sectionsLoading ? "Loading departments…" : "Select a department"}
                        </option>
                        {sendToMajorDepartments.map((section) => (
                          <option key={section.id} value={section.id}>
                            {section.name}
                          </option>
                        ))}
                      </select>
                      {sendToSubDepartments.length > 0 ? (
                        <select
                          id="intake-send-request-to-sub-department"
                          aria-label="Send request to sub-department"
                          value={selectedSendToSubDepartmentId}
                          onChange={(e) => setSelectedSendToSubDepartmentId(e.target.value)}
                          disabled={sectionsLoading || !selectedSendToMajorDepartmentId}
                          className="box-border h-10 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm leading-none text-zinc-900 outline-none ring-orange-500/40 focus:border-orange-500 focus:ring disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                        >
                          <option value="">Whole department (no sub-department)</option>
                          {sendToSubDepartments.map((section) => (
                            <option key={section.id} value={section.id}>
                              {orgChartSectionOptionText(section)}
                            </option>
                          ))}
                        </select>
                      ) : null}
                    </div>
                  )}
                  {sendToMode === "department" && recommendedSendToName ? (
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      Recommended for {requestTypeLabel(activeRequestType!)}:{" "}
                      <span className="font-medium text-orange-700 dark:text-orange-300">
                        {recommendedSendToName}
                      </span>
                      {findOrgChartSectionByName(orgChartSectionOptions, recommendedSendToName)
                        ? null
                        : " (not found in Manage departments yet)"}
                    </p>
                  ) : null}
                  {sendToMode === "department" ? (
                    <input
                      type="hidden"
                      name="orgChartSectionId"
                      value={selectedSendToOrgChartSectionId}
                    />
                  ) : null}
                </div>
              </>
            ) : (
              <>
                <div>
                  <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                    {isFundTransferRequest || isJobOrderRequest ? "Prepared By" : "Requestor"}
                  </span>
                  <div className="mt-1.5 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900/40 dark:text-zinc-100">
                    {session?.user?.name?.trim() ||
                      (session?.user?.email?.includes("@") ? session.user.email.split("@")[0] : null) ||
                      "—"}
                  </div>
                </div>
                <div>
                  <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">Email</span>
                  <div className="mt-1.5 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900/40 dark:text-zinc-100">
                    {session?.user?.email?.trim() || "—"}
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <label
                      htmlFor="intake-assigned-company"
                      className="flex h-5 items-center text-sm font-medium text-zinc-800 dark:text-zinc-200"
                    >
                      Assigned Company
                    </label>
                    <input
                      id="intake-assigned-company"
                      name="assignedCompanyText"
                      required
                      maxLength={500}
                      autoComplete="organization"
                      defaultValue={portalCustomer?.companyName?.trim() ?? ""}
                      placeholder="Type your company / SBU (e.g. AGC, ALI, MCHISI LPG)"
                      className="box-border h-10 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm leading-none text-zinc-900 outline-none ring-orange-500/40 placeholder:text-zinc-500 focus:border-orange-500 focus:ring dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                    />
                  </div>

                  <div className="flex min-w-0 flex-col gap-1.5">
                    <label
                      htmlFor="intake-customer-branch"
                      className="flex h-5 items-center text-sm font-medium text-zinc-800 dark:text-zinc-200"
                    >
                      Branch{" "}
                      <span className="ml-1 font-normal text-zinc-500 dark:text-zinc-400">
                        (optional — outside clients)
                      </span>
                    </label>
                    <input
                      id="intake-customer-branch"
                      name="branch"
                      maxLength={120}
                      placeholder="Optional"
                      className="box-border h-10 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm leading-none text-zinc-900 outline-none ring-orange-500/40 placeholder:text-zinc-500 focus:border-orange-500 focus:ring dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                    />
                  </div>
                </div>
                <p className="text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">
                  Use a roster SBU name when you can (e.g. AGC, ALI). If it does not match, your request still
                  registers and is triaged under <strong className="font-medium text-zinc-600 dark:text-zinc-300">OUTSIDE COMPANY</strong> on the company board. Your profile company is updated when you submit.
                </p>
                {googleOAuthCustomer ? (
                  <label className="block text-sm font-medium text-zinc-800 dark:text-zinc-200">
                    Your role in your organization
                    <Input
                      name="customerOrgRole"
                      maxLength={120}
                      autoComplete="organization-title"
                      placeholder="e.g. Operations lead, Analyst"
                      defaultValue={portalCustomer?.customerOrgRole?.trim() || "Personnel"}
                      className="mt-1.5 border-zinc-300 bg-white text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                    />
                  </label>
                ) : null}

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-1">
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <label
                      htmlFor="intake-customer-send-to"
                      className="flex h-5 items-center text-sm font-medium text-zinc-800 dark:text-zinc-200"
                    >
                      Send request to:
                    </label>
                    <textarea
                      id="intake-customer-send-to"
                      name="requestToCompanySbu"
                      required
                      rows={2}
                      placeholder="Type the company or SBU you are requesting (e.g. AGC, ALI, or IT support)."
                      className="box-border min-h-10 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none ring-orange-500/40 placeholder:text-zinc-500 focus:border-orange-500 focus:ring dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                    />
                  </div>
                </div>
              </>
            )}

            {isPaymentRequest ? (
              <div className="space-y-4 rounded-xl border border-zinc-200 bg-zinc-50/50 p-3 dark:border-zinc-700 dark:bg-zinc-950/30 sm:p-4">
                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Payment details</p>

                <label className="block text-sm font-medium text-zinc-800 dark:text-zinc-200">
                  Payee
                  <Input
                    name="payee"
                    required
                    maxLength={200}
                    placeholder="Name of payee"
                    className="mt-1.5 border-zinc-300 bg-white text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                  />
                </label>

                <label className="block text-sm font-medium text-zinc-800 dark:text-zinc-200">
                  In payment of:
                  <Textarea
                    name="inPaymentOf"
                    required
                    rows={3}
                    placeholder="Purpose or description of what this payment is for"
                    className="mt-1.5 border-zinc-300 bg-white text-zinc-900 placeholder:text-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                  />
                </label>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="block text-sm font-medium text-zinc-800 dark:text-zinc-200">
                    Account title{" "}
                    <span className="font-normal text-zinc-500 dark:text-zinc-400">(optional)</span>
                    <Input
                      name="accountTitle"
                      maxLength={200}
                      placeholder="Account / expense title"
                      className="mt-1.5 border-zinc-300 bg-white text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                    />
                  </label>
                  <label className="block text-sm font-medium text-zinc-800 dark:text-zinc-200">
                    Amount
                    <Input
                      name="amount"
                      required
                      maxLength={80}
                      placeholder="e.g. ₱1,500.00"
                      className="mt-1.5 border-zinc-300 bg-white text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                    />
                  </label>
                </div>

                <label className="flex items-start gap-2.5 rounded-lg border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-800 dark:border-zinc-700 dark:bg-zinc-950/50 dark:text-zinc-200">
                  <input
                    type="checkbox"
                    checked={letAccountingHandlePaymentMode}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setLetAccountingHandlePaymentMode(checked);
                      if (checked) {
                        setModeOfPayment("");
                        setDeliveryOfCheck("");
                        setPaymentAssignees((prev) => ({
                          ...prev,
                          accountingAgentId: "",
                        }));
                      }
                    }}
                    className="mt-0.5 size-4 shrink-0 rounded border-zinc-300 text-orange-600 focus:ring-orange-500"
                  />
                  <span>
                    <span className="font-medium">Let Bookkeeper and Accounting handle it</span>
                    <span className="mt-0.5 block text-xs font-normal text-zinc-500 dark:text-zinc-400">
                      Hides Mode of payment. After Noted By
                      {skipPaymentApprovedBy ? "" : " and Approved By"} are done, the bookkeeper sets mode of
                      payment on the ticket. Prepared by Bookkeeper and Approved By Accounting are
                      assigned on the ticket instead of at intake.
                    </span>
                  </span>
                </label>

                {!letAccountingHandlePaymentMode ? (
                  <>
                    <label className="block text-sm font-medium text-zinc-800 dark:text-zinc-200">
                      Mode of payment:
                      <Select
                        name="modeOfPayment"
                        required
                        value={modeOfPayment}
                        onChange={(e) => {
                          const next = e.target.value;
                          setModeOfPayment(next);
                          if (next !== MODE_OF_PAYMENT_CHECK) {
                            setDeliveryOfCheck("");
                          }
                        }}
                        className="mt-1.5 border-zinc-300 bg-white text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                      >
                        <option value="">Select mode of payment</option>
                        {MODE_OF_PAYMENT_OPTIONS.map((mode) => (
                          <option key={mode} value={mode}>
                            {mode}
                          </option>
                        ))}
                      </Select>
                    </label>

                    {modeOfPayment === MODE_OF_PAYMENT_CHECK ? (
                      <label className="block text-sm font-medium text-zinc-800 dark:text-zinc-200">
                        Delivery of check
                        <Select
                          name="deliveryOfCheck"
                          required
                          value={deliveryOfCheck}
                          onChange={(e) => setDeliveryOfCheck(e.target.value)}
                          className="mt-1.5 border-zinc-300 bg-white text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                        >
                          <option value="">Select delivery of check</option>
                          {DELIVERY_OF_CHECK_OPTIONS.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </Select>
                      </label>
                    ) : null}

                    {paymentModeShowsBankDetails(modeOfPayment, deliveryOfCheck) ? (
                      <label className="block text-sm font-medium text-zinc-800 dark:text-zinc-200">
                        Bank name / account number
                        {!paymentModeRequiresBankDetails(modeOfPayment, deliveryOfCheck) ? (
                          <span className="ml-1 text-xs font-normal text-zinc-500 dark:text-zinc-400">
                            (optional)
                          </span>
                        ) : null}
                        <Input
                          name="bankNameAccountNumber"
                          required={paymentModeRequiresBankDetails(modeOfPayment, deliveryOfCheck)}
                          maxLength={200}
                          placeholder="e.g. BDO · 0012-3456-7890"
                          className="mt-1.5 border-zinc-300 bg-white text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                        />
                      </label>
                    ) : null}
                  </>
                ) : (
                  <p className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:border-zinc-600 dark:bg-zinc-900/40 dark:text-zinc-400">
                    Mode of payment, delivery of check, and bank details will appear on the ticket
                    details for Accounting to complete.
                  </p>
                )}

                <div>
                  <label className="block text-sm font-medium text-zinc-800 dark:text-zinc-200">
                    Additional notes{" "}
                    <span className="font-normal text-zinc-500 dark:text-zinc-400">(optional)</span>
                    <Textarea
                      name="issue"
                      rows={3}
                      placeholder="Any other context for this payment request"
                      className="mt-1.5 border-zinc-300 bg-white text-zinc-900 placeholder:text-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                    />
                  </label>
                  {renderOptionalFieldAttachments("ticket-screenshots-payment")}
                </div>
              </div>
            ) : isRequisitionRequest ? (
              <div className="space-y-4 rounded-xl border border-zinc-200 bg-zinc-50/50 p-3 dark:border-zinc-700 dark:bg-zinc-950/30 sm:p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Requisition details</p>
                  <button
                    type="button"
                    onClick={() =>
                      setRequisitionItems((prev) => [...prev, emptyRequisitionLineItem(prev.length)])
                    }
                    className="inline-flex items-center gap-1.5 rounded-lg border border-orange-500/40 bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-500"
                  >
                    <Plus className="size-3.5" aria-hidden />
                    Add item
                  </button>
                </div>

                <div className="space-y-3">
                  {requisitionItems.map((item, index) => (
                    <div
                      key={`req-item-${index}`}
                      className="space-y-3 rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-950/50"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-bold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                          Line item {index + 1}
                        </p>
                        {requisitionItems.length > 1 ? (
                          <button
                            type="button"
                            onClick={() =>
                              setRequisitionItems((prev) => prev.filter((_, i) => i !== index))
                            }
                            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-950/40"
                            aria-label={`Remove line item ${index + 1}`}
                          >
                            <Trash2 className="size-3.5" aria-hidden />
                            Remove
                          </button>
                        ) : null}
                      </div>

                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                        <label className="block text-sm font-medium text-zinc-800 dark:text-zinc-200">
                          ITEM #
                          <Input
                            required
                            maxLength={80}
                            value={item.itemNumber}
                            onChange={(e) =>
                              setRequisitionItems((prev) =>
                                prev.map((row, i) =>
                                  i === index ? { ...row, itemNumber: e.target.value } : row,
                                ),
                              )
                            }
                            placeholder={String(index + 1)}
                            className="mt-1.5 border-zinc-300 bg-white text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                          />
                        </label>
                        <label className="block text-sm font-medium text-zinc-800 dark:text-zinc-200">
                          QUANTITY
                          <Input
                            type="number"
                            required
                            min={0}
                            step="any"
                            value={item.quantity}
                            onChange={(e) =>
                              setRequisitionItems((prev) =>
                                prev.map((row, i) =>
                                  i === index ? { ...row, quantity: e.target.value } : row,
                                ),
                              )
                            }
                            placeholder="e.g. 10"
                            className="mt-1.5 border-zinc-300 bg-white text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                          />
                        </label>
                        <label className="block text-sm font-medium text-zinc-800 dark:text-zinc-200">
                          UNIT
                          <Select
                            required
                            value={item.unit}
                            onChange={(e) =>
                              setRequisitionItems((prev) =>
                                prev.map((row, i) =>
                                  i === index ? { ...row, unit: e.target.value } : row,
                                ),
                              )
                            }
                            className="mt-1.5 border-zinc-300 bg-white text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                          >
                            {REQUISITION_UNIT_OPTIONS.map((unit) => (
                              <option key={unit} value={unit}>
                                {unit}
                              </option>
                            ))}
                          </Select>
                        </label>
                      </div>

                      <label className="block text-sm font-medium text-zinc-800 dark:text-zinc-200">
                        PARTICULAR / MATERIAL / SPECIFICATION
                        <Textarea
                          required
                          rows={2}
                          value={item.particular}
                          onChange={(e) =>
                            setRequisitionItems((prev) =>
                              prev.map((row, i) =>
                                i === index ? { ...row, particular: e.target.value } : row,
                              ),
                            )
                          }
                          placeholder="Describe the item, material, or specification"
                          className="mt-1.5 border-zinc-300 bg-white text-zinc-900 placeholder:text-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                        />
                      </label>
                    </div>
                  ))}
                </div>

                <div>
                  <label className="block text-sm font-medium text-zinc-800 dark:text-zinc-200">
                    PURPOSE OF REQUEST
                    <Textarea
                      required
                      rows={4}
                      value={purposeOfRequest}
                      onChange={(e) => setPurposeOfRequest(e.target.value)}
                      placeholder="Explain why these items are needed"
                      className="mt-1.5 border-zinc-300 bg-white text-zinc-900 placeholder:text-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                    />
                  </label>
                  {renderOptionalFieldAttachments("ticket-screenshots-requisition")}
                </div>
              </div>
            ) : isFundTransferRequest ? (
              <div className="space-y-4 rounded-xl border border-zinc-200 bg-zinc-50/50 p-3 dark:border-zinc-700 dark:bg-zinc-950/30 sm:p-4">
                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Fund transfer details
                </p>

                <label className="block text-sm font-medium text-zinc-800 dark:text-zinc-200">
                  Fund transfer amount
                  <Input
                    name="fundTransferAmount"
                    required
                    inputMode="decimal"
                    maxLength={80}
                    placeholder="e.g. 15000.00"
                    className="mt-1.5 border-zinc-300 bg-white text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                  />
                </label>

                <div className="space-y-3 rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-950/50">
                  <p className="text-xs font-bold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                    From
                  </p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="block text-sm font-medium text-zinc-800 dark:text-zinc-200">
                      Account name
                      <Input
                        name="fromAccountName"
                        required
                        maxLength={200}
                        placeholder="Source account name"
                        className="mt-1.5 border-zinc-300 bg-white text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                      />
                    </label>
                    <label className="block text-sm font-medium text-zinc-800 dark:text-zinc-200">
                      Account number
                      <Input
                        name="fromAccountNumber"
                        required
                        maxLength={80}
                        placeholder="Source account number"
                        className="mt-1.5 border-zinc-300 bg-white text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                      />
                    </label>
                  </div>
                </div>

                <div className="space-y-3 rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-950/50">
                  <p className="text-xs font-bold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                    To
                  </p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="block text-sm font-medium text-zinc-800 dark:text-zinc-200">
                      Account name
                      <Input
                        name="toAccountName"
                        required
                        maxLength={200}
                        placeholder="Destination account name"
                        className="mt-1.5 border-zinc-300 bg-white text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                      />
                    </label>
                    <label className="block text-sm font-medium text-zinc-800 dark:text-zinc-200">
                      Account number
                      <Input
                        name="toAccountNumber"
                        required
                        maxLength={80}
                        placeholder="Destination account number"
                        className="mt-1.5 border-zinc-300 bg-white text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                      />
                    </label>
                  </div>
                </div>

                <div className="space-y-3 rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-950/50">
                  <p className="text-xs font-bold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                    Bank detail
                  </p>
                  <label className="block text-sm font-medium text-zinc-800 dark:text-zinc-200">
                    Bank name
                    <Input
                      name="bankName"
                      required
                      maxLength={200}
                      placeholder="e.g. BDO, BPI, Metrobank"
                      className="mt-1.5 border-zinc-300 bg-white text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                    />
                  </label>
                  <label className="block text-sm font-medium text-zinc-800 dark:text-zinc-200">
                    Bank address
                    <Textarea
                      name="bankAddress"
                      required
                      rows={2}
                      placeholder="Bank branch / address"
                      className="mt-1.5 border-zinc-300 bg-white text-zinc-900 placeholder:text-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                    />
                  </label>
                </div>

                <div>
                  <label className="block text-sm font-medium text-zinc-800 dark:text-zinc-200">
                    Reason for the transfer / special instruction{" "}
                    <span className="font-normal text-zinc-500 dark:text-zinc-400">(optional)</span>
                    <Textarea
                      name="issue"
                      rows={4}
                      placeholder="Reason for transfer or any special instructions"
                      className="mt-1.5 border-zinc-300 bg-white text-zinc-900 placeholder:text-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                    />
                  </label>
                  {renderOptionalFieldAttachments("ticket-screenshots-fund-transfer")}
                </div>
              </div>
            ) : isJobOrderRequest ? (
              <div className="space-y-4 rounded-xl border border-zinc-200 bg-zinc-50/50 p-3 dark:border-zinc-700 dark:bg-zinc-950/30 sm:p-4">
                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Project / task information
                </p>

                <div>
                  <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                    Nature of Concern
                  </p>
                  <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                    Select all that apply.
                  </p>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="mt-1.5 flex w-full items-center justify-between gap-2 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-left text-sm text-zinc-900 shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-orange-500/30 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                      >
                        <span className="min-w-0 truncate">
                          {jobOrderNatures.length === 0
                            ? "Select nature of concern…"
                            : jobOrderNatures.join(", ")}
                        </span>
                        <ChevronDown
                          className="size-4 shrink-0 text-zinc-500 dark:text-zinc-400"
                          aria-hidden
                        />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="start"
                      className="w-[var(--radix-dropdown-menu-trigger-width)] max-h-72 overflow-y-auto"
                    >
                      {JOB_ORDER_NATURE_GROUPS.map((group, groupIndex) => (
                        <div key={group.category}>
                          {groupIndex > 0 ? <DropdownMenuSeparator /> : null}
                          <DropdownMenuLabel>{group.category}</DropdownMenuLabel>
                          {group.options.map((option) => {
                            const checked = jobOrderNatures.includes(option);
                            return (
                              <DropdownMenuCheckboxItem
                                key={option}
                                checked={checked}
                                onSelect={(e) => e.preventDefault()}
                                onCheckedChange={(next) => {
                                  setJobOrderNatures((prev) =>
                                    next
                                      ? prev.includes(option)
                                        ? prev
                                        : [...prev, option]
                                      : prev.filter((v) => v !== option),
                                  );
                                }}
                              >
                                {option}
                              </DropdownMenuCheckboxItem>
                            );
                          })}
                        </div>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <label className="block text-sm font-medium text-zinc-800 dark:text-zinc-200">
                  Building
                  <Input
                    name="building"
                    required
                    maxLength={200}
                    placeholder="Building / location"
                    className="mt-1.5 border-zinc-300 bg-white text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                  />
                </label>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="block text-sm font-medium text-zinc-800 dark:text-zinc-200">
                    Start Date
                    <DatePickerField
                      name="startDate"
                      required
                      value={jobOrderStartDate}
                      max={jobOrderTargetDate || undefined}
                      onChange={(e) => setJobOrderStartDate(e.target.value)}
                      wrapperClassName="mt-1.5"
                    />
                  </label>
                  <label className="block text-sm font-medium text-zinc-800 dark:text-zinc-200">
                    Target Date
                    <DatePickerField
                      name="targetDate"
                      required
                      value={jobOrderTargetDate}
                      min={jobOrderStartDate || undefined}
                      onChange={(e) => setJobOrderTargetDate(e.target.value)}
                      wrapperClassName="mt-1.5"
                    />
                  </label>
                </div>

                <label className="block text-sm font-medium text-zinc-800 dark:text-zinc-200">
                  Expected Duration
                  <Input
                    name="expectedDuration"
                    required
                    maxLength={80}
                    value={jobOrderExpectedDuration}
                    onChange={(e) => setJobOrderExpectedDuration(e.target.value)}
                    placeholder="Auto-filled from dates (editable)"
                    className="mt-1.5 border-zinc-300 bg-white text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                  />
                  <span className="mt-1 block text-xs font-normal text-zinc-500 dark:text-zinc-400">
                    Calculated from Start and Target dates; you can edit this value.
                  </span>
                </label>

                <div>
                  <label className="block text-sm font-medium text-zinc-800 dark:text-zinc-200">
                    Additional notes{" "}
                    <span className="font-normal text-zinc-500 dark:text-zinc-400">(optional)</span>
                    <Textarea
                      name="issue"
                      rows={3}
                      placeholder="Any extra context for this job order"
                      className="mt-1.5 border-zinc-300 bg-white text-zinc-900 placeholder:text-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                    />
                  </label>
                  {renderOptionalFieldAttachments("ticket-screenshots-job-order")}
                </div>
              </div>
            ) : isAcaRequest ? (
              <div className="space-y-3">
                {canShowAcaRecommendations ? (
                  <IntakeApprovalRecommendationGuide
                    requestType="AUTHORITY_TO_CONDUCT_ACTIVITY"
                    requestorSectionId={selectedRequestorOrgChartSectionId}
                    sendToSectionId={selectedSendToOrgChartSectionId}
                    acaRecommendingLevel={acaResolution?.recommendingLevel ?? undefined}
                    acaApprovingPath={acaResolution?.approvingPath ?? undefined}
                    acaApprovingSeatCount={acaResolution?.approvingSeatCount ?? 0}
                    onApply={(assignees) => {
                      if (assignees.recommendedByAgentId) {
                        setAcaRecommendedByAgentId(assignees.recommendedByAgentId);
                      }
                      if (assignees.financeManagerAgentId) {
                        setAcaFinanceManagerAgentId(assignees.financeManagerAgentId);
                      }
                      setAcaApprovingAgentIds((prev) => {
                        const next = [...prev];
                        for (let i = 0; i < next.length; i += 1) {
                          const key = `approvingAgentId${i}`;
                          if (assignees[key]) next[i] = assignees[key]!;
                        }
                        return next;
                      });
                    }}
                  />
                ) : null}
              <AcaIntakeFields
                companyName={staffDesignatedCompany?.name ?? ""}
                category={acaCategory}
                onCategoryChange={setAcaCategory}
                natureOfRequest={acaNatureOfRequest}
                onNatureOfRequestChange={setAcaNatureOfRequest}
                estimatedCost={acaEstimatedCost}
                onEstimatedCostChange={setAcaEstimatedCost}
                budgetAmount={acaBudgetAmount}
                onBudgetAmountChange={setAcaBudgetAmount}
                description={acaDescription}
                onDescriptionChange={setAcaDescription}
                objective={acaObjective}
                onObjectiveChange={setAcaObjective}
                dateSubmitted={acaDateSubmitted}
                onDateSubmittedChange={setAcaDateSubmitted}
                implementationDate={acaImplementationDate}
                onImplementationDateChange={setAcaImplementationDate}
                relatedTicketIds={acaRelatedTicketIds}
                onRelatedTicketIdsChange={setAcaRelatedTicketIds}
                resolution={acaResolution}
                recommendedByUsers={acaRecommendedByUsers}
                recommendedByLockedToRequestor={acaRaLockedToRequestor}
                requestorCompanyName={staffDesignatedCompany?.name ?? ""}
                companyUsers={acaAnyCompanyAgents}
                companyUsersLoading={acaApproversLoading}
                recommendedByAgentId={acaRecommendedByAgentId}
                onRecommendedByAgentIdChange={setAcaRecommendedByAgentId}
                financeManagerAgentId={acaFinanceManagerAgentId}
                onFinanceManagerAgentIdChange={setAcaFinanceManagerAgentId}
                approvingAgentIds={acaApprovingAgentIds}
                onApprovingAgentIdChange={(index, value) =>
                  setAcaApprovingAgentIds((prev) => {
                    const next = [...prev];
                    next[index] = value;
                    return next;
                  })
                }
                renderAttachments={renderOptionalFieldAttachments}
              />
              </div>
            ) : (
              <div>
                <label className="block text-sm font-medium text-zinc-800 dark:text-zinc-200">
                  {detailsField.label}
                  <Textarea
                    name="issue"
                    required
                    rows={5}
                    placeholder={detailsField.placeholder}
                    className="mt-1.5 border-zinc-300 bg-white text-zinc-900 placeholder:text-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                  />
                </label>
                {renderOptionalFieldAttachments("ticket-screenshots-issue")}
              </div>
            )}

            {canSetIntakeAssignees ? (
              <div className="space-y-3 rounded-xl border border-zinc-200 bg-zinc-50/50 p-3 dark:border-zinc-700 dark:bg-zinc-950/30 sm:p-4">
                <div>
                  <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    Set approvers
                  </p>
                  <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                    Assign procedural approvers before creating this request. Use recommendations for
                    suggested names, or search any company user for each seat. Item Requisition only
                    needs Approved By here — Canvassed By is set later on the Assignment Board.
                  </p>
                </div>
                <IntakeApprovalRecommendationGuide
                  requestType={activeRequestType!}
                  requestorSectionId={selectedRequestorOrgChartSectionId}
                  sendToSectionId={selectedSendToOrgChartSectionId}
                  requestingCompanyTeamId={
                    useCustomRequestingCompany ? selectedRequestingCompanyTeamId : ""
                  }
                  skipNotedBy={isPaymentRequest ? skipPaymentNotedBy : skipJobOrderNotedBy}
                  skipApprovedBy={
                    isPaymentRequest ? skipPaymentApprovedBy : skipJobOrderApprovedBy
                  }
                  deferBookkeeper={letAccountingHandlePaymentMode}
                  onApply={(assignees, people = []) => {
                    if (isPaymentRequest) {
                      if (people.length > 0) {
                        setApprovalAgents((prev) => mergeApprovalAgentOptions(prev, people));
                      }
                      setPaymentAssignees((prev) => ({ ...prev, ...assignees }));
                      return;
                    }
                    if (isFundTransferRequest) {
                      if (people.length > 0) {
                        setApprovalAgents((prev) => mergeApprovalAgentOptions(prev, people));
                      }
                      setFundTransferAssignees((prev) => ({ ...prev, ...assignees }));
                      return;
                    }
                    if (isJobOrderRequest) {
                      if (people.length > 0) {
                        setApprovalAgents((prev) => mergeApprovalAgentOptions(prev, people));
                      }
                      setJobOrderAssignees((prev) => ({ ...prev, ...assignees }));
                      return;
                    }
                    if (isRequisitionRequest) {
                      if (people.length > 0) {
                        setApprovalAgents((prev) => mergeApprovalAgentOptions(prev, people));
                      }
                      setItemRequisitionAssignees((prev) => ({ ...prev, ...assignees }));
                    }
                  }}
                />
                {isPaymentRequest ? (
                  <>
                    <div className="flex flex-wrap gap-2">
                      <label className="flex w-fit cursor-pointer select-none items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs font-medium text-zinc-700 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300">
                        <input
                          type="checkbox"
                          checked={skipPaymentNotedBy}
                          onChange={(event) => {
                            const checked = event.target.checked;
                            setSkipPaymentNotedBy(checked);
                            if (checked) {
                              setSkipPaymentApprovedBy(false);
                              setPaymentAssignees((prev) => ({
                                ...prev,
                                notedByAgentId: "",
                              }));
                            }
                          }}
                          className="size-3.5 accent-orange-600"
                        />
                        Skip Noted by:
                      </label>
                      <label className="flex w-fit cursor-pointer select-none items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs font-medium text-zinc-700 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300">
                        <input
                          type="checkbox"
                          checked={skipPaymentApprovedBy}
                          onChange={(event) => {
                            const checked = event.target.checked;
                            setSkipPaymentApprovedBy(checked);
                            if (checked) {
                              setSkipPaymentNotedBy(false);
                              setPaymentAssignees((prev) => ({
                                ...prev,
                                approvedByAgentId: "",
                              }));
                            }
                          }}
                          className="size-3.5 accent-orange-600"
                        />
                        Skip Approved By:
                      </label>
                    </div>
                    {(
                      [
                        ["notedByAgentId", "Noted By"],
                        ["approvedByAgentId", "Approved By"],
                        ...(letAccountingHandlePaymentMode
                          ? []
                          : ([["accountingAgentId", "Prepared by Bookkeeper"]] as const)),
                      ] as const
                    )
                      .filter(
                        ([key]) =>
                          !(skipPaymentNotedBy && key === "notedByAgentId") &&
                          !(skipPaymentApprovedBy && key === "approvedByAgentId"),
                      )
                      .map(([key, label]) => {
                      const taken = new Set(
                        (
                          [
                            paymentAssignees.notedByAgentId,
                            ...(skipPaymentApprovedBy ? [] : [paymentAssignees.approvedByAgentId]),
                            ...(letAccountingHandlePaymentMode
                              ? []
                              : [paymentAssignees.accountingAgentId]),
                          ] as string[]
                        ).filter((id) => id && id !== paymentAssignees[key]),
                      );
                      return (
                        <CompanyUserSearchField
                          key={key}
                          label={label}
                          required
                          users={approvalAgents}
                          value={paymentAssignees[key]}
                          excludedIds={taken}
                          placeholder="Search by name or email…"
                          onChange={(agentId) =>
                            setPaymentAssignees((prev) => ({ ...prev, [key]: agentId }))
                          }
                        />
                      );
                    })}
                  </>
                ) : null}
                {isFundTransferRequest
                  ? (
                      [
                        ["recommendingApprovalAgentId", "Recommending Approval"],
                        ["approvedByAgentId", "Approved By"],
                      ] as const
                    ).map(([key, label]) => {
                      const taken = new Set(
                        (
                          [
                            fundTransferAssignees.recommendingApprovalAgentId,
                            fundTransferAssignees.approvedByAgentId,
                          ] as string[]
                        ).filter((id) => id && id !== fundTransferAssignees[key]),
                      );
                      return (
                        <CompanyUserSearchField
                          key={key}
                          label={label}
                          required
                          users={approvalAgents}
                          value={fundTransferAssignees[key]}
                          excludedIds={taken}
                          placeholder="Search by name or email…"
                          onChange={(agentId) =>
                            setFundTransferAssignees((prev) => ({ ...prev, [key]: agentId }))
                          }
                        />
                      );
                    })
                  : null}
                {isJobOrderRequest ? (
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-wrap gap-2">
                      <label className="flex w-fit cursor-pointer select-none items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs font-medium text-zinc-700 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300">
                        <input
                          type="checkbox"
                          checked={skipJobOrderNotedBy}
                          onChange={(event) => {
                            const checked = event.target.checked;
                            setSkipJobOrderNotedBy(checked);
                            if (checked) {
                              setSkipJobOrderApprovedBy(false);
                              setJobOrderAssignees((prev) => ({
                                ...prev,
                                notedByAgentId: "",
                              }));
                            }
                          }}
                          className="size-3.5 accent-orange-600"
                        />
                        Skip Noted By:
                      </label>
                      <label className="flex w-fit cursor-pointer select-none items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs font-medium text-zinc-700 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300">
                        <input
                          type="checkbox"
                          checked={skipJobOrderApprovedBy}
                          onChange={(event) => {
                            const checked = event.target.checked;
                            setSkipJobOrderApprovedBy(checked);
                            if (checked) {
                              setSkipJobOrderNotedBy(false);
                              setJobOrderAssignees((prev) => ({
                                ...prev,
                                approvedByAgentId: "",
                              }));
                            }
                          }}
                          className="size-3.5 accent-orange-600"
                        />
                        Skip Approved By:
                      </label>
                    </div>
                    {(
                      [
                        ["notedByAgentId", "Noted By (Requestor head)"],
                        ["approvedByAgentId", "Approved By (Send-to head)"],
                        ["approvedBy2AgentId", "Approved By"],
                      ] as const
                    )
                      .filter(
                        ([key]) =>
                          !(skipJobOrderNotedBy && key === "notedByAgentId") &&
                          !(skipJobOrderApprovedBy && key === "approvedByAgentId"),
                      )
                      .map(([key, label]) => {
                      const taken = new Set(
                        (
                          [
                            ...(skipJobOrderNotedBy ? [] : [jobOrderAssignees.notedByAgentId]),
                            ...(skipJobOrderApprovedBy
                              ? []
                              : [jobOrderAssignees.approvedByAgentId]),
                            jobOrderAssignees.approvedBy2AgentId,
                          ] as string[]
                        ).filter((id) => id && id !== jobOrderAssignees[key]),
                      );
                      return (
                        <CompanyUserSearchField
                          key={key}
                          label={label}
                          required
                          users={approvalAgents}
                          value={jobOrderAssignees[key]}
                          excludedIds={taken}
                          placeholder="Search by name or email…"
                          emptyMessage="No matching users."
                          onChange={(agentId) =>
                            setJobOrderAssignees((prev) => ({ ...prev, [key]: agentId }))
                          }
                        />
                      );
                    })}
                  </div>
                ) : null}
                {isRequisitionRequest ? (
                  <CompanyUserSearchField
                    label="Approved By"
                    users={approvalAgents}
                    value={itemRequisitionAssignees.approvedByAgentId}
                    placeholder="Search by name or email… (optional — auto-filled if empty)"
                    onChange={(agentId) =>
                      setItemRequisitionAssignees({ approvedByAgentId: agentId })
                    }
                  />
                ) : null}
                {(isJobOrderRequest || isFundTransferRequest || isRequisitionRequest) &&
                approvalAgents.length === 0 ? (
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Loading assignees…
                  </p>
                ) : null}
                {!isPaymentRequest &&
                !isJobOrderRequest &&
                !isFundTransferRequest &&
                !isRequisitionRequest &&
                approvalAgents.length === 0 ? (
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Loading assignees…
                  </p>
                ) : null}
              </div>
            ) : null}

            {error ? (
              <p className="text-sm text-red-300" role="alert">
                {error}
              </p>
            ) : null}

            <Button
              type="submit"
              variant="accent"
              disabled={loading || issueConcernSubmitLocked}
              className="w-full rounded-full sm:w-auto sm:px-8"
            >
              {loading
                ? screenshots.length > 0
                  ? `Submitting… (uploading ${screenshots.length} file${screenshots.length === 1 ? "" : "s"})`
                  : "Submitting…"
                : issueConcernSubmitLocked
                  ? !intakeGateReady
                    ? "Checking open requests…"
                    : "Finish existing Issue/Concern first"
                  : "Create request"}
            </Button>
          </form>
          ) : null}
        </Card>
      </>
  );

  if (mode === "modal") {
    return <div className="space-y-1">{intakeBody}</div>;
  }

  return (
    <main className="min-h-[calc(100vh-56px)] bg-zinc-50 text-zinc-900 dark:bg-[#0e0e0d] dark:text-zinc-100">
      <div className="mx-auto max-w-5xl px-3 py-4 sm:px-4">{intakeBody}</div>
    </main>
  );
}
