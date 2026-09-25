import { point } from "@turf/helpers";
import type { TaskScreenshotMetaItem } from "@/lib/task-screenshot-meta";
import { isIntakeAttachmentImage } from "@/lib/ticket-intake-screenshots-meta";
import type { WorkPlanMeta } from "@/lib/work-plan";
import { deriveWorkPlanOrderRequest, isWorkPlanMeta, parseWorkPlanMeta } from "@/lib/work-plan";
import type { WorkPlanDraft } from "@/lib/work-plan";

/** Location visit images (JPEG/PNG only). */
export type TravelOrderAttachment = TaskScreenshotMetaItem;

/** Order-level supporting files (images + documents). */
export type TravelOrderFileAttachment = {
  storedFileName: string;
  originalName: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
};

/** Max order-level supporting files on create (client + server). */
export const MAX_TRAVEL_ORDER_ATTACHMENTS = 10;

export function isTravelOrderFileImage(
  item: Pick<TravelOrderFileAttachment, "mimeType" | "originalName">,
): boolean {
  return isIntakeAttachmentImage(item);
}

/** Client/server DTO for one travel-order location pin. */
export type TravelOrderLocationDraft = {
  /** Client temp id before persist (optional after save). */
  clientKey: string;
  id?: string;
  label: string;
  latitude: number | null;
  longitude: number | null;
  remarks: string;
  /** Pending File objects chosen in the form (not yet uploaded). */
  pendingFiles?: File[];
  /** Already-stored attachment meta from the server. */
  attachments: TaskScreenshotMetaItem[];
};

/** Create-time draft for one sequential approval level (single assignee). */
export type TravelOrderApprovalLevelDraft = {
  level: number;
  agentId: string;
  /**
   * When true (only allowed with 3+ levels), this seat is optional: it does not
   * follow the required approval chain (always actionable), does not block later
   * required seats, and never finishes the order alone — every required APPROVED BY
   * must still approve.
   */
  optional?: boolean;
  /** Either/or peers — any one of agentId or these may approve this seat. */
  alternateAgentIds?: string[];
};

export type TravelOrderDraft = {
  orderRequest: string;
  /** Flat designated approvers (used when approvalLevels is empty). */
  approvedByAgentIds: string[];
  /** Hierarchical chain; empty = flat multi-approver mode. */
  approvalLevels: TravelOrderApprovalLevelDraft[];
  confirmationByAgentId: string;
  /** Co-travelers in addition to the creator (unless requester is exempt). */
  additionalTravelerAgentIds: string[];
  /** When true, the requestor is not included in the travelers list. */
  exemptRequesterFromTravelers: boolean;
  /** Selected vehicle option value. */
  vehicle: string;
  /** When true, show Driver + License No. fields. */
  driverPresent: boolean;
  /** Must be one of the travelers (creator or co-travelers). */
  driverAgentId: string;
  driverLicenseNo: string;
  locations: TravelOrderLocationDraft[];
  /** Optional Gate Pass (page 3). */
  gatePass: TravelOrderGatePassDraft;
};

/** Create-time / editable Gate Pass fields. */
export type TravelOrderGatePassDraft = {
  /** False when the user skips the Gate Pass page. */
  included: boolean;
  /** `datetime-local` value (YYYY-MM-DDTHH:mm) or empty. */
  estDepartureAt: string;
  estArrivalAt: string;
  actualDepartureStartedAt: string | null;
  actualDepartureStartedLatitude: number | null;
  actualDepartureStartedLongitude: number | null;
  actualDepartureEndedAt: string | null;
  actualDepartureEndedLatitude: number | null;
  actualDepartureEndedLongitude: number | null;
  /** Guard on Duty name under Actual Departure Start. */
  startGuardOnDuty: string;
  /** Guard on Duty name under Actual Arrival End. */
  endGuardOnDuty: string;
};

export function emptyGatePassDraft(
  partial?: Partial<TravelOrderGatePassDraft>,
): TravelOrderGatePassDraft {
  return {
    included: partial?.included ?? false,
    estDepartureAt: partial?.estDepartureAt ?? "",
    estArrivalAt: partial?.estArrivalAt ?? "",
    actualDepartureStartedAt: partial?.actualDepartureStartedAt ?? null,
    actualDepartureStartedLatitude: partial?.actualDepartureStartedLatitude ?? null,
    actualDepartureStartedLongitude: partial?.actualDepartureStartedLongitude ?? null,
    actualDepartureEndedAt: partial?.actualDepartureEndedAt ?? null,
    actualDepartureEndedLatitude: partial?.actualDepartureEndedLatitude ?? null,
    actualDepartureEndedLongitude: partial?.actualDepartureEndedLongitude ?? null,
    startGuardOnDuty: partial?.startGuardOnDuty ?? "",
    endGuardOnDuty: partial?.endGuardOnDuty ?? "",
  };
}

export function gatePassDraftHasAnyData(gp: TravelOrderGatePassDraft): boolean {
  return Boolean(
    gp.estDepartureAt.trim() ||
      gp.estArrivalAt.trim() ||
      gp.actualDepartureStartedAt ||
      gp.actualDepartureEndedAt,
  );
}

/** Validate Gate Pass only when the user opted in or entered any field. */
export function validateTravelOrderGatePass(gp: TravelOrderGatePassDraft): string | null {
  if (!gp.included && !gatePassDraftHasAnyData(gp)) return null;

  const dep = gp.estDepartureAt.trim();
  const arr = gp.estArrivalAt.trim();
  if (dep) {
    const d = Date.parse(dep);
    if (!Number.isFinite(d)) return "Est. Departure date/time is invalid.";
  }
  if (arr) {
    const a = Date.parse(arr);
    if (!Number.isFinite(a)) return "Est. Arrival date/time is invalid.";
  }
  if (dep && arr) {
    const d = Date.parse(dep);
    const a = Date.parse(arr);
    if (Number.isFinite(d) && Number.isFinite(a) && a < d) {
      return "Est. Arrival must be on or after Est. Departure.";
    }
  }
  if (gp.actualDepartureStartedAt && gp.actualDepartureEndedAt) {
    const s = Date.parse(gp.actualDepartureStartedAt);
    const e = Date.parse(gp.actualDepartureEndedAt);
    if (Number.isFinite(s) && Number.isFinite(e) && e < s) {
      return "Actual Departure End must be on or after Start.";
    }
  }
  return null;
}

