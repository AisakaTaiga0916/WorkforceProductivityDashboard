/** Maps Job Order procedural seats into the shared ApprovalStep contract. */

import type { ApprovalStep } from "@/components/ui/approval-stepper";
import {
  JOB_ORDER_APPROVAL_STEP_LABELS,
  jobOrderApprovalStepsFor,
  jobOrderAssigneeIdForStep,
  type JobOrderApprovalMeta,
} from "@/modules/requests/job-order-approval";

export function jobOrderApprovalUiSteps(args: {
  meta: JobOrderApprovalMeta;
  agentNameById: (agentId: string | null) => string | null;
}): ApprovalStep[] {
  const { meta, agentNameById } = args;
  return jobOrderApprovalStepsFor(meta).map((step) => {
    const decidedAt = meta.completed[step] ?? null;
    const isCurrent = !decidedAt && meta.proceduralStep === step;
    return {
      id: step,
      label: JOB_ORDER_APPROVAL_STEP_LABELS[step],
      state: decidedAt ? "done" : isCurrent ? "current" : "upcoming",
      actorName: agentNameById(jobOrderAssigneeIdForStep(meta, step)),
      decidedAt,
    };
  });
}
