"use client";

import type { Ticket, TicketFeedback } from "@prisma/client/primary";
import Link from "next/link";
import { CancelRequestButton } from "@/components/tickets/CancelRequestButton";

type TicketWithRelations = Ticket & { feedback: TicketFeedback | null };

export function CustomerTicketPanel({
  ticket,
  canCancelRequest = false,
}: {
  ticket: TicketWithRelations;
  canCancelRequest?: boolean;
}) {
  const canCancel = canCancelRequest && !ticket.assignedAgentId && ticket.status !== "CLOSED";

  return (
    <div className="space-y-4">
      {canCancel ? (
        <article className="rounded-2xl border border-rose-400/40 bg-rose-500/5 p-4 shadow-[0_12px_32px_rgba(15,23,42,0.08)] dark:border-rose-500/30 dark:bg-rose-950/20 sm:p-5">
          <h2 className="text-xs font-bold uppercase tracking-[0.16em] text-rose-800 dark:text-rose-300">
            Cancel request
          </h2>
          <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
            This request has no assignee yet. You can cancel it to withdraw it from the queue.
          </p>
          <CancelRequestButton
            ticketId={ticket.id}
            ticketNumber={ticket.ticketNumber}
            className="mt-3"
          />
        </article>
      ) : null}

      {ticket.status === "FOR_CONFIRMATION" || ticket.status === "RESOLVED" ? (
        <article className="rounded-2xl border border-orange-500/40 bg-orange-500/10 p-4 shadow-[0_12px_32px_rgba(15,23,42,0.08)] sm:p-5 dark:border-orange-500/40">
          <h2 className="text-xs font-bold uppercase tracking-[0.16em] text-orange-800 dark:text-orange-200">
            Verification required
          </h2>
          <p className="mt-2 text-sm text-orange-900/80 dark:text-orange-100/80">
            A confirmation email was sent to your requestor email. Verify first, then submit your star rating.
          </p>
          <Link
            href={`/tickets/${ticket.id}/verification`}
            className="mt-4 inline-flex w-full items-center justify-center rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-orange-500"
          >
            Verify resolution
          </Link>
        </article>
      ) : null}

      {ticket.feedback ? (
        <article className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-[0_12px_32px_rgba(15,23,42,0.08)] sm:p-5 dark:border-zinc-800 dark:bg-surface dark:shadow-[0_10px_30px_rgba(0,0,0,0.25)]">
          <h2 className="text-xs font-bold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-500">
            Recorded feedback
          </h2>
          <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">
            CSAT: {ticket.feedback.csat}/5
          </p>
          {ticket.feedback.comment ? (
            <p className="mt-2 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm break-words text-zinc-700 dark:border-zinc-800 dark:bg-[#181716] dark:text-zinc-200">
              {ticket.feedback.comment}
            </p>
          ) : (
            <p className="mt-2 text-sm text-zinc-500">No additional comment was submitted.</p>
          )}
        </article>
      ) : null}
    </div>
  );
}
