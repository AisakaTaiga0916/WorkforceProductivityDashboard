import { Prisma } from "@prisma/client/primary";
import { prisma } from "@/lib/prisma";
import {
  agentIdsFromApprovalLevels,
  canApproveTravelOrderNow,
  canConfirmTravelOrderNow,
  getOperatorActionableApprovalLevel,
  hasHierarchicalApprovals,
  isApprovalHierarchySatisfied,
  normalizeApprovalLevelsForStore,
  parseApprovedByAgentIds,
  parseApprovalLevels,
  parseTravelerAgentIds,
  parseTravelOrderAttachments,
  parseTravelOrderFileAttachments,
  TRAVEL_ORDER_STATUS,
  type TravelOrderApprovalLevelDto,
  type TravelOrderApprovalLevelStored,
  type TravelOrderAttachment,
  type TravelOrderFileAttachment,
  type TravelOrderAgentRef,
} from "@/lib/travel-order";
import {
  normalizeWorkPlanMetaForStore,
  parseWorkPlanMeta,
  workPlanVenueLabels,
  type WorkPlanMeta,
} from "@/lib/work-plan";

/** Missing/partial travel-order schema must not take down Task Board or nav badges. */
function isMissingTravelOrderSchemaError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /travel_order/i.test(message) &&
    (/does not exist|undefined_table|undefined_column|42P01|42703/i.test(message) ||
      /Raw query failed/i.test(message))
  );
}

async function withTravelOrderFallback<T>(
  label: string,
  fallback: T,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (isMissingTravelOrderSchemaError(error)) {
      console.warn(`[travel-order-db] ${label}: travel order schema unavailable; returning empty.`, error);
      return fallback;
    }
    throw error;
  }
}

export type TravelOrderLocationRow = {
  id: string;
  travelOrderId: string;
  label: string;
  latitude: number | null;
  longitude: number | null;
  checkedAt: Date | null;
  startedAt: Date | null;
  startedLatitude: number | null;
  startedLongitude: number | null;
  endedAt: Date | null;
  endedLatitude: number | null;
  endedLongitude: number | null;
  remarks: string | null;
  attachments: TravelOrderAttachment[];
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
};

export type TravelOrderRow = {
  id: string;
  kpiMaintenanceId: string;
  orderRequest: string;
  workPlanMeta: WorkPlanMeta | null;
  attachments: TravelOrderFileAttachment[];
  status: string;
  approvedByAgentId: string | null;
  approvedByAgentIds: string[];
  approvalLevels: TravelOrderApprovalLevelDto[];
  confirmationByAgentId: string | null;
  createdByAgentId: string | null;
  companyTeamId: string | null;
  travelerAgentIds: string[];
  vehicle: string | null;
  driverPresent: boolean;
  driverAgentId: string | null;
  driverLicenseNo: string | null;
  gatePassIncluded: boolean;
  estDepartureAt: Date | null;
  estArrivalAt: Date | null;
  actualDepartureStartedAt: Date | null;
  actualDepartureStartedLatitude: number | null;
  actualDepartureStartedLongitude: number | null;
  gatePassStartGuardOnDuty: string | null;
  actualDepartureEndedAt: Date | null;
  actualDepartureEndedLatitude: number | null;
  actualDepartureEndedLongitude: number | null;
  gatePassEndGuardOnDuty: string | null;
  rejectionReason: string | null;
  rejectedByAgentId: string | null;
  rejectedAt: Date | null;
  rejectedAtLevel: number | null;
  rejectedByAgent: TravelOrderAgentRef | null;
  kpiPercent: number | null;
  kpiSubmittedAt: Date | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  approvedByAgent: TravelOrderAgentRef | null;
  approvedByAgents: TravelOrderAgentRef[];
  confirmationByAgent: TravelOrderAgentRef | null;
  createdByAgent: TravelOrderAgentRef | null;
  travelers: TravelOrderAgentRef[];
  driverAgent: TravelOrderAgentRef | null;
  locations: TravelOrderLocationRow[];
  /** Optional KPI labels when listed across tasks. */
  kpiTitle?: string | null;
  kpiMainTask?: string | null;
};

type LocationInput = {
  label: string;
  latitude?: number | null;
  longitude?: number | null;
  remarks?: string | null;
  sortOrder: number;
};

function newId() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 25);
}

type RawTravelOrder = {
  id: string;
  kpi_maintenance_id: string;
  order_request: string;
  work_plan_meta?: unknown;
  attachments?: unknown;
  status: string;
  approved_by_agent_id: string | null;
  approved_by_agent_ids: unknown;
  approval_levels: unknown;
  confirmation_by_agent_id: string | null;
  created_by_agent_id: string | null;
  company_team_id: string | null;
  traveler_agent_ids: unknown;
  vehicle: string | null;
  driver_present: boolean | null;
  driver_agent_id: string | null;
  driver_license_no: string | null;
  gate_pass_included: boolean | null;
  est_departure_at: Date | string | null;
  est_arrival_at: Date | string | null;
  actual_departure_started_at: Date | string | null;
  actual_departure_started_latitude: number | null;
  actual_departure_started_longitude: number | null;
  gate_pass_start_guard_on_duty: string | null;
  actual_departure_ended_at: Date | string | null;
  actual_departure_ended_latitude: number | null;
  actual_departure_ended_longitude: number | null;
  gate_pass_end_guard_on_duty: string | null;
  rejection_reason: string | null;
  rejected_by_agent_id: string | null;
  rejected_at: Date | string | null;
  rejected_at_level: number | null;
  kpi_percent: number | null;
  kpi_submitted_at: Date | string | null;
  created_by: string;
  created_at: Date;
  updated_at: Date;
  agent_id: string | null;
  agent_name: string | null;
  agent_email: string | null;
  confirm_agent_id: string | null;
  confirm_agent_name: string | null;
  confirm_agent_email: string | null;
  creator_agent_id: string | null;
  creator_agent_name: string | null;
  creator_agent_email: string | null;
  driver_join_agent_id: string | null;
  driver_join_agent_name: string | null;
  driver_join_agent_email: string | null;
  reject_agent_id: string | null;
  reject_agent_name: string | null;
  reject_agent_email: string | null;
  kpi_title?: string | null;
  kpi_main_task?: string | null;
};

type RawLocation = {
  id: string;
  travel_order_id: string;
  label: string;
  latitude: number | null;
  longitude: number | null;
  checked_at: Date | string | null;
  started_at?: Date | string | null;
  started_latitude?: number | null;
  started_longitude?: number | null;
  ended_at?: Date | string | null;
  ended_latitude?: number | null;
  ended_longitude?: number | null;
  remarks: string | null;
  attachments: unknown;
  sort_order: number;
  created_at: Date;
  updated_at: Date;
};

function asDate(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d : null;
}

/** Prisma `$queryRaw` may return float8 as number, string, or Decimal-like. */
function asCoord(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  if (value && typeof value === "object" && "toNumber" in value) {
    try {
      const n = (value as { toNumber: () => number }).toNumber();
      return typeof n === "number" && Number.isFinite(n) ? n : null;
    } catch {
      return null;
    }
  }
  return null;
}

function mapAgent(
  id: string | null,
  name: string | null,
  email: string | null,
): TravelOrderAgentRef | null {
  if (!id || !name || !email) return null;
  return { id, name, email };
}

