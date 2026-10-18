/** Server-side builder for the FTR approval chrome (permission ∧ eligibility). */

import type { Session } from "next-auth";
import type { ApprovalUi } from "@/components/ui/approval-stepper";
import {
  hasPermission,
  permissionSubjectFromSession,
} from "@/modules/platform/rbac/permissions";
import {
  canCompleteFundTransferApprovalStep,
  type FundTransferApprovalMeta,
} from "@/modules/requests/fund-transfer-approval";
import { fundTransferApprovalUiSteps } from "@/modules/requests/fund-transfer-ui";

export async function buildFundTransferApprovalUi(args: {
  meta: FundTransferApprovalMeta;
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
    canCompleteFundTransferApprovalStep({
      meta,
      actorAgentId: operatorAgentId,
      ticketAssignedAgentId,
    }).ok;
  return {
    steps: fundTransferApprovalUiSteps({ meta, agentNameById }),
    canAct,
  };
}
