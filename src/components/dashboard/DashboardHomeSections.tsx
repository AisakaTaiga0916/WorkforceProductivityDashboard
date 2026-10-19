import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/cn";

export type SummaryCard = {
  id: string;
  label: string;
  value: string | number;
  href?: string;
  tone?: "default" | "warning" | "danger" | "success";
};

const toneClasses: Record<NonNullable<SummaryCard["tone"]>, string> = {
  default: "border-zinc-200 dark:border-zinc-800",
  warning: "border-amber-300/70 dark:border-amber-700/50",
  danger: "border-rose-300/70 dark:border-rose-800/50",
  success: "border-emerald-300/70 dark:border-emerald-800/50",
};

export function DashboardSummaryCards({
  cards,
  className,
}: {
  cards: SummaryCard[];
  className?: string;
}) {
  return (
    <section className={cn("grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3", className)}>
      {cards.map((card) => {
        const body = (
          <article
            className={cn(
              "flex h-full min-h-[4.75rem] flex-col justify-between rounded-xl border bg-white p-2.5 shadow-sm sm:min-h-0 sm:rounded-2xl sm:p-4 dark:bg-zinc-900",
              toneClasses[card.tone ?? "default"],
            )}
          >
            <p className="line-clamp-2 text-[9px] font-bold uppercase leading-snug tracking-[0.1em] text-zinc-500 sm:text-[10px] sm:tracking-[0.12em]">
              {card.label}
            </p>
            <p className="mt-1.5 text-xl font-bold leading-none tabular-nums text-zinc-900 sm:mt-2 sm:text-3xl dark:text-zinc-100">
              {card.value}
            </p>
          </article>
        );
        if (!card.href) return <div key={card.id} className="min-w-0">{body}</div>;
        return (
          <Link
            key={card.id}
            href={card.href}
            className="group min-w-0 transition hover:-translate-y-0.5"
          >
            {body}
          </Link>
        );
      })}
    </section>
  );
}

export function DashboardActionList({
  id,
  title,
  emptyMessage,
  items,
  viewAllHref,
}: {
  id?: string;
  title: string;
  emptyMessage: string;
  items: Array<{
    id: string;
    title: string;
    subtitle?: string;
    href: string;
    status?: string;
    badge?: string;
    slaState?: "ON_TRACK" | "AT_RISK" | "BREACHED";
    priority?: string;
  }>;
  viewAllHref?: string;
}) {
  return (
    <article
      id={id}
      className="scroll-mt-20 rounded-xl border border-zinc-200 bg-white p-3.5 shadow-sm sm:rounded-2xl sm:p-5 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="mb-3 flex items-center justify-between gap-2 sm:mb-4">
        <h2 className="text-[11px] font-bold uppercase tracking-[0.16em] text-zinc-500 sm:text-sm">{title}</h2>
        {viewAllHref ? (
          <Link href={viewAllHref} className="text-xs font-semibold text-orange-700 hover:underline dark:text-orange-300">
            View all
          </Link>
        ) : null}
      </div>
      <div className="space-y-2">
        {items.length === 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-500">{emptyMessage}</p>
        ) : (
          items.map((item) => (
            <Link
              key={item.id}
              href={item.href}
              className="flex items-start gap-3 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-3 transition hover:border-orange-400/50 hover:bg-orange-50/50 dark:border-zinc-700 dark:bg-zinc-950/60 dark:hover:border-orange-500/40 dark:hover:bg-orange-950/20"
            >
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    {item.title}
                  </span>
                  {item.badge ? (
                    <span className="rounded-full border border-zinc-200 bg-white px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400">
                      {item.badge}
                    </span>
                  ) : null}
                  {item.status ? (
                    <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide", statusTagClass(item.status))}>
                      {item.status}
                    </span>
                  ) : null}
                  {item.slaState === "BREACHED" ? (
                    <span className="rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-rose-800 dark:bg-rose-950/50 dark:text-rose-200">
                      Overdue
                    </span>
                  ) : item.slaState === "AT_RISK" ? (
                    <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                      SLA risk
                    </span>
                  ) : null}
                </span>
                {item.subtitle ? (
                  <span className="mt-0.5 block truncate text-xs text-zinc-600 dark:text-zinc-400">
                    {item.subtitle}
                  </span>
                ) : null}
                {item.priority ? (
                  <span className="mt-1 flex flex-wrap gap-2 text-[11px] text-zinc-500">
                    <span>{item.priority}</span>
                  </span>
                ) : null}
              </span>
              <ArrowRight className="mt-1 size-4 shrink-0 text-zinc-400" aria-hidden />
            </Link>
          ))
        )}
      </div>
    </article>
  );
}

