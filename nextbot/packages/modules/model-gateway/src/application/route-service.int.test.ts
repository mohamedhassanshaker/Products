import { afterEach, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import type { TenantContext } from "@nextbot/db";
import { RouteValidationFailedError } from "@nextbot/contracts";
import { createProviderRegistration } from "../application/provider-service.js";
import { declareCatalogEntry } from "../application/catalog-service.js";
import { createRoute, createRouteVersion, getStandardRoutesChecklist, validateRouteVersionDryRun } from "./route-service.js";
import { updateTenantDataPolicy } from "@nextbot/tenancy";

/**
 * Target Architecture Blueprint Phase 2 (BL-33, ADR-0011 §2.2, LLD §14.8.4,
 * FR-AGT-20-26) — real-Postgres proof that `createRouteVersion` rejects a save
 * (never accepts then fails later at call time) for the exact scenarios this
 * dispatch's verification list calls out.
 */
describe("route-service (FR-AGT-22/25/26, real Postgres)", () => {
  let ctx: TenantContext;
  afterEach(async () => {
    if (ctx) await deleteFixtureTenant(ctx.tenantId);
  });

  it("rejects a route save whose chain would breach the tenant's configured residency setting", async () => {
    ctx = await createFixtureTenant({ region: "UAE" });
    const provider = await createProviderRegistration(ctx, { type: "openai-compatible", name: "Out-of-region", baseUrl: "http://localhost:9/v1", region: "EU", retainsPrompts: false, trainsOnData: false });
    const entry = await declareCatalogEntry(ctx, {
      providerId: provider.id,
      modelId: "m",
      displayName: "m",
      modality: "Text",
      contextWindow: 8192,
      maxOutput: 4096,
      capabilities: { toolCalling: true, vision: false, streaming: true, structuredOutput: false, extendedThinking: false, promptCaching: false, jsonMode: false },
      tokenizer: "cl100k_base",
    });
    const route = await createRoute(ctx, { name: "chat.residency-test" });

    await expect(
      createRouteVersion(
        ctx,
        route.id,
        {
          chain: [{ ordinal: 0, providerId: provider.id, catalogEntryId: entry.id, params: {}, timeoutMs: 30000 }],
          policy: { strategy: "FixedPriority", failoverOn: ["429"], retry: { maxPerHop: 1, backoff: "none" }, totalTimeoutMs: 30000, cacheMode: "Off", onBudgetBreach: "Fail", allowOutOfRegionFailover: false },
        },
        true,
      ),
    ).rejects.toBeInstanceOf(RouteValidationFailedError);
  });

  it("allows an out-of-region hop only when BOTH the route policy AND the tenant's own residency opt-in are set", async () => {
    ctx = await createFixtureTenant({ region: "UAE" });
    await updateTenantDataPolicy(ctx, { allowOutOfRegionInference: true });
    const provider = await createProviderRegistration(ctx, { type: "openai-compatible", name: "Out-of-region, opted in", baseUrl: "http://localhost:9/v1", region: "EU", retainsPrompts: false, trainsOnData: false });
    const entry = await declareCatalogEntry(ctx, {
      providerId: provider.id,
      modelId: "m",
      displayName: "m",
      modality: "Text",
      contextWindow: 8192,
      maxOutput: 4096,
      capabilities: { toolCalling: true, vision: false, streaming: true, structuredOutput: false, extendedThinking: false, promptCaching: false, jsonMode: false },
      tokenizer: "cl100k_base",
    });
    const route = await createRoute(ctx, { name: "chat.residency-opt-in-test" });

    const version = await createRouteVersion(
      ctx,
      route.id,
      {
        chain: [{ ordinal: 0, providerId: provider.id, catalogEntryId: entry.id, params: {}, timeoutMs: 30000 }],
        policy: { strategy: "FixedPriority", failoverOn: ["429"], retry: { maxPerHop: 1, backoff: "none" }, totalTimeoutMs: 30000, cacheMode: "Off", onBudgetBreach: "Fail", allowOutOfRegionFailover: true },
      },
      true,
    );
    expect(version.status).toBe("Published");
  });

  it("rejects a route version referencing a catalog entry that belongs to a different provider than the hop's providerId", async () => {
    ctx = await createFixtureTenant();
    const providerA = await createProviderRegistration(ctx, { type: "openai-compatible", name: "A", baseUrl: "http://localhost:9/v1", retainsPrompts: false, trainsOnData: false });
    const providerB = await createProviderRegistration(ctx, { type: "openai-compatible", name: "B", baseUrl: "http://localhost:9/v1", retainsPrompts: false, trainsOnData: false });
    const entryOnB = await declareCatalogEntry(ctx, {
      providerId: providerB.id,
      modelId: "m",
      displayName: "m",
      modality: "Text",
      contextWindow: 8192,
      maxOutput: 4096,
      capabilities: { toolCalling: false, vision: false, streaming: true, structuredOutput: false, extendedThinking: false, promptCaching: false, jsonMode: false },
      tokenizer: "cl100k_base",
    });
    const route = await createRoute(ctx, { name: "chat.mismatch-test" });

    await expect(
      createRouteVersion(
        ctx,
        route.id,
        {
          chain: [{ ordinal: 0, providerId: providerA.id, catalogEntryId: entryOnB.id, params: {}, timeoutMs: 30000 }],
          policy: { strategy: "FixedPriority", failoverOn: ["429"], retry: { maxPerHop: 1, backoff: "none" }, totalTimeoutMs: 30000, cacheMode: "Off", onBudgetBreach: "Fail", allowOutOfRegionFailover: false },
        },
        true,
      ),
    ).rejects.toBeInstanceOf(RouteValidationFailedError);
  });

  it("getStandardRoutesChecklist reports FR-AGT-23's recommended routes as unconfigured until a matching route exists", async () => {
    ctx = await createFixtureTenant();
    const before = await getStandardRoutesChecklist(ctx);
    expect(before.find((r) => r.role === "chat.primary")?.configured).toBe(false);

    await createRoute(ctx, { name: "chat.primary", role: "chat.primary" });
    const after = await getStandardRoutesChecklist(ctx);
    expect(after.find((r) => r.role === "chat.primary")?.configured).toBe(true);
  });

  it("publishing a Draft version sets it as the route's current_version_id", async () => {
    ctx = await createFixtureTenant();
    const provider = await createProviderRegistration(ctx, { type: "openai-compatible", name: "Draft-then-publish", baseUrl: "http://localhost:9/v1", retainsPrompts: false, trainsOnData: false });
    const entry = await declareCatalogEntry(ctx, {
      providerId: provider.id,
      modelId: "m",
      displayName: "m",
      modality: "Text",
      contextWindow: 8192,
      maxOutput: 4096,
      capabilities: { toolCalling: true, vision: false, streaming: true, structuredOutput: false, extendedThinking: false, promptCaching: false, jsonMode: false },
      tokenizer: "cl100k_base",
    });
    const route = await createRoute(ctx, { name: "chat.draft-test" });
    const draft = await createRouteVersion(
      ctx,
      route.id,
      {
        chain: [{ ordinal: 0, providerId: provider.id, catalogEntryId: entry.id, params: {}, timeoutMs: 30000 }],
        policy: { strategy: "FixedPriority", failoverOn: ["429"], retry: { maxPerHop: 1, backoff: "none" }, totalTimeoutMs: 30000, cacheMode: "Off", onBudgetBreach: "Fail", allowOutOfRegionFailover: false },
      },
      false,
    );
    expect(draft.status).toBe("Draft");

    const { publishRouteVersion } = await import("./route-service.js");
    const published = await publishRouteVersion(ctx, route.id, draft.id);
    expect(published.status).toBe("Published");
  });

  it("validateRouteVersionDryRun returns the same validation result as a real save, but never writes anything", async () => {
    ctx = await createFixtureTenant();
    const provider = await createProviderRegistration(ctx, { type: "openai-compatible", name: "Dry-run", baseUrl: "http://localhost:9/v1", retainsPrompts: false, trainsOnData: false });
    const entry = await declareCatalogEntry(ctx, {
      providerId: provider.id,
      modelId: "m",
      displayName: "m",
      modality: "Text",
      contextWindow: 8192,
      maxOutput: 4096,
      capabilities: { toolCalling: true, vision: false, streaming: true, structuredOutput: false, extendedThinking: false, promptCaching: false, jsonMode: false },
      tokenizer: "cl100k_base",
    });
    const route = await createRoute(ctx, { name: "chat.dry-run-test" });

    const result = await validateRouteVersionDryRun(ctx, route.id, {
      chain: [{ ordinal: 0, providerId: provider.id, catalogEntryId: entry.id, params: {}, timeoutMs: 30000 }],
      policy: { strategy: "FixedPriority", failoverOn: ["429"], retry: { maxPerHop: 1, backoff: "none" }, totalTimeoutMs: 30000, cacheMode: "Off", onBudgetBreach: "Fail", allowOutOfRegionFailover: false },
    });
    expect(result.errors).toHaveLength(0);
    expect(result.advertisedCapabilities).toMatchObject({ toolCalling: true });

    const versions = await import("./route-service.js").then((m) => m.listVersionsForRoute(ctx, route.id));
    expect(versions).toHaveLength(0);
  });

  it("validateRouteVersionDryRun surfaces an unresolvable hop (unknown providerId) as a resolution error, never throwing", async () => {
    ctx = await createFixtureTenant();
    const route = await createRoute(ctx, { name: "chat.dry-run-unresolvable" });
    const result = await validateRouteVersionDryRun(ctx, route.id, {
      chain: [{ ordinal: 0, providerId: "00000000-0000-0000-0000-000000000000", catalogEntryId: "00000000-0000-0000-0000-000000000000", params: {}, timeoutMs: 30000 }],
      policy: { strategy: "FixedPriority", failoverOn: ["429"], retry: { maxPerHop: 1, backoff: "none" }, totalTimeoutMs: 30000, cacheMode: "Off", onBudgetBreach: "Fail", allowOutOfRegionFailover: false },
    });
    expect(result.errors.some((e) => e.code === "MODEL_PROVIDER_NOT_FOUND")).toBe(true);
    expect(result.advertisedCapabilities).toBeNull();
  });
});
