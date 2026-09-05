import { afterEach, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { ModelCatalogEntryNotFoundError } from "@nextbot/contracts";
import { allFalseCapabilities } from "../domain/adapter-registry.js";
import { createProviderRegistration } from "./provider-service.js";
import { declareCatalogEntry, listCatalog, removeCatalogEntry, updateCatalogEntryDeclaration } from "./catalog-service.js";

describe("catalog-service — Model Catalog manual declaration (FR-AGT-21, Target Architecture Blueprint Phase 1)", () => {
  const createdTenantIds: string[] = [];
  afterEach(async () => {
    for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
  });

  it("declares a manual catalog entry with all-required capability flags", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const provider = await createProviderRegistration(ctx, { type: "openai-compatible", name: "vLLM", baseUrl: "http://localhost:8000/v1" });

    const entry = await declareCatalogEntry(ctx, {
      providerId: provider.id,
      modelId: "llama-3.1-70b-instruct",
      displayName: "Llama 3.1 70B Instruct",
      modality: "Text",
      contextWindow: 128000,
      maxOutput: 4096,
      capabilities: allFalseCapabilities({ toolCalling: true, streaming: true }),
      tokenizer: "llama3",
    });

    expect(entry.providerId).toBe(provider.id);
    expect(entry.source).toBe("Manual");
    expect(entry.tenantId).toBe(ctx.tenantId);
    expect(entry.capabilitiesJson).toMatchObject({ toolCalling: true, streaming: true, vision: false });
  });

  it("lists catalog entries filtered by providerId/modality/status", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const provider = await createProviderRegistration(ctx, { type: "openai-compatible", name: "vLLM 2", baseUrl: "http://localhost:8001/v1" });
    await declareCatalogEntry(ctx, {
      providerId: provider.id,
      modelId: "embed-model",
      displayName: "Embed model",
      modality: "Embedding",
      contextWindow: 8192,
      maxOutput: 1,
      dimension: 1536,
      capabilities: allFalseCapabilities(),
      tokenizer: "cl100k_base",
    });

    const all = await listCatalog(ctx, { providerId: provider.id });
    expect(all).toHaveLength(1);
    const byModality = await listCatalog(ctx, { providerId: provider.id, modality: "Text" });
    expect(byModality).toHaveLength(0);
    const byModalityMatch = await listCatalog(ctx, { providerId: provider.id, modality: "Embedding" });
    expect(byModalityMatch).toHaveLength(1);
  });

  it("updates a manual entry's declared fields", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const provider = await createProviderRegistration(ctx, { type: "openai-compatible", name: "vLLM 3", baseUrl: "http://localhost:8002/v1" });
    const entry = await declareCatalogEntry(ctx, {
      providerId: provider.id,
      modelId: "m1",
      displayName: "M1",
      modality: "Text",
      contextWindow: 4096,
      maxOutput: 1024,
      capabilities: allFalseCapabilities(),
      tokenizer: "cl100k_base",
    });

    const updated = await updateCatalogEntryDeclaration(ctx, entry.id, { contextWindow: 8192, priceIn: 1.5 });
    expect(updated.contextWindow).toBe(8192);
    expect(Number(updated.priceIn)).toBe(1.5);
  });

  it("throws ModelCatalogEntryNotFoundError updating a nonexistent entry", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    await expect(updateCatalogEntryDeclaration(ctx, "00000000-0000-0000-0000-000000000000", { contextWindow: 1 })).rejects.toBeInstanceOf(
      ModelCatalogEntryNotFoundError,
    );
  });

  it("hard-deletes a Manual entry, but only retires a Synced one (ADR-0011 §4 — never delete a synced model)", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const provider = await createProviderRegistration(ctx, { type: "openai-compatible", name: "vLLM 4", baseUrl: "http://localhost:8003/v1" });
    const manual = await declareCatalogEntry(ctx, {
      providerId: provider.id,
      modelId: "manual-1",
      displayName: "Manual 1",
      modality: "Text",
      contextWindow: 4096,
      maxOutput: 1024,
      capabilities: allFalseCapabilities(),
      tokenizer: "cl100k_base",
    });
    await removeCatalogEntry(ctx, manual.id);
    expect(await listCatalog(ctx, { providerId: provider.id })).toHaveLength(0);
  });
});
