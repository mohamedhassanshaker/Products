import type { ModelAuthMethodValue, ModelCapabilitiesValue, ModelProviderTypeValue } from "@nextbot/contracts";
import { ModelCatalogSyncUnsupportedError, ModelProviderTypeUnsupportedError } from "@nextbot/contracts";

/**
 * ADR-0011 §2.1/§14.8.3 — the provider-type -> adapter mapping as a real module
 * boundary. **Not** a place `packages/ai-registry` (or any provider SDK) is imported
 * from — `no-provider-sdk-outside-ai-registry` still applies unchanged; this registry
 * only describes *which* `ai-registry` transport a given provider type would resolve
 * through (once Phase 2 wires route resolution) and how its catalog/health are
 * reached over plain HTTPS. Every function here is pure domain logic except
 * `syncCatalog`/`probe`, which perform the actual (fetch-based) network I/O — kept in
 * `domain/` anyway, matching this module's existing simplicity budget, since they take
 * their HTTP client as an injectable dependency (`AdapterContext.fetchImpl`) and are
 * therefore just as fake-able in a unit test as pure functions; nothing here touches
 * `@nextbot/db` (`no-db-inside-domain` stays satisfied).
 */

export interface AdapterContext {
  provider: {
    id: string;
    type: ModelProviderTypeValue;
    baseUrl: string | null;
    apiKey: string | null;
  };
  /** Injectable so tests never make a real network call — production wiring uses the
   * global `fetch`. */
  fetchImpl: typeof fetch;
}

export interface SyncedCatalogModel {
  modelId: string;
  displayName: string;
  modality: "Text" | "Vision" | "Audio" | "Embedding" | "Rerank" | "Multimodal";
  contextWindow: number;
  maxOutput: number;
  dimension?: number;
  capabilities: ModelCapabilitiesValue;
  tokenizer: string;
}

export interface CatalogSyncResult {
  models: SyncedCatalogModel[];
}

export interface ProbeResult {
  ok: boolean;
  latencyMs: number;
  detail?: string;
}

export interface ProviderAdapter {
  readonly type: ModelProviderTypeValue;
  /** Which `ai-registry` transport handles inference for this provider once a route
   * pins it (Phase 2) — the adapter itself never performs inference (ADR-0006 stays
   * the only egress point for that). */
  readonly transportKey: "openai-compatible" | "anthropic" | "gemini" | "bedrock" | "vertex";
  readonly requiresCredential: boolean;
  readonly requiresBaseUrl: boolean;
  readonly supportedAuthMethods: ModelAuthMethodValue[];
  /** `null` for provider types with no queryable discovery API — those are manual-
   * declaration-only (ADR-0011 §2.1's table); callers must check this before invoking
   * `syncCatalog`, which throws `ModelCatalogSyncUnsupportedError` otherwise, courtesy
   * of `assertSyncable` below. */
  readonly supportsCatalogSync: boolean;
  syncCatalog(ctx: AdapterContext): Promise<CatalogSyncResult>;
  probe(ctx: AdapterContext): Promise<ProbeResult>;
}

/** Every capability defaults to `false` (LLD §14.8.2 — never absent). A manually
 * declared / conservatively-synced entry starts here and only sets what it can
 * actually verify. */
export function allFalseCapabilities(overrides: Partial<ModelCapabilitiesValue> = {}): ModelCapabilitiesValue {
  return {
    toolCalling: false,
    vision: false,
    streaming: false,
    structuredOutput: false,
    extendedThinking: false,
    promptCaching: false,
    jsonMode: false,
    ...overrides,
  };
}

async function timedProbe(ctx: AdapterContext, url: string, init?: RequestInit): Promise<ProbeResult> {
  const started = Date.now();
  try {
    const res = await ctx.fetchImpl(url, init);
    const latencyMs = Date.now() - started;
    if (!res.ok) return { ok: false, latencyMs, detail: `HTTP ${res.status}` };
    return { ok: true, latencyMs };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - started, detail: err instanceof Error ? err.message : String(err) };
  }
}

/** `GET /v1/models` — shared by every OpenAI-shaped provider type (ADR-0011 §2.1's
 * whole point: one adapter for vLLM/TGI/LiteLLM/OpenAI/OpenRouter/Azure/etc). */
