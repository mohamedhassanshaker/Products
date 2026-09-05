import { afterEach, describe, expect, it } from "vitest";
import {
  createFixtureTenant,
  deleteFixtureTenant,
  createFixturePlatformModelProvider,
  deleteFixturePlatformModelProvider,
} from "@nextbot/db/testing";
import { ModelProviderNotFoundError } from "@nextbot/contracts";
import {
  createProviderRegistration,
  listProviderRegistrations,
  updateProviderRegistration,
  deactivateProviderRegistration,
} from "./provider-service.js";

describe("provider-service — Provider Registry CRUD (FR-AGT-20, Target Architecture Blueprint Phase 1)", () => {
  const createdTenantIds: string[] = [];
  afterEach(async () => {
    for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
  });

  it("creates a tenant-owned BYO provider, vaulting a supplied plaintext API key", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);

    const provider = await createProviderRegistration(ctx, {
      type: "openai",
      name: "My OpenAI account",
      apiKeyPlaintext: "sk-test-12345",
      regionsServed: ["US"],
    });

    expect(provider.tenantId).toBe(ctx.tenantId);
    expect(provider.type).toBe("openai");
    expect(provider.authMethod).toBe("ApiKey");
    expect(provider.credentialId).toBeTruthy();
    // The plaintext never lands in a model_provider column.
    expect(JSON.stringify(provider)).not.toContain("sk-test-12345");
  });

  it("a self-hosted openai-compatible provider needs no credential", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);

    const provider = await createProviderRegistration(ctx, {
      type: "openai-compatible",
      name: "My vLLM endpoint",
      baseUrl: "http://localhost:8000/v1",
    });

    expect(provider.authMethod).toBe("None");
    expect(provider.credentialId).toBeNull();
    expect(provider.baseUrl).toBe("http://localhost:8000/v1");
  });

  it("listProviderRegistrations returns the tenant's own providers plus platform-shared ones (RLS §14.8.7)", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);

    const own = await createProviderRegistration(ctx, { type: "openai-compatible", name: "Own provider", baseUrl: "http://localhost:9/v1" });
    const platformId = await createFixturePlatformModelProvider({ type: "custom", name: `Platform provider ${Date.now()}`, baseUrl: "http://localhost:9/v1" });

    try {
      const rows = await listProviderRegistrations(ctx);
      expect(rows.some((r) => r.id === own.id)).toBe(true);
      expect(rows.some((r) => r.id === platformId)).toBe(true);
    } finally {
      await deleteFixturePlatformModelProvider(platformId);
    }
  });

  it("updateProviderRegistration rejects updating a provider that isn't this tenant's own (platform or another tenant's)", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);

    const platformId = await createFixturePlatformModelProvider({ type: "custom", name: `Platform provider ${Date.now()}`, baseUrl: "http://localhost:9/v1" });
    try {
      await expect(updateProviderRegistration(ctx, platformId, { name: "Hijacked" })).rejects.toBeInstanceOf(ModelProviderNotFoundError);
    } finally {
      await deleteFixturePlatformModelProvider(platformId);
    }
  });

  it("rejects creating a self-hosted provider with no base URL (application-layer validation)", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    await expect(createProviderRegistration(ctx, { type: "ollama", name: "No base URL" })).rejects.toThrow(/base URL/i);
  });

  it("updateProviderRegistration can rotate the vaulted credential via a new apiKeyPlaintext", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const provider = await createProviderRegistration(ctx, { type: "openai", name: "Rotate me", apiKeyPlaintext: "sk-original" });
    const firstCredentialId = provider.credentialId;

    const updated = await updateProviderRegistration(ctx, provider.id, { apiKeyPlaintext: "sk-rotated" });
    expect(updated.credentialId).toBeTruthy();
    expect(updated.credentialId).not.toBe(firstCredentialId);
  });

  it("deactivateProviderRegistration sets enabled=false without deleting the row", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);

    const provider = await createProviderRegistration(ctx, { type: "openai-compatible", name: "To deactivate", baseUrl: "http://localhost:7/v1" });
    const deactivated = await deactivateProviderRegistration(ctx, provider.id);
    expect(deactivated.enabled).toBe(false);
    expect(deactivated.id).toBe(provider.id);

    const rows = await listProviderRegistrations(ctx);
    expect(rows.find((r) => r.id === provider.id)?.enabled).toBe(false);
  });
});