function mapOrderBase(
  order: RawTravelOrder,
  locations: RawLocation[],
): TravelOrderRow {
  const approvedByAgentIds = parseApprovedByAgentIds(
    order.approved_by_agent_ids,
    order.approved_by_agent_id,
  );
  const storedLevels = parseApprovalLevels(order.approval_levels);
  const createdByAgentId = order.created_by_agent_id;
  const travelerAgentIds = parseTravelerAgentIds(order.traveler_agent_ids, createdByAgentId);
  const primary = mapAgent(order.agent_id, order.agent_name, order.agent_email);
  const creator = mapAgent(
    order.creator_agent_id,
    order.creator_agent_name,
    order.creator_agent_email,
  );
  return {
    id: order.id,
    kpiMaintenanceId: order.kpi_maintenance_id,
    orderRequest: order.order_request,
    workPlanMeta: parseWorkPlanMeta(order.work_plan_meta),
    attachments: parseTravelOrderFileAttachments(order.attachments),
    status: order.status,
    approvedByAgentId: order.approved_by_agent_id ?? approvedByAgentIds[0] ?? null,
    approvedByAgentIds,
    approvalLevels: storedLevels.map((lvl) => ({
      level: lvl.level,
      agentId: lvl.agentId,
      agent: null,
      approvedAt: lvl.approvedAt,
      approvedByAgentId: lvl.approvedByAgentId,
      approvedByAgent: null,
      optional: lvl.optional === true,
      ...(lvl.alternateAgentIds?.length ? { alternateAgentIds: lvl.alternateAgentIds } : {}),
      ...(lvl.roleCode ? { roleCode: lvl.roleCode } : {}),
      ...(lvl.label ? { label: lvl.label } : {}),
    })),
    confirmationByAgentId: order.confirmation_by_agent_id,
    createdByAgentId,
    companyTeamId: order.company_team_id,
    travelerAgentIds,
    vehicle: typeof order.vehicle === "string" && order.vehicle.trim() ? order.vehicle.trim() : null,
    driverPresent: order.driver_present === true,
    driverAgentId:
      typeof order.driver_agent_id === "string" && order.driver_agent_id.trim()
        ? order.driver_agent_id.trim()
        : null,
    driverLicenseNo:
      typeof order.driver_license_no === "string" && order.driver_license_no.trim()
        ? order.driver_license_no.trim()
        : null,
    gatePassIncluded: order.gate_pass_included === true,
    estDepartureAt: asDate(order.est_departure_at),
    estArrivalAt: asDate(order.est_arrival_at),
    actualDepartureStartedAt: asDate(order.actual_departure_started_at),
    actualDepartureStartedLatitude: asCoord(order.actual_departure_started_latitude),
    actualDepartureStartedLongitude: asCoord(order.actual_departure_started_longitude),
    gatePassStartGuardOnDuty:
      typeof order.gate_pass_start_guard_on_duty === "string" &&
      order.gate_pass_start_guard_on_duty.trim()
        ? order.gate_pass_start_guard_on_duty.trim()
        : null,
    actualDepartureEndedAt: asDate(order.actual_departure_ended_at),
    actualDepartureEndedLatitude: asCoord(order.actual_departure_ended_latitude),
    actualDepartureEndedLongitude: asCoord(order.actual_departure_ended_longitude),
    gatePassEndGuardOnDuty:
      typeof order.gate_pass_end_guard_on_duty === "string" &&
      order.gate_pass_end_guard_on_duty.trim()
        ? order.gate_pass_end_guard_on_duty.trim()
        : null,
    rejectionReason:
      typeof order.rejection_reason === "string" && order.rejection_reason.trim()
        ? order.rejection_reason.trim()
        : null,
    rejectedByAgentId: order.rejected_by_agent_id,
    rejectedAt: asDate(order.rejected_at),
    rejectedAtLevel:
      typeof order.rejected_at_level === "number" && Number.isFinite(order.rejected_at_level)
        ? order.rejected_at_level
        : null,
    rejectedByAgent: mapAgent(
      order.reject_agent_id,
      order.reject_agent_name,
      order.reject_agent_email,
    ),
    kpiPercent:
      typeof order.kpi_percent === "number" && Number.isFinite(order.kpi_percent)
        ? order.kpi_percent
        : null,
    kpiSubmittedAt: asDate(order.kpi_submitted_at),
    createdBy: order.created_by,
    createdAt: order.created_at,
    updatedAt: order.updated_at,
    approvedByAgent: primary,
    approvedByAgents: primary ? [primary] : [],
    confirmationByAgent: mapAgent(
      order.confirm_agent_id,
      order.confirm_agent_name,
      order.confirm_agent_email,
    ),
    createdByAgent: creator,
    travelers: [],
    driverAgent: mapAgent(
      order.driver_join_agent_id,
      order.driver_join_agent_name,
      order.driver_join_agent_email,
    ),
    kpiTitle: order.kpi_title ?? null,
    kpiMainTask: order.kpi_main_task ?? null,
    locations: locations
      .filter((l) => l.travel_order_id === order.id)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((loc) => {
        const startedAt = asDate(loc.started_at ?? null);
        const endedAt = asDate(loc.ended_at ?? null) ?? asDate(loc.checked_at);
        const startedLatitude = asCoord(loc.started_latitude);
        const startedLongitude = asCoord(loc.started_longitude);
        const endedLatitude = asCoord(loc.ended_latitude) ?? asCoord(loc.latitude);
        const endedLongitude = asCoord(loc.ended_longitude) ?? asCoord(loc.longitude);
        return {
          id: loc.id,
          travelOrderId: loc.travel_order_id,
          label: loc.label,
          latitude: endedLatitude,
          longitude: endedLongitude,
          checkedAt: endedAt,
          startedAt,
          startedLatitude,
          startedLongitude,
          endedAt,
          endedLatitude,
          endedLongitude,
          remarks: loc.remarks,
          attachments: parseTravelOrderAttachments(loc.attachments),
          sortOrder: loc.sort_order,
          createdAt: loc.created_at,
          updatedAt: loc.updated_at,
        };
      }),
  };
}

async function hydrateApprovedByAgents(orders: TravelOrderRow[]): Promise<TravelOrderRow[]> {
  const flatIds = orders.flatMap((o) => o.approvedByAgentIds);
  const levelIds = orders.flatMap((o) =>
    o.approvalLevels.flatMap((l) =>
      [
        l.agentId,
        l.approvedByAgentId,
        ...(Array.isArray(l.alternateAgentIds) ? l.alternateAgentIds : []),
      ].filter(Boolean) as string[],
    ),
  );
  const travelerIds = orders.flatMap((o) => o.travelerAgentIds);
  const creatorIds = orders
    .map((o) => o.createdByAgentId)
    .filter((id): id is string => Boolean(id));
  const allIds = [...new Set([...flatIds, ...levelIds, ...travelerIds, ...creatorIds])];
  if (allIds.length === 0) return orders;
  const agents = await prisma.$queryRaw<Array<{ id: string; name: string; email: string }>>`
    SELECT id, name, email FROM agents WHERE id IN (${Prisma.join(allIds)})
  `;
  const byId = new Map(agents.map((a) => [a.id, a] as const));
  return orders.map((order) => {
    const approvedByAgents = order.approvedByAgentIds
      .map((id) => byId.get(id))
      .filter(Boolean) as TravelOrderAgentRef[];
    const approvalLevels: TravelOrderApprovalLevelDto[] = order.approvalLevels.map((lvl) => {
      const alternateAgentIds = Array.isArray(lvl.alternateAgentIds)
        ? lvl.alternateAgentIds.filter(Boolean)
        : [];
      return {
        ...lvl,
        alternateAgentIds,
        alternateAgents: alternateAgentIds
          .map((id) => byId.get(id))
          .filter(Boolean) as TravelOrderAgentRef[],
        agent: lvl.agentId ? (byId.get(lvl.agentId) ?? null) : null,
        approvedByAgent: lvl.approvedByAgentId
          ? (byId.get(lvl.approvedByAgentId) ?? null)
          : null,
      };
    });
    const travelers = order.travelerAgentIds
      .map((id) => byId.get(id))
      .filter(Boolean) as TravelOrderAgentRef[];
    const createdByAgent =
      (order.createdByAgentId ? byId.get(order.createdByAgentId) : null) ??
      order.createdByAgent;
    return {
      ...order,
      approvedByAgents,
      approvedByAgent: approvedByAgents[0] ?? order.approvedByAgent,
      approvedByAgentId: order.approvedByAgentId ?? approvedByAgents[0]?.id ?? null,
      approvalLevels,
      travelers,
      createdByAgent: createdByAgent ?? null,
    };
  });
}

/**
 * Raw SQL helpers — work even when Prisma Client wasn't regenerated for TravelOrder
 * (common on Windows when `query_engine-windows.dll.node` is locked by `next dev`).
 */
