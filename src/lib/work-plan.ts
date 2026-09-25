/**
 * Work Plan for Management Approval — replaces Field Assignment Travel Order create form.
 * Persisted on TravelOrder.workPlanMeta; approval chain follows org-chart layers
 * from the requestor up through Layer 2 (Layer 1 / top of the main org chart is excluded).
 */

import {
  buildApprovalLevelsFromOrgChartPath,
  type TravelOrderApprovalLevelDraft,
  type TravelOrderOrgChartPathSeat,
} from "@/lib/travel-order";

export const WORK_PLAN_FORMAT_VERSION = "work_plan_v1" as const;

/** Most senior org-chart layer included in Work Plan approvals (Layer 1 is excluded). */
export const WORK_PLAN_APPROVAL_TOP_ORG_LAYER = 2;

export const WORK_PLAN_BUDGET_TEMPLATES = [
  "Fuel",
  "Toll",
  "Meals",
  "Lodging",
  "Transportation",
  "Supplies",
  "Miscellaneous",
] as const;

export type WorkPlanSectionId =
  | "general"
  | "details"
  | "people"
  | "budget"
  | "justification"
  | "results"
  | "approval";

export const WORK_PLAN_WIZARD_STEPS: Array<{
  id: WorkPlanSectionId;
  label: string;
  title: string;
}> = [
  { id: "general", label: "General", title: "I. General Information" },
  { id: "details", label: "Details", title: "II. Travel Order Details" },
  { id: "people", label: "People", title: "III. Personnel Involved" },
  { id: "budget", label: "Budget", title: "IV. Budget" },
  { id: "justification", label: "Justification", title: "V. Justification" },
  { id: "results", label: "Results", title: "VI. Expected Results / Key Deliverables (optional)" },
  { id: "approval", label: "Approval", title: "VII. Management Approval" },
];

export const WORK_PLAN_SECTION_CHECKLIST: Array<{
  id: WorkPlanSectionId;
  label: string;
}> = WORK_PLAN_WIZARD_STEPS.map(({ id, label }) => ({ id, label }));

export function isWorkPlanSectionComplete(
  sectionId: WorkPlanSectionId,
  draft: WorkPlanDraft,
): boolean {
  const m = draft.workPlan;
  switch (sectionId) {
    case "general":
      return Boolean(
        m.departmentBusinessUnit.trim() &&
          m.requestingParty.trim() &&
          (m.personInChargeName?.trim() || m.personInChargeAgentId?.trim()) &&
          m.datePrepared.trim() &&
          m.budgetRequiredBy.trim(),
      );
    case "details":
      return Boolean(
        m.activityProposedWorkPlan.trim() &&
          m.purposeObjective.trim() &&
          m.implementationPeriod.trim() &&
          workPlanVenueLabels(m).length > 0,
      );
    case "people":
      return (
        m.personnel.some(
          (p) =>
            p.name.trim() && p.positionDepartment.trim() && p.responsibilityRole.trim(),
        ) &&
        (!m.driverPresent || m.personnel.some((p) => p.isDriver && p.name.trim()))
      );
    case "budget":
      return m.budgetLines.some(
        (l) => l.particulars.trim() && parseWorkPlanAmount(l.amount) != null,
      );
    case "justification":
      return Boolean(m.justification.trim());
    case "results":
      // Expected results / deliverables are optional — empty section is OK.
      // If a row is partially filled, both deliverable and target date are required.
      {
        const filled = m.expectedResults.filter(
          (r) => r.deliverable.trim() || r.targetDate.trim(),
        );
        if (filled.length === 0) return true;
        return filled.every((r) => r.deliverable.trim() && r.targetDate.trim());
      }
    case "approval":
      return (
        draft.approvalLevels.length > 0 &&
        draft.approvalLevels.every((l) => l.agentId.trim()) &&
        Boolean(draft.confirmationByAgentId.trim())
      );
    default:
      return false;
  }
}

