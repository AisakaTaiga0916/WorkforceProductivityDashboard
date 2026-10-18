/** Maps Request-for-Payment procedural seats into the shared ApprovalStep contract. */

import type { ApprovalStep, ApprovalUi } from "@/components/ui/approval-stepper";
import {
  PAYMENT_APPROVAL_STEP_LABELS,
  assigneeIdForStep,
  paymentApprovalStepsFor,
  type PaymentApprovalMeta,
} from "@/modules/requests/request-for-payment-approval";

export type { ApprovalUi };

export function paymentApprovalUiSteps(args: {
  meta: PaymentApprovalMeta;
  agentNameById: (agentId: string | null) => string | null;
}): ApprovalStep[] {
  const { meta, agentNameById } = args;
  return paymentApprovalStepsFor(meta).map((step) => {
    const decidedAt = meta.completed[step] ?? null;
    const isCurrent = !decidedAt && meta.proceduralStep === step;
    return {
      id: step,
      label: PAYMENT_APPROVAL_STEP_LABELS[step],
      state: decidedAt ? "done" : isCurrent ? "current" : "upcoming",
      actorName: agentNameById(assigneeIdForStep(meta, step)),
      decidedAt,
    };
  });
}
