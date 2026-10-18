/** Maps the task completion-verification moment into the shared ApprovalStep contract. */

import type { ApprovalStep } from "@/components/ui/approval-stepper";

export function taskCompletionVerificationUiSteps(args: {
  submittedAt?: string | null;
  verifierName?: string | null;
  verifiedAt?: string | null;
  /** Verifier returned the submission; VERIFIED shows returned until it is re-submitted. */
  returned?: boolean;
}): ApprovalStep[] {
  const submittedAt = args.submittedAt ?? null;
  const verifiedAt = args.verifiedAt ?? null;
  const returned = args.returned === true && !verifiedAt;
  return [
    {
      id: "SUBMITTED",
      label: "SUBMITTED FOR VERIFICATION",
      state: "done",
      actorName: null,
      decidedAt: submittedAt,
    },
    {
      id: "VERIFIED",
      label: "VERIFIED",
      state: verifiedAt ? "done" : returned ? "returned" : "current",
      actorName: args.verifierName ?? null,
      decidedAt: verifiedAt,
    },
  ];
}
