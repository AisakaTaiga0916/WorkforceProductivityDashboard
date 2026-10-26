"use client";

import type { ProjectDto, ProjectItemDto } from "@/modules/projects/project-service";
import {
  PROJECT_STATUSES,
  PROJECT_STATUS_LABELS,
  type ProjectStatusValue,
} from "@/modules/projects/project-status";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { useWorkCreateDeepLink } from "@/lib/work-create-deep-link";
import { WORK_ACTION_ICON_CLASS, WorkTabActions } from "@/components/WorkTabActions";
import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarDays, FolderPlus, Plus, Trash2, X } from "lucide-react";

type CompanyOption = { id: string; name: string };
type BoardPayload = { projects: ProjectDto[]; companies: CompanyOption[]; canCreate: boolean };

const LANE_STYLES: Record<ProjectStatusValue, string> = {
  PENDING: "border-zinc-200 dark:border-zinc-800",
  ON_GOING: "border-sky-200 dark:border-sky-900",
  FINALIZING: "border-amber-200 dark:border-amber-900",
  DONE: "border-emerald-200 dark:border-emerald-900",
};

const STATUS_BADGE: Record<ProjectStatusValue, string> = {
  PENDING: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  ON_GOING: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  FINALIZING: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  DONE: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
};

function todayYmd(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function isOverdue(dueDate: string | null, status: ProjectStatusValue): boolean {
  return Boolean(dueDate && status !== "DONE" && dueDate < todayYmd());
}

function progressOf(project: ProjectDto): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const phase of project.phases) {
    for (const item of phase.items) {
      total += 1;
      if (item.status === "DONE") done += 1;
    }
  }
  return { done, total };
}

function sortProjects(rows: ProjectDto[]): ProjectDto[] {
  const order = new Map(PROJECT_STATUSES.map((status, index) => [status, index]));
  return [...rows].sort((a, b) => {
    const byStatus = (order.get(a.status) ?? 0) - (order.get(b.status) ?? 0);
    if (byStatus !== 0) return byStatus;
    if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
    if (a.dueDate && !b.dueDate) return -1;
    if (!a.dueDate && b.dueDate) return 1;
    return b.createdAt.localeCompare(a.createdAt);
  });
}

function InlineText({
  value,
  onSave,
  className,
}: {
  value: string;
  onSave: (next: string) => void;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const cancelled = useRef(false);

  if (!editing) {
    return (
      <button
        type="button"
        title="Click to rename"
        onClick={() => {
          setDraft(value);
          cancelled.current = false;
          setEditing(true);
        }}
        className={cn(
          "min-w-0 truncate text-left font-medium text-zinc-800 hover:text-orange-700 dark:text-zinc-200 dark:hover:text-orange-300",
          className,
        )}
      >
        {value}
      </button>
    );
  }

  const commit = () => {
    if (cancelled.current) {
      cancelled.current = false;
      setEditing(false);
      return;
    }
    const next = draft.trim();
    setEditing(false);
    if (next && next !== value) onSave(next);
  };

  return (
    <input
      autoFocus
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          cancelled.current = true;
          event.currentTarget.blur();
        }
      }}
      className="min-w-0 flex-1 rounded border border-orange-300 bg-white px-1.5 py-0.5 text-sm font-medium text-zinc-900 outline-none dark:border-orange-700 dark:bg-zinc-900 dark:text-zinc-100"
    />
  );
}

function ProjectCard({ project, onOpen }: { project: ProjectDto; onOpen: () => void }) {
  const { done, total } = progressOf(project);
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  const overdue = isOverdue(project.dueDate, project.status);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full rounded-lg border border-zinc-200 bg-white p-3 text-left shadow-sm transition-colors hover:border-orange-300 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-orange-800"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 flex-1 text-sm font-semibold leading-snug text-zinc-900 dark:text-zinc-100">
          {project.title}
        </p>
        {overdue ? (
          <span className="shrink-0 rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-700 dark:bg-rose-950 dark:text-rose-300">
            Late
          </span>
        ) : null}
      </div>
      <p className="mt-1 truncate text-[11px] text-zinc-500 dark:text-zinc-400">
        {[project.companyName, project.leadAgentName].filter(Boolean).join(" · ") || "Unassigned"}
      </p>
      <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-zinc-500 dark:text-zinc-400">
        <span className={cn("inline-flex items-center gap-1", overdue && "font-semibold text-rose-600 dark:text-rose-400")}>
          <CalendarDays className="h-3.5 w-3.5" aria-hidden />
          {project.dueDate ?? "No target date"}
        </span>
        <span>
          {project.phases.length} phase{project.phases.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded bg-zinc-100 dark:bg-zinc-800">
        <div className="h-full rounded bg-orange-500" style={{ width: `${percent}%` }} />
      </div>
      <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
        {done}/{total} items done
      </p>
    </button>
  );
}

