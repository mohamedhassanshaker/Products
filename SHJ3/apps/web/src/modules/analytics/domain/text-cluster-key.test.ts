import { describe, expect, it } from "vitest";
import { normalizedTextClusterKey, normalizeQuestionText } from "./text-cluster-key.js";

describe("normalizeQuestionText", () => {
  it("lowercases and collapses whitespace", () => {
    expect(normalizeQuestionText("  Do you   accept Apple Pay??  ")).toBe(
      "do you accept apple pay??",
    );
  });
});

describe("normalizedTextClusterKey", () => {
  it("is a 64-character hex digest", () => {
    expect(normalizedTextClusterKey("Do you accept Apple Pay?")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("collapses near-exact variants to the same key", () => {
    const a = normalizedTextClusterKey("Do you accept Apple Pay?");
    const b = normalizedTextClusterKey("  do you accept   apple pay?");
    expect(a).toBe(b);
  });

  it("keeps genuinely different questions apart", () => {
    const a = normalizedTextClusterKey("Do you accept Apple Pay?");
    const b = normalizedTextClusterKey("How do I dispute a fine?");
    expect(a).not.toBe(b);
  });
});
