import { and, eq } from "drizzle-orm";
import { generateId, schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";

/**
 * Phase 17 (BL-10) full guardrail authoring CRUD, superseding the in-memory
 * `StubGuardrailRule[]` Phase 12's `orchestration/domain/guardrail-eval.ts`
 * evaluated against. The evaluation function itself is unchanged (pure, tested in
 * Phase 12) — only the rule *source* moves here, to a real per-tenant table.
 */
export interface GuardrailRuleRow {
  id: string;
  name: string;
  ordinal: number;
  conditions: { toolName?: string };
  effect: "BlockToolCall" | "EscalateToHuman";
  reason: string;
  enabled: boolean;
}

/** Lists every enabled guardrail rule for this tenant, in ordinal order — exactly
 * the shape `evaluateGuardrails` (Phase 12) expects as its rule-set argument. */
export async function listEnabledGuardrailRules(ctx: TenantContext): Promise<GuardrailRuleRow[]> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select()
      .from(schema.guardrailRule)
      .where(and(eq(schema.guardrailRule.tenantId, ctx.tenantId), eq(schema.guardrailRule.enabled, true)))
      .orderBy(schema.guardrailRule.ordinal);
    return rows.map(toRow);
  });
}

/** Lists every guardrail rule (enabled or not) for the authoring UI. */
export async function listGuardrailRules(ctx: TenantContext): Promise<GuardrailRuleRow[]> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select()
      .from(schema.guardrailRule)
      .where(eq(schema.guardrailRule.tenantId, ctx.tenantId))
      .orderBy(schema.guardrailRule.ordinal);
    return rows.map(toRow);
  });
}

export interface UpsertGuardrailRuleInput {
  name: string;
  ordinal: number;
  conditions: { toolName?: string };
  effect: "BlockToolCall" | "EscalateToHuman";
  reason: string;
  enabled: boolean;
}

/** Creates a new guardrail rule. `ordinal` collisions are reconciled by the DB's
 * unique `(tenant_id, ordinal)` index — a concurrent double-create at the same
 * ordinal fails cleanly rather than silently overwriting evaluation order. */
export async function createGuardrailRule(ctx: TenantContext, input: UpsertGuardrailRuleInput): Promise<GuardrailRuleRow> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const id = generateId();
    await db.insert(schema.guardrailRule).values({ id, tenantId: ctx.tenantId, ...input });
    return { id, ...input };
  });
}

export async function updateGuardrailRule(
  ctx: TenantContext,
  id: string,
  input: Partial<UpsertGuardrailRuleInput>,
): Promise<void> {
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db
      .update(schema.guardrailRule)
      .set(input)
      .where(and(eq(schema.guardrailRule.tenantId, ctx.tenantId), eq(schema.guardrailRule.id, id)));
  });
}

export async function deleteGuardrailRule(ctx: TenantContext, id: string): Promise<void> {
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db
      .delete(schema.guardrailRule)
      .where(and(eq(schema.guardrailRule.tenantId, ctx.tenantId), eq(schema.guardrailRule.id, id)));
  });
}

function toRow(row: typeof schema.guardrailRule.$inferSelect): GuardrailRuleRow {
  return {
    id: row.id,
    name: row.name,
    ordinal: row.ordinal,
    conditions: row.conditions,
    effect: row.effect as "BlockToolCall" | "EscalateToHuman",
    reason: row.reason,
    enabled: row.enabled,
  };
}
