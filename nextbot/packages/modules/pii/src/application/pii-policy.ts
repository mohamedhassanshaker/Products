import { and, eq } from "drizzle-orm";
import { generateId, schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";
import type { ConnectorTrustLevel, CustomPiiRule, PiiContext, PiiEntityType, PiiMaskAction, PolicyLookup } from "../domain/masker.js";

/** CRUD for `pii_rule` (detection rules — built-in types are implicitly always
 * "available", `Custom` rows carry a tenant-authored regex, B.8.4/FR-SEC-04). */
export interface PiiRuleRow {
  id: string;
  entityType: PiiEntityType;
  label: string;
  pattern: string | null;
  enabled: boolean;
}

export async function listPiiRules(ctx: TenantContext): Promise<PiiRuleRow[]> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db.select().from(schema.piiRule).where(eq(schema.piiRule.tenantId, ctx.tenantId));
    return rows.map((r) => ({ id: r.id, entityType: r.entityType as PiiEntityType, label: r.label, pattern: r.pattern, enabled: r.enabled }));
  });
}

export interface CreatePiiRuleInput {
  entityType: PiiEntityType;
  label: string;
  pattern?: string;
  enabled: boolean;
}

export async function createPiiRule(ctx: TenantContext, input: CreatePiiRuleInput): Promise<PiiRuleRow> {
  if (input.entityType === "Custom" && !input.pattern) {
    throw new Error("A Custom PII rule must supply a pattern");
  }
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const id = generateId();
    await db.insert(schema.piiRule).values({ id, tenantId: ctx.tenantId, ...input, pattern: input.pattern ?? null });
    return { id, entityType: input.entityType, label: input.label, pattern: input.pattern ?? null, enabled: input.enabled };
  });
}

export async function updatePiiRule(ctx: TenantContext, id: string, input: Partial<CreatePiiRuleInput>): Promise<void> {
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db.update(schema.piiRule).set(input).where(and(eq(schema.piiRule.tenantId, ctx.tenantId), eq(schema.piiRule.id, id)));
  });
}

export async function deletePiiRule(ctx: TenantContext, id: string): Promise<void> {
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db.delete(schema.piiRule).where(and(eq(schema.piiRule.tenantId, ctx.tenantId), eq(schema.piiRule.id, id)));
  });
}

/** Returns every enabled `Custom` rule as `masker.ts`'s `CustomPiiRule[]` input
 * shape — what the read/export/human-view masking call sites feed `detectPii`. */
export async function listCustomPiiRulesForMasking(ctx: TenantContext): Promise<CustomPiiRule[]> {
  const rules = await listPiiRules(ctx);
  return rules
    .filter((r) => r.entityType === "Custom" && r.enabled && r.pattern)
    .map((r) => ({ entityType: "Custom" as const, label: r.label, pattern: r.pattern! }));
}

/** CRUD + lookup for `pii_policy`, the masking-context matrix (FR-SEC-04). */
export interface PiiPolicyRow {
  id: string;
  entityType: PiiEntityType;
  context: PiiContext;
  trustLevel: ConnectorTrustLevel;
  action: PiiMaskAction;
}

export async function listPiiPolicies(ctx: TenantContext): Promise<PiiPolicyRow[]> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db.select().from(schema.piiPolicy).where(eq(schema.piiPolicy.tenantId, ctx.tenantId));
    return rows.map((r) => ({
      id: r.id,
      entityType: r.entityType as PiiEntityType,
      context: r.context as PiiContext,
      trustLevel: r.trustLevel as ConnectorTrustLevel,
      action: r.action,
    }));
  });
}

/** Upserts one cell of the masking matrix — `(entityType, context, trustLevel)` is
 * unique per tenant (DB constraint), so this deletes any existing row for that key
 * before inserting the replacement rather than relying on check-then-act. */
export async function setPiiPolicy(
  ctx: TenantContext,
  entityType: PiiEntityType,
  context: PiiContext,
  trustLevel: ConnectorTrustLevel,
  action: PiiMaskAction,
): Promise<void> {
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db
      .delete(schema.piiPolicy)
      .where(
        and(
          eq(schema.piiPolicy.tenantId, ctx.tenantId),
          eq(schema.piiPolicy.entityType, entityType),
          eq(schema.piiPolicy.context, context),
          eq(schema.piiPolicy.trustLevel, trustLevel),
        ),
      );
    await db.insert(schema.piiPolicy).values({ id: generateId(), tenantId: ctx.tenantId, entityType, context, trustLevel, action });
  });
}

/** Builds a `PolicyLookup` (masker.ts's pure-function interface) backed by this
 * tenant's real `pii_policy` rows, fetched once per call — callers masking a batch
 * of records should call this once and reuse the resulting function, not per row. */
export async function buildPolicyLookup(ctx: TenantContext): Promise<PolicyLookup> {
  const policies = await listPiiPolicies(ctx);
  const table = new Map<string, PiiMaskAction>();
  for (const p of policies) table.set(`${p.entityType}:${p.context}:${p.trustLevel}`, p.action);
  return (entityType, context, trustLevel) => table.get(`${entityType}:${context}:${trustLevel}`);
}
