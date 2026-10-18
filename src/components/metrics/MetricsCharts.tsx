"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { KINETIC_PALETTE, ticketStatusChartColor, TICKET_STATUS_CHART_COLORS } from "@/lib/kinetic-palette";
import { formatTicketStatusLabel } from "@/modules/requests/ticket-status-label";

const ORANGE = KINETIC_PALETTE.brand;
const ZINC_LINE = KINETIC_PALETTE.mutedSubtle;
const GRID_LIGHT = KINETIC_PALETTE.gridLight;
const GRID_DARK = KINETIC_PALETTE.gridDark;

function formatStatus(status: string) {
  return formatTicketStatusLabel(status);
}

/** Stable colors per request status — shared by pie, strip, and legends. */
export { TICKET_STATUS_CHART_COLORS };

const TICKET_STATUS_SORT_ORDER = [
  "IN_PROGRESS",
  "OPEN",
  "PENDING_INFO",
  "ESCALATED",
  "FOR_CONFIRMATION",
  "RESOLVED",
  "CLOSED",
] as const;

export function colorForTicketStatus(status: string) {
  return ticketStatusChartColor(status);
}

export function queueSegmentsForCharts(raw: { status: string; count: number }[]) {
  const byStatus = new Map(raw.map((r) => [r.status, r.count]));
  const ordered: { status: string; count: number }[] = TICKET_STATUS_SORT_ORDER.map((status) => ({
    status,
    count: byStatus.get(status) ?? 0,
  })).filter((s) => s.count > 0);
  const known = new Set<string>(TICKET_STATUS_SORT_ORDER);
  for (const row of raw) {
    if (!known.has(row.status) && row.count > 0) {
      ordered.push({ status: row.status, count: row.count });
    }
  }
  return ordered.sort((a, b) => b.count - a.count);
}

/**
 * Daily x-axis tick density — cap label count so mobile never overcrowds.
 */
function pickDailyTickIndices(n: number, maxTicks = 12): number[] {
  if (n <= 1) return [0];
  if (n <= maxTicks) return Array.from({ length: n }, (_, i) => i);
  const step = Math.max(1, Math.ceil((n - 1) / (maxTicks - 1)));
  const idx = new Set<number>();
  for (let i = 0; i < n; i += step) idx.add(i);
  idx.add(n - 1);
  return [...idx].sort((a, b) => a - b);
}

/** Format a YYYY-MM-DD label as compact MM-DD for x-axis chips. */
function shortDayLabel(label: string): string {
  return label?.length >= 10 ? label.slice(5) : label ?? "—";
}

