import {
  enqueuePendingOp,
  listOfflineDrafts,
  listPendingOps,
  markPendingOp,
  saveOfflineDraft,
  travelOrderOfflineDb,
  upsertCachedTravelOrder,
  type OfflineTravelOrderDraft,
  type PendingTravelOrderOp,
} from "@/lib/offline/travel-order-offline-db";
import { travelOrderDraftToFieldAssignmentPayload, type TravelOrderDto } from "@/lib/travel-order";

export const TRAVEL_ORDER_SYNC_TAG = "travel-order-sync";

export type TravelOrderSyncProgress = {
  running: boolean;
  total: number;
  done: number;
  failed: number;
  lastError: string | null;
  lastSyncedAt: string | null;
};

type SyncListener = (progress: TravelOrderSyncProgress) => void;

let progress: TravelOrderSyncProgress = {
  running: false,
  total: 0,
  done: 0,
  failed: 0,
  lastError: null,
  lastSyncedAt: null,
};
const listeners = new Set<SyncListener>();

function emit() {
  for (const l of listeners) l({ ...progress });
}

export function subscribeTravelOrderSync(listener: SyncListener): () => void {
  listeners.add(listener);
  listener({ ...progress });
  return () => listeners.delete(listener);
}

export function getTravelOrderSyncProgress(): TravelOrderSyncProgress {
  return { ...progress };
}

/** Brief forced-offline window after a real disconnect (navigator.onLine is often stale). */
let forcedOfflineUntilMs = 0;
/** Successful network proof — overrides a stale navigator.onLine === false. */
let confirmedOnlineUntilMs = 0;
let forcedOfflineTimer: ReturnType<typeof setTimeout> | null = null;
const CONNECTIVITY_EVENT = "travel-order-connectivity";

function clearForcedOfflineTimer() {
  if (forcedOfflineTimer != null) {
    clearTimeout(forcedOfflineTimer);
    forcedOfflineTimer = null;
  }
}

function emitConnectivity() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(CONNECTIVITY_EVENT));
  }
}

export function noteTravelOrderConnectivityLoss(holdMs = 8_000): void {
  forcedOfflineUntilMs = Date.now() + holdMs;
  confirmedOnlineUntilMs = 0;
  clearForcedOfflineTimer();
  emitConnectivity();
  if (typeof window !== "undefined") {
    forcedOfflineTimer = setTimeout(() => {
      forcedOfflineTimer = null;
      if (Date.now() >= forcedOfflineUntilMs) {
        forcedOfflineUntilMs = 0;
        emitConnectivity();
        if (typeof navigator === "undefined" || navigator.onLine) {
          void flushTravelOrderPendingQueue();
        }
      }
    }, holdMs + 50);
  }
}

export function noteTravelOrderConnectivityOk(): void {
  const shouldNotify =
    forcedOfflineUntilMs > 0 ||
    (typeof navigator !== "undefined" && navigator.onLine === false);
  forcedOfflineUntilMs = 0;
  confirmedOnlineUntilMs = Date.now() + 60_000;
  clearForcedOfflineTimer();
  if (shouldNotify) emitConnectivity();
}

export function isBrowserOnline(): boolean {
  if (typeof navigator === "undefined") return true;
  if (Date.now() < forcedOfflineUntilMs) return false;
  if (Date.now() < confirmedOnlineUntilMs) return true;
  return navigator.onLine;
}

/** Lightweight check that can recover from a stale navigator.onLine = false. */
export async function probeTravelOrderConnectivity(): Promise<boolean> {
  if (typeof fetch === "undefined") return isBrowserOnline();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const res = await fetch("/api/time/philippines", {
      cache: "no-store",
      credentials: "same-origin",
      signal: ctrl.signal,
    });
    if (res.ok) {
      noteTravelOrderConnectivityOk();
      return true;
    }
  } catch {
    /* probe failed — keep current online guess */
  } finally {
    clearTimeout(timer);
  }
  return isBrowserOnline();
}

/** True for fetch/TypeError/abort failures that should fall back to Dexie queue. */
export function isTravelOrderNetworkFailure(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  if (typeof DOMException !== "undefined" && err instanceof DOMException) {
    if (err.name === "AbortError" || err.name === "TimeoutError" || err.name === "NetworkError") {
      return true;
    }
  }
  const message = err instanceof Error ? err.message : String(err ?? "");
  return /failed to fetch|networkerror|network request failed|load failed|aborted|timeout|offline|internet/i.test(
    message,
  );
}

/**
 * Fetch with a short timeout so flaky/dead links fail into offline queue quickly
 * instead of hanging or waiting for a long TCP failure.
 */
