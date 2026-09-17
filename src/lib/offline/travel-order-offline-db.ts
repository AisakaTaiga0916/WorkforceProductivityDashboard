/**
 * Dexie IndexedDB store for Travel Order offline drafts, caches, and sync queue.
 * Workbox handles caching/network; this module owns the durable offline data.
 */
import Dexie, { type Table } from "dexie";
import {
  emptyTravelOrderDraft,
  type TravelOrderDraft,
  type TravelOrderDto,
} from "@/lib/travel-order";
import {
  deriveWorkPlanOrderRequest,
  type WorkPlanDraft,
} from "@/lib/work-plan";

export type TravelOrderSyncStatus = "draft" | "pending" | "synced" | "failed";

export type CachedAgent = {
  id: string;
  name: string;
  email?: string | null;
  orgChartLayer?: number | null;
  cachedAt: string;
};

export type OfflineTravelOrderDraft = {
  /** Local client id (cuid-like). */
  localId: string;
  /** Server travel order id once synced (create). */
  serverTravelOrderId?: string | null;
  /** Server KPI id once synced. */
  serverKpiId?: string | null;
  mainTaskName: string;
  scopedCompanyTeamId?: string | null;
  companyScopeAgentId?: string | null;
  /** Legacy Travel Order draft (null when Work Plan). */
  draft: TravelOrderDraft | null;
  /** Work Plan for Management Approval draft. */
  workPlanDraft?: WorkPlanDraft | null;
  /** Attachment meta only (blobs optional). */
  attachmentNames?: string[];
  syncStatus: TravelOrderSyncStatus;
  syncError?: string | null;
  createdAt: string;
  updatedAt: string;
  /** Optimistic conflict token from last known server updatedAt. */
  baseUpdatedAt?: string | null;
};

export type PendingTravelOrderOp =
  | {
      id: string;
      kind: "create-field-assignment";
      localDraftId: string;
      payload: Record<string, string>;
      /** Base64 attachment payloads (optional, small files only). */
      attachments?: Array<{ name: string; type: string; dataUrl: string }>;
      syncStatus: TravelOrderSyncStatus;
      syncError?: string | null;
      attempts: number;
      createdAt: string;
      updatedAt: string;
    }
  | {
      id: string;
      kind: "patch-travel-order";
      taskId: string;
      travelOrderId: string;
      body: Record<string, unknown>;
      baseUpdatedAt?: string | null;
      syncStatus: TravelOrderSyncStatus;
      syncError?: string | null;
      attempts: number;
      createdAt: string;
      updatedAt: string;
    }
  | {
      id: string;
      kind: "patch-location";
      taskId: string;
      travelOrderId: string;
      locationId: string;
      body: Record<string, unknown>;
      syncStatus: TravelOrderSyncStatus;
      syncError?: string | null;
      attempts: number;
      createdAt: string;
      updatedAt: string;
    }
  | {
      id: string;
      kind: "add-location";
      taskId: string;
      travelOrderId: string;
      label: string;
      /** Optimistic local location id until sync. */
      clientLocationId: string;
      syncStatus: TravelOrderSyncStatus;
      syncError?: string | null;
      attempts: number;
      createdAt: string;
      updatedAt: string;
    };

export type CachedTravelOrder = {
  id: string;
  kpiMaintenanceId: string;
  order: TravelOrderDto;
  cachedAt: string;
  /** Local overlays applied offline (GPS visits, etc.). */
  localOverlay?: Partial<TravelOrderDto> | null;
};

class TravelOrderOfflineDatabase extends Dexie {
  agents!: Table<CachedAgent, string>;
  drafts!: Table<OfflineTravelOrderDraft, string>;
  pendingOps!: Table<PendingTravelOrderOp, string>;
  travelOrders!: Table<CachedTravelOrder, string>;

  constructor() {
    super("ticketing_travel_order_offline_v1");
    this.version(1).stores({
      agents: "id, name, cachedAt",
      drafts: "localId, syncStatus, updatedAt, serverTravelOrderId",
      pendingOps: "id, kind, syncStatus, updatedAt, createdAt",
      travelOrders: "id, kpiMaintenanceId, cachedAt",
    });
  }
}

export const travelOrderOfflineDb = new TravelOrderOfflineDatabase();

