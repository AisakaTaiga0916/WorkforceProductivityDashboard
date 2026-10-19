import { describe, expect, it, vi } from "vitest";

vi.mock("@/modules/platform/db/prisma", () => ({ prisma: {} }));

import { validateCompanyInput } from "./company-admin";

const existing = [{ id: "aci", name: "ACI", code: "ACI" }];

describe("validateCompanyInput", () => {
  it("normalizes name, code, and aliases on create", () => {
    expect(
      validateCompanyInput(
        { name: "  New   Co ", code: " new co ", aliases: [" NewCo ", "newco", "New Company"] },
        existing,
        { requireName: true },
      ),
    ).toEqual({ name: "New Co", code: "NEW-CO", aliases: ["newco", "new company"] });
  });

  it("rejects duplicate names (case-insensitive) and codes", () => {
    expect(validateCompanyInput({ name: "aci" }, existing, { requireName: true })).toEqual({
      error: 'A company named "aci" already exists.',
    });
    expect(validateCompanyInput({ name: "Other", code: "aci" }, existing, { requireName: true })).toEqual({
      error: "Code ACI is already used by another company.",
    });
  });

  it("allows renaming a company to its own name", () => {
    expect(
      validateCompanyInput({ name: "ACI" }, existing, { requireName: false, selfId: "aci" }),
    ).toEqual({ name: "ACI" });
  });

  it("requires a name on create", () => {
    expect(validateCompanyInput({}, existing, { requireName: true })).toEqual({
      error: "Company name must be 2–80 characters.",
    });
  });
});
