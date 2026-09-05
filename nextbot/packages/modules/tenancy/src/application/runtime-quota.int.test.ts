import { afterEach, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { schema, withTenant, type TenantScopedClient } from "@nextbot/db";
import { QuotaExceededError } from "@nextbot/contracts";
import { eq } from "drizzle-orm";
import { claimConcurrentRunSlot, checkToolCallRate, _resetRuntimeQuotaClientForTests } from "./runtime-quota.js";

const createdTenantIds: string[] = [];
afterEach(async () => {
  for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
  await _resetRuntimeQuotaClientForTests();
});

/**
 * Phase 18 (BL-11, FR-AGT-10/NFR-4/NFR-4a) — real Redis-backed quota enforcement.
 * Proves the distinct "quota exceeded for your plan" error (never a generic
 * 500/429) fires exactly when a real, low, per-tenant `tenant_runtime_quota` cap
 * is exceeded — the deliverable this dispatch's exit gate names explicitly.
 */
describe("claimConcurrentRunSlot / checkToolCallRate (Phase 18, real Redis + Postgres)", () => {
  it("throws QuotaExceededError once max_concurrent_runs is saturated, and release() frees the slot again", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    await withTenant(ctx, async (db: TenantScopedClient) => {
      await db.update(schema.tenantRuntimeQuota).set({ maxConcurrentRuns: 1 }).where(eq(schema.tenantRuntimeQuota.tenantId, ctx.tenantId));
    });

    const release = await claimConcurrentRunSlot(ctx);
    await expect(claimConcurrentRunSlot(ctx)).rejects.toThrow(QuotaExceededError);

    await release();
    // Slot is free again after release — a second claim now succeeds.
    const release2 = await claimConcurrentRunSlot(ctx);
    await release2();
  });

  it("never throws when max_concurrent_runs is NULL (no cap)", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const release = await claimConcurrentRunSlot(ctx);
    await release();
  });

  it("checkToolCallRate throws QuotaExceededError('ToolCallsPerSecond') once max_tool_calls_per_second is exceeded within the same second", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    await withTenant(ctx, async (db: TenantScopedClient) => {
      await db
        .update(schema.tenantRuntimeQuota)
        .set({ maxToolCallsPerSecond: 2 })
        .where(eq(schema.tenantRuntimeQuota.tenantId, ctx.tenantId));
    });

    await checkToolCallRate(ctx);
    await checkToolCallRate(ctx);
    await expect(checkToolCallRate(ctx)).rejects.toThrow(QuotaExceededError);
  });
});
