"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AlertCircle, ArrowRight, ClipboardCheck, Pin, X } from "lucide-react";
import { useSession } from "next-auth/react";
import { cn } from "@/lib/cn";
import { formatTicketStatusLabel } from "@/lib/ticket-status-label";
import { isTicketRequestorRole } from "@/lib/ticket-requestor";

type PendingTicket = {
  id: string;
  ticketNumber: string;
  title: string;
  status: string;
  updatedAt: string;
  verificationHref: string;
  remarks?: string | null;
  hasRemarks?: boolean;
};

const AUTH_PATHS = new Set(["/signin", "/signup", "/customer/signin", "/customer/signup"]);

function dismissedStorageKey(userKey: string) {
  return `pending-confirmation-dismissed:${userKey}`;
}

function readDismissedTicketIds(userKey: string): Set<string> {
  try {
    const raw = window.sessionStorage.getItem(dismissedStorageKey(userKey));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === "string"));
  } catch {
    return new Set();
  }
}

function writeDismissedTicketIds(userKey: string, ids: string[]) {
  window.sessionStorage.setItem(dismissedStorageKey(userKey), JSON.stringify(ids));
}

function isVerificationPath(pathname: string) {
  return pathname.includes("/verification") || pathname.startsWith("/customer/verification");
}

