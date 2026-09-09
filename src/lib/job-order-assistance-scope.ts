/**
 * Detect when Job Order execution assignee is outside Send-to department scope.
 */
import type { JobOrderApprovalMeta } from "@/lib/job-order-approval";

export function resolveJobOrderExecutionAssigneeId(opts: {
  meta: JobOrderApprovalMeta | null | undefined;
  ticketAssignedAgentId?: string | null;
  greenLit?: boolean;
}): string | null {
  const pending = opts.meta?.pendingExecutionAssigneeAgentId?.trim() || null;
  const live = opts.ticketAssignedAgentId?.trim() || null;
  if (opts.greenLit) return live || pending;
  return pending || live;
}

/**
 * True when an execution assignee is set and is not in the send-to department roster.
 * Company-only send-to (no section) never forces Assistance Team via this helper.
 */
export function isJobOrderExecutionOutsideSendToDepartment(opts: {
  executionAssigneeAgentId: string | null | undefined;
  sendToOrgChartSectionId: string | null | undefined;
  sendToSectionAgentIds: ReadonlySet<string> | readonly string[];
}): boolean {
  const execId = opts.executionAssigneeAgentId?.trim() || null;
  const sectionId = opts.sendToOrgChartSectionId?.trim() || null;
  if (!execId || !sectionId) return false;
  const allowed =
    opts.sendToSectionAgentIds instanceof Set
      ? opts.sendToSectionAgentIds
      : new Set(opts.sendToSectionAgentIds);
  if (allowed.size === 0) return true;
  return !allowed.has(execId);
}
