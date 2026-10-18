/** Maps Item Requisition Slip procedural seats into the shared ApprovalStep contract. */

import type { ApprovalStep } from "@/components/ui/approval-stepper";
import {
  ITEM_REQUISITION_APPROVAL_STEPS,
  ITEM_REQUISITION_APPROVAL_STEP_LABELS,
  itemRequisitionAssigneeIdForStep,
  type ItemRequisitionApprovalMeta,
} from "@/modules/requests/item-requisition-approval";

export function itemRequisitionApprovalUiSteps(args: {
  meta: ItemRequisitionApprovalMeta;
  agentNameById: (agentId: string | null) => string | null;
}): ApprovalStep[] {
  const { meta, agentNameById } = args;
  return ITEM_REQUISITION_APPROVAL_STEPS.map((step) => {
    const decidedAt = meta.completed[step] ?? null;
    const isCurrent = !decidedAt && meta.proceduralStep === step;
    return {
      id: step,
      label: ITEM_REQUISITION_APPROVAL_STEP_LABELS[step],
      state: decidedAt ? "done" : isCurrent ? "current" : "upcoming",
      actorName: agentNameById(itemRequisitionAssigneeIdForStep(meta, step)),
      decidedAt,
    };
  });
}
