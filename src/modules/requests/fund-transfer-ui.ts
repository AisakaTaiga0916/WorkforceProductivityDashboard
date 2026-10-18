/** Maps Fund Transfer Request procedural seats into the shared ApprovalStep contract. */

import type { ApprovalStep } from "@/components/ui/approval-stepper";
import {
  FUND_TRANSFER_APPROVAL_STEPS,
  FUND_TRANSFER_APPROVAL_STEP_LABELS,
  fundTransferAssigneeIdForStep,
  type FundTransferApprovalMeta,
} from "@/modules/requests/fund-transfer-approval";

/** Prepared By is intake-only (ticket header); the stepper shows procedural roles only. */
const FUND_TRANSFER_UI_STEPS = FUND_TRANSFER_APPROVAL_STEPS.filter(
  (step) => step !== "PREPARED_BY",
);

export function fundTransferApprovalUiSteps(args: {
  meta: FundTransferApprovalMeta;
  agentNameById: (agentId: string | null) => string | null;
}): ApprovalStep[] {
  const { meta, agentNameById } = args;
  return FUND_TRANSFER_UI_STEPS.map((step) => {
    const decidedAt = meta.completed[step] ?? null;
    const isCurrent = !decidedAt && meta.proceduralStep === step;
    return {
      id: step,
      label: FUND_TRANSFER_APPROVAL_STEP_LABELS[step],
      state: decidedAt ? "done" : isCurrent ? "current" : "upcoming",
      actorName: agentNameById(fundTransferAssigneeIdForStep(meta, step)),
      decidedAt,
    };
  });
}
