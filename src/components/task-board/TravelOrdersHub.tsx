"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { FilePlus2 } from "lucide-react";
import { TravelOrderApprovalModal } from "@/components/task-board/TravelOrderApprovalModal";
import { TravelOrderRfpEditModal } from "@/components/task-board/TravelOrderRfpEditModal";
import { TravelOrderOfflineBanner } from "@/components/offline/TravelOrderOfflineBanner";
import { TaskBoardPopup } from "@/components/task-board/TaskBoardPopup";
import { WORK_ACTION_ICON_CLASS, WorkTabActions } from "@/components/WorkTabActions";
import type { TravelOrderDto } from "@/modules/work-plans/travel-order";
import { isWorkPlanOrder } from "@/modules/work-plans/work-plan";
import {
  cacheTravelOrders,
  deleteOfflineDraft,
  listAllCachedTravelOrders,
  listOfflineDrafts,
  offlineDraftAsListItem,
} from "@/lib/offline/travel-order-offline-db";
import {
  fetchTravelOrderWithTimeout,
  flushTravelOrderPendingQueue,
  isBrowserOnline,
  isTravelOrderNetworkFailure,
  subscribeTravelOrderConnectivity,
} from "@/lib/offline/travel-order-sync";
import { useWorkCreateDeepLink } from "@/lib/work-create-deep-link";
import { NEW_WORK_PLAN_HREF } from "@/lib/work-deep-link-params";

function resumeDraftHref(localId: string) {
  return `${NEW_WORK_PLAN_HREF}?draft=${encodeURIComponent(localId)}`;
}

/** Thin-line icon: travel ticket + map pin (matches board outline iconography). */
export function TravelOrdersIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M3.75 8.25a1.75 1.75 0 0 1 1.75-1.75h8.5a1.75 1.75 0 0 1 1.75 1.75v1.1a1.15 1.15 0 1 0 0 2.3v1.1a1.75 1.75 0 0 1-1.75 1.75h-8.5a1.75 1.75 0 0 1-1.75-1.75v-1.1a1.15 1.15 0 1 0 0-2.3v-1.1Z" />
      <path d="M7 9.25h4.25M7 12h3" />
      <path d="M18.25 6.75c0 2.35-2.75 5.25-2.75 5.25S12.75 9.1 12.75 6.75a2.75 2.75 0 1 1 5.5 0Z" />
      <circle cx="15.5" cy="6.75" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

/**
 * Work → Work Plans tab actions: New Work Plan (full-page wizard) and the Travel Orders list
 * (incl. offline queue + saved drafts) with its approval / RFP views.
 */
