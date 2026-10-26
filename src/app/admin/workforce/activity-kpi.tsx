"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  CalendarRange,
  Loader2,
  ShieldCheck,
  TriangleAlert,
  X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { personnelAssignmentCssVars } from "@/lib/personnel-assignment-colors";
import { Button } from "@/components/ui/button";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  WORKFORCE_KPI_PERIOD_PRESETS,
  blendPersonnelKpi,
  buildPersonnelKpiContributions,
  personnelKpiFrequencyLabel,
  personnelKpiPeriodLabel,
  personnelKpiStatusLabel,
  type PersonnelKpiDetail,
  type PersonnelKpiOverview,
  type PersonnelKpiRange,
  type PersonnelKpiSummary,
  type PersonnelKpiTaskStatus,
} from "@/modules/workforce/personnel-kpi";

type RangeQuery = {
  range?: string | null;
  from?: string | null;
  to?: string | null;
};

export type ActivityKpiLookup = {
  byAgentId: ReadonlyMap<string, PersonnelKpiSummary>;
  byEmail: ReadonlyMap<string, PersonnelKpiSummary>;
};

export function buildActivityKpiLookup(
  overview: PersonnelKpiOverview | null,
): ActivityKpiLookup {
  const byAgentId = new Map<string, PersonnelKpiSummary>();
  const byEmail = new Map<string, PersonnelKpiSummary>();
  for (const person of overview?.people ?? []) {
    if (person.agentId) byAgentId.set(person.agentId, person);
    const email = person.email?.trim().toLowerCase();
    if (email) byEmail.set(email, person);
  }
  return { byAgentId, byEmail };
}

export function findActivityKpi(
  lookup: ActivityKpiLookup | undefined,
  agent: { id: string; email?: string | null },
): PersonnelKpiSummary | null {
  if (!lookup) return null;
  const byId = lookup.byAgentId.get(agent.id);
  if (byId) return byId;
  const email = agent.email?.trim().toLowerCase();
  return email ? lookup.byEmail.get(email) ?? null : null;
}

const TONE_TEXT = {
  good: "text-emerald-600 dark:text-emerald-400",
  warn: "text-amber-600 dark:text-amber-400",
  bad: "text-rose-600 dark:text-rose-400",
  empty: "text-zinc-400 dark:text-zinc-500",
} as const;

const TONE_BAR = {
  good: "bg-emerald-500",
  warn: "bg-amber-500",
  bad: "bg-rose-500",
  empty: "bg-transparent",
} as const;

const STATUS_BADGE: Record<PersonnelKpiTaskStatus, string> = {
  DONE: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:ring-emerald-900",
  DELAYED: "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:ring-rose-900",
  CURRENT: "bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950/50 dark:text-sky-300 dark:ring-sky-900",
  PENDING_VERIFICATION:
    "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:ring-amber-900",
};

export function kpiTone(percent: number | null): keyof typeof TONE_TEXT {
  if (percent == null) return "empty";
  if (percent >= 85) return "good";
  if (percent >= 60) return "warn";
  return "bad";
}

export function kpiToneText(percent: number | null): string {
  return TONE_TEXT[kpiTone(percent)];
}

export function kpiToneBar(percent: number | null): string {
  return TONE_BAR[kpiTone(percent)];
}

export function displayKpiPercent(percent: number | null): string {
  return percent == null ? "—" : `${percent}%`;
}

function rangeQueryFromUrl(): RangeQuery {
  const params = new URLSearchParams(window.location.search);
  return {
    range: params.get("range"),
    from: params.get("from"),
    to: params.get("to"),
  };
}

function rangeQueryFromRange(range: PersonnelKpiRange): RangeQuery {
  return range.preset === "custom"
    ? { range: "custom", from: range.fromYmd, to: range.toYmd }
    : { range: range.preset };
}

