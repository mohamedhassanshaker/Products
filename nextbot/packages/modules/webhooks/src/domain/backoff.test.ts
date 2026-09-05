import { describe, expect, it } from "vitest";
import { nextRetryDelayMs, shouldRetry, MAX_DELIVERY_ATTEMPTS } from "./backoff.js";

describe("webhook delivery backoff policy (pure)", () => {
  it("doubles the delay on each successive attempt, capped at 1 hour", () => {
    expect(nextRetryDelayMs(1)).toBe(30_000);
    expect(nextRetryDelayMs(2)).toBe(60_000);
    expect(nextRetryDelayMs(3)).toBe(120_000);
    expect(nextRetryDelayMs(10)).toBe(60 * 60_000); // capped, not 30s*2^9
  });

  it("never returns a negative/zero-attempt delay smaller than the base delay", () => {
    expect(nextRetryDelayMs(0)).toBe(30_000);
  });

  it("retries up to MAX_DELIVERY_ATTEMPTS, then stops", () => {
    expect(shouldRetry(MAX_DELIVERY_ATTEMPTS - 1)).toBe(true);
    expect(shouldRetry(MAX_DELIVERY_ATTEMPTS)).toBe(false);
    expect(shouldRetry(MAX_DELIVERY_ATTEMPTS + 1)).toBe(false);
  });
});
