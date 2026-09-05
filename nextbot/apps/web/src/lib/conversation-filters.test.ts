import { describe, expect, it } from "vitest";
import { parseConversationFilters } from "./conversation-filters.js";

describe("parseConversationFilters (Phase 13, BL-06)", () => {
  it("returns an empty filter set for no query params", () => {
    expect(parseConversationFilters(new URLSearchParams())).toEqual({});
  });

  it("parses every valid filter param", () => {
    const params = new URLSearchParams({
      channelId: "chan-1",
      status: "Resolved",
      recognizedGoal: "order_status",
      language: "en",
      startedAfter: "2026-01-01",
      startedBefore: "2026-02-01",
      limit: "10",
      offset: "5",
    });
    expect(parseConversationFilters(params)).toEqual({
      channelId: "chan-1",
      status: "Resolved",
      recognizedGoal: "order_status",
      language: "en",
      startedAfter: new Date("2026-01-01"),
      startedBefore: new Date("2026-02-01"),
      limit: 10,
      offset: 5,
    });
  });

  it("ignores an invalid status value rather than passing it through unchecked", () => {
    const params = new URLSearchParams({ status: "NotARealStatus" });
    expect(parseConversationFilters(params)).toEqual({});
  });

  it("ignores an unparseable date rather than producing an Invalid Date", () => {
    const params = new URLSearchParams({ startedAfter: "not-a-date" });
    expect(parseConversationFilters(params)).toEqual({});
  });

  it("ignores a non-numeric or non-positive limit/offset", () => {
    expect(parseConversationFilters(new URLSearchParams({ limit: "abc" }))).toEqual({});
    expect(parseConversationFilters(new URLSearchParams({ limit: "0" }))).toEqual({});
    expect(parseConversationFilters(new URLSearchParams({ offset: "-1" }))).toEqual({});
  });
});
