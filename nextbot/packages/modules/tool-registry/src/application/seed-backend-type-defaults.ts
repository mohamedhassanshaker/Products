import { generateId, schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";
import { and, eq } from "drizzle-orm";
import type { BackendTypeValue } from "@nextbot/contracts";

/**
 * Ensures a single unconditional `Allow` rule exists at `BackendType` scope for the
 * given backend type (LLD §3.6 "seeded backend-type defaults"). Idempotent — a
 * second call for the same `(tenant, backendType)` is a no-op. The tier a caller
 * actually gets is `tool.approval_tier` (set at discovery time by
 * `defaultApprovalTier()`) since this rule's `effect = Allow`, not `RequireApproval`
 * — the rule's only job is to keep the resolver from fail-closed-denying a freshly
 * discovered tool before an admin has authored anything more specific.
 */
export async function ensureBackendTypeDefaultRule(ctx: TenantContext, backendType: BackendTypeValue): Promise<void> {
  await withTenant(ctx, async (db: TenantScopedClient) => {
    const existing = await db
      .select({ id: schema.toolPermissionRule.id })
      .from(schema.toolPermissionRule)
      .where(
        and(
          eq(schema.toolPermissionRule.tenantId, ctx.tenantId),
          eq(schema.toolPermissionRule.scope, "BackendType"),
          eq(schema.toolPermissionRule.backendType, backendType),
        ),
      );
    if (existing.length > 0) return;

    await db.insert(schema.toolPermissionRule).values({
      id: generateId(),
      tenantId: ctx.tenantId,
      scope: "BackendType",
      toolId: null,
      connectorId: null,
      backendType: backendType,
      ordinal: 0,
      conditions: {},
      effect: "Allow",
      requiredTier: null,
      enabled: true,
    });
  });
}
