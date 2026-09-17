"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { StaffNotificationFeedItemView } from "@/components/notifications/StaffNotificationFeedItemView";
import { TravelOrderApprovalModal } from "@/components/task-board/TravelOrderApprovalModal";
import { SimplePaginationBar } from "@/components/ui/SimplePaginationBar";
import type { StaffNotificationFeedItem } from "@/lib/staff-notifications";

const PAGE_SIZE = 20;

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

export function NotificationsHistoryClient({ userEmail }: { userEmail: string }) {
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<StaffNotificationFeedItem[]>([]);
  const [total, setTotal] = useState(0);
  const [seenTravelIds, setSeenTravelIds] = useState<Set<string>>(() => new Set());
  const [travelApprovalModal, setTravelApprovalModal] = useState<{
    taskId: string;
    travelOrderId: string;
    title: string;
  } | null>(null);

  const load = useCallback(async (nextPage: number) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(nextPage),
        pageSize: String(PAGE_SIZE),
      });
      const res = await fetch(`/api/notifications/feed?${params.toString()}`, { cache: "no-store" });
      if (!res.ok) {
        setItems([]);
        setTotal(0);
        return;
      }
      const payload = (await res.json()) as {
        items?: StaffNotificationFeedItem[];
        total?: number;
        page?: number;
      };
      setItems(payload.items ?? []);
      setTotal(Math.max(0, Number(payload.total ?? 0) || 0));
      setPage(Math.max(1, Number(payload.page ?? nextPage) || nextPage));
    } catch {
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setSeenTravelIds(readTravelSeenIds(userEmail));
  }, [userEmail]);

  useEffect(() => {
    void load(page);
  }, [load, page]);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-6 sm:px-6">
      <div className="space-y-1">
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">
          <Link href="/agent" className="hover:text-orange-600 dark:hover:text-orange-300">
            Home
          </Link>
          <span className="mx-1.5 text-zinc-400">/</span>
          Notification history
        </p>
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Notification history
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Full list of request, travel, and account alerts for your workspace.
        </p>
      </div>

      <div className="overflow-hidden rounded-[var(--radius-stoic-lg)] border border-border bg-[var(--surface-elevated)] shadow-[var(--shadow-elevated)]">
        <div className="min-h-[12rem] space-y-1 p-2">
          {loading ? (
            <p className="px-2 py-10 text-center text-sm text-zinc-500">Loading…</p>
          ) : items.length === 0 ? (
            <p className="px-2 py-10 text-center text-sm text-zinc-500">No notifications yet.</p>
          ) : (
            items.map((item) => (
              <StaffNotificationFeedItemView
                key={item.key}
                item={item}
                seenTravelIds={seenTravelIds}
                onOpenTravel={(args) => setTravelApprovalModal(args)}
              />
            ))
          )}
        </div>
        <SimplePaginationBar
          page={page}
          pageSize={PAGE_SIZE}
          total={total}
          onPageChange={setPage}
          itemLabel="notifications"
        />
      </div>

      <TravelOrderApprovalModal
        open={travelApprovalModal != null}
        taskId={travelApprovalModal?.taskId ?? null}
        travelOrderId={travelApprovalModal?.travelOrderId ?? null}
        title={travelApprovalModal?.title}
        onClose={() => setTravelApprovalModal(null)}
        onUpdated={() => void load(page)}
      />
    </div>
  );
}
