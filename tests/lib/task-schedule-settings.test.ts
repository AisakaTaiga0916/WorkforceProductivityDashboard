import { describe, expect, it } from "vitest";
import {
  DEFAULT_WORKING_DAYS,
  formatWorkingDaysLabel,
  normalizeWorkingDays,
  parseTaskScheduleSettings,
  workingDaysForCompany,
} from "@/modules/platform/settings/task-schedule-settings";

describe("normalizeWorkingDays", () => {
  it("sorts, dedupes, and accepts strings", () => {
    expect(normalizeWorkingDays([5, 1, "3", 3, 2])).toEqual([1, 2, 3, 5]);
  });

  it("rejects empty lists and out-of-range values", () => {
    expect(normalizeWorkingDays([])).toBeNull();
    expect(normalizeWorkingDays([0])).toBeNull();
    expect(normalizeWorkingDays([8])).toBeNull();
    expect(normalizeWorkingDays("Mon")).toBeNull();
    expect(normalizeWorkingDays([1, "x"])).toBeNull();
  });

  it("accepts the full week", () => {
    expect(normalizeWorkingDays([1, 2, 3, 4, 5, 6, 7])).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});

describe("parseTaskScheduleSettings", () => {
  it("parses a valid companies map", () => {
    const parsed = parseTaskScheduleSettings({
      companies: {
        c1: { workingDays: [1, 2, 3, 4, 5] },
        c2: { workingDays: [6, 7] },
      },
    });
    expect(parsed.companies.c1!.workingDays).toEqual([1, 2, 3, 4, 5]);
    expect(parsed.companies.c2!.workingDays).toEqual([6, 7]);
  });

  it("drops invalid entries and tolerates junk", () => {
    expect(parseTaskScheduleSettings(null).companies).toEqual({});
    expect(parseTaskScheduleSettings({ companies: { c1: { workingDays: [] } } }).companies).toEqual({});
    expect(parseTaskScheduleSettings({ companies: { "": { workingDays: [1] } } }).companies).toEqual({});
    expect(parseTaskScheduleSettings("nope").companies).toEqual({});
  });
});

describe("workingDaysForCompany", () => {
  it("falls back to the default (Mon–Sat) when unset or unknown", () => {
    const settings = parseTaskScheduleSettings({ companies: { c1: { workingDays: [1] } } });
    expect(workingDaysForCompany(settings, "c1")).toEqual([1]);
    expect(workingDaysForCompany(settings, "missing")).toEqual([...DEFAULT_WORKING_DAYS]);
    expect(workingDaysForCompany(settings, null)).toEqual([...DEFAULT_WORKING_DAYS]);
  });
});

describe("formatWorkingDaysLabel", () => {
  it("condenses ranges and lists sparse days", () => {
    expect(formatWorkingDaysLabel([1, 2, 3, 4, 5, 6])).toBe("Mon–Sat");
    expect(formatWorkingDaysLabel([1, 2, 3, 4, 5, 6, 7])).toBe("Every day");
    expect(formatWorkingDaysLabel([1, 3, 5])).toBe("Mon, Wed, Fri");
    expect(formatWorkingDaysLabel([])).toBe("Mon–Sat");
  });
});