function statusTagClass(status: string) {
  const key = status.trim().toLowerCase();
  if (key === "done" || key === "closed" || key === "resolved") {
    return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200";
  }
  if (key === "pending" || key === "open" || key === "awaiting approval" || key === "awaiting confirmation") {
    return "bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200";
  }
  if (key.includes("progress") || key === "current") {
    return "bg-sky-100 text-sky-900 dark:bg-sky-950/40 dark:text-sky-200";
  }
  if (key === "delayed" || key === "escalated") {
    return "bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-200";
  }
  return "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
}

export function DashboardQuickCreate({
  actions,
}: {
  actions: Array<{ id: string; label: string; href: string; subtitle?: string }>;
}) {
  return (
    <section className="rounded-2xl border border-orange-300/40 bg-orange-50/70 p-4 dark:border-orange-800/40 dark:bg-orange-950/20">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-orange-800 dark:text-orange-300">
            Create request
          </p>
          <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">Start something new</h2>
        </div>
        <Link
          href="/tickets/new"
          className="inline-flex items-center justify-center rounded-xl bg-orange-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-orange-500"
        >
          + Create Request
        </Link>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {actions.map((action) => (
          <Link
            key={action.id}
            href={action.href}
            className="rounded-xl border border-zinc-200 bg-white px-3 py-3 transition hover:border-orange-400/60 hover:bg-white dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-orange-500/40"
          >
            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{action.label}</p>
            {action.subtitle ? (
              <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">{action.subtitle}</p>
            ) : null}
          </Link>
        ))}
      </div>
    </section>
  );
}

export function DashboardRecentActivity({
  items,
}: {
  items: Array<{
    id: string;
    ticketNumber: string;
    title: string;
    summary: string;
    createdAt: string;
    href: string;
  }>;
}) {
  return (
    <article className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-sm font-bold uppercase tracking-[0.16em] text-zinc-500">Recent activity</h2>
      <ul className="mt-4 space-y-3">
        {items.length === 0 ? (
          <li className="text-sm text-zinc-600 dark:text-zinc-500">No recent activity yet.</li>
        ) : (
          items.map((item) => (
            <li key={item.id} className="border-b border-zinc-200 pb-3 last:border-0 last:pb-0 dark:border-zinc-800">
              <Link href={item.href} className="group block">
                <p className="text-sm font-semibold text-zinc-900 group-hover:text-orange-700 dark:text-zinc-100 dark:group-hover:text-orange-300">
                  {item.ticketNumber} · {item.title}
                </p>
                <p className="mt-0.5 line-clamp-2 text-xs text-zinc-600 dark:text-zinc-400">{item.summary}</p>
                <p className="mt-1 text-[11px] text-zinc-500">
                  {new Date(item.createdAt).toLocaleString(undefined, {
                    dateStyle: "short",
                    timeStyle: "short",
                  })}
                </p>
              </Link>
            </li>
          ))
        )}
      </ul>
    </article>
  );
}

export function DashboardFilterPills({
  pills,
}: {
  pills: Array<{ id: string; label: string; href: string }>;
}) {
  return (
    <div className="-mx-3 overflow-x-auto overscroll-x-contain px-3 sm:mx-0 sm:overflow-visible sm:px-0">
      <div className="flex w-max gap-2 sm:w-auto sm:flex-wrap">
        {pills.map((pill) => (
          <Link
            key={pill.id}
            href={pill.href}
            className="inline-flex shrink-0 items-center rounded-full border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 transition hover:border-orange-400 hover:text-orange-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-orange-500/50 dark:hover:text-orange-200"
          >
            {pill.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

function formatResponseDuration(totalMinutes: number) {
  const minutes = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(minutes / 60);
  const remainderMinutes = minutes % 60;
  if (hours === 0) return `${remainderMinutes}m`;
  if (remainderMinutes === 0) return `${hours}h`;
  return `${hours}h ${remainderMinutes}m`;
}

export function formatDashboardResponseDuration(minutes: number) {
  return formatResponseDuration(minutes);
}
