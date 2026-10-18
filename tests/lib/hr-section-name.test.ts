import { describe, expect, it } from "vitest";
import { isHrSectionName } from "@/modules/hierarchy/hr-section-name";

describe("isHrSectionName", () => {
  it("matches exact allowlist names", () => {
    expect(isHrSectionName("HR")).toBe(true);
    expect(isHrSectionName("HR Team")).toBe(true);
    expect(isHrSectionName("Human Resources")).toBe(true);
  });

  it("matches whole-word HR in longer labels", () => {
    expect(isHrSectionName("Corporate HR")).toBe(true);
    expect(isHrSectionName("People & HR Team")).toBe(true);
  });

  it("does not match substring false positives", () => {
    expect(isHrSectionName("Chair")).toBe(false);
    expect(isHrSectionName("Shareholder")).toBe(false);
    expect(isHrSectionName("Architecture")).toBe(false);
    expect(isHrSectionName("Marketing")).toBe(false);
  });
});
