/** Server-side builder for the JO approval chrome (permission ∧ eligibility). */

import type { Session } from "next-auth";
import type { ApprovalUi } from "@/components/ui/approval-stepper";
import {
  hasPermission,
  permissionSubjectFromSession,
} from "@/modules/platform/rbac/permissions";
import {
  canCompleteJobOrderApprovalStep,
  isJobOrderJobDone,
  type JobOrderApprovalMeta,
} from "@/modules/requests/job-order-approval";
import { jobOrderApprovalUiSteps } from "@/modules/requests/job-order-ui";

export async function buildJobOrderApprovalUi(args: {
  meta: JobOrderApprovalMeta;
  agentNameById: (agentId: string | null) => string | null;
  session: Session;
  operatorAgentId: string | null;
  ticketAssignedAgentId: string | null;
  /** Whether the ticket has at least one Job Output attachment (last Approver gate). */
  hasJobOutput: boolean;
}): Promise<ApprovalUi> {
  const { meta, agentNameById, session, operatorAgentId, ticketAssignedAgentId, hasJobOutput } =
    args;
  const permitted = await hasPermission(
    permissionSubjectFromSession(session),
    "requests.approve",
  );
  const canAct =
    permitted &&
    canCompleteJobOrderApprovalStep({
      meta,
      actorAgentId: operatorAgentId,
      ticketAssignedAgentId,
      hasJobOutput,
      hasJobDone: isJobOrderJobDone(meta),
    }).ok;
  return {
    steps: jobOrderApprovalUiSteps({ meta, agentNameById }),
    canAct,
  };
}