export function PendingConfirmationLoginModal() {
  const pathname = usePathname();
  const { data: session, status } = useSession();
  const [tickets, setTickets] = useState<PendingTicket[]>([]);
  const [fetchState, setFetchState] = useState<"idle" | "loading" | "ready">("idle");
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => new Set());
  const [open, setOpen] = useState(false);
  const [expandedRemarksId, setExpandedRemarksId] = useState<string | null>(null);

  const role = session?.user?.role;
  const userKey = (session?.user?.email ?? "user").trim().toLowerCase();
  const shouldCheck =
    status === "authenticated" &&
    isTicketRequestorRole(role) &&
    !AUTH_PATHS.has(pathname) &&
    !isVerificationPath(pathname);

  useEffect(() => {
    if (!shouldCheck) return;

    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch("/api/me/pending-confirmation", { cache: "no-store" });
        const payload = (await res.json().catch(() => ({}))) as { tickets?: PendingTicket[] };
        if (cancelled) return;

        const rows = Array.isArray(payload.tickets) ? payload.tickets : [];
        const dismissed = readDismissedTicketIds(userKey);
        setTickets(rows);
        setDismissedIds(dismissed);
        const pending = rows.filter((ticket) => !dismissed.has(ticket.id));
        setOpen(pending.length > 0);
        setFetchState("ready");
      } catch {
        if (!cancelled) {
          setTickets([]);
          setOpen(false);
          setFetchState("ready");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [shouldCheck, userKey, pathname]);

  const visibleTickets = useMemo(
    () => tickets.filter((ticket) => !dismissedIds.has(ticket.id)),
    [tickets, dismissedIds],
  );

  function dismissForSession() {
    const next = new Set(dismissedIds);
    for (const ticket of visibleTickets) next.add(ticket.id);
    writeDismissedTicketIds(userKey, [...next]);
    setDismissedIds(next);
    setExpandedRemarksId(null);
    setOpen(false);
  }

  if (!shouldCheck || !open || visibleTickets.length === 0 || fetchState !== "ready") return null;

  const primaryTicket = visibleTickets[0];
  const multiple = visibleTickets.length > 1;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 px-4 py-6 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pending-confirmation-title"
    >
      <div
        className={cn(
          "relative w-full overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl",
          "dark:border-zinc-700 dark:bg-[#10100f]",
          multiple ? "max-w-xl" : "max-w-lg",
        )}
      >
        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-orange-500 via-amber-400 to-orange-600" />

        <button
          type="button"
          onClick={dismissForSession}
          className="absolute right-4 top-4 rounded-full border border-zinc-200 p-1.5 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          aria-label="Dismiss for now"
        >
          <X className="size-4" />
        </button>

        <div className="p-6 pt-7 sm:p-7">
          <div className="flex items-start gap-4">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-orange-500/15 text-orange-600 dark:bg-orange-500/20 dark:text-orange-300">
              <ClipboardCheck className="size-6" aria-hidden />
            </div>
            <div className="min-w-0 pr-8">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-orange-600 dark:text-orange-300">
                Action required
              </p>
              <h2
                id="pending-confirmation-title"
                className="mt-1 text-xl font-bold tracking-tight text-zinc-950 dark:text-zinc-50 sm:text-2xl"
              >
                {multiple ? "Tickets need your confirmation" : "A ticket needs your confirmation"}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                {multiple
                  ? "Review and confirm these resolved requests before opening new ones."
                  : "Your support team marked this request as resolved. Confirm the outcome to close the ticket."}
              </p>
            </div>
          </div>

          <div className="mt-5 space-y-2">
            {visibleTickets.map((ticket) => {
              const remarksText = (ticket.remarks ?? "").trim();
              const showPin =
                ticket.hasRemarks === true ||
                (remarksText.length > 0 &&
                  (ticket.status === "FOR_CONFIRMATION" || ticket.status === "RESOLVED"));
              const remarksOpen = expandedRemarksId === ticket.id;

              return (
                <div
                  key={ticket.id}
                  className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900/70"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-mono text-sm font-bold text-zinc-950 dark:text-zinc-100">
                          {ticket.ticketNumber}
                        </p>
                        <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-amber-800 dark:text-amber-200">
                          {formatTicketStatusLabel(ticket.status)}
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-sm text-zinc-700 dark:text-zinc-300">
                        {ticket.title}
                      </p>
                    </div>
                    {showPin ? (
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedRemarksId((id) => (id === ticket.id ? null : ticket.id))
                        }
                        className={cn(
                          "relative shrink-0 rounded-full border p-2 transition",
                          remarksOpen
                            ? "border-orange-500/50 bg-orange-500/15 text-orange-700 dark:text-orange-200"
                            : "border-zinc-300 bg-white text-orange-600 hover:bg-orange-50 dark:border-zinc-600 dark:bg-zinc-950 dark:text-orange-300 dark:hover:bg-zinc-800",
                        )}
                        aria-expanded={remarksOpen}
                        aria-label={remarksOpen ? "Hide remarks" : "Show remarks"}
                        title={remarksOpen ? "Hide remarks" : "Show remarks"}
                      >
                        <Pin className="size-4" aria-hidden />
                        <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-orange-500" />
                      </button>
                    ) : null}
                  </div>

                  {remarksOpen && remarksText ? (
                    <div className="mt-3 rounded-lg border border-orange-500/25 bg-orange-500/5 px-3 py-2 dark:border-orange-400/20 dark:bg-orange-500/10">
                      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-orange-700 dark:text-orange-300">
                        Remarks
                      </p>
                      <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-800 dark:text-zinc-100">
                        {remarksText}
                      </p>
                    </div>
                  ) : null}

                  {multiple ? (
                    <Link
                      href={ticket.verificationHref}
                      onClick={dismissForSession}
                      className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-orange-600 hover:text-orange-500 dark:text-orange-300 dark:hover:text-orange-200"
                    >
                      Review this ticket
                      <ArrowRight className="size-3.5" />
                    </Link>
                  ) : null}
                </div>
              );
            })}
          </div>

          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={dismissForSession}
              className="inline-flex items-center justify-center rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              Remind me later
            </button>
            <Link
              href={primaryTicket.verificationHref}
              onClick={dismissForSession}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(249,115,22,0.28)] transition hover:bg-orange-400"
            >
              {multiple ? "Review first ticket" : "Review and confirm"}
              <ArrowRight className="size-4" />
            </Link>
          </div>

          <p className="mt-4 flex items-start gap-2 text-xs text-zinc-500 dark:text-zinc-500">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            You will not be able to submit a new request until confirmed tickets are closed.
          </p>
        </div>
      </div>
    </div>
  );
}
