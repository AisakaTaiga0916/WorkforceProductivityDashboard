import { describe, expect, it } from "vitest";
import {
  firstVisibleIntakeRequestType,
  isRequestTypeHiddenFromIntake,
  parseIntakeRequestTypeVisibility,
  visibleIntakeRequestTypes,
} from "@/modules/platform/settings/intake-request-type-visibility";

describe("intake request type visibility", () => {
  it("parses hidden type ids", () => {
    expect(
      parseIntakeRequestTypeVisibility({
        hiddenTypeIds: ["JOB_ORDER", "not-a-type", "REQUEST_FOR_PAYMENT"],
      }).hiddenTypeIds.sort(),
    ).toEqual(["JOB_ORDER", "REQUEST_FOR_PAYMENT"]);
  });

  it("filters visible intake types", () => {
    const hidden = ["JOB_ORDER"] as const;
    expect(visibleIntakeRequestTypes([...hidden]).some((t) => t.id === "JOB_ORDER")).toBe(false);
    expect(isRequestTypeHiddenFromIntake("JOB_ORDER", hidden)).toBe(true);
    expect(firstVisibleIntakeRequestType([...hidden])).toBe("ISSUE_CONCERN_TICKET");
  });
});