function rangeParams(query: RangeQuery): URLSearchParams {
  const params = new URLSearchParams();
  params.set("mode", "summary");
  if (query.range) params.set("range", query.range);
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);
  return params;
}

export function useActivityKpi(args: {
  initialOverview: PersonnelKpiOverview | null;
  initialError?: string | null;
  initialRange: PersonnelKpiRange;
}) {
  const [overview, setOverview] = useState<PersonnelKpiOverview | null>(args.initialOverview);
  const [range, setRange] = useState<PersonnelKpiRange>(
    args.initialOverview?.range ?? args.initialRange,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(args.initialError ?? null);
  const [customFrom, setCustomFrom] = useState(range.fromYmd);
  const [customTo, setCustomTo] = useState(range.toYmd);

  const [selected, setSelected] = useState<PersonnelKpiSummary | null>(null);
  const [detail, setDetail] = useState<PersonnelKpiDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const detailRequestRef = useRef(0);
  const summaryRequestRef = useRef(0);

  const fetchSummary = useCallback(async (query: RangeQuery) => {
    const requestId = ++summaryRequestRef.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/workforce-kpi?${rangeParams(query).toString()}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`KPI summary failed (${res.status})`);
      const data = (await res.json()) as PersonnelKpiOverview;
      if (summaryRequestRef.current !== requestId) return;
      setOverview(data);
      setRange(data.range);
      setCustomFrom(data.range.fromYmd);
      setCustomTo(data.range.toYmd);
    } catch (e) {
      if (summaryRequestRef.current !== requestId) return;
      setError(e instanceof Error ? e.message : "Could not load KPI data");
    } finally {
      if (summaryRequestRef.current === requestId) setLoading(false);
    }
  }, []);

  useEffect(() => {
    function onPopState() {
      if (new URLSearchParams(window.location.search).get("view") === "sections") return;
      void fetchSummary(rangeQueryFromUrl());
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [fetchSummary]);

  function syncUrl(query: RangeQuery) {
    const url = new URL(window.location.href);
    if (query.range) url.searchParams.set("range", query.range);
    else url.searchParams.delete("range");
    if (query.range === "custom") {
      if (query.from) url.searchParams.set("from", query.from);
      if (query.to) url.searchParams.set("to", query.to);
    } else {
      url.searchParams.delete("from");
      url.searchParams.delete("to");
    }
    window.history.replaceState({}, "", url);
  }

  function applyRange(query: RangeQuery) {
    syncUrl(query);
    void fetchSummary(query);
  }

  function openPerson(person: PersonnelKpiSummary) {
    setSelected(person);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    const requestId = ++detailRequestRef.current;
    const params = rangeParams(rangeQueryFromRange(range));
    params.set("mode", "detail");
    params.set("user", person.sourceUserId);
    void fetch(`/api/admin/workforce-kpi?${params.toString()}`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`KPI detail failed (${res.status})`);
        return (await res.json()) as PersonnelKpiDetail;
      })
      .then((data) => {
        if (detailRequestRef.current === requestId) setDetail(data);
      })
      .catch((e: unknown) => {
        if (detailRequestRef.current === requestId) {
          setDetailError(e instanceof Error ? e.message : "Could not load this person's KPI detail");
        }
      })
      .finally(() => {
        if (detailRequestRef.current === requestId) setDetailLoading(false);
      });
  }

  function closePerson() {
    setSelected(null);
    detailRequestRef.current += 1;
  }

  const lookup = useMemo(() => buildActivityKpiLookup(overview), [overview]);

  return {
    overview,
    lookup,
    range,
    loading,
    error,
    customFrom,
    customTo,
    setCustomFrom,
    setCustomTo,
    applyRange,
    retry: () => void fetchSummary(rangeQueryFromRange(range)),
    selected,
    detail,
    detailLoading,
    detailError,
    openPerson,
    closePerson,
  };
}

export type ActivityKpiState = ReturnType<typeof useActivityKpi>;