function newLocalId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function cacheAgents(agents: CachedAgent[]): Promise<void> {
  const now = new Date().toISOString();
  await travelOrderOfflineDb.agents.bulkPut(
    agents.map((a) => ({ ...a, cachedAt: a.cachedAt || now })),
  );
}

export async function listCachedAgents(): Promise<CachedAgent[]> {
  return travelOrderOfflineDb.agents.orderBy("name").toArray();
}

export async function cacheTravelOrders(orders: TravelOrderDto[]): Promise<void> {
  const now = new Date().toISOString();
  await travelOrderOfflineDb.travelOrders.bulkPut(
    orders.map((order) => ({
      id: order.id,
      kpiMaintenanceId: order.kpiMaintenanceId,
      order,
      cachedAt: now,
      localOverlay: null,
    })),
  );
}

export async function getCachedTravelOrdersForTask(taskId: string): Promise<TravelOrderDto[]> {
  const rows = await travelOrderOfflineDb.travelOrders
    .where("kpiMaintenanceId")
    .equals(taskId)
    .toArray();
  return rows.map((r) => mergeOverlay(r));
}

export async function listAllCachedTravelOrders(): Promise<TravelOrderDto[]> {
  const rows = await travelOrderOfflineDb.travelOrders.toArray();
  return rows.map((r) => mergeOverlay(r));
}

function mergeOverlay(row: CachedTravelOrder): TravelOrderDto {
  if (!row.localOverlay) return row.order;
  return { ...row.order, ...row.localOverlay, locations: row.localOverlay.locations ?? row.order.locations };
}

export async function upsertCachedTravelOrder(
  order: TravelOrderDto,
  opts?: { clearOverlay?: boolean },
): Promise<void> {
  const existing = await travelOrderOfflineDb.travelOrders.get(order.id);
  await travelOrderOfflineDb.travelOrders.put({
    id: order.id,
    kpiMaintenanceId: order.kpiMaintenanceId,
    order,
    cachedAt: new Date().toISOString(),
    localOverlay: opts?.clearOverlay ? null : (existing?.localOverlay ?? null),
  });
}

export async function applyLocalTravelOrderOverlay(
  travelOrderId: string,
  overlay: Partial<TravelOrderDto>,
): Promise<TravelOrderDto | null> {
  const row = await travelOrderOfflineDb.travelOrders.get(travelOrderId);
  if (!row) return null;
  const nextOverlay = { ...(row.localOverlay ?? {}), ...overlay };
  if (overlay.locations) nextOverlay.locations = overlay.locations;
  await travelOrderOfflineDb.travelOrders.put({
    ...row,
    localOverlay: nextOverlay,
    cachedAt: new Date().toISOString(),
  });
  return mergeOverlay({ ...row, localOverlay: nextOverlay });
}

export async function saveOfflineDraft(
  input: Omit<OfflineTravelOrderDraft, "localId" | "createdAt" | "updatedAt" | "syncStatus"> & {
    localId?: string;
    syncStatus?: TravelOrderSyncStatus;
  },
): Promise<OfflineTravelOrderDraft> {
  const now = new Date().toISOString();
  const localId = input.localId ?? newLocalId("todraft");
  const existing = await travelOrderOfflineDb.drafts.get(localId);
  // Autosave must never demote a queued create back to an editable draft.
  if (
    existing &&
    (existing.syncStatus === "pending" || existing.syncStatus === "synced") &&
    (input.syncStatus ?? "pending") === "draft"
  ) {
    return existing;
  }
  const row: OfflineTravelOrderDraft = {
    localId,
    serverTravelOrderId: input.serverTravelOrderId ?? existing?.serverTravelOrderId ?? null,
    serverKpiId: input.serverKpiId ?? existing?.serverKpiId ?? null,
    mainTaskName: input.mainTaskName,
    scopedCompanyTeamId: input.scopedCompanyTeamId ?? null,
    companyScopeAgentId: input.companyScopeAgentId ?? null,
    draft: input.draft ?? null,
    workPlanDraft: input.workPlanDraft ?? existing?.workPlanDraft ?? null,
    attachmentNames: input.attachmentNames ?? existing?.attachmentNames ?? [],
    syncStatus: input.syncStatus ?? "pending",
    syncError: null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    baseUpdatedAt: input.baseUpdatedAt ?? existing?.baseUpdatedAt ?? null,
  };
  await travelOrderOfflineDb.drafts.put(row);
  return row;
}

