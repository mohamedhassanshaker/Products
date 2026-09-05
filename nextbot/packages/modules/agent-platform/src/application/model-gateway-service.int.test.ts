import { afterEach, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import type { TenantContext } from "@nextbot/db";
import { startMockOpenAiCompatibleServer, type MockOpenAiServerHandle } from "@nextbot/testing";
import { Type } from "@sinclair/typebox";
import { createProviderRegistration, createRoute, createRouteVersion, declareCatalogEntry } from "@nextbot/model-gateway";
import { resolveModelChainForRoute, callModelGatewayText, callModelGatewayStructured } from "./model-gateway-service.js";

/**
 * Target Architecture Blueprint Phase 2 (BL-33, LLD §14.9.6) — this file now proves
 * only that `agent-platform`'s re-export of `@nextbot/model-gateway`'s call path
 * (`resolveModelChainForRoute`/`callModelGatewayText`) genuinely reaches the real
 * Route v2 resolution logic through the `agent-platform -> model-gateway` module
 * edge. The exhaustive capability/residency/plan-tier coverage for that logic itself
 * lives in `@nextbot/model-gateway`'s own test suite (`gateway-call-service.int.test.ts`,
 * `route-service.int.test.ts`), not duplicated here.
 */
async function pinRoute(ctx: TenantContext, routeKey: string, opts: { baseUrl?: string; region?: "UAE" | "EU" | "US"; providerRegionsServed?: string[]; cacheMode?: "Off" | "ExactMatch" }) {
  const provider = await createProviderRegistration(ctx, {
    type: "openai-compatible",
    name: `Provider for ${routeKey}`,
    baseUrl: opts.baseUrl,
    region: opts.region ?? ctx.region,
    regionsServed: opts.providerRegionsServed,
    retainsPrompts: false,
    trainsOnData: false,
  });
  const entry = await declareCatalogEntry(ctx, {
    providerId: provider.id,
    modelId: "test-model",
    displayName: "Test Model",
    modality: "Text",
    contextWindow: 8192,
    maxOutput: 4096,
    capabilities: { toolCalling: false, vision: false, streaming: true, structuredOutput: false, extendedThinking: false, promptCaching: false, jsonMode: false },
    tokenizer: "cl100k_base",
  });
  const route = await createRoute(ctx, { name: routeKey });
  await createRouteVersion(
    ctx,
    route.id,
    {
      chain: [{ ordinal: 0, providerId: provider.id, catalogEntryId: entry.id, params: {}, timeoutMs: 30000 }],
      policy: { strategy: "FixedPriority", failoverOn: ["429", "5xx", "timeout"], retry: { maxPerHop: 1, backoff: "exponential" }, totalTimeoutMs: 30000, cacheMode: opts.cacheMode ?? "Off", onBudgetBreach: "Fail", allowOutOfRegionFailover: false },
    },
    true,
  );
  return { provider, entry, route };
}

describe("model-gateway-service (agent-platform's re-export of the Route v2 call path, FR-AGT-07/08/20-25)", () => {
  let ctx: TenantContext;
  let server: MockOpenAiServerHandle | undefined;
  afterEach(async () => {
    await server?.close();
    server = undefined;
    if (ctx) await deleteFixtureTenant(ctx.tenantId);
  });

  it("falls back to the ai-registry env default when no route exists at all for this route key", async () => {
    ctx = await createFixtureTenant();
    process.env.AI_PROVIDER = "openai-compatible";
    process.env.AI_MODEL_CHAT_PRIMARY = "env-default-model";
    const { chain } = await resolveModelChainForRoute(ctx, "chat.primary");
    expect(chain).toHaveLength(1);
    expect(chain[0]?.model).toBe("env-default-model");
  });

  it("uses a Published Route v2 chain (catalog-entry-pinned) when one exists, real HTTP round trip", async () => {
    ctx = await createFixtureTenant();
    server = await startMockOpenAiCompatibleServer({ onChatCompletion: () => ({ content: "Hello from the tenant's own route." }) });
    await pinRoute(ctx, "chat.primary", { baseUrl: server.url });

    const text = await callModelGatewayText(ctx, { routeKey: "chat.primary", messages: [{ role: "user", content: "hi" }] });
    expect(text).toBe("Hello from the tenant's own route.");
  });

  it("caches an ExactMatch route's response and does not call the provider a second time for the same prompt", async () => {
    ctx = await createFixtureTenant();
    let callCount = 0;
    server = await startMockOpenAiCompatibleServer({
      onChatCompletion: () => {
        callCount += 1;
        return { content: "cached response" };
      },
    });
    await pinRoute(ctx, "chat.primary", { baseUrl: server.url, cacheMode: "ExactMatch" });

    const first = await callModelGatewayText(ctx, { routeKey: "chat.primary", messages: [{ role: "user", content: "same prompt" }] });
    const second = await callModelGatewayText(ctx, { routeKey: "chat.primary", messages: [{ role: "user", content: "same prompt" }] });
    expect(first).toBe("cached response");
    expect(second).toBe("cached response");
    expect(callCount).toBe(1);
  });

  it("callModelGatewayStructured re-validates the model's JSON against the schema through the real Route v2 chain (LLD §7.2)", async () => {
    ctx = await createFixtureTenant();
    server = await startMockOpenAiCompatibleServer({ onChatCompletion: () => ({ content: JSON.stringify({ toolName: "lookup_order", confidence: 0.9 }) }) });
    await pinRoute(ctx, "chat.router", { baseUrl: server.url });

    const Schema = Type.Object({ toolName: Type.String(), confidence: Type.Number() });
    const result = await callModelGatewayStructured(ctx, { routeKey: "chat.router", schema: Schema, system: "Select a tool.", messages: [{ role: "user", content: "hi" }] });
    expect(result).toEqual({ toolName: "lookup_order", confidence: 0.9 });
  });

  // Residency filtering (FR-SEC-05/FR-AGT-25) has MOVED earlier in the lifecycle:
  // Phase 2 rejects an out-of-region hop at ROUTE SAVE TIME (see
  // `@nextbot/model-gateway`'s `route-service.int.test.ts`), so there is no longer a
  // way to reach a runtime "resolve a saved out-of-region route" state through the
  // ordinary create path this helper uses — that is the intended, stronger
  // FR-AGT-25 behavior this phase adds, not a regression of the old runtime-only
  // filter this test previously exercised.
});