function NewProjectModal({
  companies,
  onClose,
  onCreated,
}: {
  companies: CompanyOption[];
  onClose: () => void;
  onCreated: (project: ProjectDto) => void;
}) {
  const [title, setTitle] = useState("");
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? "");
  const [dueDate, setDueDate] = useState("");
  const [firstPhaseName, setFirstPhaseName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: title.trim(),
        scopedCompanyTeamId: companyId || undefined,
        dueDate: dueDate || null,
        firstPhaseName: firstPhaseName.trim() || undefined,
      }),
    });
    const json = (await res.json().catch(() => null)) as
      | { project?: ProjectDto; error?: string }
      | null;
    setBusy(false);
    if (!res.ok || !json?.project) {
      setError(json?.error ?? "Could not create the project");
      return;
    }
    onCreated(json.project);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-label="Add project"
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-800 dark:bg-zinc-900"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Add Project</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <div className="mt-3 space-y-3">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-zinc-700 dark:text-zinc-300">Title</span>
            <input
              autoFocus
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={200}
              placeholder="Project title"
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-orange-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block font-medium text-zinc-700 dark:text-zinc-300">Company</span>
            <select
              value={companyId}
              onChange={(event) => setCompanyId(event.target.value)}
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-orange-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
            >
              {companies.length === 0 ? <option value="">No companies available</option> : null}
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-zinc-700 dark:text-zinc-300">Target date</span>
              <input
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
                className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-orange-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-zinc-700 dark:text-zinc-300">First phase</span>
              <input
                value={firstPhaseName}
                onChange={(event) => setFirstPhaseName(event.target.value)}
                maxLength={120}
                placeholder="Phase 1"
                className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-orange-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
              />
            </label>
          </div>

          {error ? <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p> : null}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void submit()} disabled={busy || !title.trim()}>
              {busy ? "Creating…" : "Create Project"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ItemRow({
  item,
  onPatch,
}: {
  item: ProjectItemDto;
  onPatch: (body: Record<string, unknown>) => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-2 py-1.5 dark:border-zinc-800 dark:bg-zinc-900">
      <select
        value={item.status}
        onChange={(event) => onPatch({ action: "setItemStatus", itemId: item.id, status: event.target.value })}
        className={cn(
          "shrink-0 rounded-full border-0 px-2 py-0.5 text-[11px] font-semibold outline-none",
          STATUS_BADGE[item.status],
        )}
        aria-label="Item status"
      >
        {PROJECT_STATUSES.map((status) => (
          <option key={status} value={status}>
            {PROJECT_STATUS_LABELS[status]}
          </option>
        ))}
      </select>
      <InlineText
        value={item.title}
        onSave={(next) => onPatch({ action: "renameItem", itemId: item.id, title: next })}
        className="flex-1 text-sm"
      />
      {item.assignedAgentName ? (
        <span className="hidden shrink-0 text-[11px] text-zinc-500 dark:text-zinc-400 sm:inline">
          {item.assignedAgentName}
        </span>
      ) : null}
      <input
        type="date"
        value={item.dueDate ?? ""}
        onChange={(event) =>
          onPatch({ action: "setItemDueDate", itemId: item.id, dueDate: event.target.value || null })
        }
        className="shrink-0 rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-[11px] text-zinc-700 outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300"
        aria-label="Item due date"
      />
      <button
        type="button"
        aria-label="Remove item"
        onClick={() => onPatch({ action: "removeItem", itemId: item.id })}
        className="shrink-0 rounded p-1 text-zinc-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950"
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden />
      </button>
    </div>
  );
}

function ProjectDetailModal({
  project,
  onClose,
  patchProject,
}: {
  project: ProjectDto;
  onClose: () => void;
  patchProject: (body: Record<string, unknown>) => Promise<boolean>;
}) {
  const [addItemDrafts, setAddItemDrafts] = useState<Record<string, string>>({});
  const [addPhaseName, setAddPhaseName] = useState("");

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-label={`Project: ${project.title}`}
        onClick={(event) => event.stopPropagation()}
        className="my-4 w-full max-w-3xl rounded-xl border border-zinc-200 bg-zinc-50 shadow-xl dark:border-zinc-800 dark:bg-zinc-950"
      >
        <div className="flex items-start justify-between gap-3 border-b border-zinc-200 p-4 dark:border-zinc-800">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{project.title}</h2>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              {[project.companyName, project.leadAgentName].filter(Boolean).join(" · ") || "Unassigned"}
              {project.originJobOrderTicketId ? ` · from Job Order ${project.originJobOrderTicketId}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <label className="flex items-center gap-2 text-sm">
            <span className="font-medium text-zinc-600 dark:text-zinc-400">Status</span>
            <select
              value={project.status}
              onChange={(event) => void patchProject({ action: "setStatus", status: event.target.value })}
              className={cn(
                "rounded-lg border-0 px-2.5 py-1 text-xs font-semibold outline-none",
                STATUS_BADGE[project.status],
              )}
            >
              {PROJECT_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {PROJECT_STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <span className="font-medium text-zinc-600 dark:text-zinc-400">Target date</span>
            <input
              type="date"
              value={project.dueDate ?? ""}
              onChange={(event) =>
                void patchProject({ action: "setDueDate", dueDate: event.target.value || null })
              }
              className="rounded-lg border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-700 outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
            />
          </label>
        </div>

        <div className="space-y-3 p-4">
          {project.phases.map((phase) => (
            <div
              key={phase.id}
              className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div className="flex flex-wrap items-center gap-2">
                <InlineText
                  value={phase.name}
                  onSave={(next) => void patchProject({ action: "renamePhase", phaseId: phase.id, name: next })}
                  className="text-sm font-semibold"
                />
                <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  {phase.items.filter((item) => item.status === "DONE").length}/{phase.items.length} done
                </span>
                <span className="ml-auto flex items-center gap-2">
                  <input
                    type="date"
                    value={phase.dueDate ?? ""}
                    onChange={(event) =>
                      void patchProject({
                        action: "setPhaseDueDate",
                        phaseId: phase.id,
                        dueDate: event.target.value || null,
                      })
                    }
                    className="rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-[11px] text-zinc-700 outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300"
                    aria-label="Phase due date"
                  />
                  <button
                    type="button"
                    aria-label="Remove phase"
                    disabled={project.phases.length <= 1}
                    onClick={() => void patchProject({ action: "removePhase", phaseId: phase.id })}
                    className="rounded p-1 text-zinc-400 hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-rose-950"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </span>
              </div>

              <div className="mt-2 space-y-1.5">
                {phase.items.map((item) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    onPatch={(body) => void patchProject(body)}
                  />
                ))}
              </div>

              <div className="mt-2 flex items-center gap-2">
                <input
                  value={addItemDrafts[phase.id] ?? ""}
                  onChange={(event) =>
                    setAddItemDrafts((prev) => ({ ...prev, [phase.id]: event.target.value }))
                  }
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    const title = (addItemDrafts[phase.id] ?? "").trim();
                    if (!title) return;
                    void patchProject({ action: "addItem", phaseId: phase.id, title }).then((ok) => {
                      if (ok) setAddItemDrafts((prev) => ({ ...prev, [phase.id]: "" }));
                    });
                  }}
                  placeholder="Add item and press Enter"
                  className="flex-1 rounded-lg border border-dashed border-zinc-300 bg-transparent px-2 py-1.5 text-sm text-zinc-800 outline-none focus:border-orange-400 dark:border-zinc-700 dark:text-zinc-200"
                />
                <button
                  type="button"
                  onClick={() => {
                    const title = (addItemDrafts[phase.id] ?? "").trim();
                    if (!title) return;
                    void patchProject({ action: "addItem", phaseId: phase.id, title }).then((ok) => {
                      if (ok) setAddItemDrafts((prev) => ({ ...prev, [phase.id]: "" }));
                    });
                  }}
                  className="rounded-lg border border-zinc-300 p-1.5 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  aria-label="Add item"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                </button>
              </div>
            </div>
          ))}

          <div className="flex items-center gap-2">
            <input
              value={addPhaseName}
              onChange={(event) => setAddPhaseName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                const name = addPhaseName.trim();
                if (!name) return;
                void patchProject({ action: "addPhase", name }).then((ok) => {
                  if (ok) setAddPhaseName("");
                });
              }}
              placeholder="Add phase and press Enter"
              className="flex-1 rounded-lg border border-dashed border-zinc-300 bg-transparent px-2 py-1.5 text-sm text-zinc-800 outline-none focus:border-orange-400 dark:border-zinc-700 dark:text-zinc-200"
            />
            <button
              type="button"
              onClick={() => {
                const name = addPhaseName.trim();
                if (!name) return;
                void patchProject({ action: "addPhase", name }).then((ok) => {
                  if (ok) setAddPhaseName("");
                });
              }}
              className="rounded-lg border border-zinc-300 p-1.5 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              aria-label="Add phase"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ProjectStatusBoard() {
  const [payload, setPayload] = useState<BoardPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      const res = await fetch("/api/projects", { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as
        | (BoardPayload & { error?: string })
        | null;
      if (!active) return;
      if (!res.ok || !json) {
        setError(json?.error ?? "Could not load projects");
        return;
      }
      setPayload({
        projects: sortProjects(json.projects ?? []),
        companies: json.companies ?? [],
        canCreate: Boolean(json.canCreate),
      });
    })();
    return () => {
      active = false;
    };
  }, []);

  const applyProject = useCallback((project: ProjectDto) => {
    setPayload((prev) => {
      if (!prev) return prev;
      const exists = prev.projects.some((row) => row.id === project.id);
      const projects = exists
        ? prev.projects.map((row) => (row.id === project.id ? project : row))
        : [...prev.projects, project];
      return { ...prev, projects: sortProjects(projects) };
    });
  }, []);

  const openCreate = useCallback(() => setCreateOpen(true), []);
  useWorkCreateDeepLink(Boolean(payload?.canCreate), openCreate);

  const patchProject = useCallback(
    async (id: string, body: Record<string, unknown>): Promise<boolean> => {
      setError(null);
      const res = await fetch(`/api/projects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => null)) as
        | { project?: ProjectDto; error?: string }
        | null;
      if (!res.ok || !json?.project) {
        setError(json?.error ?? "Update failed");
        return false;
      }
      applyProject(json.project);
      return true;
    },
    [applyProject],
  );

  const openProject = payload?.projects.find((row) => row.id === openId) ?? null;
  const projects = payload?.projects ?? [];

  return (
    <section className="min-w-0">
      {payload?.canCreate ? (
        <WorkTabActions>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className={WORK_ACTION_ICON_CLASS}
            aria-label="Add Project"
            title="Add Project"
          >
            <FolderPlus className="size-4" aria-hidden />
          </button>
        </WorkTabActions>
      ) : null}

      {error ? (
        <p className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
          {error}
        </p>
      ) : null}

      {payload === null && !error ? (
        <p className="py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">Loading projects…</p>
      ) : null}

      {payload !== null ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {PROJECT_STATUSES.map((status) => {
            const rows = projects.filter((project) => project.status === status);
            return (
              <section
                key={status}
                className={cn(
                  "rounded-xl border bg-white/70 p-3 dark:bg-zinc-950/40",
                  LANE_STYLES[status],
                )}
              >
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                    {PROJECT_STATUS_LABELS[status]}
                  </h2>
                  <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                    {rows.length}
                  </span>
                </div>
                <div className="space-y-2">
                  {rows.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-zinc-200 px-3 py-6 text-center text-[11px] text-zinc-400 dark:border-zinc-800 dark:text-zinc-500">
                      Nothing here
                    </p>
                  ) : (
                    rows.map((project) => (
                      <ProjectCard
                        key={project.id}
                        project={project}
                        onOpen={() => setOpenId(project.id)}
                      />
                    ))
                  )}
                </div>
              </section>
            );
          })}
        </div>
      ) : null}

      {createOpen && payload ? (
        <NewProjectModal
          companies={payload.companies}
          onClose={() => setCreateOpen(false)}
          onCreated={(project) => {
            applyProject(project);
            setCreateOpen(false);
            setOpenId(project.id);
          }}
        />
      ) : null}

      {openProject ? (
        <ProjectDetailModal
          project={openProject}
          onClose={() => setOpenId(null)}
          patchProject={(body) => patchProject(openProject.id, body)}
        />
      ) : null}
    </section>
  );
}