/** @deprecated Legacy fixed seats — kept for reading older stored levels. */
export const WORK_PLAN_COO_ROLE = "COO" as const;
/** @deprecated Legacy fixed seats — kept for reading older stored levels. */
export const WORK_PLAN_CEO_ROLE = "CEO" as const;

/** @deprecated */
export const WORK_PLAN_COO_LABEL = "Chief Operating Officer (COO)";
/** @deprecated */
export const WORK_PLAN_CEO_LABEL = "Chief Executive Officer (CEO)";

/** @deprecated Position codes from the fixed COO/CEO era. */
export const WPMA_COO_POSITION_CODE = "WPMA_COO";
/** @deprecated */
export const WPMA_CEO_POSITION_CODE = "WPMA_CEO";

export type WorkPlanPersonnelRow = {
  name: string;
  positionDepartment: string;
  responsibilityRole: string;
  /** Tagged as a driver when Driver Present is on. */
  isDriver: boolean;
};

export type WorkPlanBudgetLine = {
  particulars: string;
  basisQuantity: string;
  amount: string;
};

export type WorkPlanExpectedResult = {
  deliverable: string;
  targetDate: string;
};

export type WorkPlanVenue = {
  label: string;
  /** Planned start (YYYY-MM-DD). */
  startAt: string;
  /** Planned end (YYYY-MM-DD). */
  endAt: string;
};

/** Optional travel block nested in the Work Plan (not a separate Travel Order). */
export type WorkPlanTravelLocation = {
  label: string;
};

export type WorkPlanTravelBlock = {
  locations: WorkPlanTravelLocation[];
  vehicle: string;
  driverPresent: boolean;
  driverAgentId: string;
  driverLicenseNo: string;
  /** Estimated departure (datetime-local string). */
  estDepartureAt: string;
  /** Estimated arrival (datetime-local string). */
  estArrivalAt: string;
};

export type WorkPlanMeta = {
  formatVersion: typeof WORK_PLAN_FORMAT_VERSION;
  departmentBusinessUnit: string;
  requestingParty: string;
  personInChargeAgentId: string | null;
  personInChargeName: string | null;
  datePrepared: string;
  budgetRequiredBy: string;
  purposeObjective: string;
  activityProposedWorkPlan: string;
  implementationPeriod: string;
  /** Joined venue labels (newline-separated) for older readers. */
  venueLocation: string;
  venues: WorkPlanVenue[];
  expectedOutcome: string;
  personnel: WorkPlanPersonnelRow[];
  totalPersonnel: number;
  /** When true, personnel can be tagged as drivers. */
  driverPresent: boolean;
  budgetLines: WorkPlanBudgetLine[];
  totalEstimatedBudget: string;
  justification: string;
  expectedResults: WorkPlanExpectedResult[];
  /** When true, optional travel fields are part of this Work Plan. */
  includesTravel: boolean;
  travel: WorkPlanTravelBlock | null;
};

/** Create-time draft for Work Plan (UI + offline). */
export type WorkPlanDraft = {
  workPlan: WorkPlanMeta;
  /** Sequential org-chart approval seats (layer above requestor → Layer 2). */
  approvalLevels: TravelOrderApprovalLevelDraft[];
  /** Management confirmer after the approval chain (To be Confirmed by). */
  confirmationByAgentId: string;
};

export function emptyVenue(partial?: Partial<WorkPlanVenue>): WorkPlanVenue {
  return {
    label: partial?.label ?? "",
    startAt: partial?.startAt ?? "",
    endAt: partial?.endAt ?? "",
  };
}

export function joinWorkPlanVenues(venues: readonly WorkPlanVenue[]): string {
  return venues.map((v) => v.label.trim()).filter(Boolean).join("\n");
}