export async function createTravelOrderWithLocations(input: {
  kpiMaintenanceId: string;
  orderRequest: string;
  workPlanMeta?: WorkPlanMeta | null;
  approvedByAgentIds: string[];
  approvalLevels?: Array<{
    level?: number;
    agentId?: string | null;
    optional?: boolean;
    alternateAgentIds?: string[] | null;
    roleCode?: string | null;
    label?: string | null;
  }>;
  confirmationByAgentId?: string | null;
  createdBy: string;
  createdByAgentId?: string | null;
  companyTeamId?: string | null;
  travelerAgentIds?: string[];
  vehicle?: string | null;
  driverPresent?: boolean;
  driverAgentId?: string | null;
  driverLicenseNo?: string | null;
  gatePass?: {
    included?: boolean;
    estDepartureAt?: Date | null;
    estArrivalAt?: Date | null;
    actualDepartureStartedAt?: Date | null;
    actualDepartureStartedLatitude?: number | null;
    actualDepartureStartedLongitude?: number | null;
    gatePassStartGuardOnDuty?: string | null;
    actualDepartureEndedAt?: Date | null;
    actualDepartureEndedLatitude?: number | null;
    actualDepartureEndedLongitude?: number | null;
    gatePassEndGuardOnDuty?: string | null;
  } | null;
  status?: string;
  locations: LocationInput[];
}): Promise<TravelOrderRow> {
  const id = newId();
  const status = input.status ?? "SUBMITTED";
  const now = new Date();
  const workPlanMeta = input.workPlanMeta
    ? normalizeWorkPlanMetaForStore(input.workPlanMeta)
    : null;
  const isWorkPlan = workPlanMeta != null;
  const approvalLevels = normalizeApprovalLevelsForStore(input.approvalLevels ?? []);
  const fromLevels = agentIdsFromApprovalLevels(approvalLevels);
  const approvedByAgentIds = [
    ...new Set([
      ...(fromLevels.length > 0
        ? fromLevels
        : input.approvedByAgentIds.map((v) => v.trim()).filter(Boolean)),
    ]),
  ];
  if (approvedByAgentIds.length === 0) {
    throw new Error("At least one approver is required.");
  }
  if (approvalLevels.length > 0) {
    for (const lvl of approvalLevels) {
      if (!lvl.agentId) {
        throw new Error(`Assign an approver for Level ${lvl.level}.`);
      }
    }
  }
  const primaryApproverId = approvedByAgentIds[0]!;
  const includesTravel = Boolean(isWorkPlan && workPlanMeta?.includesTravel);
  const confirmationByAgentId = input.confirmationByAgentId?.trim() || null;
  const createdByAgentId = input.createdByAgentId?.trim() || null;
  const companyTeamId = input.companyTeamId?.trim() || null;
  const travelerAgentIds = isWorkPlan
    ? parseTravelerAgentIds(
        [
          createdByAgentId,
          workPlanMeta.personInChargeAgentId,
          includesTravel ? workPlanMeta.travel?.driverAgentId : null,
        ].filter((v): v is string => Boolean(v)),
        createdByAgentId,
      )
    : parseTravelerAgentIds(input.travelerAgentIds ?? [], createdByAgentId);
  const vehicleFromMeta =
    includesTravel && workPlanMeta.travel?.vehicle?.trim()
      ? workPlanMeta.travel.vehicle.trim()
      : null;
  const vehicle =
    includesTravel || !isWorkPlan
      ? vehicleFromMeta ||
        (typeof input.vehicle === "string" && input.vehicle.trim()
          ? input.vehicle.trim()
          : null)
      : null;
  const driverPresent = includesTravel
    ? workPlanMeta.travel?.driverPresent === true
    : isWorkPlan
      ? false
      : input.driverPresent === true;
  const driverAgentId = driverPresent
    ? (includesTravel
        ? workPlanMeta.travel?.driverAgentId?.trim() || null
        : typeof input.driverAgentId === "string" && input.driverAgentId.trim()
          ? input.driverAgentId.trim()
          : null)
    : null;
  const driverLicenseNo = driverPresent
    ? (includesTravel
        ? workPlanMeta.travel?.driverLicenseNo?.trim() || null
        : typeof input.driverLicenseNo === "string" && input.driverLicenseNo.trim()
          ? input.driverLicenseNo.trim()
          : null)
    : null;
  if (driverPresent) {
    if (!driverAgentId) {
      throw new Error("Select a driver from the travelers list.");
    }
    if (!includesTravel && !travelerAgentIds.includes(driverAgentId)) {
      throw new Error("Driver must be one of the selected travelers.");
    }
  }
  const travelGatePass = includesTravel
    ? {
        included: true,
        estDepartureAt: workPlanMeta.travel?.estDepartureAt?.trim()
          ? new Date(workPlanMeta.travel.estDepartureAt)
          : null,
        estArrivalAt: workPlanMeta.travel?.estArrivalAt?.trim()
          ? new Date(workPlanMeta.travel.estArrivalAt)
          : null,
      }
    : null;
  const gp = isWorkPlan ? travelGatePass : (input.gatePass ?? null);
  const gatePassIncluded = Boolean(gp?.included);
  const estDepartureAt = gatePassIncluded ? (gp?.estDepartureAt ?? null) : null;
  const estArrivalAt = gatePassIncluded ? (gp?.estArrivalAt ?? null) : null;
  const actualDepartureStartedAt = gatePassIncluded
    ? (gp?.actualDepartureStartedAt ?? null)
    : null;
  const actualDepartureStartedLatitude = gatePassIncluded
    ? (gp?.actualDepartureStartedLatitude ?? null)
    : null;
  const actualDepartureStartedLongitude = gatePassIncluded
    ? (gp?.actualDepartureStartedLongitude ?? null)
    : null;
  const actualDepartureEndedAt = gatePassIncluded ? (gp?.actualDepartureEndedAt ?? null) : null;
  const actualDepartureEndedLatitude = gatePassIncluded
    ? (gp?.actualDepartureEndedLatitude ?? null)
    : null;
  const actualDepartureEndedLongitude = gatePassIncluded
    ? (gp?.actualDepartureEndedLongitude ?? null)
    : null;
  const gatePassStartGuardOnDuty = gatePassIncluded
    ? typeof gp?.gatePassStartGuardOnDuty === "string" && gp.gatePassStartGuardOnDuty.trim()
      ? gp.gatePassStartGuardOnDuty.trim()
      : null
    : null;
  const gatePassEndGuardOnDuty = gatePassIncluded
    ? typeof gp?.gatePassEndGuardOnDuty === "string" && gp.gatePassEndGuardOnDuty.trim()
      ? gp.gatePassEndGuardOnDuty.trim()
      : null
    : null;

  await prisma.$executeRaw`
    INSERT INTO travel_orders (
      id, kpi_maintenance_id, order_request, work_plan_meta, attachments, status,
      approved_by_agent_id, approved_by_agent_ids, approval_levels, confirmation_by_agent_id,
      created_by_agent_id, company_team_id, traveler_agent_ids, vehicle,
      driver_present, driver_agent_id, driver_license_no,
      gate_pass_included, est_departure_at, est_arrival_at,
      actual_departure_started_at, actual_departure_started_latitude, actual_departure_started_longitude,
      gate_pass_start_guard_on_duty,
      actual_departure_ended_at, actual_departure_ended_latitude, actual_departure_ended_longitude,
      gate_pass_end_guard_on_duty,
      created_by, created_at, updated_at
    ) VALUES (
      ${id},
      ${input.kpiMaintenanceId},
      ${input.orderRequest},
      ${workPlanMeta ? JSON.stringify(workPlanMeta) : null}::jsonb,
      ${JSON.stringify([])}::jsonb,
      ${status},
      ${primaryApproverId},
      ${JSON.stringify(approvedByAgentIds)}::jsonb,
      ${JSON.stringify(approvalLevels)}::jsonb,
      ${confirmationByAgentId},
      ${createdByAgentId},
      ${companyTeamId},
      ${JSON.stringify(travelerAgentIds)}::jsonb,
      ${vehicle},
      ${driverPresent},
      ${driverAgentId},
      ${driverLicenseNo},
      ${gatePassIncluded},
      ${estDepartureAt},
      ${estArrivalAt},
      ${actualDepartureStartedAt},
      ${actualDepartureStartedLatitude},
      ${actualDepartureStartedLongitude},
      ${gatePassStartGuardOnDuty},
      ${actualDepartureEndedAt},
      ${actualDepartureEndedLatitude},
      ${actualDepartureEndedLongitude},
      ${gatePassEndGuardOnDuty},
      ${input.createdBy},
      ${now},
      ${now}
    )
  `;

  const locationInputs =
    isWorkPlan && workPlanMeta
      ? workPlanVenueLabels(workPlanMeta).map((label, i) => ({
          label,
          latitude: null as number | null,
          longitude: null as number | null,
          remarks: null as string | null,
          sortOrder: i,
        }))
      : input.locations;
  if (locationInputs.length > 0) {
    for (const loc of locationInputs) {
      const locId = newId();
      await prisma.$executeRaw`
        INSERT INTO travel_order_locations (
          id, travel_order_id, label, latitude, longitude,
          remarks, attachments, sort_order, created_at, updated_at
        ) VALUES (
          ${locId},
          ${id},
          ${loc.label},
          ${loc.latitude ?? null},
          ${loc.longitude ?? null},
          ${loc.remarks ?? null},
          ${JSON.stringify([])}::jsonb,
          ${loc.sortOrder},
          ${now},
          ${now}
        )
      `;
    }
  }

  const created = await findTravelOrderById(id);
  if (!created) {
    throw new Error("Travel order was inserted but could not be reloaded.");
  }
  return created;
}

