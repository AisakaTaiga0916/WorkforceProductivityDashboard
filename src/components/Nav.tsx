"use client";

import { isElevatedPlatformRole } from "@/lib/staff-role";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Search, SlidersHorizontal } from "lucide-react";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { GlobalSearchBar } from "@/components/global-search/GlobalSearchBar";
import { useGlobalSearch } from "@/components/global-search/GlobalSearchProvider";
import { AgentTicketDeepLink } from "@/components/AgentTicketDeepLink";
import { ElapsedFromIso } from "@/components/ElapsedFromIso";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { PhilippineTimeClock } from "@/components/PhilippineTimeClock";
import { PatchNotesControl } from "@/components/PatchNotesControl";
import { TravelOrderApprovalModal } from "@/components/task-board/TravelOrderApprovalModal";
import { cn } from "@/lib/cn";

function notifSeenTsKey(email: string) {
  return `notif-open-seen-ts:${email}`;
}

function notifTravelSeenIdsKey(email: string) {
  return `notif-travel-seen-ids:${email}`;
}

function readTravelSeenIds(email: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(notifTravelSeenIdsKey(email));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === "string" && id.trim().length > 0));
  } catch {
    return new Set();
  }
}

function writeTravelSeenIds(email: string, ids: Set<string>) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(notifTravelSeenIdsKey(email), JSON.stringify([...ids]));
}

