"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { DateTime } from "luxon";
import { FileText, Loader2, Paperclip, Plus, X } from "lucide-react";
import { INTAKE_ATTACHMENT_ACCEPT } from "@/lib/ticket-intake-screenshots-constants";
import { MapLocationPicker } from "@/components/task-board/MapLocationPicker";
import {
  TravelOrderPageNav,
  travelOrderApprovalGridClass,
  type TravelOrderFormPage,
} from "@/components/task-board/TravelOrderPageNav";
import {
  TravelOrderGatePassFields,
  gatePassDraftFromOrder,
} from "@/components/task-board/TravelOrderGatePassFields";
import { WorkPlanOrderCard } from "@/components/task-board/WorkPlanOrderCard";
import { TravelOrderLocationVisitList } from "@/components/task-board/TravelOrderLocationVisitList";
import { cn } from "@/lib/cn";
import { isWorkPlanOrder, workPlanUsesGatePass } from "@/lib/work-plan";
import {
  canApproveTravelOrderNow,
  canCancelTravelOrderNow,
  canConfirmTravelOrderNow,
  isTravelOrderTraveler,
  getOperatorActionableApprovalLevel,
  getUnlockedIncompleteLevels,
  hasHierarchicalApprovals,
  isApprovalHierarchySatisfied,
  isApprovalLevelOptional,
  isApprovalLevelUnlocked,
  isTravelOrderApproved,
  isTravelOrderRunning,
  isTravelOrderFileImage,
  isTravelOrderConfirmReady,
  MAX_TRAVEL_ORDER_ATTACHMENTS,
  TRAVEL_ORDER_STATUS,
  sortTravelOrderLevelsByDisplayLayer,
  travelOrderApprovedByLabel,
  travelOrderHasGatePass,
  travelOrderLocationsUnlocked,
  travelOrderVehicleLabel,
  type TravelOrderDto,
  type TravelOrderGatePassDraft,
  type TravelOrderLocationDto,
} from "@/lib/travel-order";
import { isPersonnelGuardPortalRole } from "@/lib/staff-role";
import { TravelOrderOfflineBanner } from "@/components/offline/TravelOrderOfflineBanner";
import {
  applyLocalTravelOrderOverlay,
  cacheTravelOrders,
  getCachedTravelOrdersForTask,
  listAllCachedTravelOrders,
  newTravelOrderOfflineId,
  upsertCachedTravelOrder,
} from "@/lib/offline/travel-order-offline-db";
import {
  fetchTravelOrderWithTimeout,
  isBrowserOnline,
  isTravelOrderNetworkFailure,
  queueAddLocation,
  queueLocationPatch,
  queueTravelOrderPatch,
} from "@/lib/offline/travel-order-sync";

type TravelOrderSummaryPanelProps = {
  /** KPI / Field Assignment task id. Required when `source` is `"task"` (default). */
  taskId?: string;
  /**
   * `task` — load orders for one KPI card.
   * `visible` — load all travel orders visible to the signed-in staff member.
   */
  source?: "task" | "visible";
  /**
   * `full` — normal task-board interactions.
   * `gatePassOnly` — details + approvals are read-only; only Gate Pass Start/End are actionable.
   */
  interactionMode?: "full" | "gatePassOnly";
  /** When set, only this travel order is shown (e.g. notification deep link). */
  focusTravelOrderId?: string | null;
  /** Current operator agent id (for designated approver checks). */
  operatorAgentId?: string | null;
  /** Admins / assigners can also approve. */
  canAssignWork?: boolean;
  /** Whether the viewer can mark locations / edit remarks. */
  canCheckIn?: boolean;
  /** Personnel-Guard: gate-pass Start/End + Guard on Duty only. */
  personnelGuard?: boolean;
  /** Refresh board after KPI is recorded. */
  onKpiSubmitted?: () => void;
};

/** Display travel-order check-in times in Taiwan (GMT+8). */
const TRAVEL_ORDER_TIME_ZONE = "Asia/Taipei";
const MAX_LOCATION_IMAGES = 5;

function formatCheckedAt(iso: string | null): string {
  if (!iso) return "";
  const dt = DateTime.fromISO(iso, { zone: "utc" }).setZone(TRAVEL_ORDER_TIME_ZONE);
  if (!dt.isValid) return iso;
  return `${dt.toFormat("MMM d, yyyy, h:mm:ss a")} GMT+8 Taiwan`;
}

function readDeviceGps(): Promise<{ latitude: number; longitude: number }> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new Error("Geolocation is not available on this device."));
      return;
    }

    let settled = false;
    let best: { latitude: number; longitude: number; accuracy: number } | null = null;
    const finish = (result: { latitude: number; longitude: number }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      try {
        navigator.geolocation.clearWatch(watchId);
      } catch {
        /* ignore */
      }
      resolve(result);
    };
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      try {
        navigator.geolocation.clearWatch(watchId);
      } catch {
        /* ignore */
      }
      reject(new Error(message));
    };

    // Prefer a watched high-accuracy fix so Location Start does not reuse a cached Gate Pass reading.
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const latitude = pos.coords.latitude;
        const longitude = pos.coords.longitude;
        const accuracy =
          typeof pos.coords.accuracy === "number" && Number.isFinite(pos.coords.accuracy)
            ? pos.coords.accuracy
            : Number.POSITIVE_INFINITY;
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
        if (!best || accuracy <= best.accuracy) {
          best = { latitude, longitude, accuracy };
        }
        // Good enough for street-level travel check-in.
        if (accuracy <= 35) {
          finish({ latitude, longitude });
        }
      },
      (err) => {
        if (best) {
          finish({ latitude: best.latitude, longitude: best.longitude });
          return;
        }
        fail(err.message || "Could not read GPS position.");
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
    );

    const timeoutId = setTimeout(() => {
      if (best) {
        finish({ latitude: best.latitude, longitude: best.longitude });
        return;
      }
      // Last resort: one-shot read (still request a fresh sample).
      navigator.geolocation.getCurrentPosition(
        (pos) =>
          finish({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
          }),
        (err) => fail(err.message || "Could not read GPS position."),
        { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 },
      );
    }, 8000);
  });
}

