"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Handshake, Loader2, UserPlus, X } from "lucide-react";
import {
  CompanyUserSearchField,
  type CompanyUserOption,
} from "@/components/tickets/CompanyUserSearchField";
import {
  defaultJobOrderAssistanceTeam,
  type JobOrderApprovalMeta,
  type JobOrderAssistanceScopeMode,
  type JobOrderAssistanceTeam,
} from "@/lib/job-order-approval";
import { JOB_ORDER_ASSISTANCE_TEAM_SECTION_ID } from "@/lib/job-order-section-ids";

type AgentOption = CompanyUserOption;
type SectionOption = { id: string; name: string };
type TeamOption = { id: string; name: string };

function teamFromMeta(meta: JobOrderApprovalMeta): JobOrderAssistanceTeam {
  return meta.assistanceTeam ?? defaultJobOrderAssistanceTeam();
}

export function JobOrderAssistanceTeamPanel({
  ticketId,
  ticketStatus,
  jobOrderApprovalMeta,
  canManage = false,
  canMarkJobDone = false,
  jobDoneRecorded = false,
  sendToDepartmentName = null,
}: {
  ticketId: string;
  ticketStatus: string;
  jobOrderApprovalMeta: JobOrderApprovalMeta;
  canManage?: boolean;
  /** Assistance / execution team or Admin — send Job Order for customer confirmation. */
  canMarkJobDone?: boolean;
  /** Job Done already stamped; waiting on final Approved By. */
  jobDoneRecorded?: boolean;
  sendToDepartmentName?: string | null;
}) {
  const router = useRouter();
  const initial = teamFromMeta(jobOrderApprovalMeta);
  const [scopeMode, setScopeMode] = useState<JobOrderAssistanceScopeMode>(initial.scopeMode);
  const [orgChartSectionId, setOrgChartSectionId] = useState(initial.orgChartSectionId ?? "");
  const [companyTeamId, setCompanyTeamId] = useState(initial.companyTeamId ?? "");
  const [assigneeAgentId, setAssigneeAgentId] = useState(initial.assigneeAgentId ?? "");
  const [workerIds, setWorkerIds] = useState<string[]>(initial.workerAgentIds);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [sections, setSections] = useState<SectionOption[]>([]);
  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(false);
  const [loadingScopes, setLoadingScopes] = useState(true);
  const [pickerId, setPickerId] = useState("");
  const [busy, setBusy] = useState(false);
  const [jobDoneBusy, setJobDoneBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const isAwaitingConfirmation = ticketStatus === "FOR_CONFIRMATION";

  useEffect(() => {
    const next = teamFromMeta(jobOrderApprovalMeta);
    setScopeMode(next.scopeMode);
    setOrgChartSectionId(next.orgChartSectionId ?? "");
    setCompanyTeamId(next.companyTeamId ?? "");
    setAssigneeAgentId(next.assigneeAgentId ?? "");
    setWorkerIds(next.workerAgentIds);
  }, [jobOrderApprovalMeta]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingScopes(true);
      try {
        const [sectionsRes, teamsRes] = await Promise.all([
          fetch("/api/org-chart-sections", { cache: "no-store" }),
          fetch("/api/teams", { cache: "no-store" }),
        ]);
        const sectionsData = (await sectionsRes.json().catch(() => ({}))) as {
          sections?: Array<{ id: string; name: string }>;
        };
        const teamsData = (await teamsRes.json().catch(() => [])) as Array<{
          id: string;
          name: string;
        }>;
        if (cancelled) return;
        setSections(
          Array.isArray(sectionsData.sections)
            ? sectionsData.sections.map((s) => ({ id: s.id, name: s.name }))
            : [],
        );
        setTeams(
          Array.isArray(teamsData)
            ? teamsData.map((t) => ({ id: t.id, name: t.name }))
            : [],
        );
      } catch {
        if (!cancelled) {
          setSections([]);
          setTeams([]);
        }
      } finally {
        if (!cancelled) setLoadingScopes(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const agentsQuery = useMemo(() => {
    if (scopeMode === "department" && orgChartSectionId.trim()) {
      return `/api/agents?anyCompany=1&section=${encodeURIComponent(orgChartSectionId.trim())}`;
    }
    if (scopeMode === "company" && companyTeamId.trim()) {
      return `/api/agents?company=${encodeURIComponent(companyTeamId.trim())}`;
    }
    return null;
  }, [scopeMode, orgChartSectionId, companyTeamId]);

  useEffect(() => {
    let cancelled = false;
    if (!agentsQuery) {
      setAgents([]);
      setLoadingAgents(false);
      return;
    }
    (async () => {
      setLoadingAgents(true);
      try {
        const res = await fetch(agentsQuery, { cache: "no-store" });
        const data = (await res.json().catch(() => [])) as Array<{
          id: string;
          name: string;
          email?: string | null;
        }>;
        if (cancelled) return;
        if (!res.ok || !Array.isArray(data)) {
          setAgents([]);
          return;
        }
        setAgents(
          data.map((a) => ({
            id: a.id,
            name: a.name,
            email: a.email ?? null,
          })),
        );
      } catch {
        if (!cancelled) setAgents([]);
      } finally {
        if (!cancelled) setLoadingAgents(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agentsQuery]);

  const agentById = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);
  const selectedWorkers = workerIds
    .map((id) => agentById.get(id))
    .filter((a): a is AgentOption => Boolean(a));
  const assigneeName =
    (assigneeAgentId && agentById.get(assigneeAgentId)?.name) ||
    (assigneeAgentId ? "Assigned" : null);

  const excludedIds = useMemo(() => {
    const ids = new Set(workerIds);
    if (assigneeAgentId) ids.add(assigneeAgentId);
    return ids;
  }, [workerIds, assigneeAgentId]);

  const addWorker = useCallback(
    (agentId: string) => {
      const id = agentId.trim();
      if (!id || id === assigneeAgentId) return;
      setWorkerIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
      setPickerId("");
      setSaved(false);
    },
    [assigneeAgentId],
  );

  function removeWorker(agentId: string) {
    setWorkerIds((prev) => prev.filter((id) => id !== agentId));
    setSaved(false);
  }

  function setScope(next: JobOrderAssistanceScopeMode) {
    setScopeMode(next);
    setAssigneeAgentId("");
    setWorkerIds([]);
    setPickerId("");
    setSaved(false);
  }

  async function saveTeam() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/tickets/${ticketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "set_job_order_assistance_team",
          scopeMode,
          orgChartSectionId: scopeMode === "department" ? orgChartSectionId : null,
          companyTeamId: scopeMode === "company" ? companyTeamId : null,
          assigneeAgentId: assigneeAgentId || null,
          workerAgentIds: workerIds,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        jobOrderApprovalMeta?: JobOrderApprovalMeta;
      };
      if (!res.ok) {
        throw new Error(data.error ?? "Could not save assistance team.");
      }
      if (data.jobOrderApprovalMeta) {
        const next = teamFromMeta(data.jobOrderApprovalMeta);
        setScopeMode(next.scopeMode);
        setOrgChartSectionId(next.orgChartSectionId ?? "");
        setCompanyTeamId(next.companyTeamId ?? "");
        setAssigneeAgentId(next.assigneeAgentId ?? "");
        setWorkerIds(next.workerAgentIds);
      }
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save assistance team.");
    } finally {
      setBusy(false);
    }
  }

  async function markJobDone() {
    if (
      !window.confirm(
        "Mark this Job Order as Job Done? The final Approved By can then send it for customer confirmation.",
      )
    ) {
      return;
    }
    setJobDoneBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/tickets/${ticketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "complete_job_order_execution" }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error ?? "Could not mark Job Order done.");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not mark Job Order done.");
    } finally {
      setJobDoneBusy(false);
    }
  }

  const scopeReady =
    (scopeMode === "department" && Boolean(orgChartSectionId.trim())) ||
    (scopeMode === "company" && Boolean(companyTeamId.trim()));

  return (
    <div
      id={JOB_ORDER_ASSISTANCE_TEAM_SECTION_ID}
      className="scroll-mt-24 rounded-xl border border-sky-400/35 bg-sky-500/[0.07] p-3 sm:p-4 dark:border-sky-500/30 dark:bg-sky-500/10 jo-job-order-section"
    >
      <div className="space-y-1">
        <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-sky-900 dark:text-sky-200">
          <Handshake className="size-3.5" aria-hidden />
          Assistance team
        </p>
        <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
          {sendToDepartmentName
            ? `Send request to: ${sendToDepartmentName}. Stage helpers scoped by department or company when the execution assignee is outside this department — or prepare assistance ahead of time as the department head.`
            : "Stage helpers scoped by department or company when the execution assignee is outside Send request to (department)."}
        </p>
      </div>

      <div className="mt-3 space-y-3">
        <div className="rounded-lg border border-zinc-200 bg-white/70 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950/50">
          <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">Scope</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!canManage || busy}
              aria-pressed={scopeMode === "department"}
              onClick={() => setScope("department")}
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50 ${
                scopeMode === "department"
                  ? "border-sky-500 bg-sky-600 text-white"
                  : "border-zinc-300 bg-white text-zinc-700 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200"
              }`}
            >
              Department
            </button>
            <button
              type="button"
              disabled={!canManage || busy}
              aria-pressed={scopeMode === "company"}
              onClick={() => setScope("company")}
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50 ${
                scopeMode === "company"
                  ? "border-sky-500 bg-sky-600 text-white"
                  : "border-zinc-300 bg-white text-zinc-700 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200"
              }`}
            >
              Company
            </button>
          </div>
          {loadingScopes ? (
            <p className="mt-2 text-xs text-zinc-500">Loading scope options…</p>
          ) : scopeMode === "department" ? (
            <label className="mt-2 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
              Department
              <select
                value={orgChartSectionId}
                disabled={!canManage || busy}
                onChange={(e) => {
                  setOrgChartSectionId(e.target.value);
                  setAssigneeAgentId("");
                  setWorkerIds([]);
                  setSaved(false);
                }}
                className="mt-1 min-h-9 w-full rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
              >
                <option value="">Select department…</option>
                {sections.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label className="mt-2 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
              Company
              <select
                value={companyTeamId}
                disabled={!canManage || busy}
                onChange={(e) => {
                  setCompanyTeamId(e.target.value);
                  setAssigneeAgentId("");
                  setWorkerIds([]);
                  setSaved(false);
                }}
                className="mt-1 min-h-9 w-full rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
              >
                <option value="">Select company…</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        <div className="rounded-lg border border-zinc-200 bg-white/70 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950/50">
          <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">Assignee</p>
          {assigneeAgentId ? (
            <p className="mt-0.5 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {assigneeName}
            </p>
          ) : (
            <p className="mt-0.5 text-sm font-medium text-amber-800 dark:text-amber-200">
              Not assigned yet.
            </p>
          )}
          {canManage && scopeReady ? (
            <div className="mt-2">
              {loadingAgents ? (
                <p className="text-xs text-zinc-500">Loading scoped users…</p>
              ) : (
                <CompanyUserSearchField
                  label={assigneeAgentId ? "Change assistance assignee" : "Assistance assignee"}
                  users={agents}
                  value={assigneeAgentId}
                  onChange={(id) => {
                    setAssigneeAgentId(id);
                    setWorkerIds((prev) => prev.filter((wid) => wid !== id));
                    setSaved(false);
                  }}
                  disabled={busy}
                  placeholder="Search scoped personnel…"
                  emptyMessage="No matching personnel in this scope."
                />
              )}
            </div>
          ) : null}
        </div>

        <div className="space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-600 dark:text-zinc-500">
            Co-workers
          </p>
          {selectedWorkers.length > 0 ? (
            <ul className="flex flex-wrap gap-1.5">
              {selectedWorkers.map((agent) => (
                <li
                  key={agent.id}
                  className="inline-flex items-center gap-1 rounded-full border border-zinc-300 bg-white px-2.5 py-1 text-xs font-medium text-zinc-800 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
                >
                  <span>{agent.name}</span>
                  {canManage ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => removeWorker(agent.id)}
                      className="rounded-full p-0.5 text-zinc-500 hover:bg-zinc-100 hover:text-rose-600 dark:hover:bg-zinc-800"
                      aria-label={`Remove ${agent.name}`}
                    >
                      <X className="size-3" aria-hidden />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-zinc-500">No assistance co-workers listed yet.</p>
          )}

          {canManage && scopeReady && assigneeAgentId ? (
            <div className="space-y-2">
              {loadingAgents ? (
                <p className="text-xs text-zinc-500">Loading scoped users…</p>
              ) : (
                <CompanyUserSearchField
                  label="Add assistance co-worker"
                  users={agents}
                  value={pickerId}
                  onChange={(id) => {
                    setPickerId(id);
                    addWorker(id);
                  }}
                  disabled={busy}
                  placeholder="Search scoped personnel…"
                  excludedIds={excludedIds}
                  emptyMessage="No matching personnel in this scope."
                />
              )}
            </div>
          ) : null}
        </div>

        {canManage ? (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy || !scopeReady}
              onClick={() => void saveTeam()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : (
                <UserPlus className="size-3.5" aria-hidden />
              )}
              Save assistance team
            </button>
            {saved ? (
              <span className="text-xs font-medium text-sky-700 dark:text-sky-300">Saved</span>
            ) : null}
          </div>
        ) : null}

        <div className="rounded-lg border border-zinc-200 bg-white/70 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950/50">
          <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">
            Completion
          </p>
          {isAwaitingConfirmation ? (
            <p className="mt-1 text-xs font-medium text-emerald-800 dark:text-emerald-200">
              Sent for customer confirmation.
            </p>
          ) : jobDoneRecorded ? (
            <p className="mt-1 text-xs font-medium text-sky-800 dark:text-sky-200">
              Job Done recorded. Waiting on the final Approved By before customer confirmation.
            </p>
          ) : canMarkJobDone ? (
            <div className="mt-2">
              <p className="text-xs text-zinc-600 dark:text-zinc-400">
                When assistance work is finished, mark Job Done. The final Approved By then sends
                this request for confirmation.
              </p>
              <button
                type="button"
                disabled={jobDoneBusy}
                onClick={() => void markJobDone()}
                className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
              >
                {jobDoneBusy ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                ) : (
                  <CheckCircle2 className="size-3.5" aria-hidden />
                )}
                Job Done
              </button>
            </div>
          ) : (
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Only Admin, the execution team, or assistance team can mark this Job Order done.
            </p>
          )}
        </div>
      </div>

      {error ? (
        <p className="mt-2 rounded-lg border border-rose-400/40 bg-rose-500/10 px-2.5 py-1.5 text-xs text-rose-700 dark:text-rose-200">
          {error}
        </p>
      ) : null}
    </div>
  );
}
