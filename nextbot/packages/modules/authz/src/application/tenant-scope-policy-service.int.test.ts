import { afterEach, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { schema, withTenant } from "@nextbot/db";
import { eq } from "drizzle-orm";
import { setPiiPolicy } from "@nextbot/pii";
import { getTenantScopePolicy, readPersistedTenantScopePolicy } from "./tenant-scope-policy-service.js";

const createdTenantIds: string[] = [];
afterEach(async () => {
  for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
});

describe("getTenantScopePolicy — LLD §14.2.6 (real Postgres)", () => {
  it("derives origin='TenantPolicy' and mirrors tenant_data_policy.allowOutOfRegionInference, persisting the row", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);

    const scope = await getTenantScopePolicy(ctx);
    expect(scope.origin).toBe("TenantPolicy");
    expect(scope.originId).toBe("tenant");
    // createFixtureTenant's tenant_data_policy row doesn't set
    // allowOutOfRegionInference explicitly, so the column default (false) applies.
    expect(scope.allowOutOfRegionInference).toBe(false);

    const persisted = await readPersistedTenantScopePolicy(ctx);
    expect(persisted).not.toBeNull();
    expect(persisted?.scopeJson).toMatchObject({ origin: "TenantPolicy", allowOutOfRegionInference: false });
    expect(persisted?.scopeHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("recomputes on every read: a later change to tenant_data_policy.allowOutOfRegionInference is reflected on the very next call, without a separate reconcile step", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);

    const before = await getTenantScopePolicy(ctx);
    expect(before.allowOutOfRegionInference).toBe(false);

    // Directly flips the source-of-truth column via the tenant's own "app" role
    // (mirrors a real admin settings update — this test only needs the column
    // changed, not a full settings-service round trip).
    await withTenant(ctx, (db) => db.update(schema.tenantDataPolicy).set({ allowOutOfRegionInference: true }).where(eq(schema.tenantDataPolicy.tenantId, ctx.tenantId)));

    const after = await getTenantScopePolicy(ctx);
    expect(after.allowOutOfRegionInference).toBe(true);
    const persisted = await readPersistedTenantScopePolicy(ctx);
    expect(persisted?.scopeJson).toMatchObject({ allowOutOfRegionInference: true });
  });

  // Target Architecture Blueprint Phase 12 (BL-43/44, FR-AGT-14) — real,
  // Postgres-backed proof that `maskingFloor` is now genuinely derived from
  // `pii_policy`, closing the gap this file's own doc comment previously
  // disclosed as permanently `⊤`.
  it("derives maskingFloor as the STRICTEST action across every (entityType, trustLevel) combination for a context, via real pii_policy rows", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);

    await setPiiPolicy(ctx, "Email", "Transcript", "Trusted", "PartialMask");
    await setPiiPolicy(ctx, "Phone", "Transcript", "SemiTrusted", "FullMask");
    await setPiiPolicy(ctx, "Email", "Export", "Trusted", "Show");

    const scope = await getTenantScopePolicy(ctx);
    // Transcript: strictest of PartialMask/FullMask is FullMask.
    expect(scope.maskingFloor?.Transcript).toBe("FullMask");
    expect(scope.maskingFloor?.Export).toBe("Show");
    // A context with no pii_policy row at all stays absent (⊤ for that
    // context) — never invented as FullMask (that is the runtime masker's OWN,
    // separate fail-closed default at read time, not this floor concept).
    expect(scope.maskingFloor?.ToolCallPayload).toBeUndefined();
  });

  it("omits maskingFloor entirely (⊤, matching pre-Phase-12 behaviour) when the tenant has configured no pii_policy rows at all", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);

    const scope = await getTenantScopePolicy(ctx);
    expect(scope.maskingFloor).toBeUndefined();
  });
});
