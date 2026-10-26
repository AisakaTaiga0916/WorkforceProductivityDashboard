"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { authInputClass, authLabelClass } from "@/components/auth/AuthShell";
import { AssigneeAvatar } from "@/components/agent-assignee-search";
import { cn } from "@/lib/cn";
import { DEFAULT_TIME_ZONE } from "@/modules/tasks/kpi-recurrence";
import { portalRoleDisplayLabel } from "@/lib/staff-role";
import type { OnDutyAgentSnapshot } from "@/lib/load-on-duty-snapshot";
import type { PersonnelKpiSummary } from "@/modules/workforce/personnel-kpi";

type Props = {
  initialAgents: OnDutyAgentSnapshot[];
  initialPage: number;
  totalPages: number;
  initialTotal?: number;
  initialOnDutyCount?: number;
  initialCompanies?: string[];
  pageSize?: number;
  variant?: "list" | "cards";
  showCompanyFilter?: boolean;
  /** When set, always filter to this company (Admin company scope). */
  lockedCompanyFilter?: string | null;
  className?: string;
  /** Shared search bar query from the parent page. When set, this replaces the
   *  panel's own search input (hidden) and drives the API `q` param instead. */
  externalSearchQuery?: string;
  /** Company filter chip from the parent Workforce search bar. When set, this
   *  replaces the panel's own company dropdown (hidden) and drives the API
   *  `company` param instead. */
  externalCompanyFilter?: string;
  /** Role filter chip from the parent Workforce search bar (normalized role,
   *  e.g. "Admin"). Drives the API `role` param. */
  externalRoleFilter?: string;
  kpiByAgentId?: ReadonlyMap<string, PersonnelKpiSummary>;
  kpiByEmail?: ReadonlyMap<string, PersonnelKpiSummary>;
  kpiPeriodLabel?: string;
  onOpenKpi?: (person: PersonnelKpiSummary) => void;
  kpiControls?: ReactNode;
};

function isAgentOnDuty(agent: OnDutyAgentSnapshot): boolean {
  if (typeof agent.isOnDuty === "boolean") return agent.isOnDuty;
  if (agent.dutyStatus) return agent.dutyStatus === "ON_DUTY";
  return Boolean(agent.isOnline);
}

function dutyLabel(agent: OnDutyAgentSnapshot): "On Duty" | "Offline" {
  return isAgentOnDuty(agent) ? "On Duty" : "Offline";
}

/** Compact role label for the on-duty card badge. */
function roleBadgeLabel(role: string | undefined): string {
  return role ? portalRoleDisplayLabel(role) : "";
}

/** Badge tone by role so Admin vs Employee reads instantly. */
function roleBadgeClass(role: string | undefined): string {
  switch (role) {
    case "SuperAdmin":
    case "HighAdmin":
      return "bg-violet-100 text-violet-800 dark:bg-violet-950/60 dark:text-violet-300";
    case "Admin":
      return "bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300";
    case "Personnel":
      return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300";
    case "Personnel-Guard":
      return "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300";
    case "Customer":
      return "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
    default:
      return "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400";
  }
}

const OVERALL_KPI_HINT =
  "Overall KPI = average of the task KPI (checklist items done ÷ due, projects excluded) and the request resolution rate (resolved ÷ assigned). Not the same as Work → Reports “Avg efficiency”.";

function kpiTextClass(percent: number | null): string {
  if (percent == null) return "text-zinc-400 dark:text-zinc-500";
  if (percent >= 85) return "text-emerald-600 dark:text-emerald-400";
  if (percent >= 60) return "text-amber-600 dark:text-amber-400";
  return "text-rose-600 dark:text-rose-400";
}

function kpiBarClass(percent: number | null): string {
  if (percent == null) return "bg-transparent";
  if (percent >= 85) return "bg-emerald-500";
  if (percent >= 60) return "bg-amber-500";
  return "bg-rose-500";
}

function kpiPercentText(percent: number | null): string {
  return percent == null ? "—" : `${percent}%`;
}

function AgentKpiBadge({
  kpi,
  periodLabel,
  onOpen,
}: {
  kpi: PersonnelKpiSummary | null;
  periodLabel?: string;
  onOpen?: (person: PersonnelKpiSummary) => void;
}) {
  if (!kpi) return null;
  return (
    <button
      type="button"
      onClick={() => onOpen?.(kpi)}
      className={cn(
        "rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums ring-1 ring-inset ring-zinc-200 dark:ring-zinc-700",
        kpiTextClass(kpi.overallPercent),
      )}
      title={`Overall KPI${periodLabel ? ` · ${periodLabel}` : ""}. ${OVERALL_KPI_HINT}`}
    >
      KPI {kpiPercentText(kpi.overallPercent)}
    </button>
  );
}