export async function findTravelOrdersByKpiId(
  kpiMaintenanceId: string
): Promise<TravelOrderRow[]> {
  const orders = await prisma.$queryRaw<RawTravelOrder[]>`
    SELECT
      t.id,
      t.kpi_maintenance_id,
      t.order_request,
      t.work_plan_meta,
      COALESCE(t.attachments, '[]'::jsonb) AS attachments,
      t.status,
      t.approved_by_agent_id,
      t.approved_by_agent_ids,
      COALESCE(t.approval_levels, '[]'::jsonb) AS approval_levels,
      t.confirmation_by_agent_id,
      t.created_by_agent_id,
      t.company_team_id,
      COALESCE(t.traveler_agent_ids, '[]'::jsonb) AS traveler_agent_ids,
      t.vehicle,
      COALESCE(t.driver_present, false) AS driver_present,
      t.driver_agent_id,
      t.driver_license_no,
      COALESCE(t.gate_pass_included, false) AS gate_pass_included,
      t.est_departure_at,
      t.est_arrival_at,
      t.actual_departure_started_at,
      t.actual_departure_started_latitude,
      t.actual_departure_started_longitude,
      t.gate_pass_start_guard_on_duty,
      t.actual_departure_ended_at,
      t.actual_departure_ended_latitude,
      t.actual_departure_ended_longitude,
      t.gate_pass_end_guard_on_duty,
      t.rejection_reason,
      t.rejected_by_agent_id,
      t.rejected_at,
      t.rejected_at_level,
      t.kpi_percent,
      t.kpi_submitted_at,
      t.created_by,
      t.created_at,
      t.updated_at,
      a.id AS agent_id,
      a.name AS agent_name,
      a.email AS agent_email,
      c.id AS confirm_agent_id,
      c.name AS confirm_agent_name,
      c.email AS confirm_agent_email,
      cr.id AS creator_agent_id,
      cr.name AS creator_agent_name,
      cr.email AS creator_agent_email,
      dr.id AS driver_join_agent_id,
      dr.name AS driver_join_agent_name,
      dr.email AS driver_join_agent_email,
      rj.id AS reject_agent_id,
      rj.name AS reject_agent_name,
      rj.email AS reject_agent_email
    FROM travel_orders t
    LEFT JOIN agents a ON a.id = t.approved_by_agent_id
    LEFT JOIN agents c ON c.id = t.confirmation_by_agent_id
    LEFT JOIN agents cr ON cr.id = t.created_by_agent_id
    LEFT JOIN agents dr ON dr.id = t.driver_agent_id
    LEFT JOIN agents rj ON rj.id = t.rejected_by_agent_id
    WHERE t.kpi_maintenance_id = ${kpiMaintenanceId}
    ORDER BY t.created_at DESC
  `;

  if (orders.length === 0) return [];

  const ids = orders.map((o) => o.id);
  const locations =
    ids.length === 0
      ? []
      : await prisma.$queryRaw<RawLocation[]>`
          SELECT * FROM travel_order_locations
          WHERE travel_order_id IN (${Prisma.join(ids)})
          ORDER BY sort_order ASC
        `;

  return hydrateApprovedByAgents(orders.map((o) => mapOrderBase(o, locations)));
}

export async function findTravelOrderById(
  travelOrderId: string
): Promise<TravelOrderRow | null> {
  const orders = await prisma.$queryRaw<RawTravelOrder[]>`
    SELECT
      t.id,
      t.kpi_maintenance_id,
      t.order_request,
      t.work_plan_meta,
      COALESCE(t.attachments, '[]'::jsonb) AS attachments,
      t.status,
      t.approved_by_agent_id,
      t.approved_by_agent_ids,
      COALESCE(t.approval_levels, '[]'::jsonb) AS approval_levels,
      t.confirmation_by_agent_id,
      t.created_by_agent_id,
      t.company_team_id,
      COALESCE(t.traveler_agent_ids, '[]'::jsonb) AS traveler_agent_ids,
      t.vehicle,
      COALESCE(t.driver_present, false) AS driver_present,
      t.driver_agent_id,
      t.driver_license_no,
      COALESCE(t.gate_pass_included, false) AS gate_pass_included,
      t.est_departure_at,
      t.est_arrival_at,
      t.actual_departure_started_at,
      t.actual_departure_started_latitude,
      t.actual_departure_started_longitude,
      t.gate_pass_start_guard_on_duty,
      t.actual_departure_ended_at,
      t.actual_departure_ended_latitude,
      t.actual_departure_ended_longitude,
      t.gate_pass_end_guard_on_duty,
      t.rejection_reason,
      t.rejected_by_agent_id,
      t.rejected_at,
      t.rejected_at_level,
      t.kpi_percent,
      t.kpi_submitted_at,
      t.created_by,
      t.created_at,
      t.updated_at,
      a.id AS agent_id,
      a.name AS agent_name,
      a.email AS agent_email,
      c.id AS confirm_agent_id,
      c.name AS confirm_agent_name,
      c.email AS confirm_agent_email,
      cr.id AS creator_agent_id,
      cr.name AS creator_agent_name,
      cr.email AS creator_agent_email,
      dr.id AS driver_join_agent_id,
      dr.name AS driver_join_agent_name,
      dr.email AS driver_join_agent_email,
      rj.id AS reject_agent_id,
      rj.name AS reject_agent_name,
      rj.email AS reject_agent_email
    FROM travel_orders t
    LEFT JOIN agents a ON a.id = t.approved_by_agent_id
    LEFT JOIN agents c ON c.id = t.confirmation_by_agent_id
    LEFT JOIN agents cr ON cr.id = t.created_by_agent_id
    LEFT JOIN agents dr ON dr.id = t.driver_agent_id
    LEFT JOIN agents rj ON rj.id = t.rejected_by_agent_id
    WHERE t.id = ${travelOrderId}
    LIMIT 1
  `;
  const order = orders[0];
  if (!order) return null;

  const locations = await prisma.$queryRaw<RawLocation[]>`
    SELECT * FROM travel_order_locations
    WHERE travel_order_id = ${travelOrderId}
    ORDER BY sort_order ASC
  `;

  const [hydrated] = await hydrateApprovedByAgents([mapOrderBase(order, locations)]);
  return hydrated ?? null;
}

/** Company-scoped travel order list (Field Assignment board). */
export async function findTravelOrdersByCompanyTeamId(
  companyTeamId: string,
): Promise<TravelOrderRow[]> {
  return findTravelOrdersVisibleToAgent({ companyTeamId, agentId: null });
}

/**
 * Travel orders visible to an agent (no company-wide dump):
 * - Requestor (creator) or listed traveler / driver
 * - Designated approver (flat or any hierarchical seat) or confirmer
 *
 * Personnel-Guard (`gatePassOnly`): site-wide kiosk list of running (APPROVED)
 * trips. Guards are often not travelers and may lack a merged company match, so
 * company/personal visibility is not applied.
 */
export async function findTravelOrdersVisibleToAgent(input: {
  companyTeamId: string | null;
  agentId: string | null;
  /**
   * When true (Personnel-Guard), list all APPROVED (running) travel orders for
   * Gate Pass capture — not limited to gate_pass_included or company membership.
   */
  gatePassOnly?: boolean;
  /**
   * When true, bypass company/agent scoping entirely (platform-wide list for
   * elevated admins such as SuperAdmin who may have no agent or company row).
   */
  allVisible?: boolean;
}): Promise<TravelOrderRow[]> {
  const companyTeamId = input.companyTeamId?.trim() || null;
  const agentId = input.agentId?.trim() || null;
  if (!input.gatePassOnly && !input.allVisible && !companyTeamId && !agentId) return [];

  return withTravelOrderFallback("findTravelOrdersVisibleToAgent", [], async () => {
  const selectSql = Prisma.sql`
    SELECT
      t.id,
      t.kpi_maintenance_id,
      t.order_request,
      t.work_plan_meta,
      COALESCE(t.attachments, '[]'::jsonb) AS attachments,
      t.status,
      t.approved_by_agent_id,
      t.approved_by_agent_ids,
      COALESCE(t.approval_levels, '[]'::jsonb) AS approval_levels,
      t.confirmation_by_agent_id,
      t.created_by_agent_id,
      t.company_team_id,
      COALESCE(t.traveler_agent_ids, '[]'::jsonb) AS traveler_agent_ids,
      t.vehicle,
      COALESCE(t.driver_present, false) AS driver_present,
      t.driver_agent_id,
      t.driver_license_no,
      COALESCE(t.gate_pass_included, false) AS gate_pass_included,
      t.est_departure_at,
      t.est_arrival_at,
      t.actual_departure_started_at,
      t.actual_departure_started_latitude,
      t.actual_departure_started_longitude,
      t.gate_pass_start_guard_on_duty,
      t.actual_departure_ended_at,
      t.actual_departure_ended_latitude,
      t.actual_departure_ended_longitude,
      t.gate_pass_end_guard_on_duty,
      t.rejection_reason,
      t.rejected_by_agent_id,
      t.rejected_at,
      t.rejected_at_level,
      t.kpi_percent,
      t.kpi_submitted_at,
      t.created_by,
      t.created_at,
      t.updated_at,
      a.id AS agent_id,
      a.name AS agent_name,
      a.email AS agent_email,
      c.id AS confirm_agent_id,
      c.name AS confirm_agent_name,
      c.email AS confirm_agent_email,
      cr.id AS creator_agent_id,
      cr.name AS creator_agent_name,
      cr.email AS creator_agent_email,
      dr.id AS driver_join_agent_id,
      dr.name AS driver_join_agent_name,
      dr.email AS driver_join_agent_email,
      rj.id AS reject_agent_id,
      rj.name AS reject_agent_name,
      rj.email AS reject_agent_email,
      k.title AS kpi_title,
      k.main_task AS kpi_main_task
    FROM travel_orders t
    LEFT JOIN agents a ON a.id = t.approved_by_agent_id
    LEFT JOIN agents c ON c.id = t.confirmation_by_agent_id
    LEFT JOIN agents cr ON cr.id = t.created_by_agent_id
    LEFT JOIN agents dr ON dr.id = t.driver_agent_id
    LEFT JOIN agents rj ON rj.id = t.rejected_by_agent_id
    LEFT JOIN kpi_maintenance k ON k.id = t.kpi_maintenance_id
  `;

  let whereSql: Prisma.Sql;
  if (input.gatePassOnly) {
    // Gate kiosk: every running trip is eligible for Gate Pass Start/End.
    whereSql = Prisma.sql`t.status = ${TRAVEL_ORDER_STATUS.APPROVED}`;
  } else if (input.allVisible) {
    // Platform-wide view (SuperAdmin / elevated admin without company scope).
    whereSql = Prisma.sql`TRUE`;
  } else if (agentId) {
    // Stakeholder scope only — not every order in the company.
    whereSql = Prisma.sql`(
      t.created_by_agent_id = ${agentId}
      OR t.approved_by_agent_id = ${agentId}
      OR t.confirmation_by_agent_id = ${agentId}
      OR t.driver_agent_id = ${agentId}
      OR t.traveler_agent_ids @> ${JSON.stringify([agentId])}::jsonb
      OR t.approved_by_agent_ids @> ${JSON.stringify([agentId])}::jsonb
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements(COALESCE(t.approval_levels, '[]'::jsonb)) AS lvl
        WHERE COALESCE(lvl->>'agentId', '') = ${agentId}
      )
    )`;
  } else if (companyTeamId) {
    // Legacy company-only helper (`findTravelOrdersByCompanyTeamId`).
    whereSql = Prisma.sql`t.company_team_id = ${companyTeamId}`;
  } else {
    whereSql = Prisma.sql`FALSE`;
  }

  const orders = await prisma.$queryRaw<RawTravelOrder[]>`
    ${selectSql}
    WHERE ${whereSql}
    ORDER BY t.created_at DESC
  `;

  if (orders.length === 0) return [];

  const ids = orders.map((o) => o.id);
  const locations = await prisma.$queryRaw<RawLocation[]>`
    SELECT * FROM travel_order_locations
    WHERE travel_order_id IN (${Prisma.join(ids)})
    ORDER BY sort_order ASC
  `;

  return hydrateApprovedByAgents(orders.map((o) => mapOrderBase(o, locations)));
  });
}

