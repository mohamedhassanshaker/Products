import { afterEach, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { withTenant, schema } from "@nextbot/db";
import { eq } from "drizzle-orm";
import { getTenantScopePolicy } from "./tenant-scope-policy-service.js";

/**
 * ADR-0001 §6 cross-tenant proof for `tenant_scope_policy` (Phase 6, BL-37) — a
 * security-critical table by construction (it's the tenant floor every
 * `evaluate()` call folds against), so it gets the same adversarial isolation
 * proof every other tenant-scoped table's own module provides, not just the
 * generic RLS-presence check in `rls-coverage.isolation.test.ts`.
 */
describe("tenant_scope_policy tenant isolation (ADR-0001 §6 / LLD §3.2)", () => {
  const createdTenantIds: string[] = [];
  afterEach(async () => {
    for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
  });

  it("a tenant scoped to A reads zero rows of B's tenant_scope_policy, even by direct row id", async () => {
    const a = await createFixtureTenant();
    createdTenantIds.push(a.tenantId);
    const b = await createFixtureTenant();
    createdTenantIds.push(b.tenantId);

    // B's policy is derived/persisted for real.
    await getTenantScopePolicy(b);

    const rowsSeenByA = await withTenant(a, (db) => db.select().from(schema.tenantScopePolicy).where(eq(schema.tenantScopePolicy.tenantId, b.tenantId)));
    expect(rowsSeenByA).toHaveLength(0);
  });

  it("getTenantScopePolicy(A) never derives from B's tenant_data_policy row, even if called back-to-back", async () => {
    const a = await createFixtureTenant();
    createdTenantIds.push(a.tenantId);
    const b = await createFixtureTenant();
    createdTenantIds.push(b.tenantId);

    await withTenant(b, (db) => db.update(schema.tenantDataPolicy).set({ allowOutOfRegionInference: true }).where(eq(schema.tenantDataPolicy.tenantId, b.tenantId)));

    const scopeA = await getTenantScopePolicy(a);
    expect(scopeA.allowOutOfRegionInference).toBe(false); // A's own default, unaffected by B's setting
  });
});
