import { describe, expect, it } from "vitest";
import { canArchive, canPublish, canRollback, canUnpublish } from "./agent-lifecycle.js";

describe("canUnpublish", () => {
  it("allows unpublishing a Published agent", () => {
    expect(canUnpublish("Published")).toEqual({ allowed: true });
  });

  it("refuses a Draft or Archived agent with a stable reason", () => {
    expect(canUnpublish("Draft")).toEqual({ allowed: false, reason: "agent.not_published" });
    expect(canUnpublish("Archived")).toEqual({ allowed: false, reason: "agent.not_published" });
  });
});

describe("canPublish", () => {
  it("allows publishing a Draft version", () => {
    expect(canPublish("Draft")).toEqual({ allowed: true });
  });

  it("refuses an already-Published version", () => {
    expect(canPublish("Published")).toEqual({
      allowed: false,
      reason: "agent.already_published",
    });
  });
});

describe("canArchive", () => {
  it("allows archiving when not bound to a live channel", () => {
    expect(canArchive(false)).toEqual({ allowed: true });
  });

  it("refuses archiving while bound to a live channel", () => {
    expect(canArchive(true)).toEqual({
      allowed: false,
      reason: "agent.bound_to_live_channel",
    });
  });
});

describe("canRollback", () => {
  it("allows rolling back to a non-current version", () => {
    expect(canRollback(false)).toEqual({ allowed: true });
  });

  it("refuses rolling back to the version that is already current", () => {
    expect(canRollback(true)).toEqual({
      allowed: false,
      reason: "agent.version_is_current",
    });
  });
});
