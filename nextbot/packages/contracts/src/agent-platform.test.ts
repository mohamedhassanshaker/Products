import { describe, expect, it } from "vitest";
import { Value } from "@sinclair/typebox/value";
import { ModelRouteChainEntrySchema } from "./agent-platform.js";

/**
 * Client-feedback-batch Phase 8 (item 5, layout half) regression coverage: the
 * client's screenshot showed a pasted email address saved into a provider chain
 * entry's `model` field. `ModelRouteChainEntrySchema.model` previously accepted
 * any non-empty string (`minLength: 1` only); it now also rejects whitespace and
 * `@` — the two shapes that are never a legitimate model id — while remaining
 * permissive enough to accept every real-world model-id shape this codebase's
 * providers actually use (bare names, dotted versions, and `provider/name`
 * shapes), since there is no single canonical model-id format across providers.
 */
describe("ModelRouteChainEntrySchema.model — light validation (client feedback item 5)", () => {
  function isValidModel(model: string): boolean {
    return Value.Check(ModelRouteChainEntrySchema, {
      providerKey: "openai-compatible",
      model,
    });
  }

  describe("accepts realistic model-id shapes across providers/conventions", () => {
    it.each([
      "gpt-4o",
      "gpt-4o-mini",
      "claude-opus-5",
      "claude-3-5-sonnet-20241022",
      "llama-3.1-70b-instruct",
      "openai/gpt-4o-mini",
      "meta-llama/Llama-3.1-8B-Instruct",
      "gemini-1.5-pro",
      "text-embedding-3-large",
    ])("%s", (model) => {
      expect(isValidModel(model)).toBe(true);
    });
  });

  describe("rejects obvious non-model-id shapes", () => {
    it("rejects an email address (the client's reported defect)", () => {
      expect(isValidModel("someone@example.com")).toBe(false);
    });

    it("rejects a string containing an internal space", () => {
      expect(isValidModel("gpt 4o")).toBe(false);
    });

    it("rejects a string with leading whitespace", () => {
      expect(isValidModel(" gpt-4o")).toBe(false);
    });

    it("rejects a string with trailing whitespace", () => {
      expect(isValidModel("gpt-4o ")).toBe(false);
    });

    it("rejects a string containing a tab/newline", () => {
      expect(isValidModel("gpt-4o\tmini")).toBe(false);
    });

    it("rejects an empty string (pre-existing minLength rule, unchanged)", () => {
      expect(isValidModel("")).toBe(false);
    });

    it("rejects a bare '@' handle-shaped string", () => {
      expect(isValidModel("@someone")).toBe(false);
    });
  });
});
