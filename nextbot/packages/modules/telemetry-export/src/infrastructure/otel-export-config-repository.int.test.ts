import { afterEach, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { getOtelExportConfig, upsertOtelExportConfig } from "./otel-export-config-repository.js";

describe("otel_export_config repository (real Postgres) — one row per tenant, created lazily", () => {
  const createdTenantIds: string[] = [];
  afterEach(async () => {
    for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
  });

  it("returns null before any configuration exists", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    await expect(getOtelExportConfig(ctx)).resolves.toBeNull();
  });

  it("creates a row on first upsert, and updates the SAME row (not a duplicate) on a second upsert", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const created = await upsertOtelExportConfig(ctx, { otlpEndpointUrl: "https://collector-a.example.com", enabled: false });
    expect(created.otlpEndpointUrl).toBe("https://collector-a.example.com");

    const updated = await upsertOtelExportConfig(ctx, { otlpEndpointUrl: "https://collector-b.example.com", enabled: true });
    expect(updated.id).toBe(created.id); // same row, not a second one
    expect(updated.otlpEndpointUrl).toBe("https://collector-b.example.com");
    expect(updated.enabled).toBe(true);

    const read = await getOtelExportConfig(ctx);
    expect(read).toMatchObject({ id: created.id, otlpEndpointUrl: "https://collector-b.example.com", enabled: true });
  });

  it("a tenant's config is invisible to another tenant (RLS, not merely convention)", async () => {
    const ctxA = await createFixtureTenant();
    createdTenantIds.push(ctxA.tenantId);
    const ctxB = await createFixtureTenant();
    createdTenantIds.push(ctxB.tenantId);
    await upsertOtelExportConfig(ctxA, { otlpEndpointUrl: "https://collector-a.example.com", enabled: true });
    await expect(getOtelExportConfig(ctxB)).resolves.toBeNull();
  });
});
