/** Maps the Job Order execution phase into the shared ApprovalStep contract. */

import type { ApprovalStep } from "@/components/ui/approval-stepper";
import type { JobOrderApprovalMeta } from "@/modules/requests/job-order-approval";

export function jobOrderExecutionUiSteps(args: {
  meta: JobOrderApprovalMeta;
  executionAssigneeName?: string | null;
  ticketStatus?: string | null;
}): ApprovalStep[] {
  const { meta, executionAssigneeName = null, ticketStatus = null } = args;
  const jobDoneAt = meta.jobDoneAt?.trim() || null;
  return [
    {
      id: "EXECUTION",
      label: "EXECUTION",
      state: jobDoneAt ? "done" : "current",
      actorName: executionAssigneeName,
      decidedAt: jobDoneAt,
    },
    {
      id: "CONFIRMATION",
      label: "CONFIRMATION",
      state: ticketStatus === "FOR_CONFIRMATION" ? "current" : "upcoming",
      actorName: null,
      decidedAt: null,
    },
  ];
}
