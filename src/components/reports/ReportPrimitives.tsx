import Link from "next/link";
import { cn } from "@/lib/cn";

export type ReportStat = {
  id: string;
  label: string;
  value: string | number;
  hint?: string;
  href?: string;
  tone?: "default" | "warning" | "danger" | "good";
};

const TONE_CLASS: Record<NonNullable<ReportStat["tone"]>, string> = {
  default: "text-zinc-900 dark:text-zinc-100",
  warning: "text-amber-700 dark:text-amber-300",
  danger: "text-rose-700 dark:text-rose-300",
  good: "text-emerald-700 dark:text-emerald-300",
};

export function ReportStatGrid({ stats }: { stats: ReportStat[] }) {
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
      {stats.map((stat) => {
        const body = (
          <>
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500">{stat.label}</p>
            <p className={cn("mt-1 text-2xl font-bold tabular-nums", TONE_CLASS[stat.tone ?? "default"])}>
              {stat.value}
            </p>
            {stat.hint ? <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">{stat.hint}</p> : null}
          </>
        );
        const className =
          "rounded-xl border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900";
        return stat.href ? (
          <Link key={stat.id} href={stat.href} className={cn(className, "hover:border-orange-400/60")}>
            {body}
          </Link>
        ) : (
          <div key={stat.id} className={className}>
            {body}
          </div>
        );
      })}
    </div>
  );
}

export function ReportCard({
  title,
  subtitle,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "min-w-0 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900",
        className,
      )}
    >
      <h2 className="text-[11px] font-bold uppercase tracking-[0.16em] text-zinc-500">{title}</h2>
      {subtitle ? <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{subtitle}</p> : null}
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** Two-series column chart (e.g. created vs resolved per bucket). */
export function ReportTrendBars({
  rows,
  series,
}: {
  rows: Array<{ key: string; label: string; values: [number, number] }>;
  series: [{ label: string; className: string }, { label: string; className: string }];
}) {
  const max = Math.max(1, ...rows.flatMap((r) => r.values));
  const labelEvery = Math.max(1, Math.ceil(rows.length / 10));
  return (
    <div>
      <div className="mb-2 flex gap-3 text-[11px] text-zinc-600 dark:text-zinc-400">
        {series.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-1">
            <span className={cn("inline-block size-2.5 rounded-sm", s.className)} aria-hidden />
            {s.label}
          </span>
        ))}
      </div>
      <div className="flex h-40 items-end gap-px overflow-x-auto">
        {rows.map((row, i) => (
          <div
            key={row.key}
            className="flex h-full min-w-[10px] flex-1 flex-col justify-end"
            title={`${row.label}: ${series[0].label} ${row.values[0]}, ${series[1].label} ${row.values[1]}`}
          >
            <div className="flex h-full items-end gap-px">
              {row.values.map((v, idx) => (
                <div
                  key={idx}
                  className={cn("w-1/2 rounded-t-sm", series[idx]!.className)}
                  style={{ height: `${(v / max) * 100}%`, minHeight: v > 0 ? 2 : 0 }}
                />
              ))}
            </div>
            <span className="mt-1 h-3 truncate text-center text-[9px] text-zinc-500">
              {i % labelEvery === 0 ? row.label : ""}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Horizontal bars for a breakdown (status, aging, assignee load…). */
export function ReportBarList({
  rows,
  barClassName = "bg-orange-500/70",
  emptyMessage = "No data in this range.",
}: {
  rows: Array<{ key: string; label: string; value: number; display?: string; href?: string }>;
  barClassName?: string;
  emptyMessage?: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (rows.every((r) => r.value === 0)) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">{emptyMessage}</p>;
  }
  return (
    <ul className="space-y-1.5">
      {rows.map((row) => {
        const label = row.href ? (
          <Link href={row.href} className="truncate hover:underline">
            {row.label}
          </Link>
        ) : (
          <span className="truncate">{row.label}</span>
        );
        return (
          <li key={row.key} className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)_3.5rem] items-center gap-2 text-xs">
            <span className="flex min-w-0 text-zinc-700 dark:text-zinc-300">{label}</span>
            <span className="h-2.5 rounded-full bg-zinc-100 dark:bg-zinc-800">
              <span
                className={cn("block h-full rounded-full", barClassName)}
                style={{ width: `${(row.value / max) * 100}%` }}
              />
            </span>
            <span className="text-right tabular-nums text-zinc-700 dark:text-zinc-300">
              {row.display ?? row.value}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function ReportTable({
  head,
  rows,
  emptyMessage = "No data in this range.",
}: {
  head: string[];
  rows: Array<{ key: string; cells: React.ReactNode[] }>;
  emptyMessage?: string;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">{emptyMessage}</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[32rem] text-left text-xs">
        <thead>
          <tr className="border-b border-zinc-200 text-[10px] uppercase tracking-[0.12em] text-zinc-500 dark:border-zinc-800">
            {head.map((h, i) => (
              <th key={h} className={cn("py-1.5 pr-3 font-bold", i > 0 && "text-right")}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60">
              {row.cells.map((cell, i) => (
                <td
                  key={i}
                  className={cn(
                    "py-1.5 pr-3 text-zinc-700 dark:text-zinc-300",
                    i > 0 && "text-right tabular-nums",
                  )}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** "All companies" is summary-only: per-person breakdowns need one company from the switcher. */
export function ReportAllCompaniesNotice({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <p className="rounded-lg border border-sky-400/40 bg-sky-500/10 px-3 py-2 text-xs text-sky-900 dark:text-sky-100">
      All companies: summary counts only. Pick a company in the sidebar switcher for team, assignee, and
      per-person breakdowns.
    </p>
  );
}

export function ReportTruncatedNotice({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <p className="rounded-lg border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-100">
      This range hit the report row limit — narrow the dates or company for exact totals.
    </p>
  );
}