export function TravelOrdersHub({
  operatorAgentId,
  canAssignWork = false,
  onChanged,
}: {
  operatorAgentId: string | null;
  canAssignWork?: boolean;
  /** Called after a travel order is updated so the host list can refresh. */
  onChanged?: () => void;
}) {
  const router = useRouter();
  const [travelOrdersOpen, setTravelOrdersOpen] = useState(false);
  const [companyTravelOrders, setCompanyTravelOrders] = useState<TravelOrderDto[]>([]);
  const [companyTravelOrdersLoading, setCompanyTravelOrdersLoading] = useState(false);
  const [companyTravelOrdersError, setCompanyTravelOrdersError] = useState<string | null>(null);
  /** Draft id awaiting a second tap to confirm removal. */
  const [confirmRemoveDraftId, setConfirmRemoveDraftId] = useState<string | null>(null);
  const [viewTravelOrder, setViewTravelOrder] = useState<{
    taskId: string;
    travelOrderId: string | null;
    title: string;
  } | null>(null);
  const [editTravelOrderRfp, setEditTravelOrderRfp] = useState<{
    taskId: string;
    travelOrderId: string;
    linkedRfpTicketId?: string | null;
  } | null>(null);

  const openCreate = useCallback(() => router.push(NEW_WORK_PLAN_HREF), [router]);
  useWorkCreateDeepLink(true, openCreate);

  const loadLocalTravelOrderListItems = useCallback(async () => {
    // Only queued offline creates are listed — local "saved draft" rows are intentionally
    // excluded from the Travel Orders list so drafts don't clutter the modal.
    const pendingRows = await listOfflineDrafts("pending");
    return pendingRows
      .filter((d) => !d.serverTravelOrderId)
      .map(offlineDraftAsListItem);
  }, []);

  const loadSavedTravelOrderDraftItems = useCallback(async () => {
    // Saved drafts (syncStatus "draft") are appended last so they stay resumable
    // and removable without cluttering the active list.
    const draftRows = await listOfflineDrafts("draft");
    return draftRows
      .filter((d) => !d.serverTravelOrderId)
      .map(offlineDraftAsListItem);
  }, []);

  const reloadCompanyTravelOrders = useCallback(async () => {
    setCompanyTravelOrdersLoading(true);
    setCompanyTravelOrdersError(null);

    const localItems = await loadLocalTravelOrderListItems().catch(() => []);
    const savedDrafts = await loadSavedTravelOrderDraftItems().catch(() => []);
    const cachedEarly = await listAllCachedTravelOrders().catch(() => []);
    // Paint cache immediately so the modal is never empty while the network hangs.
    if (localItems.length > 0 || cachedEarly.length > 0 || savedDrafts.length > 0) {
      setCompanyTravelOrders([...localItems, ...cachedEarly, ...savedDrafts]);
    }

    try {
      if (!isBrowserOnline()) {
        if (localItems.length === 0 && cachedEarly.length === 0 && savedDrafts.length === 0) {
          setCompanyTravelOrdersError(
            "You are offline and no cached travel orders are available yet.",
          );
        }
        return;
      }

      async function fetchListOnce(timeoutMs: number): Promise<TravelOrderDto[]> {
        const res = await fetchTravelOrderWithTimeout(
          "/api/travel-orders",
          { cache: "no-store", credentials: "same-origin" },
          timeoutMs,
        );
        const body = (await res.json().catch(() => ({}))) as {
          travelOrders?: TravelOrderDto[];
          error?: string;
        };
        if (!res.ok) {
          throw new Error(body.error ?? "Could not load travel orders.");
        }
        return Array.isArray(body.travelOrders) ? body.travelOrders : [];
      }

      let list: TravelOrderDto[];
      try {
        list = await fetchListOnce(45_000);
      } catch (firstErr) {
        // One automatic retry after a short pause (covers cold compile / transient abort).
        if (!isTravelOrderNetworkFailure(firstErr)) throw firstErr;
        await new Promise((r) => setTimeout(r, 1500));
        list = await fetchListOnce(90_000);
      }

      setCompanyTravelOrders([...localItems, ...list, ...savedDrafts]);
      setCompanyTravelOrdersError(null);
      void cacheTravelOrders(list);
    } catch (err: unknown) {
      const hasCache =
        localItems.length > 0 || cachedEarly.length > 0 || savedDrafts.length > 0;
      if (!hasCache) {
        setCompanyTravelOrders([]);
      }
      const offline = typeof navigator !== "undefined" && !navigator.onLine;
      if (offline) {
        setCompanyTravelOrdersError(
          hasCache
            ? "Showing cached travel orders (offline)."
            : "You are offline and no cached travel orders are available yet.",
        );
      } else if (isTravelOrderNetworkFailure(err)) {
        setCompanyTravelOrdersError(
          hasCache
            ? "Still refreshing from the server — showing cached travel orders."
            : "Could not reach the server for travel orders. Try again in a moment.",
        );
      } else {
        setCompanyTravelOrdersError(
          err instanceof Error
            ? hasCache
              ? `${err.message} Showing cached travel orders.`
              : err.message
            : "Could not load travel orders.",
        );
      }
    } finally {
      setCompanyTravelOrdersLoading(false);
    }
  }, [loadLocalTravelOrderListItems, loadSavedTravelOrderDraftItems]);

  async function removeDraftTravelOrder(localId: string) {
    if (confirmRemoveDraftId !== localId) {
      setConfirmRemoveDraftId(localId);
      window.setTimeout(() => {
        setConfirmRemoveDraftId((prev) => (prev === localId ? null : prev));
      }, 4000);
      return;
    }
    setConfirmRemoveDraftId(null);
    try {
      await deleteOfflineDraft(localId);
    } catch {
      // Draft already gone — treat as removed.
    }
    void reloadCompanyTravelOrders();
  }

  // Warm-compile travel-order APIs on mount (cold compile can exceed 20s).
  useEffect(() => {
    if (!isBrowserOnline()) return;
    const ctrl = new AbortController();
    const warm = (url: string) =>
      fetch(url, {
        cache: "no-store",
        credentials: "same-origin",
        signal: ctrl.signal,
      }).catch(() => undefined);
    void warm("/api/travel-orders");
    void warm("/api/kpi-maintenance/field-assignment");
    return () => {
      ctrl.abort();
    };
  }, []);

  useEffect(() => {
    if (!travelOrdersOpen) return;
    let cancelled = false;
    // Do not wait for offline flush — load the list immediately.
    queueMicrotask(() => void reloadCompanyTravelOrders());
    void flushTravelOrderPendingQueue().catch(() => undefined);

    if (typeof navigator !== "undefined" && navigator.onLine) {
      const worker = navigator.serviceWorker?.controller;
      worker?.postMessage({
        type: "WARM_TRAVEL_ORDER_SHELL",
        urls: ["/offline-travel-orders.html", "/work/work-plans", window.location.pathname],
      });
    }
    const unsub = subscribeTravelOrderConnectivity(() => {
      if (!isBrowserOnline() || cancelled) return;
      void reloadCompanyTravelOrders();
      void flushTravelOrderPendingQueue().catch(() => undefined);
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [travelOrdersOpen, reloadCompanyTravelOrders]);

  return (
    <>
      <WorkTabActions>
        <Link
          href={NEW_WORK_PLAN_HREF}
          className={WORK_ACTION_ICON_CLASS}
          aria-label="New Work Plan"
          title="New Work Plan"
        >
          <FilePlus2 className="size-4" aria-hidden />
        </Link>
        <button
          type="button"
          onClick={() => setTravelOrdersOpen(true)}
          className={WORK_ACTION_ICON_CLASS}
          aria-label="Travel Orders"
          title="Travel Orders"
        >
          <TravelOrdersIcon className="size-4 shrink-0" />
        </button>
      </WorkTabActions>
      <TaskBoardPopup
        open={travelOrdersOpen}
        title="Travel Orders"
        description="Travel orders for your company, plus any where you are an approver or the person-in-charge. Open a row to view details and approvals."
        onClose={() => setTravelOrdersOpen(false)}
        size="lg"
      >
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-zinc-600 dark:text-zinc-400">
            Includes company travel orders and ones you prepare or approve. Approved orders stay viewable here.
          </p>
          <Link
            href={NEW_WORK_PLAN_HREF}
            className="rounded-lg bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-500"
          >
            New Work Plan
          </Link>
        </div>
        <TravelOrderOfflineBanner className="mb-3" />
        {companyTravelOrdersError ? (
          <div className="mb-3 flex items-start justify-between gap-3 rounded-lg border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-200">
            <p className="min-w-0 flex-1">{companyTravelOrdersError}</p>
            <button
              type="button"
              onClick={() => void reloadCompanyTravelOrders()}
              disabled={companyTravelOrdersLoading}
              className="shrink-0 rounded-md border border-rose-400/50 bg-rose-500/15 px-2.5 py-1 font-semibold text-rose-800 hover:bg-rose-500/25 disabled:opacity-60 dark:text-rose-100"
            >
              {companyTravelOrdersLoading ? "Retrying…" : "Retry"}
            </button>
          </div>
        ) : null}
        {companyTravelOrdersLoading && companyTravelOrders.length === 0 ? (
          <p className="rounded-xl border border-dashed border-zinc-300 px-4 py-10 text-center text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-500">
            Loading travel orders…
          </p>
        ) : companyTravelOrders.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-300 px-4 py-10 text-center text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-500">
            No travel orders for your company yet. Click <strong>New Work Plan</strong> to create one.
          </div>
        ) : (
          <ul className="space-y-2">
            {companyTravelOrders.map((order) => {
              const isDraft = order.status === "DRAFT";
              const pendingSync = order.status === "PENDING_SYNC";
              const workPlan = isWorkPlanOrder(order);
              const meta = workPlan ? order.workPlanMeta : null;
              const preparedBy = order.createdByAgent?.name?.trim() || null;
              const personInCharge =
                meta?.personInChargeName?.trim() ||
                meta?.requestingParty?.trim() ||
                null;
              const subtitleParts: string[] = [];
              if (preparedBy) subtitleParts.push(`Prepared by: ${preparedBy}`);
              if (personInCharge && personInCharge !== preparedBy) {
                subtitleParts.push(`Person-in-Charge: ${personInCharge}`);
              } else if (meta?.departmentBusinessUnit?.trim()) {
                subtitleParts.push(meta.departmentBusinessUnit.trim());
              }
              if (pendingSync) subtitleParts.push("Saved offline — will sync when online");
              return (
                <li key={order.id} className="flex items-stretch gap-1.5">
                  <button
                    type="button"
                    disabled={pendingSync}
                    onClick={() => {
                      if (pendingSync) return;
                      if (isDraft) {
                        setTravelOrdersOpen(false);
                        router.push(resumeDraftHref(order.id));
                        return;
                      }
                      if (!order.kpiMaintenanceId) return;
                      setTravelOrdersOpen(false);
                      setViewTravelOrder({
                        taskId: order.kpiMaintenanceId,
                        travelOrderId: order.id,
                        title:
                          order.orderRequest?.trim() ||
                          order.kpiMainTask ||
                          order.kpiTitle ||
                          "Travel Order",
                      });
                    }}
                    className="flex w-full items-start justify-between gap-3 rounded-xl border border-zinc-200 bg-zinc-50/80 px-3 py-3 text-left transition hover:border-orange-400/60 hover:bg-orange-50/50 disabled:cursor-default disabled:opacity-90 dark:border-zinc-700 dark:bg-zinc-950/50 dark:hover:border-orange-500/40 dark:hover:bg-orange-950/20"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[10px] font-bold uppercase tracking-[0.14em] text-orange-800 dark:text-orange-200">
                        Travel Order
                      </p>
                      <p className="mt-1 truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                        {order.orderRequest?.trim() ||
                          order.kpiMainTask ||
                          "Travel Order for Management Approval"}
                      </p>
                      <p className="mt-1 text-xs text-zinc-500">
                        {isDraft
                          ? "Saved draft — open to continue editing"
                          : subtitleParts.length > 0
                            ? subtitleParts.join(" · ")
                            : "Open to view details and approvals"}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">
                      {isDraft ? "DRAFT" : pendingSync ? "PENDING SYNC" : order.status}
                    </span>
                  </button>
                  {isDraft || pendingSync ? (
                    <button
                      type="button"
                      onClick={() => void removeDraftTravelOrder(order.id)}
                      className={
                        confirmRemoveDraftId === order.id
                          ? "shrink-0 self-center rounded-xl border border-rose-400 bg-rose-600 px-2.5 py-3 text-[11px] font-bold text-white hover:bg-rose-500"
                          : "shrink-0 self-center rounded-xl border border-rose-300 bg-white px-2.5 py-3 text-[11px] font-semibold text-rose-600 hover:bg-rose-50 dark:border-rose-500/40 dark:bg-zinc-950 dark:text-rose-300 dark:hover:bg-rose-950/30"
                      }
                      title={
                        pendingSync
                          ? "Discard this offline queue item (stored on this device)"
                          : "Remove this draft travel order (stored on this device)"
                      }
                    >
                      {confirmRemoveDraftId === order.id
                        ? "Confirm remove?"
                        : pendingSync
                          ? "Discard"
                          : "Remove draft"}
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </TaskBoardPopup>
      <TravelOrderRfpEditModal
        open={Boolean(editTravelOrderRfp)}
        taskId={editTravelOrderRfp?.taskId ?? null}
        travelOrderId={editTravelOrderRfp?.travelOrderId ?? null}
        initialTicketId={editTravelOrderRfp?.linkedRfpTicketId ?? null}
        onClose={() => setEditTravelOrderRfp(null)}
      />
      <TravelOrderApprovalModal
        open={Boolean(viewTravelOrder)}
        taskId={viewTravelOrder?.taskId ?? null}
        travelOrderId={viewTravelOrder?.travelOrderId ?? null}
        title={viewTravelOrder?.title}
        description="View details and management approvals for this travel order."
        operatorAgentId={operatorAgentId}
        canAssignWork={canAssignWork}
        canCheckIn
        onClose={() => setViewTravelOrder(null)}
        onUpdated={() => {
          void reloadCompanyTravelOrders();
          onChanged?.();
        }}
        onEditLinkedRfp={
          viewTravelOrder?.travelOrderId
            ? () => {
                const toId = viewTravelOrder.travelOrderId;
                if (!toId) return;
                const taskId = viewTravelOrder.taskId;
                setViewTravelOrder(null);
                setEditTravelOrderRfp({
                  taskId,
                  travelOrderId: toId,
                });
              }
            : undefined
        }
      />
    </>
  );
}
