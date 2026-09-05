import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createFixtureTenant, deleteFixtureTenant } from "./testing/index.js";
import { withTenant, generateId, schema } from "./index.js";
import { withPlatform, type PlatformClient } from "./platform-context.js";
import type { TenantScopedClient } from "./tenant-context.js";

/**
 * Target Architecture Blueprint Phase 1 (BL-32, ADR-0011 §5, LLD §14.8.7) — proves the
 * two-clause `PLATFORM_SHARED_TENANT_TABLES` policy shape actually behaves as
 * documented: a tenant-scoped session can READ a platform row (`tenant_id IS NULL`)
 * but can never INSERT or UPDATE one — only `withPlatform()` can write a platform row.
 * This is the "write denied" half named in LLD §14.8.7's testing note; the read-allowed
 * half is exercised implicitly by every provider-registry integration test that lists
 * providers and sees the platform-registered one alongside its own.
 */
describe("platform-shared tables — tenant session cannot write a tenant_id IS NULL row (LLD §14.8.7)", () => {
  const createdTenantIds: string[] = [];
  afterEach(async () => {
    for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
  });

  it("a tenant session's INSERT of a tenant_id=NULL model_provider row is rejected by RLS", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);

    await expect(
      withTenant(ctx, (db: TenantScopedClient) =>
        db.insert(schema.modelProvider).values({
          id: generateId(),
          tenantId: null,
          type: "custom",
          name: "Attempted platform row",
          baseUrl: "http://localhost:9/v1",
          region: "UAE",
          authMethod: "None",
        }),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("a tenant session cannot UPDATE an existing platform (tenant_id IS NULL) model_provider row", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);

    const platformProviderId = generateId();
    await withPlatform((db: PlatformClient) =>
      db.insert(schema.modelProvider).values({
        id: platformProviderId,
        tenantId: null,
        type: "custom",
        name: `Platform provider ${platformProviderId}`,
        baseUrl: "http://localhost:9/v1",
        region: "UAE",
        authMethod: "None",
      }),
    );

    // The row is readable (USING allows tenant_id IS NULL)...
    const seen = await withTenant(ctx, (db: TenantScopedClient) =>
      db.select().from(schema.modelProvider).where(eq(schema.modelProvider.id, platformProviderId)),
    );
    expect(seen).toHaveLength(1);

    // ...but not writable: the row satisfies USING (tenant_id IS NULL is explicitly
    // allowed for reads), so it IS selected as an update candidate — but the updated
    // row's tenant_id is still NULL, which fails WITH CHECK (tenant_id = current
    // tenant), so Postgres rejects the UPDATE outright ("new row violates row-level
    // security policy"), per Postgres' documented RLS semantics for USING-visible/
    // WITH-CHECK-failing rows.
    await expect(
      withTenant(ctx, (db: TenantScopedClient) =>
        db
          .update(schema.modelProvider)
          .set({ name: "Hijacked" })
          .where(eq(schema.modelProvider.id, platformProviderId)),
      ),
    ).rejects.toThrow(/row-level security/i);

    const stillOriginal = await withPlatform((db: PlatformClient) =>
      db.select().from(schema.modelProvider).where(eq(schema.modelProvider.id, platformProviderId)),
    );
    expect(stillOriginal[0]?.name).toBe(`Platform provider ${platformProviderId}`);

    await withPlatform((db: PlatformClient) => db.delete(schema.modelProvider).where(eq(schema.modelProvider.id, platformProviderId)));
  });
});
