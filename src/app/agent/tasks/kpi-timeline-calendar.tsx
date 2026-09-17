"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { DEFAULT_TIME_ZONE, getPeriodEndExclusive, type KpiFrequencyCode } from "@/lib/kpi-recurrence";
import { getPeriodStartInclusive } from "@/lib/kpi-period-window";
import { taskKanbanDerivedStatus } from "@/lib/kpi-cycle-state";
import { getTaskTargetDueDate, kpiChecklistProgress } from "@/lib/kpi-subkpis";
import { isFieldAssignmentTask, isProjectTask } from "@/lib/kpi-subkpis";
import { isItProjectImplementationPillar } from "@/lib/it-task-pillar-titles";

type KpiBoardStatus = "CURRENT" | "PENDING_VERIFICATION" | "DONE" | "DELAYED";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const STATUS_ORDER: Record<KpiBoardStatus, number> = {
  DELAYED: 0,
  PENDING_VERIFICATION: 1,
  CURRENT: 2,
  DONE: 3,
};

type CalendarKpiRow = {
  id: string;
  title: string;
  mainTask?: string | null;
  isRecurring?: boolean;
  nonRecurringStartAt?: string | null;
  nonRecurringEndAt?: string | null;
  frequency: string;
  subKpis: unknown;
  periodCycleStartAt?: string | null;
  recurrenceWeekday?: number | null;
  recurrenceMonthDay?: number | null;
  createdAt?: string;
  assignedAgent?: { id: string; name: string } | null;
  isFieldAssignment?: boolean;
};

type CalendarTaskCategory = "task" | "project" | "field";

function calendarCategoryOf(r: CalendarKpiRow): CalendarTaskCategory {
  if (r.isFieldAssignment || isFieldAssignmentTask(r.subKpis)) return "field";
  if (isItProjectImplementationPillar(r.title) || isProjectTask(r.subKpis)) return "project";
  return "task";
}

type CalendarEntry = {
  id: string;
  title: string;
  status: KpiBoardStatus;
  targetYmd: string;
  startYmd: string;
  isRecurring: boolean;
  frequencyLabel: string;
  assigneeName: string | null;
};

