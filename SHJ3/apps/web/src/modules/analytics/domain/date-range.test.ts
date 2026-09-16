import { describe, expect, it } from "vitest";
import { datesInRange, toUtcDateKey, utcDateFromKey, utcDayBounds } from "./date-range.js";

const now = new Date("2026-09-10T23:59:59.000Z");

describe("datesInRange", () => {
  it("Today is exactly one date — now's own UTC calendar date", () => {
    expect(datesInRange("Today", now)).toEqual(["2026-09-10"]);
  });

  it("Last 7 days is 7 consecutive dates ending on today", () => {
    expect(datesInRange("Last 7 days", now)).toEqual([
      "2026-09-04",
      "2026-09-05",
      "2026-09-06",
      "2026-09-07",
      "2026-09-08",
      "2026-09-09",
      "2026-09-10",
    ]);
  });

  it("Last 30 days is 30 consecutive dates ending on today, and contains Last 7 days as a suffix", () => {
    const days30 = datesInRange("Last 30 days", now);
    expect(days30).toHaveLength(30);
    expect(days30[29]).toBe("2026-09-10");
    expect(days30.slice(23)).toEqual(datesInRange("Last 7 days", now));
  });

  it("is UTC-safe across a date that would differ under a local timezone reading", () => {
    // 23:59:59 UTC is already the next local day in some timezones — the point is that
    // this function never consults the host's local timezone at all.
    expect(datesInRange("Today", new Date("2026-01-01T00:00:00.001Z"))).toEqual(["2026-01-01"]);
  });
});

describe("toUtcDateKey / utcDateFromKey", () => {
  it("round-trips through a UTC-midnight Date", () => {
    const key = "2026-09-10";
    expect(toUtcDateKey(utcDateFromKey(key))).toBe(key);
  });
});

describe("utcDayBounds", () => {
  it("spans exactly one 24-hour UTC window", () => {
    const { start, end } = utcDayBounds("2026-09-10");
    expect(start.toISOString()).toBe("2026-09-10T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-09-11T00:00:00.000Z");
  });
});
