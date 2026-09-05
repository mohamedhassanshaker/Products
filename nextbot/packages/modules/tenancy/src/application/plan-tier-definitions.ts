import { eq } from "drizzle-orm";
import { generateId, schema } from "@nextbot/db";
import { withPlatform, type PlatformClient } from "@nextbot/db/platform-only";
import type { PlanTierValue, UpdatePlanTierDefinitionRequest } from "@nextbot/contracts";
import { getPlanTierQuotaDefaults, type PlanTierQuotaDefaults } from "../domain/plan-tier-defaults.js";

/**
 * A `plan_tier_definition` row, editable-config shape (Platform Manager console
 * Phase 2, NFR-11). `features` is explicitly descriptive/forward-looking only — no
 * feature-gating mechanism reads it anywhere else in the codebase.
 */
export interface PlanTierDefinitionRecord {
  tier: PlanTierValue;
  maxToolCallsPerSecond: number | null;
  maxConcurrentConversations: number | null;
  maxMcpConnectors: number | null;
  isDedicatedDatabase: boolean;
  features: string[];
  updatedAt: Date;
}

/** Maps a Drizzle `plan_tier_definition` row to the public record shape. */
function toRecord(row: typeof schema.planTierDefinition.$inferSelect): PlanTierDefinitionRecord {
  return {
    tier: row.tier,
    maxToolCallsPerSecond: row.maxToolCallsPerSecond,
    maxConcurrentConversations: row.maxConcurrentConversations,
    maxMcpConnectors: row.maxMcpConnectors,
    isDedicatedDatabase: row.isDedicatedDatabase,
    features: row.features,
    updatedAt: row.updatedAt,
  };
}

/**
 * Lists all three plan-tier definitions (Plan Tiers screen, NFR-11). Ordered by
 * `tier` for a stable Starter/Growth/Enterprise-ish display order (Postgres enum
 * ordinal order matches declaration order, i.e. the `plan_tier` enum's own
 * Starter/Growth/Enterprise sequence).
 */
export async function listPlanTierDefinitions(): Promise<PlanTierDefinitionRecord[]> {
  const rows = await withPlatform(async (db: PlatformClient) => db.select().from(schema.planTierDefinition));
  return rows.map(toRecord);
}

/**
 * Reads a single plan-tier definition. Returns `null` only in the defensive case
 * where the row is missing (every enum value is seeded by migration 0031, so this
 * should not happen in practice) — callers render a 404 rather than a confusing
 * empty result.
 */
export async function getPlanTierDefinition(tier: PlanTierValue): Promise<PlanTierDefinitionRecord | null> {
  const [row] = await withPlatform(async (db: PlatformClient) =>
    db.select().from(schema.planTierDefinition).where(eq(schema.planTierDefinition.tier, tier)),
  );
  return row ? toRecord(row) : null;
}

/**
 * Reads the effective quota template for a plan tier *using an already-open
 * `withPlatform` transaction* — the shared implementation behind both
 * {@link getEffectivePlanTierDefaults} (its own standalone transaction, for
 * `provisionTenant()`) and `reseedTenantQuotaFromTier()` (which must read the
 * tier's defaults and write the tenant's quota + audit row atomically, in one
 * transaction).
 *
 * Falls back to the pure `getPlanTierQuotaDefaults()` domain function if the row is
 * ever missing, so a corrupted/partial `plan_tier_definition` table degrades to the
 * originally-hardcoded behavior rather than failing provisioning outright.
 */
export async function readEffectivePlanTierDefaultsWithin(
  db: PlatformClient,
  planTier: PlanTierValue,
): Promise<PlanTierQuotaDefaults> {
  const [row] = await db.select().from(schema.planTierDefinition).where(eq(schema.planTierDefinition.tier, planTier));
  if (!row) return getPlanTierQuotaDefaults(planTier);
  return {
    maxToolCallsPerSecond: row.maxToolCallsPerSecond,
    maxConcurrentConversations: row.maxConcurrentConversations,
    maxMcpConnectors: row.maxMcpConnectors,
    isDedicatedDatabase: row.isDedicatedDatabase,
  };
}

/**
 * Reads the effective, currently-configured quota template for a plan tier
 * (Platform Manager console Phase 2, NFR-11) — `provisionTenant()`'s new call site,
 * replacing its previous direct call to the pure `getPlanTierQuotaDefaults()`
 * domain function. Falls back to that same pure function if the
 * `plan_tier_definition` row is ever missing (see {@link readEffectivePlanTierDefaultsWithin}).
 */
export async function getEffectivePlanTierDefaults(planTier: PlanTierValue): Promise<PlanTierQuotaDefaults> {
  return withPlatform(async (db: PlatformClient) => readEffectivePlanTierDefaultsWithin(db, planTier));
}

/**
 * Edits one plan tier's quota-template/features fields (Plan Tiers screen, NFR-11).
 * Partial patch — only fields present in `patch` are written. Writes exactly one
 * `platform_audit_log_entry` row in the same transaction as the update (mirrors
 * `provisionTenant()`'s established pattern).
 *
 * @returns The updated record, or `null` if no row exists for `tier` (defensive —
 *   see {@link getPlanTierDefinition}).
 */
export async function updatePlanTierDefinition(
  tier: PlanTierValue,
  patch: UpdatePlanTierDefinitionRequest,
  actorLabel = "system",
): Promise<PlanTierDefinitionRecord | null> {
  return withPlatform(async (db: PlatformClient) => {
    const [existing] = await db.select().from(schema.planTierDefinition).where(eq(schema.planTierDefinition.tier, tier));
    if (!existing) return null;

    const updateValues: Partial<typeof schema.planTierDefinition.$inferInsert> = { updatedAt: new Date() };
    if (patch.maxToolCallsPerSecond !== undefined) updateValues.maxToolCallsPerSecond = patch.maxToolCallsPerSecond;
    if (patch.maxConcurrentConversations !== undefined) updateValues.maxConcurrentConversations = patch.maxConcurrentConversations;
    if (patch.maxMcpConnectors !== undefined) updateValues.maxMcpConnectors = patch.maxMcpConnectors;
    if (patch.isDedicatedDatabase !== undefined) updateValues.isDedicatedDatabase = patch.isDedicatedDatabase;
    if (patch.features !== undefined) updateValues.features = patch.features;

    const [updated] = await db
      .update(schema.planTierDefinition)
      .set(updateValues)
      .where(eq(schema.planTierDefinition.tier, tier))
      .returning();

    // Platform Manager console Phase 2 (NFR-11): one platform-level audit row per
    // plan-tier-definition edit, in the same transaction as the update itself.
    await db.insert(schema.platformAuditLogEntry).values({
      id: generateId(),
      actorLabel,
      actionType: "plan-tier-definition.update",
      targetTenantId: null,
      details: { tier, patch },
    });

    // `existing` was just confirmed present above (same transaction), so this UPDATE
    // ... WHERE tier = tier cannot fail to return a row.
    return toRecord(updated!);
  });
}
