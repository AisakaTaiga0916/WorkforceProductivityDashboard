/** Post-approval Job Order execution team — client-safe helpers (no DB). */

import {
  isJobOrderWorkerAgent,
  parseJobOrderWorkerAgentIds,
  type JobOrderApprovalMeta,
} from "@/lib/job-order-approval";

export function isJobOrderExecutionMember(opts: {
  agentId?: string | null | undefined;
  /** Any of these agent ids (e.g. all Agent rows for the session email). */
  agentIds?: string[] | null;
  meta: JobOrderApprovalMeta | null | undefined;
  ticketAssignedAgentId: string | null | undefined;
  linkedProjectAssigneeId?: string | null;
}): boolean {
  const ids = [
    ...(opts.agentId?.trim() ? [opts.agentId.trim()] : []),
    ...(opts.agentIds ?? []).map((id) => id.trim()).filter(Boolean),
  ];
  if (ids.length === 0) return false;
  const assignee =
    opts.ticketAssignedAgentId?.trim() || opts.linkedProjectAssigneeId?.trim() || null;
  for (const id of [...new Set(ids)]) {
    if (assignee === id) return true;
    if (isJobOrderWorkerAgent(id, opts.meta)) return true;
  }
  return false;
}

/** All agent ids that should receive KPI credit (assignee + listed co-workers). */
export function jobOrderKpiCreditAgentIds(opts: {
  meta: JobOrderApprovalMeta | null | undefined;
  ticketAssignedAgentId: string | null | undefined;
  linkedProjectAssigneeId?: string | null;
}): string[] {
  const ids = new Set<string>();
  const assignee =
    opts.ticketAssignedAgentId?.trim() || opts.linkedProjectAssigneeId?.trim() || null;
  if (assignee) ids.add(assignee);
  for (const id of parseJobOrderWorkerAgentIds(opts.meta)) ids.add(id);
  return [...ids];
}