/** Compact Travel Order summary shown inside task details for Field Assignment cards. */
export function TravelOrderSummaryPanel({
  taskId,
  source = "task",
  interactionMode = "full",
  focusTravelOrderId = null,
  operatorAgentId = null,
  canAssignWork = false,
  canCheckIn = true,
  personnelGuard: personnelGuardProp = false,
  onKpiSubmitted,
}: TravelOrderSummaryPanelProps) {
  const { data: session } = useSession();
  const personnelGuard =
    personnelGuardProp || isPersonnelGuardPortalRole(session?.user?.role);
  const gatePassOnly = interactionMode === "gatePassOnly";
  const [orders, setOrders] = useState<TravelOrderDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [declineDraft, setDeclineDraft] = useState<{
    orderId: string;
    asConfirmer: boolean;
    reason: string;
  } | null>(null);
  const [mapLoc, setMapLoc] = useState<{
    label: string;
    kind: "start" | "end";
    latitude: number;
    longitude: number;
    capturedAt: string | null;
  } | null>(null);
  const [orderPages, setOrderPages] = useState<Record<string, TravelOrderFormPage>>({});
  const [gatePassEdits, setGatePassEdits] = useState<Record<string, TravelOrderGatePassDraft>>({});
  const [newLocationDrafts, setNewLocationDrafts] = useState<Record<string, string>>({});
  const remarksTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const gatePassTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  function setOrderPage(orderId: string, page: TravelOrderFormPage) {
    setOrderPages((prev) => ({ ...prev, [orderId]: page }));
  }

  function resolveTaskId(orderId: string): string {
    const fromOrder = orders.find((o) => o.id === orderId)?.kpiMaintenanceId?.trim();
    if (fromOrder) return fromOrder;
    return (taskId ?? "").trim();
  }

  function gatePassValue(order: TravelOrderDto): TravelOrderGatePassDraft {
    const base = gatePassDraftFromOrder(order);
    const edits = gatePassEdits[order.id];
    if (!edits) return base;
    // Local edits (estimates / guard names) must not hide already-captured Actual GPS.
    return {
      ...base,
      ...edits,
      actualDepartureStartedAt: base.actualDepartureStartedAt ?? edits.actualDepartureStartedAt,
      actualDepartureStartedLatitude:
        base.actualDepartureStartedLatitude ?? edits.actualDepartureStartedLatitude,
      actualDepartureStartedLongitude:
        base.actualDepartureStartedLongitude ?? edits.actualDepartureStartedLongitude,
      actualDepartureEndedAt: base.actualDepartureEndedAt ?? edits.actualDepartureEndedAt,
      actualDepartureEndedLatitude:
        base.actualDepartureEndedLatitude ?? edits.actualDepartureEndedLatitude,
      actualDepartureEndedLongitude:
        base.actualDepartureEndedLongitude ?? edits.actualDepartureEndedLongitude,
    };
  }

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (source === "visible") {
        if (!isBrowserOnline()) {
          const cached = await listAllCachedTravelOrders();
          setOrders(cached);
          if (cached.length === 0) {
            setError("You are offline and no cached travel orders are available.");
          }
          return;
        }
        const res = await fetch("/api/travel-orders", { cache: "no-store" });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? "Could not load travel orders.");
        }
        const body = (await res.json()) as { travelOrders?: TravelOrderDto[] };
        const rows = Array.isArray(body.travelOrders) ? body.travelOrders : [];
        setOrders(rows);
        await cacheTravelOrders(rows);
        return;
      }

      const scopedTaskId = (taskId ?? "").trim();
      if (!scopedTaskId) {
        setOrders([]);
        setError("Missing task id for travel orders.");
        return;
      }
      if (!isBrowserOnline()) {
        const cached = await getCachedTravelOrdersForTask(scopedTaskId);
        setOrders(cached);
        if (cached.length === 0) {
          setError("You are offline and no cached travel orders are available for this task.");
        }
        return;
      }
      const res = await fetchTravelOrderWithTimeout(
        `/api/kpi-maintenance/${encodeURIComponent(scopedTaskId)}/travel-orders`,
        { cache: "no-store" },
        45_000,
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Could not load travel orders.");
      }
      const body = (await res.json()) as { travelOrders?: TravelOrderDto[] };
      const rows = Array.isArray(body.travelOrders) ? body.travelOrders : [];
      setOrders(rows);
      await cacheTravelOrders(rows);
    } catch (err: unknown) {
      const cached = await getCachedTravelOrdersForTask((taskId ?? "").trim()).catch(() => []);
      const offline = !isBrowserOnline();
      if (cached.length > 0) {
        setOrders(cached);
        setError(
          offline
            ? "Showing cached travel orders (offline)."
            : "Showing cached travel orders. Latest data could not be refreshed.",
        );
      } else {
        setError(
          offline
            ? "You are offline and no cached travel orders are available for this task."
            : isTravelOrderNetworkFailure(err)
              ? "Could not load the travel order. The server took too long — try again."
              : err instanceof Error
                ? err.message
                : "Could not load travel orders.",
        );
        setOrders([]);
      }
    } finally {
      setLoading(false);
    }
  }, [source, taskId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const timers = remarksTimers.current;
    const gpTimers = gatePassTimers.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
      for (const t of gpTimers.values()) clearTimeout(t);
      gpTimers.clear();
    };
  }, []);

  async function patchGatePassOffline(
    orderId: string,
    body: Record<string, unknown>,
  ): Promise<TravelOrderDto> {
    const order = orders.find((o) => o.id === orderId);
    if (!order) throw new Error("Travel order not found offline.");
    const gp = (body.gatePass ?? {}) as Record<string, unknown>;
    let overlay: Partial<TravelOrderDto> = {};
    if (body.action === "gate-pass-visit") {
      const visitAction = gp.visitAction === "end" ? "end" : "start";
      const capturedAt =
        typeof gp.capturedAt === "string" ? gp.capturedAt : new Date().toISOString();
      const lat = typeof gp.latitude === "number" ? gp.latitude : null;
      const lng = typeof gp.longitude === "number" ? gp.longitude : null;
      overlay =
        visitAction === "start"
          ? {
              actualDepartureStartedAt: capturedAt,
              actualDepartureStartedLatitude: lat,
              actualDepartureStartedLongitude: lng,
              gatePassIncluded: true,
            }
          : {
              actualDepartureEndedAt: capturedAt,
              actualDepartureEndedLatitude: lat,
              actualDepartureEndedLongitude: lng,
              gatePassIncluded: true,
            };
    } else {
      overlay = {
        gatePassIncluded: true,
        estDepartureAt:
          typeof gp.estDepartureAt === "string" ? gp.estDepartureAt : order.estDepartureAt ?? null,
        estArrivalAt:
          typeof gp.estArrivalAt === "string" ? gp.estArrivalAt : order.estArrivalAt ?? null,
      };
    }
    const merged = { ...order, ...overlay } as TravelOrderDto;
    let next = await applyLocalTravelOrderOverlay(orderId, overlay);
    if (!next) {
      await upsertCachedTravelOrder(merged);
      next = merged;
    }
    replaceOrder(next);
    await queueTravelOrderPatch({
      taskId: resolveTaskId(orderId),
      travelOrderId: orderId,
      body,
      baseUpdatedAt: order.updatedAt,
    });
    return next;
  }

  async function patchGatePass(
    orderId: string,
    body: Record<string, unknown>,
  ): Promise<TravelOrderDto> {
    if (!isBrowserOnline()) {
      return patchGatePassOffline(orderId, body);
    }
    try {
      const res = await fetchTravelOrderWithTimeout(
        `/api/kpi-maintenance/${encodeURIComponent(resolveTaskId(orderId))}/travel-orders/${encodeURIComponent(orderId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const payload = (await res.json().catch(() => ({}))) as {
        travelOrder?: TravelOrderDto;
        error?: string;
      };
      if (!res.ok || !payload.travelOrder) {
        throw new Error(payload.error ?? "Could not update Gate Pass.");
      }
      replaceOrder(payload.travelOrder);
      void upsertCachedTravelOrder(payload.travelOrder);
      return payload.travelOrder;
    } catch (err) {
      if (isTravelOrderNetworkFailure(err)) {
        return patchGatePassOffline(orderId, body);
      }
      throw err;
    }
  }

  async function captureGatePassActual(order: TravelOrderDto, visitAction: "start" | "end") {
    const key = `gp-${visitAction}-${order.id}`;
    setBusyKey(key);
    setActionError(null);
    const draft = gatePassValue(order);
    // Personnel-Guard Start/End stamps the signed-in guard into Guard on Duty.
    const signedInGuard = (session?.user?.name ?? "").trim();
    const startGuardOnDuty =
      visitAction === "start" && (personnelGuard || gatePassOnly) && signedInGuard
        ? signedInGuard
        : draft.startGuardOnDuty;
    const endGuardOnDuty =
      visitAction === "end" && (personnelGuard || gatePassOnly) && signedInGuard
        ? signedInGuard
        : draft.endGuardOnDuty;
    if (
      (visitAction === "start" && startGuardOnDuty !== draft.startGuardOnDuty) ||
      (visitAction === "end" && endGuardOnDuty !== draft.endGuardOnDuty)
    ) {
      setGatePassEdits((prev) => ({
        ...prev,
        [order.id]: {
          ...draft,
          included: true,
          startGuardOnDuty,
          endGuardOnDuty,
        },
      }));
    }
    // Cancel pending estimate saves so they cannot race and wipe freshly captured GPS.
    const pendingTimer = gatePassTimers.current.get(order.id);
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      gatePassTimers.current.delete(order.id);
    }
    try {
      const gps = await readDeviceGps();
      await patchGatePass(order.id, {
        action: "gate-pass-visit",
        gatePass: {
          visitAction,
          latitude: gps.latitude,
          longitude: gps.longitude,
          capturedAt: new Date().toISOString(),
          startGuardOnDuty,
          endGuardOnDuty,
        },
      });
    } catch (err: unknown) {
      setActionError(
        err instanceof Error
          ? err.message
          : visitAction === "start"
            ? "Could not capture actual departure Start."
            : "Could not capture actual departure End.",
      );
    } finally {
      setBusyKey(null);
    }
  }

  function scheduleGatePassEstimateSave(orderId: string, draft: TravelOrderGatePassDraft) {
    const existing = gatePassTimers.current.get(orderId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      void (async () => {
        setBusyKey(`gp-est-${orderId}`);
        setActionError(null);
        try {
          await patchGatePass(orderId, {
            action: "gate-pass",
            gatePass: {
              included: true,
              estDepartureAt: draft.estDepartureAt,
              estArrivalAt: draft.estArrivalAt,
              startGuardOnDuty: draft.startGuardOnDuty,
              endGuardOnDuty: draft.endGuardOnDuty,
            },
          });
        } catch (err: unknown) {
          setActionError(err instanceof Error ? err.message : "Could not save Gate Pass.");
        } finally {
          setBusyKey((prev) => (prev === `gp-est-${orderId}` ? null : prev));
        }
      })();
    }, 600);
    gatePassTimers.current.set(orderId, timer);
  }

  function replaceOrder(next: TravelOrderDto) {
    setOrders((prev) => prev.map((o) => (o.id === next.id ? next : o)));
    setGatePassEdits((prev) => {
      if (!(next.id in prev)) return prev;
      const { [next.id]: _, ...rest } = prev;
      return rest;
    });
  }

  async function approveOrder(order: TravelOrderDto) {
    setBusyKey(`approve-${order.id}`);
    setActionError(null);
    try {
      const res = await fetch(
        `/api/kpi-maintenance/${encodeURIComponent(resolveTaskId(order.id))}/travel-orders/${encodeURIComponent(order.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "approve-level" }),
        },
      );
      const body = (await res.json().catch(() => ({}))) as {
        travelOrder?: TravelOrderDto;
        error?: string;
      };
      if (!res.ok || !body.travelOrder) {
        throw new Error(body.error ?? "Could not approve the travel order.");
      }
      replaceOrder(body.travelOrder);
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : "Could not approve the travel order.");
    } finally {
      setBusyKey(null);
    }
  }

  async function confirmOrder(order: TravelOrderDto) {
    setBusyKey(`confirm-${order.id}`);
    setActionError(null);
    try {
      const res = await fetch(
        `/api/kpi-maintenance/${encodeURIComponent(resolveTaskId(order.id))}/travel-orders/${encodeURIComponent(order.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: TRAVEL_ORDER_STATUS.CONFIRMED }),
        },
      );
      const body = (await res.json().catch(() => ({}))) as {
        travelOrder?: TravelOrderDto;
        error?: string;
      };
      if (!res.ok || !body.travelOrder) {
        throw new Error(body.error ?? "Could not confirm the travel order.");
      }
      replaceOrder(body.travelOrder);
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : "Could not confirm the travel order.");
    } finally {
      setBusyKey(null);
    }
  }

  async function rejectOrder(order: TravelOrderDto, asConfirmer: boolean, reason: string) {
    const trimmed = reason.trim();
    if (!trimmed) {
      setActionError("Please explain why you are declining this travel order.");
      return;
    }
    setBusyKey(`reject-${order.id}`);
    setActionError(null);
    try {
      const res = await fetch(
        `/api/kpi-maintenance/${encodeURIComponent(resolveTaskId(order.id))}/travel-orders/${encodeURIComponent(order.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "reject", rejectionReason: trimmed }),
        },
      );
      const body = (await res.json().catch(() => ({}))) as {
        travelOrder?: TravelOrderDto;
        error?: string;
      };
      if (!res.ok || !body.travelOrder) {
        throw new Error(body.error ?? "Could not decline the travel order.");
      }
      replaceOrder(body.travelOrder);
      setDeclineDraft(null);
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : "Could not decline the travel order.");
    } finally {
      setBusyKey(null);
    }
  }

  async function cancelOrder(order: TravelOrderDto) {
    const ok = window.confirm(
      "Cancel this travel order? Approvers will no longer be able to act on it.",
    );
    if (!ok) return;
    setBusyKey(`cancel-${order.id}`);
    setActionError(null);
    try {
      const res = await fetch(
        `/api/kpi-maintenance/${encodeURIComponent(resolveTaskId(order.id))}/travel-orders/${encodeURIComponent(order.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "cancel" }),
        },
      );
      const body = (await res.json().catch(() => ({}))) as {
        travelOrder?: TravelOrderDto;
        error?: string;
      };
      if (!res.ok || !body.travelOrder) {
        throw new Error(body.error ?? "Could not cancel the travel order.");
      }
      replaceOrder(body.travelOrder);
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : "Could not cancel the travel order.");
    } finally {
      setBusyKey(null);
    }
  }

  async function submitAsDone(order: TravelOrderDto) {
    setBusyKey(`done-${order.id}`);
    setActionError(null);
    try {
      const res = await fetch(
        `/api/kpi-maintenance/${encodeURIComponent(resolveTaskId(order.id))}/travel-orders/${encodeURIComponent(order.id)}/submit-done`,
        { method: "POST" },
      );
      const body = (await res.json().catch(() => ({}))) as {
        travelOrder?: TravelOrderDto;
        error?: string;
        kpiPercent?: number;
      };
      if (!res.ok || !body.travelOrder) {
        throw new Error(body.error ?? "Could not submit travel order as done.");
      }
      replaceOrder(body.travelOrder);
      onKpiSubmitted?.();
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : "Could not submit travel order as done.");
    } finally {
      setBusyKey(null);
    }
  }

  async function patchLocationOffline(
    orderId: string,
    locationId: string,
    body: Record<string, unknown>,
  ): Promise<TravelOrderDto | null> {
    const order = orders.find((o) => o.id === orderId);
    if (!order) throw new Error("Travel order not found offline.");
    const visitAction = body.visitAction === "end" ? "end" : body.visitAction === "start" ? "start" : null;
    const capturedAt =
      typeof body.capturedAt === "string" ? body.capturedAt : new Date().toISOString();
    const lat = typeof body.latitude === "number" ? body.latitude : null;
    const lng = typeof body.longitude === "number" ? body.longitude : null;
    const locations = order.locations.map((loc) => {
      if (loc.id !== locationId) return loc;
      if (visitAction === "start") {
        return {
          ...loc,
          startedAt: capturedAt,
          startedLatitude: lat,
          startedLongitude: lng,
        };
      }
      if (visitAction === "end") {
        return {
          ...loc,
          endedAt: capturedAt,
          endedLatitude: lat,
          endedLongitude: lng,
          latitude: lat,
          longitude: lng,
          checkedAt: capturedAt,
        };
      }
      if (typeof body.remarks === "string" || body.remarks === null) {
        return { ...loc, remarks: (body.remarks as string | null) ?? null };
      }
      return loc;
    });
    const overlay: Partial<TravelOrderDto> = { locations };
    const merged = { ...order, locations };
    const next = (await applyLocalTravelOrderOverlay(orderId, overlay)) ?? merged;
    await upsertCachedTravelOrder(next);
    replaceOrder(next);
    await queueLocationPatch({
      taskId: resolveTaskId(orderId),
      travelOrderId: orderId,
      locationId,
      body,
    });
    return next;
  }

  async function patchLocation(
    orderId: string,
    locationId: string,
    body: Record<string, unknown>,
  ): Promise<TravelOrderDto | null> {
    if (!isBrowserOnline()) {
      return patchLocationOffline(orderId, locationId, body);
    }
    try {
      const res = await fetchTravelOrderWithTimeout(
        `/api/kpi-maintenance/${encodeURIComponent(resolveTaskId(orderId))}/travel-orders/${encodeURIComponent(orderId)}/locations/${encodeURIComponent(locationId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const payload = (await res.json().catch(() => ({}))) as {
        travelOrder?: TravelOrderDto;
        error?: string;
      };
      if (!res.ok || !payload.travelOrder) {
        throw new Error(payload.error ?? "Could not update location.");
      }
      replaceOrder(payload.travelOrder);
      void upsertCachedTravelOrder(payload.travelOrder);
      return payload.travelOrder;
    } catch (err) {
      if (isTravelOrderNetworkFailure(err)) {
        return patchLocationOffline(orderId, locationId, body);
      }
      throw err;
    }
  }

  async function captureVisit(
    order: TravelOrderDto,
    loc: TravelOrderLocationDto,
    visitAction: "start" | "end",
  ) {
    if (loc.id.startsWith("local_loc_")) {
      setActionError("This location is still syncing. Wait for sync, then use Start/End.");
      return;
    }
    const key = `${visitAction}-${loc.id}`;
    setBusyKey(key);
    setActionError(null);
    try {
      const gps = await readDeviceGps();
      await patchLocation(order.id, loc.id, {
        visitAction,
        latitude: gps.latitude,
        longitude: gps.longitude,
        capturedAt: new Date().toISOString(),
      });
    } catch (err: unknown) {
      setActionError(
        err instanceof Error
          ? err.message
          : visitAction === "start"
            ? "Could not start location visit."
            : "Could not end location visit.",
      );
    } finally {
      setBusyKey(null);
    }
  }

  async function addLocationOffline(order: TravelOrderDto, label: string) {
    const clientLocationId = newTravelOrderOfflineId("local_loc");
    const nextLoc: TravelOrderLocationDto = {
      id: clientLocationId,
      label,
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
      sortOrder: order.locations.length,
    };
    const locations = [...order.locations, nextLoc];
    const merged = { ...order, locations };
    const next = (await applyLocalTravelOrderOverlay(order.id, { locations })) ?? merged;
    await upsertCachedTravelOrder(next);
    replaceOrder(next);
    await queueAddLocation({
      taskId: resolveTaskId(order.id),
      travelOrderId: order.id,
      label,
      clientLocationId,
    });
    setNewLocationDrafts((prev) => ({ ...prev, [order.id]: "" }));
  }

  async function addLocationWhileRunning(order: TravelOrderDto) {
    const label = (newLocationDrafts[order.id] ?? "").trim();
    if (!label) {
      setActionError("Enter a location name.");
      return;
    }
    if (order.locations.length >= 30) {
      setActionError("This travel order already has the maximum number of locations.");
      return;
    }
    const key = `add-loc-${order.id}`;
    setBusyKey(key);
    setActionError(null);
    try {
      if (!isBrowserOnline()) {
        await addLocationOffline(order, label);
        return;
      }

      try {
        const res = await fetchTravelOrderWithTimeout(
          `/api/kpi-maintenance/${encodeURIComponent(resolveTaskId(order.id))}/travel-orders/${encodeURIComponent(order.id)}/locations`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ label }),
          },
        );
        const payload = (await res.json().catch(() => ({}))) as {
          travelOrder?: TravelOrderDto;
          error?: string;
        };
        if (!res.ok || !payload.travelOrder) {
          throw new Error(payload.error ?? "Could not add location.");
        }
        replaceOrder(payload.travelOrder);
        void upsertCachedTravelOrder(payload.travelOrder);
        setNewLocationDrafts((prev) => ({ ...prev, [order.id]: "" }));
      } catch (err) {
        if (isTravelOrderNetworkFailure(err)) {
          await addLocationOffline(order, label);
          return;
        }
        throw err;
      }
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : "Could not add location.");
    } finally {
      setBusyKey(null);
    }
  }

  function scheduleRemarksSave(orderId: string, locationId: string, remarks: string) {
    const key = locationId;
    const existing = remarksTimers.current.get(key);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      void (async () => {
        setBusyKey(`remarks-${locationId}`);
        setActionError(null);
        try {
          await patchLocation(orderId, locationId, { remarks });
        } catch (err: unknown) {
          setActionError(err instanceof Error ? err.message : "Could not save remarks.");
        } finally {
          setBusyKey((prev) => (prev === `remarks-${locationId}` ? null : prev));
        }
      })();
    }, 500);
    remarksTimers.current.set(key, timer);
  }

  async function uploadOrderAttachments(order: TravelOrderDto, fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const existing = order.attachments ?? [];
    const remaining = MAX_TRAVEL_ORDER_ATTACHMENTS - existing.length;
    if (remaining <= 0) {
      setActionError(`You can attach at most ${MAX_TRAVEL_ORDER_ATTACHMENTS} files.`);
      return;
    }
    const files = Array.from(fileList).slice(0, remaining);
    const key = `order-att-${order.id}`;
    setBusyKey(key);
    setActionError(null);
    try {
      const form = new FormData();
      for (const file of files) form.append("attachment", file);
      const res = await fetch(
        `/api/kpi-maintenance/${encodeURIComponent(resolveTaskId(order.id))}/travel-orders/${encodeURIComponent(order.id)}/attachments`,
        { method: "POST", body: form },
      );
      const payload = (await res.json().catch(() => ({}))) as {
        travelOrder?: TravelOrderDto;
        error?: string;
      };
      if (!res.ok || !payload.travelOrder) {
        throw new Error(payload.error ?? "Could not upload attachments.");
      }
      replaceOrder(payload.travelOrder);
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : "Could not upload attachments.");
    } finally {
      setBusyKey(null);
    }
  }

  async function removeOrderAttachment(order: TravelOrderDto, storedFileName: string) {
    const key = `rm-order-${order.id}-${storedFileName}`;
    setBusyKey(key);
    setActionError(null);
    try {
      const res = await fetch(
        `/api/kpi-maintenance/${encodeURIComponent(resolveTaskId(order.id))}/travel-orders/${encodeURIComponent(order.id)}/attachments`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ removeAttachment: storedFileName }),
        },
      );
      const payload = (await res.json().catch(() => ({}))) as {
        travelOrder?: TravelOrderDto;
        error?: string;
      };
      if (!res.ok || !payload.travelOrder) {
        throw new Error(payload.error ?? "Could not remove attachment.");
      }
      replaceOrder(payload.travelOrder);
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : "Could not remove attachment.");
    } finally {
      setBusyKey(null);
    }
  }

  async function uploadLocationImages(order: TravelOrderDto, loc: TravelOrderLocationDto, fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const remaining = MAX_LOCATION_IMAGES - loc.attachments.length;
    if (remaining <= 0) {
      setActionError(`At most ${MAX_LOCATION_IMAGES} images per location.`);
      return;
    }
    const files = Array.from(fileList).slice(0, remaining);
    const key = `img-${loc.id}`;
    setBusyKey(key);
    setActionError(null);
    try {
      const form = new FormData();
      for (const file of files) form.append("images", file);
      const res = await fetch(
        `/api/kpi-maintenance/${encodeURIComponent(resolveTaskId(order.id))}/travel-orders/${encodeURIComponent(order.id)}/locations/${encodeURIComponent(loc.id)}`,
        { method: "POST", body: form },
      );
      const payload = (await res.json().catch(() => ({}))) as {
        travelOrder?: TravelOrderDto;
        error?: string;
      };
      if (!res.ok || !payload.travelOrder) {
        throw new Error(payload.error ?? "Could not upload images.");
      }
      replaceOrder(payload.travelOrder);
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : "Could not upload images.");
    } finally {
      setBusyKey(null);
    }
  }

  async function removeLocationImage(order: TravelOrderDto, loc: TravelOrderLocationDto, storedFileName: string) {
    const key = `rm-${loc.id}-${storedFileName}`;
    setBusyKey(key);
    setActionError(null);
    try {
      await patchLocation(order.id, loc.id, { removeAttachment: storedFileName });
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : "Could not remove image.");
    } finally {
      setBusyKey(null);
    }
  }

  function openGpsPin(
    loc: TravelOrderLocationDto,
    kind: "start" | "end",
  ) {
    if (kind === "start") {
      if (loc.startedLatitude == null || loc.startedLongitude == null) return;
      setMapLoc({
        label: loc.label,
        kind: "start",
        latitude: loc.startedLatitude,
        longitude: loc.startedLongitude,
        capturedAt: loc.startedAt,
      });
      return;
    }
    const lat = loc.endedLatitude ?? loc.latitude;
    const lng = loc.endedLongitude ?? loc.longitude;
    if (lat == null || lng == null) return;
    setMapLoc({
      label: loc.label,
      kind: "end",
      latitude: lat,
      longitude: lng,
      capturedAt: loc.endedAt ?? loc.checkedAt,
    });
  }

  function openGatePassGpsPin(order: TravelOrderDto, kind: "start" | "end") {
    const gp = gatePassValue(order);
    if (kind === "start") {
      if (gp.actualDepartureStartedLatitude == null || gp.actualDepartureStartedLongitude == null) {
        return;
      }
      setMapLoc({
        label: "Gate Pass · Actual Departure",
        kind: "start",
        latitude: gp.actualDepartureStartedLatitude,
        longitude: gp.actualDepartureStartedLongitude,
        capturedAt: gp.actualDepartureStartedAt,
      });
      return;
    }
    if (gp.actualDepartureEndedLatitude == null || gp.actualDepartureEndedLongitude == null) {
      return;
    }
    setMapLoc({
      label: "Gate Pass · Actual Arrival",
      kind: "end",
      latitude: gp.actualDepartureEndedLatitude,
      longitude: gp.actualDepartureEndedLongitude,
      capturedAt: gp.actualDepartureEndedAt,
    });
  }

  if (loading && orders.length === 0) {
    return (
      <p className="flex items-center gap-2 text-xs text-zinc-500">
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
        Loading travel order…
      </p>
    );
  }
  if (error && orders.length === 0) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-rose-600 dark:text-rose-300">{error}</p>
        <button
          type="button"
          onClick={() => void reload()}
          className="text-xs font-semibold text-orange-700 hover:underline dark:text-orange-300"
        >
          Try again
        </button>
      </div>
    );
  }
  if (orders.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-zinc-300 px-3 py-4 text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
        {source === "visible"
          ? personnelGuard
            ? "No approved (running) travel orders to process for Gate Pass right now."
            : "No travel orders are visible to your account yet."
          : "No travel orders on this task yet."}
      </p>
    );
  }

  const focusId = focusTravelOrderId?.trim() || null;
  const visibleOrders = (focusId ? orders.filter((o) => o.id === focusId) : orders).filter(
    (o) =>
      !personnelGuard ||
      (isTravelOrderRunning(o.status) &&
        (!isWorkPlanOrder(o) || workPlanUsesGatePass(o))),
  );
  if (visibleOrders.length === 0) {
    return (
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        {personnelGuard
          ? "No approved (running) travel orders to process for Gate Pass right now."
          : "This travel order is no longer available."}
      </p>
    );
  }

  return (
    <>
      <div className="space-y-3 rounded-xl border border-orange-400/40 bg-orange-500/[0.06] p-3 dark:border-orange-500/30 dark:bg-orange-500/[0.08]">
        <TravelOrderOfflineBanner />
        {gatePassOnly ? (
          <p className="rounded-lg border border-zinc-200 bg-white/70 px-2.5 py-2 text-[11px] text-zinc-600 dark:border-zinc-700 dark:bg-zinc-950/50 dark:text-zinc-300">
            {personnelGuard
              ? "Gate Pass kiosk: details and approvals are view-only. Record Guard on Duty and Start / End on the Gate Pass page."
              : "View-only mode: details and approvals cannot be changed here. Gate Pass is visible only to Personnel-Guard while the trip is running."}
          </p>
        ) : null}
        {error ? (
          <p className="rounded-lg border border-amber-400/40 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-900 dark:text-amber-100">
            {error}{" "}
            <button
              type="button"
              onClick={() => void reload()}
              className="font-semibold underline"
            >
              Refresh
            </button>
          </p>
        ) : null}
        {actionError ? (
          <p className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-2.5 py-1.5 text-xs text-rose-700 dark:text-rose-200">
            {actionError}
          </p>
        ) : null}
        {visibleOrders.map((order) => {
          if (isWorkPlanOrder(order)) {
            const approved = isTravelOrderApproved(order.status);
            const running = isTravelOrderRunning(order.status);
            const rejected = order.status === TRAVEL_ORDER_STATUS.REJECTED;
            const cancelled = order.status === TRAVEL_ORDER_STATUS.CANCELLED;
            const usesGatePass = workPlanUsesGatePass(order);
            const showGatePassPage = usesGatePass && (!running || personnelGuard);
            const allowGatePassActualCapture =
              personnelGuard && approved && !rejected && !cancelled;
            const isAssignedTraveler = isTravelOrderTraveler(operatorAgentId, order);
            const showLocationsTab = true;
            const gatePassPage: TravelOrderFormPage = showLocationsTab ? 4 : 3;
            const approvalsPage: TravelOrderFormPage = showLocationsTab ? 3 : 2;
            const locationsPage: TravelOrderFormPage = 2;
            const defaultPage: TravelOrderFormPage =
              personnelGuard && showGatePassPage ? gatePassPage : 1;
            const rawFormPage = orderPages[order.id] ?? defaultPage;
            const formPage: TravelOrderFormPage =
              !showGatePassPage && rawFormPage === gatePassPage ? 1 : rawFormPage;
            return (
              <div
                key={order.id}
                className="space-y-2 rounded-lg border border-zinc-200 bg-white/80 p-3 dark:border-zinc-700 dark:bg-zinc-950/60"
              >
                <TravelOrderPageNav
                  page={formPage}
                  onPageChange={(page) => setOrderPage(order.id, page)}
                  showGatePass={showGatePassPage}
                  showLocationsTab={showLocationsTab}
                />
                {formPage === gatePassPage && showGatePassPage ? (
                  <TravelOrderGatePassFields
                    value={gatePassValue(order)}
                    disabled={
                      gatePassOnly ||
                      rejected ||
                      cancelled ||
                      !(canCheckIn || isAssignedTraveler || personnelGuard)
                    }
                    showActualTimes={approved}
                    allowActualCapture={allowGatePassActualCapture}
                    startBusy={busyKey === `gp-start-${order.id}`}
                    endBusy={busyKey === `gp-end-${order.id}`}
                    formatCapturedAt={formatCheckedAt}
                    onChange={(next) => {
                      setGatePassEdits((prev) => ({ ...prev, [order.id]: next }));
                      if (gatePassOnly || personnelGuard) return;
                      scheduleGatePassEstimateSave(order.id, next);
                    }}
                    onCaptureActual={(action) => void captureGatePassActual(order, action)}
                    onOpenGps={(kind) => openGatePassGpsPin(order, kind)}
                  />
                ) : formPage === locationsPage ? (
                  (order.locations?.length ?? 0) > 0 ? (
                    <TravelOrderLocationVisitList
                      order={order}
                      title="Venues / Locations"
                      approved={approved}
                      hasGatePass={usesGatePass}
                      locationsUnlocked={travelOrderLocationsUnlocked(order)}
                      gatePassOnly={gatePassOnly}
                      allowCheckIn={!gatePassOnly && (canCheckIn || isAssignedTraveler)}
                      personnelGuard={Boolean(personnelGuard)}
                      busyKey={busyKey}
                      formatCheckedAt={formatCheckedAt}
                      resolveTaskId={resolveTaskId}
                      onCaptureVisit={(loc, action) => void captureVisit(order, loc, action)}
                      onOpenGps={(loc, kind) => openGpsPin(loc, kind)}
                      onRemarksChange={(locationId, value) =>
                        scheduleRemarksSave(order.id, locationId, value)
                      }
                      onUploadImages={(loc, files) => void uploadLocationImages(order, loc, files)}
                      onRemoveImage={(loc, storedFileName) =>
                        void removeLocationImage(order, loc, storedFileName)
                      }
                    />
                  ) : (
                    <p className="rounded-lg border border-dashed border-zinc-300 px-2.5 py-3 text-sm text-zinc-500 dark:border-zinc-700">
                      No venues / locations on this travel order.
                    </p>
                  )
                ) : (
                  <WorkPlanOrderCard
                    order={order}
                    view={formPage === approvalsPage ? "approvals" : "details"}
                    operatorAgentId={operatorAgentId}
                    canAssignWork={canAssignWork}
                    gatePassOnly={gatePassOnly}
                    busyKey={busyKey}
                    onApprove={(o) => void approveOrder(o)}
                    onConfirm={(o) => void confirmOrder(o)}
                    onDecline={(o, reason, asConfirmer) =>
                      void rejectOrder(o, asConfirmer === true, reason)
                    }
                    onCancel={(o) => void cancelOrder(o)}
                  />
                )}
              </div>
            );
          }
          const approved = isTravelOrderApproved(order.status);
          const running = isTravelOrderRunning(order.status);
          const confirmed = order.status === TRAVEL_ORDER_STATUS.CONFIRMED;
          const hierarchical = hasHierarchicalApprovals(order.approvalLevels ?? []);
          const levels = order.approvalLevels ?? [];
          const actionableLevel = hierarchical
            ? getOperatorActionableApprovalLevel(levels, operatorAgentId, { canAssignWork })
            : null;
          const unlockedLevels = hierarchical ? getUnlockedIncompleteLevels(levels) : [];
          const hierarchyDone = hierarchical && isApprovalHierarchySatisfied(levels);
          const canApproveThis =
            !gatePassOnly &&
            canApproveTravelOrderNow(
              operatorAgentId,
              { ...order, approvalLevels: levels },
              { canAssignWork },
            );
          const canConfirmThis =
            !gatePassOnly &&
            canConfirmTravelOrderNow(
              operatorAgentId,
              order,
              { canAssignWork },
            );
          const confirmReady = isTravelOrderConfirmReady(order);
          const locationsUnlocked = travelOrderLocationsUnlocked(order);
          const hasGatePass = travelOrderHasGatePass(order);
          const rejected = order.status === TRAVEL_ORDER_STATUS.REJECTED;
          const cancelled = order.status === TRAVEL_ORDER_STATUS.CANCELLED;
          const canCancelThis =
            !gatePassOnly && canCancelTravelOrderNow(operatorAgentId, order);
          const checkedCount = order.locations.filter((l) => l.endedAt || l.checkedAt).length;
          const totalCount = order.locations.length;
          const liveKpiPercent =
            totalCount > 0 ? Math.round((checkedCount / totalCount) * 100) : 0;
          const kpiAlreadySubmitted = order.kpiSubmittedAt != null;
          const isAssignedTraveler = isTravelOrderTraveler(operatorAgentId, order);
          const allowCheckIn = !gatePassOnly && (canCheckIn || isAssignedTraveler);
          const canSubmitDone = !gatePassOnly && running && allowCheckIn && !kpiAlreadySubmitted;
          const canAddLocationWhileRunning =
            !gatePassOnly &&
            approved &&
            isAssignedTraveler &&
            !kpiAlreadySubmitted &&
            !rejected &&
            !cancelled;
          /**
           * While running (APPROVED), Gate Pass is Personnel-Guard only.
           * Before approval, everyone who can open the order still sees Gate Pass setup.
           */
          const showGatePassPage = !running || personnelGuard;
          /** Only Personnel-Guard captures Gate Pass Start/End / Guard on Duty. */
          const allowGatePassActualCapture =
            personnelGuard &&
            approved &&
            !rejected &&
            !cancelled;

          const defaultPage: TravelOrderFormPage =
            personnelGuard && showGatePassPage
              ? 3
              : canApproveThis || canConfirmThis
                ? 2
                : 1;
          const rawFormPage = orderPages[order.id] ?? defaultPage;
          const formPage: TravelOrderFormPage =
            !showGatePassPage && rawFormPage === 3 ? 1 : rawFormPage;
          const flatApprovers =
            order.approvedByAgents?.length
              ? order.approvedByAgents
              : order.approvedByAgent
                ? [order.approvedByAgent]
                : [];

          return (
            <div
              key={order.id}
              className="space-y-2 rounded-lg border border-zinc-200 bg-white/80 p-3 dark:border-zinc-700 dark:bg-zinc-950/60"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p
                  className={
                    rejected || cancelled
                      ? "text-xs font-semibold text-rose-700 dark:text-rose-300"
                      : "text-xs font-semibold text-zinc-900 dark:text-zinc-100"
                  }
                >
                  Status: {order.status}
                </p>
              </div>
              {rejected ? (
                <div className="space-y-1.5 rounded-lg border border-rose-500/40 bg-rose-500/10 px-2.5 py-2 dark:text-rose-200">
                  <p className="text-xs font-semibold text-rose-700 dark:text-rose-200">
                    This travel order was declined
                    {order.rejectedByAgent?.name ? ` by ${order.rejectedByAgent.name}` : ""}
                    {order.rejectedAtLevel != null
                      ? ` at ${travelOrderApprovedByLabel(
                          isApprovalLevelOptional(
                            levels.find((l) => l.level === order.rejectedAtLevel),
                          ),
                          order.rejectedAtLevel,
                          levels.length,
                        )}`
                      : order.rejectedByAgent
                        ? " at confirmation"
                        : ""}
                    {" "}and cannot proceed.
                  </p>
                  {order.rejectionReason ? (
                    <div className="space-y-0.5">
                      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-rose-800/80 dark:text-rose-300/90">
                        Decline feedback
                      </p>
                      <p className="whitespace-pre-wrap text-xs text-rose-900/90 dark:text-rose-100/90">
                        {order.rejectionReason}
                      </p>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {cancelled ? (
                <p className="rounded-lg border border-zinc-400/40 bg-zinc-500/10 px-2.5 py-1.5 text-xs text-zinc-700 dark:text-zinc-300">
                  This travel order was cancelled by its creator.
                </p>
              ) : null}

              <TravelOrderPageNav
                page={formPage}
                onPageChange={(page) => setOrderPage(order.id, page)}
                showGatePass={showGatePassPage}
                stepActions={
                  canCancelThis && formPage === 1 ? (
                    <button
                      type="button"
                      disabled={busyKey === `cancel-${order.id}`}
                      onClick={() => void cancelOrder(order)}
                      title="Cancel this travel order if it should not proceed"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-400/60 bg-zinc-500/10 px-2.5 py-1.5 text-xs font-semibold text-zinc-800 hover:bg-zinc-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-200"
                    >
                      {busyKey === `cancel-${order.id}` ? (
                        <Loader2 className="size-3.5 animate-spin" aria-hidden />
                      ) : null}
                      Cancel T.O.
                    </button>
                  ) : null
                }
              />

              {formPage === 1 ? (
                <>
                  <div className="space-y-1">
                    <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-600 dark:text-zinc-400">
                      Purpose of travel
                    </p>
                    <p className="whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">
                      {order.orderRequest || "—"}
                    </p>
                  </div>

                  {(() => {
                    const attachments = order.attachments ?? [];
                    const canManageAttachments =
                      !gatePassOnly && approved && allowCheckIn && !rejected && !cancelled;
                    const remainingSlots = MAX_TRAVEL_ORDER_ATTACHMENTS - attachments.length;
                    const uploadBusy = busyKey === `order-att-${order.id}`;
                    if (!canManageAttachments && attachments.length === 0) return null;
                    return (
                      <div className="space-y-2">
                        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-600 dark:text-zinc-400">
                          Attachments
                        </p>
                        {attachments.length > 0 ? (
                          <ul className="flex flex-wrap gap-2">
                            {attachments.map((att) => {
                              const href = `/api/kpi-maintenance/${encodeURIComponent(resolveTaskId(order.id))}/travel-orders/${encodeURIComponent(order.id)}/files/${encodeURIComponent(att.storedFileName)}`;
                              const isImage = isTravelOrderFileImage(att);
                              const removing = busyKey === `rm-order-${order.id}-${att.storedFileName}`;
                              return (
                                <li key={att.storedFileName} className="relative">
                                  {isImage ? (
                                    <a
                                      href={href}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="block overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900"
                                      title={att.originalName}
                                    >
                                      {/* eslint-disable-next-line @next/next/no-img-element */}
                                      <img
                                        src={href}
                                        alt={att.originalName}
                                        className="h-20 w-20 object-cover"
                                      />
                                    </a>
                                  ) : (
                                    <a
                                      href={href}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="inline-flex max-w-[14rem] items-center gap-1.5 rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-2 text-xs font-semibold text-zinc-800 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                                      title={att.originalName}
                                    >
                                      <FileText className="size-3.5 shrink-0" aria-hidden />
                                      <span className="truncate">{att.originalName}</span>
                                    </a>
                                  )}
                                  {canManageAttachments ? (
                                    <button
                                      type="button"
                                      disabled={removing || uploadBusy}
                                      onClick={() =>
                                        void removeOrderAttachment(order, att.storedFileName)
                                      }
                                      className="absolute -right-1.5 -top-1.5 rounded-full border border-zinc-300 bg-white p-0.5 text-zinc-600 shadow-sm hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-300"
                                      title="Remove attachment"
                                    >
                                      {removing ? (
                                        <Loader2 className="size-3 animate-spin" aria-hidden />
                                      ) : (
                                        <X className="size-3" aria-hidden />
                                      )}
                                    </button>
                                  ) : null}
                                </li>
                              );
                            })}
                          </ul>
                        ) : null}
                        {canManageAttachments ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <input
                              id={`travel-order-att-${order.id}`}
                              type="file"
                              multiple
                              accept={INTAKE_ATTACHMENT_ACCEPT}
                              className="pointer-events-none absolute h-0 w-0 overflow-hidden opacity-0"
                              tabIndex={-1}
                              aria-hidden
                              disabled={uploadBusy || remainingSlots <= 0}
                              onChange={(e) => {
                                void uploadOrderAttachments(order, e.target.files);
                                e.target.value = "";
                              }}
                            />
                            <button
                              type="button"
                              disabled={uploadBusy || remainingSlots <= 0}
                              onClick={() =>
                                document.getElementById(`travel-order-att-${order.id}`)?.click()
                              }
                              className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-zinc-300 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-zinc-700 hover:bg-zinc-50 disabled:pointer-events-none disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900"
                            >
                              {uploadBusy ? (
                                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                              ) : (
                                <Plus className="size-3.5" aria-hidden />
                              )}
                              <Paperclip className="size-3.5" aria-hidden />
                              Add files
                            </button>
                            <span className="text-[10px] text-zinc-500">
                              {attachments.length}/{MAX_TRAVEL_ORDER_ATTACHMENTS} · PDF, Word, Excel,
                              images · available while travel order is running
                            </span>
                          </div>
                        ) : null}
                      </div>
                    );
                  })()}

                  {(() => {
                    const creatorId = order.createdByAgentId?.trim() || "";
                    const travelerList = order.travelers ?? [];
                    const creatorIsTraveler =
                      Boolean(creatorId) &&
                      travelerList.some((t) => t.id === creatorId);
                    const showPreparedBy =
                      Boolean(order.createdByAgent?.name) &&
                      Boolean(creatorId) &&
                      !creatorIsTraveler;
                    return (
                      <>
                        {showPreparedBy ? (
                          <div className="space-y-1">
                            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-600 dark:text-zinc-400">
                              Prepared By
                            </p>
                            <p className="text-sm text-zinc-700 dark:text-zinc-300">
                              {order.createdByAgent?.name}
                              {order.createdByAgent?.email
                                ? ` · ${order.createdByAgent.email}`
                                : ""}
                            </p>
                          </div>
                        ) : null}
                        <div className="space-y-1">
                          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-600 dark:text-zinc-400">
                            Travelers
                          </p>
                          <p className="text-sm text-zinc-700 dark:text-zinc-300">
                            {(travelerList.length
                              ? travelerList.map((t) => t.name).join(", ")
                              : showPreparedBy
                                ? "—"
                                : order.createdByAgent?.name) ?? "—"}
                          </p>
                        </div>
                      </>
                    );
                  })()}

                  {order.driverPresent ? (
                    <div className="space-y-1">
                      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-600 dark:text-zinc-400">
                        Driver
                      </p>
                      <p className="text-sm text-zinc-700 dark:text-zinc-300">
                        {order.driverAgent?.name ?? "—"}
                        {order.driverLicenseNo
                          ? ` · License No. ${order.driverLicenseNo}`
                          : ""}
                      </p>
                    </div>
                  ) : null}

                  <div className="space-y-1">
                    <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-600 dark:text-zinc-400">
                      Vehicle
                    </p>
                    <p className="text-sm text-zinc-700 dark:text-zinc-300">
                      {order.vehicle ? travelOrderVehicleLabel(order.vehicle) : "—"}
                    </p>
                  </div>

                  <TravelOrderLocationVisitList
                    order={order}
                    approved={approved}
                    hasGatePass={hasGatePass}
                    locationsUnlocked={locationsUnlocked}
                    gatePassOnly={gatePassOnly}
                    allowCheckIn={allowCheckIn}
                    personnelGuard={Boolean(personnelGuard)}
                    busyKey={busyKey}
                    formatCheckedAt={formatCheckedAt}
                    resolveTaskId={resolveTaskId}
                    onCaptureVisit={(loc, action) => void captureVisit(order, loc, action)}
                    onOpenGps={(loc, kind) => openGpsPin(loc, kind)}
                    onRemarksChange={(locationId, value) =>
                      scheduleRemarksSave(order.id, locationId, value)
                    }
                    onUploadImages={(loc, files) => void uploadLocationImages(order, loc, files)}
                    onRemoveImage={(loc, storedFileName) =>
                      void removeLocationImage(order, loc, storedFileName)
                    }
                    canAddLocation={canAddLocationWhileRunning}
                    newLocationDraft={newLocationDrafts[order.id] ?? ""}
                    addLocationBusy={busyKey === `add-loc-${order.id}`}
                    onNewLocationDraftChange={(value) =>
                      setNewLocationDrafts((prev) => ({ ...prev, [order.id]: value }))
                    }
                    onAddLocation={() => void addLocationWhileRunning(order)}
                  />

                  <div className="space-y-2 border-t border-zinc-200 pt-3 dark:border-zinc-700">
                    {canSubmitDone ? (
                      <div className="space-y-1.5">
                        <p className="text-[11px] text-zinc-500">
                          KPI preview: {checkedCount}/{totalCount} completed · {liveKpiPercent}%
                          {" "}(formula: completed ÷ total × 100)
                        </p>
                        <button
                          type="button"
                          disabled={busyKey === `done-${order.id}`}
                          onClick={() => void submitAsDone(order)}
                          className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-orange-600 px-3 py-2 text-xs font-semibold text-white hover:bg-orange-500 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {busyKey === `done-${order.id}` ? (
                            <Loader2 className="size-3.5 animate-spin" aria-hidden />
                          ) : null}
                          Submit as Done
                        </button>
                      </div>
                    ) : kpiAlreadySubmitted ? (
                      <p className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                        KPI recorded: {order.kpiPercent ?? liveKpiPercent}% ({checkedCount}/
                        {totalCount} completed)
                        {order.kpiSubmittedAt
                          ? ` · ${formatCheckedAt(order.kpiSubmittedAt)}`
                          : ""}
                      </p>
                    ) : null}
                  </div>

                </>
              ) : formPage === 2 ? (
                <>
                  <div className="space-y-2">
                    <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-600 dark:text-zinc-400">
                      To be Approved by:
                      {hierarchical &&
                      order.status === TRAVEL_ORDER_STATUS.SUBMITTED &&
                      unlockedLevels.length > 0
                        ? ` · waiting on ${unlockedLevels
                            .map((l) =>
                              travelOrderApprovedByLabel(
                                isApprovalLevelOptional(l),
                                l.level,
                                levels.length,
                              ),
                            )
                            .join(", ")}`
                        : null}
                      {hierarchical &&
                      hierarchyDone &&
                      (approved || order.status === TRAVEL_ORDER_STATUS.SUBMITTED)
                        ? " · all required approvals done"
                        : null}
                      {hierarchical && rejected && order.rejectedAtLevel != null
                        ? ` · declined at ${travelOrderApprovedByLabel(
                            isApprovalLevelOptional(
                              levels.find((l) => l.level === order.rejectedAtLevel),
                            ),
                            order.rejectedAtLevel,
                            levels.length,
                          )}`
                        : null}
                      {hierarchical &&
                      rejected &&
                      order.rejectedAtLevel == null &&
                      order.rejectedByAgent
                        ? " · declined after approval"
                        : null}
                    </p>

                    {hierarchical ? (
                      <div className="-mx-1 overflow-x-auto px-1 pb-1">
                        <div
                          className={cn(
                            "flex w-max min-w-full items-stretch gap-3 rounded-lg border border-zinc-200 bg-zinc-50/80 p-3 dark:border-zinc-700 dark:bg-zinc-900/40",
                          )}
                        >
                        {sortTravelOrderLevelsByDisplayLayer(levels).map((lvl, index) => {
                          const totalLevels = levels.length;
                          const done = Boolean(lvl.approvedAt);
                          const optional = isApprovalLevelOptional(lvl);
                          const declinedHere =
                            rejected &&
                            order.rejectedAtLevel != null &&
                            order.rejectedAtLevel === lvl.level;
                          const closedAfterDecline =
                            rejected &&
                            order.rejectedAtLevel != null &&
                            lvl.level > order.rejectedAtLevel;
                          const unlocked =
                            !rejected &&
                            order.status === TRAVEL_ORDER_STATUS.SUBMITTED &&
                            !done &&
                            isApprovalLevelUnlocked(levels, lvl.level);
                          const skipped =
                            !done &&
                            !declinedHere &&
                            !closedAfterDecline &&
                            (approved || hierarchyDone) &&
                            !unlocked;
                          const nameClass = declinedHere
                            ? "text-rose-700 dark:text-rose-300"
                            : done
                              ? "text-emerald-800 dark:text-emerald-300"
                              : unlocked
                                ? "text-orange-800 dark:text-orange-300"
                                : skipped
                                  ? "text-sky-700 dark:text-sky-300"
                                  : "text-zinc-400 dark:text-zinc-600";
                          return (
                            <div
                              key={`${order.id}-lvl-${lvl.level}`}
                              className="flex w-[13.5rem] shrink-0 flex-col self-stretch sm:w-[14.5rem]"
                            >
                              {index > 0 ? (
                                <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
                                  then →
                                </p>
                              ) : (
                                <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-transparent select-none">
                                  start
                                </p>
                              )}
                              <div className="flex min-h-0 min-w-0 flex-1 flex-col rounded-lg border border-zinc-200 bg-white/80 px-3 py-2.5 dark:border-zinc-700 dark:bg-zinc-950/50">
                              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-500">
                                <span
                                  className={
                                    optional
                                      ? "text-sky-700 dark:text-sky-300"
                                      : "text-zinc-500 dark:text-zinc-500"
                                  }
                                >
                                  {travelOrderApprovedByLabel(optional, lvl.level, totalLevels)}
                                </span>
                              </p>
                              <p
                                className={`mt-1 break-words text-sm font-medium leading-snug ${nameClass}`}
                              >
                                {lvl.agent?.name ?? "—"}
                              </p>
                              {declinedHere ? (
                                <p className="mt-0.5 text-[11px] text-rose-700 dark:text-rose-300">
                                  Declined
                                  {order.rejectedByAgent?.name
                                    ? ` by ${order.rejectedByAgent.name}`
                                    : lvl.agent?.name
                                      ? ` by ${lvl.agent.name}`
                                      : ""}
                                  {order.rejectedAt
                                    ? ` · ${formatCheckedAt(order.rejectedAt)}`
                                    : ""}
                                </p>
                              ) : done ? (
                                <p className="mt-0.5 text-[11px] text-emerald-700 dark:text-emerald-300">
                                  Approved
                                  {lvl.approvedAt
                                    ? ` · ${formatCheckedAt(lvl.approvedAt)}`
                                    : ""}
                                  {optional ? " · optional" : ""}
                                </p>
                              ) : unlocked ? (
                                <p className="mt-0.5 text-[11px] text-orange-700 dark:text-orange-300">
                                  Pending — actionable now
                                  {optional
                                    ? " · optional; not in the required chain"
                                    : ""}
                                </p>
                              ) : skipped ? (
                                <p className="mt-0.5 text-[11px] text-sky-700 dark:text-sky-300">
                                  {optional
                                    ? "Skipped — optional; all required approvals are done"
                                    : "Skipped — not required after hierarchy completed"}
                                </p>
                              ) : closedAfterDecline ? (
                                <p className="mt-0.5 text-[11px] text-zinc-500">
                                  Closed — declined at{" "}
                                  {travelOrderApprovedByLabel(
                                    isApprovalLevelOptional(
                                      levels.find((l) => l.level === order.rejectedAtLevel),
                                    ),
                                    order.rejectedAtLevel ?? undefined,
                                    totalLevels,
                                  )}
                                </p>
                              ) : (
                                <p className="mt-0.5 text-[11px] text-zinc-500">
                                  Waiting for lower layer(s)
                                </p>
                              )}
                              {canApproveThis &&
                              actionableLevel &&
                              actionableLevel.level === lvl.level ? (
                                <div className="mt-2 space-y-2">
                                  <div className="flex flex-col gap-1.5">
                                    <button
                                      type="button"
                                      disabled={
                                        busyKey === `approve-${order.id}` ||
                                        busyKey === `reject-${order.id}` ||
                                        declineDraft?.orderId === order.id
                                      }
                                      onClick={() => void approveOrder(order)}
                                      className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-500 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                      {busyKey === `approve-${order.id}` ? (
                                        <Loader2 className="size-3.5 animate-spin" aria-hidden />
                                      ) : null}
                                      Approve
                                    </button>
                                    <button
                                      type="button"
                                      disabled={
                                        busyKey === `approve-${order.id}` ||
                                        busyKey === `reject-${order.id}`
                                      }
                                      onClick={() =>
                                        setDeclineDraft({
                                          orderId: order.id,
                                          asConfirmer: false,
                                          reason: "",
                                        })
                                      }
                                      className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-rose-500/50 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-800 hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:text-rose-200"
                                    >
                                      Do not approve
                                    </button>
                                  </div>
                                  {declineDraft?.orderId === order.id &&
                                  !declineDraft.asConfirmer ? (
                                    <div className="space-y-2 rounded-lg border border-rose-500/40 bg-rose-500/5 p-2.5">
                                      <label className="block space-y-1">
                                        <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-rose-800 dark:text-rose-300">
                                          Why are you declining?
                                        </span>
                                        <textarea
                                          value={declineDraft.reason}
                                          onChange={(e) =>
                                            setDeclineDraft((prev) =>
                                              prev ? { ...prev, reason: e.target.value } : prev,
                                            )
                                          }
                                          rows={3}
                                          maxLength={2000}
                                          placeholder="Explain why this travel order is not approved…"
                                          className="w-full rounded-lg border border-rose-400/40 bg-white px-2.5 py-2 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-rose-500 dark:border-rose-500/30 dark:bg-zinc-950 dark:text-zinc-100"
                                        />
                                      </label>
                                      <div className="flex flex-wrap gap-2">
                                        <button
                                          type="button"
                                          disabled={
                                            busyKey === `reject-${order.id}` ||
                                            !declineDraft.reason.trim()
                                          }
                                          onClick={() =>
                                            void rejectOrder(order, false, declineDraft.reason)
                                          }
                                          className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                          {busyKey === `reject-${order.id}` ? (
                                            <Loader2 className="size-3.5 animate-spin" aria-hidden />
                                          ) : null}
                                          Submit decline
                                        </button>
                                        <button
                                          type="button"
                                          disabled={busyKey === `reject-${order.id}`}
                                          onClick={() => setDeclineDraft(null)}
                                          className="inline-flex items-center rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
                                        >
                                          Cancel
                                        </button>
                                      </div>
                                    </div>
                                  ) : null}
                                </div>
                              ) : null}
                              </div>
                            </div>
                          );
                        })}
                        </div>
                      </div>
                    ) : (
                      <div
                        className={cn(
                          travelOrderApprovalGridClass(Math.max(flatApprovers.length, 1)),
                          "rounded-lg border border-zinc-200 bg-zinc-50/80 p-3 dark:border-zinc-700 dark:bg-zinc-900/40",
                        )}
                      >
                        {flatApprovers.length > 0 ? (
                          flatApprovers.map((agent, index) => {
                            const showApproveUnderName =
                              canApproveThis &&
                              (agent.id === operatorAgentId ||
                                (!operatorAgentId && index === 0) ||
                                (operatorAgentId != null &&
                                  !flatApprovers.some((a) => a.id === operatorAgentId) &&
                                  index === 0));
                            return (
                            <div key={`${order.id}-approver-${agent.id}`} className="min-w-0 self-start">
                              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-500">
                                Approver
                              </p>
                              <p
                                className={`mt-1 break-words text-sm font-medium leading-snug ${
                                  approved
                                    ? "text-emerald-800 dark:text-emerald-300"
                                    : "text-zinc-700 dark:text-zinc-300"
                                }`}
                              >
                                {agent.name}
                              </p>
                              {showApproveUnderName ? (
                                <div className="mt-2 space-y-2">
                                  <div className="flex flex-col gap-1.5">
                                    <button
                                      type="button"
                                      disabled={
                                        busyKey === `approve-${order.id}` ||
                                        busyKey === `reject-${order.id}` ||
                                        declineDraft?.orderId === order.id
                                      }
                                      onClick={() => void approveOrder(order)}
                                      className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-500 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                      {busyKey === `approve-${order.id}` ? (
                                        <Loader2 className="size-3.5 animate-spin" aria-hidden />
                                      ) : null}
                                      Approve
                                    </button>
                                    <button
                                      type="button"
                                      disabled={
                                        busyKey === `approve-${order.id}` ||
                                        busyKey === `reject-${order.id}`
                                      }
                                      onClick={() =>
                                        setDeclineDraft({
                                          orderId: order.id,
                                          asConfirmer: false,
                                          reason: "",
                                        })
                                      }
                                      className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-rose-500/50 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-800 hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:text-rose-200"
                                    >
                                      Do not approve
                                    </button>
                                  </div>
                                  {declineDraft?.orderId === order.id &&
                                  !declineDraft.asConfirmer ? (
                                    <div className="space-y-2 rounded-lg border border-rose-500/40 bg-rose-500/5 p-2.5">
                                      <label className="block space-y-1">
                                        <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-rose-800 dark:text-rose-300">
                                          Why are you declining?
                                        </span>
                                        <textarea
                                          value={declineDraft.reason}
                                          onChange={(e) =>
                                            setDeclineDraft((prev) =>
                                              prev ? { ...prev, reason: e.target.value } : prev,
                                            )
                                          }
                                          rows={3}
                                          maxLength={2000}
                                          placeholder="Explain why this travel order is not approved…"
                                          className="w-full rounded-lg border border-rose-400/40 bg-white px-2.5 py-2 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-rose-500 dark:border-rose-500/30 dark:bg-zinc-950 dark:text-zinc-100"
                                        />
                                      </label>
                                      <div className="flex flex-wrap gap-2">
                                        <button
                                          type="button"
                                          disabled={
                                            busyKey === `reject-${order.id}` ||
                                            !declineDraft.reason.trim()
                                          }
                                          onClick={() =>
                                            void rejectOrder(order, false, declineDraft.reason)
                                          }
                                          className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                          {busyKey === `reject-${order.id}` ? (
                                            <Loader2 className="size-3.5 animate-spin" aria-hidden />
                                          ) : null}
                                          Submit decline
                                        </button>
                                        <button
                                          type="button"
                                          disabled={busyKey === `reject-${order.id}`}
                                          onClick={() => setDeclineDraft(null)}
                                          className="inline-flex items-center rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
                                        >
                                          Cancel
                                        </button>
                                      </div>
                                    </div>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                            );
                          })
                        ) : (
                          <div className="min-w-0 self-start">
                            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-500">
                              Approver
                            </p>
                            <p className="mt-1 text-sm font-medium text-zinc-400 dark:text-zinc-600">
                              —
                            </p>
                            {canApproveThis ? (
                              <div className="mt-2 flex flex-col gap-1.5">
                                <button
                                  type="button"
                                  disabled={
                                    busyKey === `approve-${order.id}` ||
                                    busyKey === `reject-${order.id}` ||
                                    declineDraft?.orderId === order.id
                                  }
                                  onClick={() => void approveOrder(order)}
                                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-500 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  {busyKey === `approve-${order.id}` ? (
                                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                                  ) : null}
                                  Approve travel order
                                </button>
                              </div>
                            ) : null}
                          </div>
                        )}
                      </div>
                    )}

                    {hierarchical &&
                    rejected &&
                    order.rejectedAtLevel == null &&
                    order.rejectedByAgent ? (
                      <p className="rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-1.5 text-[11px] text-rose-700 dark:text-rose-300">
                        Declined at confirmation by {order.rejectedByAgent.name}
                        {order.rejectedAt ? ` · ${formatCheckedAt(order.rejectedAt)}` : ""}
                      </p>
                    ) : null}
                  </div>

                  <div className="space-y-1.5 border-t border-zinc-200 pt-3 dark:border-zinc-700">
                    <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-orange-800 dark:text-orange-200">
                      To be Confirmed by:
                    </p>
                    <div className="min-w-0 rounded-lg border border-orange-400/30 bg-orange-500/[0.05] p-2.5 dark:border-orange-500/25">
                      <p
                        className={`break-words text-sm font-medium leading-snug ${
                          confirmed
                            ? "text-emerald-800 dark:text-emerald-300"
                            : order.confirmationByAgent?.name
                              ? "text-zinc-800 dark:text-zinc-200"
                              : "text-zinc-400 dark:text-zinc-600"
                        }`}
                      >
                        {order.confirmationByAgent?.name ?? "—"}
                        {order.confirmationByAgent?.email
                          ? ` · ${order.confirmationByAgent.email}`
                          : ""}
                      </p>
                      {confirmed ? (
                        <p className="mt-1 text-[11px] text-emerald-700 dark:text-emerald-300">
                          Confirmed
                        </p>
                      ) : rejected ? (
                        <p className="mt-1 text-[11px] text-rose-700 dark:text-rose-300">
                          Declined — confirmation closed
                        </p>
                      ) : cancelled ? (
                        <p className="mt-1 text-[11px] text-zinc-600 dark:text-zinc-400">
                          Cancelled — confirmation closed
                        </p>
                      ) : canConfirmThis ? (
                        <div className="mt-2 space-y-2">
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              disabled={
                                !confirmReady ||
                                busyKey === `confirm-${order.id}` ||
                                busyKey === `reject-${order.id}` ||
                                declineDraft?.orderId === order.id
                              }
                              onClick={() => void confirmOrder(order)}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/50 bg-emerald-500/15 px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-50 dark:text-emerald-200"
                            >
                              {busyKey === `confirm-${order.id}` ? (
                                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                              ) : null}
                              Confirm travel order
                            </button>
                            <button
                              type="button"
                              disabled={
                                busyKey === `confirm-${order.id}` ||
                                busyKey === `reject-${order.id}`
                              }
                              onClick={() =>
                                setDeclineDraft({
                                  orderId: order.id,
                                  asConfirmer: true,
                                  reason: "",
                                })
                              }
                              className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/50 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-800 hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:text-rose-200"
                            >
                              Do not confirm
                            </button>
                          </div>
                          {!confirmReady ? (
                            <p className="text-[11px] text-zinc-500">
                              {hasGatePass
                                ? "Confirm unlocks after Gate Pass Actual Arrival End is captured."
                                : "Confirm unlocks after every location visit is completed."}
                            </p>
                          ) : null}
                          {declineDraft?.orderId === order.id && declineDraft.asConfirmer ? (
                            <div className="space-y-2 rounded-lg border border-rose-500/40 bg-rose-500/5 p-2.5">
                              <label className="block space-y-1">
                                <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-rose-800 dark:text-rose-300">
                                  Why are you declining confirmation?
                                </span>
                                <textarea
                                  value={declineDraft.reason}
                                  onChange={(e) =>
                                    setDeclineDraft((prev) =>
                                      prev ? { ...prev, reason: e.target.value } : prev,
                                    )
                                  }
                                  rows={3}
                                  maxLength={2000}
                                  placeholder="Explain why confirmation is declined…"
                                  className="w-full rounded-lg border border-rose-400/40 bg-white px-2.5 py-2 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-rose-500 dark:border-rose-500/30 dark:bg-zinc-950 dark:text-zinc-100"
                                />
                              </label>
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  disabled={
                                    busyKey === `reject-${order.id}` ||
                                    !declineDraft.reason.trim()
                                  }
                                  onClick={() =>
                                    void rejectOrder(order, true, declineDraft.reason)
                                  }
                                  className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  {busyKey === `reject-${order.id}` ? (
                                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                                  ) : null}
                                  Submit decline
                                </button>
                                <button
                                  type="button"
                                  disabled={busyKey === `reject-${order.id}`}
                                  onClick={() => setDeclineDraft(null)}
                                  className="inline-flex items-center rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      ) : order.confirmationByAgentId && approved ? (
                        <p className="mt-1 text-[11px] text-zinc-500">Waiting for confirmation</p>
                      ) : null}
                    </div>
                  </div>
                </>
              ) : (
                <div className="space-y-3">
                  {!order.gatePassIncluded &&
                  !gatePassValue(order).estDepartureAt &&
                  !gatePassValue(order).estArrivalAt &&
                  !gatePassValue(order).actualDepartureStartedAt ? (
                    <p className="rounded-lg border border-dashed border-zinc-300 px-2.5 py-2 text-[11px] text-zinc-500 dark:border-zinc-700">
                      Gate Pass was skipped at creation. You can still fill it in below.
                    </p>
                  ) : null}
                  <TravelOrderGatePassFields
                    value={gatePassValue(order)}
                    disabled={
                      gatePassOnly ||
                      rejected ||
                      cancelled ||
                      !(canCheckIn || isAssignedTraveler || personnelGuard)
                    }
                    showActualTimes={approved}
                    allowActualCapture={allowGatePassActualCapture}
                    startBusy={busyKey === `gp-start-${order.id}`}
                    endBusy={busyKey === `gp-end-${order.id}`}
                    formatCapturedAt={formatCheckedAt}
                    onChange={(next) => {
                      setGatePassEdits((prev) => ({ ...prev, [order.id]: next }));
                      // gatePassOnly / Guard: local Guard-on-Duty only; do not persist estimates.
                      if (gatePassOnly || personnelGuard) return;
                      scheduleGatePassEstimateSave(order.id, next);
                    }}
                    onCaptureActual={(action) => void captureGatePassActual(order, action)}
                    onOpenGps={(kind) => openGatePassGpsPin(order, kind)}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {mapLoc ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 px-3 py-6 backdrop-blur-sm"
          onClick={() => setMapLoc(null)}
          role="dialog"
          aria-modal="true"
          aria-label={`GPS for ${mapLoc.label}`}
        >
          <div
            className="w-full max-w-lg rounded-2xl border border-zinc-200 bg-white p-4 shadow-2xl dark:border-zinc-800 dark:bg-surface"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-orange-700 dark:text-orange-400">
                  {mapLoc.kind === "start" ? "Start GPS" : "End GPS"}
                </p>
                <h4 className="truncate text-sm font-bold text-zinc-900 dark:text-zinc-100">
                  {mapLoc.label}
                </h4>
                {mapLoc.capturedAt ? (
                  <p className="mt-0.5 text-[11px] text-zinc-500">
                    {formatCheckedAt(mapLoc.capturedAt)}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => setMapLoc(null)}
                className="rounded-full border border-zinc-300 p-1.5 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
                aria-label="Close map"
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>
            <MapLocationPicker
              key={`${mapLoc.kind}-${mapLoc.label}-${mapLoc.latitude}-${mapLoc.longitude}`}
              latitude={mapLoc.latitude}
              longitude={mapLoc.longitude}
              readOnly
              heightClassName="h-64"
            />
          </div>
        </div>
      ) : null}
    </>
  );
}
