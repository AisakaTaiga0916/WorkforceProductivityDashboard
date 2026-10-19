"use client";

import { isElevatedPlatformRole } from "@/lib/staff-role";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  Building2,
  Check,
  CheckCircle2,
  CheckSquare,
  CircleDot,
  ClipboardList,
  Kanban,
  Layers,
  LifeBuoy,
  Loader2,
  Pencil,
  PlusSquare,
  Ticket,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { COMPANY_CONTEXT_CHANGED_EVENT, CompanySwitcher } from "@/components/CompanySwitcher";

type SidebarSummary = {
  open: number;
  inProgress: number;
  forConfirmation: number;
  tasksCurrent: number;
  tasksDone: number;
  tasksDelayed: number;
  onDutyCount: number;
  onDutyPreview: Array<{ id: string; name: string; companyName: string }>;
  selfOnDuty: boolean | null;
  /** When false, Workforce → Activity is hidden — omit On Duty / Status block. */
  showActivity: boolean;
  companyDesignation: string | null;
  departmentDesignation: string | null;
};

type ShortcutDef = {
  id: string;
  href: string;
  label: string;
  icon: LucideIcon;
  adminOnly?: boolean;
  superAdminOnly?: boolean;
};

type Props = {
  className?: string;
  /** Tighter padding for mobile drawer */
  compact?: boolean;
};

const MAX_SHORTCUTS = 6;

/** Legacy shortcut ids remapped after catalog changes. */
const SHORTCUT_ID_ALIASES: Record<string, string> = {
  metrics: "request-mr",
  reports: "task-mr",
  assign: "a-board",
  requests: "r-board",
  // Legacy ids merged into the Workforce shortcut.
  people: "workforce",
  activities: "workforce",
};

const SHORTCUT_CATALOG: ShortcutDef[] = [
  { id: "create", href: "/tickets/new", label: "Create", icon: PlusSquare },
  { id: "a-board", href: "/admin/manual-assignment", label: "a.board", icon: Kanban, adminOnly: true },
  { id: "c-board", href: "/agent?board=company", label: "Group Board", icon: Building2, adminOnly: true },
  { id: "r-board", href: "/agent?board=ticket", label: "r.board", icon: Ticket },
  { id: "m-requests", href: "/agent?pane=mine", label: "m.requests", icon: UserRound },
  { id: "tasks", href: "/agent/tasks", label: "Tasks", icon: CheckSquare },
  { id: "workforce", href: "/admin/workforce", label: "Workforce", icon: Users, adminOnly: true },
  {
    id: "alerts",
    href: "/admin/superadmin-settings",
    label: "Settings",
    icon: LifeBuoy,
    superAdminOnly: true,
  },
  { id: "request-mr", href: "/insights?tab=ticket-metrics", label: "Req M&R", icon: BarChart3 },
  { id: "task-mr", href: "/insights?tab=task-metrics", label: "Task M&R", icon: ClipboardList },
];

const DEFAULT_ADMIN_IDS = [
  "create",
  "a-board",
  "c-board",
  "r-board",
  "request-mr",
  "task-mr",
] as const;
const DEFAULT_PERSONNEL_IDS = [
  "create",
  "r-board",
  "m-requests",
  "tasks",
  "request-mr",
  "task-mr",
] as const;

const EMPTY: SidebarSummary = {
  open: 0,
  inProgress: 0,
  forConfirmation: 0,
  tasksCurrent: 0,
  tasksDone: 0,
  tasksDelayed: 0,
  onDutyCount: 0,
  onDutyPreview: [],
  selfOnDuty: null,
  showActivity: true,
  companyDesignation: null,
  departmentDesignation: null,
};

function shortcutsStorageKey(email: string, role: string) {
  return `sidebar-shortcuts:${email.trim().toLowerCase() || "anon"}:${role}`;
}

function catalogForRole(isAdmin: boolean, isSuperAdmin: boolean): ShortcutDef[] {
  return SHORTCUT_CATALOG.filter((item) => {
    if (item.superAdminOnly) return isSuperAdmin;
    if (item.adminOnly) return isAdmin;
    return true;
  });
}

function defaultIds(isAdmin: boolean): string[] {
  return [...(isAdmin ? DEFAULT_ADMIN_IDS : DEFAULT_PERSONNEL_IDS)];
}

function normalizeIds(raw: unknown, isAdmin: boolean, isSuperAdmin: boolean): string[] {
  const allowed = new Set(catalogForRole(isAdmin, isSuperAdmin).map((item) => item.id));
  if (!Array.isArray(raw)) return defaultIds(isAdmin);
  const cleaned = raw
    .map((id) => (typeof id === "string" ? SHORTCUT_ID_ALIASES[id] ?? id : id))
    .filter((id): id is string => typeof id === "string" && allowed.has(id))
    .filter((id, index, arr) => arr.indexOf(id) === index)
    .slice(0, MAX_SHORTCUTS);
  return cleaned.length > 0 ? cleaned : defaultIds(isAdmin);
}

