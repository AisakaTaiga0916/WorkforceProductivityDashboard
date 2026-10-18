import { describe, expect, it } from "vitest";
import { issueConcernIntakeLockMessage } from "@/modules/requests/issue-concern-intake-lock";

describe("issueConcernIntakeLockMessage", () => {
  it("mentions Issue/Concern and allows other types", () => {
    const msg = issueConcernIntakeLockMessage("REQ-2026-001");
    expect(msg).toContain("Issue/Concern");
    expect(msg).toContain("REQ-2026-001");
    expect(msg).toMatch(/payment|requisition|fund transfer|job order/i);
  });
});
