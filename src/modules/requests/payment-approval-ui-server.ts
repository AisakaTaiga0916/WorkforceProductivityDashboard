/** Server-side builder for the RFP approval chrome (permission ∧ eligibility). */

import type { Session } from "next-auth";
import {
  hasPermission,
  permissionSubjectFromSession,
} from "@/modules/platform/rbac/permissions";
import {
  canCompletePaymentApprovalStep,
  type PaymentApprovalMeta,
} from "@/modules/requests/request-for-payment-approval";
import { paymentApprovalUiSteps, type ApprovalUi } from "@/modules/requests/payment-approval-ui";

export async function buildPaymentApprovalUi(args: {
  meta: PaymentApprovalMeta;
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
    canCompletePaymentApprovalStep({
      meta,
      actorAgentId: operatorAgentId,
      ticketAssignedAgentId,
    }).ok;
  return {
    steps: paymentApprovalUiSteps({ meta, agentNameById }),
    canAct,
  };
}