function readStoredIds(
  email: string,
  role: string,
  isAdmin: boolean,
  isSuperAdmin: boolean,
): string[] {
  if (typeof window === "undefined") return defaultIds(isAdmin);
  try {
    const raw = window.localStorage.getItem(shortcutsStorageKey(email, role));
    if (!raw) return defaultIds(isAdmin);
    return normalizeIds(JSON.parse(raw) as unknown, isAdmin, isSuperAdmin);
  } catch {
    return defaultIds(isAdmin);
  }
}

function writeStoredIds(email: string, role: string, ids: string[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(shortcutsStorageKey(email, role), JSON.stringify(ids));
}

export function SidebarOpsWidget({ className, compact = false }: Props) {
  const { data: session } = useSession();
  const role = session?.user?.role ?? "Personnel";
  const email = session?.user?.email ?? "";
  const isAdmin = isElevatedPlatformRole(role) || role === "Admin";
  const isSuperAdmin = role === "SuperAdmin";
  const [data, setData] = useState<SidebarSummary | null>(null);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>(() => defaultIds(isAdmin));

  const available = useMemo(
    () => catalogForRole(isAdmin, isSuperAdmin),
    [isAdmin, isSuperAdmin],
  );
  const availableById = useMemo(() => new Map(available.map((item) => [item.id, item])), [available]);

  useEffect(() => {
    queueMicrotask(() => {
      setSelectedIds(readStoredIds(email, role, isAdmin, isSuperAdmin));
      setEditing(false);
    });
  }, [email, role, isAdmin, isSuperAdmin]);

  useEffect(() => {
    let stopped = false;

    async function refresh() {
      try {
        const res = await fetch("/api/dashboard/sidebar-summary", { cache: "no-store" });
        if (!res.ok) throw new Error("failed");
        const payload = (await res.json()) as SidebarSummary;
        if (stopped) return;
        setData({
          open: Math.max(0, Number(payload.open) || 0),
          inProgress: Math.max(0, Number(payload.inProgress) || 0),
          forConfirmation: Math.max(0, Number(payload.forConfirmation) || 0),
          tasksCurrent: Math.max(0, Number(payload.tasksCurrent) || 0),
          tasksDone: Math.max(0, Number(payload.tasksDone) || 0),
          tasksDelayed: Math.max(0, Number(payload.tasksDelayed) || 0),
          onDutyCount: Math.max(0, Number(payload.onDutyCount) || 0),
          onDutyPreview: Array.isArray(payload.onDutyPreview) ? payload.onDutyPreview.slice(0, 2) : [],
          selfOnDuty:
            typeof payload.selfOnDuty === "boolean" ? payload.selfOnDuty : null,
          showActivity: payload.showActivity !== false,
          companyDesignation:
            typeof payload.companyDesignation === "string" && payload.companyDesignation.trim()
              ? payload.companyDesignation.trim()
              : null,
          departmentDesignation:
            typeof payload.departmentDesignation === "string" &&
            payload.departmentDesignation.trim()
              ? payload.departmentDesignation.trim()
              : null,
        });
        setFailed(false);
      } catch {
        if (!stopped) setFailed(true);
      }
    }

    void refresh();
    const timer = window.setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void refresh();
    }, 60_000);
    const onVisibilityChanged = () => void refresh();
    window.addEventListener("workforce-view-visibility-changed", onVisibilityChanged);
    window.addEventListener(COMPANY_CONTEXT_CHANGED_EVENT, onVisibilityChanged);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      window.removeEventListener("workforce-view-visibility-changed", onVisibilityChanged);
      window.removeEventListener(COMPANY_CONTEXT_CHANGED_EVENT, onVisibilityChanged);
    };
  }, []);

  const shortcuts = useMemo(
    () => selectedIds.map((id) => availableById.get(id)).filter((item): item is ShortcutDef => Boolean(item)),
    [selectedIds, availableById],
  );

  const toggleShortcut = useCallback(
    (id: string) => {
      setSelectedIds((prev) => {
        if (prev.includes(id)) {
          if (prev.length <= 1) return prev;
          return prev.filter((item) => item !== id);
        }
        if (prev.length >= MAX_SHORTCUTS) return prev;
        return [...prev, id];
      });
    },
    [],
  );

  function saveEdits() {
    const next = normalizeIds(selectedIds, isAdmin, isSuperAdmin);
    setSelectedIds(next);
    writeStoredIds(email, role, next);
    setEditing(false);
  }

  function resetDefaults() {
    const next = defaultIds(isAdmin);
    setSelectedIds(next);
    writeStoredIds(email, role, next);
  }

  const summary = data ?? EMPTY;
  const loading = data == null && !failed;

  return (
    <div
      className={cn(
        "shrink-0 border-t border-zinc-200/80 dark:border-zinc-800",
        compact ? "px-3 py-3" : "px-2.5 py-2.5",
        className,
      )}
    >
      <div className="rounded-xl border border-zinc-200 bg-white/80 p-2.5 dark:border-zinc-800 dark:bg-zinc-900/60">
        <div className="space-y-1.5 pb-2.5">
          <div className="flex min-w-0 items-start gap-2">
            <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-md bg-orange-500/10 text-orange-600 dark:bg-orange-500/15 dark:text-orange-300">
              <Building2 size={12} aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">
                Company
              </p>
              <CompanySwitcher fallbackLabel={summary.companyDesignation} />
            </div>
          </div>
          <div className="flex min-w-0 items-start gap-2">
            <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-md bg-sky-500/10 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300">
              <Layers size={12} aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">
                Team
              </p>
              <p
                className="mt-0.5 truncate text-[11px] font-semibold text-zinc-800 dark:text-zinc-100"
                title={summary.departmentDesignation ?? "Not set"}
              >
                {summary.departmentDesignation ?? "Not set"}
              </p>
            </div>
          </div>
        </div>

        <div className="border-t border-zinc-200/80 pt-2.5 dark:border-zinc-800">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">
              Requests
            </p>
            {loading ? <Loader2 size={12} className="animate-spin text-zinc-400" aria-hidden /> : null}
          </div>

          <div className="mt-2 grid grid-cols-3 gap-1.5">
            <QueueStat href="/agent?status=OPEN" label="Open" value={summary.open} tone="sky" />
            <QueueStat
              href="/agent?status=IN_PROGRESS"
              label="Active"
              value={summary.inProgress}
              tone="orange"
            />
            <QueueStat
              href="/agent?status=FOR_CONFIRMATION"
              label="Confirm"
              value={summary.forConfirmation}
              tone="emerald"
            />
          </div>
        </div>

        <div className="mt-2.5 border-t border-zinc-200/80 pt-2.5 dark:border-zinc-800">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">
              Tasks
            </p>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-1.5">
            <QueueStat
              href="/agent/tasks"
              label="Current"
              value={summary.tasksCurrent}
              tone="sky"
            />
            <QueueStat
              href="/agent/tasks"
              label="Done"
              value={summary.tasksDone}
              tone="orange"
            />
            <QueueStat
              href="/agent/tasks"
              label="Delayed"
              value={summary.tasksDelayed}
              tone="rose"
            />
          </div>
        </div>

        {summary.showActivity ? (
        <div className="mt-2.5 border-t border-zinc-200/80 pt-2.5 dark:border-zinc-800">
          {!isAdmin ? (
            <div className="flex items-center justify-between gap-2">
              <p className="shrink-0 text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">
                Status
              </p>
              {failed && data == null ? (
                <p className="min-w-0 text-right text-[11px] text-zinc-500 dark:text-zinc-400">Unavailable</p>
              ) : (
                <p
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold",
                    summary.selfOnDuty
                      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                      : "bg-zinc-100 text-zinc-600 dark:bg-zinc-950 dark:text-zinc-300",
                  )}
                >
                  <span
                    className={cn(
                      "inline-flex size-1.5 shrink-0 rounded-full",
                      summary.selfOnDuty ? "bg-emerald-500" : "bg-zinc-400",
                    )}
                    aria-hidden
                  />
                  {summary.selfOnDuty ? "On duty" : "Off duty"}
                </p>
              )}
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <p className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">
                  <Users size={11} aria-hidden />
                  On duty
                </p>
                <span className="rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-emerald-700 dark:text-emerald-300">
                  {summary.onDutyCount}
                </span>
              </div>

              {failed && data == null ? (
                <p className="mt-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">Couldn’t load live status.</p>
              ) : summary.onDutyPreview.length === 0 ? (
                <p className="mt-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">No one clocked in yet.</p>
              ) : (
                <ul className="mt-1.5 space-y-1">
                  {summary.onDutyPreview.map((person) => (
                    <li key={person.id} className="flex min-w-0 items-center gap-2">
                      <span className="inline-flex size-1.5 shrink-0 rounded-full bg-emerald-500" aria-hidden />
                      <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-zinc-800 dark:text-zinc-200">
                        {person.name}
                      </span>
                    </li>
                  ))}
                  {summary.onDutyCount > summary.onDutyPreview.length ? (
                    <li>
                      <Link
                        href="/admin/workforce?view=activity"
                        className="text-[10px] font-semibold text-orange-700 hover:underline dark:text-orange-300"
                      >
                        +{summary.onDutyCount - summary.onDutyPreview.length} more
                      </Link>
                    </li>
                  ) : null}
                </ul>
              )}
            </>
          )}
        </div>
        ) : null}

        <div className="mt-2.5 border-t border-zinc-200/80 pt-2.5 dark:border-zinc-800">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">
              Shortcuts
            </p>
            {editing ? (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={resetDefaults}
                  className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                >
                  Reset
                </button>
                <button
                  type="button"
                  onClick={saveEdits}
                  className="inline-flex items-center gap-1 rounded-md bg-orange-600 px-1.5 py-0.5 text-[10px] font-bold text-white transition hover:bg-orange-500"
                >
                  <Check size={10} aria-hidden />
                  Done
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="inline-flex items-center gap-1 rounded-md border border-zinc-300 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-600 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                title="Edit shortcuts"
              >
                <Pencil size={10} aria-hidden />
                Edit
              </button>
            )}
          </div>

          {editing ? (
            <>
              <p className="mt-1 text-[10px] text-zinc-500 dark:text-zinc-500">
                Pick up to {MAX_SHORTCUTS} · {selectedIds.length}/{MAX_SHORTCUTS} selected
              </p>
              <div className="mt-2 grid grid-cols-3 gap-1.5">
                {available.map((item) => {
                  const Icon = item.icon;
                  const selected = selectedIds.includes(item.id);
                  const atLimit = selectedIds.length >= MAX_SHORTCUTS && !selected;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => toggleShortcut(item.id)}
                      disabled={atLimit}
                      className={cn(
                        "relative flex min-w-0 flex-col items-center gap-1 rounded-lg border px-1 py-2 text-center transition",
                        selected
                          ? "border-orange-500/50 bg-orange-500/15 dark:border-orange-400/40 dark:bg-orange-500/15"
                          : "border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950/70",
                        atLimit && "cursor-not-allowed opacity-40",
                      )}
                      title={item.label}
                    >
                      {selected ? (
                        <span className="absolute right-1 top-1 inline-flex size-3.5 items-center justify-center rounded-full bg-orange-600 text-white">
                          <Check size={8} strokeWidth={3} aria-hidden />
                        </span>
                      ) : null}
                      <Icon
                        size={14}
                        className={cn(
                          selected ? "text-orange-700 dark:text-orange-300" : "text-zinc-500 dark:text-zinc-400",
                        )}
                        aria-hidden
                      />
                      <span className="w-full text-center text-[8px] font-bold uppercase leading-tight tracking-wide text-zinc-700 dark:text-zinc-300 [overflow-wrap:anywhere]">
                        {item.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="mt-2 grid grid-cols-3 gap-1.5">
              {shortcuts.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.id}
                    href={item.href}
                    className="flex min-w-0 flex-col items-center gap-1 rounded-lg border border-zinc-200 bg-zinc-50 px-1 py-2 text-center transition hover:border-orange-400/40 hover:bg-orange-500/10 dark:border-zinc-700 dark:bg-zinc-950/70 dark:hover:border-orange-500/30 dark:hover:bg-orange-500/10"
                    title={item.label}
                  >
                    <Icon size={14} className="text-orange-600 dark:text-orange-300" aria-hidden />
                    <span className="w-full text-center text-[8px] font-bold uppercase leading-tight tracking-wide text-zinc-700 dark:text-zinc-300 [overflow-wrap:anywhere]">
                      {item.label}
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function QueueStat({
  href,
  label,
  value,
  tone,
}: {
  href: string;
  label: string;
  value: number;
  tone: "sky" | "orange" | "emerald" | "rose";
}) {
  const toneClass =
    tone === "sky"
      ? "text-sky-700 dark:text-sky-300"
      : tone === "orange"
        ? "text-orange-700 dark:text-orange-300"
        : tone === "rose"
          ? "text-rose-700 dark:text-rose-300"
          : "text-emerald-700 dark:text-emerald-300";
  const Icon = tone === "emerald" ? CheckCircle2 : CircleDot;

  return (
    <Link
      href={href}
      className="min-w-0 rounded-lg bg-zinc-50 px-1 py-2 text-center transition hover:bg-zinc-100 dark:bg-zinc-950/70 dark:hover:bg-zinc-950"
      title={
        tone === "emerald"
          ? `For confirmation: ${value}`
          : `${label}: ${value}`
      }
    >
      <Icon size={11} className={cn("mx-auto", toneClass)} aria-hidden />
      <p className={cn("mt-1 truncate text-[9px] font-bold uppercase tracking-wide", toneClass)}>
        {label}
      </p>
      <p className="mt-0.5 text-base font-bold tabular-nums leading-none text-zinc-900 dark:text-zinc-100">
        {value}
      </p>
    </Link>
  );
}