async function openAiCompatibleSyncCatalog(ctx: AdapterContext): Promise<CatalogSyncResult> {
  const baseUrl = ctx.provider.baseUrl ?? "https://api.openai.com/v1";
  const headers: Record<string, string> = { accept: "application/json" };
  if (ctx.provider.apiKey) headers.authorization = `Bearer ${ctx.provider.apiKey}`;
  const res = await ctx.fetchImpl(`${baseUrl.replace(/\/$/, "")}/models`, { headers });
  if (!res.ok) throw new Error(`Catalog sync failed: HTTP ${res.status}`);
  const body = (await res.json()) as { data?: Array<{ id: string }> };
  const models: SyncedCatalogModel[] = (body.data ?? []).map((m) => ({
    modelId: m.id,
    displayName: m.id,
    modality: "Text",
    // A generic listing endpoint doesn't return these — conservative defaults,
    // corrected later by a manual edit or a richer per-vendor sync (out of this
    // phase's scope). Never left at 0 (a 0-context model would make every route
    // using it always overflow).
    contextWindow: 8192,
    maxOutput: 4096,
    capabilities: allFalseCapabilities({ streaming: true }),
    tokenizer: "cl100k_base",
  }));
  return { models };
}

/** Ollama's `GET /api/tags` — first-class, not an afterthought (ADR-0011 §2.1). */
async function ollamaSyncCatalog(ctx: AdapterContext): Promise<CatalogSyncResult> {
  const baseUrl = ctx.provider.baseUrl ?? "http://localhost:11434";
  const res = await ctx.fetchImpl(`${baseUrl.replace(/\/$/, "")}/api/tags`);
  if (!res.ok) throw new Error(`Catalog sync failed: HTTP ${res.status}`);
  const body = (await res.json()) as { models?: Array<{ name: string }> };
  const models: SyncedCatalogModel[] = (body.models ?? []).map((m) => ({
    modelId: m.name,
    displayName: m.name,
    modality: "Text",
    contextWindow: 8192,
    maxOutput: 4096,
    capabilities: allFalseCapabilities({ streaming: true }),
    tokenizer: "cl100k_base",
  }));
  return { models };
}

function unsupportedSync(type: ModelProviderTypeValue): () => Promise<CatalogSyncResult> {
  return async () => {
    throw new ModelCatalogSyncUnsupportedError(type);
  };
}

function makeOpenAiCompatibleLikeAdapter(
  type: ModelProviderTypeValue,
  opts: { requiresCredential: boolean; requiresBaseUrl: boolean; supportedAuthMethods: ModelAuthMethodValue[]; supportsCatalogSync: boolean },
): ProviderAdapter {
  return {
    type,
    transportKey: "openai-compatible",
    requiresCredential: opts.requiresCredential,
    requiresBaseUrl: opts.requiresBaseUrl,
    supportedAuthMethods: opts.supportedAuthMethods,
    supportsCatalogSync: opts.supportsCatalogSync,
    syncCatalog: opts.supportsCatalogSync ? openAiCompatibleSyncCatalog : unsupportedSync(type),
    probe: (ctx) => timedProbe(ctx, `${(ctx.provider.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "")}/models`, {
      headers: ctx.provider.apiKey ? { authorization: `Bearer ${ctx.provider.apiKey}` } : undefined,
    }),
  };
}