/**
 * SUBMITTED travel orders waiting on this agent to approve
 * (current hierarchical level, or flat designated approver list).
 */
export async function listPendingTravelApprovalsForAgent(
  agentId: string,
): Promise<TravelOrderRow[]> {
  const id = typeof agentId === "string" ? agentId.trim() : "";
  if (!id) return [];

  return withTravelOrderFallback("listPendingTravelApprovalsForAgent", [], async () => {
  const orders = await prisma.$queryRaw<RawTravelOrder[]>`
    SELECT
      t.id,
      t.kpi_maintenance_id,
      t.order_request,
      t.work_plan_meta,
      COALESCE(t.attachments, '[]'::jsonb) AS attachments,
      t.status,
      t.approved_by_agent_id,
      t.approved_by_agent_ids,
      COALESCE(t.approval_levels, '[]'::jsonb) AS approval_levels,
      t.confirmation_by_agent_id,
      t.created_by_agent_id,
      t.company_team_id,
      COALESCE(t.traveler_agent_ids, '[]'::jsonb) AS traveler_agent_ids,
      t.vehicle,
      COALESCE(t.driver_present, false) AS driver_present,
      t.driver_agent_id,
      t.driver_license_no,
      COALESCE(t.gate_pass_included, false) AS gate_pass_included,
      t.est_departure_at,
      t.est_arrival_at,
      t.actual_departure_started_at,
      t.actual_departure_started_latitude,
      t.actual_departure_started_longitude,
      t.gate_pass_start_guard_on_duty,
      t.actual_departure_ended_at,
      t.actual_departure_ended_latitude,
      t.actual_departure_ended_longitude,
      t.gate_pass_end_guard_on_duty,
      t.rejection_reason,
      t.rejected_by_agent_id,
      t.rejected_at,
      t.rejected_at_level,
      t.kpi_percent,
      t.kpi_submitted_at,
      t.created_by,
      t.created_at,
      t.updated_at,
      a.id AS agent_id,
      a.name AS agent_name,
      a.email AS agent_email,
      c.id AS confirm_agent_id,
      c.name AS confirm_agent_name,
      c.email AS confirm_agent_email,
      cr.id AS creator_agent_id,
      cr.name AS creator_agent_name,
      cr.email AS creator_agent_email,
      dr.id AS driver_join_agent_id,
      dr.name AS driver_join_agent_name,
      dr.email AS driver_join_agent_email,
      rj.id AS reject_agent_id,
      rj.name AS reject_agent_name,
      rj.email AS reject_agent_email,
      k.title AS kpi_title,
      k.main_task AS kpi_main_task
    FROM travel_orders t
    LEFT JOIN agents a ON a.id = t.approved_by_agent_id
    LEFT JOIN agents c ON c.id = t.confirmation_by_agent_id
    LEFT JOIN agents cr ON cr.id = t.created_by_agent_id
    LEFT JOIN agents dr ON dr.id = t.driver_agent_id
    LEFT JOIN agents rj ON rj.id = t.rejected_by_agent_id
    LEFT JOIN kpi_maintenance k ON k.id = t.kpi_maintenance_id
    WHERE t.status = ${TRAVEL_ORDER_STATUS.SUBMITTED}
      AND (
        t.approved_by_agent_id = ${id}
        OR t.approved_by_agent_ids @> ${JSON.stringify([id])}::jsonb
        OR t.approval_levels @> ${JSON.stringify([{ agentId: id }])}::jsonb
      )
    ORDER BY t.updated_at DESC
    LIMIT 100
  `;

  if (orders.length === 0) return [];

  const ids = orders.map((o) => o.id);
  const locations = await prisma.$queryRaw<RawLocation[]>`
    SELECT * FROM travel_order_locations
    WHERE travel_order_id IN (${Prisma.join(ids)})
    ORDER BY sort_order ASC
  `;

  const hydrated = await hydrateApprovedByAgents(orders.map((o) => mapOrderBase(o, locations)));
  return hydrated.filter((order) =>
    canApproveTravelOrderNow(id, order, { canAssignWork: false }),
  );
  });
}

export async function countPendingTravelApprovalsForAgent(agentId: string): Promise<number> {
  const rows = await listPendingTravelApprovalsForAgent(agentId);
  return rows.length;
}

/**
 * APPROVED travel orders waiting on this agent to confirm
 * (only the designated confirmer — no admin proxy).
 */
export async function listPendingTravelConfirmationsForAgent(
  agentId: string,
): Promise<TravelOrderRow[]> {
  const id = typeof agentId === "string" ? agentId.trim() : "";
  if (!id) return [];

  return withTravelOrderFallback("listPendingTravelConfirmationsForAgent", [], async () => {
    const orders = await prisma.$queryRaw<RawTravelOrder[]>`
      SELECT
        t.id,
        t.kpi_maintenance_id,
        t.order_request,
      t.work_plan_meta,
        COALESCE(t.attachments, '[]'::jsonb) AS attachments,
        t.status,
        t.approved_by_agent_id,
        t.approved_by_agent_ids,
        COALESCE(t.approval_levels, '[]'::jsonb) AS approval_levels,
        t.confirmation_by_agent_id,
        t.created_by_agent_id,
        t.company_team_id,
        COALESCE(t.traveler_agent_ids, '[]'::jsonb) AS traveler_agent_ids,
        t.vehicle,
        COALESCE(t.driver_present, false) AS driver_present,
        t.driver_agent_id,
        t.driver_license_no,
        COALESCE(t.gate_pass_included, false) AS gate_pass_included,
        t.est_departure_at,
        t.est_arrival_at,
        t.actual_departure_started_at,
        t.actual_departure_started_latitude,
        t.actual_departure_started_longitude,
        t.gate_pass_start_guard_on_duty,
        t.actual_departure_ended_at,
        t.actual_departure_ended_latitude,
        t.actual_departure_ended_longitude,
        t.gate_pass_end_guard_on_duty,
        t.rejection_reason,
        t.rejected_by_agent_id,
        t.rejected_at,
        t.rejected_at_level,
        t.kpi_percent,
        t.kpi_submitted_at,
        t.created_by,
        t.created_at,
        t.updated_at,
        a.id AS agent_id,
        a.name AS agent_name,
        a.email AS agent_email,
        c.id AS confirm_agent_id,
        c.name AS confirm_agent_name,
        c.email AS confirm_agent_email,
        cr.id AS creator_agent_id,
        cr.name AS creator_agent_name,
        cr.email AS creator_agent_email,
        dr.id AS driver_join_agent_id,
        dr.name AS driver_join_agent_name,
        dr.email AS driver_join_agent_email,
        rj.id AS reject_agent_id,
        rj.name AS reject_agent_name,
        rj.email AS reject_agent_email,
        k.title AS kpi_title,
        k.main_task AS kpi_main_task
      FROM travel_orders t
      LEFT JOIN agents a ON a.id = t.approved_by_agent_id
      LEFT JOIN agents c ON c.id = t.confirmation_by_agent_id
      LEFT JOIN agents cr ON cr.id = t.created_by_agent_id
      LEFT JOIN agents dr ON dr.id = t.driver_agent_id
      LEFT JOIN agents rj ON rj.id = t.rejected_by_agent_id
      LEFT JOIN kpi_maintenance k ON k.id = t.kpi_maintenance_id
      WHERE t.status = ${TRAVEL_ORDER_STATUS.APPROVED}
        AND t.confirmation_by_agent_id = ${id}
      ORDER BY t.updated_at DESC
      LIMIT 100
    `;

    if (orders.length === 0) return [];

    const ids = orders.map((o) => o.id);
    const locations = await prisma.$queryRaw<RawLocation[]>`
      SELECT * FROM travel_order_locations
      WHERE travel_order_id IN (${Prisma.join(ids)})
      ORDER BY sort_order ASC
    `;

    const hydrated = await hydrateApprovedByAgents(orders.map((o) => mapOrderBase(o, locations)));
    return hydrated.filter((order) => canConfirmTravelOrderNow(id, order));
  });
}

