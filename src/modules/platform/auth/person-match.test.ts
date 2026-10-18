import { describe, expect, it } from "vitest";
import { personNameSimilarity, samePersonName } from "@/modules/platform/auth/person-match";

describe("samePersonName", () => {
  it("matches HRIS vs July backup name variants", () => {
    expect(samePersonName("Zyrah Faith Cuba Gascon", "Zyrah Faith Gascon")).toBe(true);
    expect(samePersonName("Reginald Araña Malubay", "Reginald Malubay")).toBe(true);
    expect(samePersonName("Minoza, Kurt Jerelle", "Kurt Jerelle Miñoza")).toBe(true);
    expect(samePersonName("Magsadia, John Laurence Sacramento", "John Laurence Magsadia")).toBe(
      true,
    );
    expect(samePersonName("Mark Robina", "Mark Anthony Robina")).toBe(true);
    expect(samePersonName("Sembrano, Mark Jim Valenzuela", "Mark Jim Sembrano")).toBe(true);
  });

  it("does not match unrelated people sharing one token", () => {
    expect(samePersonName("Mark Robina", "Mark Jim Sembrano")).toBe(false);
    expect(samePersonName("John Laurence Magsadia", "John Rich Petras")).toBe(false);
  });

  it("matches short vs full HRIS names", () => {
    expect(samePersonName("Laurence Magsadia", "Magsadia, John Laurence Sacramento")).toBe(true);
  });
});
