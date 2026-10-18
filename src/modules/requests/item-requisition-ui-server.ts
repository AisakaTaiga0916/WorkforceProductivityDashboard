/** Server-side builder for the IRS approval chrome (permission ∧ eligibility). */

import type { Session } from "next-auth";
import type { ApprovalUi } from "@/components/ui/approval-stepper";
import {
  hasPermission,
  permissionSubjectFromSession,
} from "@/modules/platform/rbac/permissions";
import {
  canCompleteItemRequisitionApprovalStep,
  type ItemRequisitionApprovalMeta,
} from "@/modules/requests/item-requisition-approval";
import { itemRequisitionApprovalUiSteps } from "@/modules/requests/item-requisition-ui";

export async function buildItemRequisitionApprovalUi(args: {
  meta: ItemRequisitionApprovalMeta;
  agentNameById: (agentId: string | null) => string | null;
  session: Session;
  operatorAgentId: string | null;
  ticketAssignedAgentId: string | null;
}): Promise<ApprovalUi> {
  const { meta, agentNameById, session, operatorAgentId, ticketAssignedAgentId } = args;
  const permitted = await hasPermission(
    permissionSubjectFromSession(session),
    "requests.approve",
  );
  const canAct =
    permitted &&
    meta.proceduralStep === "APPROVED_BY" &&
    canCompleteItemRequisitionApprovalStep({
      meta,
      actorAgentId: operatorAgentId,
      ticketAssignedAgentId,
    }).ok;
  return {
    steps: itemRequisitionApprovalUiSteps({ meta, agentNameById }),
    canAct,
  };
}
