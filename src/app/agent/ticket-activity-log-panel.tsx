import Link from "next/link";
import { AgentTicketDeepLink } from "@/components/AgentTicketDeepLink";
import type { TicketLogEntry } from "@/modules/requests/ticket-activity-log";
import { formatRelativeAgo } from "@/modules/requests/ticket-board-formatters";

export function TicketActivityLogPanel({
  entries,
  linkTickets = true,
  pagination,
}: {
  entries: TicketLogEntry[];
  /** Personnel cannot open arbitrary tickets — show plain ticket numbers instead of links. */
  linkTickets?: boolean;
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
    prevHref: string;
    nextHref: string;
  };
}) {
  const totalPages = pagination ? Math.max(1, Math.ceil(pagination.total / pagination.pageSize)) : 1;
  const safePage = pagination ? Math.min(Math.max(1, pagination.page), totalPages) : 1;
  const start = pagination && pagination.total > 0 ? (safePage - 1) * pagination.pageSize + 1 : 0;
  const end = pagination ? Math.min(pagination.total, safePage * pagination.pageSize) : entries.length;
  const showPagination = Boolean(pagination && pagination.total > pagination.pageSize);

  return (
    <section className="mt-8 rounded-2xl border border-zinc-200 bg-white p-5 shadow-[0_8px_28px_rgba(0,0,0,0.06)] dark:border-zinc-800 dark:bg-surface dark:shadow-[0_10px_30px_rgba(0,0,0,0.25)]">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-zinc-200 pb-4 dark:border-zinc-800">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-[0.16em] text-zinc-700 dark:text-zinc-300">
            Request activity log
          </h2>
        </div>
      </div>

      {entries.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-zinc-300 px-4 py-10 text-center text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-500">
          No activity to show for this scope yet.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-zinc-200 dark:divide-zinc-800">
          {entries.map((e) => (
            <li key={e.id} className="flex flex-col gap-1 py-3 first:pt-0 sm:flex-row sm:items-start sm:gap-4">
              <div className="shrink-0 text-[11px] text-zinc-500 dark:text-zinc-500">
                <time dateTime={e.createdAt.toISOString()}>{formatRelativeAgo(e.createdAt)}</time>
                <p className="mt-0.5 font-mono text-[10px] text-zinc-600 dark:text-zinc-400">{e.actor}</p>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  {linkTickets ? (
                    <AgentTicketDeepLink
                      ticketId={e.ticketId}
                      className="font-mono text-xs font-semibold text-orange-700 hover:underline dark:text-orange-400"
                    >
                      {e.ticketNumber}
                    </AgentTicketDeepLink>
                  ) : (
                    <span className="font-mono text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                      {e.ticketNumber}
                    </span>
                  )}
                  <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{e.summary}</span>
                </div>
                {e.detail ? (
                  <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
                    {e.detail}
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      {showPagination && pagination ? (
        <div className="mt-4 flex flex-col gap-2 border-t border-zinc-200 pt-3 text-[11px] text-zinc-600 sm:flex-row sm:items-center sm:justify-between dark:border-zinc-800 dark:text-zinc-400">
          <p>
            Showing{" "}
            <span className="font-semibold text-zinc-800 dark:text-zinc-200">
              {start}-{end}
            </span>{" "}
            of <span className="font-semibold text-zinc-800 dark:text-zinc-200">{pagination.total}</span> logs
          </p>
          <div className="flex items-center gap-2">
            {safePage <= 1 ? (
              <span className="rounded-md border border-zinc-300 bg-white px-2.5 py-1 font-medium text-zinc-800 opacity-40 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200">
                Previous
              </span>
            ) : (
              <Link
                href={pagination.prevHref}
                className="rounded-md border border-zinc-300 bg-white px-2.5 py-1 font-medium text-zinc-800 shadow-sm hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                Previous
              </Link>
            )}
            <span className="tabular-nums text-zinc-500 dark:text-zinc-500">
              Page {safePage} / {totalPages}
            </span>
            {safePage >= totalPages ? (
              <span className="rounded-md border border-zinc-300 bg-white px-2.5 py-1 font-medium text-zinc-800 opacity-40 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200">
                Next
              </span>
            ) : (
              <Link
                href={pagination.nextHref}
                className="rounded-md border border-zinc-300 bg-white px-2.5 py-1 font-medium text-zinc-800 shadow-sm hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                Next
              </Link>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