function AgentKpiBlock({
  kpi,
  periodLabel,
}: {
  kpi: PersonnelKpiSummary | null;
  periodLabel?: string;
}) {
  if (!kpi) {
    return (
      <div className="mt-3 border-t border-zinc-200 pt-2.5 text-[11px] text-zinc-400 dark:border-zinc-700 dark:text-zinc-500">
        No KPI data{periodLabel ? ` · ${periodLabel}` : ""}
      </div>
    );
  }
  return (
    <div
      className="mt-3 w-full border-t border-zinc-200 pt-2.5 text-left dark:border-zinc-700"
      title={`${OVERALL_KPI_HINT} Click the card for the breakdown.`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Overall KPI
          {periodLabel ? (
            <span className="normal-case tracking-normal text-zinc-400 dark:text-zinc-500">
              · {periodLabel}
            </span>
          ) : null}
        </span>
        <span className={cn("text-sm font-bold tabular-nums", kpiTextClass(kpi.overallPercent))}>
          {kpiPercentText(kpi.overallPercent)}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
        <div
          className={cn("h-full rounded-full", kpiBarClass(kpi.overallPercent))}
          style={{ width: `${kpi.overallPercent ?? 0}%` }}
        />
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2 text-[10px] text-zinc-500 dark:text-zinc-400">
        <span title={`${kpi.doneItems}/${kpi.totalItems} checklist items`}>
          Tasks{" "}
          <span className={cn("font-semibold tabular-nums", kpiTextClass(kpi.kpiPercent))}>
            {kpiPercentText(kpi.kpiPercent)}
          </span>
        </span>
        <span title={`${kpi.requests.resolved}/${kpi.requests.assigned} requests resolved`}>
          Requests{" "}
          <span
            className={cn(
              "font-semibold tabular-nums",
              kpiTextClass(kpi.requests.resolutionPercent),
            )}
          >
            {kpiPercentText(kpi.requests.resolutionPercent)}
          </span>
          {kpi.requests.overdue > 0 ? (
            <span className="ml-1 font-semibold text-rose-500">· {kpi.requests.overdue} overdue</span>
          ) : null}
        </span>
      </div>
      <p className="mt-1.5 text-[10px] font-semibold text-orange-600 opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100 dark:text-orange-400">
        View KPI breakdown →
      </p>
    </div>
  );
}

export function OnDutyPanel({
  initialAgents,
  initialPage,
  totalPages,
  initialTotal = initialAgents.length,
  initialOnDutyCount,
  initialCompanies = [],
  pageSize = 6,
  variant = "list",
  showCompanyFilter = false,
  lockedCompanyFilter = null,
  className,
  externalSearchQuery,
  externalCompanyFilter,
  externalRoleFilter,
  kpiByAgentId,
  kpiByEmail,
  kpiPeriodLabel,
  onOpenKpi,
  kpiControls,
}: Props) {
  const lockedCompany = lockedCompanyFilter?.trim() || "";
  const [agents, setAgents] = useState<OnDutyAgentSnapshot[]>(initialAgents);
  const [page, setPage] = useState(initialPage);
  const [pages, setPages] = useState(totalPages);
  const [total, setTotal] = useState(initialTotal);
  const [onDutyCount, setOnDutyCount] = useState(
    initialOnDutyCount ?? initialAgents.filter((a) => isAgentOnDuty(a)).length,
  );
  const [companies, setCompanies] = useState<string[]>(initialCompanies);
  const [companyFilter, setCompanyFilter] = useState(lockedCompany);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const canPrev = page > 1;
  const canNext = page < pages;
  // Parent-level company chip wins; the panel's own dropdown (hidden) and the
  // admin lock are only used when no external filter drives this view.
  const effectiveCompanyFilter =
    externalCompanyFilter !== undefined ? externalCompanyFilter : lockedCompany || companyFilter;
  const showFilters = (showCompanyFilter || Boolean(lockedCompany)) && externalCompanyFilter === undefined;

  useEffect(() => {
    const next = searchInput.trim();
    const timer = window.setTimeout(() => {
      setSearchQuery((prev) => {
        if (prev === next) return prev;
        return next;
      });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  // Parent-level shared search bar: debounce its keystrokes into searchQuery
  // (same cadence as the in-panel input) so the on-duty API isn't hit on every
  // character, and trim so whitespace-only input never becomes a `q` param.
  useEffect(() => {
    if (externalSearchQuery === undefined) return;
    const next = externalSearchQuery.trim();
    const timer = window.setTimeout(() => {
      setSearchQuery((prev) => {
        if (prev === next) return prev;
        return next;
      });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [externalSearchQuery]);

  useEffect(() => {
    setPage(1);
  }, [searchQuery, effectiveCompanyFilter, externalRoleFilter]);

  const endpoint = useMemo(() => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
    });
    if (effectiveCompanyFilter) params.set("company", effectiveCompanyFilter);
    if (searchQuery) params.set("q", searchQuery);
    if (externalRoleFilter) params.set("role", externalRoleFilter);
    return `/api/dashboard/on-duty?${params.toString()}`;
  }, [page, pageSize, effectiveCompanyFilter, searchQuery, externalRoleFilter]);

  useEffect(() => {
    let stopped = false;
    async function refresh() {
      try {
        const res = await fetch(endpoint, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as {
          agents: OnDutyAgentSnapshot[];
          page: number;
          totalPages: number;
          total: number;
          onDutyCount?: number;
          companies: string[];
        };
        if (stopped) return;
        setAgents(data.agents ?? []);
        setPage(data.page ?? 1);
        setPages(data.totalPages ?? 1);
        setTotal(data.total ?? 0);
        setOnDutyCount(
          typeof data.onDutyCount === "number"
            ? data.onDutyCount
            : (data.agents ?? []).filter((a) => isAgentOnDuty(a)).length,
        );
        if (Array.isArray(data.companies) && data.companies.length > 0) {
          setCompanies(data.companies);
        }
      } catch {
        // Ignore intermittent polling failures.
      }
    }

    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, 10000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [endpoint]);

  function handleCompanyFilterChange(value: string) {
    setCompanyFilter(value);
    setPage(1);
  }

  const showKpi = Boolean(kpiByAgentId || kpiByEmail);
  const resolveKpi = (agent: OnDutyAgentSnapshot): PersonnelKpiSummary | null => {
    const byId = kpiByAgentId?.get(agent.id);
    if (byId) return byId;
    const email = agent.email?.trim().toLowerCase();
    return email ? kpiByEmail?.get(email) ?? null : null;
  };

  const filtersActive = Boolean(effectiveCompanyFilter || searchQuery || externalRoleFilter);
  const emptyMessage = filtersActive
    ? "No personnel match the current filters."
    : "No personnel linked from the merge database.";

  // 5×3 layout: 5 columns × 3 rows per page. Falls back to fewer columns on
  // narrow screens so cards stay readable.
  const cardGridClass =
    variant === "cards"
      ? "mt-4 grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5"
      : "mt-4 space-y-3";

  return (
    <article
      className={cn(
        "rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900",
        className,
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-600 dark:text-zinc-500">
            Personnel activity
          </h3>
          <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
            Status from merged DB clock-in (today, {DEFAULT_TIME_ZONE} · GMT+8)
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-500">
          <span className="text-emerald-700 dark:text-emerald-400">{onDutyCount} on duty</span>
          <span>{total} staff</span>
          <span>
            {page}/{pages}
          </span>
        </div>
      </div>

      {kpiControls}

      {showFilters ? (
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
            {showCompanyFilter && !lockedCompany ? (
              <label className="flex min-w-[12rem] flex-col gap-1">
                <span className={authLabelClass}>Filter by company</span>
                <select
                  value={companyFilter}
                  onChange={(e) => handleCompanyFilterChange(e.target.value)}
                  className={cn(authInputClass, "py-2 text-xs")}
                >
                  <option value="">All companies</option>
                  {companies.map((company) => (
                    <option key={company} value={company}>
                      {company}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {externalSearchQuery === undefined ? (
              <label className="flex min-w-[12rem] flex-1 flex-col gap-1 sm:max-w-xs">
                <span className={authLabelClass}>Search by name or email</span>
                <input
                  type="search"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Name or email…"
                  className={cn(authInputClass, "py-2 text-xs")}
                  autoComplete="off"
                />
              </label>
            ) : null}
          </div>
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
            {filtersActive
              ? `Showing ${agents.length} of ${total}${
                  effectiveCompanyFilter && effectiveCompanyFilter !== "__none__"
                    ? ` in ${effectiveCompanyFilter}`
                    : ""
                }`
              : `Showing ${agents.length} of ${total}`}
          </p>
        </div>
      ) : null}

      {variant === "cards" ? (
        <div className={cardGridClass}>
          {agents.length === 0 ? (
            <p className="col-span-full text-sm text-zinc-600 dark:text-zinc-500">{emptyMessage}</p>
          ) : (
            agents.map((agent) => {
              const onDuty = isAgentOnDuty(agent);
              const label = dutyLabel(agent);
              const cardKpi = showKpi ? resolveKpi(agent) : null;
              const openCardKpi = cardKpi && onOpenKpi ? () => onOpenKpi(cardKpi) : null;
              return (
                <div
                  key={agent.id}
                  {...(openCardKpi
                    ? {
                        role: "button",
                        tabIndex: 0,
                        "aria-label": `Open KPI breakdown for ${agent.name}`,
                        onClick: openCardKpi,
                        onKeyDown: (e: { key: string; preventDefault: () => void }) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            openCardKpi();
                          }
                        },
                      }
                    : {})}
                  className={cn(
                    "group flex flex-col rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-900",
                    openCardKpi &&
                      "cursor-pointer transition hover:border-orange-400/70 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 dark:hover:border-orange-500/60",
                  )}
                >
                  <div className="flex items-start gap-3">
                    <AssigneeAvatar agent={agent} className="size-10" />
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                        <span className="truncate">{agent.name}</span>
                        <span
                          className={cn(
                            "inline-block size-2 shrink-0 rounded-full",
                            onDuty ? "bg-emerald-500" : "bg-zinc-400 dark:bg-zinc-600",
                          )}
                          title={label}
                        />
                      </p>
                      <p className="mt-1 truncate text-xs text-zinc-600 dark:text-zinc-500">
                        {agent.companyName || "General Queue"}
                      </p>
                      {agent.email ? (
                        <p className="mt-0.5 truncate text-[11px] text-zinc-500 dark:text-zinc-500">{agent.email}</p>
                      ) : null}
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-2">
                    {agent.role ? (
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                          roleBadgeClass(agent.role),
                        )}
                        title={`Role: ${agent.role}`}
                      >
                        {roleBadgeLabel(agent.role)}
                      </span>
                    ) : null}
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                        onDuty
                          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                          : "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
                      )}
                    >
                      {label}
                    </span>
                  </div>
                  <p className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                    {agent.lastActivity ?? (onDuty ? "Clocked in today" : "No clock-in today")}
                  </p>
                  {showKpi ? <AgentKpiBlock kpi={cardKpi} periodLabel={kpiPeriodLabel} /> : null}
                </div>
              );
            })
          )}
        </div>
      ) : (
        <div className={cardGridClass}>
          {agents.length === 0 ? (
            <p className="text-sm text-zinc-600 dark:text-zinc-500">{emptyMessage}</p>
          ) : (
            agents.map((agent) => {
              const onDuty = isAgentOnDuty(agent);
              const label = dutyLabel(agent);
              const roleLabel = roleBadgeLabel(agent.role);
              return (
                <div
                  key={agent.id}
                  className="flex items-center justify-between rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 dark:border-zinc-700 dark:bg-zinc-900"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">{agent.name}</p>
                    <p className="truncate text-xs text-zinc-600 dark:text-zinc-500">
                      {agent.companyName || "General Queue"}
                      {agent.role ? ` · ${roleLabel}` : ""}
                      {" · "}
                      {agent.lastActivity ?? (onDuty ? "Clocked in today" : "No clock-in today")}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {roleLabel ? (
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                          roleBadgeClass(agent.role),
                        )}
                        title={`Role: ${agent.role}`}
                      >
                        {roleLabel}
                      </span>
                    ) : null}
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                        onDuty
                          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                          : "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
                      )}
                      title={label}
                    >
                      {label}
                    </span>
                    {showKpi ? (
                      <AgentKpiBadge
                        kpi={resolveKpi(agent)}
                        periodLabel={kpiPeriodLabel}
                        onOpen={onOpenKpi}
                      />
                    ) : null}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {pages > 1 ? (
        <div className="mt-4 flex items-center justify-end gap-2 text-xs font-semibold">
          <button
            type="button"
            onClick={() => canPrev && setPage((p) => Math.max(1, p - 1))}
            disabled={!canPrev}
            className={cn(
              "rounded-md px-2.5 py-1.5",
              canPrev
                ? "border border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
                : "cursor-not-allowed border border-zinc-200 bg-zinc-100 text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-600",
            )}
          >
            Prev
          </button>
          <button
            type="button"
            onClick={() => canNext && setPage((p) => Math.min(pages, p + 1))}
            disabled={!canNext}
            className={cn(
              "rounded-md px-2.5 py-1.5",
              canNext
                ? "border border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
                : "cursor-not-allowed border border-zinc-200 bg-zinc-100 text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-600",
            )}
          >
            Next
          </button>
        </div>
      ) : null}
    </article>
  );
}