function localYmd(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function ymdOfDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function todayYmd(): string {
  return ymdOfDate(new Date());
}

function frequencyLabel(freq: string): string {
  switch (freq) {
    case "DAILY":
      return "D";
    case "WEEKLY":
      return "W";
    case "MONTHLY":
      return "M";
    case "QUARTERLY":
      return "Q";
    case "SEMI_ANNUAL":
      return "S";
    case "YEARLY":
      return "Y";
    default:
      return "";
  }
}

function toCalendarEntry(r: CalendarKpiRow): CalendarEntry {
  const freq = (r.frequency as KpiFrequencyCode) ?? "DAILY";
  const now = new Date();
  const progress = kpiChecklistProgress(r.subKpis, r.mainTask ?? r.title);
  const status = taskKanbanDerivedStatus(
    r as Parameters<typeof taskKanbanDerivedStatus>[0],
    { total: progress.total, done: progress.done, nowMs: now.getTime(), timeZone: DEFAULT_TIME_ZONE },
  );

  const isRecurring = r.isRecurring !== false;
  let targetYmd = (getTaskTargetDueDate(r.subKpis) ?? "").trim();
  let startYmd = localYmd(r.nonRecurringStartAt);

  if (!targetYmd && isRecurring) {
    const start = getPeriodStartInclusive(freq, r.recurrenceWeekday, r.recurrenceMonthDay, now, DEFAULT_TIME_ZONE);
    const endExclusive = getPeriodEndExclusive(freq, r.recurrenceWeekday, r.recurrenceMonthDay, now, DEFAULT_TIME_ZONE);
    targetYmd = ymdOfDate(new Date(endExclusive.getTime() - 86_400_000));
    if (!startYmd) startYmd = ymdOfDate(start);
  } else if (!targetYmd) {
    targetYmd = localYmd(r.nonRecurringEndAt);
  }

  return {
    id: r.id,
    title: r.title,
    status,
    targetYmd,
    startYmd,
    isRecurring,
    frequencyLabel: isRecurring ? frequencyLabel(freq) : "",
    assigneeName: r.assignedAgent?.name ?? null,
  };
}

function dateInputLabel(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const STATUS_CHIP_CLASS: Record<KpiBoardStatus, string> = {
  DELAYED: "bg-rose-600/90 text-white hover:bg-rose-500",
  PENDING_VERIFICATION: "bg-violet-600/90 text-white hover:bg-violet-500",
  CURRENT: "bg-orange-600/90 text-white hover:bg-orange-500",
  DONE: "bg-emerald-600/90 text-white hover:bg-emerald-500",
};

const STATUS_DOT_CLASS: Record<KpiBoardStatus, string> = {
  DELAYED: "bg-rose-600",
  PENDING_VERIFICATION: "bg-violet-600",
  CURRENT: "bg-orange-600",
  DONE: "bg-emerald-600",
};

export function KpiTimelineCalendar({
  companyFilterTeamId = null,
  assignedAgentFilterId = null,
  searchQuery = "",
  categoryFilter = "all",
  frequencyFilter = "all",
}: {
  companyFilterTeamId?: string | null;
  assignedAgentFilterId?: string | null;
  /** Free-text search (matched against task title). */
  searchQuery?: string;
  /** Task Board category filter: all | task | project | field. */
  categoryFilter?: string;
  /** Frequency filter: all or a TASK_FREQUENCY_DONUT_KEYS value (ONE-OFF, DAILY, ...). */
  frequencyFilter?: string;
} = {}) {
  const [rows, setRows] = useState<CalendarKpiRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return { y: d.getFullYear(), m: d.getMonth() };
  });
  const [startFrom, setStartFrom] = useState("");
  const [startTo, setStartTo] = useState("");
  const [dueFrom, setDueFrom] = useState("");
  const [dueTo, setDueTo] = useState("");

  useEffect(() => {
    const companyQs =
      companyFilterTeamId && companyFilterTeamId !== "ALL"
        ? `&company=${encodeURIComponent(companyFilterTeamId)}`
        : "";
    const assignedQs =
      assignedAgentFilterId && assignedAgentFilterId !== "ALL"
        ? `&assigned=${encodeURIComponent(assignedAgentFilterId)}`
        : "";
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/kpi-maintenance?tz=${encodeURIComponent(DEFAULT_TIME_ZONE)}${companyQs}${assignedQs}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (!cancelled) setError(body.error ?? "Could not load task calendar.");
        return;
      }
      const payload = (await res.json()) as { rows?: CalendarKpiRow[] };
      if (!cancelled) {
        setError(null);
        if (Array.isArray(payload.rows)) setRows(payload.rows);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [companyFilterTeamId, assignedAgentFilterId]);

  const entries = useMemo(() => {
    if (!rows) return [];
    const q = searchQuery.trim().toLowerCase();
    const byId = new Map<string, CalendarEntry>();
    for (const row of rows) {
      if (q && !(row.title ?? "").toLowerCase().includes(q)) continue;
      if (categoryFilter !== "all" && calendarCategoryOf(row) !== categoryFilter) continue;
      if (frequencyFilter !== "all") {
        const oneOff = !row.isRecurring;
        const matches = oneOff
          ? frequencyFilter === "ONE-OFF"
          : row.frequency === frequencyFilter;
        if (!matches) continue;
      }
      const entry = toCalendarEntry(row);
      byId.set(entry.id, entry);
    }
    const startFromOn = startFrom.length === 10;
    const startToOn = startTo.length === 10;
    const dueFromOn = dueFrom.length === 10;
    const dueToOn = dueTo.length === 10;
    const out: CalendarEntry[] = [];
    for (const entry of byId.values()) {
      if (startFromOn && (!entry.startYmd || entry.startYmd < startFrom)) continue;
      if (startToOn && (!entry.startYmd || entry.startYmd > startTo)) continue;
      if (dueFromOn && (!entry.targetYmd || entry.targetYmd < dueFrom)) continue;
      if (dueToOn && (!entry.targetYmd || entry.targetYmd > dueTo)) continue;
      out.push(entry);
    }
    return out;
  }, [rows, startFrom, startTo, dueFrom, dueTo, searchQuery, categoryFilter, frequencyFilter]);

  const { y: year, m: month } = cursor;
  const firstDayOffset = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const nowYmd = todayYmd();
  const cursorYmd = `${year}-${String(month + 1).padStart(2, "0")}`;

  const tasksByTargetDay = useMemo(() => {
    const map = new Map<string, CalendarEntry[]>();
    for (const entry of entries) {
      if (!entry.targetYmd) continue;
      const list = map.get(entry.targetYmd) ?? [];
      list.push(entry);
      map.set(entry.targetYmd, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.title.localeCompare(b.title));
    }
    return map;
  }, [entries]);

  const startsByDay = useMemo(() => {
    const map = new Map<string, CalendarEntry[]>();
    for (const entry of entries) {
      if (!entry.startYmd || entry.startYmd === entry.targetYmd) continue;
      const list = map.get(entry.startYmd) ?? [];
      list.push(entry);
      map.set(entry.startYmd, list);
    }
    return map;
  }, [entries]);

  const scheduledCount = entries.filter((e) => e.targetYmd).length;
  const unscheduled = entries.filter((e) => !e.targetYmd);

  const moveMonth = (delta: number) => {
    setCursor((c) => {
      const d = new Date(c.y, c.m + delta, 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    });
  };

  const filtersActive = startFrom || startTo || dueFrom || dueTo;
  const clearFilters = () => {
    setStartFrom("");
    setStartTo("");
    setDueFrom("");
    setDueTo("");
  };

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-3 shadow-[0_8px_28px_rgba(0,0,0,0.06)] sm:p-5 dark:border-zinc-800 dark:bg-surface dark:shadow-[0_10px_30px_rgba(0,0,0,0.25)]">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => moveMonth(-1)}
              className="rounded-md border border-zinc-300 bg-white p-1.5 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
              aria-label="Previous month"
            >
              <ChevronLeft className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => moveMonth(1)}
              className="rounded-md border border-zinc-300 bg-white p-1.5 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
              aria-label="Next month"
            >
              <ChevronRight className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                const d = new Date();
                setCursor({ y: d.getFullYear(), m: d.getMonth() });
              }}
              className="rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Today
            </button>
            <h2 className="ml-1 text-base font-bold text-zinc-900 dark:text-zinc-100">
              {new Date(year, month, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" })}
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
            {(["DELAYED", "CURRENT", "DONE"] as KpiBoardStatus[]).map((s) => (
              <span key={s} className="flex items-center gap-1.5">
                <span className={cn("size-2 rounded-full", STATUS_DOT_CLASS[s])} aria-hidden />
                {s === "DELAYED" ? "Delayed" : s === "DONE" ? "Done" : "In progress"}
              </span>
            ))}
            <span className="hidden items-center gap-1.5 sm:flex">
              <span className="size-2 rounded-full border-2 border-sky-500" aria-hidden />
              Start date
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-x-4 gap-y-2 rounded-lg border border-zinc-200 bg-zinc-50/70 p-3 dark:border-zinc-800 dark:bg-zinc-900/40">
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-600 dark:text-zinc-400">
              Start date
              <span className="flex items-center gap-1.5">
                <input
                  type="date"
                  value={startFrom}
                  onChange={(e) => setStartFrom(e.target.value)}
                  className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs font-medium text-zinc-800 outline-none focus:border-orange-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
                />
                <span className="text-[11px] text-zinc-500">to</span>
                <input
                  type="date"
                  value={startTo}
                  onChange={(e) => setStartTo(e.target.value)}
                  className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs font-medium text-zinc-800 outline-none focus:border-orange-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
                />
              </span>
            </label>
            <label className="flex flex-col gap-1 text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-600 dark:text-zinc-400">
              Due date
              <span className="flex items-center gap-1.5">
                <input
                  type="date"
                  value={dueFrom}
                  onChange={(e) => setDueFrom(e.target.value)}
                  className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs font-medium text-zinc-800 outline-none focus:border-orange-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
                />
                <span className="text-[11px] text-zinc-500">to</span>
                <input
                  type="date"
                  value={dueTo}
                  onChange={(e) => setDueTo(e.target.value)}
                  className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs font-medium text-zinc-800 outline-none focus:border-orange-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
                />
              </span>
            </label>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <p className="text-[11px] text-zinc-600 dark:text-zinc-400">
              {scheduledCount} scheduled{filtersActive ? ` · filtered to ${entries.length}` : ""}
            </p>
            {filtersActive ? (
              <button
                type="button"
                onClick={clearFilters}
                className="rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Clear filters
              </button>
            ) : null}
          </div>
        </div>

        {error ? (
          <p className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-800 dark:text-rose-200">
            {error}
          </p>
        ) : rows === null ? (
          <p className="py-10 text-center text-xs text-zinc-500 dark:text-zinc-400">Loading calendar…</p>
        ) : (
          <>
            <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
              <div className="grid grid-cols-7 border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/60">
                {WEEKDAY_LABELS.map((label) => (
                  <div
                    key={label}
                    className="py-1.5 text-center text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400"
                  >
                    {label}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7">
                {Array.from({ length: 42 }, (_, i) => {
                  const dayNum = i - firstDayOffset + 1;
                  const inMonth = dayNum >= 1 && dayNum <= daysInMonth;
                  const dayYmd = inMonth ? dateInputLabel(year, month, dayNum) : "";
                  const dayTasks = dayYmd ? (tasksByTargetDay.get(dayYmd) ?? []) : [];
                  const dayStarts = dayYmd ? (startsByDay.get(dayYmd) ?? []) : [];
                  const isToday = dayYmd === nowYmd;
                  const showMore = dayTasks.length > 4;
                  const visible = dayTasks.slice(0, 4);
                  return (
                    <div
                      key={i}
                      className={cn(
                        "min-h-20 border-b border-r border-zinc-200 p-1 last:border-r-0 dark:border-zinc-800",
                        i >= 35 && "border-b-0",
                        !inMonth && "bg-zinc-50/70 dark:bg-zinc-900/40",
                      )}
                    >
                      <div className="mb-1 flex items-center justify-between">
                        <span
                          className={cn(
                            "flex size-5 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums",
                            isToday
                              ? "bg-orange-600 text-white"
                              : inMonth
                                ? "text-zinc-800 dark:text-zinc-200"
                                : "text-zinc-400 dark:text-zinc-600",
                          )}
                        >
                          {inMonth ? dayNum : ""}
                        </span>
                        {dayStarts.length > 0 ? (
                          <span
                            className="size-2 rounded-full border-2 border-sky-500"
                            title={`Starts today: ${dayStarts.map((e) => e.title).join(", ")}`}
                          />
                        ) : null}
                      </div>
                      <div className="space-y-1">
                        {visible.map((entry) => (
                          <Link
                            key={entry.id}
                            href={`/agent/tasks?task=${encodeURIComponent(entry.id)}`}
                            title={`${entry.title}${entry.assigneeName ? ` · ${entry.assigneeName}` : ""} · ${
                              entry.status === "DONE" ? "done" : entry.status === "DELAYED" ? "delayed" : "in progress"
                            }${entry.startYmd ? ` · starts ${entry.startYmd}` : ""}`}
                            className={cn(
                              "flex min-w-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold leading-tight transition",
                              STATUS_CHIP_CLASS[entry.status],
                            )}
                          >
                            <span className="truncate">{entry.title}</span>
                            {entry.frequencyLabel ? (
                              <span className="shrink-0 rounded-sm bg-black/25 px-1 text-[8px] font-bold">
                                {entry.frequencyLabel}
                              </span>
                            ) : null}
                          </Link>
                        ))}
                        {showMore ? (
                          <p
                            className="px-1 text-[10px] font-semibold text-zinc-500 dark:text-zinc-400"
                            title={dayTasks.map((e) => e.title).join(", ")}
                          >
                            +{dayTasks.length - 4} more
                          </p>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {unscheduled.length > 0 ? (
              <div>
                <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">
                  No target date — {unscheduled.length} task{unscheduled.length === 1 ? "" : "s"}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {unscheduled.map((entry) => (
                    <Link
                      key={entry.id}
                      href={`/agent/tasks?task=${encodeURIComponent(entry.id)}`}
                      className={cn(
                        "inline-flex max-w-full items-center gap-1 rounded px-2 py-1 text-[10px] font-semibold transition",
                        STATUS_CHIP_CLASS[entry.status],
                      )}
                    >
                      <span className="truncate">{entry.title}</span>
                    </Link>
                  ))}
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>
      <p className="mt-3 text-[11px] text-zinc-500 dark:text-zinc-500">
        Tasks are placed on their target date (custom target, due date, or current recurrence period end). A sky dot
        marks the start date where it differs. {cursorYmd} month shown.
      </p>
    </div>
  );
}
