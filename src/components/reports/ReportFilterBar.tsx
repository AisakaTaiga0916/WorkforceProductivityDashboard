"use client";

/**
 * Shared report filter bar (Requests → Reports and Work → Reports lenses).
 * - Company is context from the shell switcher — shown as text, never a second picker.
 * - Date presets; custom from/to only behind "Custom".
 * - Every change writes the URL (`?range=&team=…`), which is the only state.
 * - Mobile: presets stay visible; dimension filters sit behind one "Filters" toggle.
 */

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/cn";
import { rememberReportQuery } from "@/lib/report-query-memory";
import { REPORT_RANGE_PRESETS, type ReportRangePreset } from "@/modules/reports/report-range";

const INPUT_CLASS =
  "h-9 rounded-lg border border-zinc-300 bg-white px-2.5 text-sm text-zinc-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100";
const LABEL_CLASS = "flex flex-col gap-1 text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500";

export type ReportFilterSelect = {
  name: string;
  label: string;
  /** `ALL` or an option value. */
  value: string;
  allLabel: string;
  options: Array<{ value: string; label: string }>;
};

/** Custom from/to with an explicit Apply (remounted per applied range via `key`). */
function CustomRangeForm({
  fromYmd,
  toYmd,
  onApply,
}: {
  fromYmd: string;
  toYmd: string;
  onApply: (from: string, to: string) => void;
}) {
  const [from, setFrom] = useState(fromYmd);
  const [to, setTo] = useState(toYmd);
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        onApply(from, to);
      }}
    >
      <label className={LABEL_CLASS}>
        From
        <input
          type="date"
          value={from}
          max={to || undefined}
          onChange={(e) => setFrom(e.target.value)}
          className={INPUT_CLASS}
        />
      </label>
      <label className={LABEL_CLASS}>
        To
        <input
          type="date"
          value={to}
          min={from || undefined}
          onChange={(e) => setTo(e.target.value)}
          className={INPUT_CLASS}
        />
      </label>
      <button
        type="submit"
        className="h-9 rounded-lg bg-orange-600 px-3 text-sm font-semibold text-white hover:bg-orange-700"
      >
        Apply
      </button>
    </form>
  );
}

export function ReportFilterBar({
  basePath,
  preset,
  fromYmd,
  toYmd,
  companyLabel,
  companyHint,
  filters,
  keep = {},
  exportPath,
}: {
  basePath: string;
  preset: ReportRangePreset;
  fromYmd: string;
  toYmd: string;
  companyLabel: string;
  companyHint?: string | null;
  /** Optional dimension filters; empty option lists are hidden. */
  filters: ReportFilterSelect[];
  /** Params that always ride along (e.g. `lens`). */
  keep?: Record<string, string>;
  /** CSV endpoint; the current filters are appended. Omit when export is not allowed. */
  exportPath?: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [mobileOpen, setMobileOpen] = useState(false);
  const visibleFilters = filters.filter((f) => f.options.length > 0);
  const activeCount = visibleFilters.filter((f) => f.value !== "ALL").length;

  // Props arrive as fresh objects each render; derive one stable query string.
  const queryString = (() => {
    const p = new URLSearchParams(keep);
    p.set("range", preset);
    if (preset === "custom") {
      p.set("from", fromYmd);
      p.set("to", toYmd);
    }
    for (const f of visibleFilters) if (f.value !== "ALL") p.set(f.name, f.value);
    return p.toString();
  })();
  const params = useMemo(() => new URLSearchParams(queryString), [queryString]);

  useEffect(() => {
    rememberReportQuery(basePath, params.toString());
  }, [basePath, params]);

  function navigate(mutate: (next: URLSearchParams) => void) {
    const next = new URLSearchParams(params);
    mutate(next);
    startTransition(() => router.push(`${basePath}?${next.toString()}`, { scroll: false }));
  }

  function changePreset(value: ReportRangePreset) {
    navigate((next) => {
      next.set("range", value);
      if (value === "custom") {
        next.set("from", fromYmd);
        next.set("to", toYmd);
      } else {
        next.delete("from");
        next.delete("to");
      }
    });
  }

  function changeFilter(name: string, value: string) {
    navigate((next) => {
      if (value === "ALL") next.delete(name);
      else next.set(name, value);
    });
  }

  const exportHref = exportPath ? `${exportPath}?${params.toString()}` : null;

  return (
    <div
      className={cn(
        "rounded-xl border border-zinc-200 bg-white p-3 shadow-sm transition-opacity dark:border-zinc-800 dark:bg-zinc-900",
        pending && "opacity-70",
      )}
    >
      <div className="flex flex-wrap items-end gap-2">
        <label className={LABEL_CLASS}>
          Period
          <select
            value={preset}
            onChange={(e) => changePreset(e.target.value as ReportRangePreset)}
            className={INPUT_CLASS}
          >
            {REPORT_RANGE_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        {preset === "custom" ? (
          <CustomRangeForm
            key={`${fromYmd}:${toYmd}`}
            fromYmd={fromYmd}
            toYmd={toYmd}
            onApply={(from, to) =>
              navigate((next) => {
                next.set("range", "custom");
                next.set("from", from);
                next.set("to", to);
              })
            }
          />
        ) : null}

        {visibleFilters.length > 0 ? (
          <button
            type="button"
            onClick={() => setMobileOpen((open) => !open)}
            aria-expanded={mobileOpen}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-zinc-300 px-3 text-sm font-semibold text-zinc-700 sm:hidden dark:border-zinc-700 dark:text-zinc-200"
          >
            <SlidersHorizontal className="size-4" aria-hidden />
            Filters{activeCount > 0 ? ` (${activeCount})` : ""}
          </button>
        ) : null}

        <div
          className={cn(
            "w-full flex-wrap items-end gap-2 sm:flex sm:w-auto",
            mobileOpen ? "flex" : "hidden",
          )}
        >
          {visibleFilters.map((f) => (
            <label key={f.name} className={LABEL_CLASS}>
              {f.label}
              <select
                value={f.value}
                onChange={(e) => changeFilter(f.name, e.target.value)}
                className={cn(INPUT_CLASS, "max-w-[16rem]")}
              >
                <option value="ALL">{f.allLabel}</option>
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>

        {exportHref ? (
          <a
            href={exportHref}
            className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900"
          >
            <Download className="size-4" aria-hidden />
            Export
          </a>
        ) : null}
      </div>
      <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
        Company: <span className="font-semibold text-zinc-800 dark:text-zinc-200">{companyLabel}</span>
        {" · "}
        {fromYmd} → {toYmd}
        {companyHint ? <span className="ml-1">· {companyHint}</span> : null}
      </p>
    </div>
  );
}