/** Created and closed requests per day (Asia/Manila buckets) — density plot. */
export function MetricsTrendChart({
  labels,
  created,
  closed,
  variant = "density",
}: {
  labels: string[];
  created: number[];
  closed: number[];
  variant?: "density" | "line";
}) {
  const [maxTicks, setMaxTicks] = useState(12);
  useEffect(() => {
    function update() {
      setMaxTicks(window.innerWidth < 640 ? 5 : window.innerWidth < 1024 ? 8 : 12);
    }
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const n = Math.min(labels.length, created.length, closed.length);
  if (n === 0) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50 py-14 text-center text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950/40 dark:text-zinc-500">
        Expand the reporting window or add request activity to plot trends.
      </div>
    );
  }
  const safeLabels = labels.slice(0, n);
  const safeCreated = created.slice(0, n);
  const safeClosed = closed.slice(0, n);

  const padX = 4;
  const padTop = 6;
  const padBottom = 6;
  const w = 100;
  const h = 48;
  const innerH = h - padTop - padBottom;
  const peak = Math.max(1, ...safeCreated, ...safeClosed);
  const max = Math.max(1, peak);

  const xAt = (i: number) =>
    n <= 1 ? w / 2 : padX + ((w - 2 * padX) * i) / Math.max(n - 1, 1);
  const yAt = (v: number) => padTop + innerH - (innerH * v) / max;
  const straightLinePath = (values: number[]) =>
    values.map((v, i) => `${i === 0 ? "M" : "L"} ${xAt(i)} ${yAt(v)}`).join(" ");

  const smoothLinePath = (values: number[]) => {
    const pts = values.map((v, i) => ({ x: xAt(i), y: yAt(v) }));
    if (pts.length === 1) return `M ${pts[0]!.x} ${pts[0]!.y}`;
    const [first, ...rest] = pts;
    const commands = [`M ${first!.x} ${first!.y}`];
    for (let i = 0; i < rest.length; i += 1) {
      const current = pts[i]!;
      const next = pts[i + 1]!;
      const midX = (current.x + next.x) / 2;
      const midY = (current.y + next.y) / 2;
      commands.push(`Q ${current.x} ${current.y} ${midX} ${midY}`);
    }
    const last = pts[pts.length - 1]!;
    commands.push(`T ${last.x} ${last.y}`);
    return commands.join(" ");
  };
  const smoothAreaPath = (values: number[]) => {
    const baseY = h - padBottom;
    if (values.length === 1) {
      const x = xAt(0);
      const y = yAt(values[0]!);
      return `M ${x - 0.5} ${baseY} L ${x} ${y} L ${x + 0.5} ${baseY} Z`;
    }
    return `${smoothLinePath(values)} L ${xAt(values.length - 1)} ${baseY} L ${xAt(0)} ${baseY} Z`;
  };
  const createdLinePath = smoothLinePath(safeCreated);
  const closedLinePath = smoothLinePath(safeClosed);
  const createdStraightLinePath = straightLinePath(safeCreated);
  const closedStraightLinePath = straightLinePath(safeClosed);
  const createdAreaPath = smoothAreaPath(safeCreated);
  const closedAreaPath = smoothAreaPath(safeClosed);

  const tickIdx = pickDailyTickIndices(n, maxTicks);
  /** Y-axis reference ticks — divide vertical space into 4 bands with rounded values. */
  const yTickValues = (() => {
    const out: number[] = [];
    for (let i = 0; i <= 4; i += 1) {
      out.push((max * i) / 4);
    }
    return out;
  })();

  return (
    <div className="w-full">
      <div className="relative">
        <svg
          viewBox={`0 0 ${w} ${h}`}
          className="h-44 w-full overflow-visible sm:h-52 md:h-60"
          preserveAspectRatio="none"
          role="img"
          aria-label="Daily volume trend"
        >
          {yTickValues.map((v, idx) => {
            const y = yAt(v);
            return (
              <g key={`grid-${idx}`}>
                <line
                  x1={padX}
                  x2={w - padX}
                  y1={y}
                  y2={y}
                  className="stroke-zinc-200 dark:stroke-zinc-800"
                  strokeWidth={0.18}
                  vectorEffect="non-scaling-stroke"
                  strokeDasharray={idx === 0 ? "0" : "0.6 0.6"}
                  stroke={idx === 0 ? GRID_LIGHT : undefined}
                  style={{ stroke: undefined }}
                />
              </g>
            );
          })}
          {/** Vertical day grid (ticks only at label positions to keep things calm). */}
          {tickIdx.map((i) => (
            <line
              key={`vgrid-${i}`}
              x1={xAt(i)}
              x2={xAt(i)}
              y1={padTop}
              y2={h - padBottom}
              stroke={GRID_DARK}
              strokeOpacity={0.18}
              strokeWidth={0.12}
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {variant === "density" ? (
            <>
              <path d={closedAreaPath} fill={ZINC_LINE} fillOpacity={0.16} />
              <path d={createdAreaPath} fill={ORANGE} fillOpacity={0.2} />
            </>
          ) : null}
          <path
            fill="none"
            stroke={ORANGE}
            strokeWidth={0.95}
            strokeLinecap="round"
            strokeLinejoin="round"
            d={variant === "line" ? createdStraightLinePath : createdLinePath}
            vectorEffect="non-scaling-stroke"
          />
          <path
            fill="none"
            stroke={ZINC_LINE}
            strokeWidth={0.95}
            strokeLinecap="round"
            strokeLinejoin="round"
            d={variant === "line" ? closedStraightLinePath : closedLinePath}
            vectorEffect="non-scaling-stroke"
          />

          {variant === "line" ? (
            <>
              {safeCreated.map((v, i) => (
                <path
                  key={`created-point-${i}`}
                  d={`M ${xAt(i)} ${yAt(v)} h 0.001`}
                  fill="none"
                  stroke={ORANGE}
                  strokeWidth={3.2}
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
              {safeClosed.map((v, i) => (
                <path
                  key={`closed-point-${i}`}
                  d={`M ${xAt(i)} ${yAt(v)} h 0.001`}
                  fill="none"
                  stroke={ZINC_LINE}
                  strokeWidth={3}
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </>
          ) : null}
        </svg>

        {/** Y-axis numeric labels overlay (HTML so they stay legible at any width). */}
        <div className="pointer-events-none absolute inset-y-0 left-0 hidden w-10 sm:block">
          {yTickValues
            .slice()
            .reverse()
            .map((v, idx) => (
              <span
                key={`ylabel-${idx}`}
                className="absolute -translate-y-1/2 text-[10px] font-medium tabular-nums text-zinc-500 dark:text-zinc-500"
                style={{ top: `${(idx / (yTickValues.length - 1)) * 100}%`, left: 0 }}
              >
                {Math.round(v)}
              </span>
            ))}
        </div>
      </div>

      <div className="mt-2 grid w-full grid-cols-[repeat(auto-fit,minmax(2.75rem,1fr))] gap-1 text-[9px] font-medium uppercase tracking-wide text-zinc-600 sm:mt-3 sm:gap-0 sm:text-[10px] sm:tracking-wider dark:text-zinc-500">
        {tickIdx.map((i) => (
          <span
            key={`xlabel-${safeLabels[i] ?? i}`}
            className={cn(
              "truncate text-center sm:whitespace-normal",
              tickIdx.length === 1 ? "text-center" : null,
            )}
            title={safeLabels[i] ?? ""}
          >
            {shortDayLabel(safeLabels[i] ?? "")}
          </span>
        ))}
      </div>

      <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-zinc-600 sm:mt-3 sm:gap-4 sm:text-xs dark:text-zinc-400">
        <span className="inline-flex items-center gap-2">
          <span className="size-2 rounded-sm bg-orange-500" /> Created
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="size-2 rounded-sm bg-zinc-400" /> Closed
        </span>
      </div>
    </div>
  );
}

/** Semi-circular gauge 0–100% for SLA-style metrics. */
export function MetricsGauge({
  label,
  value,
  target,
}: {
  label: string;
  value: number | null;
  target?: number | null;
}) {
  const pct = value == null ? null : Math.max(0, Math.min(1, value));
  const targetPct = target == null ? null : Math.max(0, Math.min(1, target));
  const r = 36;
  const cx = 50;
  const cy = 52;
  /** Half-arc length along the semicircle path */
  const arcLen = Math.PI * r;
  const dash = pct == null ? 0 : pct * arcLen;

  return (
    <div className="flex flex-col items-center text-center">
      <svg viewBox="0 0 100 60" className="h-24 w-full max-w-[140px]" aria-hidden>
        <path
          d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          fill="none"
          className="stroke-zinc-200 dark:stroke-zinc-800"
          strokeWidth="8"
          strokeLinecap="round"
        />
        <path
          d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          fill="none"
          stroke={ORANGE}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${arcLen}`}
          className={cn(pct == null && "opacity-25")}
        />
        {targetPct != null ? (
          <line
            x1={cx + (r - 5) * Math.cos(Math.PI * (1 - targetPct))}
            y1={cy - (r - 5) * Math.sin(Math.PI * (1 - targetPct))}
            x2={cx + (r + 5) * Math.cos(Math.PI * (1 - targetPct))}
            y2={cy - (r + 5) * Math.sin(Math.PI * (1 - targetPct))}
            stroke={KINETIC_PALETTE.brandSoft}
            strokeWidth="2"
            strokeLinecap="round"
          />
        ) : null}
        <text
          x={cx}
          y={cy - 4}
          textAnchor="middle"
          className="fill-zinc-900 text-[14px] font-bold dark:fill-zinc-100"
        >
          {pct == null ? "—" : `${Math.round(pct * 100)}%`}
        </text>
      </svg>
      <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</p>
    </div>
  );
}

/** Pie chart for task / KPI board mix (Current / Done / Delayed). */
export function MetricsPieChart({
  segments,
  title,
  itemsLabel,
  emptyDescription,
  pieClassName,
  showPercentages = false,
  valueFormatter,
  centerLabel,
  donut = false,
}: {
  title: string;
  segments: { label: string; value: number; color: string }[];
  /** Badge text for total count, e.g. `(n) => \`${n} tasks\`` */
  itemsLabel?: (total: number) => string;
  emptyDescription?: string;
  pieClassName?: string;
  showPercentages?: boolean;
  valueFormatter?: (value: number) => string;
  centerLabel?: string;
  donut?: boolean;
}) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  const cx = 50;
  const cy = 50;
  const r = 38;
  const innerR = donut ? 21 : 10;
  let angle = -Math.PI / 2;
  /** Full 100% slice: SVG elliptical arc collapses when start === end; use a circle instead. */
  const slices: { d: string; color: string; label: string; value: number; full?: boolean }[] = [];

  if (total > 0) {
    for (const seg of segments) {
      if (seg.value <= 0) continue;
      const sliceAngle = (seg.value / total) * 2 * Math.PI;
      const isFullDisk = sliceAngle >= 2 * Math.PI - 1e-3;
      if (isFullDisk) {
        slices.push({ d: "", color: seg.color, label: seg.label, value: seg.value, full: true });
        angle += sliceAngle;
        continue;
      }
      const end = angle + sliceAngle;
      const x1 = cx + r * Math.cos(angle);
      const y1 = cy + r * Math.sin(angle);
      const x2 = cx + r * Math.cos(end);
      const y2 = cy + r * Math.sin(end);
      const largeArc = sliceAngle > Math.PI ? 1 : 0;
      const d = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`;
      slices.push({ d, color: seg.color, label: seg.label, value: seg.value, full: false });
      angle = end;
    }
  }

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-600 dark:text-zinc-500">{title}</p>
        </div>
        {total > 0 ? (
          <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs font-semibold tabular-nums text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900/50 dark:text-zinc-200">
            {itemsLabel ? itemsLabel(total) : `${total} KPI${total === 1 ? "" : "s"}`}
          </span>
        ) : null}
      </div>
      {total === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-zinc-300 py-12 text-center text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-500">
          {emptyDescription ?? "No recurring KPIs for this frequency in scope."}
        </p>
      ) : (
        <div className="mt-5 flex min-w-0 flex-col items-center gap-4 xl:flex-row xl:items-start xl:gap-6">
          <svg
            viewBox="0 0 100 100"
            className={cn("mx-auto shrink-0 sm:mx-0", pieClassName ?? "h-48 w-48")}
            aria-hidden
          >
            {slices.map((s, i) =>
              s.full ? (
                <circle
                  key={`${s.label}-${i}-full`}
                  cx={cx}
                  cy={cy}
                  r={r}
                  fill={s.color}
                  stroke={KINETIC_PALETTE.surface}
                  strokeWidth="0.35"
                />
              ) : (
                <path key={`${s.label}-${i}`} d={s.d} fill={s.color} stroke={KINETIC_PALETTE.surface} strokeWidth="0.35" />
              ),
            )}
            <circle cx={cx} cy={cy} r={innerR} className="fill-surface" />
            <text
              x={cx}
              y={cy + 2}
              textAnchor="middle"
              className={cn("fill-foreground font-bold", donut ? "text-[8px]" : "text-[7px]")}
            >
              {centerLabel ?? total}
            </text>
          </svg>
          <ul className="grid w-full min-w-0 gap-2 text-sm">
            {segments.map((seg, index) => (
              <li key={`${seg.label}-${index}`} className="flex items-start justify-between gap-3">
                <span className="flex min-w-0 items-start gap-2 text-muted">
                  <span className="mt-1 size-3 shrink-0 rounded-sm" style={{ backgroundColor: seg.color }} />
                  <span className="min-w-0 break-words leading-snug">{seg.label}</span>
                </span>
                <span className="shrink-0 text-right tabular-nums font-semibold text-foreground">
                  {valueFormatter ? valueFormatter(seg.value) : seg.value}
                  {showPercentages && total > 0
                    ? ` (${Math.round((seg.value / total) * 1000) / 10}%)`
                    : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Horizontal bars — normalized to max row. */
export function MetricsBarChart({
  rows,
  title,
  valueFormatter,
}: {
  title: string;
  rows: { id?: string; label: string; value: number }[];
  valueFormatter?: (value: number, row: { id?: string; label: string; value: number }) => string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-600 dark:text-zinc-500">{title}</p>
      <div className="mt-4 space-y-3">
        {rows.length === 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-500">No data in this range.</p>
        ) : (
          rows.map((row, index) => (
            <div key={row.id ?? `${row.label}-${index}`}>
              <div className="mb-1 flex justify-between text-xs">
                <span className="truncate font-medium text-zinc-800 dark:text-zinc-300">{row.label}</span>
                <span className="tabular-nums text-zinc-600 dark:text-zinc-400">
                  {valueFormatter ? valueFormatter(row.value, row) : row.value}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-orange-700 to-orange-500 transition-[width]"
                  style={{ width: `${(row.value / max) * 100}%` }}
                />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/** Stacked bar for open-queue status mix (colors match pie chart by status). */
export function MetricsQueueStrip({
  segments,
  showLegend = false,
}: {
  segments: { status: string; count: number }[];
  showLegend?: boolean;
}) {
  const ordered = queueSegmentsForCharts(segments);
  const total = ordered.reduce((s, x) => s + x.count, 0);
  if (total === 0) {
    return <p className="text-sm text-muted">No active queue items.</p>;
  }

  return (
    <div>
      <div className="flex h-3 overflow-hidden rounded-full border border-border bg-surface-muted">
        {ordered.map((seg) => (
          <div
            key={seg.status}
            className="min-w-[3px] transition-[width]"
            style={{
              width: `${(seg.count / total) * 100}%`,
              backgroundColor: colorForTicketStatus(seg.status),
            }}
            title={`${formatStatus(seg.status)}: ${seg.count}`}
          />
        ))}
      </div>
      {showLegend ? (
        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {ordered.map((seg) => (
            <li key={seg.status} className="flex items-center justify-between gap-2 text-xs">
              <span className="flex items-center gap-2 text-muted">
                <span
                  className="size-2.5 shrink-0 rounded-sm"
                  style={{ backgroundColor: colorForTicketStatus(seg.status) }}
                />
                {formatStatus(seg.status)}
              </span>
              <span className="tabular-nums font-semibold text-foreground">{seg.count}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
