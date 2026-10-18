"use client";

import { useMemo, useState } from "react";
import { Users } from "lucide-react";
import { cn } from "@/lib/cn";
import { BoardSearchBar } from "@/components/ui/BoardSearchBar";
import type { PersonnelCombinedMetricCard } from "@/modules/tasks/task-personnel-metrics";
import {
  filterPersonnelSearchQuery,
  mergePersonnelRequestMetrics,
  personnelIdentityKey,
  personnelEfficiencyBracket,
  applyPersonnelAverageEfficiencyFloor,
} from "@/modules/tasks/task-personnel-metrics";
import { ContributorPersonalKpiCard } from "@/components/metrics/TaskPillarMetricsGrid";

type PersonnelTaskMetricsGridProps = {
  rows: PersonnelCombinedMetricCard[];
  reportingPeriodLabel?: string;
  companyLabel?: string | null;
  departmentLabel?: string | null;
  loading?: boolean;
  /** When set, search is controlled by the parent metrics filter bar. */
  searchQuery?: string;
};

export function PersonnelTaskMetricsGrid({
  rows,
  reportingPeriodLabel,
  companyLabel,
  departmentLabel,
  loading = false,
  searchQuery: controlledSearchQuery,
}: PersonnelTaskMetricsGridProps) {
  const [searchDraft, setSearchDraft] = useState("");
  const [internalSearchQuery, setInternalSearchQuery] = useState("");
  const searchControlled = controlledSearchQuery !== undefined;
  const searchQuery = searchControlled ? controlledSearchQuery : internalSearchQuery;

  const filteredRows = useMemo(
    () => filterPersonnelSearchQuery(rows, searchQuery),
    [rows, searchQuery],
  );

  const totals = filteredRows.reduce(
    (acc, row) => {
      const requests = mergePersonnelRequestMetrics(row);
      const ticketClosed = requests?.closed ?? 0;
      const taskClosed = row.tasks?.closed ?? 0;
      const efficiencies = [requests?.efficiency, row.tasks?.efficiency].filter(
        (value): value is number => value != null,
      );
      return {
        closed: acc.closed + ticketClosed + taskClosed,
        efficiencySum: acc.efficiencySum + efficiencies.reduce((sum, value) => sum + value, 0),
        efficiencyCount: acc.efficiencyCount + efficiencies.length,
      };
    },
    { closed: 0, efficiencySum: 0, efficiencyCount: 0 },
  );
  const teamEfficiency =
    totals.efficiencyCount > 0
      ? applyPersonnelAverageEfficiencyFloor(totals.efficiencySum / totals.efficiencyCount)
      : 0;
  const teamEfficiencyBracket =
    totals.efficiencyCount > 0 ? personnelEfficiencyBracket(teamEfficiency) : null;

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-orange-600 dark:text-orange-300">
            Personnel accumulated tasks
          </p>
          <h4 className="mt-1 text-lg font-bold text-zinc-950 dark:text-zinc-50">
            {[companyLabel, departmentLabel].filter(Boolean).join(" · ") || "All personnel"}
            {companyLabel || departmentLabel ? " personnel" : ""}
          </h4>
          {reportingPeriodLabel ? (
            <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">{reportingPeriodLabel}</p>
          ) : null}
          <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-500">
            Roster matches active HRIS users from mergeddatabase (same soft-path as Workforce).
            Each card shows Requests (performer roles and assignee work) and Tasks. Approver-only
            seats are not listed unless the person also has task or performer KPI. Mon–Sat task
            periods; Sundays excluded.
          </p>
        </div>
        {rows.length > 0 ? (
          <div className="rounded-xl border border-zinc-200 bg-zinc-50/90 px-4 py-3 dark:border-zinc-700/80 dark:bg-zinc-900/50">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">
              Team rollup
            </p>
            <p
              className={cn(
                "mt-1 text-2xl font-black tabular-nums",
                teamEfficiencyBracket?.valueClassName ?? "text-zinc-900 dark:text-zinc-100",
              )}
            >
              {teamEfficiency}%
            </p>
            {teamEfficiencyBracket ? (
              <p
                className={cn(
                  "mt-1 inline-block rounded-md border px-2 py-0.5 text-[10px] font-bold tracking-wide",
                  teamEfficiencyBracket.badgeClassName,
                )}
              >
                [{teamEfficiencyBracket.label}]
              </p>
            ) : null}
            <p className="mt-1 text-[11px] text-zinc-600 dark:text-zinc-400">
              {totals.closed} closed · avg {teamEfficiency}% efficiency
              {searchQuery ? ` · ${filteredRows.length} shown` : ""}
            </p>
          </div>
        ) : null}
      </div>

      {rows.length > 0 && !searchControlled ? (
        <BoardSearchBar
          query={searchDraft}
          onQueryChange={setSearchDraft}
          onSearchSubmit={() => setInternalSearchQuery(searchDraft.trim())}
          placeholder="Search personnel by name"
          ariaLabel="Search personnel by name"
        />
      ) : null}

      <div className={cn(loading && "pointer-events-none opacity-60")}>
        {rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-300 px-6 py-16 text-center dark:border-zinc-700">
            <Users className="size-10 text-zinc-400 dark:text-zinc-600" aria-hidden />
            <p className="mt-3 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
              No personnel task metrics for this scope
            </p>
            <p className="mt-1 max-w-md text-xs text-zinc-600 dark:text-zinc-500">
              Try another company, cadence, or reporting range. Metrics appear when personnel have
              recorded task or performer-side request KPI in the selected period.
            </p>
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-300 px-6 py-16 text-center dark:border-zinc-700">
            <Users className="size-10 text-zinc-400 dark:text-zinc-600" aria-hidden />
            <p className="mt-3 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
              No personnel match &ldquo;{searchQuery}&rdquo;
            </p>
            <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-500">
              Try another name or clear the search.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {filteredRows.map((row) => (
              <ContributorPersonalKpiCard
                key={`${personnelIdentityKey(row.name)}:${row.id}`}
                row={row}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