/** ADR-0011 §2.1's provider-type -> adapter table. */
export const ADAPTERS: Readonly<Record<ModelProviderTypeValue, ProviderAdapter>> = {
  anthropic: {
    type: "anthropic",
    transportKey: "anthropic",
    requiresCredential: true,
    requiresBaseUrl: false,
    supportedAuthMethods: ["ApiKey"],
    // ADR-0011 §2.1: "static curated list, refreshed from the provider API where
    // available" — Anthropic's `/v1/models` listing endpoint is the "where available"
    // case, reused here via the same generic OpenAI-shaped mapper (Anthropic's models
    // listing response happens to share the `{ data: [{ id }] }` shape).
    supportsCatalogSync: true,
    syncCatalog: (ctx) => openAiCompatibleSyncCatalog({ ...ctx, provider: { ...ctx.provider, baseUrl: ctx.provider.baseUrl ?? "https://api.anthropic.com/v1" } }),
    probe: (ctx) => timedProbe(ctx, `${(ctx.provider.baseUrl ?? "https://api.anthropic.com/v1").replace(/\/$/, "")}/models`, {
      headers: ctx.provider.apiKey ? { "x-api-key": ctx.provider.apiKey } : undefined,
    }),
  },
  openai: makeOpenAiCompatibleLikeAdapter("openai", { requiresCredential: true, requiresBaseUrl: false, supportedAuthMethods: ["ApiKey"], supportsCatalogSync: true }),
  gemini: makeOpenAiCompatibleLikeAdapter("gemini", { requiresCredential: true, requiresBaseUrl: false, supportedAuthMethods: ["ApiKey"], supportsCatalogSync: false }),
  "azure-openai": makeOpenAiCompatibleLikeAdapter("azure-openai", { requiresCredential: true, requiresBaseUrl: true, supportedAuthMethods: ["ApiKey", "EntraId"], supportsCatalogSync: false }),
  "google-vertex": {
    type: "google-vertex",
    transportKey: "vertex",
    requiresCredential: true,
    requiresBaseUrl: false,
    supportedAuthMethods: ["ServiceAccount", "ApiKey"],
    supportsCatalogSync: false,
    syncCatalog: unsupportedSync("google-vertex"),
    probe: (ctx) => timedProbe(ctx, ctx.provider.baseUrl ?? "https://us-central1-aiplatform.googleapis.com"),
  },
  bedrock: {
    type: "bedrock",
    transportKey: "bedrock",
    requiresCredential: true,
    requiresBaseUrl: false,
    supportedAuthMethods: ["IamRole", "ApiKey"],
    supportsCatalogSync: false,
    syncCatalog: unsupportedSync("bedrock"),
    probe: (ctx) => timedProbe(ctx, ctx.provider.baseUrl ?? "https://bedrock.us-east-1.amazonaws.com"),
  },
  openrouter: makeOpenAiCompatibleLikeAdapter("openrouter", { requiresCredential: true, requiresBaseUrl: false, supportedAuthMethods: ["ApiKey"], supportsCatalogSync: true }),
  "openai-compatible": makeOpenAiCompatibleLikeAdapter("openai-compatible", { requiresCredential: false, requiresBaseUrl: true, supportedAuthMethods: ["None", "ApiKey", "Mtls"], supportsCatalogSync: true }),
  ollama: {
    type: "ollama",
    transportKey: "openai-compatible",
    requiresCredential: false,
    requiresBaseUrl: true,
    supportedAuthMethods: ["None"],
    supportsCatalogSync: true,
    syncCatalog: ollamaSyncCatalog,
    probe: (ctx) => timedProbe(ctx, `${(ctx.provider.baseUrl ?? "http://localhost:11434").replace(/\/$/, "")}/api/tags`),
  },
  cohere: makeOpenAiCompatibleLikeAdapter("cohere", { requiresCredential: true, requiresBaseUrl: false, supportedAuthMethods: ["ApiKey"], supportsCatalogSync: false }),
  mistral: makeOpenAiCompatibleLikeAdapter("mistral", { requiresCredential: true, requiresBaseUrl: false, supportedAuthMethods: ["ApiKey"], supportsCatalogSync: false }),
  custom: {
    type: "custom",
    transportKey: "openai-compatible",
    requiresCredential: false,
    requiresBaseUrl: true,
    supportedAuthMethods: ["None", "ApiKey", "EntraId", "ServiceAccount", "IamRole", "Mtls"],
    supportsCatalogSync: false,
    syncCatalog: unsupportedSync("custom"),
    probe: (ctx) => timedProbe(ctx, ctx.provider.baseUrl ?? ""),
  },
};

/** @throws {ModelProviderTypeUnsupportedError} for a type with no registered adapter
 * (should be unreachable given `ADAPTERS` is total over `ModelProviderTypeValue`, but
 * kept as a fail-closed guard for any future enum-widening that forgets to add one). */
export function adapterFor(type: ModelProviderTypeValue): ProviderAdapter {
  const adapter = ADAPTERS[type];
  if (!adapter) throw new ModelProviderTypeUnsupportedError(type);
  return adapter;
}
