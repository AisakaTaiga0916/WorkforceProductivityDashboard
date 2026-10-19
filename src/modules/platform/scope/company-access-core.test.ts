import { describe, expect, it } from "vitest";
import {
  canAccessCompany,
  decodeCompanyContextCookie,
  encodeCompanyContextCookie,
  normalizeMembershipInput,
  pickCurrentCompanyId,
  type AccessibleCompany,
} from "./company-access-core";

const A: AccessibleCompany = { id: "A", name: "Company A", isDefault: false };
const B: AccessibleCompany = { id: "B", name: "Company B", isDefault: true };
const C: AccessibleCompany = { id: "C", name: "Company C", isDefault: false };

describe("canAccessCompany", () => {
  it("employee in A only has no access to B", () => {
    const access = { global: false, companies: [A] };
    expect(canAccessCompany(access, "A")).toBe(true);
    expect(canAccessCompany(access, "B")).toBe(false);
    expect(canAccessCompany(access, null)).toBe(false);
  });

  it("multi-company user accesses every membership", () => {
    const access = { global: false, companies: [A, B] };
    expect(canAccessCompany(access, "A")).toBe(true);
    expect(canAccessCompany(access, "B")).toBe(true);
    expect(canAccessCompany(access, "C")).toBe(false);
  });

  it("Super Admin (global) accesses every company", () => {
    expect(canAccessCompany({ global: true, companies: [] }, "anything")).toBe(true);
  });
});

describe("company context cookie", () => {
  it("round-trips account + company, and 'all'", () => {
    expect(decodeCompanyContextCookie(encodeCompanyContextCookie("u1", "A"))).toEqual({
      portalAccountId: "u1",
      companyId: "A",
    });
    expect(decodeCompanyContextCookie(encodeCompanyContextCookie("u1", null))).toEqual({
      portalAccountId: "u1",
      companyId: null,
    });
  });

  it("rejects malformed values", () => {
    expect(decodeCompanyContextCookie("")).toBeNull();
    expect(decodeCompanyContextCookie(":A")).toBeNull();
    expect(decodeCompanyContextCookie("u1:")).toBeNull();
    expect(decodeCompanyContextCookie(undefined)).toBeNull();
  });
});

describe("pickCurrentCompanyId", () => {
  const base = { portalAccountId: "u1", global: false, companies: [A, B], defaultCompanyId: "B" };

  it("opens the default company at login (no remembered choice)", () => {
    expect(pickCurrentCompanyId({ ...base, cookieValue: undefined })).toBe("B");
  });

  it("remembers the switcher choice while it is still a membership", () => {
    expect(pickCurrentCompanyId({ ...base, cookieValue: "u1:A" })).toBe("A");
  });

  it("ignores a remembered company the user lost access to (e.g. archived)", () => {
    expect(pickCurrentCompanyId({ ...base, cookieValue: "u1:C" })).toBe("B");
  });

  it("ignores another account's cookie", () => {
    expect(pickCurrentCompanyId({ ...base, cookieValue: "u2:A" })).toBe("B");
  });

  it("non-global users cannot pick 'all companies'", () => {
    expect(pickCurrentCompanyId({ ...base, cookieValue: "u1:all" })).toBe("B");
  });

  it("falls back to the first membership without a default", () => {
    expect(pickCurrentCompanyId({ ...base, defaultCompanyId: null, cookieValue: undefined })).toBe("A");
  });

  it("users without companies get no company", () => {
    expect(
      pickCurrentCompanyId({ ...base, companies: [], defaultCompanyId: null, cookieValue: undefined }),
    ).toBeNull();
  });

  it("Super Admin opens on all companies unless they have a default", () => {
    const sa = { portalAccountId: "sa", global: true, companies: [A, B, C] };
    expect(pickCurrentCompanyId({ ...sa, defaultCompanyId: null, cookieValue: undefined })).toBeNull();
    expect(pickCurrentCompanyId({ ...sa, defaultCompanyId: "C", cookieValue: undefined })).toBe("C");
    expect(pickCurrentCompanyId({ ...sa, defaultCompanyId: "C", cookieValue: "sa:all" })).toBeNull();
    expect(pickCurrentCompanyId({ ...sa, defaultCompanyId: null, cookieValue: "sa:A" })).toBe("A");
  });
});

describe("normalizeMembershipInput", () => {
  it("dedupes ids and keeps the chosen default", () => {
    expect(normalizeMembershipInput(["A", "B", "A", " "], "B")).toEqual({
      companyIds: ["A", "B"],
      defaultCompanyId: "B",
    });
  });

  it("defaults to the first company when none is chosen", () => {
    expect(normalizeMembershipInput(["A", "B"], null)).toEqual({
      companyIds: ["A", "B"],
      defaultCompanyId: "A",
    });
  });

  it("requires the default to be one of the selected companies", () => {
    expect(normalizeMembershipInput(["A"], "B")).toEqual({
      error: "Default company must be one of the selected companies.",
    });
    expect("error" in normalizeMembershipInput([], "B")).toBe(true);
  });

  it("allows removing all company access", () => {
    expect(normalizeMembershipInput([], null)).toEqual({ companyIds: [], defaultCompanyId: null });
  });
});
