import { afterEach, describe, expect, it, vi } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { createProviderRegistration, listProviderRegistrations } from "./provider-service.js";
import { probeProvider } from "./provider-probe-service.js";

describe("provider-probe-service — model-gateway.provider-probe (FR-AGT-20, Target Architecture Blueprint Phase 1)", () => {
  const createdTenantIds: string[] = [];
  afterEach(async () => {
    for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
  });

  it("a reachable endpoint is recorded Active with a last_probe_at timestamp", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const provider = await createProviderRegistration(ctx, { type: "openai-compatible", name: "Reachable", baseUrl: "http://localhost:9200/v1" });

    const fakeFetch = vi.fn().mockResolvedValue({ ok: true });
    const probed = await probeProvider(ctx, provider.id, fakeFetch as unknown as typeof fetch);

    expect(probed.status).toBe("Active");
    expect(probed.lastProbeAt).toBeInstanceOf(Date);
    expect(probed.lastProbeError).toBeNull();
  });

  it("an unreachable endpoint is recorded Unreachable — a distinct, alertable state, never silent (FR-AGT-20)", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const provider = await createProviderRegistration(ctx, { type: "ollama", name: "Unreachable Ollama", baseUrl: "http://localhost:11434" });

    const fakeFetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const probed = await probeProvider(ctx, provider.id, fakeFetch as unknown as typeof fetch);

    expect(probed.status).toBe("Unreachable");
    expect(probed.lastProbeError).toMatchObject({ code: "PROBE_FAILED" });
  });

  it("decrypts a vaulted credential and passes it to the adapter's probe (round trip through the same vault every other secret uses)", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const provider = await createProviderRegistration(ctx, {
      type: "openai",
      name: "Credentialed provider",
      apiKeyPlaintext: "sk-round-trip-test",
    });

    const fakeFetch = vi.fn().mockResolvedValue({ ok: true });
    await probeProvider(ctx, provider.id, fakeFetch as unknown as typeof fetch);

    // The adapter received the decrypted plaintext in its Authorization header.
    expect(fakeFetch).toHaveBeenCalledWith(expect.any(String), { headers: { authorization: "Bearer sk-round-trip-test" } });
  });

  it("probe result is visible via listProviderRegistrations (console reads it live, no separate cache)", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const provider = await createProviderRegistration(ctx, { type: "openai-compatible", name: "Checked via list", baseUrl: "http://localhost:9201/v1" });
    await probeProvider(ctx, provider.id, vi.fn().mockResolvedValue({ ok: true }) as unknown as typeof fetch);

    const rows = await listProviderRegistrations(ctx);
    expect(rows.find((r) => r.id === provider.id)?.status).toBe("Active");
  });
});