export function filledWorkPlanVenues(
  meta: Pick<WorkPlanMeta, "venues" | "venueLocation">,
): WorkPlanVenue[] {
  const rows = (meta.venues ?? []).map((v) => emptyVenue(v));
  const labeled = rows.filter(
    (v) => v.label.trim() || v.startAt.trim() || v.endAt.trim(),
  );
  if (labeled.length > 0) return labeled;
  return workPlanVenueLabels(meta).map((label) => emptyVenue({ label }));
}

export function workPlanVenueLabels(
  meta: Pick<WorkPlanMeta, "venues" | "venueLocation">,
): string[] {
  const fromList = (meta.venues ?? []).map((v) => v.label.trim()).filter(Boolean);
  if (fromList.length > 0) return fromList;
  const legacy = (meta.venueLocation ?? "").trim();
  if (!legacy) return [];
  return legacy
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function venuesFromPartial(partial?: Partial<WorkPlanMeta>): WorkPlanVenue[] {
  if (Array.isArray(partial?.venues) && partial!.venues!.length > 0) {
    return partial!.venues!.map((v) => emptyVenue(v));
  }
  const labels = workPlanVenueLabels({
    venues: [],
    venueLocation: partial?.venueLocation ?? "",
  });
  if (labels.length > 0) return labels.map((label) => emptyVenue({ label }));
  return [emptyVenue()];
}

export function emptyWorkPlanTravelBlock(
  partial?: Partial<WorkPlanTravelBlock>,
): WorkPlanTravelBlock {
  const locations =
    Array.isArray(partial?.locations) && partial!.locations!.length > 0
      ? partial!.locations!.map((l) => ({ label: l.label ?? "" }))
      : [{ label: "" }];
  return {
    locations,
    vehicle: partial?.vehicle ?? "",
    driverPresent: partial?.driverPresent === true,
    driverAgentId: partial?.driverAgentId ?? "",
    driverLicenseNo: partial?.driverLicenseNo ?? "",
    estDepartureAt: partial?.estDepartureAt ?? "",
    estArrivalAt: partial?.estArrivalAt ?? "",
  };
}

export function emptyPersonnelRow(
  partial?: Partial<WorkPlanPersonnelRow>,
): WorkPlanPersonnelRow {
  return {
    name: partial?.name ?? "",
    positionDepartment: partial?.positionDepartment ?? "",
    responsibilityRole: partial?.responsibilityRole ?? "",
    isDriver: partial?.isDriver === true,
  };
}

/** Org-chart defaults for a new Work Plan (requestor + department head). */
export type WorkPlanRequestorDefaults = {
  requestorAgentId?: string | null;
  requestorName?: string | null;
  requestorRole?: string | null;
  sectionName?: string | null;
  majorSectionName?: string | null;
  designatedCompanyName?: string | null;
  departmentHeadAgentId?: string | null;
  departmentHeadName?: string | null;
};

/** Fill empty Requesting Party, PIC, and Personnel Involved from org-chart defaults. */
export function applyWorkPlanRequestorDefaults(
  draft: WorkPlanDraft,
  defaults: WorkPlanRequestorDefaults | null | undefined,
): WorkPlanDraft {
  if (!defaults) return draft;
  const wp = draft.workPlan;
  const sectionName = defaults.sectionName?.trim() || "";
  const majorName = defaults.majorSectionName?.trim() || "";
  const designatedCompany = defaults.designatedCompanyName?.trim() || "";
  const designation = sectionName || majorName;
  const requestorName = defaults.requestorName?.trim() || "";
  const requestorRole = defaults.requestorRole?.trim() || "";
  const headName = defaults.departmentHeadName?.trim() || "";
  const headId = defaults.departmentHeadAgentId?.trim() || "";

  const next = { ...wp };
  let changed = false;
  if (!next.departmentBusinessUnit.trim() && designatedCompany) {
    next.departmentBusinessUnit = designatedCompany;
    changed = true;
  }
  if (!next.requestingParty.trim() && designation) {
    next.requestingParty = designation;
    changed = true;
  }
  if (!next.personInChargeName?.trim() && !next.personInChargeAgentId?.trim() && (headName || headId)) {
    next.personInChargeName = headName || null;
    next.personInChargeAgentId = headId || null;
    changed = true;
  }
  const hasNamedPersonnel = next.personnel.some((p) => p.name.trim());
  if (!hasNamedPersonnel && requestorName) {
    next.personnel = [
      emptyPersonnelRow({
        name: requestorName,
        positionDepartment: designation || requestorRole,
        responsibilityRole: requestorRole || "Requestor",
      }),
    ];
    next.totalPersonnel = 1;
    changed = true;
  }
  let confirmationByAgentId = draft.confirmationByAgentId;
  if (!confirmationByAgentId.trim() && headId) {
    confirmationByAgentId = headId;
    changed = true;
  }
  if (!changed) return draft;
  return { ...draft, workPlan: next, confirmationByAgentId };
}

export function emptyBudgetLine(partial?: Partial<WorkPlanBudgetLine>): WorkPlanBudgetLine {
  return {
    particulars: partial?.particulars ?? "",
    basisQuantity: partial?.basisQuantity ?? "",
    amount: partial?.amount ?? "",
  };
}

export function emptyExpectedResult(
  partial?: Partial<WorkPlanExpectedResult>,
): WorkPlanExpectedResult {
  return {
    deliverable: partial?.deliverable ?? "",
    targetDate: partial?.targetDate ?? "",
  };
}

/** Local calendar date as YYYY-MM-DD for Date Prepared defaults. */
export function workPlanTodayDate(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function emptyWorkPlanMeta(partial?: Partial<WorkPlanMeta>): WorkPlanMeta {
  const personnel =
    Array.isArray(partial?.personnel) && partial!.personnel!.length > 0
      ? partial!.personnel!.map((r) => emptyPersonnelRow(r))
      : [emptyPersonnelRow()];
  const budgetLines =
    Array.isArray(partial?.budgetLines) && partial!.budgetLines!.length > 0
      ? partial!.budgetLines!.map((r) => emptyBudgetLine(r))
      : [emptyBudgetLine()];
  const expectedResults =
    Array.isArray(partial?.expectedResults) && partial!.expectedResults!.length > 0
      ? partial!.expectedResults!.map((r) => emptyExpectedResult(r))
      : [emptyExpectedResult()];
  const venues = venuesFromPartial(partial);
  return {
    formatVersion: WORK_PLAN_FORMAT_VERSION,
    departmentBusinessUnit: partial?.departmentBusinessUnit ?? "",
    requestingParty: partial?.requestingParty ?? "",
    personInChargeAgentId: partial?.personInChargeAgentId ?? null,
    personInChargeName: partial?.personInChargeName ?? null,
    datePrepared: partial?.datePrepared ?? workPlanTodayDate(),
    budgetRequiredBy: partial?.budgetRequiredBy ?? "",
    purposeObjective: partial?.purposeObjective ?? "",
    activityProposedWorkPlan: partial?.activityProposedWorkPlan ?? "",
    implementationPeriod: partial?.implementationPeriod ?? "",
    venues,
    venueLocation: joinWorkPlanVenues(venues) || (partial?.venueLocation ?? ""),
    expectedOutcome: partial?.expectedOutcome ?? "",
    personnel,
    totalPersonnel:
      typeof partial?.totalPersonnel === "number" && Number.isFinite(partial.totalPersonnel)
        ? Math.max(0, Math.floor(partial.totalPersonnel))
        : personnel.filter((p) => p.name.trim()).length,
    driverPresent: partial?.driverPresent === true,
    budgetLines,
    totalEstimatedBudget: partial?.totalEstimatedBudget ?? "",
    justification: partial?.justification ?? "",
    expectedResults,
    includesTravel: partial?.includesTravel === true,
    travel:
      partial?.includesTravel === true
        ? emptyWorkPlanTravelBlock(partial.travel ?? undefined)
        : partial?.travel
          ? emptyWorkPlanTravelBlock(partial.travel)
          : null,
  };
}

export function emptyWorkPlanDraft(partial?: Partial<WorkPlanDraft> & {
  /** @deprecated migrated from fixed COO/CEO draft shape */
  cooAgentId?: string;
  ceoAgentId?: string;
}): WorkPlanDraft {
  const legacyLevels: TravelOrderApprovalLevelDraft[] = [];
  const legacyCoo =
    typeof partial?.cooAgentId === "string" ? partial.cooAgentId.trim() : "";
  const legacyCeo =
    typeof partial?.ceoAgentId === "string" ? partial.ceoAgentId.trim() : "";
  if (!Array.isArray(partial?.approvalLevels) && (legacyCoo || legacyCeo)) {
    if (legacyCoo) {
      legacyLevels.push({ level: 1, agentId: legacyCoo, optional: false });
    }
    if (legacyCeo && legacyCeo !== legacyCoo) {
      legacyLevels.push({
        level: legacyLevels.length + 1,
        agentId: legacyCeo,
        optional: false,
      });
    }
  }

  return {
    workPlan: emptyWorkPlanMeta(partial?.workPlan),
    approvalLevels: Array.isArray(partial?.approvalLevels)
      ? partial!.approvalLevels!.map((lvl, i) => ({
          level:
            typeof lvl.level === "number" && Number.isFinite(lvl.level)
              ? Math.floor(lvl.level)
              : i + 1,
          agentId: typeof lvl.agentId === "string" ? lvl.agentId : "",
          optional: lvl.optional === true,
          alternateAgentIds: Array.isArray(lvl.alternateAgentIds)
            ? lvl.alternateAgentIds.filter((id): id is string => typeof id === "string")
            : [],
        }))
      : legacyLevels,
    confirmationByAgentId:
      typeof partial?.confirmationByAgentId === "string"
        ? partial.confirmationByAgentId.trim()
        : "",
  };
}

export function isWorkPlanMeta(raw: unknown): raw is WorkPlanMeta {
  if (!raw || typeof raw !== "object") return false;
  const r = raw as Record<string, unknown>;
  return r.formatVersion === WORK_PLAN_FORMAT_VERSION;
}

/** True when this order was created as a Work Plan (vs legacy Travel Order). */
export function isWorkPlanOrder(order: {
  workPlanMeta?: unknown | null;
}): boolean {
  return isWorkPlanMeta(order.workPlanMeta);
}

/** Work Plans with travel use the same Gate Pass Start/End flow as Travel Orders. */
export function workPlanUsesGatePass(order: {
  workPlanMeta?: { includesTravel?: boolean } | null;
  gatePassIncluded?: boolean | null;
}): boolean {
  if (!isWorkPlanOrder(order)) return false;
  return order.workPlanMeta?.includesTravel === true || order.gatePassIncluded === true;
}

export function parseWorkPlanMeta(raw: unknown): WorkPlanMeta | null {
  if (!isWorkPlanMeta(raw)) return null;
  return emptyWorkPlanMeta(raw);
}

/** Parse peso-like amount strings to a finite number (strips commas/currency). */
export function parseWorkPlanAmount(raw: string | null | undefined): number | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.replace(/[^\d.-]/g, "").trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function formatWorkPlanAmount(n: number): string {
  if (!Number.isFinite(n)) return "";
  return n.toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function sumWorkPlanBudgetLines(lines: readonly WorkPlanBudgetLine[]): number {
  let total = 0;
  for (const line of lines) {
    const n = parseWorkPlanAmount(line.amount);
    if (n != null) total += n;
  }
  return total;
}

export function deriveWorkPlanOrderRequest(meta: WorkPlanMeta): string {
  const activity = meta.activityProposedWorkPlan.trim();
  const purpose = meta.purposeObjective.trim();
  if (activity && purpose) return `${activity} — ${purpose}`.slice(0, 500);
  return (activity || purpose || "Travel Order for Management Approval").slice(0, 500);
}

export function buildWorkPlanApprovalLevelsFromSeats(
  seats: readonly TravelOrderOrgChartPathSeat[],
): TravelOrderApprovalLevelDraft[] {
  return buildApprovalLevelsFromOrgChartPath(seats);
}

/** Build store-ready levels with Layer labels from recommended seats. */
export function buildWorkPlanApprovalLevelsForStore(
  seats: readonly TravelOrderOrgChartPathSeat[],
): Array<
  TravelOrderApprovalLevelDraft & { label?: string; roleCode?: string | null }
> {
  return seats.map((seat) => ({
    level: seat.sequenceLevel,
    agentId: seat.agentId?.trim() || "",
    optional: seat.recommendedOptional === true,
    alternateAgentIds: seat.alternateAgents
      .map((a) => a.agentId?.trim() || "")
      .filter(Boolean)
      .filter((id) => id !== (seat.agentId?.trim() || "")),
    label: seat.label?.trim() || "Approved by",
    roleCode: null,
  }));
}

/** @deprecated Prefer buildWorkPlanApprovalLevelsFromSeats / draft.approvalLevels. */
export function buildWorkPlanApprovalLevels(cooAgentId: string, ceoAgentId: string) {
  return [
    {
      level: 1,
      agentId: cooAgentId.trim(),
      optional: false,
      roleCode: WORK_PLAN_COO_ROLE,
      label: WORK_PLAN_COO_LABEL,
    },
    {
      level: 2,
      agentId: ceoAgentId.trim(),
      optional: false,
      roleCode: WORK_PLAN_CEO_ROLE,
      label: WORK_PLAN_CEO_LABEL,
    },
  ];
}

export function workPlanApprovalSeatLabel(
  level: {
    level?: number;
    label?: string | null;
    roleCode?: string | null;
  } | null | undefined,
  _totalLevels?: number,
): string {
  const raw = level?.label?.trim() || "";
  if (raw && !/^level\s+\d+$/i.test(raw)) return raw;
  if (level?.roleCode === WORK_PLAN_CEO_ROLE) return WORK_PLAN_CEO_LABEL;
  if (level?.roleCode === WORK_PLAN_COO_ROLE) return WORK_PLAN_COO_LABEL;
  return "Approved by";
}

/** Validate Work Plan create draft. Returns error message or null. */
export function validateWorkPlanDraft(draft: WorkPlanDraft): string | null {
  const m = draft.workPlan;
  if (!m.departmentBusinessUnit.trim()) {
    return "Department / Business Unit is required.";
  }
  if (!m.requestingParty.trim()) {
    return "Requesting Party is required.";
  }
  if (!m.personInChargeName?.trim() && !m.personInChargeAgentId?.trim()) {
    return "Person-in-Charge is required.";
  }
  if (!m.datePrepared.trim()) {
    return "Date Prepared is required.";
  }
  if (!m.budgetRequiredBy.trim()) {
    return "Budget Required By is required.";
  }
  if (!m.activityProposedWorkPlan.trim()) {
    return "Activity / Proposed Travel Order is required.";
  }
  if (!m.purposeObjective.trim()) {
    return "Purpose / Objective is required.";
  }
  if (!m.implementationPeriod.trim()) {
    return "Date / Period of Implementation is required.";
  }
  if (workPlanVenueLabels(m).length === 0) {
    return "Add at least one venue / location.";
  }

  const namedPersonnel = m.personnel.filter((p) => p.name.trim());
  if (namedPersonnel.length === 0) {
    return "Add at least one person under Personnel Involved.";
  }
  for (let i = 0; i < namedPersonnel.length; i++) {
    const p = namedPersonnel[i]!;
    if (!p.positionDepartment.trim()) {
      return `Position / Department is required for personnel row ${i + 1}.`;
    }
    if (!p.responsibilityRole.trim()) {
      return `Responsibility / Role is required for personnel row ${i + 1}.`;
    }
  }
  if (m.driverPresent && !namedPersonnel.some((p) => p.isDriver)) {
    return "Select at least one driver among Personnel Involved.";
  }

  const filledBudget = m.budgetLines.filter(
    (l) => l.particulars.trim() || l.basisQuantity.trim() || l.amount.trim(),
  );
  if (filledBudget.length === 0) {
    return "Add at least one budget line.";
  }
  for (let i = 0; i < filledBudget.length; i++) {
    const line = filledBudget[i]!;
    if (!line.particulars.trim()) {
      return `Particulars / Expense is required for budget row ${i + 1}.`;
    }
    const amt = parseWorkPlanAmount(line.amount);
    if (amt == null || amt < 0) {
      return `Enter a valid amount for budget row ${i + 1}.`;
    }
  }

  if (!m.justification.trim()) {
    return "Justification is required.";
  }

  // Expected results are optional; if a row is started, require both fields.
  const filledResults = m.expectedResults.filter(
    (r) => r.deliverable.trim() || r.targetDate.trim(),
  );
  for (let i = 0; i < filledResults.length; i++) {
    const r = filledResults[i]!;
    if (!r.deliverable.trim()) {
      return `Expected Result / Deliverable is required for row ${i + 1}.`;
    }
    if (!r.targetDate.trim()) {
      return `Target Date is required for expected result row ${i + 1}.`;
    }
  }

  if (draft.approvalLevels.length === 0) {
    return "Add at least one approver from the org chart.";
  }
  for (const lvl of draft.approvalLevels) {
    if (!lvl.agentId.trim()) {
      return "Assign an approver.";
    }
  }
  const ids = draft.approvalLevels.map((l) => l.agentId.trim()).filter(Boolean);
  if (new Set(ids).size !== ids.length) {
    return "Each approval seat must be a different person.";
  }
  if (!draft.confirmationByAgentId.trim()) {
    return "Select who will confirm this travel order.";
  }

  return null;
}

/** Normalize meta before persist (totals, trim empty trailing rows). */
export function normalizeWorkPlanMetaForStore(meta: WorkPlanMeta): WorkPlanMeta {
  const driverPresent = meta.driverPresent === true;
  const personnel = meta.personnel
    .map((p) =>
      emptyPersonnelRow({
        ...p,
        isDriver: driverPresent && p.isDriver === true,
      }),
    )
    .filter((p) => p.name.trim() || p.positionDepartment.trim() || p.responsibilityRole.trim());
  const budgetLines = meta.budgetLines
    .map((l) => emptyBudgetLine(l))
    .filter((l) => l.particulars.trim() || l.basisQuantity.trim() || l.amount.trim());
  const expectedResults = meta.expectedResults
    .map((r) => emptyExpectedResult(r))
    .filter((r) => r.deliverable.trim() || r.targetDate.trim());
  const venues = (meta.venues ?? [])
    .map((v) => emptyVenue(v))
    .filter((v) => v.label.trim());
  const total = sumWorkPlanBudgetLines(budgetLines);
  const includesTravel = meta.includesTravel === true;
  const travel = includesTravel
    ? emptyWorkPlanTravelBlock({
        ...(meta.travel ?? undefined),
        locations: (meta.travel?.locations ?? [])
          .map((l) => ({ label: l.label.trim() }))
          .filter((l) => l.label),
      })
    : null;
  return emptyWorkPlanMeta({
    ...meta,
    personnel: personnel.length > 0 ? personnel : [emptyPersonnelRow()],
    totalPersonnel: personnel.filter((p) => p.name.trim()).length,
    driverPresent,
    budgetLines: budgetLines.length > 0 ? budgetLines : [emptyBudgetLine()],
    totalEstimatedBudget: formatWorkPlanAmount(total),
    expectedResults: expectedResults.length > 0 ? expectedResults : [emptyExpectedResult()],
    venues: venues.length > 0 ? venues : [emptyVenue()],
    venueLocation: joinWorkPlanVenues(venues),
    includesTravel,
    travel,
  });
}
