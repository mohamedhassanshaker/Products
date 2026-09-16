import { describe, expect, it } from "vitest";
import { backoffSeconds, nextAvailableAt, outboxRowBecomesDead } from "./outbox-backoff.js";

describe("outbox retry backoff (§9.2)", () => {
  it("doubles per attempt", () => {
    expect(backoffSeconds(0)).toBe(1);
    expect(backoffSeconds(1)).toBe(2);
    expect(backoffSeconds(3)).toBe(8);
    expect(backoffSeconds(6)).toBe(64);
  });

  it("caps at one hour", () => {
    expect(backoffSeconds(20)).toBe(3600);
  });

  it("computes the next available timestamp from now plus the backoff", () => {
    const now = new Date("2026-09-09T09:00:00.000Z");
    expect(nextAvailableAt(now, 3).toISOString()).toBe("2026-09-09T09:00:08.000Z");
  });

  it("becomes dead only once attemptCount reaches maxAttempts", () => {
    expect(outboxRowBecomesDead(7, 8)).toBe(false);
    expect(outboxRowBecomesDead(8, 8)).toBe(true);
    expect(outboxRowBecomesDead(9, 8)).toBe(true);
  });
});
