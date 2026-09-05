import { afterEach, describe, expect, it, vi } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { createProviderRegistration } from "./provider-service.js";
import { listCatalog } from "./catalog-service.js";
import { syncProviderCatalog } from "./catalog-sync-service.js";

/** Real Postgres, mocked `fetchImpl` (the actual external `/v1/models` HTTP call) —
 * exercises the real sync logic (create/update/retire) end-to-end. */
describe("catalog-sync-service — model-gateway.catalog-sync (ADR-0011 §2.1/§4, Target Architecture Blueprint Phase 1)", () => {
  const createdTenantIds: string[] = [];
  afterEach(async () => {
    for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
  });

  it("creates catalog entries from a mocked GET /v1/models response", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const provider = await createProviderRegistration(ctx, { type: "openai-compatible", name: "Sync target", baseUrl: "http://localhost:9100/v1" });

    const fakeFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: "gpt-4o" }, { id: "gpt-4o-mini" }] }),
    });

    const outcome = await syncProviderCatalog(ctx, provider.id, fakeFetch as unknown as typeof fetch);
    expect(outcome.created).toBe(2);
    expect(outcome.updated).toBe(0);
    expect(outcome.retired).toBe(0);

    const entries = await listCatalog(ctx, { providerId: provider.id });
    expect(entries.map((e) => e.modelId).sort()).toEqual(["gpt-4o", "gpt-4o-mini"]);
    expect(entries.every((e) => e.source === "Synced")).toBe(true);
  });

  it("re-syncing with a shrunk model list retires the missing model rather than deleting it (ADR-0011 §4)", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const provider = await createProviderRegistration(ctx, { type: "openai-compatible", name: "Sync target 2", baseUrl: "http://localhost:9101/v1" });

    const firstFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [{ id: "model-a" }, { id: "model-b" }] }) });
    await syncProviderCatalog(ctx, provider.id, firstFetch as unknown as typeof fetch);

    const secondFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [{ id: "model-a" }] }) });
    const outcome = await syncProviderCatalog(ctx, provider.id, secondFetch as unknown as typeof fetch);
    expect(outcome.retired).toBe(1);

    const entries = await listCatalog(ctx, { providerId: provider.id });
    const modelB = entries.find((e) => e.modelId === "model-b");
    expect(modelB).toBeDefined();
    expect(modelB?.status).toBe("Retired");
    // Never deleted — still exactly 2 rows.
    expect(entries).toHaveLength(2);
  });

  it("a model reappearing after being retired is re-activated to Available", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const provider = await createProviderRegistration(ctx, { type: "openai-compatible", name: "Sync target 3", baseUrl: "http://localhost:9102/v1" });

    await syncProviderCatalog(ctx, provider.id, vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [{ id: "model-x" }] }) }) as unknown as typeof fetch);
    await syncProviderCatalog(ctx, provider.id, vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) }) as unknown as typeof fetch);
    let entries = await listCatalog(ctx, { providerId: provider.id });
    expect(entries[0]?.status).toBe("Retired");

    await syncProviderCatalog(ctx, provider.id, vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [{ id: "model-x" }] }) }) as unknown as typeof fetch);
    entries = await listCatalog(ctx, { providerId: provider.id });
    expect(entries[0]?.status).toBe("Available");
  });

  it("a provider type with no discovery API (custom) rejects sync rather than silently returning an empty catalog", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const provider = await createProviderRegistration(ctx, { type: "custom", name: "Custom endpoint", baseUrl: "http://localhost:9999" });
    await expect(syncProviderCatalog(ctx, provider.id, vi.fn() as unknown as typeof fetch)).rejects.toThrow(/no catalog-sync mechanism/i);
  });
});