export function Nav() {
  const { data } = useSession();
  const pathname = usePathname();
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifLoading, setNotifLoading] = useState(false);
  const [notifications, setNotifications] = useState<
    Array<{ id: string; ticketNumber: string; title: string; status: string; updatedAt: string }>
  >([]);
  const [travelOrderApprovals, setTravelOrderApprovals] = useState<
    Array<{
      id: string;
      kpiMaintenanceId: string;
      kpiTitle: string | null;
      kpiMainTask: string | null;
      orderRequest: string;
      pendingLevel: number | null;
      pendingLevelOptional?: boolean;
      updatedAt: string;
    }>
  >([]);
  const [travelOrderConfirmations, setTravelOrderConfirmations] = useState<
    Array<{
      id: string;
      kpiMaintenanceId: string;
      kpiTitle: string | null;
      kpiMainTask: string | null;
      orderRequest: string;
      updatedAt: string;
    }>
  >([]);
  const [phaseDelayAlerts, setPhaseDelayAlerts] = useState<
    Array<{
      kpiMaintenanceId: string;
      kpiTitle: string;
      phaseId: string;
      phaseName: string;
      targetDate: string;
      href: string;
    }>
  >([]);
  const [accountRequestNotifications, setAccountRequestNotifications] = useState<
    Array<{ id: string; requestType: string; createdAt: string; portalAccount: { name: string; email: string } }>
  >([]);
  const [unreadOpenCount, setUnreadOpenCount] = useState(0);
  const [seenTravelIds, setSeenTravelIds] = useState<Set<string>>(() => new Set());
  const [travelApprovalModal, setTravelApprovalModal] = useState<{
    taskId: string;
    travelOrderId: string;
    title: string;
  } | null>(null);
  const notifRef = useRef<HTMLDivElement | null>(null);
  const mobileNotifPanelRef = useRef<HTMLDivElement | null>(null);
  const desktopNotifPanelRef = useRef<HTMLDivElement | null>(null);
  const role = data?.user?.role;
  const isAdminRole = isElevatedPlatformRole(role) || role === "Admin";
  const userEmail = data?.user?.email ?? "unknown";
  const { openPalette } = useGlobalSearch();
  const showUtilities =
    isElevatedPlatformRole(role) || role === "Admin" || role === "Personnel";

  const refreshUnreadOpenCount = useCallback(async (lastSeenMs: number, email: string) => {
    try {
      const params = new URLSearchParams({ lastSeenMs: String(lastSeenMs) });
      const res = await fetch(`/api/notifications/unread-count?${params.toString()}`, { cache: "no-store" });
      if (!res.ok) return;
      const payload = (await res.json()) as {
        ticketCount?: number;
        accountRequestCount?: number;
        travelOrderApprovalIds?: string[];
        travelOrderConfirmationIds?: string[];
        total?: number;
      };
      const ticketCount = Math.max(0, Number(payload.ticketCount ?? 0) || 0);
      const accountRequestCount = Math.max(0, Number(payload.accountRequestCount ?? 0) || 0);
      const travelIds = Array.isArray(payload.travelOrderApprovalIds)
        ? payload.travelOrderApprovalIds.filter((id): id is string => typeof id === "string")
        : [];
      const confirmationIds = Array.isArray(payload.travelOrderConfirmationIds)
        ? payload.travelOrderConfirmationIds.filter((id): id is string => typeof id === "string")
        : [];
      const pendingIds = [...travelIds, ...confirmationIds];
      const seenTravelIds = readTravelSeenIds(email);
      // Drop dismissed ids that are no longer pending (approval or confirmation).
      const pruned = new Set([...seenTravelIds].filter((id) => pendingIds.includes(id)));
      if (pruned.size !== seenTravelIds.size) writeTravelSeenIds(email, pruned);
      const unreadTravelCount = pendingIds.filter((id) => !pruned.has(id)).length;
      setUnreadOpenCount(ticketCount + accountRequestCount + unreadTravelCount);
    } catch {
      // Ignore polling/network failures for badge updates.
    }
  }, []);

  const markAllNotificationsRead = useCallback(() => {
    if (typeof window === "undefined") return;
    const now = Date.now();
    window.localStorage.setItem(notifSeenTsKey(userEmail), String(now));
    setUnreadOpenCount(0);

    void (async () => {
      try {
        const params = new URLSearchParams({ lastSeenMs: String(now) });
        const res = await fetch(`/api/notifications/unread-count?${params.toString()}`, {
          cache: "no-store",
        });
        const nextSeen = readTravelSeenIds(userEmail);
        for (const row of travelOrderApprovals) nextSeen.add(row.id);
        for (const row of travelOrderConfirmations) nextSeen.add(row.id);
        if (res.ok) {
          const payload = (await res.json()) as {
            travelOrderApprovalIds?: string[];
            travelOrderConfirmationIds?: string[];
          };
          for (const id of payload.travelOrderApprovalIds ?? []) {
            if (typeof id === "string" && id.trim()) nextSeen.add(id);
          }
          for (const id of payload.travelOrderConfirmationIds ?? []) {
            if (typeof id === "string" && id.trim()) nextSeen.add(id);
          }
        }
        writeTravelSeenIds(userEmail, nextSeen);
        setSeenTravelIds(new Set(nextSeen));
        await refreshUnreadOpenCount(now, userEmail);
      } catch {
        const nextSeen = readTravelSeenIds(userEmail);
        for (const row of travelOrderApprovals) nextSeen.add(row.id);
        for (const row of travelOrderConfirmations) nextSeen.add(row.id);
        writeTravelSeenIds(userEmail, nextSeen);
        setSeenTravelIds(new Set(nextSeen));
      }
    })();
  }, [userEmail, travelOrderApprovals, travelOrderConfirmations, refreshUnreadOpenCount]);

  useEffect(() => {
    if (!data?.user) return;
    setSeenTravelIds(readTravelSeenIds(data.user.email ?? "unknown"));
  }, [data?.user]);

  useEffect(() => {
    if (!notifOpen || !showUtilities) return;
    let ignore = false;
    queueMicrotask(() => setNotifLoading(true));
    void Promise.all([
      fetch("/api/tickets?limit=100").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/travel-orders/pending-approvals", { cache: "no-store" }).then((r) =>
        r.ok ? r.json() : { pendingApprovals: [] },
      ),
      fetch("/api/travel-orders/pending-confirmations", { cache: "no-store" }).then((r) =>
        r.ok ? r.json() : { pendingConfirmations: [] },
      ),
      fetch("/api/kpi-maintenance/phase-delay-alerts", { cache: "no-store" }).then((r) =>
        r.ok ? r.json() : { delayedPhases: [] },
      ),
      isAdminRole
        ? fetch("/api/admin/account-requests/notifications", { cache: "no-store" }).then((r) =>
            r.ok ? r.json() : { rows: [] },
          )
        : Promise.resolve({ rows: [] }),
    ])
      .then(
        ([
          rows,
          travelPayload,
          confirmationPayload,
          delayPayload,
          reqPayload,
        ]: [
          Array<{ id: string; ticketNumber: string; title: string; status: string; updatedAt: string }>,
          {
            pendingApprovals?: Array<{
              id: string;
              kpiMaintenanceId: string;
              kpiTitle?: string | null;
              kpiMainTask?: string | null;
              orderRequest?: string;
              pendingLevel?: number | null;
              pendingLevelOptional?: boolean;
              updatedAt: string;
            }>;
          },
          {
            pendingConfirmations?: Array<{
              id: string;
              kpiMaintenanceId: string;
              kpiTitle?: string | null;
              kpiMainTask?: string | null;
              orderRequest?: string;
              updatedAt: string;
            }>;
          },
          {
            delayedPhases?: Array<{
              kpiMaintenanceId: string;
              kpiTitle: string;
              phaseId: string;
              phaseName: string;
              targetDate: string;
              href: string;
            }>;
          },
          {
            rows?: Array<{
              id: string;
              requestType: string;
              createdAt: string;
              portalAccount: { name: string; email: string };
            }>;
          },
        ]) => {
          if (ignore) return;
          const latestTickets = [...rows].sort(
            (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
          );
          setNotifications(latestTickets);
          setTravelOrderApprovals(
            (travelPayload.pendingApprovals ?? []).map((n) => ({
              id: n.id,
              kpiMaintenanceId: n.kpiMaintenanceId,
              kpiTitle: n.kpiTitle ?? null,
              kpiMainTask: n.kpiMainTask ?? null,
              orderRequest: n.orderRequest ?? "",
              pendingLevel: n.pendingLevel ?? null,
              pendingLevelOptional: n.pendingLevelOptional === true,
              updatedAt: n.updatedAt,
            })),
          );
          setTravelOrderConfirmations(
            (confirmationPayload.pendingConfirmations ?? []).map((n) => ({
              id: n.id,
              kpiMaintenanceId: n.kpiMaintenanceId,
              kpiTitle: n.kpiTitle ?? null,
              kpiMainTask: n.kpiMainTask ?? null,
              orderRequest: n.orderRequest ?? "",
              updatedAt: n.updatedAt,
            })),
          );
          setPhaseDelayAlerts(delayPayload.delayedPhases ?? []);
          setAccountRequestNotifications(isAdminRole ? (reqPayload.rows ?? []) : []);
        },
      )
      .catch(() => {
        if (!ignore) {
          setNotifications([]);
          setTravelOrderApprovals([]);
          setTravelOrderConfirmations([]);
          setPhaseDelayAlerts([]);
          setAccountRequestNotifications([]);
        }
      })
      .finally(() => {
        if (!ignore) setNotifLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [notifOpen, showUtilities, isAdminRole]);

  useEffect(() => {
    if (!showUtilities || !data?.user) return;
    if (typeof window === "undefined") return;
    const key = notifSeenTsKey(data.user.email ?? "unknown");
    const email = data.user.email ?? "unknown";
    const lastSeenMs = Number(window.localStorage.getItem(key) ?? "0") || 0;
    queueMicrotask(() => void refreshUnreadOpenCount(lastSeenMs, email));
    const timer = window.setInterval(() => {
      const latestSeen = Number(window.localStorage.getItem(key) ?? "0") || 0;
      void refreshUnreadOpenCount(latestSeen, email);
    }, 30000);
    return () => window.clearInterval(timer);
  }, [showUtilities, data?.user, refreshUnreadOpenCount]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (notifRef.current?.contains(target)) return;
      if (mobileNotifPanelRef.current?.contains(target)) return;
      if (desktopNotifPanelRef.current?.contains(target)) return;
      setNotifOpen(false);
    }
    if (notifOpen) document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [notifOpen]);

  useEffect(() => {
    if (!notifOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [notifOpen]);

  if (
    pathname === "/signin" ||
    pathname === "/signup" ||
    pathname === "/customer/signin" ||
    pathname === "/customer/signup"
  ) {
    return null;
  }

  const notifPanelBody = (
    <>
      <div className="flex items-center justify-between gap-2 px-2 py-1.5">
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Notifications
        </p>
        {unreadOpenCount > 0 ? (
          <button
            type="button"
            onClick={markAllNotificationsRead}
            className="shrink-0 text-[11px] font-medium text-orange-700 hover:underline dark:text-orange-300"
          >
            Mark all as Read
          </button>
        ) : null}
      </div>
      <div className="mt-1 max-h-[min(70dvh,calc(100dvh_-_9rem))] min-h-0 space-y-1 overflow-y-auto overscroll-contain">
        {notifLoading ? (
          <p className="px-2 py-6 text-center text-sm text-zinc-500 dark:text-zinc-500">Loading…</p>
        ) : notifications.length === 0 &&
          accountRequestNotifications.length === 0 &&
          travelOrderApprovals.length === 0 &&
          travelOrderConfirmations.length === 0 &&
          phaseDelayAlerts.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-zinc-500 dark:text-zinc-500">
            No recent notifications.
          </p>
        ) : (
          <>
            {phaseDelayAlerts.length > 0 ? (
              <div className="space-y-1">
                <p className="px-2 pt-1 text-[10px] font-bold uppercase tracking-[0.12em] text-rose-700 dark:text-rose-300">
                  Delayed project phases
                </p>
                {phaseDelayAlerts.map((n) => (
                  <Link
                    key={`phase-delay-${n.kpiMaintenanceId}-${n.phaseId}`}
                    href={n.href}
                    onClick={() => setNotifOpen(false)}
                    className="block rounded-lg border border-rose-300/60 bg-rose-50/80 px-3 py-2 text-left transition hover:bg-rose-100/80 dark:border-rose-500/30 dark:bg-rose-500/10 dark:hover:bg-rose-500/15"
                  >
                    <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                      {n.kpiTitle}
                    </p>
                    <p className="mt-0.5 text-[11px] text-rose-800 dark:text-rose-200">
                      {n.phaseName} delayed — target {n.targetDate}
                    </p>
                  </Link>
                ))}
              </div>
            ) : null}
            {travelOrderApprovals.length > 0 ? (
              <div className="space-y-1">
                <p className="px-2 pt-1 text-[10px] font-bold uppercase tracking-[0.12em] text-orange-700 dark:text-orange-300">
                  Travel order approvals
                </p>
                {travelOrderApprovals.map((n) => {
                  const isUnread = !seenTravelIds.has(n.id);
                  const label = n.kpiMainTask || n.kpiTitle || "Travel Order";
                  return (
                    <button
                      key={`to-approve-${n.id}`}
                      type="button"
                      onClick={() => {
                        setNotifOpen(false);
                        setTravelApprovalModal({
                          taskId: n.kpiMaintenanceId,
                          travelOrderId: n.id,
                          title: label,
                        });
                      }}
                      className={cn(
                        "block w-full rounded-lg border px-3 py-2 text-left transition",
                        isUnread
                          ? "border-orange-500/40 bg-orange-500/10 hover:bg-orange-500/15 dark:border-orange-500/30 dark:bg-orange-500/10 dark:hover:bg-orange-500/15"
                          : "border-zinc-200 bg-zinc-50 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-950/60 dark:hover:bg-zinc-800/70",
                      )}
                    >
                      <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                        Pending approval
                        {n.pendingLevel != null
                          ? ` · Level ${n.pendingLevel}${n.pendingLevelOptional ? " (optional)" : ""}`
                          : ""}
                      </p>
                      <p className="line-clamp-1 text-xs text-zinc-700 dark:text-zinc-300">
                        {label}
                      </p>
                      {n.orderRequest ? (
                        <p className="mt-0.5 line-clamp-2 text-[11px] text-zinc-600 dark:text-zinc-400">
                          {n.orderRequest}
                        </p>
                      ) : null}
                      <p className="mt-1 text-[11px] uppercase tracking-wide text-zinc-500 dark:text-zinc-500">
                        Awaiting you · <ElapsedFromIso iso={n.updatedAt} className="inline" />
                      </p>
                    </button>
                  );
                })}
              </div>
            ) : null}
            {travelOrderConfirmations.length > 0 ? (
              <div className="space-y-1">
                <p className="px-2 pt-1 text-[10px] font-bold uppercase tracking-[0.12em] text-sky-700 dark:text-sky-300">
                  Travel order confirmations
                </p>
                {travelOrderConfirmations.map((n) => {
                  const isUnread = !seenTravelIds.has(n.id);
                  const label = n.kpiMainTask || n.kpiTitle || "Travel Order";
                  return (
                    <button
                      key={`to-confirm-${n.id}`}
                      type="button"
                      onClick={() => {
                        setNotifOpen(false);
                        setTravelApprovalModal({
                          taskId: n.kpiMaintenanceId,
                          travelOrderId: n.id,
                          title: label,
                        });
                      }}
                      className={cn(
                        "block w-full rounded-lg border px-3 py-2 text-left transition",
                        isUnread
                          ? "border-sky-500/40 bg-sky-500/10 hover:bg-sky-500/15 dark:border-sky-500/30 dark:bg-sky-500/10 dark:hover:bg-sky-500/15"
                          : "border-zinc-200 bg-zinc-50 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-950/60 dark:hover:bg-zinc-800/70",
                      )}
                    >
                      <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                        Needs confirmation
                      </p>
                      <p className="line-clamp-1 text-xs text-zinc-700 dark:text-zinc-300">
                        {label}
                      </p>
                      {n.orderRequest ? (
                        <p className="mt-0.5 line-clamp-2 text-[11px] text-zinc-600 dark:text-zinc-400">
                          {n.orderRequest}
                        </p>
                      ) : null}
                      <p className="mt-1 text-[11px] uppercase tracking-wide text-zinc-500 dark:text-zinc-500">
                        Awaiting you · <ElapsedFromIso iso={n.updatedAt} className="inline" />
                      </p>
                    </button>
                  );
                })}
              </div>
            ) : null}
            {isAdminRole && accountRequestNotifications.length > 0 ? (
              <div className="space-y-1">
                <p className="px-2 pt-1 text-[10px] font-bold uppercase tracking-[0.12em] text-amber-700 dark:text-amber-300">
                  Account requests
                </p>
                {accountRequestNotifications.map((n) => (
                  <Link
                    key={n.id}
                    href="/admin/account"
                    onClick={() => setNotifOpen(false)}
                    className="block rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 hover:bg-amber-500/15 dark:border-amber-500/30 dark:bg-amber-500/10 dark:hover:bg-amber-500/15"
                  >
                    <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                      {n.requestType === "DELETION"
                        ? "Deletion request"
                        : n.requestType === "PASSWORD_RESET"
                          ? "Password reset request"
                          : "Suspension request"}
                    </p>
                    <p className="line-clamp-1 text-xs text-zinc-700 dark:text-zinc-300">
                      {n.portalAccount.name} · {n.portalAccount.email}
                    </p>
                    <p className="mt-1 text-[11px] uppercase tracking-wide text-zinc-500 dark:text-zinc-500">
                      Pending · <ElapsedFromIso iso={n.createdAt} className="inline" />
                    </p>
                  </Link>
                ))}
              </div>
            ) : null}
            {notifications.map((n) => (
              <AgentTicketDeepLink
                key={n.id}
                ticketId={n.id}
                onNavigate={() => setNotifOpen(false)}
                className="block rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-950/60 dark:hover:bg-zinc-800/70"
              >
                <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-200">{n.ticketNumber}</p>
                <p className="line-clamp-2 text-xs text-zinc-600 dark:text-zinc-400">{n.title}</p>
                <p className="mt-1 text-[11px] uppercase tracking-wide text-zinc-500 dark:text-zinc-500">
                  {n.status.replaceAll("_", " ")} ·{" "}
                  <ElapsedFromIso iso={n.updatedAt} className="inline" />
                </p>
              </AgentTicketDeepLink>
            ))}
          </>
        )}
      </div>
    </>
  );

  const mobileNotifOverlay =
    notifOpen && typeof document !== "undefined"
      ? createPortal(
          <>
            <button
              type="button"
              className="fixed inset-0 z-[200] bg-background sm:hidden"
              aria-label="Close notifications"
              onClick={() => setNotifOpen(false)}
            />
            <div
              ref={mobileNotifPanelRef}
              className="fixed inset-x-3 top-[calc(4.25rem_+_env(safe-area-inset-top,0px))] z-[201] flex max-h-[calc(100dvh_-_5.5rem_-_env(safe-area-inset-bottom,0px))] flex-col overflow-hidden rounded-[var(--radius-stoic-lg)] border border-border bg-[var(--surface-elevated)] p-2 shadow-[var(--shadow-elevated)] sm:hidden"
            >
              {notifPanelBody}
            </div>
          </>,
          document.body,
        )
      : null;

  return (
    <header className="relative z-50 shrink-0 overflow-visible border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="relative flex h-16 w-full min-w-0 items-center px-3 sm:px-4">
        {/* True horizontal center of the header — independent of side columns */}
        {showUtilities ? (
          <div className="pointer-events-none absolute inset-0 z-[1] flex items-center justify-center">
            <div className="pointer-events-auto">
              <PhilippineTimeClock className="shrink-0" />
            </div>
          </div>
        ) : null}

        {/* Stretch to the clock: half the header minus half the clock + a small gap */}
        <div
          className="relative z-[2] hidden min-w-0 shrink-0 pr-2 sm:block"
          style={{ width: "calc(50% - 5.25rem)" }}
        >
          {showUtilities ? (
            <GlobalSearchBar className="flex !w-full min-w-0 max-w-none [&>div]:h-10 [&>div]:!w-full [&>div]:gap-2.5 [&>div]:px-3.5" />
          ) : null}
        </div>

        <div className="relative z-[2] ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
          {showUtilities ? (
            <>
              <button
                type="button"
                onClick={() => openPalette()}
                className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl border border-zinc-300 bg-white text-zinc-700 shadow-sm transition hover:bg-zinc-100 sm:hidden dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
                aria-label="Open search"
                title="Search (Ctrl+K)"
              >
                <Search size={15} />
              </button>
              <div className="relative shrink-0" ref={notifRef}>
                <button
                  type="button"
                  onClick={() => {
                    setNotifOpen((v) => {
                      const next = !v;
                      if (next && typeof window !== "undefined") {
                        const key = notifSeenTsKey(data?.user?.email ?? "unknown");
                        const lastSeenMs = Number(window.localStorage.getItem(key) ?? "0") || 0;
                        void refreshUnreadOpenCount(lastSeenMs, data?.user?.email ?? "unknown");
                      }
                      return next;
                    });
                  }}
                  className="relative inline-flex size-9 items-center justify-center rounded-xl border border-zinc-300 bg-white text-zinc-800 shadow-sm transition hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
                  aria-label="Open notifications panel"
                  title="Open notifications panel"
                >
                  <Bell size={15} />
                  {unreadOpenCount > 0 ? (
                    <span className="absolute -right-1 -top-1 inline-flex min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold leading-4 text-white">
                      {unreadOpenCount > 9 ? "9+" : unreadOpenCount}
                    </span>
                  ) : null}
                </button>
                {notifOpen ? (
                  <div
                    ref={desktopNotifPanelRef}
                    className="absolute right-0 z-50 mt-2 hidden w-[min(360px,calc(100vw_-_2rem))] max-w-[calc(100vw_-_2rem)] max-h-[min(70dvh,calc(100dvh_-_6rem))] overflow-hidden stoic-card-elevated bg-[var(--surface-elevated)] p-2 sm:block"
                  >
                    {notifPanelBody}
                  </div>
                ) : null}
              </div>
              {mobileNotifOverlay}
              <Link
                href="/process"
                className="hidden size-9 shrink-0 items-center justify-center rounded-xl border border-zinc-300 bg-white text-zinc-700 shadow-sm transition hover:bg-zinc-100 sm:inline-flex dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
                aria-label="Open process controls"
                title="Open process controls"
              >
                <SlidersHorizontal size={15} />
              </Link>
              <PatchNotesControl visible={isElevatedPlatformRole(role)} />
            </>
          ) : null}
          <ThemeToggle />
          {!data?.user ? (
            <Link
              href="/signin"
              className="rounded-full bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-500"
            >
              Sign in
            </Link>
          ) : null}
        </div>
      </div>
      <TravelOrderApprovalModal
        open={travelApprovalModal != null}
        taskId={travelApprovalModal?.taskId ?? null}
        travelOrderId={travelApprovalModal?.travelOrderId ?? null}
        title={travelApprovalModal?.title}
        onClose={() => setTravelApprovalModal(null)}
        onUpdated={() => {
          const key = notifSeenTsKey(userEmail);
          const lastSeenMs =
            typeof window !== "undefined"
              ? Number(window.localStorage.getItem(key) ?? "0") || 0
              : 0;
          void refreshUnreadOpenCount(lastSeenMs, userEmail);
        }}
      />
    </header>
  );
}
