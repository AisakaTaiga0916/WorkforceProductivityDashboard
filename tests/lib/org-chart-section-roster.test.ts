import { describe, expect, it } from "vitest";
import { collectMergedIdsForSectionTree } from "@/lib/org-chart-section-roster";

describe("collectMergedIdsForSectionTree", () => {
  it("includes section members and org-chart heads", () => {
    const membersBySection = new Map([
      ["fames", [{ mergedSourceUserId: "member-1" }]],
      ["sales", [{ mergedSourceUserId: "member-2" }]],
    ]);
    const headMergedBySection = new Map([
      ["fames", "lynneth-head"],
      ["sales", "riezel-head"],
    ]);

    const ids = collectMergedIdsForSectionTree(
      ["fames"],
      membersBySection,
      headMergedBySection,
    );

    expect(ids.sort()).toEqual(["lynneth-head", "member-1"].sort());
    expect(ids).not.toContain("riezel-head");
    expect(ids).not.toContain("member-2");
  });

  it("still returns members when a section has no head", () => {
    const membersBySection = new Map([["it", [{ mergedSourceUserId: "member-it" }]]]);
    expect(collectMergedIdsForSectionTree(["it"], membersBySection, new Map())).toEqual([
      "member-it",
    ]);
  });
});
