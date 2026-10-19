"use client";

import { useEffect, useState } from "react";

type PendingAccountRequestRow = {
  id: string;
  requestType: string;
  reason: string | null;
  status: string;
  createdAt: string;
  portalAccount: { id: string; name: string; email: string; role: string };
};

/**
 * Workforce ops queue: approve suspension, deletion, or password reset requests.
 * Extracted from the removed Employee registry (ListView) so the review flow
 * stays available from the Workforce Activity / Org. Chart surfaces.
 */
export function PendingAccountRequestsPanel() {
  const [error, setError] = useState<string | null>(null);
  const [requests, setRequests] = useState<PendingAccountRequestRow[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function fetchPending(): Promise<PendingAccountRequestRow[] | null> {
    const res = await fetch("/api/admin/account-requests", { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as { rows?: PendingAccountRequestRow[] };
    return (data.rows ?? []).filter((r) => r.status === "PENDING");
  }

  async function review(id: string, status: "APPROVED" | "REJECTED") {
    setError(null);
    setBusyId(id);
    try {
      const res = await fetch("/api/admin/account-requests", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(payload.error ?? "Could not update request.");
        return;
      }
      const rows = await fetchPending();
      if (rows) setRequests(rows);
    } finally {
      setBusyId(null);
    }
  }

  useEffect(() => {
    let stopped = false;
    async function load() {
      const rows = await fetchPending();
      if (!stopped && rows) setRequests(rows);
    }
    void load();
    return () => {
      stopped = true;
    };
  }, []);

  if (requests.length === 0 && !error) return null;

  return (
    <section className="space-y-3">
      {error ? (
        <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      ) : null}
      {requests.length > 0 ? (
        <div className="rounded-xl border border-amber-400/40 bg-amber-500/[0.07] p-4 dark:border-amber-500/30 dark:bg-amber-500/[0.06]">
          <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-amber-900 dark:text-amber-200/90">
            Pending account requests
          </h2>
          <p className="mt-0.5 text-[11px] text-amber-800/90 dark:text-amber-100/70">
            Approve suspension, deletion, or password reset (default password applied on approval).
          </p>
          <ul className="mt-3 space-y-2">
            {requests.map((r) => (
              <li
                key={r.id}
                className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="text-sm font-semibold text-zinc-900 dark:text-white">
                    {r.requestType === "PASSWORD_RESET"
                      ? "Password reset"
                      : r.requestType === "DELETION"
                        ? "Account deletion"
                        : "Account suspension"}{" "}
                    · {r.portalAccount.name}
                  </p>
                  <p className="text-xs text-zinc-600 dark:text-zinc-400">{r.portalAccount.email}</p>
                  {r.reason?.trim() ? (
                    <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">{r.reason}</p>
                  ) : null}
                  <p className="mt-1 text-[11px] text-zinc-500">
                    {new Date(r.createdAt).toLocaleString()}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    disabled={busyId === r.id}
                    onClick={() => void review(r.id, "REJECTED")}
                    className="rounded-full border border-zinc-300 px-4 py-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
                  >
                    Reject
                  </button>
                  <button
                    type="button"
                    disabled={busyId === r.id}
                    onClick={() => void review(r.id, "APPROVED")}
                    className="rounded-full bg-orange-600 px-4 py-2 text-xs font-semibold text-white hover:bg-orange-500 disabled:opacity-50"
                  >
                    Approve
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