export async function listOfflineDrafts(
  status?: TravelOrderSyncStatus,
): Promise<OfflineTravelOrderDraft[]> {
  if (status) {
    return travelOrderOfflineDb.drafts.where("syncStatus").equals(status).reverse().sortBy("updatedAt");
  }
  return travelOrderOfflineDb.drafts.orderBy("updatedAt").reverse().toArray();
}

export async function getOfflineDraft(
  localId: string,
): Promise<OfflineTravelOrderDraft | undefined> {
  return travelOrderOfflineDb.drafts.get(localId);
}

export async function deleteOfflineDraft(localId: string): Promise<void> {
  await travelOrderOfflineDb.drafts.delete(localId);
}

/** True when a draft has enough content to show in the Work Plans / Travel Orders list. */
export function offlineDraftHasContent(
  draft: Pick<OfflineTravelOrderDraft, "draft" | "workPlanDraft" | "attachmentNames">,
): boolean {
  if ((draft.attachmentNames?.length ?? 0) > 0) return true;
  const wp = draft.workPlanDraft;
  if (wp) {
    if (wp.workPlan.purposeObjective.trim()) return true;
    if (wp.workPlan.activityProposedWorkPlan.trim()) return true;
    if (wp.approvalLevels.some((l) => l.agentId.trim())) return true;
    if (wp.workPlan.personnel.some((p) => p.name.trim())) return true;
    if (wp.confirmationByAgentId?.trim()) return true;
    return false;
  }
  const d = draft.draft;
  if (!d) return false;
  if (d.orderRequest.trim()) return true;
  if (d.additionalTravelerAgentIds.length > 0) return true;
  if (d.vehicle.trim()) return true;
  if (d.locations.some((loc) => loc.label.trim())) return true;
  if (d.approvedByAgentIds.length > 0 || d.approvalLevels.some((l) => l.agentId.trim())) {
    return true;
  }
  if (d.confirmationByAgentId.trim()) return true;
  return false;
}

/** Placeholder DTO so offline-queued creates appear in lists before sync. */
export function offlineDraftAsListItem(draft: OfflineTravelOrderDraft): TravelOrderDto {
  const wp = draft.workPlanDraft;
  if (wp) {
    const levels = wp.approvalLevels;
    return {
      id: draft.serverTravelOrderId || draft.localId,
      kpiMaintenanceId: draft.serverKpiId || "",
      orderRequest: deriveWorkPlanOrderRequest(wp.workPlan),
      workPlanMeta: wp.workPlan,
      status: draft.syncStatus === "draft" ? "DRAFT" : "PENDING_SYNC",
      approvedByAgentId: levels[0]?.agentId || null,
      approvedByAgent: null,
      approvedByAgentIds: levels.map((l) => l.agentId).filter(Boolean),
      approvedByAgents: [],
      approvalLevels: levels.map((lvl) => ({
        level: lvl.level,
        agentId: lvl.agentId,
        agent: null,
        optional: lvl.optional === true,
        alternateAgentIds: Array.isArray(lvl.alternateAgentIds) ? lvl.alternateAgentIds : [],
        alternateAgents: [],
        approvedAt: null,
        approvedByAgentId: null,
        approvedByAgent: null,
        roleCode: null,
        label: `Level ${lvl.level}`,
      })),
      confirmationByAgentId: wp.confirmationByAgentId?.trim() || null,
      confirmationByAgent: null,
      vehicle: null,
      driverPresent: false,
      driverAgentId: null,
      driverAgent: null,
      driverLicenseNo: null,
      gatePassIncluded: false,
      kpiPercent: null,
      kpiSubmittedAt: null,
      createdBy: "offline",
      createdAt: draft.createdAt,
      updatedAt: draft.updatedAt,
      locations: [],
      kpiTitle: draft.mainTaskName,
      kpiMainTask: draft.mainTaskName,
    };
  }

  const d = draft.draft ?? emptyTravelOrderDraft();
  return {
    id: draft.serverTravelOrderId || draft.localId,
    kpiMaintenanceId: draft.serverKpiId || "",
    orderRequest: d.orderRequest,
    status: draft.syncStatus === "draft" ? "DRAFT" : "PENDING_SYNC",
    approvedByAgentId: d.approvedByAgentIds[0] ?? null,
    approvedByAgent: null,
    approvedByAgentIds: d.approvedByAgentIds,
    approvedByAgents: [],
    approvalLevels: d.approvalLevels.map((lvl) => ({
      level: lvl.level,
      agentId: lvl.agentId,
      agent: null,
      optional: lvl.optional === true,
      alternateAgentIds: Array.isArray(lvl.alternateAgentIds) ? lvl.alternateAgentIds : [],
      alternateAgents: [],
      approvedAt: null,
      approvedByAgentId: null,
      approvedByAgent: null,
    })),
    confirmationByAgentId: d.confirmationByAgentId || null,
    confirmationByAgent: null,
    vehicle: d.vehicle || null,
    driverPresent: d.driverPresent,
    driverAgentId: d.driverAgentId || null,
    driverAgent: null,
    driverLicenseNo: d.driverLicenseNo || null,
    gatePassIncluded: d.gatePass.included,
    estDepartureAt: d.gatePass.estDepartureAt || null,
    estArrivalAt: d.gatePass.estArrivalAt || null,
    kpiPercent: null,
    kpiSubmittedAt: null,
    createdBy: "offline",
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
    locations: d.locations.map((loc, i) => ({
      id: loc.clientKey,
      label: loc.label,
      latitude: null,
      longitude: null,
      checkedAt: null,
      startedAt: null,
      startedLatitude: null,
      startedLongitude: null,
      endedAt: null,
      endedLatitude: null,
      endedLongitude: null,
      remarks: null,
      attachments: [],
      sortOrder: i,
    })),
    kpiTitle: "Travel Orders",
    kpiMainTask: draft.mainTaskName,
  };
}

