import { describe, expect, it } from "vitest";
import { detectThrash, similarityOf } from "./thrash-detector.js";

/**
 * Target Architecture Blueprint Phase 14 (BL-46, FR-ORC-07, LLD §14.7.3 step 2) —
 * the routing-thrash guard's pure decision logic.
 */
describe("similarityOf — a real cosine over term-frequency vectors", () => {
  it("is 1 for identical text", () => {
    expect(similarityOf("refund my invoice please", "refund my invoice please")).toBe(1);
  });

  it("is 1 for text differing only in case and punctuation (the tokenizer's own normalisation)", () => {
    expect(similarityOf("Refund my invoice!", "refund   my, invoice")).toBe(1);
  });

  it("is 0 for texts sharing no tokens", () => {
    expect(similarityOf("refund invoice", "weather forecast")).toBe(0);
  });

  it("is between 0 and 1 for partial overlap, and symmetric", () => {
    const a = similarityOf("refund my invoice", "refund my order");
    const b = similarityOf("refund my order", "refund my invoice");
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(1);
    expect(a).toBeCloseTo(b, 12);
  });

  it("treats two empty payloads as identical (an empty payload repeated is still a repeat)", () => {
    expect(similarityOf("", "")).toBe(1);
  });

  it("treats one empty and one non-empty payload as unrelated", () => {
    expect(similarityOf("", "refund")).toBe(0);
    expect(similarityOf("refund", "")).toBe(0);
  });

  it("is unaffected by token ORDER — a reordered restatement of the same task is still a repeat", () => {
    expect(similarityOf("invoice refund please", "please refund invoice")).toBe(1);
  });
});

describe("detectThrash (FR-ORC-07) — escalate, never loop", () => {
  const window = { repeats: 2, similarityThreshold: 0.9 };

  it("is never thrash on the first delegation to a member (no prior payloads)", () => {
    expect(detectThrash("refund my invoice", [], window).thrashing).toBe(false);
  });

  it("is not thrash while fewer than `repeats` prior hops are materially similar", () => {
    const verdict = detectThrash("refund my invoice", ["refund my invoice"], window);
    expect(verdict.thrashing).toBe(false);
    expect(verdict.similarCount).toBe(1);
    expect(verdict.maxSimilarity).toBe(1);
  });

  it("IS thrash once `repeats` prior hops within the window are materially similar", () => {
    const verdict = detectThrash("refund my invoice", ["refund my invoice", "refund my invoice"], window);
    expect(verdict.thrashing).toBe(true);
    expect(verdict.similarCount).toBe(2);
  });

  it("only inspects the LAST `repeats` prior hops — older dissimilar history cannot dilute the window", () => {
    const verdict = detectThrash("refund my invoice", ["totally unrelated weather question", "refund my invoice", "refund my invoice"], window);
    expect(verdict.thrashing).toBe(true);
  });

  it("older SIMILAR history outside the window cannot alone trip the guard", () => {
    const verdict = detectThrash("refund my invoice", ["refund my invoice", "check the weather forecast", "shipping status update"], window);
    expect(verdict.thrashing).toBe(false);
    // The window is the last 2 hops, neither of which is similar.
    expect(verdict.similarCount).toBe(0);
  });

  it("materially DIFFERENT repeated delegations to the same member are not thrash", () => {
    const verdict = detectThrash("what is my shipping status", ["refund my invoice", "cancel my subscription"], window);
    expect(verdict.thrashing).toBe(false);
  });

  it("respects the configured threshold — a lower threshold catches looser repetition", () => {
    const loose = detectThrash("refund my invoice now", ["refund my invoice", "refund my invoice"], { repeats: 2, similarityThreshold: 0.5 });
    const strict = detectThrash("refund my invoice now", ["refund my invoice", "refund my invoice"], { repeats: 2, similarityThreshold: 0.99 });
    expect(loose.thrashing).toBe(true);
    expect(strict.thrashing).toBe(false);
  });

  it("reports the maximum similarity seen, for the operator-facing outcome detail", () => {
    const verdict = detectThrash("refund my invoice", ["refund my invoice", "weather"], window);
    expect(verdict.maxSimilarity).toBe(1);
  });
});
