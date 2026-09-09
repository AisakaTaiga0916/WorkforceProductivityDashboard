"use client";

import type { LucideIcon } from "lucide-react";
import {
  Cloud,
  Activity,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  FileText,
  Headphones,
  LayoutGrid,
  Smile,
  Wrench,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import { SimplePaginationBar } from "@/components/ui/SimplePaginationBar";
import { DatePickerField } from "@/components/ui/DatePickerField";
import { JOB_ORDER_REQUEST_PILLAR_TITLE } from "@/lib/it-task-pillar-titles";
import type { TaskMetricsCadence } from "@/lib/task-metrics-range";
import {
  isInvertedChecklistPillar,
  kpiChecklistMetricView,
} from "@/lib/kpi-subkpis";
import type {
  TaskChecklistIncludedTask,
  TaskChecklistPillarMetrics,
  TaskMetricsHelpdeskTickets,
  TaskMetricsUserSupportTickets,
} from "@/lib/kpis";
import type { TaskMetricsTaskType } from "@/lib/task-metrics-task-type";
import {
  combinedPersonnelEfficiency,
  mergePersonnelRequestMetrics,
  personnelEfficiencyBracket,
  type PersonnelCombinedMetricCard,
} from "@/lib/task-personnel-metrics";
import {
  KPI_DONUT_COLORS,
  KINETIC_PALETTE,
  USER_SUPPORT_STAR_COLORS,
} from "@/lib/kinetic-palette";

const PILLAR_ICONS: Record<string, LucideIcon> = {
  "HELPDESK SUPPORT": Headphones,
  "DATA BACKUP": Cloud,
  "SYSTEM MAINTENANCE": Wrench,
  MONITORING: Activity,
  DOCUMENTATION: FileText,
  "USER SUPPORT": Smile,
  "IT PROJECT IMPLEMENTATION": LayoutGrid,
  PROJECTS: LayoutGrid,
  [JOB_ORDER_REQUEST_PILLAR_TITLE]: LayoutGrid,
};

/** Display titles for canonical internal pillar keys. */
const PILLAR_DISPLAY_NAMES: Record<string, string> = {
  "HELPDESK SUPPORT": "REQUEST SUPPORT",
  "ONE-OFF": "One-Off",
  DAILY: "Daily",
  WEEKLY: "Weekly",
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  SEMI_ANNUAL: "Semi Annual",
  YEARLY: "Annualy",
  "FIELD ASSIGNMENT": "Field Assignment",
  PROJECTS: "Projects",
  "IT PROJECT IMPLEMENTATION": "Projects",
  "JOB ORDER REQUEST": "Projects",
};

export function pillarDisplayName(pillar: string): string {
  return PILLAR_DISPLAY_NAMES[pillar] ?? pillar;
}

/** New task groups created on the Task Board don't have a curated icon yet. */
const DEFAULT_PILLAR_ICON: LucideIcon = ClipboardList;

function pillarIcon(pillar: string): LucideIcon {
  return PILLAR_ICONS[pillar] ?? DEFAULT_PILLAR_ICON;
}

/** Helpdesk pillar: closed vs remainder of denominator (cadence-specific). */
const SEG_COLORS_HELPDESK = {
  closed: KPI_DONUT_COLORS.closed,
  remainder: KPI_DONUT_COLORS.remainder,
} as const;

/** User support pillar: request status mix */
const SEG_COLORS_USER_SUPPORT = USER_SUPPORT_STAR_COLORS;

/** Two-bucket pillars: on-track + on-time vs overdue (same underlying kanban logic). */
const SEG_COLORS_BINARY_KPI = {
  positive: KPI_DONUT_COLORS.positive,
  negative: KPI_DONUT_COLORS.negative,
} as const;

/** Donut wedge in viewBox centered at (50,50). */
function donutSlicePath(
  cx: number,
  cy: number,
  rOut: number,
  rIn: number,
  startAngle: number,
  endAngle: number,
): string {
  const x1 = cx + rOut * Math.cos(startAngle);
  const y1 = cy + rOut * Math.sin(startAngle);
  const x2 = cx + rOut * Math.cos(endAngle);
  const y2 = cy + rOut * Math.sin(endAngle);
  const x3 = cx + rIn * Math.cos(endAngle);
  const y3 = cy + rIn * Math.sin(endAngle);
  const x4 = cx + rIn * Math.cos(startAngle);
  const y4 = cy + rIn * Math.sin(startAngle);
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
  return `M ${x1} ${y1} A ${rOut} ${rOut} 0 ${largeArc} 1 ${x2} ${y2} L ${x3} ${y3} A ${rIn} ${rIn} 0 ${largeArc} 0 ${x4} ${y4} Z`;
}

type DonutSegment = { key: string; label: string; value: number; color: string };

/** ChartView y-axis: even efficiency ticks starting at 20% up to 100%. */
const EFFICIENCY_TICKS = [100, 80, 60, 40, 20];

function formatHistoryDate(date: string): string {
  const [, month, day] = date.split("-");
  return `${month}/${day}`;
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** "March–August 2026" / "July 2026" / "March 2026–March 2027" from YYYY-MM pairs. */
function formatMonthSpan(range: { fromYm: string; toYm: string }): string {
  const from = range.fromYm.split("-").map(Number);
  const to = range.toYm.split("-").map(Number);
  if (from.length < 2 || to.length < 2 || !from[0] || !from[1] || !to[0] || !to[1]) {
    return range.fromYm;
  }
  const [fy, fm] = from as [number, number];
  const [ty, tm] = to as [number, number];
  const fromName = MONTH_NAMES[fm - 1] ?? "";
  const toName = MONTH_NAMES[tm - 1] ?? "";
  if (fy === ty && fm === tm) return `${fromName} ${fy}`;
  if (fy === ty) return `${fromName}–${toName} ${ty}`;
  return `${fromName} ${fy}–${toName} ${ty}`;
}

/** One efficiency point on a ChartView monitor (inverted-aware). */
type ChartPoint = {
  date: string;
  /** Displayed efficiency percent (inverted-aware for safe/uptime pillars). */
  pct: number;
  /** Positive bucket: done for normal checklists, safe for inverted pillars. */
  done: number;
  total: number;
  contributors?: string[];
};

/** ChartView date-range finder row. */
function ChartRangeFinder({
  from,
  to,
  hasRange,
  onFromChange,
  onToChange,
  onClear,
}: {
  from: string;
  to: string;
  hasRange: boolean;
  onFromChange: (v: string) => void;
  onToChange: (v: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="mt-3 flex flex-wrap items-end gap-2 rounded-xl border border-zinc-200 bg-zinc-50/80 p-2.5 dark:border-zinc-700/80 dark:bg-zinc-900/50">
      <label className="flex min-w-0 flex-col gap-1 text-[9px] font-bold uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-500">
        From
        <DatePickerField
          value={from}
          max={to || undefined}
          onChange={(e) => onFromChange(e.target.value)}
          wrapperClassName="w-36"
          shellClassName="h-9"
        />
      </label>
      <label className="flex min-w-0 flex-col gap-1 text-[9px] font-bold uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-500">
        To
        <DatePickerField
          value={to}
          min={from || undefined}
          onChange={(e) => onToChange(e.target.value)}
          wrapperClassName="w-36"
          shellClassName="h-9"
        />
      </label>
      {hasRange ? (
        <button
          type="button"
          onClick={onClear}
          className="ml-auto rounded-full border border-zinc-300 px-2.5 py-1.5 text-[10px] font-semibold text-zinc-600 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Reset range
        </button>
      ) : (
        <span className="ml-auto pb-1.5 text-[10px] text-zinc-400 dark:text-zinc-500">
          Filter charts by recorded date range
        </span>
      )}
    </div>
  );
}

/** ChartView: per-subtask efficiency monitor — 2x2 grid with pagination. */
function TaskEfficiencyMonitorChart({
  tasks,
  invert = false,
  loading = false,
  error = null,
  recordedRange = null,
  onRangeChange,
}: {
  tasks: TaskChecklistIncludedTask[];
  /** Inverted (safe/uptime) recording: charts plot the unchecked/safe share. */
  invert?: boolean;
  /** True while a wider range is being fetched from the server. */
  loading?: boolean;
  error?: string | null;
  /**
   * DB-wide recorded snapshot span for this pillar. Shown as a hint when the
   * current view has no data but older recorded data exists in the database.
   */
  recordedRange?: { fromYm: string; toYm: string } | null;
  /** Fired when the range changes to a full from/to (or null when cleared). */
  onRangeChange?: (range: { from: string; to: string } | null) => void;
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const hasRange = Boolean(from || to);
  const [viewMode, setViewMode] = useState<"grid" | "single">("grid");
  const [singleIndex, setSingleIndex] = useState(0);

  // Notify the parent to fetch the picked range from the server (a full from+to
  // triggers a real refetch); clearing the range reverts to panel-period data.
  useEffect(() => {
    onRangeChange?.(from && to ? { from, to } : null);
  }, [from, to, onRangeChange]);

  const inRange = useCallback(
    (date: string) => (!from || date >= from) && (!to || date <= to),
    [from, to],
  );

  const withHistory = useMemo(() => {
    return tasks
      .map((task) => {
        // Inverted recording is a per-task flag (checked = breach/downtime, so the
        // chart plots the unchecked/safe share). Fall back to the pillar-level flag
        // only for tasks that don't carry their own. This keeps e.g. the network
        // performance / cybersecurity tasks on the safe/uptime method even when the
        // inspected pillar itself isn't flagged inverted.
        const taskInvert = task.invertedRecording ?? invert;
        return {
          task,
          taskInvert,
          points: (task.history ?? [])
            .filter((p) => inRange(p.date))
            .map((p) => {
              const view = kpiChecklistMetricView(p, taskInvert);
              const point: ChartPoint = {
                date: p.date,
                pct: Math.max(0, Math.min(100, Math.round(view.percent))),
                done: view.positive,
                total: view.total,
              };
              if (p.contributors && p.contributors.length > 0) {
                point.contributors = p.contributors;
              }
              return point;
            }),
        };
      })
      .filter((entry) => entry.points.length > 0);
  }, [tasks, inRange, invert]);

  const [page, setPage] = useState(1);
  const pageSize = 4;
  const totalPages = Math.max(1, Math.ceil(withHistory.length / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  // Reset to the first item when data or the date range changes.
  useEffect(() => {
    const id = window.setTimeout(() => {
      setPage(1);
      setSingleIndex(0);
    }, 0);
    return () => window.clearTimeout(id);
  }, [from, to, withHistory.length]);
  const pagedTasks = useMemo(
    () => withHistory.slice((safePage - 1) * pageSize, safePage * pageSize),
    [withHistory, safePage, pageSize],
  );
  const safeSingleIndex = Math.min(
    Math.max(0, singleIndex),
    Math.max(0, withHistory.length - 1),
  );
  const singleEntry = withHistory[safeSingleIndex] ?? null;

  const clearRange = () => {
    setFrom("");
    setTo("");
  };

  // All charted tasks inverted → label the legend as safe/uptime; mixed pillars
  // keep the generic efficiency label and each inverted chart shows its own badge.
  const everyInverted =
    withHistory.length > 0 && withHistory.every((entry) => entry.taskInvert);

  if (withHistory.length === 0) {
    return (
      <>
        <ChartRangeFinder
          from={from}
          to={to}
          hasRange={hasRange}
          onFromChange={setFrom}
          onToChange={setTo}
          onClear={clearRange}
        />
        {loading ? (
          <p className="mt-4 text-center text-xs font-semibold text-orange-700 dark:text-orange-300">
            Loading charts for the selected range…
          </p>
        ) : error ? (
          <p className="mt-4 rounded-lg border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-center text-xs text-rose-800 dark:text-rose-200">
            {error}
          </p>
        ) : (
          <div className="mt-4 space-y-2">
            <p className="text-center text-xs text-zinc-500 dark:text-zinc-400">
              {hasRange
                ? "No recorded data for the selected date range."
                : "No per-date history recorded for these tasks within the selected period."}
            </p>
            {recordedRange ? (
              <p className="mx-auto max-w-sm rounded-lg border border-sky-300/50 bg-sky-500/10 px-3 py-2 text-center text-[11px] font-medium text-sky-800 dark:border-sky-500/30 dark:bg-sky-500/15 dark:text-sky-200">
                Data exists for {formatMonthSpan(recordedRange)}
                {hasRange
                  ? " — try a wider date range."
                  : " — use the date range finder above to browse it."}
              </p>
            ) : null}
          </div>
        )}
      </>
    );
  }
  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">
        <span className="size-2.5 rounded-sm bg-emerald-500" aria-hidden />
        {everyInverted
          ? "Safe / uptime % (unchecked / total) per date"
          : "Efficiency % (done / total) per date"}
        <span className="ml-auto text-[10px] font-normal text-zinc-400 dark:text-zinc-500">
          {withHistory.length} task{withHistory.length === 1 ? "" : "s"} with data
        </span>
        <div className="inline-flex items-center rounded-full border border-zinc-200 bg-zinc-100/80 p-0.5 dark:border-zinc-700 dark:bg-zinc-900/60">
          <button
            type="button"
            onClick={() => setViewMode("grid")}
            className={cn(
              "rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider transition",
              viewMode === "grid"
                ? "bg-orange-600 text-white shadow-sm"
                : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100",
            )}
          >
            2×2
          </button>
          <button
            type="button"
            onClick={() => setViewMode("single")}
            className={cn(
              "rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider transition",
              viewMode === "single"
                ? "bg-orange-600 text-white shadow-sm"
                : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100",
            )}
          >
            Single
          </button>
        </div>
      </div>
      <ChartRangeFinder
        from={from}
        to={to}
        hasRange={hasRange}
        onFromChange={setFrom}
        onToChange={setTo}
        onClear={clearRange}
      />
      {loading ? (
        <p className="mt-3 text-xs font-semibold text-orange-700 dark:text-orange-300">
          Loading charts for the selected range…
        </p>
      ) : error ? (
        <p className="mt-3 rounded-lg border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-800 dark:text-rose-200">
          {error}
        </p>
      ) : null}
      <div className={cn(loading && "pointer-events-none opacity-60")}>
      {viewMode === "single" && singleEntry ? (
        <div className="mt-4">
          <TaskEfficiencyChart
            key={singleEntry.task.id}
            task={singleEntry.task}
            points={singleEntry.points}
            invert={singleEntry.taskInvert}
            large
          />
          <div className="mt-3 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setSingleIndex((i) => Math.max(0, i - 1))}
              disabled={safeSingleIndex <= 0}
              className="inline-flex items-center gap-1 rounded-full border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-600 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              <ChevronLeft className="size-4" aria-hidden />
              Previous
            </button>
            <span className="text-[11px] font-semibold tabular-nums text-zinc-500 dark:text-zinc-400">
              {safeSingleIndex + 1} of {withHistory.length}
            </span>
            <button
              type="button"
              onClick={() => setSingleIndex((i) => Math.min(withHistory.length - 1, i + 1))}
              disabled={safeSingleIndex >= withHistory.length - 1}
              className="inline-flex items-center gap-1 rounded-full border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-600 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Next
              <ChevronRight className="size-4" aria-hidden />
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {pagedTasks.map(({ task, taskInvert, points }) => (
              <TaskEfficiencyChart key={task.id} task={task} points={points} invert={taskInvert} />
            ))}
          </div>
          {totalPages > 1 ? (
            <div className="mt-3">
              <SimplePaginationBar
                page={safePage}
                pageSize={pageSize}
                total={withHistory.length}
                onPageChange={setPage}
                itemLabel="tasks"
              />
            </div>
          ) : null}
        </>
      )}
      </div>
    </div>
  );
}

function TaskEfficiencyChart({
  task,
  points,
  invert = false,
  large = false,
}: {
  task: TaskChecklistIncludedTask;
  points: ChartPoint[];
  invert?: boolean;
  /** Taller chart used by the single-chart view. */
  large?: boolean;
}) {
  // The chart modal is wide enough for more x-axis labels, so denser date ranges
  // (e.g. a full year of daily data) stay readable instead of thinning to ~8 labels.
  const labelDivisor = large ? 16 : 12;
  const labelEvery = points.length > labelDivisor ? Math.ceil(points.length / labelDivisor) : 1;
  const totalRecords = task.history?.length ?? 0;
  return (
    <div className="rounded-xl border border-zinc-200/80 bg-white p-3 dark:border-zinc-700/80 dark:bg-zinc-900/60">
      <div className="flex items-center gap-2 border-b border-zinc-200 pb-1.5 dark:border-zinc-800">
        <p className="truncate text-[12px] font-semibold text-zinc-800 dark:text-zinc-100" title={task.title}>
          {task.title}
        </p>
        <span
          className="shrink-0 text-[9px] font-semibold tabular-nums text-zinc-500 dark:text-zinc-400"
          title="Total recorded data points for this task"
        >
          {points.length === totalRecords || totalRecords === 0
            ? `${points.length} record${points.length === 1 ? "" : "s"}`
            : `${points.length} of ${totalRecords} records`}
        </span>
        {invert ? (
          <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[8px] font-bold uppercase tracking-wider text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
            inverted
          </span>
        ) : null}
        <span className="ml-auto shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-[8px] font-bold uppercase tracking-wider text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
          {task.frequency ?? "—"}
        </span>
      </div>
      <div className="mt-2 flex">
        <div className={cn("relative w-9 shrink-0", large ? "h-56" : "h-32")}>
          {EFFICIENCY_TICKS.map((tick) => (
            <span
              key={tick}
              className={cn(
                "absolute right-1 -translate-y-1/2 font-medium tabular-nums text-zinc-500 dark:text-zinc-400",
                large ? "text-[9px]" : "text-[8px]",
              )}
              style={{ top: `${100 - tick}%` }}
            >
              {tick}%
            </span>
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <div className={cn("relative", large ? "h-56" : "h-32")}>
            {EFFICIENCY_TICKS.map((tick) => (
              <div
                key={tick}
                className="absolute inset-x-0 border-t border-dashed border-zinc-200 dark:border-zinc-700/70"
                style={{ top: `${100 - tick}%` }}
              />
            ))}
            <div className="absolute inset-0 flex items-end gap-[1px] px-0.5">
              {points.map((p) => (
                <div
                  key={p.date}
                  className="group relative flex h-full flex-1 flex-col items-center justify-end"
                >
                  {/* Tooltip on hover */}
                  <div className="pointer-events-none absolute bottom-full z-10 mb-1 hidden w-max max-w-36 rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-[10px] shadow-lg group-hover:block dark:border-zinc-700 dark:bg-zinc-900">
                    <p className="font-semibold text-zinc-800 dark:text-zinc-100">{p.date}</p>
                    <p className="text-zinc-600 dark:text-zinc-400">
                      {p.pct}% · {p.done}/{p.total} {invert ? "safe" : "done"}
                    </p>
                    {task.assigneeName ? (
                      <p className="text-zinc-500 dark:text-zinc-500">
                        Assignee: {task.assigneeName}
                      </p>
                    ) : null}
                    {p.contributors && p.contributors.length > 0 ? (
                      <p className="text-zinc-500 dark:text-zinc-500">
                        Contributions: {p.contributors.join(", ")}
                      </p>
                    ) : null}
                  </div>
                  <span
                    className={cn(
                      "font-semibold tabular-nums text-zinc-600 dark:text-zinc-400",
                      large ? "text-[9px]" : "text-[8px]",
                    )}
                  >
                    {p.pct}%
                  </span>
                  <div
                    className={cn(
                      "w-full rounded-t-sm bg-emerald-500 transition-all group-hover:bg-emerald-400",
                      large ? "max-w-10" : "max-w-8",
                    )}
                    style={{ height: `max(2px, calc(${p.pct}% - 14px))` }}
                  />
                </div>
              ))}
            </div>
          </div>
          <div className="mt-1 flex gap-[1px] px-0.5">
            {points.map((p, i) => (
              <span
                key={p.date}
                className={cn(
                  "flex-1 truncate text-center tabular-nums text-zinc-500 dark:text-zinc-400",
                  large ? "text-[9px]" : "text-[8px]",
                )}
                title={p.date}
              >
                {i % labelEvery === 0 || i === points.length - 1 ? formatHistoryDate(p.date) : ""}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function PillarDonutCard({
  pillar,
  segments,
  headline,
  subLabel,
  onInspect,
}: {
  pillar: string;
  segments: DonutSegment[];
  headline: string;
  subLabel?: string;
  onInspect: () => void;
}) {
  const Icon = pillarIcon(pillar);
  const [lastTapMs, setLastTapMs] = useState(0);
  const total = segments.reduce((a, s) => a + s.value, 0);
  const cx = 50;
  const cy = 50;
  const rOut = 36;
  const rIn = 24;
  const centerLabel = headline.split(" ")[0] ?? headline;
  let angle = -Math.PI / 2;
  const paths: { d: string; color: string; label: string; value: number }[] = [];

  if (total > 0) {
    for (const seg of segments) {
      if (seg.value <= 0) continue;
      const sliceAngle = (seg.value / total) * 2 * Math.PI;
      const isFull = sliceAngle >= 2 * Math.PI - 1e-3;
      if (isFull) {
        paths.push({ d: "__FULL__", color: seg.color, label: seg.label, value: seg.value });
        angle += sliceAngle;
        continue;
      }
      const end = angle + sliceAngle;
      paths.push({
        d: donutSlicePath(cx, cy, rOut, rIn, angle, end),
        color: seg.color,
        label: seg.label,
        value: seg.value,
      });
      angle = end;
    }
  }

  return (
    <article
      role="button"
      tabIndex={0}
      title="Double-click or double-tap to view the tasks in this donut"
      onDoubleClick={onInspect}
      onKeyDown={(e) => {
        if (e.key === "Enter") onInspect();
      }}
      onTouchEnd={() => {
        const now = Date.now();
        if (now - lastTapMs < 350) onInspect();
        setLastTapMs(now);
      }}
      className="flex cursor-pointer flex-col rounded-2xl border border-zinc-200/90 bg-white p-4 shadow-[0_8px_24px_rgba(15,23,42,0.06)] outline-none transition hover:border-orange-300 focus:ring-2 focus:ring-orange-500/30 dark:border-zinc-700/80 dark:bg-zinc-900/40 dark:shadow-[0_12px_32px_rgba(0,0,0,0.35)] dark:hover:border-orange-700/70"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-500">
            {pillarDisplayName(pillar)}
          </p>
          <p className="mt-1.5 text-2xl font-bold tabular-nums tracking-tight text-zinc-900 dark:text-zinc-50">
            {headline}
          </p>
          {subLabel ? (
            <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-orange-700 dark:text-orange-300">
              {subLabel}
            </p>
          ) : null}
        </div>
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
          <Icon className="size-[18px]" strokeWidth={1.75} aria-hidden />
        </span>
      </div>

      <div className="mt-4 flex flex-1 flex-col items-center justify-center">
        <svg viewBox="0 0 100 100" className="mx-auto h-36 w-36" aria-hidden>
          {total === 0 ? (
            <>
              <circle
                cx={cx}
                cy={cy}
                r={rOut}
                fill="none"
                stroke={KINETIC_PALETTE.donutTrack}
                strokeWidth={6}
                className="dark:stroke-zinc-700"
              />
              <circle
                cx={cx}
                cy={cy}
                r={rIn}
                fill="white"
                className="dark:fill-zinc-900/80"
              />
              <text
                x={cx}
                y={cy + 3}
                textAnchor="middle"
                className="fill-zinc-900 text-[9px] font-black dark:fill-zinc-100"
              >
                {centerLabel}
              </text>
            </>
          ) : (
            <>
              {paths.map((p, i) =>
                p.d === "__FULL__" ? (
                  <g key={`${p.label}-full`}>
                    <circle
                      cx={cx}
                      cy={cy}
                      r={rOut}
                      fill={p.color}
                      stroke={KINETIC_PALETTE.donutStroke}
                      strokeWidth="0.35"
                      className="dark:stroke-zinc-950"
                    />
                    <circle cx={cx} cy={cy} r={rIn} fill="white" className="dark:fill-zinc-900/80" />
                  </g>
                ) : (
                  <path
                    key={`${p.label}-${i}`}
                    d={p.d}
                    fill={p.color}
                    stroke={KINETIC_PALETTE.donutStroke}
                    strokeWidth="0.35"
                    className="dark:stroke-zinc-950"
                  />
                ),
              )}
              <circle cx={cx} cy={cy} r={rIn} fill="white" className="dark:fill-zinc-900/80" />
              <text
                x={cx}
                y={cy + 3}
                textAnchor="middle"
                className="fill-zinc-900 text-[9px] font-black dark:fill-zinc-100"
              >
                {centerLabel}
              </text>
            </>
          )}
        </svg>
      </div>
    </article>
  );
}

type ChecklistPillarConfig = {
  positiveLabel: string;
  negativeLabel: string;
  metricName: string;
  /** Unchecked = safe/uptime; checked on task board = breach/downtime. */
  invertChecklist?: boolean;
};

/** Dynamic task groups without a curated config render as a plain Done/Missing donut. */
const DEFAULT_CHECKLIST_PILLAR_CONFIG: ChecklistPillarConfig = {
  positiveLabel: "Done",
  negativeLabel: "Missing",
  metricName: "done",
};

const CHECKLIST_PILLAR_CONFIG: Partial<Record<string, ChecklistPillarConfig>> = {
  CYBERSECURITY: {
    positiveLabel: "Safe",
    negativeLabel: "Breached",
    metricName: "safe",
    invertChecklist: true,
  },
  "NETWORK PERFORMANCE": {
    positiveLabel: "Uptime",
    negativeLabel: "Downtime",
    metricName: "uptime",
    invertChecklist: true,
  },
  "DATA BACKUP": { positiveLabel: "Done", negativeLabel: "Failed", metricName: "done" },
  "SYSTEM MAINTENANCE": { positiveLabel: "Done", negativeLabel: "Failed", metricName: "done" },
  MONITORING: { positiveLabel: "Done", negativeLabel: "Failed", metricName: "done" },
  DOCUMENTATION: { positiveLabel: "Done", negativeLabel: "Missing", metricName: "done" },
  "IT PROJECT IMPLEMENTATION": {
    positiveLabel: "On time",
    negativeLabel: "Delayed",
    metricName: "on time",
  },
  PROJECTS: {
    positiveLabel: "On time",
    negativeLabel: "Delayed",
    metricName: "on time",
  },
  [JOB_ORDER_REQUEST_PILLAR_TITLE]: {
    positiveLabel: "On time",
    negativeLabel: "Delayed",
    metricName: "on time",
  },
};

function checklistConfigForPillar(pillar: string): ChecklistPillarConfig {
  const curated = CHECKLIST_PILLAR_CONFIG[pillar];
  if (curated) return curated;
  const upper = pillar.trim().toUpperCase();
  if (upper.includes("JOB ORDER") || upper.includes("PROJECT")) {
    return {
      positiveLabel: "On time",
      negativeLabel: "Delayed",
      metricName: "on time",
    };
  }
  return DEFAULT_CHECKLIST_PILLAR_CONFIG;
}

function checklistProgressSegments(
  view: { positive: number; negative: number },
  positiveLabel: string,
  negativeLabel: string,
  opts?: { hideZeroNegative?: boolean },
): DonutSegment[] {
  const segments: DonutSegment[] = [
    {
      key: "positive",
      label: positiveLabel,
      value: view.positive,
      color: SEG_COLORS_BINARY_KPI.positive,
    },
    {
      key: "negative",
      label: negativeLabel,
      value: view.negative,
      color: SEG_COLORS_BINARY_KPI.negative,
    },
  ];
  if (opts?.hideZeroNegative) {
    return segments.filter((s) => s.value > 0);
  }
  return segments;
}

function userSupportSegments(us: TaskMetricsUserSupportTickets): DonutSegment[] {
  return us.starCounts
    .filter((row) => row.count > 0)
    .map((row) => ({
      key: `${row.star}-star`,
      label: `${row.star} star${row.star === 1 ? "" : "s"}`,
      value: row.count,
      color: SEG_COLORS_USER_SUPPORT[row.star],
    }));
}

function helpdeskRatioSegments(ht: TaskMetricsHelpdeskTickets): DonutSegment[] {
  const closed = ht.closedCount;
  const open = ht.openTicketsInPeriod;
  const closedLabel = ht.cadence === "YEARLY" ? "Closed in year" : "Closed in month";
  const openLabel = ht.cadence === "YEARLY" ? "Open in year" : "Open in month";
  return [
    { key: "closed", label: closedLabel, value: closed, color: SEG_COLORS_HELPDESK.closed },
    { key: "open", label: openLabel, value: open, color: SEG_COLORS_HELPDESK.remainder },
  ];
}

function PersonnelMetricStatBox({
  label,
  value,
  subLabel,
  tone,
}: {
  label: string;
  value: string | number;
  subLabel: string;
  tone: "green" | "neutral" | "amber" | "teal" | "rose";
}) {
  const toneClass =
    tone === "green"
      ? "border-emerald-500/20 bg-emerald-500/8 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      : tone === "amber"
        ? "border-amber-500/20 bg-amber-500/8 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300"
        : tone === "teal"
          ? "border-teal-500/25 bg-teal-500/8 dark:bg-teal-500/10 text-teal-700 dark:text-teal-300"
          : tone === "rose"
            ? "border-rose-500/25 bg-rose-500/8 dark:bg-rose-500/10 text-rose-700 dark:text-rose-300"
            : "border-zinc-300/80 bg-white/80 dark:border-zinc-700 dark:bg-zinc-900/50 text-zinc-500 dark:text-zinc-400";
  const valueClass =
    tone === "green"
      ? "text-emerald-900 dark:text-emerald-100"
      : tone === "amber"
        ? "text-amber-900 dark:text-amber-100"
        : tone === "teal"
          ? "text-teal-900 dark:text-teal-100"
          : tone === "rose"
            ? "text-rose-900 dark:text-rose-100"
            : "text-zinc-900 dark:text-zinc-100";
  const subClass =
    tone === "green"
      ? "text-emerald-700/80 dark:text-emerald-300/80"
      : tone === "amber"
        ? "text-amber-700/80 dark:text-amber-300/80"
        : tone === "teal"
          ? "text-teal-700/80 dark:text-teal-300/80"
          : tone === "rose"
            ? "text-rose-700/80 dark:text-rose-300/80"
            : "text-zinc-500 dark:text-zinc-400";

  return (
    <div className={cn("rounded-lg border px-2.5 py-2", toneClass)}>
      <p className="text-[10px] font-bold uppercase tracking-[0.12em]">{label}</p>
      <p className={cn("mt-1 text-xl font-bold tabular-nums", valueClass)}>{value ?? 0}</p>
      <p className={cn("text-[10px]", subClass)}>{subLabel}</p>
    </div>
  );
}

function PersonnelMetricSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">{title}</p>
      <div className="mt-2 grid grid-cols-3 gap-2">{children}</div>
    </div>
  );
}

export function ContributorPersonalKpiCard({
  row,
}: {
  row: PersonnelCombinedMetricCard;
}) {
  const averageEfficiency = combinedPersonnelEfficiency(row);
  const efficiencyBracket =
    averageEfficiency != null ? personnelEfficiencyBracket(averageEfficiency) : null;
  const requests = mergePersonnelRequestMetrics(row);

  return (
    <article className="rounded-xl border border-zinc-200 bg-gradient-to-br from-white to-zinc-50/90 p-3.5 dark:border-zinc-800 dark:from-zinc-900/80 dark:to-zinc-950/60">
      <div className="min-w-0">
        <p
          title={row.name}
          className="line-clamp-2 break-words text-sm font-bold leading-snug text-zinc-900 dark:text-zinc-100"
        >
          {row.name}
        </p>
        <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">
          {row.role}
        </p>
      </div>
      {averageEfficiency != null && efficiencyBracket ? (
        <div className="mt-2.5 flex items-center justify-center gap-2.5 rounded-lg border border-zinc-200/80 bg-zinc-50/80 px-3 py-1.5 dark:border-zinc-700/60 dark:bg-zinc-900/40">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">
            Avg efficiency
          </p>
          <p
            className={cn(
              "text-lg font-black tabular-nums leading-none",
              efficiencyBracket.valueClassName,
            )}
          >
            {averageEfficiency}%
          </p>
          <p
            className={cn(
              "inline-block rounded-md border px-2 py-0.5 text-[10px] font-bold tracking-wide",
              efficiencyBracket.badgeClassName,
            )}
          >
            [{efficiencyBracket.label}]
          </p>
        </div>
      ) : null}

      <div className="mt-3 space-y-3">
        {requests ? (
          <PersonnelMetricSection title="Requests">
            <PersonnelMetricStatBox
              label="Closed"
              value={requests.closed}
              subLabel="requests closed"
              tone="green"
            />
            <PersonnelMetricStatBox
              label="Pending"
              value={requests.pending}
              subLabel="open & in progress"
              tone="neutral"
            />
            <PersonnelMetricStatBox
              label="Efficiency"
              value={`${requests.efficiency}%`}
              subLabel="completion rate"
              tone="teal"
            />
          </PersonnelMetricSection>
        ) : null}

        {requests && row.tasks ? (
          <div className="border-t border-zinc-200/80 dark:border-zinc-700/80" />
        ) : null}

        {row.tasks ? (
          <>
            <PersonnelMetricSection title="Tasks">
              <PersonnelMetricStatBox
                label="Done"
                value={row.tasks.closed}
                subLabel="tasks done"
                tone="green"
              />
              <PersonnelMetricStatBox
                label="Missed"
                value={row.tasks.pending}
                subLabel="tasks missed"
                tone="neutral"
              />
              <PersonnelMetricStatBox
                label="Efficiency"
                value={`${row.tasks.efficiency}%`}
                subLabel={
                  row.tasks.penaltyDeduction != null && row.tasks.penaltyDeduction > 0
                    ? "net after penalties"
                    : "done / assigned"
                }
                tone="teal"
              />
            </PersonnelMetricSection>
            {row.tasks.penaltyDeduction != null && row.tasks.penaltyDeduction > 0 ? (
              <p className="text-[11px] text-rose-700 dark:text-rose-300">
                {row.tasks.efficiencyBeforePenalty != null &&
                row.tasks.efficiencyBeforePenalty !== row.tasks.efficiency
                  ? `${row.tasks.efficiencyBeforePenalty}% before deductions · `
                  : null}
                {row.tasks.penaltyDeduction} penalty point
                {row.tasks.penaltyDeduction === 1 ? "" : "s"} from delayed work (minimum efficiency 50%).
              </p>
            ) : null}
          </>
        ) : null}
      </div>

      {row.tasks && row.tasks.pillarsContributed > 0 ? (
        <p className="mt-3 border-t border-zinc-200/80 pt-2 text-[11px] text-zinc-600 dark:border-zinc-700/80 dark:text-zinc-400">
          Contributing across {row.tasks.pillarsContributed} task pillar
          {row.tasks.pillarsContributed === 1 ? "" : "s"}
        </p>
      ) : null}
    </article>
  );
}


/** Average of each listed task's Total data recorded % (extended donut summary). */
function averageIncludedTasksTotalDataRecorded(
  tasks: readonly TaskChecklistIncludedTask[],
): number | null {
  const values: number[] = [];
  for (const task of tasks) {
    const pct =
      task.totalDataRecordedPercent ??
      task.recordedPercent ??
      (task.total > 0 ? task.percent : null);
    if (pct != null && Number.isFinite(pct)) values.push(pct);
  }
  if (values.length === 0) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

const IT_SALF_CSV_COLUMNS = ["DATE", "", "ALI", "ACI", "MCHISI", "AWIC", "EASYGAS", "EFF %"];

function monthTokenFromLabel(label: string): string {
  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const compactMonths = label
    .split(/[^A-Za-z]+/)
    .filter((part) => months.some((month) => month.toLowerCase().startsWith(part.toLowerCase())))
    .map((part) => {
      const month = months.find((m) => m.toLowerCase().startsWith(part.toLowerCase()));
      return month ? month.toUpperCase() : "";
    })
    .filter(Boolean);
  const unique = [...new Set(compactMonths)];
  if (unique.length === 0) return "";
  if (unique.length === 1) return unique[0]!;
  return `${unique[0]}-${unique[unique.length - 1]}`;
}

function csvDateLabelForCadence(cadence: TaskMetricsCadence, label: string): string {
  if (cadence === "MONTHLY") return `Monthly: ${label}`;
  if (cadence === "YEARLY") return `Yearly: ${label}`;
  return label;
}

function csvLayoutRowsForPillar(args: {
  pillar: string;
  metricsCadence: TaskMetricsCadence;
  reportingPeriodLabel?: string;
  helpdeskTickets: TaskMetricsHelpdeskTickets | null;
  userSupportTickets: TaskMetricsUserSupportTickets | null;
  checklistPillars: TaskChecklistPillarMetrics | null;
}): string[][] {
  const { pillar, metricsCadence, reportingPeriodLabel, helpdeskTickets, userSupportTickets, checklistPillars } = args;
  const label = reportingPeriodLabel ?? "Current report";
  const dateLabel = csvDateLabelForCadence(metricsCadence, label);
  const month = monthTokenFromLabel(label) || metricsCadence;
  if (pillar === "HELPDESK SUPPORT") {
    const closed = helpdeskTickets?.closedCount ?? 0;
    const open = helpdeskTickets?.openTicketsInPeriod ?? 0;
    const percent = helpdeskTickets?.percent == null ? "0%" : `${helpdeskTickets.percent}%`;
    return [
      [dateLabel, month, String(closed), String(open), String(helpdeskTickets?.requestsInRange ?? 0), String(helpdeskTickets?.openBacklog ?? 0), String(closed + open), percent],
    ];
  }
  if (pillar === "USER SUPPORT") {
    const average = userSupportTickets?.averageRating;
    const rated = userSupportTickets?.ratedTickets ?? 0;
    const total = userSupportTickets?.totalTickets ?? 0;
    return [
      [
        dateLabel,
        month,
        average == null ? "" : average.toFixed(2),
        String(rated),
        String(total),
        String(userSupportTickets?.unratedTickets ?? 0),
        "",
        average == null ? "No ratings" : `${average.toFixed(2)}/5`,
      ],
    ];
  }
  const agg = checklistPillars?.[pillar];
  if (pillar === "MONITORING") {
    const done = agg?.done ?? 0;
    const notStarted = agg?.missing ?? 0;
    const percent = (agg?.total ?? 0) > 0 ? `${agg?.percent ?? 0}%` : "0%";
    return [[String(done), "0", String(notStarted), percent]];
  }
  const cfg = checklistConfigForPillar(pillar);
  const invert = cfg.invertChecklist === true || isInvertedChecklistPillar(pillar);
  const view = kpiChecklistMetricView(
    {
      total: agg?.total ?? 0,
      done: agg?.done ?? 0,
      missing: agg?.missing ?? 0,
      percent: agg?.percent ?? 0,
    },
    invert,
  );
  const total = agg?.total ?? 0;
  const positive = view.positive;
  const negative = view.negative;
  const percent = total > 0 ? `${view.percent}%` : "0%";
  return [
    [
      dateLabel,
      month,
      positive > 0 ? "TRUE" : "FALSE",
      positive > 1 ? "TRUE" : "FALSE",
      positive > 2 ? "TRUE" : "FALSE",
      negative > 0 ? "FALSE" : positive > 3 ? "TRUE" : "",
      positive > 4 ? "TRUE" : "",
      percent,
    ],
  ];
}

function sourceDetailsForPillar(args: {
  pillar: string;
  metricsCadence: TaskMetricsCadence;
  reportingPeriodLabel?: string;
  helpdeskTickets: TaskMetricsHelpdeskTickets | null;
  userSupportTickets: TaskMetricsUserSupportTickets | null;
  checklistPillars: TaskChecklistPillarMetrics | null;
}): {
  title: string;
  rows: Array<{ label: string; value: string }>;
  tableColumns: string[];
  tableRows: string[][];
  csvColumns: string[];
  csvRows: string[][];
  showCsvPreview: boolean;
  notes: string[];
  includedTasks: TaskChecklistIncludedTask[];
  recordedRange: { fromYm: string; toYm: string } | null;
  /** Same headline percent shown on the Task Metrics donut for this pillar. */
  donutPercent: number | null;
} {
  const { pillar, metricsCadence, reportingPeriodLabel, helpdeskTickets, userSupportTickets, checklistPillars } = args;
  if (pillar === "HELPDESK SUPPORT") {
    const total = (helpdeskTickets?.closedCount ?? 0) + (helpdeskTickets?.openTicketsInPeriod ?? 0);
    return {
      title: "Request Support Source",
      donutPercent: helpdeskTickets?.percent ?? null,
      rows: [
        { label: "Collected from", value: "Request records plus imported helpdesk CSV snapshots when available" },
        { label: "Recorded as", value: "Closed vs open request counts for the selected working-day range" },
        { label: "Range", value: reportingPeriodLabel ?? `${helpdeskTickets?.rangeFromYmd ?? "n/a"} to ${helpdeskTickets?.rangeToYmd ?? "n/a"}` },
        { label: "Closed", value: String(helpdeskTickets?.closedCount ?? 0) },
        { label: "Open", value: String(helpdeskTickets?.openTicketsInPeriod ?? 0) },
      ],
      tableColumns: ["Metric", "Value", "How it is used"],
      tableRows: [
        ["Closed requests", String(helpdeskTickets?.closedCount ?? 0), "Numerator for request support percent"],
        ["Open requests in period", String(helpdeskTickets?.openTicketsInPeriod ?? 0), "Open workload counted in denominator"],
        ["Closed + open total", String(total), "Denominator for the headline percent"],
        ["Requests in range", String(helpdeskTickets?.requestsInRange ?? 0), "Request volume context for the same range"],
        ["Active requests", String(helpdeskTickets?.openBacklog ?? 0), "Current non-closed backlog for the selected scope"],
        ["Headline percent", helpdeskTickets?.percent == null ? "n/a" : `${helpdeskTickets.percent}%`, "closed / (closed + open)"],
      ],
      csvColumns: IT_SALF_CSV_COLUMNS,
      csvRows: csvLayoutRowsForPillar(args),
      showCsvPreview: false,
      notes: ["The headline percent is closed / (closed + open) for the selected cadence."],
      includedTasks: [],
      recordedRange: null,
    };
  }
  if (pillar === "USER SUPPORT") {
    const average = userSupportTickets?.averageRating;
    const rated = userSupportTickets?.ratedTickets ?? 0;
    const total = userSupportTickets?.totalTickets ?? 0;
    return {
      title: "User Support Source",
      donutPercent:
        average == null ? null : Math.round((average / 5) * 100),
      rows: [
        { label: "Collected from", value: "Request star ratings submitted for requests in the selected reporting period" },
        { label: "Recorded as", value: "Average CSAT star rating across rated requests" },
        { label: "Average rating", value: average == null ? "No ratings yet" : `${average.toFixed(2)} / 5` },
        { label: "Rated requests", value: String(rated) },
        { label: "Total requests", value: String(total) },
      ],
      tableColumns: ["Rating", "Count", "Recorded meaning"],
      tableRows: [
        ...(userSupportTickets?.starCounts ?? []).map((row) => [
          `${row.star} star${row.star === 1 ? "" : "s"}`,
          String(row.count),
          row.label,
        ]),
        ["Rated requests", String(rated), "Requests with submitted star ratings"],
        ["Unrated requests", String(userSupportTickets?.unratedTickets ?? 0), "Requests in the selected period without a rating"],
      ],
      csvColumns: IT_SALF_CSV_COLUMNS,
      csvRows: csvLayoutRowsForPillar(args),
      showCsvPreview: false,
      notes: ["This pillar reflects customer star ratings instead of request confirmation statuses."],
      includedTasks: [],
      recordedRange: null,
    };
  }
  const agg = checklistPillars?.[pillar];
  const cfg = checklistConfigForPillar(pillar);
  const cadenceLabel = metricsCadence.toLowerCase();
  const invert = cfg.invertChecklist === true || isInvertedChecklistPillar(pillar);
  const view = kpiChecklistMetricView(
    {
      total: agg?.total ?? 0,
      done: agg?.done ?? 0,
      missing: agg?.missing ?? 0,
      percent: agg?.percent ?? 0,
    },
    invert,
  );
  return {
    title: `${pillarDisplayName(pillar)} Source`,
    donutPercent: (agg?.total ?? 0) > 0 ? view.percent : null,
    rows: [
      {
        label: "Collected from",
        value: "Task Board KPI checklist rows under this pillar",
      },
      { label: "Recorded as", value: "KPI maintenance period snapshots, with the current active period read live" },
      { label: "Cadence", value: metricsCadence },
      { label: "Mapped KPI rows", value: `Recurring ${cadenceLabel} KPI rows titled "${pillar}"` },
      { label: "Counted periods", value: `${agg?.periodsCounted ?? 0} of ${agg?.periodsInRange ?? 0}` },
      { label: cfg?.positiveLabel ?? "Done", value: String(view.positive) },
      { label: cfg?.negativeLabel ?? "Missing", value: String(view.negative) },
    ],
    tableColumns: ["Gathered field", "Value", "Recorded source"],
    tableRows: [
      ["Task rows counted", String(agg?.total ?? 0), `KPI checklist items for ${pillar}`],
      [
        invert ? "Unchecked / safe rows" : "Checked / done rows",
        String(invert ? view.positive : agg?.done ?? 0),
        invert ? "Task Board rows left unchecked (safe)" : "Task Board checkbox completions",
      ],
      [
        invert ? "Checked / breached rows" : "Unchecked / missing rows",
        String(invert ? view.negative : agg?.missing ?? 0),
        invert ? "Task Board rows checked (breach/downtime)" : "Task Board rows not checked in the counted period",
      ],
      ["Positive bucket", String(view.positive), `${cfg?.positiveLabel ?? "Positive"} display bucket`],
      ["Negative bucket", String(view.negative), `${cfg?.negativeLabel ?? "Negative"} display bucket`],
      ["Stored checklist percent", `${agg?.percent ?? 0}%`, "Raw done / total snapshot percent"],
      ["Displayed metric percent", `${view.percent}%`, invert ? "Inverted display percent" : "Checklist display percent"],
      ["Periods with data", String(agg?.periodsCounted ?? 0), "Periods where task data or snapshots were available"],
      ["Periods in range", String(agg?.periodsInRange ?? 0), "All expected periods for the selected cadence/range"],
      ["Cadence", metricsCadence, `Recurring ${cadenceLabel} KPI rows selected for this pillar`],
    ],
    csvColumns: [],
    csvRows: [],
    showCsvPreview: false,
    notes: [
      "Checkboxes on the Task Board are the source of completion data.",
      "Past periods come from immutable snapshots; the active period uses live Task Board checkbox state.",
    ],
    includedTasks: agg?.includedTasks ?? [],
    recordedRange: agg?.recordedRange ?? null,
  };
}



export function TaskPillarMetricsGrid({
  checklistPillars,
  metricsCadence,
  reportingPeriodLabel,
  helpdeskTickets,
  userSupportTickets,
  includeChecklistPillars = true,
  includeTicketPillars = true,
  preferPillarOrder = null,
  showEmptyPillars = false,
  canExtendView = false,
  reportingTimeZone,
  companyId,
  taskType,
}: {
  /** Checklist pillar metrics from snapshots (range-aware averages). */
  checklistPillars: TaskChecklistPillarMetrics | null;
  metricsCadence: TaskMetricsCadence;
  reportingPeriodLabel?: string;
  helpdeskTickets: TaskMetricsHelpdeskTickets | null;
  userSupportTickets: TaskMetricsUserSupportTickets | null;
  /** IANA timezone used to scope the ChartView history refetch. */
  reportingTimeZone?: string;
  /** Company scope for the ChartView history refetch. */
  companyId?: string;
  /** Task-type scope for the ChartView history refetch. */
  taskType?: TaskMetricsTaskType;
  includeChecklistPillars?: boolean;
  /** When false, hide Helpdesk / User Support ticket donuts (task-type filter). */
  includeTicketPillars?: boolean;
  /** Optional fixed donut order (e.g. Task frequency buckets). */
  preferPillarOrder?: string[] | null;
  /** When true, still render preferred-order donuts with zero totals. */
  showEmptyPillars?: boolean;
  /** SuperAdmin / Admin: allow inspecting the Task Board rows inside a donut. */
  canExtendView?: boolean;
}) {
  const [inspectedPillar, setInspectedPillar] = useState<string | null>(null);
  const [detailView, setDetailView] = useState<"extended" | "chart">("extended");
  const inspected = inspectedPillar
    ? sourceDetailsForPillar({
        pillar: inspectedPillar,
        metricsCadence,
        reportingPeriodLabel,
        helpdeskTickets,
        userSupportTickets,
        checklistPillars,
      })
    : null;
  const canShowExtendedTasks =
    canExtendView && (inspected?.includedTasks.length ?? 0) > 0;
  const totalDonutDataPercent = inspected
    ? averageIncludedTasksTotalDataRecorded(inspected.includedTasks)
    : null;
  const inspectedInvert = inspectedPillar
    ? checklistConfigForPillar(inspectedPillar).invertChecklist === true ||
      isInvertedChecklistPillar(inspectedPillar)
    : false;

  /** ChartView: server-fetched tasks for the range picked in the date-range finder. */
  const [chartOverride, setChartOverride] = useState<TaskChecklistIncludedTask[] | null>(null);
  const [chartLoading, setChartLoading] = useState(false);
  const [chartError, setChartError] = useState<string | null>(null);
  const chartRequestId = useRef(0);

  // Drop a fetched range whenever the inspected donut changes or the modal closes,
  // and invalidate any in-flight refetch from a previous pillar/range.
  useEffect(() => {
    chartRequestId.current += 1;
    const id = window.setTimeout(() => {
      setChartOverride(null);
      setChartLoading(false);
      setChartError(null);
    }, 0);
    return () => window.clearTimeout(id);
  }, [inspectedPillar]);

  const loadChartRange = useCallback(
    async (from: string, to: string) => {
      if (!inspectedPillar) return;
      const requestId = ++chartRequestId.current;
      setChartLoading(true);
      setChartError(null);
      try {
        const qs = new URLSearchParams({ from, to, helpdeskCadence: metricsCadence });
        if (reportingTimeZone) qs.set("tz", reportingTimeZone);
        if (companyId) qs.set("companyId", companyId);
        if (taskType) qs.set("taskType", taskType);
        const res = await fetch(`/api/kpis/task-metrics?${qs.toString()}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        const json = (await res.json()) as { taskChecklistPillars?: TaskChecklistPillarMetrics };
        const tasks = json.taskChecklistPillars?.[inspectedPillar]?.includedTasks ?? [];
        if (requestId === chartRequestId.current) {
          setChartOverride(tasks);
        }
      } catch {
        if (requestId === chartRequestId.current) {
          setChartError("Could not load chart data for the selected range.");
        }
      } finally {
        if (requestId === chartRequestId.current) {
          setChartLoading(false);
        }
      }
    },
    [inspectedPillar, metricsCadence, reportingTimeZone, companyId, taskType],
  );

  const handleChartRangeChange = useCallback(
    (range: { from: string; to: string } | null) => {
      if (!range) {
        // Invalidate any in-flight refetch so a stale response cannot repopulate
        // the chart after the user clears the range.
        chartRequestId.current += 1;
        setChartOverride(null);
        setChartLoading(false);
        setChartError(null);
        return;
      }
      void loadChartRange(range.from, range.to);
    },
    [loadChartRange],
  );

  const mainTaskPillars = Object.keys(checklistPillars ?? {})
    .filter((p) => p !== "HELPDESK SUPPORT" && p !== "USER SUPPORT")
    .sort((a, b) => a.localeCompare(b));
  const orderedMain =
    preferPillarOrder && preferPillarOrder.length > 0
      ? // Task Type view: only the new buckets — never append legacy IT pillars.
        [...preferPillarOrder]
      : mainTaskPillars;
  const pillars: string[] = includeTicketPillars
    ? ["HELPDESK SUPPORT", "USER SUPPORT", ...orderedMain]
    : orderedMain;

  return (
    <div className="space-y-3">
      <div
        className={cn(
          "grid gap-4",
          "sm:grid-cols-2",
          "xl:grid-cols-4",
        )}
      >
      {pillars.map((pillar) => {
        if (pillar === "HELPDESK SUPPORT") {
          const ht = helpdeskTickets;
          const segments = ht ? helpdeskRatioSegments(ht) : [];
          const headline =
            ht?.percent != null
              ? `${Number.isInteger(ht.percent) ? ht.percent : ht.percent.toFixed(1)}%`
              : "—";
          return (
            <PillarDonutCard
              key={pillar}
              pillar={pillar}
              segments={segments}
              headline={headline}
              onInspect={() => {
                setInspectedPillar(pillar);
                setDetailView("extended");
              }}
            />
          );
        }

        if (pillar === "USER SUPPORT") {
          const us = userSupportTickets;
          const segments = us ? userSupportSegments(us) : [];
          const headline =
            us?.averageRating == null ? "—" : `${us.averageRating.toFixed(2)}/5 avg rating`;
          return (
            <PillarDonutCard
              key={pillar}
              pillar={pillar}
              segments={segments}
              headline={headline}
              onInspect={() => {
                setInspectedPillar(pillar);
                setDetailView("extended");
              }}
            />
          );
        }

        if (!includeChecklistPillars) {
          return null;
        }

        const cfg = checklistConfigForPillar(pillar);
        const agg = checklistPillars?.[pillar] ?? {
          total: 0,
          done: 0,
          missing: 0,
          percent: 0,
          periodsCounted: 0,
          periodsInRange: 0,
        };
        if (agg.total <= 0 && !showEmptyPillars) {
          return null;
        }
        const invert =
          cfg.invertChecklist === true || isInvertedChecklistPillar(pillar);
        const view = kpiChecklistMetricView(agg, invert);
        const segments = checklistProgressSegments(view, cfg.positiveLabel, cfg.negativeLabel, {
          hideZeroNegative: invert,
        });
        const headline =
          agg.total === 0
            ? "—"
            : `${view.percent}% ${cfg.metricName}`;
        const subLabel =
          cfg.metricName === "on time"
            ? `${view.positive} on time · ${view.negative} delayed · ${agg.total} sub-tasks`
              : undefined;
        return (
          <PillarDonutCard
            key={pillar}
            pillar={pillar}
            segments={segments}
            headline={headline}
            subLabel={subLabel}
            onInspect={() => {
              setInspectedPillar(pillar);
              setDetailView("extended");
            }}
          />
        );
      })}
      </div>
      {inspected && typeof document !== "undefined"
        ? createPortal(
            <div
              className="fixed inset-0 z-[300] flex items-center justify-center bg-black/45 px-4 py-4"
              role="dialog"
              aria-modal="true"
              data-metrics-inspect=""
              onClick={() => setInspectedPillar(null)}
            >
              <div
                className={cn(
                  "flex max-h-[calc(100dvh-2rem)] w-full flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-950",
                  detailView === "chart"
                    ? "max-w-6xl"
                    : canShowExtendedTasks
                      ? "max-w-3xl"
                      : "max-w-lg",
                )}
                onClick={(e) => e.stopPropagation()}
              >
            <div className="shrink-0 border-b border-zinc-200 p-5 pb-4 dark:border-zinc-800">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-orange-600 dark:text-orange-300">
                  Tasks in this donut
                </p>
                <h3 className="mt-1 text-lg font-bold text-zinc-950 dark:text-zinc-50">{inspected.title}</h3>
              </div>
              <div className="flex shrink-0 flex-wrap justify-end gap-2">
                {canShowExtendedTasks ? (
                  <div className="inline-flex items-center rounded-full border border-zinc-200 bg-zinc-100/80 p-0.5 dark:border-zinc-700 dark:bg-zinc-900/60">
                <button
                  type="button"
                      onClick={() => setDetailView("extended")}
                  className={cn(
                        "rounded-full px-3 py-1 text-xs font-semibold transition",
                        detailView === "extended"
                          ? "bg-orange-600 text-white shadow-sm"
                          : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100",
                      )}
                    >
                      Extended view
                </button>
                    <button
                      type="button"
                      onClick={() => setDetailView("chart")}
                      className={cn(
                        "rounded-full px-3 py-1 text-xs font-semibold transition",
                        detailView === "chart"
                          ? "bg-orange-600 text-white shadow-sm"
                          : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100",
                      )}
                    >
                      Chart view
                    </button>
                  </div>
                ) : null}
                <button
                  type="button"
                  onClick={() => setInspectedPillar(null)}
                  className="rounded-full border border-zinc-300 px-3 py-1 text-xs font-semibold text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  Close
                </button>
              </div>
            </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
            {!canShowExtendedTasks ? (
              <p className="mt-4 rounded-xl bg-zinc-100 p-3 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
                No live Task Board rows are mapped to this donut within the selected reporting period.
              </p>
            ) : detailView === "chart" ? (
              <TaskEfficiencyMonitorChart
                key={inspectedPillar}
                tasks={chartOverride ?? inspected.includedTasks}
                invert={inspectedInvert}
                loading={chartLoading}
                error={chartError}
                recordedRange={inspected.recordedRange}
                onRangeChange={handleChartRangeChange}
              />
            ) : (
              <div className="mt-4 space-y-3">
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Live Task Board rows currently mapped into this donut ({inspected.includedTasks.length}{" "}
                  {inspected.includedTasks.some((t) => (t.phases?.length ?? 0) > 0) ? "project" : "task"}
                  {inspected.includedTasks.length === 1 ? "" : "s"}).
                </p>
                {totalDonutDataPercent != null ? (
                  <div className="rounded-xl border border-orange-400/30 bg-orange-500/5 px-3 py-2 dark:border-orange-500/20">
                    <p className="text-xs font-semibold text-orange-800 dark:text-orange-200">
                      Total Donut Data · {totalDonutDataPercent}%
                    </p>
                    <p className="mt-0.5 text-[11px] text-zinc-600 dark:text-zinc-400">
                      Average of Total data recorded across the tasks listed below
                      {reportingPeriodLabel ? ` · ${reportingPeriodLabel}` : ""}.
                    </p>
                  </div>
                ) : null}
                <ul className="space-y-3">
                  {inspected.includedTasks.map((task) => {
                    const showPhases = (task.phases?.length ?? 0) > 0;
                    return (
                      <li
                        key={task.id}
                        className="rounded-xl border border-zinc-200 bg-zinc-50/80 p-3 dark:border-zinc-800 dark:bg-zinc-900/50"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-semibold text-zinc-950 dark:text-zinc-50">{task.title}</p>
                            {task.assigneeName || task.frequency ? (
                              <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                                {[task.frequency, task.assigneeName].filter(Boolean).join(" · ")}
                              </p>
                            ) : null}
                </div>
                          <div className="shrink-0 text-right text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                            <p>
                              {showPhases
                                ? `${task.done}/${task.total} complete`
                                : `${task.done}/${task.total} done`}
                            </p>
                            <p className="mt-0.5 text-[11px] font-medium text-orange-700 dark:text-orange-300">
                              Recorded data{" "}
                              {task.recordedPercent != null ? task.recordedPercent : task.percent}%
                            </p>
                            {task.totalDataRecordedPercent != null ? (
                              <p className="mt-0.5 text-[11px] font-medium text-sky-700 dark:text-sky-300">
                                Total data recorded {task.totalDataRecordedPercent}%
                              </p>
                            ) : null}
                    </div>
                        </div>
                        {showPhases ? (
                          <ul className="mt-2 space-y-1.5 border-t border-zinc-200 pt-2 dark:border-zinc-800">
                            {task.phases!.map((phase) => (
                              <li
                                key={`${task.id}:${phase.id}`}
                                className="flex items-center justify-between gap-2 text-xs text-zinc-700 dark:text-zinc-300"
                              >
                                <span className="min-w-0 truncate font-medium">{phase.name}</span>
                                <span className="shrink-0 text-zinc-500 dark:text-zinc-400">
                                  {phase.done}/{phase.total} · {phase.percent}%
                                </span>
                              </li>
                            ))}
                          </ul>
                        ) : task.items.length > 0 ? (
                          <ul className="mt-2 space-y-1 border-t border-zinc-200 pt-2 dark:border-zinc-800">
                            {task.items.map((item) => (
                              <li
                                key={`${task.id}:${item.id}`}
                                className="flex items-center gap-2 text-xs text-zinc-700 dark:text-zinc-300"
                              >
                                <span
                                  className={cn(
                                    "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-[10px] font-bold",
                                    item.done
                                      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                                      : "bg-zinc-200/80 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
                                  )}
                                  aria-hidden
                                >
                                  {item.done ? "✓" : "○"}
                                </span>
                                <span
                                  className={cn(
                                    "min-w-0 flex-1 truncate",
                                    item.done ? "line-through opacity-70" : undefined,
                                  )}
                                >
                                  {item.title}
                                  {item.assigneeName ? (
                                    <span className="font-normal text-zinc-500 dark:text-zinc-400">
                                      {" "}
                                      · {item.assigneeName}
                                    </span>
                ) : null}
                                </span>
                                {item.recordedPercent != null ? (
                                  <span className="shrink-0 text-[11px] font-medium text-orange-700 dark:text-orange-300">
                                    {item.recordedPercent}%
                                  </span>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                ) : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            </div>
          </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
