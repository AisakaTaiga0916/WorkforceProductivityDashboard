import { describe, expect, it } from "vitest";
import {
  buildGroupBoardDirectionFilterOptions,
  encodeGroupBoardDirectionFilter,
  parseGroupBoardDirectionFilter,
} from "@/lib/group-board-direction-filters";

describe("group-board-direction-filters", () => {
  it("parses company and dept encodings", () => {
    expect(parseGroupBoardDirectionFilter("company:abc")).toEqual({
      kind: "company",
      id: "abc",
    });
    expect(parseGroupBoardDirectionFilter("dept:sec1")).toEqual({
      kind: "dept",
      id: "sec1",
    });
    expect(parseGroupBoardDirectionFilter("ALL")).toBeNull();
    expect(parseGroupBoardDirectionFilter("")).toBeNull();
  });

  it("round-trips encode/parse", () => {
    const company = { kind: "company" as const, id: "t1" };
    const dept = { kind: "dept" as const, id: "s1" };
    expect(parseGroupBoardDirectionFilter(encodeGroupBoardDirectionFilter(company))).toEqual(
      company,
    );
    expect(parseGroupBoardDirectionFilter(encodeGroupBoardDirectionFilter(dept))).toEqual(dept);
  });

  it("builds labeled company and department options", () => {
    const opts = buildGroupBoardDirectionFilterOptions({
      companies: [{ id: "c1", name: "ACI" }],
      sections: [{ id: "d1", name: "ACCOUNTING", depth: 0 }],
    });
    expect(opts[0]).toEqual({ value: "ALL", label: "All" });
    expect(opts).toContainEqual({ value: "company:c1", label: "Company · ACI" });
    expect(opts).toContainEqual({ value: "dept:d1", label: "Dept · ACCOUNTING" });
  });
});