export async function countPendingTravelConfirmationsForAgent(agentId: string): Promise<number> {
  const rows = await listPendingTravelConfirmationsForAgent(agentId);
  return rows.length;
}

export async function travelOrderExistsForKpi(
  travelOrderId: string,
  kpiMaintenanceId: string
): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM travel_orders
    WHERE id = ${travelOrderId} AND kpi_maintenance_id = ${kpiMaintenanceId}
    LIMIT 1
  `;
  return rows.length > 0;
}

export async function updateTravelOrderLocationAttachments(
  locationId: string,
  attachments: TravelOrderAttachment[]
): Promise<void> {
  const now = new Date();
  await prisma.$executeRaw`
    UPDATE travel_order_locations
    SET
      attachments = ${JSON.stringify(attachments)}::jsonb,
      updated_at = ${now}
    WHERE id = ${locationId}
  `;
}

export async function updateTravelOrderAttachments(
  travelOrderId: string,
  attachments: TravelOrderFileAttachment[],
): Promise<void> {
  const now = new Date();
  await prisma.$executeRaw`
    UPDATE travel_orders
    SET
      attachments = ${JSON.stringify(attachments)}::jsonb,
      updated_at = ${now}
    WHERE id = ${travelOrderId}
  `;
}

export async function updateTravelOrderGatePass(input: {
  travelOrderId: string;
  kpiMaintenanceId: string;
  included: boolean;
  estDepartureAt?: Date | null;
  estArrivalAt?: Date | null;
  actualDepartureStartedAt?: Date | null;
  actualDepartureStartedLatitude?: number | null;
  actualDepartureStartedLongitude?: number | null;
  gatePassStartGuardOnDuty?: string | null;
  actualDepartureEndedAt?: Date | null;
  actualDepartureEndedLatitude?: number | null;
  actualDepartureEndedLongitude?: number | null;
  gatePassEndGuardOnDuty?: string | null;
  /** When set, only patches Start or End actual departure (keeps other fields). */
  visitAction?: "start" | "end" | null;
}): Promise<TravelOrderRow | null> {
  const now = new Date();
  const order = await findTravelOrderById(input.travelOrderId);
  if (!order || order.kpiMaintenanceId !== input.kpiMaintenanceId) return null;

  const normalizeGuard = (value: string | null | undefined): string | null => {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed || null;
  };

  if (input.visitAction === "start") {
    if (order.actualDepartureStartedAt) {
      throw new Error("Actual departure Start was already captured.");
    }
    const startedAt = input.actualDepartureStartedAt ?? now;
    const startGuard =
      input.gatePassStartGuardOnDuty !== undefined
        ? normalizeGuard(input.gatePassStartGuardOnDuty)
        : order.gatePassStartGuardOnDuty;
    await prisma.$executeRaw`
      UPDATE travel_orders
      SET
        gate_pass_included = true,
        actual_departure_started_at = ${startedAt},
        actual_departure_started_latitude = ${input.actualDepartureStartedLatitude ?? null},
        actual_departure_started_longitude = ${input.actualDepartureStartedLongitude ?? null},
        gate_pass_start_guard_on_duty = ${startGuard},
        updated_at = ${now}
      WHERE id = ${input.travelOrderId}
        AND kpi_maintenance_id = ${input.kpiMaintenanceId}
    `;
    return findTravelOrderById(input.travelOrderId);
  }

  if (input.visitAction === "end") {
    if (!order.actualDepartureStartedAt) {
      throw new Error("Press Start before End for actual departure.");
    }
    if (order.actualDepartureEndedAt) {
      throw new Error("Actual departure End was already captured.");
    }
    const endedAt = input.actualDepartureEndedAt ?? now;
    const endGuard =
      input.gatePassEndGuardOnDuty !== undefined
        ? normalizeGuard(input.gatePassEndGuardOnDuty)
        : order.gatePassEndGuardOnDuty;
    await prisma.$executeRaw`
      UPDATE travel_orders
      SET
        gate_pass_included = true,
        actual_departure_ended_at = ${endedAt},
        actual_departure_ended_latitude = ${input.actualDepartureEndedLatitude ?? null},
        actual_departure_ended_longitude = ${input.actualDepartureEndedLongitude ?? null},
        gate_pass_end_guard_on_duty = ${endGuard},
        updated_at = ${now}
      WHERE id = ${input.travelOrderId}
        AND kpi_maintenance_id = ${input.kpiMaintenanceId}
    `;
    return findTravelOrderById(input.travelOrderId);
  }

  if (!input.included) {
    await prisma.$executeRaw`
      UPDATE travel_orders
      SET
        gate_pass_included = false,
        est_departure_at = NULL,
        est_arrival_at = NULL,
        actual_departure_started_at = NULL,
        actual_departure_started_latitude = NULL,
        actual_departure_started_longitude = NULL,
        gate_pass_start_guard_on_duty = NULL,
        actual_departure_ended_at = NULL,
        actual_departure_ended_latitude = NULL,
        actual_departure_ended_longitude = NULL,
        gate_pass_end_guard_on_duty = NULL,
        updated_at = ${now}
      WHERE id = ${input.travelOrderId}
        AND kpi_maintenance_id = ${input.kpiMaintenanceId}
    `;
    return findTravelOrderById(input.travelOrderId);
  }

  await prisma.$executeRaw`
    UPDATE travel_orders
    SET
      gate_pass_included = true,
      est_departure_at = ${input.estDepartureAt ?? null},
      est_arrival_at = ${input.estArrivalAt ?? null},
      actual_departure_started_at = ${
        input.actualDepartureStartedAt != null
          ? input.actualDepartureStartedAt
          : order.actualDepartureStartedAt
      },
      actual_departure_started_latitude = ${
        input.actualDepartureStartedLatitude != null
          ? input.actualDepartureStartedLatitude
          : order.actualDepartureStartedLatitude
      },
      actual_departure_started_longitude = ${
        input.actualDepartureStartedLongitude != null
          ? input.actualDepartureStartedLongitude
          : order.actualDepartureStartedLongitude
      },
      gate_pass_start_guard_on_duty = ${
        input.gatePassStartGuardOnDuty !== undefined
          ? normalizeGuard(input.gatePassStartGuardOnDuty)
          : order.gatePassStartGuardOnDuty
      },
      actual_departure_ended_at = ${
        input.actualDepartureEndedAt != null
          ? input.actualDepartureEndedAt
          : order.actualDepartureEndedAt
      },
      actual_departure_ended_latitude = ${
        input.actualDepartureEndedLatitude != null
          ? input.actualDepartureEndedLatitude
          : order.actualDepartureEndedLatitude
      },
      actual_departure_ended_longitude = ${
        input.actualDepartureEndedLongitude != null
          ? input.actualDepartureEndedLongitude
          : order.actualDepartureEndedLongitude
      },
      gate_pass_end_guard_on_duty = ${
        input.gatePassEndGuardOnDuty !== undefined
          ? normalizeGuard(input.gatePassEndGuardOnDuty)
          : order.gatePassEndGuardOnDuty
      },
      updated_at = ${now}
    WHERE id = ${input.travelOrderId}
      AND kpi_maintenance_id = ${input.kpiMaintenanceId}
  `;
  return findTravelOrderById(input.travelOrderId);
}

export async function updateTravelOrderStatus(input: {
  travelOrderId: string;
  kpiMaintenanceId: string;
  status: string;
  rejectionReason?: string | null;
  rejectedByAgentId?: string | null;
  rejectedAtLevel?: number | null;
}): Promise<TravelOrderRow | null> {
  const now = new Date();
  const rejectionReason =
    typeof input.rejectionReason === "string" && input.rejectionReason.trim()
      ? input.rejectionReason.trim()
      : null;
  const rejectedByAgentId = input.rejectedByAgentId?.trim() || null;
  const rejectedAtLevel =
    typeof input.rejectedAtLevel === "number" && Number.isFinite(input.rejectedAtLevel)
      ? Math.floor(input.rejectedAtLevel)
      : null;
  if (input.status === TRAVEL_ORDER_STATUS.REJECTED) {
    await prisma.$executeRaw`
      UPDATE travel_orders
      SET status = ${input.status},
          rejection_reason = ${rejectionReason},
          rejected_by_agent_id = ${rejectedByAgentId},
          rejected_at = ${now},
          rejected_at_level = ${rejectedAtLevel},
          updated_at = ${now}
      WHERE id = ${input.travelOrderId}
        AND kpi_maintenance_id = ${input.kpiMaintenanceId}
    `;
  } else {
    await prisma.$executeRaw`
      UPDATE travel_orders
      SET status = ${input.status}, updated_at = ${now}
      WHERE id = ${input.travelOrderId}
        AND kpi_maintenance_id = ${input.kpiMaintenanceId}
    `;
  }
  return findTravelOrderById(input.travelOrderId);
}

/**
 * Approve the current pending level (hierarchical) or fully approve (flat).
 * Returns the updated order, or throws with a user-facing message.
 */
export async function approveTravelOrderSequential(input: {
  travelOrderId: string;
  kpiMaintenanceId: string;
  operatorAgentId: string | null;
  canAssignWork: boolean;
}): Promise<TravelOrderRow> {
  const order = await findTravelOrderById(input.travelOrderId);
  if (!order || order.kpiMaintenanceId !== input.kpiMaintenanceId) {
    throw new Error("Travel order not found.");
  }
  if (order.status !== TRAVEL_ORDER_STATUS.SUBMITTED) {
    throw new Error("Only a submitted travel order can be approved.");
  }

  const stored: TravelOrderApprovalLevelStored[] = order.approvalLevels.map((l) => ({
    level: l.level,
    agentId: l.agentId,
    approvedAt: l.approvedAt,
    approvedByAgentId: l.approvedByAgentId,
    optional: l.optional === true,
    ...(l.alternateAgentIds?.length ? { alternateAgentIds: l.alternateAgentIds } : {}),
    ...(l.roleCode ? { roleCode: l.roleCode } : {}),
    ...(l.label ? { label: l.label } : {}),
  }));

  if (!hasHierarchicalApprovals(stored)) {
    const ids = parseApprovedByAgentIds(order.approvedByAgentIds, order.approvedByAgentId);
    if (!input.operatorAgentId || !ids.includes(input.operatorAgentId)) {
      throw new Error("Only a designated approver can approve this travel order.");
    }
    const updated = await updateTravelOrderStatus({
      travelOrderId: input.travelOrderId,
      kpiMaintenanceId: input.kpiMaintenanceId,
      status: TRAVEL_ORDER_STATUS.APPROVED,
    });
    if (!updated) throw new Error("Travel order could not be updated.");
    return updated;
  }

  const target = getOperatorActionableApprovalLevel(stored, input.operatorAgentId);
  if (!target) {
    if (isApprovalHierarchySatisfied(stored)) {
      const updated = await updateTravelOrderStatus({
        travelOrderId: input.travelOrderId,
        kpiMaintenanceId: input.kpiMaintenanceId,
        status: TRAVEL_ORDER_STATUS.APPROVED,
      });
      if (!updated) throw new Error("Travel order could not be updated.");
      return updated;
    }
    throw new Error(
      "Only the designated approver for an unlocked Approved By seat can approve this step.",
    );
  }

  if (!input.operatorAgentId || input.operatorAgentId !== target.agentId) {
    throw new Error("Only the designated approver for this Approved By seat can approve.");
  }

  const nowIso = new Date().toISOString();
  const nextLevels = stored.map((lvl) =>
    lvl.level === target.level
      ? {
          ...lvl,
          approvedAt: nowIso,
          // Always record the designated seat holder as the approving actor.
          approvedByAgentId: target.agentId,
        }
      : lvl,
  );

  const fullyDone = isApprovalHierarchySatisfied(nextLevels);
  const now = new Date();
  await prisma.$executeRaw`
    UPDATE travel_orders
    SET
      approval_levels = ${JSON.stringify(nextLevels)}::jsonb,
      status = ${fullyDone ? TRAVEL_ORDER_STATUS.APPROVED : TRAVEL_ORDER_STATUS.SUBMITTED},
      updated_at = ${now}
    WHERE id = ${input.travelOrderId}
      AND kpi_maintenance_id = ${input.kpiMaintenanceId}
  `;

  const updated = await findTravelOrderById(input.travelOrderId);
  if (!updated) throw new Error("Travel order could not be updated.");
  return updated;
}

export async function recordTravelOrderKpiSubmit(input: {
  travelOrderId: string;
  kpiMaintenanceId: string;
  kpiPercent: number;
}): Promise<TravelOrderRow | null> {
  const now = new Date();
  const percent = Math.max(0, Math.min(100, Math.round(input.kpiPercent)));
  await prisma.$executeRaw`
    UPDATE travel_orders
    SET
      kpi_percent = ${percent},
      kpi_submitted_at = ${now}::timestamptz,
      updated_at = ${now}
    WHERE id = ${input.travelOrderId}
      AND kpi_maintenance_id = ${input.kpiMaintenanceId}
  `;
  return findTravelOrderById(input.travelOrderId);
}

export function fieldAssignmentKpiPercent(
  locations: Array<{
    checkedAt?: Date | string | null;
    endedAt?: Date | string | null;
  }>,
): {
  checked: number;
  total: number;
  percent: number;
} {
  const total = locations.length;
  const checked = locations.filter((l) => l.endedAt != null || l.checkedAt != null).length;
  const percent = total > 0 ? Math.round((checked / total) * 100) : 0;
  return { checked, total, percent };
}

export async function updateTravelOrderLocationVisit(input: {
  locationId: string;
  travelOrderId: string;
  /** @deprecated Prefer visitAction. */
  checked?: boolean;
  visitAction?: "start" | "end";
  latitude?: number | null;
  longitude?: number | null;
  /** Client-captured ISO instant; falls back to server UTC now. */
  checkedAtIso?: string | null;
  capturedAtIso?: string | null;
}): Promise<void> {
  const action =
    input.visitAction ??
    (input.checked === true ? "end" : input.checked === false ? "clear" : null);
  if (!action) {
    throw new Error("Provide visitAction (start|end) or checked.");
  }

  const capturedRaw = input.capturedAtIso ?? input.checkedAtIso;
  const parsed =
    typeof capturedRaw === "string" && capturedRaw.trim()
      ? new Date(capturedRaw.trim())
      : new Date();
  const at = Number.isFinite(parsed.getTime()) ? parsed : new Date();
  const atIso = at.toISOString();
  const lat = input.latitude ?? null;
  const lng = input.longitude ?? null;

  if (action === "start") {
    await prisma.$executeRaw`
      UPDATE travel_order_locations
      SET
        started_at = ${atIso}::timestamptz,
        started_latitude = ${lat},
        started_longitude = ${lng},
        updated_at = NOW()
      WHERE id = ${input.locationId}
        AND travel_order_id = ${input.travelOrderId}
        AND started_at IS NULL
    `;
    return;
  }

  if (action === "end") {
    await prisma.$executeRaw`
      UPDATE travel_order_locations
      SET
        ended_at = ${atIso}::timestamptz,
        ended_latitude = ${lat},
        ended_longitude = ${lng},
        checked_at = ${atIso}::timestamptz,
        latitude = ${lat},
        longitude = ${lng},
        updated_at = NOW()
      WHERE id = ${input.locationId}
        AND travel_order_id = ${input.travelOrderId}
        AND ended_at IS NULL
        AND checked_at IS NULL
        AND started_at IS NOT NULL
    `;
    return;
  }

  // clear (legacy uncheck)
  await prisma.$executeRaw`
    UPDATE travel_order_locations
    SET
      started_at = NULL,
      started_latitude = NULL,
      started_longitude = NULL,
      ended_at = NULL,
      ended_latitude = NULL,
      ended_longitude = NULL,
      checked_at = NULL,
      latitude = NULL,
      longitude = NULL,
      updated_at = NOW()
    WHERE id = ${input.locationId}
      AND travel_order_id = ${input.travelOrderId}
  `;
}

export async function updateTravelOrderLocationRemarks(input: {
  locationId: string;
  travelOrderId: string;
  remarks: string | null;
}): Promise<void> {
  const now = new Date();
  await prisma.$executeRaw`
    UPDATE travel_order_locations
    SET
      remarks = ${input.remarks},
      updated_at = ${now}
    WHERE id = ${input.locationId}
      AND travel_order_id = ${input.travelOrderId}
  `;
}

/** Append a location to an existing travel order (e.g. traveler adds a stop while running). */
export async function addTravelOrderLocation(input: {
  travelOrderId: string;
  label: string;
}): Promise<TravelOrderRow> {
  const label = input.label.trim();
  if (!label) {
    throw new Error("Location name is required.");
  }
  const order = await findTravelOrderById(input.travelOrderId);
  if (!order) {
    throw new Error("Travel order not found.");
  }
  const maxSort = order.locations.reduce((m, loc) => Math.max(m, loc.sortOrder), -1);
  const locId = newId();
  const now = new Date();
  await prisma.$executeRaw`
    INSERT INTO travel_order_locations (
      id, travel_order_id, label, latitude, longitude,
      remarks, attachments, sort_order, created_at, updated_at
    ) VALUES (
      ${locId},
      ${input.travelOrderId},
      ${label.slice(0, 300)},
      ${null},
      ${null},
      ${null},
      ${JSON.stringify([])}::jsonb,
      ${maxSort + 1},
      ${now},
      ${now}
    )
  `;
  await prisma.$executeRaw`
    UPDATE travel_orders
    SET updated_at = ${now}
    WHERE id = ${input.travelOrderId}
  `;
  const fresh = await findTravelOrderById(input.travelOrderId);
  if (!fresh) {
    throw new Error("Location was added but the travel order could not be reloaded.");
  }
  return fresh;
}

/** KPI ids that have at least one travel order (Field Assignment cards). */
export async function kpiIdsWithTravelOrders(kpiIds: string[]): Promise<Set<string>> {
  if (kpiIds.length === 0) return new Set();
  return withTravelOrderFallback("kpiIdsWithTravelOrders", new Set<string>(), async () => {
    const rows = await prisma.$queryRaw<Array<{ kpi_maintenance_id: string }>>`
      SELECT DISTINCT kpi_maintenance_id
      FROM travel_orders
      WHERE kpi_maintenance_id IN (${Prisma.join(kpiIds)})
    `;
    return new Set(rows.map((r) => r.kpi_maintenance_id));
  });
}

/**
 * Field Assignment / travel-order KPI ids where the agent is an assigned traveler
 * (or the travel-order creator, for older rows missing traveler_agent_ids).
 */
export async function kpiIdsWhereAgentIsTravelOrderTraveler(
  agentId: string,
): Promise<Set<string>> {
  const id = typeof agentId === "string" ? agentId.trim() : "";
  if (!id) return new Set();
  return withTravelOrderFallback(
    "kpiIdsWhereAgentIsTravelOrderTraveler",
    new Set<string>(),
    async () => {
      const rows = await prisma.$queryRaw<Array<{ kpi_maintenance_id: string }>>`
        SELECT DISTINCT kpi_maintenance_id
        FROM travel_orders
        WHERE created_by_agent_id = ${id}
           OR traveler_agent_ids @> ${JSON.stringify([id])}::jsonb
      `;
      return new Set(rows.map((r) => r.kpi_maintenance_id));
    },
  );
}

export type TravelOrderBoardSummary = {
  orderRequest: string;
  /** @deprecated Prefer personInCharge for Work Plans. */
  travelers: string[];
  personInCharge?: string | null;
  isWorkPlan?: boolean;
};

/**
 * Latest Work Plan / travel-order purpose + people for Task Board Field Assignment cards.
 */
export async function travelOrderBoardSummariesByKpiIds(
  kpiIds: string[],
): Promise<Map<string, TravelOrderBoardSummary>> {
  const out = new Map<string, TravelOrderBoardSummary>();
  if (kpiIds.length === 0) return out;

  return withTravelOrderFallback("travelOrderBoardSummariesByKpiIds", out, async () => {
  const rows = await prisma.$queryRaw<
    Array<{
      kpi_maintenance_id: string;
      order_request: string;
      work_plan_meta: unknown;
      traveler_agent_ids: unknown;
      created_by_agent_id: string | null;
      creator_name: string | null;
    }>
  >`
    SELECT DISTINCT ON (t.kpi_maintenance_id)
      t.kpi_maintenance_id,
      t.order_request,
      t.work_plan_meta,
      COALESCE(t.traveler_agent_ids, '[]'::jsonb) AS traveler_agent_ids,
      t.created_by_agent_id,
      cr.name AS creator_name
    FROM travel_orders t
    LEFT JOIN agents cr ON cr.id = t.created_by_agent_id
    WHERE t.kpi_maintenance_id IN (${Prisma.join(kpiIds)})
    ORDER BY t.kpi_maintenance_id, t.created_at DESC
  `;

  const travelerIdSet = new Set<string>();
  const parsed = rows.map((r) => {
    const ids = parseTravelerAgentIds(r.traveler_agent_ids, r.created_by_agent_id);
    for (const id of ids) travelerIdSet.add(id);
    return { ...r, travelerIds: ids };
  });

  const travelerIds = [...travelerIdSet];
  const agentById = new Map<string, string>();
  if (travelerIds.length > 0) {
    const agents = await prisma.$queryRaw<Array<{ id: string; name: string }>>`
      SELECT id, name FROM agents WHERE id IN (${Prisma.join(travelerIds)})
    `;
    for (const a of agents) agentById.set(a.id, a.name);
  }

  for (const row of parsed) {
    const names = row.travelerIds
      .map((id) => agentById.get(id))
      .filter((n): n is string => Boolean(n));
    if (names.length === 0 && row.creator_name?.trim()) {
      names.push(row.creator_name.trim());
    }
    const meta = parseWorkPlanMeta(row.work_plan_meta);
    const personInCharge =
      meta?.personInChargeName?.trim() ||
      meta?.requestingParty?.trim() ||
      row.creator_name?.trim() ||
      null;
    out.set(row.kpi_maintenance_id, {
      orderRequest: typeof row.order_request === "string" ? row.order_request : "",
      travelers: names,
      personInCharge,
      isWorkPlan: meta != null,
    });
  }
  return out;
  });
}

export function serializeTravelOrder(row: TravelOrderRow) {
  return {
    id: row.id,
    kpiMaintenanceId: row.kpiMaintenanceId,
    orderRequest: row.orderRequest,
    workPlanMeta: row.workPlanMeta,
    attachments: row.attachments,
    status: row.status,
    approvedByAgentId: row.approvedByAgentId,
    approvedByAgent: row.approvedByAgent,
    approvedByAgentIds: row.approvedByAgentIds,
    approvedByAgents: row.approvedByAgents,
    approvalLevels: row.approvalLevels,
    confirmationByAgentId: row.confirmationByAgentId,
    confirmationByAgent: row.confirmationByAgent,
    createdByAgentId: row.createdByAgentId,
    createdByAgent: row.createdByAgent,
    companyTeamId: row.companyTeamId,
    travelerAgentIds: row.travelerAgentIds,
    travelers: row.travelers,
    vehicle: row.vehicle,
    driverPresent: row.driverPresent,
    driverAgentId: row.driverAgentId,
    driverAgent: row.driverAgent,
    driverLicenseNo: row.driverLicenseNo,
    gatePassIncluded: row.gatePassIncluded,
    estDepartureAt: row.estDepartureAt ? row.estDepartureAt.toISOString() : null,
    estArrivalAt: row.estArrivalAt ? row.estArrivalAt.toISOString() : null,
    actualDepartureStartedAt: row.actualDepartureStartedAt
      ? row.actualDepartureStartedAt.toISOString()
      : null,
    actualDepartureStartedLatitude: row.actualDepartureStartedLatitude,
    actualDepartureStartedLongitude: row.actualDepartureStartedLongitude,
    gatePassStartGuardOnDuty: row.gatePassStartGuardOnDuty,
    actualDepartureEndedAt: row.actualDepartureEndedAt
      ? row.actualDepartureEndedAt.toISOString()
      : null,
    actualDepartureEndedLatitude: row.actualDepartureEndedLatitude,
    actualDepartureEndedLongitude: row.actualDepartureEndedLongitude,
    gatePassEndGuardOnDuty: row.gatePassEndGuardOnDuty,
    rejectionReason: row.rejectionReason ?? null,
    rejectedByAgentId: row.rejectedByAgentId ?? null,
    rejectedByAgent: row.rejectedByAgent ?? null,
    rejectedAt: row.rejectedAt ? row.rejectedAt.toISOString() : null,
    rejectedAtLevel: row.rejectedAtLevel ?? null,
    kpiPercent: row.kpiPercent,
    kpiSubmittedAt: row.kpiSubmittedAt ? row.kpiSubmittedAt.toISOString() : null,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    kpiTitle: row.kpiTitle ?? null,
    kpiMainTask: row.kpiMainTask ?? null,
    locations: row.locations.map((loc) => ({
      id: loc.id,
      label: loc.label,
      latitude: loc.latitude,
      longitude: loc.longitude,
      checkedAt: loc.checkedAt ? loc.checkedAt.toISOString() : null,
      startedAt: loc.startedAt ? loc.startedAt.toISOString() : null,
      startedLatitude: loc.startedLatitude,
      startedLongitude: loc.startedLongitude,
      endedAt: loc.endedAt ? loc.endedAt.toISOString() : null,
      endedLatitude: loc.endedLatitude,
      endedLongitude: loc.endedLongitude,
      remarks: loc.remarks,
      attachments: loc.attachments,
      sortOrder: loc.sortOrder,
    })),
  };
}
