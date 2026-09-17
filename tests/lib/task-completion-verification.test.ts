import { describe, expect, it } from "vitest";
import {
  applySubKpiSubmitForVerification,
  approveCompletionDbPatch,
  boardStatusAfterChecklistComplete,
  checklistCompletionDbPatch,
  COMPLETION_VERIFICATION,
  isCompletionEffectivelyVerified,
  isSubKpiEffectivelyVerified,
  isSubKpiPendingVerification,
  rejectCompletionDbPatch,
  resubmitCompletionDbPatch,
} from "@/lib/task-completion-verification";

describe("task completion verification", () => {
  it("moves newly complete checklists into pending verification without lastFullCompletionAt", () => {
    const patch = checklistCompletionDbPatch({ prevComplete: false, nextComplete: true });
    expect(patch.completionVerificationStatus).toBe(COMPLETION_VERIFICATION.PENDING);
    expect(patch.lastFullCompletionAt).toBeNull();
    expect(patch.pendingVerificationAt).toBeInstanceOf(Date);
  });

  it("skips the pending gate when verification is disabled", () => {
    const patch = checklistCompletionDbPatch({
      prevComplete: false,
      nextComplete: true,
      verificationEnabled: false,
    });
    expect(patch.completionVerificationStatus).toBe(COMPLETION_VERIFICATION.VERIFIED);
    expect(patch.lastFullCompletionAt).toBeInstanceOf(Date);
    expect(patch.pendingVerificationAt).toBeNull();
  });

  it("clears the verification gate when a checklist becomes incomplete", () => {
    const patch = checklistCompletionDbPatch({ prevComplete: true, nextComplete: false });
    expect(patch.completionVerificationStatus).toBeNull();
    expect(patch.lastFullCompletionAt).toBeNull();
  });

  it("maps board lanes from verification state", () => {
    expect(
      boardStatusAfterChecklistComplete({
        completionVerificationStatus: COMPLETION_VERIFICATION.PENDING,
        lastFullCompletionAt: null,
      }),
    ).toBe("PENDING_VERIFICATION");
    expect(
      boardStatusAfterChecklistComplete({
        completionVerificationStatus: COMPLETION_VERIFICATION.REJECTED,
        lastFullCompletionAt: null,
      }),
    ).toBe("CURRENT");
    expect(
      boardStatusAfterChecklistComplete({
        completionVerificationStatus: COMPLETION_VERIFICATION.VERIFIED,
        lastFullCompletionAt: new Date(),
      }),
    ).toBe("DONE");
    expect(
      boardStatusAfterChecklistComplete({
        completionVerificationStatus: null,
        lastFullCompletionAt: new Date(),
      }),
    ).toBe("DONE");
  });

  it("treats legacy completed rows as verified", () => {
    expect(
      isCompletionEffectivelyVerified({
        completionVerificationStatus: null,
        lastFullCompletionAt: new Date(),
      }),
    ).toBe(true);
    expect(
      isCompletionEffectivelyVerified({
        completionVerificationStatus: COMPLETION_VERIFICATION.PENDING,
        lastFullCompletionAt: null,
      }),
    ).toBe(false);
  });

  it("approve and reject patches preserve the intended outcomes", () => {
    const approved = approveCompletionDbPatch("agent-1");
    expect(approved.completionVerificationStatus).toBe(COMPLETION_VERIFICATION.VERIFIED);
    expect(approved.verifiedByAgentId).toBe("agent-1");
    expect(approved.lastFullCompletionAt).toBeInstanceOf(Date);

    const rejected = rejectCompletionDbPatch("Missing screenshots");
    expect(rejected.completionVerificationStatus).toBe(COMPLETION_VERIFICATION.REJECTED);
    expect(rejected.verificationRejectionComment).toBe("Missing screenshots");
    expect(rejected.lastFullCompletionAt).toBeNull();

    const resubmitted = resubmitCompletionDbPatch();
    expect(resubmitted.completionVerificationStatus).toBe(COMPLETION_VERIFICATION.PENDING);
  });

  it("gates individual sub-tasks until department-head verification", () => {
    const submitted = applySubKpiSubmitForVerification({
      id: "awic",
      title: "TICKETING",
      done: false,
      completionVerificationStatus: null as string | null,
    });
    expect(submitted.done).toBe(true);
    expect(submitted.completionVerificationStatus).toBe(COMPLETION_VERIFICATION.PENDING);
    expect(isSubKpiPendingVerification(submitted)).toBe(true);
    expect(isSubKpiEffectivelyVerified(submitted)).toBe(false);

    expect(isSubKpiPendingVerification({ done: true })).toBe(true);
    expect(
      isSubKpiEffectivelyVerified({ done: true }, { parentCardEffectivelyVerified: true }),
    ).toBe(true);
  });
});
