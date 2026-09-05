import { describe, expect, it } from "vitest";
import { RetentionPeriodInvalidError } from "@nextbot/contracts";
import { INDEFINITE_RETENTION, computePurgeCutoff, validateRetentionDays } from "./retention-policy.js";

describe("validateRetentionDays (FR-ADM-06)", () => {
  it("accepts a positive integer", () => {
    expect(validateRetentionDays("f", 30, false)).toBe(30);
  });

  it.each([0, -5, undefined, 1.5])("rejects %s when not explicitly indefinite", (value) => {
    expect(() => validateRetentionDays("f", value as number, false)).toThrow(RetentionPeriodInvalidError);
  });

  it("rejects a bare -1 that was not explicitly opted into indefinite mode", () => {
    expect(() => validateRetentionDays("f", -1, false)).toThrow(RetentionPeriodInvalidError);
  });

  it("accepts -1 only when explicitIndefinite is true, regardless of the raw value supplied", () => {
    expect(validateRetentionDays("f", undefined, true)).toBe(INDEFINITE_RETENTION);
    expect(validateRetentionDays("f", 30, true)).toBe(INDEFINITE_RETENTION);
  });
});

describe("computePurgeCutoff (Phase 17 retention purge sweeper)", () => {
  it("returns null (never purge) for the Indefinite sentinel", () => {
    expect(computePurgeCutoff(INDEFINITE_RETENTION, new Date("2026-08-16T00:00:00Z"))).toBeNull();
  });

  it("computes a cutoff N days before now for a positive retention value", () => {
    const now = new Date("2026-08-16T00:00:00Z");
    const cutoff = computePurgeCutoff(30, now);
    expect(cutoff).toEqual(new Date("2026-07-17T00:00:00Z"));
  });

  it("computes distinct cutoffs for differing per-tenant retention values against the same 'now'", () => {
    const now = new Date("2026-08-16T00:00:00Z");
    const shortRetention = computePurgeCutoff(7, now);
    const longRetention = computePurgeCutoff(90, now);
    expect(shortRetention!.getTime()).toBeGreaterThan(longRetention!.getTime());
  });
});