export async function enqueuePendingOp(
  op:
    | Omit<
        Extract<PendingTravelOrderOp, { kind: "create-field-assignment" }>,
        "id" | "createdAt" | "updatedAt" | "attempts" | "syncStatus"
      > & { id?: string; syncStatus?: TravelOrderSyncStatus; attempts?: number }
    | Omit<
        Extract<PendingTravelOrderOp, { kind: "patch-travel-order" }>,
        "id" | "createdAt" | "updatedAt" | "attempts" | "syncStatus"
      > & { id?: string; syncStatus?: TravelOrderSyncStatus; attempts?: number }
    | Omit<
        Extract<PendingTravelOrderOp, { kind: "patch-location" }>,
        "id" | "createdAt" | "updatedAt" | "attempts" | "syncStatus"
      > & { id?: string; syncStatus?: TravelOrderSyncStatus; attempts?: number }
    | Omit<
        Extract<PendingTravelOrderOp, { kind: "add-location" }>,
        "id" | "createdAt" | "updatedAt" | "attempts" | "syncStatus"
      > & { id?: string; syncStatus?: TravelOrderSyncStatus; attempts?: number },
): Promise<PendingTravelOrderOp> {
  const now = new Date().toISOString();
  const id = op.id ?? newLocalId("toop");
  const row = {
    ...op,
    id,
    syncStatus: op.syncStatus ?? ("pending" as const),
    syncError: null,
    attempts: op.attempts ?? 0,
    createdAt: now,
    updatedAt: now,
  } as PendingTravelOrderOp;
  await travelOrderOfflineDb.pendingOps.put(row);
  return row;
}

export async function listPendingOps(): Promise<PendingTravelOrderOp[]> {
  return travelOrderOfflineDb.pendingOps
    .where("syncStatus")
    .anyOf(["pending", "failed"])
    .sortBy("createdAt");
}

export async function markPendingOp(
  id: string,
  patch: Partial<Pick<PendingTravelOrderOp, "syncStatus" | "syncError" | "attempts">>,
): Promise<void> {
  const row = await travelOrderOfflineDb.pendingOps.get(id);
  if (!row) return;
  await travelOrderOfflineDb.pendingOps.put({
    ...row,
    ...patch,
    updatedAt: new Date().toISOString(),
  } as PendingTravelOrderOp);
}

export async function countPendingTravelOrderWork(): Promise<number> {
  const [ops, drafts] = await Promise.all([
    travelOrderOfflineDb.pendingOps.where("syncStatus").anyOf(["pending", "failed"]).count(),
    travelOrderOfflineDb.drafts.where("syncStatus").equals("pending").count(),
  ]);
  return ops + drafts;
}

export { newLocalId as newTravelOrderOfflineId };
