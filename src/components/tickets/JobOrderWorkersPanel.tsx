"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, UserPlus, Users, X, CheckCircle2 } from "lucide-react";
import {
  CompanyUserSearchField,
  type CompanyUserOption,
} from "@/components/tickets/CompanyUserSearchField";
import { parseJobOrderWorkerAgentIds, type JobOrderApprovalMeta } from "@/lib/job-order-approval";
import { JOB_ORDER_EXECUTION_TEAM_SECTION_ID } from "@/lib/job-order-section-ids";

type AgentOption = CompanyUserOption;

export function JobOrderWorkersPanel({
  ticketId,
  ticketStatus,
  jobOrderApprovalMeta,
  assigneeAgentId,
  assigneeName,
  approvalsComplete = true,
  canAssignExecutionAssignee = false,
  canManageCoWorkers = false,
  canMarkJobDone = false,
  jobDoneRecorded = false,
}: {
  ticketId: string;
  ticketStatus: string;
  jobOrderApprovalMeta: JobOrderApprovalMeta;
  assigneeAgentId: string | null;
  assigneeName: string | null;
  /** False while remaining approval seats are still open. */
  approvalsComplete?: boolean;
  /** Admin / coordinator — set execution assignee before co-workers. */
  canAssignExecutionAssignee?: boolean;
  /** Assignee (or Admin) — add co-workers after assignee is set. */
  canManageCoWorkers?: boolean;
  /** Execution / assistance team (or Admin) — send Job Order for customer confirmation. */
  canMarkJobDone?: boolean;
  /** Job Done already stamped; waiting on final Approved By. */
  jobDoneRecorded?: boolean;
}) {
  const router = useRouter();
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(true);
  const [workerIds, setWorkerIds] = useState<string[]>(() =>
    parseJobOrderWorkerAgentIds(jobOrderApprovalMeta),
  );
  const [pickerId, setPickerId] = useState("");
  const [assigneePickerId, setAssigneePickerId] = useState("");
  const [busy, setBusy] = useState(false);
  const [assigneeBusy, setAssigneeBusy] = useState(false);
  const [jobDoneBusy, setJobDoneBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const hasExecutionAssignee = Boolean(assigneeAgentId?.trim());
  const isAwaitingConfirmation =
    ticketStatus === "FOR_CONFIRMATION" ||
    ticketStatus === "RESOLVED" ||
    ticketStatus === "CLOSED";

  useEffect(() => {
    setWorkerIds(parseJobOrderWorkerAgentIds(jobOrderApprovalMeta));
  }, [jobOrderApprovalMeta]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingAgents(true);
      try {
        const res = await fetch("/api/agents", { cache: "no-store" });
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
  }, []);

  const agentById = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);
  const selectedWorkers = workerIds
    .map((id) => agentById.get(id))
    .filter((a): a is AgentOption => Boolean(a));

  const excludedIds = useMemo(() => {
    const ids = new Set(workerIds);
    if (assigneeAgentId) ids.add(assigneeAgentId);
    return ids;
  }, [workerIds, assigneeAgentId]);

  const addWorker = useCallback((agentId: string) => {
    const id = agentId.trim();
    if (!id || id === assigneeAgentId) return;
    setWorkerIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setPickerId("");
    setSaved(false);
  }, [assigneeAgentId]);

  function removeWorker(agentId: string) {
    setWorkerIds((prev) => prev.filter((id) => id !== agentId));
    setSaved(false);
  }

  async function saveWorkers() {
    if (!hasExecutionAssignee) {
      setError("Assign an execution assignee before adding co-workers.");
      return;
    }
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/tickets/${ticketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "set_job_order_workers",
          workerAgentIds: workerIds,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        jobOrderApprovalMeta?: JobOrderApprovalMeta;
      };
      if (!res.ok) {
        throw new Error(data.error ?? "Could not save co-workers.");
      }
      if (data.jobOrderApprovalMeta) {
        setWorkerIds(parseJobOrderWorkerAgentIds(data.jobOrderApprovalMeta));
      }
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save co-workers.");
    } finally {
      setBusy(false);
    }
  }

  async function saveExecutionAssignee() {
    if (!assigneePickerId.trim()) {
      setError("Select personnel to assign.");
      return;
    }
    setAssigneeBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/tickets/${ticketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "set_job_order_execution_assignee",
          executionAssigneeAgentId: assigneePickerId,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error ?? "Could not assign execution assignee.");
      }
      setAssigneePickerId("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not assign execution assignee.");
    } finally {
      setAssigneeBusy(false);
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

  const dirty =
    JSON.stringify([...workerIds].sort()) !==
    JSON.stringify(parseJobOrderWorkerAgentIds(jobOrderApprovalMeta).sort());

  return (
    <div
      id={JOB_ORDER_EXECUTION_TEAM_SECTION_ID}
      className="scroll-mt-24 rounded-xl border border-emerald-400/35 bg-emerald-500/[0.07] p-3 sm:p-4 dark:border-emerald-500/30 dark:bg-emerald-500/10 jo-job-order-section"
    >
      <div className="space-y-1">
        <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-emerald-900 dark:text-emerald-200">
          <Users className="size-3.5" aria-hidden />
          Execution team
        </p>
        <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
          {approvalsComplete
            ? "Approvals are complete. Assign the execution assignee on the Assignment Board or below, then add co-workers who will work on this Job Order."
            : "Opened after Noted By and Approved By (when those seats apply). Stage the execution assignee and Task Board link now — the assignee is applied to the Request Board when remaining approvals finish."}
        </p>
      </div>

      <div className="mt-3 space-y-3">
        <div className="rounded-lg border border-zinc-200 bg-white/70 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950/50">
          <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">Assignee</p>
          {hasExecutionAssignee ? (
            <p className="mt-0.5 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {assigneeName?.trim() || "Assigned"}
            </p>
          ) : (
            <p className="mt-0.5 text-sm font-medium text-amber-800 dark:text-amber-200">
              Not assigned yet — choose personnel below.
            </p>
          )}
          {canAssignExecutionAssignee ? (
            <div className="mt-2 space-y-2">
              {hasExecutionAssignee ? (
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  To change the execution assignee, select personnel below.
                </p>
              ) : null}
              {loadingAgents ? (
                <p className="text-xs text-zinc-500">Loading company users…</p>
              ) : (
                <CompanyUserSearchField
                  label={hasExecutionAssignee ? "Change execution assignee" : "Execution assignee"}
                  users={agents}
                  value={assigneePickerId}
                  onChange={setAssigneePickerId}
                  disabled={assigneeBusy}
                  placeholder="Search personnel to assign…"
                  required
                  emptyMessage="No matching personnel."
                  excludedIds={
                    hasExecutionAssignee && assigneeAgentId
                      ? new Set([assigneeAgentId])
                      : undefined
                  }
                />
              )}
              <button
                type="button"
                disabled={assigneeBusy || !assigneePickerId.trim()}
                onClick={() => void saveExecutionAssignee()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {assigneeBusy ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                ) : (
                  <UserPlus className="size-3.5" aria-hidden />
                )}
                {hasExecutionAssignee ? "Update execution assignee" : "Assign execution assignee"}
              </button>
            </div>
          ) : null}
        </div>

        <div className="space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-600 dark:text-zinc-500">
            Co-workers
          </p>
          {!hasExecutionAssignee ? (
            <p className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-100">
              Assign the execution assignee first before listing co-workers.
            </p>
          ) : null}
          {selectedWorkers.length > 0 ? (
            <ul className="flex flex-wrap gap-1.5">
              {selectedWorkers.map((agent) => (
                <li
                  key={agent.id}
                  className="inline-flex items-center gap-1 rounded-full border border-zinc-300 bg-white px-2.5 py-1 text-xs font-medium text-zinc-800 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
                >
                  <span>{agent.name}</span>
                  {canManageCoWorkers ? (
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
            <p className="text-xs text-zinc-500">No co-workers listed yet.</p>
          )}

          {canManageCoWorkers && hasExecutionAssignee ? (
            <div className="space-y-2">
              {loadingAgents ? (
                <p className="text-xs text-zinc-500">Loading company users…</p>
              ) : (
                <CompanyUserSearchField
                  label="Add co-worker"
                  users={agents}
                  value={pickerId}
                  onChange={(id) => {
                    setPickerId(id);
                    addWorker(id);
                  }}
                  disabled={busy}
                  placeholder="Search personnel to add…"
                  excludedIds={excludedIds}
                  emptyMessage="No matching personnel."
                />
              )}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={busy || !dirty}
                  onClick={() => void saveWorkers()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  {busy ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  ) : (
                    <UserPlus className="size-3.5" aria-hidden />
                  )}
                  Save co-workers
                </button>
                {saved && !dirty ? (
                  <span className="text-xs font-medium text-emerald-700 dark:text-emerald-300">
                    Saved
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>

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
                When execution work is finished, mark Job Done. The final Approved By then sends
                this request for confirmation
                {!approvalsComplete
                  ? " (available once the execution workspace is unlocked — remaining approvals can continue)"
                  : ""}
                .
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