export async function fetchTravelOrderWithTimeout(
  input: RequestInfo | URL,
  init?: RequestInit,
  timeoutMs = 12_000,
): Promise<Response> {
  const ctrl = new AbortController();
  const external = init?.signal;
  const onExternalAbort = () => ctrl.abort();
  if (external) {
    if (external.aborted) ctrl.abort();
    else external.addEventListener("abort", onExternalAbort, { once: true });
  }
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(input, { ...init, signal: ctrl.signal });
    noteTravelOrderConnectivityOk();
    return res;
  } catch (err) {
    const deviceSaysOnline = typeof navigator === "undefined" || navigator.onLine;
    // Timeouts on a live link are slow-server, not offline — don't trap the whole UI.
    if (isTravelOrderNetworkFailure(err) && !deviceSaysOnline) {
      noteTravelOrderConnectivityLoss();
    }
    throw err;
  } finally {
    clearTimeout(timer);
    if (external) external.removeEventListener("abort", onExternalAbort);
  }
}

export function subscribeTravelOrderConnectivity(listener: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const onConnectivity = () => listener();
  window.addEventListener("online", onConnectivity);
  window.addEventListener("offline", onConnectivity);
  window.addEventListener(CONNECTIVITY_EVENT, onConnectivity);
  return () => {
    window.removeEventListener("online", onConnectivity);
    window.removeEventListener("offline", onConnectivity);
    window.removeEventListener(CONNECTIVITY_EVENT, onConnectivity);
  };
}

/** Ask Workbox / SW to schedule a background sync flush. */
export async function requestTravelOrderBackgroundSync(): Promise<void> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const syncManager = (
      reg as ServiceWorkerRegistration & {
        sync?: { register: (tag: string) => Promise<void> };
      }
    ).sync;
    if (syncManager?.register) {
      await syncManager.register(TRAVEL_ORDER_SYNC_TAG);
      return;
    }
  } catch {
    /* Background Sync unsupported — fall through to immediate flush when online. */
  }
  if (isBrowserOnline() || (typeof navigator !== "undefined" && navigator.onLine)) {
    void flushTravelOrderPendingQueue();
  }
}

async function postJson(url: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function flushCreateOp(op: Extract<PendingTravelOrderOp, { kind: "create-field-assignment" }>) {
  const form = new FormData();
  for (const [k, v] of Object.entries(op.payload)) {
    form.set(k, v);
  }
  for (const att of op.attachments ?? []) {
    const blob = await (await fetch(att.dataUrl)).blob();
    form.append("attachment", blob, att.name);
  }
  const res = await fetch("/api/kpi-maintenance/field-assignment", {
    method: "POST",
    body: form,
    credentials: "same-origin",
  });
  const body = (await res.json().catch(() => ({}))) as {
    error?: string;
    kpi?: { id?: string };
    travelOrder?: TravelOrderDto;
  };
  if (!res.ok) {
    throw new Error(body.error ?? "Could not sync travel order create.");
  }
  const draft = await travelOrderOfflineDb.drafts.get(op.localDraftId);
  if (draft) {
    await saveOfflineDraft({
      ...draft,
      serverKpiId: body.kpi?.id ?? null,
      serverTravelOrderId: body.travelOrder?.id ?? null,
      syncStatus: "synced",
    });
  }
  if (body.travelOrder) {
    await upsertCachedTravelOrder(body.travelOrder, { clearOverlay: true });
  }
}

async function flushOne(op: PendingTravelOrderOp): Promise<void> {
  await markPendingOp(op.id, { syncStatus: "pending", attempts: op.attempts + 1, syncError: null });
  if (op.kind === "create-field-assignment") {
    await flushCreateOp(op);
  } else if (op.kind === "patch-travel-order") {
    const res = await postJson(
      `/api/kpi-maintenance/${encodeURIComponent(op.taskId)}/travel-orders/${encodeURIComponent(op.travelOrderId)}`,
      op.body,
    );
    const payload = (await res.json().catch(() => ({}))) as {
      error?: string;
      travelOrder?: TravelOrderDto;
    };
    if (!res.ok || !payload.travelOrder) {
      if (res.status === 409 || /conflict|updated/i.test(payload.error ?? "")) {
        throw new Error(
          payload.error ??
            "Conflict: this travel order changed on the server. Refresh and re-apply offline edits.",
        );
      }
      throw new Error(payload.error ?? "Could not sync travel order update.");
    }
    await upsertCachedTravelOrder(payload.travelOrder, { clearOverlay: true });
  } else if (op.kind === "patch-location") {
    const res = await postJson(
      `/api/kpi-maintenance/${encodeURIComponent(op.taskId)}/travel-orders/${encodeURIComponent(op.travelOrderId)}/locations/${encodeURIComponent(op.locationId)}`,
      op.body,
    );
    const payload = (await res.json().catch(() => ({}))) as {
      error?: string;
      travelOrder?: TravelOrderDto;
    };
    if (!res.ok || !payload.travelOrder) {
      throw new Error(payload.error ?? "Could not sync location visit.");
    }
    await upsertCachedTravelOrder(payload.travelOrder, { clearOverlay: true });
  } else if (op.kind === "add-location") {
    const res = await fetch(
      `/api/kpi-maintenance/${encodeURIComponent(op.taskId)}/travel-orders/${encodeURIComponent(op.travelOrderId)}/locations`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: op.label }),
      },
    );
    const payload = (await res.json().catch(() => ({}))) as {
      error?: string;
      travelOrder?: TravelOrderDto;
    };
    if (!res.ok || !payload.travelOrder) {
      throw new Error(payload.error ?? "Could not sync added location.");
    }
    await upsertCachedTravelOrder(payload.travelOrder, { clearOverlay: true });
  }
  await markPendingOp(op.id, { syncStatus: "synced", syncError: null });
  await travelOrderOfflineDb.pendingOps.delete(op.id);
}

