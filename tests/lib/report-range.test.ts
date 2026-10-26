import { describe, expect, it } from "vitest";
import {
  REPORT_MAX_DAYS,
  bucketIndexFor,
  formatDurationHours,
  median,
  parseReportRange,
  percent,
  reportBuckets,
  toCsv,
} from "@/modules/reports/report-range";

const TZ = "Asia/Manila";
const NOW = new Date("2026-10-19T04:00:00.000Z"); // 12:00 in Manila

describe("parseReportRange", () => {
  it("defaults to the last 30 days ending today", () => {
    const range = parseReportRange({}, NOW, TZ);
    expect(range.toYmd).toBe("2026-10-19");
    expect(range.fromYmd).toBe("2026-09-20");
    expect(range.days).toBe(30);
    expect(range.start.toISOString()).toBe("2026-09-19T16:00:00.000Z");
    expect(range.endExclusive.toISOString()).toBe("2026-10-19T16:00:00.000Z");
  });

  it("swaps reversed bounds and ignores junk", () => {
    const range = parseReportRange({ from: "2026-10-10", to: "2026-10-01" }, NOW, TZ);
    expect([range.fromYmd, range.toYmd]).toEqual(["2026-10-01", "2026-10-10"]);
    expect(parseReportRange({ from: "nope", to: "2026-13-40" }, NOW, TZ).toYmd).toBe("2026-10-19");
  });

  it("resolves presets (calendar periods end today)", () => {
    expect(parseReportRange({ range: "7d" }, NOW, TZ)).toMatchObject({
      preset: "7d",
      fromYmd: "2026-10-13",
      toYmd: "2026-10-19",
    });
    expect(parseReportRange({ range: "month" }, NOW, TZ).fromYmd).toBe("2026-10-01");
    expect(parseReportRange({ range: "quarter" }, NOW, TZ).fromYmd).toBe("2026-10-01");
    expect(parseReportRange({}, NOW, TZ).preset).toBe("30d");
    // Preset wins over stale custom dates; bare dates mean custom.
    expect(parseReportRange({ range: "7d", from: "2026-01-01" }, NOW, TZ).fromYmd).toBe("2026-10-13");
    expect(parseReportRange({ from: "2026-10-01", to: "2026-10-05" }, NOW, TZ).preset).toBe("custom");
  });

  it("clamps very long ranges", () => {
    const range = parseReportRange({ from: "2020-01-01", to: "2026-10-19" }, NOW, TZ);
    expect(range.days).toBe(REPORT_MAX_DAYS);
  });
});

describe("reportBuckets", () => {
  it("uses daily buckets for short ranges", () => {
    const range = parseReportRange({ from: "2026-10-01", to: "2026-10-07" }, NOW, TZ);
    const buckets = reportBuckets(range);
    expect(buckets).toHaveLength(7);
    expect(buckets[0]!.key).toBe("2026-10-01");
    expect(bucketIndexFor(buckets, new Date("2026-10-03T10:00:00+08:00"))).toBe(2);
    expect(bucketIndexFor(buckets, new Date("2026-10-08T00:00:00+08:00"))).toBe(-1);
  });

  it("uses Monday weeks clipped to the range for long ranges", () => {
    const range = parseReportRange({ from: "2026-07-01", to: "2026-10-19" }, NOW, TZ);
    const buckets = reportBuckets(range);
    expect(buckets[0]!.key).toBe("2026-07-01"); // Wednesday, clipped start
    expect(buckets[1]!.key).toBe("2026-07-06"); // next Monday
    expect(buckets.at(-1)!.endExclusive.getTime()).toBe(range.endExclusive.getTime());
  });
});

describe("stats + csv", () => {
  it("computes medians and percents", () => {
    expect(median([])).toBeNull();
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(percent(1, 3)).toBe(33.3);
    expect(percent(1, 0)).toBeNull();
  });

  it("formats durations", () => {
    expect(formatDurationHours(null)).toBe("—");
    expect(formatDurationHours(0.5)).toBe("30m");
    expect(formatDurationHours(6.54)).toBe("6.5h");
    expect(formatDurationHours(72)).toBe("3d");
  });

  it("escapes csv cells", () => {
    expect(toCsv([["a", 'b "q"', "c,d", null, 3]])).toBe('a,"b ""q""","c,d",,3');
  });
});
