import { describe, expect, it, vi } from "vitest";
import { ModelCatalogSyncUnsupportedError, ModelProviderTypeUnsupportedError } from "@nextbot/contracts";
import { ADAPTERS, adapterFor, allFalseCapabilities, type AdapterContext } from "./adapter-registry.js";

function fakeCtx(overrides: Partial<AdapterContext["provider"]> = {}, fetchImpl: typeof fetch = vi.fn() as unknown as typeof fetch): AdapterContext {
  return {
    provider: { id: "p1", type: "openai-compatible", baseUrl: "https://my-endpoint.example.com/v1", apiKey: null, ...overrides },
    fetchImpl,
  };
}

describe("allFalseCapabilities", () => {
  it("defaults every capability to false (LLD §14.8.2 — never absent)", () => {
    expect(allFalseCapabilities()).toEqual({
      toolCalling: false,
      vision: false,
      streaming: false,
      structuredOutput: false,
      extendedThinking: false,
      promptCaching: false,
      jsonMode: false,
    });
  });

  it("applies overrides on top of the all-false baseline", () => {
    expect(allFalseCapabilities({ streaming: true, toolCalling: true })).toMatchObject({
      streaming: true,
      toolCalling: true,
      vision: false,
    });
  });
});

describe("adapterFor / ADAPTERS — ADR-0011 §2.1's provider-type -> adapter table", () => {
  it("every ModelProviderType value has a registered adapter", () => {
    const types = Object.keys(ADAPTERS);
    expect(types.sort()).toEqual(
      [
        "openai",
        "anthropic",
        "gemini",
        "azure-openai",
        "openai-compatible",
        "google-vertex",
        "bedrock",
        "openrouter",
        "ollama",
        "cohere",
        "mistral",
        "custom",
      ].sort(),
    );
  });

  it("throws ModelProviderTypeUnsupportedError for an unrecognized type", () => {
    // @ts-expect-error deliberately invalid input, proving the fail-closed guard
    expect(() => adapterFor("not-a-real-type")).toThrow(ModelProviderTypeUnsupportedError);
  });

  it("ollama and openai-compatible require no credential — self-hosted is first-class (ADR-0011 §2.1)", () => {
    expect(adapterFor("ollama").requiresCredential).toBe(false);
    expect(adapterFor("openai-compatible").requiresCredential).toBe(false);
  });

  it("openai/anthropic/bedrock/google-vertex require a credential", () => {
    expect(adapterFor("openai").requiresCredential).toBe(true);
    expect(adapterFor("bedrock").requiresCredential).toBe(true);
    expect(adapterFor("google-vertex").requiresCredential).toBe(true);
  });

  it("a provider type with no discovery API rejects syncCatalog with ModelCatalogSyncUnsupportedError", async () => {
    await expect(adapterFor("custom").syncCatalog(fakeCtx({ type: "custom" }))).rejects.toThrow(ModelCatalogSyncUnsupportedError);
    await expect(adapterFor("bedrock").syncCatalog(fakeCtx({ type: "bedrock" }))).rejects.toThrow(ModelCatalogSyncUnsupportedError);
  });
});

describe("openai-compatible-shaped syncCatalog (openai, openai-compatible, openrouter — ADR-0011 §2.1)", () => {
  it("maps a GET /v1/models response into SyncedCatalogModel entries", async () => {
    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: "gpt-4o" }, { id: "gpt-4o-mini" }] }),
    });
    const result = await adapterFor("openai-compatible").syncCatalog(fakeCtx({}, fakeFetch as unknown as typeof fetch));
    expect(result.models.map((m) => m.modelId)).toEqual(["gpt-4o", "gpt-4o-mini"]);
    expect(result.models[0]?.capabilities.streaming).toBe(true);
    expect(fakeFetch).toHaveBeenCalledWith("https://my-endpoint.example.com/v1/models", expect.any(Object));
  });

  it("sends a bearer Authorization header when the provider has an api key", async () => {
    const fakeFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) });
    await adapterFor("openai-compatible").syncCatalog(fakeCtx({ apiKey: "sk-test" }, fakeFetch as unknown as typeof fetch));
    expect(fakeFetch).toHaveBeenCalledWith(expect.any(String), { headers: { accept: "application/json", authorization: "Bearer sk-test" } });
  });

  it("throws on a non-ok HTTP response rather than silently returning an empty catalog", async () => {
    const fakeFetch = vi.fn().mockResolvedValue({ ok: false, status: 401 });
    await expect(adapterFor("openai-compatible").syncCatalog(fakeCtx({}, fakeFetch as unknown as typeof fetch))).rejects.toThrow(/401/);
  });
});

describe("ollama syncCatalog (GET /api/tags)", () => {
  it("maps a tags response into SyncedCatalogModel entries", async () => {
    const fakeFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ models: [{ name: "llama3.1:70b" }] }) });
    const result = await adapterFor("ollama").syncCatalog(fakeCtx({ type: "ollama", baseUrl: "http://localhost:11434", apiKey: null }, fakeFetch as unknown as typeof fetch));
    expect(result.models).toEqual([
      expect.objectContaining({ modelId: "llama3.1:70b", capabilities: expect.objectContaining({ streaming: true }) }),
    ]);
  });
});

describe("probe — a distinct, alertable Unreachable state, never a silent outage (FR-AGT-20)", () => {
  it("reports ok:true with a latency for a reachable endpoint", async () => {
    const fakeFetch = vi.fn().mockResolvedValue({ ok: true });
    const result = await adapterFor("openai-compatible").probe(fakeCtx({}, fakeFetch as unknown as typeof fetch));
    expect(result.ok).toBe(true);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("reports ok:false with a detail when the endpoint throws (network error)", async () => {
    const fakeFetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const result = await adapterFor("ollama").probe(fakeCtx({ type: "ollama", baseUrl: "http://localhost:11434" }, fakeFetch as unknown as typeof fetch));
    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/ECONNREFUSED/);
  });

  it("reports ok:false with the HTTP status when the endpoint answers but rejects", async () => {
    const fakeFetch = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    const result = await adapterFor("openai-compatible").probe(fakeCtx({}, fakeFetch as unknown as typeof fetch));
    expect(result.ok).toBe(false);
    expect(result.detail).toBe("HTTP 503");
  });
});
