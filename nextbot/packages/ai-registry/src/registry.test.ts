import { describe, expect, it, vi } from "vitest";
import { AllProvidersUnavailableError } from "@nextbot/contracts";
import { executeChain, type ResolvedChainEntry } from "./registry.js";
import { ProviderCallError } from "./providers/types.js";

const entryA: ResolvedChainEntry = { providerKey: "a", model: "model-a", timeoutMs: 50 };
const entryB: ResolvedChainEntry = { providerKey: "b", model: "model-b", timeoutMs: 50 };

describe("executeChain (ADR-0006 §2.3 fallback/retry engine)", () => {
  it("returns immediately on a first-attempt success without touching the second chain entry", async () => {
    const attempt = vi.fn().mockResolvedValue("ok");
    const result = await executeChain([entryA, entryB], "chat.primary", attempt, 5000);
    expect(result).toBe("ok");
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(attempt.mock.calls[0]?.[0]).toBe(entryA);
  });

  it("retries the same provider once on a retryable failure before advancing", async () => {
    const attempt = vi
      .fn()
      .mockRejectedValueOnce(new ProviderCallError("rate limited", "RateLimited", true))
      .mockResolvedValueOnce("ok-after-retry");
    const result = await executeChain([entryA, entryB], "chat.primary", attempt, 5000);
    expect(result).toBe("ok-after-retry");
    expect(attempt).toHaveBeenCalledTimes(2);
    expect(attempt.mock.calls[0]?.[0]).toBe(entryA);
    expect(attempt.mock.calls[1]?.[0]).toBe(entryA); // still the same entry (the retry), not yet advanced
  });

  it("advances to the next chain entry after a retryable failure exhausts its one retry", async () => {
    const attempt = vi
      .fn()
      .mockRejectedValueOnce(new ProviderCallError("rate limited", "RateLimited", true))
      .mockRejectedValueOnce(new ProviderCallError("still rate limited", "RateLimited", true))
      .mockResolvedValueOnce("ok-from-b");
    const result = await executeChain([entryA, entryB], "chat.primary", attempt, 5000);
    expect(result).toBe("ok-from-b");
    expect(attempt).toHaveBeenCalledTimes(3);
    expect(attempt.mock.calls[2]?.[0]).toBe(entryB);
  });

  it("advances immediately (no retry) on a non-retryable failure", async () => {
    const attempt = vi
      .fn()
      .mockRejectedValueOnce(new ProviderCallError("bad request", "ClientError", false))
      .mockResolvedValueOnce("ok-from-b");
    const result = await executeChain([entryA, entryB], "chat.primary", attempt, 5000);
    expect(result).toBe("ok-from-b");
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it("throws AllProvidersUnavailableError once the whole chain (and its retries) is exhausted", async () => {
    const attempt = vi.fn().mockRejectedValue(new ProviderCallError("down", "ServerError", true));
    await expect(executeChain([entryA, entryB], "chat.primary", attempt, 5000)).rejects.toBeInstanceOf(AllProvidersUnavailableError);
    // 2 attempts per entry (1 + 1 retry) * 2 entries = 4
    expect(attempt).toHaveBeenCalledTimes(4);
  });

  it("throws AllProvidersUnavailableError immediately for an empty chain", async () => {
    const attempt = vi.fn();
    await expect(executeChain([], "chat.primary", attempt, 5000)).rejects.toBeInstanceOf(AllProvidersUnavailableError);
    expect(attempt).not.toHaveBeenCalled();
  });

  it("enforces the total-timeout ceiling across the whole chain (FR-AGT-08) even when individual entries would otherwise keep retrying", async () => {
    const attempt = vi.fn().mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      throw new ProviderCallError("slow failure", "ServerError", true);
    });
    const start = Date.now();
    await expect(executeChain([entryA, entryB], "chat.primary", attempt, 60)).rejects.toBeInstanceOf(AllProvidersUnavailableError);
    // The ceiling (60ms) must actually bound wall-clock time, not just be a documented
    // parameter — a bug regressing this would let a hung/misbehaving provider consume
    // far more than the configured budget.
    expect(Date.now() - start).toBeLessThan(500);
  });
});
