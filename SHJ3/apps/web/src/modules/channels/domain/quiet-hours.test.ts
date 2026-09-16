import { describe, expect, it } from "vitest";
import { isWithinQuietHours, quietHoursEndAfter, timeZoneOffsetMinutes } from "./quiet-hours.js";

const DUBAI_WINDOW = {
  isEnabled: true,
  startsAt: { hour: 21, minute: 0 },
  endsAt: { hour: 7, minute: 0 },
  timezone: "Asia/Dubai",
};

describe("timeZoneOffsetMinutes", () => {
  it("resolves Asia/Dubai as a fixed +04:00, year-round (no DST)", () => {
    expect(timeZoneOffsetMinutes(new Date("2026-01-15T00:00:00Z"), "Asia/Dubai")).toBe(240);
    expect(timeZoneOffsetMinutes(new Date("2026-07-15T00:00:00Z"), "Asia/Dubai")).toBe(240);
  });
});

describe("isWithinQuietHours", () => {
  it("is quiet at 22:00 Dubai time (21:00-07:00 window)", () => {
    // 22:00 Asia/Dubai (+04:00) = 18:00 UTC.
    expect(isWithinQuietHours(new Date("2026-09-09T18:00:00Z"), DUBAI_WINDOW)).toBe(true);
  });

  it("is quiet at 02:00 Dubai time, past midnight", () => {
    // 02:00 Asia/Dubai next day = 22:00 UTC the previous day.
    expect(isWithinQuietHours(new Date("2026-09-09T22:00:00Z"), DUBAI_WINDOW)).toBe(true);
  });

  it("is not quiet at 12:00 Dubai time", () => {
    // 12:00 Asia/Dubai = 08:00 UTC.
    expect(isWithinQuietHours(new Date("2026-09-09T08:00:00Z"), DUBAI_WINDOW)).toBe(false);
  });

  it("is not quiet exactly at the boundary (07:00 is the end, exclusive)", () => {
    // 07:00 Asia/Dubai = 03:00 UTC.
    expect(isWithinQuietHours(new Date("2026-09-09T03:00:00Z"), DUBAI_WINDOW)).toBe(false);
  });

  it("is quiet exactly at the start boundary (21:00 is inclusive)", () => {
    // 21:00 Asia/Dubai = 17:00 UTC.
    expect(isWithinQuietHours(new Date("2026-09-09T17:00:00Z"), DUBAI_WINDOW)).toBe(true);
  });

  it("is never quiet when disabled", () => {
    expect(
      isWithinQuietHours(new Date("2026-09-09T18:00:00Z"), { ...DUBAI_WINDOW, isEnabled: false }),
    ).toBe(false);
  });

  it("handles a same-day (non-wrapping) window correctly", () => {
    const daytime = {
      ...DUBAI_WINDOW,
      startsAt: { hour: 9, minute: 0 },
      endsAt: { hour: 17, minute: 0 },
    };
    // 12:00 Asia/Dubai = 08:00 UTC.
    expect(isWithinQuietHours(new Date("2026-09-09T08:00:00Z"), daytime)).toBe(true);
    // 20:00 Asia/Dubai = 16:00 UTC.
    expect(isWithinQuietHours(new Date("2026-09-09T16:00:00Z"), daytime)).toBe(false);
  });
});

describe("quietHoursEndAfter", () => {
  it("resolves to the next 07:00 Asia/Dubai, correctly converted to UTC", () => {
    // 22:00 Asia/Dubai on the 9th = 18:00 UTC on the 9th; the window ends 07:00 Dubai on
    // the 10th = 03:00 UTC on the 10th.
    const end = quietHoursEndAfter(new Date("2026-09-09T18:00:00Z"), DUBAI_WINDOW);
    expect(end.toISOString()).toBe("2026-09-10T03:00:00.000Z");
  });

  it("resolves to today's end when the window's end has not yet passed", () => {
    // 02:00 Asia/Dubai on the 10th = 22:00 UTC on the 9th; the window ends 07:00 Dubai the
    // same calendar day (the 10th) = 03:00 UTC on the 10th.
    const end = quietHoursEndAfter(new Date("2026-09-09T22:00:00Z"), DUBAI_WINDOW);
    expect(end.toISOString()).toBe("2026-09-10T03:00:00.000Z");
  });
});