/** Convert datetime-local / ISO string to Date, or null when empty/invalid. */
export function parseOptionalDateTimeInput(raw: string | null | undefined): Date | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const ms = Date.parse(raw.trim());
  if (!Number.isFinite(ms)) return null;
  return new Date(ms);
}

/** Format an ISO timestamp for `<input type="datetime-local" />`. */
export function toDatetimeLocalValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const dt = new Date(iso);
  if (!Number.isFinite(dt.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

/** Preset vehicle choices for Travel Order requests. */
export const TRAVEL_ORDER_VEHICLE_OPTIONS = [
  { value: "COMPANY_VAN", label: "Company van" },
  { value: "COMPANY_CAR", label: "Company car" },
  { value: "SERVICE_VEHICLE", label: "Service vehicle" },
  { value: "MOTORCYCLE", label: "Motorcycle" },
  { value: "PERSONAL_VEHICLE", label: "Personal vehicle" },
  { value: "RENTAL", label: "Rental vehicle" },
  { value: "PUBLIC_TRANSPORT", label: "Public transport" },
  { value: "OTHER", label: "Other" },
] as const;

export type TravelOrderVehicleValue = (typeof TRAVEL_ORDER_VEHICLE_OPTIONS)[number]["value"];

export function travelOrderVehicleLabel(value: string | null | undefined): string {
  if (!value?.trim()) return "—";
  const found = TRAVEL_ORDER_VEHICLE_OPTIONS.find((o) => o.value === value.trim());
  return found?.label ?? value.trim();
}

export function isValidTravelOrderVehicle(value: string): value is TravelOrderVehicleValue {
  return TRAVEL_ORDER_VEHICLE_OPTIONS.some((o) => o.value === value);
}

export type TravelOrderAgentRef = { id: string; name: string; email: string };

/** Persisted / API approval level with status. */
export type TravelOrderApprovalLevelDto = {
  level: number;
  agentId: string | null;
  agent: TravelOrderAgentRef | null;
  approvedAt: string | null;
  approvedByAgentId: string | null;
  approvedByAgent: TravelOrderAgentRef | null;
  /** Optional levels can early-complete the chain and do not block later required levels. */
  optional?: boolean;
  /** Either/or peers who may also approve this seat. */
  alternateAgentIds?: string[];
  alternateAgents?: TravelOrderAgentRef[];
  /** Work Plan seat role (COO / CEO). */
  roleCode?: string | null;
  /** Display label (e.g. Chief Operating Officer (COO)). */
  label?: string | null;
};

export type TravelOrderLocationDto = {
  id: string;
  label: string;
  /** @deprecated Prefer endedLatitude / endedLongitude — kept for map/legacy. */
  latitude: number | null;
  longitude: number | null;
  /** @deprecated Prefer endedAt — kept for KPI/legacy. */
  checkedAt: string | null;
  startedAt: string | null;
  startedLatitude: number | null;
  startedLongitude: number | null;
  endedAt: string | null;
  endedLatitude: number | null;
  endedLongitude: number | null;
  remarks: string | null;
  attachments: TaskScreenshotMetaItem[];
  sortOrder: number;
};

export type TravelOrderLocationVisitStatus = "pending" | "in_progress" | "completed";

export function travelOrderLocationVisitStatus(
  loc: Pick<TravelOrderLocationDto, "startedAt" | "endedAt" | "checkedAt"> | {
    startedAt?: string | Date | null;
    endedAt?: string | Date | null;
    checkedAt?: string | Date | null;
  },
): TravelOrderLocationVisitStatus {
  if (loc.endedAt || loc.checkedAt) return "completed";
  if (loc.startedAt) return "in_progress";
  return "pending";
}

export function travelOrderLocationVisitStatusLabel(
  status: TravelOrderLocationVisitStatus,
): string {
  if (status === "completed") return "Completed";
  if (status === "in_progress") return "In Progress";
  return "Not started";
}

/** True when this travel order opted into Gate Pass. */
export function travelOrderHasGatePass(order: {
  gatePassIncluded?: boolean | null;
}): boolean {
  return order.gatePassIncluded === true;
}

/**
 * Location Start/End / remarks / images unlock:
 * - With Gate Pass: after Actual Departure Start is captured
 * - Without Gate Pass: once the order is fully approved
 */
export function travelOrderLocationsUnlocked(order: {
  status?: string | null;
  gatePassIncluded?: boolean | null;
  actualDepartureStartedAt?: string | Date | null;
}): boolean {
  if (!isTravelOrderApproved(order.status ?? "")) return false;
  if (travelOrderHasGatePass(order)) {
    return Boolean(order.actualDepartureStartedAt);
  }
  return true;
}

export function travelOrderAllLocationsCompleted(
  order: {
    locations?: Array<{
      startedAt?: string | Date | null;
      endedAt?: string | Date | null;
      checkedAt?: string | Date | null;
    }> | null;
  },
): boolean {
  const locs = order.locations ?? [];
  if (locs.length === 0) return false;
  return locs.every((loc) => travelOrderLocationVisitStatus(loc) === "completed");
}

/**
 * Confirm unlock:
 * - Work Plan: after every required approver has signed (status APPROVED)
 * - Travel Order with Gate Pass: after Actual Arrival End is captured
 * - Travel Order without Gate Pass: after every location visit is completed
 */
export function isTravelOrderConfirmReady(order: {
  status?: string | null;
  gatePassIncluded?: boolean | null;
  actualDepartureEndedAt?: string | Date | null;
  locations?: Array<{
    startedAt?: string | Date | null;
    endedAt?: string | Date | null;
    checkedAt?: string | Date | null;
  }> | null;
  workPlanMeta?: unknown;
}): boolean {
  if (order.status !== TRAVEL_ORDER_STATUS.APPROVED) return false;
  if (isWorkPlanMeta(order.workPlanMeta)) return true;
  if (travelOrderHasGatePass(order)) {
    return Boolean(order.actualDepartureEndedAt);
  }
  return travelOrderAllLocationsCompleted(order);
}

export type TravelOrderDto = {
  id: string;
  kpiMaintenanceId: string;
  orderRequest: string;
  /** Work Plan for Management Approval fields (null/undefined = legacy Travel Order). */
  workPlanMeta?: WorkPlanMeta | null;
  /** Order-level supporting files (images + documents). */
  attachments?: TravelOrderFileAttachment[];
  status: string;
  /** Primary/first approver (legacy). */
  approvedByAgentId: string | null;
  approvedByAgent: TravelOrderAgentRef | null;
  /** All designated approvers. */
  approvedByAgentIds: string[];
  approvedByAgents: TravelOrderAgentRef[];
  /** Ordered hierarchical approval chain (empty = flat mode). */
  approvalLevels: TravelOrderApprovalLevelDto[];
  confirmationByAgentId: string | null;
  confirmationByAgent: TravelOrderAgentRef | null;
  createdByAgentId?: string | null;
  createdByAgent?: TravelOrderAgentRef | null;
  companyTeamId?: string | null;
  travelerAgentIds?: string[];
  travelers?: TravelOrderAgentRef[];
  /** Selected vehicle option value (e.g. COMPANY_VAN). */
  vehicle?: string | null;
  driverPresent?: boolean;
  driverAgentId?: string | null;
  driverAgent?: TravelOrderAgentRef | null;
  driverLicenseNo?: string | null;
  /** Optional Gate Pass section. */
  gatePassIncluded?: boolean;
  estDepartureAt?: string | null;
  estArrivalAt?: string | null;
  actualDepartureStartedAt?: string | null;
  actualDepartureStartedLatitude?: number | null;
  actualDepartureStartedLongitude?: number | null;
  gatePassStartGuardOnDuty?: string | null;
  actualDepartureEndedAt?: string | null;
  actualDepartureEndedLatitude?: number | null;
  actualDepartureEndedLongitude?: number | null;
  gatePassEndGuardOnDuty?: string | null;
  /** Why the order was declined (when status is REJECTED). */
  rejectionReason?: string | null;
  rejectedByAgentId?: string | null;
  rejectedByAgent?: TravelOrderAgentRef | null;
  rejectedAt?: string | null;
  /** Approval level that declined; null when declined at confirmation. */
  rejectedAtLevel?: number | null;
  /** Recorded Field Assignment KPI % after Submit as Done; null until submitted. */
  kpiPercent: number | null;
  kpiSubmittedAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  locations: TravelOrderLocationDto[];
  kpiTitle?: string | null;
  kpiMainTask?: string | null;
};

export const TRAVEL_ORDER_STATUS = {
  SUBMITTED: "SUBMITTED",
  APPROVED: "APPROVED",
  CONFIRMED: "CONFIRMED",
  REJECTED: "REJECTED",
  CANCELLED: "CANCELLED",
} as const;

export function isTravelOrderApproved(status: string): boolean {
  return status === TRAVEL_ORDER_STATUS.APPROVED || status === TRAVEL_ORDER_STATUS.CONFIRMED;
}

export function isTravelOrderRunning(status: string): boolean {
  return status === TRAVEL_ORDER_STATUS.APPROVED;
}

export function emptyTravelLocation(partial?: Partial<TravelOrderLocationDraft>): TravelOrderLocationDraft {
  return {
    clientKey: partial?.clientKey ?? crypto.randomUUID(),
    id: partial?.id,
    label: partial?.label ?? "",
    latitude: partial?.latitude ?? null,
    longitude: partial?.longitude ?? null,
    remarks: partial?.remarks ?? "",
    pendingFiles: partial?.pendingFiles ?? [],
    attachments: partial?.attachments ?? [],
  };
}

export function emptyTravelOrderDraft(): TravelOrderDraft {
  return {
    orderRequest: "",
    approvedByAgentIds: [],
    approvalLevels: [],
    confirmationByAgentId: "",
    additionalTravelerAgentIds: [],
    exemptRequesterFromTravelers: false,
    vehicle: "",
    driverPresent: false,
    driverAgentId: "",
    driverLicenseNo: "",
    locations: [emptyTravelLocation()],
    gatePass: emptyGatePassDraft(),
  };
}

/** Fill missing fields so controlled inputs never see `undefined`. */
export function normalizeTravelOrderDraft(raw: TravelOrderDraft | null | undefined): TravelOrderDraft {
  const base = emptyTravelOrderDraft();
  if (!raw || typeof raw !== "object") return base;
  const locations = Array.isArray(raw.locations) && raw.locations.length > 0
    ? raw.locations.map((loc) => emptyTravelLocation(loc))
    : base.locations;
  return {
    orderRequest: raw.orderRequest ?? "",
    approvedByAgentIds: Array.isArray(raw.approvedByAgentIds) ? raw.approvedByAgentIds : [],
    approvalLevels: Array.isArray(raw.approvalLevels)
      ? raw.approvalLevels.map((lvl) => ({
          level: lvl.level,
          agentId: lvl.agentId ?? "",
          optional: lvl.optional === true,
          alternateAgentIds: Array.isArray(lvl.alternateAgentIds)
            ? lvl.alternateAgentIds.filter((id): id is string => typeof id === "string" && Boolean(id.trim()))
            : [],
        }))
      : [],
    confirmationByAgentId: raw.confirmationByAgentId ?? "",
    additionalTravelerAgentIds: Array.isArray(raw.additionalTravelerAgentIds)
      ? raw.additionalTravelerAgentIds
      : [],
    exemptRequesterFromTravelers: raw.exemptRequesterFromTravelers === true,
    vehicle: raw.vehicle ?? "",
    driverPresent: raw.driverPresent === true,
    driverAgentId: raw.driverAgentId ?? "",
    driverLicenseNo: raw.driverLicenseNo ?? "",
    locations,
    gatePass: emptyGatePassDraft(raw.gatePass),
  };
}

export function buildEmptyApprovalLevels(count: number): TravelOrderApprovalLevelDraft[] {
  const n = Math.max(0, Math.min(20, Math.floor(count)));
  return Array.from({ length: n }, (_, i) => ({
    level: i + 1,
    agentId: "",
    optional: false,
  }));
}

/** Optional levels are only configurable when the chain has 3+ steps. */
export function approvalLevelsAllowOptional(levelCount: number): boolean {
  return levelCount >= 3;
}

/** Most senior org-chart layer that can approve a travel order (Layer 1 is excluded). */
export const TRAVEL_ORDER_APPROVAL_TOP_ORG_LAYER = 2;

/** How many hierarchical seats to create when the requestor sits on this org-chart
 *  layer (Layer 1 = top). The chain starts at the layer immediately above the requestor
 *  and runs up to `topOrgLayer` (default Layer 2 for travel orders). */
export function travelOrderApprovalSeatCountFromRequestorLayer(
  requestorOrgLayer: number | null | undefined,
  topOrgLayer: number = TRAVEL_ORDER_APPROVAL_TOP_ORG_LAYER,
): number {
  if (typeof requestorOrgLayer !== "number" || !Number.isFinite(requestorOrgLayer)) {
    return 0;
  }
  const top = Math.max(1, Math.floor(topOrgLayer));
  const layer = Math.floor(requestorOrgLayer);
  if (layer <= top) return 0;
  return Math.max(0, Math.min(20, layer - top));
}

/**
 * Org-chart layers in the recommended approval path, ordered by approval sequence
 * (immediate manager first → top layer last).
 */
export function travelOrderOrgChartLayersInApprovalPath(
  requestorOrgLayer: number | null | undefined,
  topOrgLayer: number = TRAVEL_ORDER_APPROVAL_TOP_ORG_LAYER,
): number[] {
  const seats = travelOrderApprovalSeatCountFromRequestorLayer(
    requestorOrgLayer,
    topOrgLayer,
  );
  if (seats < 1 || typeof requestorOrgLayer !== "number") return [];
  const start = Math.floor(requestorOrgLayer) - 1;
  return Array.from({ length: seats }, (_, i) => start - i);
}

/**
 * Recommended optional flag: with 3+ seats, middle layers are optional;
 * the immediate manager (first) and Layer 2 (last) stay required.
 */
export function travelOrderRecommendedOptionalForSeat(
  sequenceLevel: number,
  totalSeats: number,
): boolean {
  if (!approvalLevelsAllowOptional(totalSeats)) return false;
  return sequenceLevel > 1 && sequenceLevel < totalSeats;
}

export type TravelOrderOrgChartPathSeat = {
  /** Approval sequence (1 = first to act). */
  sequenceLevel: number;
  /** Org-chart layer this seat represents (Layer 2+), or a display placeholder. */
  orgChartLayer: number;
  /** Human label for department-head recommendations (e.g. Immediate head). */
  label?: string | null;
  /** Short hint under the recommended name. */
  hint?: string | null;
  recommendedOptional: boolean;
  agentId: string | null;
  agentName: string | null;
  mergedSourceUserId: string | null;
  /** Either/or peers linked on the org chart — any one may approve this seat. */
  alternateAgents: Array<{
    agentId: string | null;
    agentName: string | null;
    mergedSourceUserId: string;
  }>;
};

export type TravelOrderOrgChartAncestor = {
  orgChartLayer: number;
  agentId: string | null;
  agentName: string | null;
  mergedSourceUserId: string;
  alternateAgents?: Array<{
    agentId: string | null;
    agentName: string | null;
    mergedSourceUserId: string;
  }>;
};

/** Build recommended seats from requestor layer + ancestors already walked up the chart. */
export function buildTravelOrderRecommendedPath(opts: {
  requestorOrgLayer: number | null | undefined;
  ancestors: readonly TravelOrderOrgChartAncestor[];
  /** Most senior layer included in the chain (default Layer 2). Use 1 to include top/CEO. */
  topOrgLayer?: number;
}): TravelOrderOrgChartPathSeat[] {
  const topOrgLayer = opts.topOrgLayer ?? TRAVEL_ORDER_APPROVAL_TOP_ORG_LAYER;
  const layers = travelOrderOrgChartLayersInApprovalPath(
    opts.requestorOrgLayer,
    topOrgLayer,
  );
  if (layers.length === 0) return [];

  const byLayer = new Map<number, TravelOrderOrgChartAncestor>();
  for (const ancestor of opts.ancestors) {
    if (!byLayer.has(ancestor.orgChartLayer)) {
      byLayer.set(ancestor.orgChartLayer, ancestor);
    }
  }

  const total = layers.length;
  return layers.map((orgChartLayer, index) => {
    const sequenceLevel = index + 1;
    const hit = byLayer.get(orgChartLayer);
    return {
      sequenceLevel,
      orgChartLayer,
      recommendedOptional: travelOrderRecommendedOptionalForSeat(sequenceLevel, total),
      agentId: hit?.agentId ?? null,
      agentName: hit?.agentName ?? null,
      mergedSourceUserId: hit?.mergedSourceUserId ?? null,
      alternateAgents: hit?.alternateAgents ?? [],
    };
  });
}

/**
 * Merge section-head superiors (sub-dept → major) ahead of people-chart parents.
 * Dedupes by agentId / mergedSourceUserId so an immediate section head who is also
 * the people-chart parent appears once.
 */
export function mergeTravelOrderApprovalAncestors(opts: {
  sectionHeads: readonly TravelOrderOrgChartAncestor[];
  peopleAncestors: readonly TravelOrderOrgChartAncestor[];
}): TravelOrderOrgChartAncestor[] {
  const out: TravelOrderOrgChartAncestor[] = [];
  const seen = new Set<string>();
  const push = (ancestor: TravelOrderOrgChartAncestor) => {
    const key =
      ancestor.agentId?.trim() ||
      ancestor.mergedSourceUserId?.trim() ||
      "";
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(ancestor);
  };
  for (const ancestor of opts.sectionHeads) push(ancestor);
  for (const ancestor of opts.peopleAncestors) push(ancestor);
  return out;
}

/**
 * One approval seat per ordered ancestor (no empty layer gaps).
 * Use when the chain includes section heads who share a people-chart layer
 * with the requestor (common for sub-department heads under a major head).
 */
export function buildTravelOrderRecommendedPathFromChain(
  ancestors: readonly TravelOrderOrgChartAncestor[],
): TravelOrderOrgChartPathSeat[] {
  const total = ancestors.length;
  if (total < 1) return [];
  return ancestors.map((ancestor, index) => {
    const sequenceLevel = index + 1;
    return {
      sequenceLevel,
      orgChartLayer: ancestor.orgChartLayer,
      recommendedOptional: travelOrderRecommendedOptionalForSeat(sequenceLevel, total),
      agentId: ancestor.agentId ?? null,
      agentName: ancestor.agentName ?? null,
      mergedSourceUserId: ancestor.mergedSourceUserId,
      alternateAgents: ancestor.alternateAgents ?? [],
    };
  });
}

export function buildApprovalLevelsFromOrgChartPath(
  seats: readonly TravelOrderOrgChartPathSeat[],
): TravelOrderApprovalLevelDraft[] {
  return seats.map((seat) => ({
    level: seat.sequenceLevel,
    agentId: seat.agentId?.trim() || "",
    optional: seat.recommendedOptional,
    alternateAgentIds: seat.alternateAgents
      .map((a) => a.agentId?.trim() || "")
      .filter(Boolean)
      .filter((id) => id !== (seat.agentId?.trim() || "")),
  }));
}

/** Org-chart-style layer label. Sequence 1 is the first approver; with `totalLevels`
 *  that maps inverted onto the chart (last seat = Layer 2 — Layer 1 is never in the chain). */
export function travelOrderApprovalDisplayLayer(
  sequenceLevel: number,
  totalLevels: number,
): number {
  const total = Math.max(1, Math.floor(totalLevels));
  const seq = Math.max(1, Math.floor(sequenceLevel));
  return total - seq + TRAVEL_ORDER_APPROVAL_TOP_ORG_LAYER;
}

export function travelOrderApprovalLayerLabel(
  sequenceLevel: number,
  totalLevels?: number,
): string {
  const n =
    typeof totalLevels === "number" && Number.isFinite(totalLevels) && totalLevels >= 1
      ? travelOrderApprovalDisplayLayer(sequenceLevel, totalLevels)
      : Math.max(TRAVEL_ORDER_APPROVAL_TOP_ORG_LAYER, Math.floor(sequenceLevel));
  return `Level ${n}`;
}

/** Level 2 (last / senior travel-order seat) first, then Level 3, … — org-chart order. */
export function sortTravelOrderLevelsByDisplayLayer<T extends { level: number }>(
  levels: readonly T[],
): T[] {
  const total = levels.length;
  return [...levels].sort(
    (a, b) =>
      travelOrderApprovalDisplayLayer(a.level, total) -
      travelOrderApprovalDisplayLayer(b.level, total),
  );
}

/** Display label for a hierarchical approval seat (UI uppercases this). */
export function travelOrderApprovedByLabel(
  optional?: boolean,
  sequenceLevel?: number,
  totalLevels?: number,
  levelMeta?: { label?: string | null; roleCode?: string | null } | null,
): string {
  if (levelMeta?.label?.trim()) return levelMeta.label.trim();
  if (levelMeta?.roleCode === "CEO") return "Chief Executive Officer (CEO)";
  if (levelMeta?.roleCode === "COO") return "Chief Operating Officer (COO)";
  const seat = optional ? "Approved By (Optional)" : "Approved By (Required)";
  if (typeof sequenceLevel === "number" && Number.isFinite(sequenceLevel) && sequenceLevel >= 1) {
    return `${travelOrderApprovalLayerLabel(sequenceLevel, totalLevels)} · ${seat}`;
  }
  return seat;
}

export { isWorkPlanMeta, parseWorkPlanMeta };
export type { WorkPlanMeta };

export function isValidLatLng(lat: unknown, lng: unknown): lat is number {
  if (
    typeof lat !== "number" ||
    typeof lng !== "number" ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  ) {
    return false;
  }
  // Turf point construction validates GeoJSON position shape.
  try {
    point([lng, lat]);
    return true;
  } catch {
    return false;
  }
}

export function validateTravelOrderDraft(draft: TravelOrderDraft): string | null {
  if (!draft.orderRequest.trim()) {
    return "Order request details are required.";
  }
  if (draft.locations.length === 0) {
    return "Add at least one location.";
  }
  for (let i = 0; i < draft.locations.length; i++) {
    const loc = draft.locations[i]!;
    if (!loc.label.trim()) {
      return `Location ${i + 1}: enter a location name or address.`;
    }
  }
  if (draft.approvalLevels.length > 0) {
    for (const lvl of draft.approvalLevels) {
      if (!lvl.agentId.trim()) {
        return `Assign an approver for ${travelOrderApprovedByLabel(lvl.optional === true, lvl.level, draft.approvalLevels.length)}.`;
      }
    }
  } else if (draft.approvedByAgentIds.length === 0) {
    return "Select at least one person who will approve this travel order.";
  }
  if (!draft.confirmationByAgentId.trim()) {
    return "Select who will confirm this travel order.";
  }
  if (!draft.vehicle.trim()) {
    return "Select a vehicle for this travel order.";
  }
  if (draft.exemptRequesterFromTravelers && draft.additionalTravelerAgentIds.length === 0) {
    return "Add at least one traveler, or uncheck Exempt Me from Travelers.";
  }
  if (draft.driverPresent) {
    if (!draft.driverAgentId.trim()) {
      return "Select a driver from the travelers list.";
    }
  }
  const gatePassError = validateTravelOrderGatePass(draft.gatePass);
  if (gatePassError) return gatePassError;
  return null;
}

export function parseApprovedByAgentIds(raw: unknown, fallbackId?: string | null): string[] {
  const out: string[] = [];
  if (Array.isArray(raw)) {
    for (const row of raw) {
      if (typeof row === "string" && row.trim()) out.push(row.trim());
    }
  }
  if (out.length === 0 && typeof fallbackId === "string" && fallbackId.trim()) {
    out.push(fallbackId.trim());
  }
  return [...new Set(out)];
}

/**
 * Travelers stored on the order. The creator is only used as a legacy fallback
 * when the stored list is empty (older rows).
 */
export function parseTravelerAgentIds(
  raw: unknown,
  creatorAgentId?: string | null,
): string[] {
  const out = parseApprovedByAgentIds(raw);
  if (
    out.length === 0 &&
    typeof creatorAgentId === "string" &&
    creatorAgentId.trim()
  ) {
    out.push(creatorAgentId.trim());
  }
  return [...new Set(out)];
}

/** Build traveler list from requestor + co-travelers (requestor optional). */
export function normalizeTravelerAgentIds(input: {
  createdByAgentId: string;
  additionalTravelerAgentIds?: string[];
  /** When true, omit the requestor from the travelers list. */
  exemptRequesterFromTravelers?: boolean;
}): string[] {
  const creator = input.createdByAgentId.trim();
  const extra = (input.additionalTravelerAgentIds ?? [])
    .map((id) => id.trim())
    .filter((id) => id && id !== creator);
  if (input.exemptRequesterFromTravelers) {
    return [...new Set(extra.filter(Boolean))];
  }
  return [...new Set([creator, ...extra].filter(Boolean))];
}

/** Stored JSON row before agent hydration. */
export type TravelOrderApprovalLevelStored = {
  level: number;
  agentId: string | null;
  approvedAt: string | null;
  approvedByAgentId: string | null;
  optional?: boolean;
  alternateAgentIds?: string[];
  roleCode?: string | null;
  label?: string | null;
};

type ApprovalLevelLike = {
  level: number;
  agentId?: string | null;
  approvedAt?: string | null;
  approvedByAgentId?: string | null;
  optional?: boolean;
  alternateAgentIds?: string[] | null;
};

export function isApprovalLevelOptional(level: ApprovalLevelLike | null | undefined): boolean {
  return Boolean(level?.optional);
}

export function approvalLevelAssigneeIds(
  level: { agentId?: string | null; alternateAgentIds?: string[] | null } | null | undefined,
): string[] {
  if (!level) return [];
  const primary =
    typeof level.agentId === "string" && level.agentId.trim() ? level.agentId.trim() : "";
  const alts = Array.isArray(level.alternateAgentIds)
    ? level.alternateAgentIds
        .map((id) => (typeof id === "string" ? id.trim() : ""))
        .filter(Boolean)
    : [];
  return [...new Set([primary, ...alts].filter(Boolean))];
}

export function isApprovalLevelAssignee(
  level: { agentId?: string | null; alternateAgentIds?: string[] | null } | null | undefined,
  operatorAgentId: string | null | undefined,
): boolean {
  if (!operatorAgentId) return false;
  return approvalLevelAssigneeIds(level).includes(operatorAgentId);
}

export function parseApprovalLevels(raw: unknown): TravelOrderApprovalLevelStored[] {
  if (!Array.isArray(raw)) return [];
  const out: TravelOrderApprovalLevelStored[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const level =
      typeof r.level === "number" && Number.isFinite(r.level) ? Math.floor(r.level) : NaN;
    if (!Number.isFinite(level) || level < 1) continue;
    const agentId =
      typeof r.agentId === "string" && r.agentId.trim() ? r.agentId.trim() : null;
    const approvedByAgentId =
      typeof r.approvedByAgentId === "string" && r.approvedByAgentId.trim()
        ? r.approvedByAgentId.trim()
        : null;
    const approvedAt =
      typeof r.approvedAt === "string" && r.approvedAt.trim() ? r.approvedAt.trim() : null;
    const optional = r.optional === true;
    const alternateAgentIds = Array.isArray(r.alternateAgentIds)
      ? [
          ...new Set(
            r.alternateAgentIds
              .map((id) => (typeof id === "string" ? id.trim() : ""))
              .filter(Boolean)
              .filter((id) => id !== agentId),
          ),
        ]
      : [];
    const roleCode =
      typeof r.roleCode === "string" && r.roleCode.trim() ? r.roleCode.trim() : null;
    const label = typeof r.label === "string" && r.label.trim() ? r.label.trim() : null;
    out.push({
      level,
      agentId,
      approvedAt,
      approvedByAgentId,
      optional,
      ...(alternateAgentIds.length > 0 ? { alternateAgentIds } : {}),
      ...(roleCode ? { roleCode } : {}),
      ...(label ? { label } : {}),
    });
  }
  return out.sort((a, b) => a.level - b.level);
}

export function normalizeApprovalLevelsForStore(
  levels: Array<{
    level?: number;
    agentId?: string | null;
    optional?: boolean;
    alternateAgentIds?: string[] | null;
    roleCode?: string | null;
    label?: string | null;
  }>,
): TravelOrderApprovalLevelStored[] {
  const normalized = levels
    .map((row, index) => {
      const agentId =
        typeof row.agentId === "string" && row.agentId.trim() ? row.agentId.trim() : null;
      const alternateAgentIds = Array.isArray(row.alternateAgentIds)
        ? [
            ...new Set(
              row.alternateAgentIds
                .map((id) => (typeof id === "string" ? id.trim() : ""))
                .filter(Boolean)
                .filter((id) => id !== agentId),
            ),
          ]
        : [];
      const roleCode =
        typeof row.roleCode === "string" && row.roleCode.trim() ? row.roleCode.trim() : null;
      const label = typeof row.label === "string" && row.label.trim() ? row.label.trim() : null;
      return {
        level:
          typeof row.level === "number" && Number.isFinite(row.level)
            ? Math.floor(row.level)
            : index + 1,
        agentId,
        approvedAt: null as string | null,
        approvedByAgentId: null as string | null,
        optional: row.optional === true,
        ...(alternateAgentIds.length > 0 ? { alternateAgentIds } : {}),
        ...(roleCode ? { roleCode } : {}),
        ...(label ? { label } : {}),
      };
    })
    .filter((row) => row.level >= 1)
    .sort((a, b) => a.level - b.level);
  const allowOptional = approvalLevelsAllowOptional(normalized.length);
  return normalized.map((row) => ({
    ...row,
    optional: allowOptional && row.optional,
  }));
}

export function agentIdsFromApprovalLevels(
  levels: Array<{ agentId?: string | null; alternateAgentIds?: string[] | null }>,
): string[] {
  return [
    ...new Set(levels.flatMap((l) => approvalLevelAssigneeIds(l))),
  ];
}

/** Rebuild the field-assignment POST fields from a saved offline draft (queue recovery). */
export function travelOrderDraftToFieldAssignmentPayload(input: {
  draft?: TravelOrderDraft | null;
  workPlanDraft?: WorkPlanDraft | null;
  mainTaskName: string;
  scopedCompanyTeamId?: string | null;
}): Record<string, string> {
  const wp = input.workPlanDraft;
  if (wp) {
    const orderRequest = deriveWorkPlanOrderRequest(wp.workPlan);
    const mainTask = input.mainTaskName.trim() || orderRequest.slice(0, 160);
    const payload: Record<string, string> = {
      title: mainTask.replace(/\s+/g, " ").toUpperCase() || "TRAVEL ORDER",
      mainTask,
      orderRequest,
      workPlanJson: JSON.stringify(wp.workPlan),
      approvalLevels: JSON.stringify(
        wp.approvalLevels.map((lvl) => ({
          level: lvl.level,
          agentId: lvl.agentId.trim(),
          optional: lvl.optional === true,
          alternateAgentIds: Array.isArray(lvl.alternateAgentIds)
            ? lvl.alternateAgentIds
            : [],
          label: `Level ${lvl.level}`,
        })),
      ),
    };
    if (input.scopedCompanyTeamId) payload.scopedCompanyTeamId = input.scopedCompanyTeamId;
    if (wp.confirmationByAgentId?.trim()) {
      payload.confirmationByAgentId = wp.confirmationByAgentId.trim();
    }
    return payload;
  }

  const d = input.draft;
  if (!d) {
    throw new Error("Offline draft is missing Travel Order details.");
  }
  const hierarchical = d.approvalLevels.length > 0;
  const approvedByAgentIds = hierarchical
    ? agentIdsFromApprovalLevels(d.approvalLevels)
    : d.approvedByAgentIds;
  const mainTask = input.mainTaskName.trim();
  const payload: Record<string, string> = {
    title: mainTask.replace(/\s+/g, " ").toUpperCase() || "FIELD ASSIGNMENT",
    mainTask,
    orderRequest: d.orderRequest.trim(),
    approvedByAgentIds: JSON.stringify(approvedByAgentIds),
    confirmationByAgentId: d.confirmationByAgentId.trim(),
    additionalTravelerAgentIds: JSON.stringify(d.additionalTravelerAgentIds ?? []),
    exemptRequesterFromTravelers: d.exemptRequesterFromTravelers ? "1" : "0",
    vehicle: d.vehicle.trim(),
    driverPresent: d.driverPresent ? "1" : "0",
    driverAgentId: d.driverPresent ? d.driverAgentId.trim() : "",
    driverLicenseNo: d.driverPresent ? d.driverLicenseNo.trim() : "",
    locationsJson: JSON.stringify(
      d.locations.map((loc) => ({
        label: loc.label.trim(),
        latitude: null,
        longitude: null,
        remarks: null,
      })),
    ),
    gatePassJson: JSON.stringify({
      included: d.gatePass.included === true,
      estDepartureAt: d.gatePass.estDepartureAt.trim() || null,
      estArrivalAt: d.gatePass.estArrivalAt.trim() || null,
      actualDepartureStartedAt: null,
      actualDepartureStartedLatitude: null,
      actualDepartureStartedLongitude: null,
      actualDepartureEndedAt: null,
      actualDepartureEndedLatitude: null,
      actualDepartureEndedLongitude: null,
      startGuardOnDuty: "",
      endGuardOnDuty: "",
    }),
  };
  if (approvedByAgentIds[0]) payload.approvedByAgentId = approvedByAgentIds[0];
  if (hierarchical) {
    payload.approvalLevels = JSON.stringify(
      d.approvalLevels.map((lvl) => ({
        level: lvl.level,
        agentId: lvl.agentId,
        optional: lvl.optional === true,
        ...(Array.isArray(lvl.alternateAgentIds) && lvl.alternateAgentIds.length > 0
          ? { alternateAgentIds: lvl.alternateAgentIds }
          : {}),
      })),
    );
  }
  if (input.scopedCompanyTeamId) payload.scopedCompanyTeamId = input.scopedCompanyTeamId;
  return payload;
}

export function hasHierarchicalApprovals(
  levels: Array<{ level?: number; agentId?: string | null }> | null | undefined,
): boolean {
  return Array.isArray(levels) && levels.length > 0;
}

function sortApprovalLevels<T extends ApprovalLevelLike>(levels: T[]): T[] {
  return [...levels].sort((a, b) => a.level - b.level);
}

/**
 * Required seats unlock in order (every prior *required* seat must be approved).
 * Optional seats do not follow the chain — they are always actionable until the
 * hierarchy is satisfied.
 */
export function isApprovalLevelUnlocked(
  levels: ApprovalLevelLike[],
  levelNumber: number,
): boolean {
  const sorted = sortApprovalLevels(levels);
  const target = sorted.find((l) => l.level === levelNumber);
  if (!target) return false;
  if (isApprovalLevelOptional(target)) return true;
  return sorted
    .filter((l) => l.level < levelNumber && !isApprovalLevelOptional(l))
    .every((l) => Boolean(l.approvedAt));
}

/** Incomplete levels the workflow is currently waiting on (may be more than one). */
export function getUnlockedIncompleteLevels<T extends ApprovalLevelLike>(levels: T[]): T[] {
  if (!levels.length) return [];
  if (isApprovalHierarchySatisfied(levels)) return [];
  return sortApprovalLevels(levels).filter(
    (l) => !l.approvedAt && isApprovalLevelUnlocked(levels, l.level),
  );
}

/** First unlocked incomplete level (for "waiting on Level N" labels). */
export function getCurrentApprovalLevel(
  levels: TravelOrderApprovalLevelStored[] | TravelOrderApprovalLevelDto[],
): TravelOrderApprovalLevelStored | TravelOrderApprovalLevelDto | null {
  const unlocked = getUnlockedIncompleteLevels(levels);
  return unlocked[0] ?? null;
}

/**
 * Hierarchy is complete when every *required* level has approved.
 * Optional seats never finish the chain early — whether they approve or not,
 * all required approvers are still needed. Leftover optional seats may be skipped
 * after the required set is done. If every level is optional, at least one
 * approval is required.
 */
export function isApprovalHierarchySatisfied(levels: ApprovalLevelLike[]): boolean {
  if (levels.length === 0) return false;
  const sorted = sortApprovalLevels(levels);
  const required = sorted.filter((l) => !isApprovalLevelOptional(l));
  if (required.length === 0) {
    return sorted.some((l) => Boolean(l.approvedAt));
  }
  return required.every((l) => Boolean(l.approvedAt));
}

/** @deprecated Prefer isApprovalHierarchySatisfied — kept for call sites. */
export function allApprovalLevelsComplete(levels: ApprovalLevelLike[]): boolean {
  return isApprovalHierarchySatisfied(levels);
}

/** Level the operator should act on (their unlocked incomplete assignment only). */
export function getOperatorActionableApprovalLevel(
  levels: TravelOrderApprovalLevelStored[] | TravelOrderApprovalLevelDto[],
  operatorAgentId: string | null | undefined,
  _opts?: { canAssignWork?: boolean },
): TravelOrderApprovalLevelStored | TravelOrderApprovalLevelDto | null {
  const unlocked = getUnlockedIncompleteLevels(levels);
  if (!unlocked.length || !operatorAgentId) return null;
  return unlocked.find((l) => isApprovalLevelAssignee(l, operatorAgentId)) ?? null;
}

export function isDesignatedApprover(
  operatorAgentId: string | null | undefined,
  order: {
    approvedByAgentId?: string | null;
    approvedByAgentIds?: string[] | null;
    approvalLevels?: Array<{
      agentId?: string | null;
      alternateAgentIds?: string[] | null;
    }> | null;
  },
): boolean {
  if (!operatorAgentId) return false;
  if (hasHierarchicalApprovals(order.approvalLevels)) {
    return (order.approvalLevels ?? []).some((l) => isApprovalLevelAssignee(l, operatorAgentId));
  }
  const ids = parseApprovedByAgentIds(order.approvedByAgentIds, order.approvedByAgentId);
  return ids.includes(operatorAgentId);
}

/** Whether the operator may approve an unlocked pending level (or flat approve). */
export function canApproveTravelOrderNow(
  operatorAgentId: string | null | undefined,
  order: {
    status?: string;
    approvedByAgentId?: string | null;
    approvedByAgentIds?: string[] | null;
    approvalLevels?: TravelOrderApprovalLevelStored[] | TravelOrderApprovalLevelDto[] | null;
  },
  _opts?: { canAssignWork?: boolean },
): boolean {
  if (order.status !== TRAVEL_ORDER_STATUS.SUBMITTED) return false;
  if (!operatorAgentId) return false;
  const levels = order.approvalLevels ?? [];
  if (hasHierarchicalApprovals(levels)) {
    // Only the designated assignee for an unlocked seat may approve — no admin proxy.
    return getOperatorActionableApprovalLevel(levels, operatorAgentId) != null;
  }
  return isDesignatedApprover(operatorAgentId, order);
}

/** Current-level designated approver may reject a submitted travel order. */
export function canRejectTravelOrderNow(
  operatorAgentId: string | null | undefined,
  order: {
    status?: string;
    approvedByAgentId?: string | null;
    approvedByAgentIds?: string[] | null;
    approvalLevels?: TravelOrderApprovalLevelStored[] | TravelOrderApprovalLevelDto[] | null;
  },
  opts?: { canAssignWork?: boolean },
): boolean {
  return canApproveTravelOrderNow(operatorAgentId, order, opts);
}

/** Designated confirmer may confirm or decline confirmation on a running order. */
export function canConfirmTravelOrderNow(
  operatorAgentId: string | null | undefined,
  order: {
    status?: string;
    confirmationByAgentId?: string | null;
  },
  _opts?: { canAssignWork?: boolean },
): boolean {
  if (order.status !== TRAVEL_ORDER_STATUS.APPROVED) return false;
  if (!order.confirmationByAgentId) return false;
  // Only the designated confirmer — no admin proxy.
  return Boolean(operatorAgentId && operatorAgentId === order.confirmationByAgentId);
}

/** Creator may cancel before the order is confirmed, rejected, or already cancelled. */
export function canCancelTravelOrderNow(
  operatorAgentId: string | null | undefined,
  order: {
    status?: string;
    createdByAgentId?: string | null;
  },
): boolean {
  if (!operatorAgentId || !order.createdByAgentId) return false;
  if (operatorAgentId !== order.createdByAgentId) return false;
  return (
    order.status === TRAVEL_ORDER_STATUS.SUBMITTED ||
    order.status === TRAVEL_ORDER_STATUS.APPROVED
  );
}

/**
 * Assigned traveler on a travel order.
 * Uses stored traveler ids; creator is only treated as a traveler for legacy
 * rows that never persisted traveler_agent_ids (empty list).
 */
export function isTravelOrderTraveler(
  operatorAgentId: string | null | undefined,
  order: {
    travelerAgentIds?: string[] | null;
    createdByAgentId?: string | null;
  },
): boolean {
  if (!operatorAgentId) return false;
  const travelers = order.travelerAgentIds ?? [];
  if (travelers.length > 0) {
    return travelers.includes(operatorAgentId);
  }
  return order.createdByAgentId === operatorAgentId;
}

export function parseTravelOrderAttachments(raw: unknown): TaskScreenshotMetaItem[] {
  if (!Array.isArray(raw)) return [];
  const out: TaskScreenshotMetaItem[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const storedFileName = typeof r.storedFileName === "string" ? r.storedFileName.trim() : "";
    if (!storedFileName) continue;
    out.push({
      storedFileName,
      originalName: typeof r.originalName === "string" ? r.originalName : storedFileName,
      mimeType:
        r.mimeType === "image/png" || r.mimeType === "image/jpeg" ? r.mimeType : "image/jpeg",
      size: typeof r.size === "number" && Number.isFinite(r.size) ? r.size : 0,
      uploadedAt: typeof r.uploadedAt === "string" ? r.uploadedAt : new Date().toISOString(),
    });
  }
  return out;
}

/** Parse order-level supporting files (images + documents). */
export function parseTravelOrderFileAttachments(raw: unknown): TravelOrderFileAttachment[] {
  if (!Array.isArray(raw)) return [];
  const out: TravelOrderFileAttachment[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const storedFileName = typeof r.storedFileName === "string" ? r.storedFileName.trim() : "";
    if (!storedFileName || storedFileName.includes("..") || /[/\\]/.test(storedFileName)) {
      continue;
    }
    out.push({
      storedFileName,
      originalName:
        typeof r.originalName === "string" && r.originalName.trim()
          ? r.originalName.trim().slice(0, 200)
          : storedFileName,
      mimeType:
        typeof r.mimeType === "string" && r.mimeType.trim()
          ? r.mimeType.trim()
          : "application/octet-stream",
      size: typeof r.size === "number" && Number.isFinite(r.size) ? r.size : 0,
      uploadedAt: typeof r.uploadedAt === "string" ? r.uploadedAt : new Date().toISOString(),
    });
  }
  return out;
}
