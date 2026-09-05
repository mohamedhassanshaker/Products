import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadAiRegistryEnv, resetAiRegistryEnvCacheForTests, resolveEnvModelId } from "./config.js";

const ORIGINAL_ENV = { ...process.env };

describe("loadAiRegistryEnv", () => {
  beforeEach(() => {
    resetAiRegistryEnvCacheForTests();
    process.env = { ...ORIGINAL_ENV };
  });
  afterEach(() => {
    resetAiRegistryEnvCacheForTests();
    process.env = { ...ORIGINAL_ENV };
  });

  it("throws a startup-failure error when AI_PROVIDER is missing (LLD §11.10: fail at startup, never at request time)", () => {
    delete process.env.AI_PROVIDER;
    process.env.AI_MODEL_CHAT_PRIMARY = "gpt-4o-mini";
    expect(() => loadAiRegistryEnv()).toThrow(/Invalid @nextbot\/ai-registry environment configuration/);
  });

  it("throws when AI_PROVIDER is not one of the four known values", () => {
    process.env.AI_PROVIDER = "totally-made-up-provider";
    process.env.AI_MODEL_CHAT_PRIMARY = "gpt-4o-mini";
    expect(() => loadAiRegistryEnv()).toThrow();
  });

  it("throws when AI_MODEL_CHAT_PRIMARY is missing", () => {
    process.env.AI_PROVIDER = "openai-compatible";
    delete process.env.AI_MODEL_CHAT_PRIMARY;
    expect(() => loadAiRegistryEnv()).toThrow();
  });

  it("parses successfully with only the two required vars set", () => {
    process.env.AI_PROVIDER = "openai-compatible";
    process.env.AI_MODEL_CHAT_PRIMARY = "gpt-4o-mini";
    const env = loadAiRegistryEnv();
    expect(env.AI_PROVIDER).toBe("openai-compatible");
    expect(env.AI_MODEL_CHAT_PRIMARY).toBe("gpt-4o-mini");
  });

  it("caches the parsed result across calls until reset", () => {
    process.env.AI_PROVIDER = "openai-compatible";
    process.env.AI_MODEL_CHAT_PRIMARY = "gpt-4o-mini";
    const first = loadAiRegistryEnv();
    process.env.AI_PROVIDER = "anthropic";
    const second = loadAiRegistryEnv();
    expect(second).toBe(first);
  });

  // QA Final Review B2: docker-compose.yml sets optional AI model env vars using
  // `${VAR:-}` (empty-string default) rather than leaving them genuinely unset.
  // Every optional field must tolerate that without throwing, or every real
  // deployment using that compose file's own defaults fails startup validation.
  it("treats an empty-string optional var the same as an unset one (docker-compose's `${VAR:-}` pattern)", () => {
    process.env.AI_PROVIDER = "openai-compatible";
    process.env.AI_MODEL_CHAT_PRIMARY = "gpt-4o-mini";
    process.env.AI_API_KEY = "";
    process.env.AI_MODEL_CHAT_FAST = "";
    process.env.AI_MODEL_REASONING_PLANNER = "";
    process.env.AI_MODEL_CLASSIFY_GUARDRAIL = "";
    process.env.AI_MODEL_SUMMARIZE = "";
    process.env.AI_MODEL_EMBED = "";

    const env = loadAiRegistryEnv();
    expect(env.AI_API_KEY).toBeUndefined();
    expect(env.AI_MODEL_CHAT_FAST).toBeUndefined();
    expect(env.AI_MODEL_REASONING_PLANNER).toBeUndefined();
    expect(env.AI_MODEL_CLASSIFY_GUARDRAIL).toBeUndefined();
    expect(env.AI_MODEL_SUMMARIZE).toBeUndefined();
    expect(env.AI_MODEL_EMBED).toBeUndefined();
  });
});

describe("resolveEnvModelId", () => {
  beforeEach(() => {
    resetAiRegistryEnvCacheForTests();
    process.env = { ...ORIGINAL_ENV };
    process.env.AI_PROVIDER = "openai-compatible";
    process.env.AI_MODEL_CHAT_PRIMARY = "gpt-4o-mini";
  });
  afterEach(() => {
    resetAiRegistryEnvCacheForTests();
    process.env = { ...ORIGINAL_ENV };
  });

  it("falls back to chat.primary's model when a more specific logical name has no dedicated env var", () => {
    delete process.env.AI_MODEL_CLASSIFY_GUARDRAIL;
    expect(resolveEnvModelId("classify.guardrail")).toBe("gpt-4o-mini");
  });

  it("uses the dedicated env var when one is set for that logical name", () => {
    process.env.AI_MODEL_CLASSIFY_GUARDRAIL = "gpt-4o-nano";
    resetAiRegistryEnvCacheForTests();
    expect(resolveEnvModelId("classify.guardrail")).toBe("gpt-4o-nano");
  });
});
