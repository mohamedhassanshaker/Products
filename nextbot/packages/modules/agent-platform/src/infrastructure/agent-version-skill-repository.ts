import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";

/**
 * LLD §14.5.3 — the composition bridge (`agent_version_skill`), owned by
 * `agent-platform`. Written transactionally with an agent version's save
 * (`agent-definition-repository.ts`'s `insertAgentDefinitionVersion`); read here for
 * the where-used index and the "upgrade consumers" action (ADR-0015 §2.3/§2.4).
 */
export interface AgentVersionSkillPinRow {
  tenantId: string;
  agentDefinitionVersionId: string;
  skillId: string;
  skillVersionId: string;
  ordinal: number;
}

/** The one pin (if any) this agent version has for a specific skill — `null` when
 * this version never composed that skill at all. */
export async function getPinForSkill(ctx: TenantContext, agentDefinitionVersionId: string, skillId: string): Promise<AgentVersionSkillPinRow | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select()
      .from(schema.agentVersionSkill)
      .where(
        and(
          eq(schema.agentVersionSkill.tenantId, ctx.tenantId),
          eq(schema.agentVersionSkill.agentDefinitionVersionId, agentDefinitionVersionId),
          eq(schema.agentVersionSkill.skillId, skillId),
        ),
      );
    return rows[0] ?? null;
  });
}

/**
 * ADR-0015 §2.4 — "the consumer set = for each agent *definition* that has any
 * version referencing an older version of this skill, its latest version (Draft
 * excluded) is the upgrade source." Two-step resolution:
 *   1. Every `agent_definition_id` that has EVER composed this skill (any version,
 *      any of that definition's own versions) — a distinct list from
 *      `agent_version_skill`.
 *   2. For each such definition, its own latest non-Draft version (by
 *      `created_at`) — this is the "head" this action considers, regardless of
 *      whether that exact head version is the one that composed the skill.
 * The caller (`skill-upgrade-service.ts`) then re-checks whether that head version
 * currently pins this skill at all, and at what version, to decide whether it's
 * actually behind.
 */
export async function listConsumerDefinitionIdsForSkill(ctx: TenantContext, skillId: string): Promise<string[]> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const pinRows = await db
      .select({ agentDefinitionVersionId: schema.agentVersionSkill.agentDefinitionVersionId })
      .from(schema.agentVersionSkill)
      .where(and(eq(schema.agentVersionSkill.tenantId, ctx.tenantId), eq(schema.agentVersionSkill.skillId, skillId)));
    if (pinRows.length === 0) return [];
    const versionIds = [...new Set(pinRows.map((r) => r.agentDefinitionVersionId))];

    const versions = await db
      .select({ agentDefinitionId: schema.agentDefinitionVersion.agentDefinitionId })
      .from(schema.agentDefinitionVersion)
      .where(and(eq(schema.agentDefinitionVersion.tenantId, ctx.tenantId), inArray(schema.agentDefinitionVersion.id, versionIds)));
    return [...new Set(versions.map((v) => v.agentDefinitionId))];
  });
}

export interface AgentDefinitionHeadVersion {
  id: string;
  agentDefinitionId: string;
  version: string;
  status: string;
}

/** The latest non-Draft version of a definition (ADR-0015 §2.4's "upgrade source"). */
export async function resolveHeadVersionForDefinition(ctx: TenantContext, agentDefinitionId: string): Promise<AgentDefinitionHeadVersion | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select({ id: schema.agentDefinitionVersion.id, agentDefinitionId: schema.agentDefinitionVersion.agentDefinitionId, version: schema.agentDefinitionVersion.version, status: schema.agentDefinitionVersion.status })
      .from(schema.agentDefinitionVersion)
      .where(and(eq(schema.agentDefinitionVersion.tenantId, ctx.tenantId), eq(schema.agentDefinitionVersion.agentDefinitionId, agentDefinitionId), ne(schema.agentDefinitionVersion.status, "Draft")))
      .orderBy(desc(schema.agentDefinitionVersion.createdAt))
      .limit(1);
    return rows[0] ?? null;
  });
}

/** ADR-0015 §2.4's idempotency guard, re-checked at the application layer (the
 * partial unique index on `agent_definition_version` is the DB-level backstop). */
export async function findPendingUpgradeDraft(ctx: TenantContext, agentDefinitionId: string, sourceVersionId: string, targetSkillVersionId: string): Promise<{ id: string; version: string } | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select({ id: schema.agentDefinitionVersion.id, version: schema.agentDefinitionVersion.version })
      .from(schema.agentDefinitionVersion)
      .where(
        and(
          eq(schema.agentDefinitionVersion.tenantId, ctx.tenantId),
          eq(schema.agentDefinitionVersion.agentDefinitionId, agentDefinitionId),
          eq(schema.agentDefinitionVersion.status, "Draft"),
          eq(schema.agentDefinitionVersion.upgradeSourceVersionId, sourceVersionId),
          eq(schema.agentDefinitionVersion.upgradedSkillVersionId, targetSkillVersionId),
        ),
      );
    return rows[0] ?? null;
  });
}
