"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Link2, PlusSquare } from "lucide-react";
import { JOB_ORDER_TASK_BOARD_SECTION_ID } from "@/modules/requests/job-order-section-ids";

type ProjectOption = {
  id: string;
  displayName: string;
  title: string;
  mainTask: string | null;
  itProjectName: string | null;
};

type LinkedProject = ProjectOption;

type Prefill = {
  ticketId: string;
  ticketNumber: string;
  teamId: string | null;
  alreadyLinkedProjectId: string | null;
  suggestedProjectName: string;
};

type CompanyAdmin = {
  id: string;
  name: string;
  email: string;
};

type ProjectRequest = {
  pending: boolean;
  targetAdminAgentId?: string | null;
  targetAdminAgentName?: string | null;
  requestedByAgentId?: string | null;
  requestedByAgentName?: string | null;
  note?: string | null;
};

export function JobOrderProjectLinkPanel({
  ticketId,
  canCreateProject,
  canRequestProject,
  sessionAgentId = null,
}: {
  ticketId: string;
  /** Admin / SuperAdmin / company coordinator — can open Task management create flow. */
  canCreateProject: boolean;
  /** Assigned Personnel — request an Admin to create the project. */
  canRequestProject: boolean;
  sessionAgentId?: string | null;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkedProject, setLinkedProject] = useState<LinkedProject | null>(null);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [prefill, setPrefill] = useState<Prefill | null>(null);
  const [companyAdmins, setCompanyAdmins] = useState<CompanyAdmin[]>([]);
  const [projectRequest, setProjectRequest] = useState<ProjectRequest>({ pending: false });
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [selectedAdminId, setSelectedAdminId] = useState("");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/tickets/${ticketId}/job-order-project?listProjects=1`, {
        cache: "no-store",
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        linkedProject?: LinkedProject | null;
        projects?: ProjectOption[];
        prefill?: Prefill;
        companyAdmins?: CompanyAdmin[];
        projectRequest?: ProjectRequest;
      };
      if (!res.ok) {
        setError(data.error ?? "Could not load task link options.");
        return;
      }
      setLinkedProject(data.linkedProject ?? null);
      setProjects(data.projects ?? []);
      setPrefill(data.prefill ?? null);
      setCompanyAdmins(data.companyAdmins ?? []);
      setProjectRequest(data.projectRequest ?? { pending: false });
      setSelectedId(data.linkedProject?.id ?? "");
      if (data.projectRequest?.pending && data.projectRequest.targetAdminAgentId) {
        setSelectedAdminId(data.projectRequest.targetAdminAgentId);
      }
    } catch {
      setError("Could not load task link options.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per ticket
  }, [ticketId]);

  const filteredProjects = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) => {
      const hay = `${p.displayName} ${p.title} ${p.mainTask ?? ""} ${p.itProjectName ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [projects, query]);

  const isTargetedAdmin =
    projectRequest.pending &&
    Boolean(
      sessionAgentId &&
        projectRequest.targetAdminAgentId &&
        sessionAgentId === projectRequest.targetAdminAgentId,
    );

  async function linkSelected() {
    if (!selectedId) {
      setError("Select a task to link.");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/tickets/${ticketId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "link_job_order_project", kpiMaintenanceId: selectedId }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      linkedProject?: LinkedProject | null;
    };
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Could not link task.");
      return;
    }
    setLinkedProject(data.linkedProject ?? null);
    setProjectRequest({ pending: false });
    router.refresh();
  }

  async function unlink() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/tickets/${ticketId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "unlink_job_order_project" }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Could not unlink task.");
      return;
    }
    setLinkedProject(null);
    setSelectedId("");
    router.refresh();
  }

  async function requestProject() {
    if (!selectedAdminId) {
      setError("Select a company Admin to create the task.");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/tickets/${ticketId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "request_job_order_project",
        targetAdminAgentId: selectedAdminId,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      projectRequest?: ProjectRequest;
    };
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Could not submit task request.");
      return;
    }
    setProjectRequest(data.projectRequest ?? { pending: true });
    router.refresh();
  }

  async function cancelRequest() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/tickets/${ticketId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "cancel_job_order_project_request" }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      projectRequest?: ProjectRequest;
    };
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Could not cancel request.");
      return;
    }
    setProjectRequest(data.projectRequest ?? { pending: false });
    setSelectedAdminId("");
    router.refresh();
  }

  const createHref = (() => {
    const params = new URLSearchParams();
    params.set("fromJobOrder", ticketId);
    if (prefill?.teamId) params.set("company", prefill.teamId);
    return `/agent/tasks?${params.toString()}`;
  })();

  return (
    <div
      id={JOB_ORDER_TASK_BOARD_SECTION_ID}
      className="scroll-mt-24 rounded-xl border border-orange-400/35 bg-orange-500/[0.07] p-3 sm:p-4 dark:border-orange-500/30 dark:bg-orange-500/10 jo-job-order-section"
    >
      <div className="space-y-1">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-orange-900 dark:text-orange-200">
          Link to a Task Board task
        </p>
        <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
          Approvals are complete. Create a new Task Board task from this Job Order, or link an
          existing project task.
        </p>
      </div>

      {loading ? (
        <p className="mt-3 text-xs text-zinc-500">Loading task options…</p>
      ) : linkedProject ? (
        <div className="mt-3 space-y-2">
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 dark:border-emerald-500/25">
            <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-800 dark:text-emerald-300">
              Linked task
            </p>
            <p className="mt-0.5 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {linkedProject.displayName}
            </p>
            {linkedProject.title &&
            linkedProject.title.trim().toLowerCase() !== linkedProject.displayName.trim().toLowerCase() ? (
              <p className="mt-0.5 text-xs text-zinc-500">{linkedProject.title}</p>
            ) : null}
            <Link
              href={`/agent/tasks?task=${encodeURIComponent(linkedProject.id)}${
                prefill?.teamId ? `&company=${encodeURIComponent(prefill.teamId)}` : ""
              }`}
              className="mt-2 inline-flex text-xs font-semibold text-orange-700 hover:underline dark:text-orange-300"
            >
              Open on Task Board
            </Link>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => void unlink()}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:border-rose-400/50 hover:text-rose-700 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
          >
            Unlink task
          </button>
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          {canCreateProject ? (
            <Link
              href={createHref}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-orange-600 px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-orange-500"
            >
              <PlusSquare className="size-4 shrink-0" aria-hidden />
              Create new task
            </Link>
          ) : null}

          {projectRequest.pending ? (
            <div
              className={`rounded-lg border px-3 py-2 ${
                isTargetedAdmin
                  ? "border-orange-400/50 bg-orange-500/15 dark:border-orange-400/40 dark:bg-orange-500/20"
                  : "border-zinc-200 bg-white/80 dark:border-zinc-700 dark:bg-zinc-950/50"
              }`}
            >
              <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">
                New task request pending
              </p>
              <p className="mt-0.5 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {isTargetedAdmin
                  ? `${projectRequest.requestedByAgentName?.trim() || "Personnel"} asked you to create a Task Board task for this Job Order.`
                  : `Requested from ${projectRequest.targetAdminAgentName?.trim() || "company Admin"}.`}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {isTargetedAdmin || canCreateProject ? (
                  <Link
                    href={createHref}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-orange-500"
                  >
                    <PlusSquare className="size-3.5" aria-hidden />
                    Create new task
                  </Link>
                ) : null}
                {canRequestProject || canCreateProject ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void cancelRequest()}
                    className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:border-rose-400/50 hover:text-rose-700 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
                  >
                    Cancel request
                  </button>
                ) : null}
              </div>
            </div>
          ) : canRequestProject && !canCreateProject ? (
            <div className="space-y-2 rounded-lg border border-zinc-200 bg-white/60 p-3 dark:border-zinc-700 dark:bg-zinc-950/40">
              <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-600 dark:text-zinc-500">
                Request a new task
              </p>
              <p className="text-xs text-zinc-500">
                Ask a company Admin to create and link a Task Board task from this Job Order.
              </p>
              <label className="block text-[10px] font-bold uppercase tracking-wide text-zinc-600 dark:text-zinc-500">
                Company Admin
                <select
                  value={selectedAdminId}
                  onChange={(e) => setSelectedAdminId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
                >
                  <option value="">Select Admin…</option>
                  {companyAdmins.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                      {a.email ? ` · ${a.email}` : ""}
                    </option>
                  ))}
                </select>
              </label>
              {companyAdmins.length === 0 ? (
                <p className="text-xs text-zinc-500">
                  No Admins found for this company. Ask a SuperAdmin to assign company Admins.
                </p>
              ) : null}
              <button
                type="button"
                disabled={busy || !selectedAdminId}
                onClick={() => void requestProject()}
                className="rounded-lg bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-500 disabled:opacity-50"
              >
                Request new task
              </button>
            </div>
          ) : null}

          <div className="space-y-2 border-t border-orange-400/20 pt-3 dark:border-orange-500/20">
            <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-zinc-600 dark:text-zinc-500">
              <Link2 className="size-3.5" aria-hidden />
              Or link an existing task
            </p>
            <label className="block text-[10px] font-bold uppercase tracking-wide text-zinc-600 dark:text-zinc-500">
              Search
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter by name…"
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
              />
            </label>
            <label className="block text-[10px] font-bold uppercase tracking-wide text-zinc-600 dark:text-zinc-500">
              Task
              <select
                value={selectedId}
                onChange={(e) => setSelectedId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
              >
                <option value="">Choose a task…</option>
                {filteredProjects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.displayName}
                    {p.title &&
                    p.title.trim().toLowerCase() !== p.displayName.trim().toLowerCase()
                      ? ` · ${p.title}`
                      : ""}
                  </option>
                ))}
              </select>
            </label>
            {filteredProjects.length === 0 ? (
              <p className="text-xs text-zinc-500">
                No matching Task Board projects for this company.
                {canCreateProject
                  ? " Use Create new task to start one."
                  : canRequestProject
                    ? " Request a company Admin to create one."
                    : ""}
              </p>
            ) : null}
            <button
              type="button"
              disabled={busy || !selectedId}
              onClick={() => void linkSelected()}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
            >
              Link selected task
            </button>
          </div>
        </div>
      )}

      {error ? (
        <p className="mt-2 rounded-lg border border-rose-400/40 bg-rose-500/10 px-2.5 py-1.5 text-xs text-rose-700 dark:text-rose-200">
          {error}
        </p>
      ) : null}
    </div>
  );
}
