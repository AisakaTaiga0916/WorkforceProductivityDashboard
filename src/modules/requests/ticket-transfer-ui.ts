/** Maps the pending-transfer decision moment into the shared ApprovalStep contract.
 * Note: transfer approve/return does not accept a comment; the note is fixed server-side.
 */

import type { ApprovalStep } from "@/components/ui/approval-stepper";

export function transferApprovalUiSteps(args: {
  fromAgentName?: string | null;
  recipientAgentName?: string | null;
}): ApprovalStep[] {
  const { fromAgentName = null, recipientAgentName = null } = args;
  return [
    {
      id: "REQUESTED",
      label: "TRANSFER REQUESTED",
      state: "done",
      actorName: fromAgentName,
      decidedAt: null,
    },
    {
      id: "REASSIGNED",
      label: "REASSIGNED",
      state: "current",
      actorName: recipientAgentName,
      decidedAt: null,
    },
  ];
}
