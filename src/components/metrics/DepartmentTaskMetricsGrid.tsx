"use client";

import {
  Building2,
  ChevronLeft,
  Download,
  Eye,
  EyeOff,
  Layers,
  Upload,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import type { DepartmentMetricRow } from "@/lib/department-task-metrics";
import type {
  TaskChecklistIncludedTask,
  TaskChecklistIncludedTaskSegment,
} from "@/lib/kpi-period-snapshots";
import { KPI_DONUT_COLORS, KINETIC_PALETTE } from "@/lib/kinetic-palette";

type CatalogSection = {
  id: string;
  name: string;
  parentId: string | null;
};

type DepartmentInspectView = "subsections" | "tasks" | "segment";

type DepartmentTaskMetricsGridProps = {
  sections: DepartmentMetricRow[];
  reportingPeriodLabel?: string;
  companyLabel?: string | null;
  loading?: boolean;
  /** SuperAdmin: manage which sections appear in Departments metrics. */
  canManageVisibility?: boolean;
  onVisibilityChanged?: () => void;
  /** Admin+: import Task Board tasks from CSV into departments. */
  canImport?: boolean;
  onImportComplete?: () => void;
};

function segmentsForIncludedTask(task: TaskChecklistIncludedTask): TaskChecklistIncludedTaskSegment[] {
  if (task.segments && task.segments.length > 0) return task.segments;
  if (task.phases && task.phases.length > 0) {
    return task.phases.map((ph) => ({
      id: ph.id,
      name: ph.name,
      total: ph.total,
      done: ph.done,
      percent: ph.percent,
      items: [],
    }));
  }
  return [];
}

function donutSlicePath(
  cx: number,
  cy: number,
  rOut: number,
  rIn: number,
  start: number,
  end: number,
): string {
  const polar = (r: number, a: number) => ({
    x: cx + r * Math.cos(a),
    y: cy + r * Math.sin(a),
  });
  const large = end - start > Math.PI ? 1 : 0;
  const p0 = polar(rOut, start);
  const p1 = polar(rOut, end);
  const p2 = polar(rIn, end);
  const p3 = polar(rIn, start);
  return [
    `M ${p0.x} ${p0.y}`,
    `A ${rOut} ${rOut} 0 ${large} 1 ${p1.x} ${p1.y}`,
    `L ${p2.x} ${p2.y}`,
    `A ${rIn} ${rIn} 0 ${large} 0 ${p3.x} ${p3.y}`,
    "Z",
  ].join(" ");
}

function DepartmentDonutCard({
  row,
  onInspect,
  inspectHint,
  canHide,
  onHide,
}: {
  row: DepartmentMetricRow;
  onInspect?: () => void;
  inspectHint?: string;
  canHide?: boolean;
  onHide?: () => void;
}) {
  const [lastTapMs, setLastTapMs] = useState(0);
  const segments = [
    { key: "done", label: "Done", value: row.done, color: KPI_DONUT_COLORS.positive },
    { key: "missing", label: "Missing", value: row.missing, color: KPI_DONUT_COLORS.negative },
  ];
  const total = segments.reduce((a, s) => a + s.value, 0);
  const cx = 50;
  const cy = 50;
  const rOut = 36;
  const rIn = 24;
  const headline = total > 0 ? `${row.percent}%` : "—";
  let angle = -Math.PI / 2;
  const paths: { d: string; color: string; label: string }[] = [];

  if (total > 0) {
    for (const seg of segments) {
      if (seg.value <= 0) continue;
      const sliceAngle = (seg.value / total) * 2 * Math.PI;
      const isFull = sliceAngle >= 2 * Math.PI - 1e-3;
      if (isFull) {
        paths.push({ d: "__FULL__", color: seg.color, label: seg.label });
        angle += sliceAngle;
        continue;
      }
      const end = angle + sliceAngle;
      paths.push({
        d: donutSlicePath(cx, cy, rOut, rIn, angle, end),
        color: seg.color,
        label: seg.label,
      });
      angle = end;
    }
  }

  const interactive = Boolean(onInspect);
  const taskCount = row.includedTasks?.length ?? 0;

  return (
    <article
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      title={inspectHint}
      onDoubleClick={onInspect}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === "Enter") onInspect?.();
            }
          : undefined
      }
      onTouchEnd={
        interactive
          ? () => {
              const now = Date.now();
              if (now - lastTapMs < 350) onInspect?.();
              setLastTapMs(now);
            }
          : undefined
      }
      className={cn(
        "relative flex flex-col rounded-2xl border border-zinc-200/90 bg-white p-4 shadow-[0_8px_24px_rgba(15,23,42,0.06)] outline-none transition dark:border-zinc-700/80 dark:bg-zinc-900/40 dark:shadow-[0_12px_32px_rgba(0,0,0,0.35)]",
        interactive &&
          "cursor-pointer hover:border-orange-300 focus:ring-2 focus:ring-orange-500/30 dark:hover:border-orange-700/70",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-500">
            {row.name}
          </p>
          <p className="mt-1.5 text-2xl font-bold tabular-nums tracking-tight text-zinc-900 dark:text-zinc-50">
            {headline}
          </p>
          <p className="mt-1 text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">
            {row.done}/{row.total || 0} done · {row.memberCount} member
            {row.memberCount === 1 ? "" : "s"}
            {row.subsections.length > 0 ? ` · ${row.subsections.length} sub` : ""}
            {taskCount > 0 ? ` · ${taskCount} task${taskCount === 1 ? "" : "s"}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-center gap-1.5">
          <span className="flex size-9 items-center justify-center rounded-xl bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
            <Layers className="size-[18px]" strokeWidth={1.75} aria-hidden />
          </span>
          {canHide && onHide ? (
            <button
              type="button"
              title="Hide this section from Departments metrics"
              aria-label={`Hide ${row.name}`}
              className="rounded-lg border border-zinc-200 bg-white p-1.5 text-zinc-500 transition hover:border-rose-300 hover:text-rose-600 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-rose-700 dark:hover:text-rose-300"
              onClick={(e) => {
                e.stopPropagation();
                onHide();
              }}
              onDoubleClick={(e) => e.stopPropagation()}
            >
              <EyeOff className="size-3.5" aria-hidden />
            </button>
          ) : null}
        </div>
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
              <circle cx={cx} cy={cy} r={rIn} fill="white" className="dark:fill-zinc-900/80" />
              <text
                x={cx}
                y={cy + 3}
                textAnchor="middle"
                className="fill-zinc-900 text-[9px] font-black dark:fill-zinc-100"
              >
                —
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
                {headline}
              </text>
            </>
          )}
        </svg>
        <div className="mt-3 flex flex-wrap justify-center gap-3 text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full" style={{ background: KPI_DONUT_COLORS.positive }} />
            Done {row.done}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full" style={{ background: KPI_DONUT_COLORS.negative }} />
            Missing {row.missing}
          </span>
        </div>
      </div>
    </article>
  );
}

function DepartmentTasksList({
  tasks,
  canOpenSegmentView,
  onOpenSegmentView,
}: {
  tasks: TaskChecklistIncludedTask[];
  canOpenSegmentView: boolean;
  onOpenSegmentView: (taskId: string) => void;
}) {
  if (tasks.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-zinc-300 px-6 py-12 text-center dark:border-zinc-700">
        <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          No tasks for members in this section
        </p>
        <p className="mt-1 text-xs text-zinc-500">
          Checklist tasks assigned to section members appear here for the selected period.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Tasks for users under this section ({tasks.length}).
        {canOpenSegmentView ? " Double-click a segmented task to open SegmentView." : ""}
      </p>
      <ul className="space-y-3">
        {tasks.map((task) => {
          const showPhases = (task.phases?.length ?? 0) > 0;
          const hasSegments = segmentsForIncludedTask(task).length > 0;
          return (
            <li
              key={task.id}
              title={hasSegments ? "Double-click to open SegmentView for this task" : undefined}
              onDoubleClick={() => {
                if (hasSegments) onOpenSegmentView(task.id);
              }}
              className={cn(
                "rounded-xl border border-zinc-200 bg-zinc-50/80 p-3 dark:border-zinc-800 dark:bg-zinc-900/50",
                hasSegments
                  ? "cursor-pointer hover:border-orange-300 dark:hover:border-orange-700/70"
                  : undefined,
              )}
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
                    Recorded data {task.recordedPercent != null ? task.recordedPercent : task.percent}%
                  </p>
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
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function DepartmentSegmentView({
  tasks,
  focusTaskId,
  onClearFocus,
  onFocusTask,
}: {
  tasks: TaskChecklistIncludedTask[];
  focusTaskId: string | null;
  onClearFocus: () => void;
  onFocusTask: (taskId: string) => void;
}) {
  const focusTask = focusTaskId ? (tasks.find((t) => t.id === focusTaskId) ?? null) : null;
  const viewTasks = focusTask
    ? [focusTask]
    : tasks.filter((t) => segmentsForIncludedTask(t).length > 0);

  if (viewTasks.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-zinc-300 px-6 py-12 text-center dark:border-zinc-700">
        <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          No segmented checklists in this section
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        {focusTask
          ? "Segments for the selected task only."
          : "Segments grouped by task. Double-click a task in Tasks view to focus one task."}
      </p>
      {focusTask ? (
        <button
          type="button"
          onClick={onClearFocus}
          className="text-xs font-semibold text-orange-700 hover:underline dark:text-orange-300"
        >
          Show all segmented tasks
        </button>
      ) : null}
      <ul className="space-y-2">
        {viewTasks.map((task) => {
          const segments = segmentsForIncludedTask(task);
          return (
            <li
              key={task.id}
              className="rounded-xl border border-zinc-200 bg-zinc-50/80 px-3 py-2.5 dark:border-zinc-800 dark:bg-zinc-900/50"
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                  <p className="shrink-0 font-semibold text-zinc-950 dark:text-zinc-50">{task.title}</p>
                  {task.frequency ? (
                    <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">
                      {task.frequency}
                    </span>
                  ) : null}
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                    {segments.map((seg) => (
                      <span
                        key={`${task.id}:${seg.id}`}
                        className="inline-flex max-w-full shrink-0 items-center gap-1.5 rounded-lg border border-zinc-200/90 bg-white px-2 py-1 text-xs dark:border-zinc-700/90 dark:bg-zinc-950/70"
                        title={`${seg.name}: ${seg.done}/${seg.total} complete`}
                      >
                        <span className="max-w-[9rem] truncate font-semibold text-zinc-900 dark:text-zinc-100">
                          {seg.name}
                        </span>
                        <span
                          className={cn(
                            "shrink-0 tabular-nums font-bold",
                            seg.percent >= 100
                              ? "text-emerald-700 dark:text-emerald-300"
                              : seg.percent > 0
                                ? "text-orange-700 dark:text-orange-300"
                                : "text-zinc-500 dark:text-zinc-400",
                          )}
                        >
                          {seg.percent}%
                        </span>
                      </span>
                    ))}
                  </div>
                </div>
                {!focusTask ? (
                  <button
                    type="button"
                    onClick={() => onFocusTask(task.id)}
                    className="shrink-0 text-[11px] font-semibold text-orange-700 hover:underline dark:text-orange-300"
                  >
                    Focus task
                  </button>
                ) : null}
              </div>
              <ul className="mt-2 space-y-2">
                {segments.map((seg) => (
                  <li
                    key={`${task.id}:${seg.id}:items`}
                    className="rounded-lg border border-zinc-200/80 bg-white px-3 py-2 dark:border-zinc-700/80 dark:bg-zinc-950/60"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                        {seg.name}
                      </span>
                      <span className="shrink-0 text-xs font-semibold tabular-nums text-zinc-600 dark:text-zinc-300">
                        {seg.done}/{seg.total} · {seg.percent}%
                      </span>
                    </div>
                    {seg.items.length > 0 ? (
                      <ul className="mt-2 space-y-1 border-t border-zinc-100 pt-2 dark:border-zinc-800">
                        {seg.items.map((item) => (
                          <li
                            key={`${task.id}:${seg.id}:${item.id}`}
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
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function DepartmentTaskMetricsGrid({
  sections,
  reportingPeriodLabel,
  companyLabel,
  loading = false,
  canManageVisibility = false,
  onVisibilityChanged,
  canImport = false,
  onImportComplete,
}: DepartmentTaskMetricsGridProps) {
  const [drillStack, setDrillStack] = useState<DepartmentMetricRow[]>([]);
  const [inspectView, setInspectView] = useState<DepartmentInspectView>("subsections");
  const [segmentFocusTaskId, setSegmentFocusTaskId] = useState<string | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const [catalog, setCatalog] = useState<CatalogSection[]>([]);
  const [hiddenIds, setHiddenIds] = useState<string[]>([]);
  const [visibilityLoading, setVisibilityLoading] = useState(false);
  const [visibilitySaving, setVisibilitySaving] = useState(false);
  const [visibilityError, setVisibilityError] = useState<string | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastOpenRef = useRef<{ id: string; at: number } | null>(null);

  const inspected = drillStack.length > 0 ? drillStack[drillStack.length - 1]! : null;
  const includedTasks = inspected?.includedTasks ?? [];
  const canShowTasks = includedTasks.length > 0;
  const canShowSegmentView =
    canShowTasks && includedTasks.some((t) => segmentsForIncludedTask(t).length > 0);
  const segmentFocusTask = segmentFocusTaskId
    ? (includedTasks.find((t) => t.id === segmentFocusTaskId) ?? null)
    : null;

  const rollup = sections.reduce(
    (acc, s) => ({
      total: acc.total + s.total,
      done: acc.done + s.done,
    }),
    { total: 0, done: 0 },
  );
  const rollupPercent =
    rollup.total <= 0 ? 0 : Math.round((rollup.done / rollup.total) * 1000) / 10;

  const loadVisibility = useCallback(async () => {
    if (!canManageVisibility) return;
    setVisibilityLoading(true);
    setVisibilityError(null);
    try {
      const res = await fetch("/api/admin/department-metrics-visibility", { cache: "no-store" });
      if (!res.ok) {
        setVisibilityError("Could not load section visibility.");
        return;
      }
      const json = (await res.json()) as {
        hiddenSectionIds?: string[];
        sections?: CatalogSection[];
      };
      setHiddenIds(json.hiddenSectionIds ?? []);
      setCatalog(json.sections ?? []);
    } catch {
      setVisibilityError("Could not load section visibility.");
    } finally {
      setVisibilityLoading(false);
    }
  }, [canManageVisibility]);

  useEffect(() => {
    if (!canManageVisibility) return;
    void loadVisibility();
  }, [canManageVisibility, loadVisibility]);

  const saveHiddenIds = useCallback(
    async (nextIds: string[]) => {
      setVisibilitySaving(true);
      setVisibilityError(null);
      const previous = hiddenIds;
      setHiddenIds(nextIds);
      try {
        const res = await fetch("/api/admin/department-metrics-visibility", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ hiddenSectionIds: nextIds }),
        });
        if (!res.ok) {
          setHiddenIds(previous);
          setVisibilityError("Could not update section visibility.");
          return;
        }
        const json = (await res.json()) as { hiddenSectionIds?: string[] };
        setHiddenIds(json.hiddenSectionIds ?? nextIds);
        onVisibilityChanged?.();
      } catch {
        setHiddenIds(previous);
        setVisibilityError("Could not update section visibility.");
      } finally {
        setVisibilitySaving(false);
      }
    },
    [hiddenIds, onVisibilityChanged],
  );

  function hideSection(id: string) {
    if (hiddenIds.includes(id)) return;
    void saveHiddenIds([...hiddenIds, id]);
    setDrillStack((prev) => prev.filter((node) => node.id !== id));
  }

  function showSection(id: string) {
    void saveHiddenIds(hiddenIds.filter((x) => x !== id));
  }

  const catalogByParent = useMemo(() => {
    const map = new Map<string | null, CatalogSection[]>();
    for (const s of catalog) {
      const list = map.get(s.parentId) ?? [];
      list.push(s);
      map.set(s.parentId, list);
    }
    return map;
  }, [catalog]);

  const hiddenSet = useMemo(() => new Set(hiddenIds), [hiddenIds]);

  function defaultViewFor(row: DepartmentMetricRow): DepartmentInspectView {
    if (row.subsections.length > 0) return "subsections";
    if ((row.includedTasks?.length ?? 0) > 0) return "tasks";
    return "subsections";
  }

  function openSection(row: DepartmentMetricRow) {
    const now = Date.now();
    const last = lastOpenRef.current;
    // Touch double-tap often also fires dblclick — avoid pushing the same section twice.
    if (last && last.id === row.id && now - last.at < 450) return;
    lastOpenRef.current = { id: row.id, at: now };
    setSegmentFocusTaskId(null);
    setInspectView(defaultViewFor(row));
    setDrillStack((prev) => [...prev, row]);
  }

  function closeModal() {
    setDrillStack([]);
    setInspectView("subsections");
    setSegmentFocusTaskId(null);
  }

  function goBack() {
    setDrillStack((prev) => {
      const next = prev.slice(0, -1);
      const top = next[next.length - 1];
      setInspectView(top ? defaultViewFor(top) : "subsections");
      setSegmentFocusTaskId(null);
      return next;
    });
  }

  function openSegmentViewForTask(taskId: string) {
    setSegmentFocusTaskId(taskId);
    setInspectView("segment");
  }

  async function onImportFileSelected(file: File | null) {
    if (!file || !canImport) return;
    setImportBusy(true);
    setImportError(null);
    setImportMessage(null);
    try {
      const form = new FormData();
      form.set("file", file);
      try {
        form.set("tz", Intl.DateTimeFormat().resolvedOptions().timeZone);
      } catch {
        /* ignore */
      }
      const res = await fetch("/api/kpis/department-task-csv/import", {
        method: "POST",
        body: form,
      });
      const json = (await res.json().catch(() => null)) as {
        error?: string;
        created?: Array<{ mainTask: string }>;
        skipped?: Array<{ mainTask: string; reason: string }>;
        errors?: string[];
        warnings?: string[];
        membershipsAdded?: number;
      } | null;
      if (!res.ok) {
        const detail =
          json?.error ||
          (Array.isArray(json?.errors) && json.errors.length > 0 ? json.errors[0] : null) ||
          "Import failed.";
        setImportError(detail);
        return;
      }
      const created = json?.created?.length ?? 0;
      const skipped = json?.skipped?.length ?? 0;
      const errCount = json?.errors?.length ?? 0;
      const warnCount = json?.warnings?.length ?? 0;
      const memberships = json?.membershipsAdded ?? 0;
      const parts = [
        `Created ${created} task${created === 1 ? "" : "s"}`,
        skipped > 0 ? `skipped ${skipped}` : null,
        memberships > 0 ? `${memberships} department link${memberships === 1 ? "" : "s"}` : null,
        warnCount > 0 ? `${warnCount} warning${warnCount === 1 ? "" : "s"}` : null,
        errCount > 0 ? `${errCount} row error${errCount === 1 ? "" : "s"}` : null,
      ].filter(Boolean);
      setImportMessage(parts.join(" · "));
      if (Array.isArray(json?.warnings) && json.warnings.length > 0) {
        setImportError(json.warnings.slice(0, 3).join(" "));
      } else if (Array.isArray(json?.errors) && json.errors.length > 0 && created === 0) {
        setImportError(json.errors.slice(0, 3).join(" "));
      }
      if (created > 0) onImportComplete?.();
    } catch {
      setImportError("Import failed.");
    } finally {
      setImportBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  const viewTabClass = (active: boolean) =>
    cn(
      "rounded-full border px-3 py-1 text-xs font-semibold",
      active
        ? "border-orange-400 bg-orange-100 text-orange-900 dark:border-orange-500/50 dark:bg-orange-500/20 dark:text-orange-100"
        : "border-orange-300 bg-orange-50 text-orange-800 hover:bg-orange-100 dark:border-orange-500/40 dark:bg-orange-500/10 dark:text-orange-200 dark:hover:bg-orange-500/20",
    );

  const headerActionClass =
    "inline-flex h-8 shrink-0 items-center gap-1.5 px-3 text-xs font-semibold leading-none text-zinc-700 transition hover:bg-zinc-100 hover:text-orange-700 disabled:cursor-not-allowed disabled:opacity-60 dark:text-zinc-200 dark:hover:bg-zinc-800 dark:hover:text-orange-300";

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-orange-600 dark:text-orange-300">
            Department sections
          </p>
          <h4 className="mt-1 text-lg font-bold text-zinc-950 dark:text-zinc-50">
            {companyLabel ? `${companyLabel} departments` : "All departments"}
          </h4>
          {reportingPeriodLabel ? (
            <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">{reportingPeriodLabel}</p>
          ) : null}
          <p className="mt-1 max-w-2xl text-[11px] text-zinc-500 dark:text-zinc-500">
            Main donuts use org-chart section membership. Double-click a section to open subsections
            and member tasks; use SegmentView for checklist segments.
            {canManageVisibility
              ? " SuperAdmin can hide sections from this view for everyone."
              : ""}
          </p>

          <div
            className="mt-3 inline-flex max-w-full flex-wrap items-center overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900"
            role="group"
            aria-label="Department data actions"
          >
            <a
              href="/api/kpis/department-task-csv/sample"
              download="department-task-import-sample.csv"
              onClick={() => setImportError(null)}
              className={headerActionClass}
            >
              <Download className="size-3.5 shrink-0" aria-hidden />
              Sample CSV
            </a>
            {canImport ? (
              <>
                <span className="h-4 w-px shrink-0 bg-zinc-200 dark:bg-zinc-700" aria-hidden />
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="sr-only"
                  tabIndex={-1}
                  onChange={(e) => void onImportFileSelected(e.target.files?.[0] ?? null)}
                />
                <button
                  type="button"
                  disabled={importBusy}
                  onClick={() => fileInputRef.current?.click()}
                  className={headerActionClass}
                >
                  <Upload className="size-3.5 shrink-0" aria-hidden />
                  {importBusy ? "Importing…" : "Import CSV"}
                </button>
              </>
            ) : null}
            {canManageVisibility ? (
              <>
                <span className="h-4 w-px shrink-0 bg-zinc-200 dark:bg-zinc-700" aria-hidden />
                <button
                  type="button"
                  onClick={() => {
                    setManageOpen(true);
                    void loadVisibility();
                  }}
                  className={headerActionClass}
                >
                  <EyeOff className="size-3.5 shrink-0" aria-hidden />
                  Hide sections
                  {hiddenIds.length > 0 ? (
                    <span className="rounded-md bg-zinc-100 px-1.5 py-0.5 text-[10px] tabular-nums leading-none dark:bg-zinc-800">
                      {hiddenIds.length}
                    </span>
                  ) : null}
                </button>
              </>
            ) : null}
          </div>
        </div>

        {sections.length > 0 ? (
          <div className="shrink-0 rounded-xl border border-zinc-200 bg-zinc-50/90 px-4 py-3 lg:min-w-[11rem] dark:border-zinc-700/80 dark:bg-zinc-900/50">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">
              Org rollup
            </p>
            <p className="mt-1 text-2xl font-black tabular-nums text-zinc-900 dark:text-zinc-100">
              {rollupPercent}%
            </p>
            <p className="mt-1 text-[11px] text-zinc-600 dark:text-zinc-400">
              {rollup.done}/{rollup.total} checklist items · {sections.length} main section
              {sections.length === 1 ? "" : "s"}
            </p>
          </div>
        ) : null}
      </div>

      {importError ? (
        <p className="rounded-xl border border-rose-400/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-900 dark:border-rose-500/30 dark:text-rose-100">
          {importError}
        </p>
      ) : null}
      {importMessage ? (
        <p className="rounded-xl border border-emerald-400/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-500/30 dark:text-emerald-100">
          {importMessage}
        </p>
      ) : null}

      {visibilityError ? (
        <p className="rounded-xl border border-rose-400/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-900 dark:border-rose-500/30 dark:text-rose-100">
          {visibilityError}
        </p>
      ) : null}

      <div className={cn(loading && "pointer-events-none opacity-60")}>
        {sections.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-300 px-6 py-16 text-center dark:border-zinc-700">
            <Building2 className="size-10 text-zinc-400 dark:text-zinc-600" aria-hidden />
            <p className="mt-3 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
              No department section metrics for this scope
            </p>
            <p className="mt-1 max-w-md text-xs text-zinc-600 dark:text-zinc-500">
              Assign people to org-chart sections, then reload. Metrics use checklist tasks for members
              in each section tree.
              {canManageVisibility && hiddenIds.length > 0
                ? " Some sections may be hidden — use Hide sections to restore them."
                : ""}
            </p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {sections.map((section) => (
              <DepartmentDonutCard
                key={section.id}
                row={section}
                inspectHint="Double-click or double-tap to view subsections and tasks"
                onInspect={() => openSection(section)}
                canHide={canManageVisibility}
                onHide={() => hideSection(section.id)}
              />
            ))}
          </div>
        )}
      </div>

      {inspected && typeof document !== "undefined"
        ? createPortal(
            <div
              className="fixed inset-0 z-[300] flex items-end justify-center bg-black/50 p-3 sm:items-center sm:p-6"
              role="dialog"
              aria-modal="true"
              aria-label={`${inspected.name} details`}
              data-metrics-inspect=""
              onClick={closeModal}
            >
              <div
                className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-950"
                onClick={(e) => e.stopPropagation()}
              >
            <div className="shrink-0 border-b border-zinc-200 p-5 dark:border-zinc-800 sm:p-7 sm:pb-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-orange-600 dark:text-orange-300">
                    {inspectView === "segment"
                      ? "SegmentView"
                      : inspectView === "tasks"
                        ? "Tasks in this section"
                        : "Extended view"}
                  </p>
                  {drillStack.length > 1 ? (
                    <nav
                      className="mt-1.5 flex flex-wrap items-center gap-1 text-[11px] font-semibold text-zinc-500 dark:text-zinc-400"
                      aria-label="Section path"
                    >
                      {drillStack.map((node, index) => (
                        <span key={node.id} className="inline-flex items-center gap-1">
                          {index > 0 ? <span className="text-zinc-400">/</span> : null}
                          {index < drillStack.length - 1 ? (
                            <button
                              type="button"
                              className="hover:text-orange-600 dark:hover:text-orange-300"
                              onClick={() => {
                                setDrillStack((prev) => {
                                  const next = prev.slice(0, index + 1);
                                  const top = next[next.length - 1];
                                  setInspectView(top ? defaultViewFor(top) : "subsections");
                                  setSegmentFocusTaskId(null);
                                  return next;
                                });
                              }}
                            >
                              {node.name}
                            </button>
                          ) : (
                            <span className="text-zinc-800 dark:text-zinc-200">{node.name}</span>
                          )}
                        </span>
                      ))}
                    </nav>
                  ) : null}
                  <h4 className="mt-1 text-xl font-bold text-zinc-950 dark:text-zinc-50">
                    {inspected.name}
                  </h4>
                  {inspectView === "segment" && segmentFocusTask ? (
                    <p className="mt-1 text-sm font-medium text-zinc-600 dark:text-zinc-300">
                      {segmentFocusTask.title}
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                      {inspected.percent}% · {inspected.done}/{inspected.total} done ·{" "}
                      {inspected.subsections.length} subsection
                      {inspected.subsections.length === 1 ? "" : "s"}
                      {includedTasks.length > 0
                        ? ` · ${includedTasks.length} task${includedTasks.length === 1 ? "" : "s"}`
                        : ""}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                  {inspected.subsections.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => {
                        setInspectView("subsections");
                        setSegmentFocusTaskId(null);
                      }}
                      className={viewTabClass(inspectView === "subsections")}
                    >
                      Subsections
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      setInspectView("tasks");
                      setSegmentFocusTaskId(null);
                    }}
                    className={viewTabClass(inspectView === "tasks")}
                  >
                    Tasks
                  </button>
                  {canShowSegmentView ? (
                    <button
                      type="button"
                      onClick={() => setInspectView("segment")}
                      className={viewTabClass(inspectView === "segment")}
                    >
                      SegmentView
                    </button>
                  ) : null}
                  {canManageVisibility ? (
                    <button
                      type="button"
                      onClick={() => hideSection(inspected.id)}
                      className="inline-flex items-center gap-1 rounded-xl border border-zinc-200 px-2.5 py-2 text-xs font-semibold text-zinc-700 transition hover:border-rose-300 hover:text-rose-700 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-rose-700 dark:hover:text-rose-300"
                    >
                      <EyeOff className="size-3.5" aria-hidden />
                      Hide
                    </button>
                  ) : null}
                  {drillStack.length > 1 ? (
                    <button
                      type="button"
                      onClick={goBack}
                      className="inline-flex items-center gap-1 rounded-xl border border-zinc-200 px-2.5 py-2 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
                    >
                      <ChevronLeft className="size-3.5" aria-hidden />
                      Back
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={closeModal}
                    className="rounded-xl border border-zinc-200 p-2 text-zinc-600 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
                    aria-label="Close"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-7 sm:pt-5">
              {inspectView === "segment" && canShowSegmentView ? (
                <DepartmentSegmentView
                  tasks={includedTasks}
                  focusTaskId={segmentFocusTaskId}
                  onClearFocus={() => setSegmentFocusTaskId(null)}
                  onFocusTask={openSegmentViewForTask}
                />
              ) : inspectView === "tasks" ? (
                <DepartmentTasksList
                  tasks={includedTasks}
                  canOpenSegmentView={canShowSegmentView}
                  onOpenSegmentView={openSegmentViewForTask}
                />
              ) : inspected.subsections.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-zinc-300 px-6 py-12 text-center dark:border-zinc-700">
                  <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
                    No subsections under this section
                  </p>
                  <p className="mt-1 text-xs text-zinc-500">
                    {canShowTasks
                      ? "Use the Tasks tab to see member checklist tasks, or SegmentView for segments."
                      : "Create nested org-chart sections to break this department down further."}
                  </p>
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {inspected.subsections.map((sub) => (
                    <DepartmentDonutCard
                      key={sub.id}
                      row={sub}
                      inspectHint="Double-click or double-tap to view nested subsections and tasks"
                      onInspect={() => openSection(sub)}
                      canHide={canManageVisibility}
                      onHide={() => hideSection(sub.id)}
                    />
                  ))}
                </div>
              )}
            </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {manageOpen && canManageVisibility && typeof document !== "undefined"
        ? createPortal(
            <div
              className="fixed inset-0 z-[310] flex items-end justify-center bg-black/50 p-3 sm:items-center sm:p-6"
              role="dialog"
              aria-modal="true"
              aria-label="Hide department sections"
              data-metrics-inspect=""
              onClick={() => setManageOpen(false)}
            >
              <div
                className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-zinc-200 bg-white p-5 shadow-2xl dark:border-zinc-700 dark:bg-zinc-950 sm:p-6"
                onClick={(e) => e.stopPropagation()}
              >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-orange-600 dark:text-orange-300">
                  SuperAdmin
                </p>
                <h4 className="mt-1 text-lg font-bold text-zinc-950 dark:text-zinc-50">
                  Hide sections
                </h4>
                <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                  Hidden sections are removed from Departments metrics for everyone. Unhide to restore.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setManageOpen(false)}
                className="rounded-xl border border-zinc-200 p-2 text-zinc-600 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
                aria-label="Close"
              >
                <X className="size-4" />
              </button>
            </div>

            {visibilityLoading ? (
              <p className="mt-6 text-sm text-zinc-500">Loading sections…</p>
            ) : catalog.length === 0 ? (
              <p className="mt-6 text-sm text-zinc-500">No org-chart sections found.</p>
            ) : (
              <ul className="mt-5 space-y-1">
                {(catalogByParent.get(null) ?? []).map((main) => {
                  const children = catalogByParent.get(main.id) ?? [];
                  const mainHidden = hiddenSet.has(main.id);
                  return (
                    <li key={main.id} className="rounded-xl border border-zinc-200 dark:border-zinc-800">
                      <div className="flex items-center justify-between gap-2 px-3 py-2.5">
                        <div className="min-w-0">
                          <p
                            className={cn(
                              "truncate text-sm font-semibold",
                              mainHidden
                                ? "text-zinc-400 line-through dark:text-zinc-600"
                                : "text-zinc-900 dark:text-zinc-100",
                            )}
                          >
                            {main.name}
                          </p>
                          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
                            Main section
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled={visibilitySaving}
                          onClick={() =>
                            mainHidden ? showSection(main.id) : hideSection(main.id)
                          }
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition disabled:opacity-50",
                            mainHidden
                              ? "border-orange-300 text-orange-700 hover:bg-orange-50 dark:border-orange-700 dark:text-orange-300 dark:hover:bg-orange-950/40"
                              : "border-zinc-200 text-zinc-600 hover:border-rose-300 hover:text-rose-700 dark:border-zinc-700 dark:text-zinc-300",
                          )}
                        >
                          {mainHidden ? (
                            <>
                              <Eye className="size-3.5" aria-hidden />
                              Show
                            </>
                          ) : (
                            <>
                              <EyeOff className="size-3.5" aria-hidden />
                              Hide
                            </>
                          )}
                        </button>
                      </div>
                      {children.length > 0 ? (
                        <ul className="border-t border-zinc-100 dark:border-zinc-800/80">
                          {children.map((child) => {
                            const childHidden = hiddenSet.has(child.id);
                            return (
                              <li
                                key={child.id}
                                className="flex items-center justify-between gap-2 px-3 py-2 pl-6"
                              >
                                <p
                                  className={cn(
                                    "truncate text-sm",
                                    childHidden
                                      ? "text-zinc-400 line-through dark:text-zinc-600"
                                      : "text-zinc-700 dark:text-zinc-300",
                                  )}
                                >
                                  {child.name}
                                </p>
                                <button
                                  type="button"
                                  disabled={visibilitySaving || mainHidden}
                                  title={
                                    mainHidden
                                      ? "Unhide the main section first"
                                      : undefined
                                  }
                                  onClick={() =>
                                    childHidden
                                      ? showSection(child.id)
                                      : hideSection(child.id)
                                  }
                                  className={cn(
                                    "inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] font-semibold transition disabled:opacity-40",
                                    childHidden
                                      ? "border-orange-300 text-orange-700 dark:border-orange-700 dark:text-orange-300"
                                      : "border-zinc-200 text-zinc-500 dark:border-zinc-700 dark:text-zinc-400",
                                  )}
                                >
                                  {childHidden ? (
                                    <>
                                      <Eye className="size-3" aria-hidden />
                                      Show
                                    </>
                                  ) : (
                                    <>
                                      <EyeOff className="size-3" aria-hidden />
                                      Hide
                                    </>
                                  )}
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
              </div>
            </div>,
            document.body,
          )
        : null}
    </section>
  );
}