export function ActivityKpiControls({ state }: { state: ActivityKpiState }) {
  return (
    <div className="mt-3 rounded-lg border border-zinc-200 bg-zinc-50 p-2.5 dark:border-zinc-700 dark:bg-zinc-950/40">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">
          <CalendarRange className="size-3.5 text-orange-500" aria-hidden />
          KPI period
        </span>
        <div className="flex flex-wrap items-center gap-1 rounded-md border border-zinc-200 bg-white p-0.5 dark:border-zinc-700 dark:bg-zinc-900">
          {WORKFORCE_KPI_PERIOD_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() =>
                preset.id === "custom"
                  ? state.applyRange({
                      range: "custom",
                      from: state.customFrom,
                      to: state.customTo,
                    })
                  : state.applyRange({ range: preset.id })
              }
              aria-pressed={state.range.preset === preset.id}
              className={cn(
                "rounded px-2 py-1 text-[11px] font-semibold transition",
                state.range.preset === preset.id
                  ? "bg-orange-600 text-white shadow-sm"
                  : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100",
              )}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <input
            type="date"
            value={state.customFrom}
            max={state.customTo}
            onChange={(e) => state.setCustomFrom(e.target.value)}
            className="h-7 rounded-md border border-zinc-300 bg-white px-1.5 text-[11px] text-zinc-700 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200"
            aria-label="KPI range start"
          />
          <span className="text-[11px] text-zinc-400">to</span>
          <input
            type="date"
            value={state.customTo}
            min={state.customFrom}
            onChange={(e) => state.setCustomTo(e.target.value)}
            className="h-7 rounded-md border border-zinc-300 bg-white px-1.5 text-[11px] text-zinc-700 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200"
            aria-label="KPI range end"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2 text-[11px]"
            onClick={() =>
              state.applyRange({
                range: "custom",
                from: state.customFrom,
                to: state.customTo,
              })
            }
            disabled={state.loading}
          >
            Apply
          </Button>
        </div>
        <span className="ml-auto flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
          <ShieldCheck className="size-3.5" aria-hidden />
          {state.range.label} · {state.range.fromYmd} → {state.range.toYmd}
          {state.loading ? <Loader2 className="size-3 animate-spin" aria-label="Loading KPI" /> : null}
        </span>
      </div>

      {state.error ? (
        <div className="mt-2 flex items-center justify-between gap-3 border-t border-rose-200 pt-2 text-[11px] text-rose-700 dark:border-rose-900 dark:text-rose-300">
          <span className="flex items-center gap-1.5">
            <TriangleAlert className="size-3.5" aria-hidden />
            {state.error}
          </span>
          <button
            type="button"
            onClick={state.retry}
            className="font-semibold underline underline-offset-2"
          >
            Retry
          </button>
        </div>
      ) : null}
    </div>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]![0] ?? ""}${parts[parts.length - 1]![0] ?? ""}`.toUpperCase();
  }
  return name.trim().slice(0, 2).toUpperCase() || "—";
}

function KpiAvatar({
  name,
  colorKey,
  className,
}: {
  name: string;
  colorKey: string | null;
  className: string;
}) {
  const vars = personnelAssignmentCssVars(colorKey);
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full font-bold ring-1 ring-inset ring-black/15 dark:ring-white/15",
        !vars && "bg-zinc-800 text-zinc-200",
        className,
      )}
      style={vars ? { backgroundColor: vars.bg, color: vars.fg } : undefined}
      title={name}
    >
      {initials(name)}
    </div>
  );
}

export function ActivityKpiModal({ state }: { state: ActivityKpiState }) {
  const selected = state.selected;
  return (
    <Dialog
      open={Boolean(selected)}
      onOpenChange={(open) => {
        if (!open) state.closePerson();
      }}
    >
      {selected ? (
        <DialogPortal>
          <DialogOverlay />
          <DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100%-1.5rem)] max-w-4xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-lg">
            <DialogClose className="absolute right-4 top-4 rounded-sm opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-brand">
              <X className="size-4" aria-hidden />
              <span className="sr-only">Close</span>
            </DialogClose>
            <div className="flex items-start gap-3 border-b border-zinc-200 p-5 pr-14 dark:border-zinc-800">
              <KpiAvatar
                name={selected.name}
                colorKey={selected.staffAssignmentColor}
                className="size-10 text-sm"
              />
              <div className="min-w-0">
                <DialogTitle className="truncate">{selected.name}</DialogTitle>
                <DialogDescription className="mt-1 truncate">
                  {selected.staffRole}
                  {selected.teamName ? ` · ${selected.teamName}` : ""}
                </DialogDescription>
                <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                  {state.range.preset === "custom"
                    ? state.range.label
                    : `${state.range.label} · ${state.range.fromYmd} → ${state.range.toYmd}`}
                </p>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              {state.detailLoading ? (
                <div className="flex items-center justify-center gap-2 py-16 text-sm text-zinc-500 dark:text-zinc-400">
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Loading KPI detail…
                </div>
              ) : state.detailError ? (
                <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
                  {state.detailError}
                </div>
              ) : state.detail ? (
                <DetailBody detail={state.detail} />
              ) : null}
            </div>
          </DialogPrimitive.Content>
        </DialogPortal>
      ) : null}
    </Dialog>
  );
}

function DetailBody({ detail }: { detail: PersonnelKpiDetail }) {
  const person = detail.person;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-2">
        <DetailStat
          label="Overall KPI"
          value={displayKpiPercent(person.overallPercent)}
          className={TONE_TEXT[kpiTone(person.overallPercent)]}
        />
        <DetailStat
          label="Tasks"
          value={displayKpiPercent(person.kpiPercent)}
          className={TONE_TEXT[kpiTone(person.kpiPercent)]}
        />
        <DetailStat
          label="Requests"
          value={displayKpiPercent(person.requests.resolutionPercent)}
          className={TONE_TEXT[kpiTone(person.requests.resolutionPercent)]}
        />
      </div>

      <OverallBlend person={person} />

      <div className="space-y-4 border-t border-zinc-200 pt-5 dark:border-zinc-800">
        <WeightedAverageBreakdown detail={detail} />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <BreakdownTable title="By frequency" rows={detail.frequencies} />
          <BreakdownTable title="Recent periods" rows={detail.periods} />
        </div>
      </div>

      <div className="border-t border-zinc-200 pt-5 dark:border-zinc-800">
        <RequestBreakdown person={person} />
      </div>

      <p className="rounded-lg bg-zinc-50 p-3 text-[11px] text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
        Read-only — Work and the Request Board own these records; Workforce only summarizes them.
        Overall KPI is the equal-weight average of the task KPI and the request resolution rate
        (a part with no data is left out). It differs from Work → Reports &ldquo;Avg
        efficiency&rdquo;, which applies delay penalties and a 50% floor.
      </p>
    </div>
  );
}

function OverallBlend({ person }: { person: PersonnelKpiSummary }) {
  const blend = blendPersonnelKpi(person.kpiPercent, person.requests.resolutionPercent);
  if (blend.parts.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-zinc-300 p-4 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
        No task checklist items or assigned requests in this period, so there is no overall KPI.
      </p>
    );
  }
  const missing =
    person.kpiPercent == null ? "tasks" : person.requests.resolutionPercent == null ? "requests" : null;
  return (
    <section aria-label="Overall KPI breakdown" className="space-y-2">
      <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
        How the overall KPI is built
      </h3>
      <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
        {blend.parts.map((part) => (
          <div
            key={part.key}
            className="flex items-center justify-between gap-3 border-b border-zinc-100 px-3 py-2 text-xs last:border-b-0 dark:border-zinc-800"
          >
            <span className="font-medium text-zinc-800 dark:text-zinc-200">{part.label}</span>
            <span className="tabular-nums text-zinc-500 dark:text-zinc-400">
              <span className={cn("font-semibold", TONE_TEXT[kpiTone(part.percent)])}>
                {part.percent}%
              </span>{" "}
              × {points(part.weightPercent)}% weight ={" "}
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                {points(part.points)} pts
              </span>
            </span>
          </div>
        ))}
        <div className="flex items-center justify-between gap-3 bg-zinc-50 px-3 py-2 text-xs dark:bg-zinc-900">
          <span className="font-semibold text-zinc-900 dark:text-zinc-100">Overall KPI</span>
          <span
            className={cn(
              "text-sm font-bold tabular-nums",
              TONE_TEXT[kpiTone(blend.overallPercent)],
            )}
          >
            {displayKpiPercent(blend.overallPercent)}
          </span>
        </div>
      </div>
      {missing ? (
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
          No {missing === "tasks" ? "task checklist items" : "requests assigned"} in this period,
          so the overall KPI uses {missing === "tasks" ? "requests" : "tasks"} only.
        </p>
      ) : null}
    </section>
  );
}

function RequestBreakdown({ person }: { person: PersonnelKpiSummary }) {
  const r = person.requests;
  const resolvedShare = r.assigned > 0 ? (r.resolved / r.assigned) * 100 : 0;
  const overdueShare = r.assigned > 0 ? (r.overdue / r.assigned) * 100 : 0;
  return (
    <section aria-label="Request breakdown" className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Requests — how the resolution rate is built
        </h3>
        <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
          {r.assigned > 0 ? (
            <>
              <span className="font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                {r.resolved} of {r.assigned}
              </span>{" "}
              requests assigned in this period are resolved ={" "}
              <span className={cn("font-bold tabular-nums", TONE_TEXT[kpiTone(r.resolutionPercent)])}>
                {displayKpiPercent(r.resolutionPercent)}
              </span>
              . Resolved = For confirmation, Resolved, or Closed.
            </>
          ) : (
            "No requests were assigned to this person in this period."
          )}
        </p>
      </div>
      {r.assigned > 0 ? (
        <>
          <div className="flex h-5 w-full overflow-hidden rounded-md bg-zinc-100 dark:bg-zinc-800">
            <div
              className="h-full bg-emerald-500"
              style={{ width: `${resolvedShare}%` }}
              title={`${r.resolved} resolved`}
            />
            <div
              className="h-full bg-sky-300 dark:bg-sky-800"
              style={{ width: `${100 - resolvedShare - overdueShare}%` }}
              title={`${r.open - r.overdue} open, on time`}
            />
            <div
              className="h-full bg-rose-400 dark:bg-rose-700"
              style={{ width: `${overdueShare}%` }}
              title={`${r.overdue} overdue`}
            />
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <DetailStat label="Assigned" value={String(r.assigned)} />
            <DetailStat
              label="Resolved"
              value={String(r.resolved)}
              className="text-emerald-600 dark:text-emerald-400"
            />
            <DetailStat label="Still open" value={String(r.open)} className="text-sky-600 dark:text-sky-400" />
            <DetailStat
              label="Overdue"
              value={String(r.overdue)}
              className={r.overdue > 0 ? "text-rose-600 dark:text-rose-400" : undefined}
            />
          </div>
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
            Counts requests created in the period and currently assigned to this person, within
            this company. Overdue = still open and past the Request Board&apos;s 24-hour lane limit
            right now (same rule as Requests → Reports). Payment, requisition, and fund-transfer
            requests are excluded.
          </p>
        </>
      ) : null}
    </section>
  );
}

const TASK_PAGE_SIZE = 6;
const PERIOD_PAGE_SIZE = 8;

function Pager({
  label,
  page,
  pageCount,
  pageSize,
  total,
  onPage,
}: {
  label: string;
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}) {
  if (pageCount <= 1) return null;
  const from = page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);
  return (
    <nav
      aria-label={`${label} pages`}
      className="flex items-center justify-between gap-2 text-[11px] text-zinc-500 dark:text-zinc-400"
    >
      <span className="tabular-nums">
        {from}–{to} of {total} {label}
      </span>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 w-7 p-0"
          disabled={page <= 0}
          onClick={() => onPage(page - 1)}
          aria-label={`Previous ${label} page`}
        >
          <ChevronLeft className="size-3.5" aria-hidden />
        </Button>
        <span className="min-w-[4.5rem] text-center tabular-nums">
          Page {page + 1} of {pageCount}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 w-7 p-0"
          disabled={page >= pageCount - 1}
          onClick={() => onPage(page + 1)}
          aria-label={`Next ${label} page`}
        >
          <ChevronRight className="size-3.5" aria-hidden />
        </Button>
      </div>
    </nav>
  );
}

type ContributionSort = "impact" | "weight" | "name";

const CONTRIBUTION_SORTS: Array<{ id: ContributionSort; label: string }> = [
  { id: "impact", label: "Biggest drag" },
  { id: "weight", label: "Weight" },
  { id: "name", label: "Name" },
];

function frequencyKey(frequency: string): string {
  return frequency.trim().toUpperCase() || "ONE_OFF";
}

function points(value: number): string {
  return value.toFixed(1);
}

function WeightedAverageBreakdown({ detail }: { detail: PersonnelKpiDetail }) {
  const person = detail.person;
  const contributions = useMemo(
    () =>
      buildPersonnelKpiContributions(detail.tasks).sort(
        (a, b) => b.weightPercent - a.weightPercent || a.title.localeCompare(b.title),
      ),
    [detail.tasks],
  );
  const [frequency, setFrequency] = useState("ALL");
  const [sort, setSort] = useState<ContributionSort>("impact");
  const [page, setPage] = useState(0);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const activeId = hoveredId ?? pinnedId;

  const frequencies = useMemo(
    () => [...new Set(contributions.map((task) => frequencyKey(task.frequency)))],
    [contributions],
  );
  const inFilter = (task: { frequency: string }) =>
    frequency === "ALL" || frequencyKey(task.frequency) === frequency;
  const compareRows = (a: (typeof contributions)[number], b: (typeof contributions)[number]) => {
    if (sort === "weight") return b.weightPercent - a.weightPercent;
    if (sort === "name") return a.title.localeCompare(b.title);
    return b.lostPoints - a.lostPoints || b.weightPercent - a.weightPercent;
  };
  const rows = contributions.filter(inFilter).sort(compareRows);
  const pageCount = Math.max(1, Math.ceil(rows.length / TASK_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageRows = rows.slice(currentPage * TASK_PAGE_SIZE, (currentPage + 1) * TASK_PAGE_SIZE);
  const shown = rows.reduce(
    (sum, task) => ({
      weight: sum.weight + task.weightPercent,
      earned: sum.earned + task.earnedPoints,
      lost: sum.lost + task.lostPoints,
    }),
    { weight: 0, earned: 0, lost: 0 },
  );

  if (contributions.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
        No KPI checklist items are attributed to this person in the selected range, so there is no
        task KPI.
      </p>
    );
  }

  return (
    <section aria-label="Weighted average breakdown" className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Tasks — how the task KPI is built
        </h3>
        <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
          <span className="font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
            {person.doneItems} of {person.totalItems}
          </span>{" "}
          checklist items done ={" "}
          <span className={cn("font-bold tabular-nums", TONE_TEXT[kpiTone(person.kpiPercent)])}>
            {displayKpiPercent(person.kpiPercent)}
          </span>
          . Each task weighs as much as its share of the items, so bigger tasks move the average
          more. Click a bar segment or hover a row to match them up.
        </p>
      </div>

      <div>
        <div className="flex h-5 w-full overflow-hidden rounded-md bg-zinc-100 dark:bg-zinc-800">
          {contributions.map((task) => {
            const donePart = task.weightPercent > 0 ? (task.earnedPoints / task.weightPercent) * 100 : 0;
            const dimmed =
              !inFilter(task) || (activeId != null && activeId !== task.kpiId);
            return (
              <button
                key={task.kpiId}
                type="button"
                onClick={() => {
                  const pinning = pinnedId !== task.kpiId;
                  setPinnedId(pinning ? task.kpiId : null);
                  if (!pinning) return;
                  // Bring the pinned task into view: show all frequencies if it is filtered out.
                  const list = inFilter(task) ? rows : [...contributions].sort(compareRows);
                  if (!inFilter(task)) setFrequency("ALL");
                  const index = list.findIndex((row) => row.kpiId === task.kpiId);
                  if (index >= 0) setPage(Math.floor(index / TASK_PAGE_SIZE));
                }}
                onMouseEnter={() => setHoveredId(task.kpiId)}
                onMouseLeave={() => setHoveredId(null)}
                aria-pressed={pinnedId === task.kpiId}
                aria-label={`${task.title}: ${points(task.earnedPoints)} of ${points(task.weightPercent)} points`}
                title={`${task.title} — weight ${points(task.weightPercent)}%, earned ${points(task.earnedPoints)} pts, lost ${points(task.lostPoints)} pts`}
                style={{ width: `${task.weightPercent}%` }}
                className={cn(
                  "relative h-full min-w-[3px] border-r border-white transition-opacity last:border-r-0 dark:border-zinc-950",
                  dimmed ? "opacity-30" : "opacity-100",
                  activeId === task.kpiId && "ring-2 ring-inset ring-orange-500",
                )}
              >
                <span className="absolute inset-0 bg-rose-300/70 dark:bg-rose-900/70" aria-hidden />
                <span
                  className="absolute inset-y-0 left-0 bg-emerald-500"
                  style={{ width: `${donePart}%` }}
                  aria-hidden
                />
              </button>
            );
          })}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-zinc-500 dark:text-zinc-400">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-emerald-500" aria-hidden />
            Earned points
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-rose-300 dark:bg-rose-900" aria-hidden />
            Lost to incomplete items
          </span>
          <span>Segment width = task weight</span>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by frequency">
          {["ALL", ...frequencies].map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                setFrequency(key);
                setPage(0);
              }}
              aria-pressed={frequency === key}
              className={cn(
                "rounded-full px-2.5 py-1 text-[11px] font-semibold transition",
                frequency === key
                  ? "bg-orange-600 text-white"
                  : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700",
              )}
            >
              {key === "ALL" ? "All tasks" : personnelKpiFrequencyLabel(key)}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
          Sort
          <select
            value={sort}
            onChange={(e) => {
              setSort(e.target.value as ContributionSort);
              setPage(0);
            }}
            className="h-7 rounded-md border border-zinc-300 bg-white px-1.5 text-[11px] text-zinc-700 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200"
          >
            {CONTRIBUTION_SORTS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <ul className="space-y-1.5">
        {pageRows.map((task) => (
          <li
            key={task.kpiId}
            onMouseEnter={() => setHoveredId(task.kpiId)}
            onMouseLeave={() => setHoveredId(null)}
            className={cn(
              "rounded-lg border p-2.5 transition",
              activeId === task.kpiId
                ? "border-orange-400 bg-orange-50/60 dark:border-orange-500/60 dark:bg-orange-950/20"
                : "border-zinc-200 dark:border-zinc-800",
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  {task.title}
                </p>
                <p className="mt-0.5 truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                  {[task.pillar, personnelKpiFrequencyLabel(task.frequency)]
                    .filter(Boolean)
                    .join(" · ")}
                  {task.lastPeriodKey ? ` · Latest: ${personnelKpiPeriodLabel(task.lastPeriodKey)}` : ""}
                </p>
              </div>
              <span
                className={cn(
                  "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset",
                  STATUS_BADGE[task.status],
                )}
              >
                {personnelKpiStatusLabel(task.status)}
              </span>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] sm:grid-cols-5">
              <Metric label="Weight" value={`${points(task.weightPercent)}%`} />
              <Metric label="Items" value={`${task.doneItems}/${task.totalItems}`} />
              <Metric
                label="Task KPI"
                value={displayKpiPercent(task.kpiPercent)}
                className={TONE_TEXT[kpiTone(task.kpiPercent)]}
              />
              <Metric
                label="Earned"
                value={`+${points(task.earnedPoints)} pts`}
                className="text-emerald-600 dark:text-emerald-400"
              />
              <Metric
                label="Lost"
                value={task.lostPoints > 0 ? `−${points(task.lostPoints)} pts` : "0 pts"}
                className={task.lostPoints > 0 ? "text-rose-600 dark:text-rose-400" : undefined}
              />
            </div>
            <div className="mt-1.5 flex justify-end">
              <Link
                href={`/work/tasks?task=${encodeURIComponent(task.kpiId)}`}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-orange-600 hover:underline dark:text-orange-400"
              >
                Open in Work
                <ArrowUpRight className="size-3" aria-hidden />
              </Link>
            </div>
          </li>
        ))}
      </ul>
      <Pager
        label="tasks"
        page={currentPage}
        pageCount={pageCount}
        pageSize={TASK_PAGE_SIZE}
        total={rows.length}
        onPage={setPage}
      />

      <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
        {frequency === "ALL" ? "All" : personnelKpiFrequencyLabel(frequency)} tasks: weight{" "}
        <span className="font-semibold tabular-nums">{points(shown.weight)}%</span>, earned{" "}
        <span className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
          {points(shown.earned)} pts
        </span>
        , lost{" "}
        <span className="font-semibold tabular-nums text-rose-600 dark:text-rose-400">
          {points(shown.lost)} pts
        </span>
        . Earned points across all tasks add up to the task KPI.
      </p>
    </section>
  );
}

function Metric({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div>
      <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-zinc-400 dark:text-zinc-500">
        {label}
      </p>
      <p className={cn("font-semibold tabular-nums text-zinc-800 dark:text-zinc-200", className)}>
        {value}
      </p>
    </div>
  );
}

function DetailStat({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">
        {label}
      </p>
      <p className={cn("mt-1 text-lg font-bold tabular-nums", className ?? "text-zinc-900 dark:text-white")}>
        {value}
      </p>
    </div>
  );
}

function BreakdownTable({
  title,
  rows,
}: {
  title: string;
  rows: PersonnelKpiDetail["frequencies"];
}) {
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(rows.length / PERIOD_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageRows = rows.slice(
    currentPage * PERIOD_PAGE_SIZE,
    (currentPage + 1) * PERIOD_PAGE_SIZE,
  );
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</h3>
      {rows.length > 0 ? (
        <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-left text-xs">
            <thead className="bg-zinc-50 text-[10px] uppercase tracking-wide text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
              <tr>
                <th className="px-3 py-2 font-semibold">Period</th>
                <th className="px-3 py-2 text-right font-semibold">KPI</th>
                <th className="px-3 py-2 text-right font-semibold">Items</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {pageRows.map((row) => (
                <tr key={row.key}>
                  <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300">{row.label}</td>
                  <td
                    className={cn(
                      "px-3 py-2 text-right font-semibold tabular-nums",
                      TONE_TEXT[kpiTone(row.kpiPercent)],
                    )}
                  >
                    {displayKpiPercent(row.kpiPercent)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-zinc-500 dark:text-zinc-400">
                    {row.doneItems}/{row.totalItems}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-zinc-300 p-4 text-xs text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          No recorded periods.
        </p>
      )}
      <Pager
        label="rows"
        page={currentPage}
        pageCount={pageCount}
        pageSize={PERIOD_PAGE_SIZE}
        total={rows.length}
        onPage={setPage}
      />
    </div>
  );
}