async function ensurePendingCreateOpsFromDrafts(): Promise<void> {
  const pendingDrafts = await listOfflineDrafts("pending");
  const ops = await listPendingOps();
  const queuedLocalIds = new Set(
    ops
      .filter((op): op is Extract<PendingTravelOrderOp, { kind: "create-field-assignment" }> =>
        op.kind === "create-field-assignment",
      )
      .map((op) => op.localDraftId),
  );
  for (const draft of pendingDrafts) {
    if (draft.serverTravelOrderId || queuedLocalIds.has(draft.localId)) continue;
    await enqueuePendingOp({
      kind: "create-field-assignment",
      localDraftId: draft.localId,
      payload: travelOrderDraftToFieldAssignmentPayload({
        draft: draft.draft,
        workPlanDraft: draft.workPlanDraft,
        mainTaskName: draft.mainTaskName,
        scopedCompanyTeamId: draft.scopedCompanyTeamId,
      }),
    });
  }
}

let flushPromise: Promise<TravelOrderSyncProgress> | null = null;

/** Flush Dexie pending ops to the network. Idempotent / coalesced. */
export async function flushTravelOrderPendingQueue(): Promise<TravelOrderSyncProgress> {
  if (flushPromise) return flushPromise;
  flushPromise = (async () => {
    const online = isBrowserOnline() || (await probeTravelOrderConnectivity());
    if (!online) {
      progress = { ...progress, running: false, lastError: "Still offline." };
      emit();
      return progress;
    }
    await ensurePendingCreateOpsFromDrafts();
    const ops = await listPendingOps();
    progress = {
      running: true,
      total: ops.length,
      done: 0,
      failed: 0,
      lastError: null,
      lastSyncedAt: progress.lastSyncedAt,
    };
    emit();
    for (const op of ops) {
      try {
        await flushOne(op);
        progress = { ...progress, done: progress.done + 1 };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Sync failed.";
        await markPendingOp(op.id, { syncStatus: "failed", syncError: message });
        progress = {
          ...progress,
          failed: progress.failed + 1,
          lastError: message,
        };
      }
      emit();
    }
    progress = {
      ...progress,
      running: false,
      lastSyncedAt: new Date().toISOString(),
    };
    emit();
    return progress;
  })().finally(() => {
    flushPromise = null;
  });
  return flushPromise;
}

export async function queueFieldAssignmentCreate(input: {
  draftRow: Omit<OfflineTravelOrderDraft, "createdAt" | "updatedAt"> & {
    createdAt?: string;
    updatedAt?: string;
  };
  payload: Record<string, string>;
  attachments?: Array<{ name: string; type: string; dataUrl: string }>;
}): Promise<void> {
  await saveOfflineDraft({ ...input.draftRow, syncStatus: "pending" });
  await enqueuePendingOp({
    kind: "create-field-assignment",
    localDraftId: input.draftRow.localId,
    payload: input.payload,
    attachments: input.attachments,
  });
  await requestTravelOrderBackgroundSync();
}

export async function queueTravelOrderPatch(input: {
  taskId: string;
  travelOrderId: string;
  body: Record<string, unknown>;
  baseUpdatedAt?: string | null;
}): Promise<void> {
  await enqueuePendingOp({
    kind: "patch-travel-order",
    taskId: input.taskId,
    travelOrderId: input.travelOrderId,
    body: input.body,
    baseUpdatedAt: input.baseUpdatedAt ?? null,
  });
  await requestTravelOrderBackgroundSync();
}

export async function queueLocationPatch(input: {
  taskId: string;
  travelOrderId: string;
  locationId: string;
  body: Record<string, unknown>;
}): Promise<void> {
  await enqueuePendingOp({
    kind: "patch-location",
    taskId: input.taskId,
    travelOrderId: input.travelOrderId,
    locationId: input.locationId,
    body: input.body,
  });
  await requestTravelOrderBackgroundSync();
}

export async function queueAddLocation(input: {
  taskId: string;
  travelOrderId: string;
  label: string;
  clientLocationId: string;
}): Promise<void> {
  await enqueuePendingOp({
    kind: "add-location",
    taskId: input.taskId,
    travelOrderId: input.travelOrderId,
    label: input.label,
    clientLocationId: input.clientLocationId,
  });
  await requestTravelOrderBackgroundSync();
}
