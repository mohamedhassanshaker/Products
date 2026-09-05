import { describe, expect, it } from "vitest";
import { clampMaxExpansions, clampMaxHops, clampMaxNodes, clampTopK, RETRIEVAL_HARD_CEILINGS, RETRIEVAL_DEFAULTS } from "./retrieval-bounds.js";

describe("retrieval-bounds", () => {
  describe("clampMaxHops", () => {
    it("returns the default when unspecified", () => {
      expect(clampMaxHops(undefined)).toBe(RETRIEVAL_DEFAULTS.maxHops);
    });
    it("passes a value inside the range through unchanged", () => {
      expect(clampMaxHops(3)).toBe(3);
    });
    it("caps a pathological request at the hard ceiling", () => {
      expect(clampMaxHops(999_999)).toBe(RETRIEVAL_HARD_CEILINGS.maxHops);
      expect(clampMaxHops(Number.MAX_SAFE_INTEGER)).toBe(RETRIEVAL_HARD_CEILINGS.maxHops);
    });
    it("floors a negative request at 0 rather than throwing", () => {
      expect(clampMaxHops(-5)).toBe(0);
    });
    it("truncates a fractional request", () => {
      expect(clampMaxHops(2.9)).toBe(2);
    });
    it("falls back to the default for non-finite input", () => {
      expect(clampMaxHops(Number.POSITIVE_INFINITY)).toBe(RETRIEVAL_DEFAULTS.maxHops);
      expect(clampMaxHops(Number.NaN)).toBe(RETRIEVAL_DEFAULTS.maxHops);
    });
  });

  describe("clampMaxNodes", () => {
    it("returns the default when unspecified", () => {
      expect(clampMaxNodes(undefined)).toBe(RETRIEVAL_DEFAULTS.maxNodes);
    });
    it("caps a pathological request at the hard ceiling", () => {
      expect(clampMaxNodes(10_000_000)).toBe(RETRIEVAL_HARD_CEILINGS.maxNodes);
    });
    it("floors at 1, never 0", () => {
      expect(clampMaxNodes(0)).toBe(1);
      expect(clampMaxNodes(-100)).toBe(1);
    });
  });

  describe("clampTopK", () => {
    it("returns the default when unspecified", () => {
      expect(clampTopK(undefined)).toBe(RETRIEVAL_DEFAULTS.topK);
    });
    it("caps a pathological request at the hard ceiling", () => {
      expect(clampTopK(50_000)).toBe(RETRIEVAL_HARD_CEILINGS.topK);
    });
    it("floors at 1, never 0", () => {
      expect(clampTopK(0)).toBe(1);
    });
  });

  describe("clampMaxExpansions", () => {
    it("returns the default when unspecified", () => {
      expect(clampMaxExpansions(undefined)).toBe(RETRIEVAL_DEFAULTS.maxExpansions);
    });
    it("caps a pathological request at the hard ceiling — THE bound the retrieval executor's loop cannot exceed", () => {
      expect(clampMaxExpansions(999_999)).toBe(RETRIEVAL_HARD_CEILINGS.maxExpansions);
      expect(clampMaxExpansions(Number.MAX_SAFE_INTEGER)).toBe(RETRIEVAL_HARD_CEILINGS.maxExpansions);
    });
    it("floors at 0, never negative", () => {
      expect(clampMaxExpansions(-5)).toBe(0);
    });
    it("falls back to the default for non-finite input", () => {
      expect(clampMaxExpansions(Number.POSITIVE_INFINITY)).toBe(RETRIEVAL_DEFAULTS.maxExpansions);
      expect(clampMaxExpansions(Number.NaN)).toBe(RETRIEVAL_DEFAULTS.maxExpansions);
    });
  });
});
