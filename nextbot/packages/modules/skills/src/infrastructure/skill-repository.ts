import { and, desc, eq } from "drizzle-orm";
import { generateId, schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";
import type { SkillStatusValue, SkillVersionStatusValue } from "@nextbot/contracts";
import { SkillNameDuplicateError, SkillNotFoundError, SkillVersionNotFoundError } from "@nextbot/contracts";

export interface SkillRow {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  status: SkillStatusValue;
  currentVersionId: string | null;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface SkillVersionRow {
  id: string;
  tenantId: string;
  skillId: string;
  version: number;
  yaml: string;
  yamlHash: string;
  trigger: string;
  scopeCapabilityGroupIds: string[];
  scopeToolIds: string[];
  scopeKnowledgeCollectionNames: string[];
  scopeJson: unknown;
  instructions: string;
  successCriteria: string;
  escalateWhen: string[];
  evalCaseIds: string[];
  status: SkillVersionStatusValue;
  gitCommitSha: string | null;
  gitPrNumber: number | null;
  publishedByUserId: string | null;
  publishedAt: Date | null;
  deprecatedAt: Date | null;
  deprecationNote: string | null;
  createdByUserId: string;
  createdAt: Date;
}

/** LLD §14.5.1 enforcement layer 1: only `create`/`publish`/`deprecate` are exposed
 * below — there is deliberately no generic `updateSkillVersion`. */

export async function createSkill(ctx: TenantContext, input: { name: string; description?: string; createdByUserId: string }): Promise<SkillRow> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const existing = await db.select({ id: schema.skill.id }).from(schema.skill).where(and(eq(schema.skill.tenantId, ctx.tenantId), eq(schema.skill.name, input.name)));
    if (existing.length > 0) throw new SkillNameDuplicateError(input.name);

    const id = generateId();
    await db.insert(schema.skill).values({ id, tenantId: ctx.tenantId, name: input.name, description: input.description, createdByUserId: input.createdByUserId });
    const [row] = await db.select().from(schema.skill).where(eq(schema.skill.id, id));
    if (!row) throw new Error("createSkill: insert did not return a row");
    return row as SkillRow;
  });
}

export async function listSkills(ctx: TenantContext): Promise<SkillRow[]> {
  return withTenant(ctx, (db: TenantScopedClient) => db.select().from(schema.skill).where(eq(schema.skill.tenantId, ctx.tenantId)).orderBy(desc(schema.skill.createdAt))) as Promise<
    SkillRow[]
  >;
}

export interface SkillListItem extends SkillRow {
  /** Total number of versions this skill has (Draft + Published + Deprecated). */
  versionCount: number;
  /** The current Published version's number, or the latest version's number if
   * none is Published yet — `null` only if the skill somehow has zero versions
   * (should not happen in practice; every skill is created with a real version 1). */
  latestVersionNumber: number | null;
  /** The current Published version's trigger, falling back to the latest
   * version's trigger — the "trigger summary" the Skills Library list shows. */
  triggerSummary: string | null;
}

/** Enriches `listSkills` with the summary columns the Skills Library list needs
 * (name, version, trigger summary — where-used count is resolved separately by the
 * console, since it requires `agent-platform`'s `agent_version_skill` index, which
 * this module deliberately does not depend on). Two small follow-up selects, same
 * "low-traffic admin screen, JS-side grouping" pattern `agent-platform`'s own
 * `listAgentDefinitionsWithSummary` already uses. */
export async function listSkillsWithSummary(ctx: TenantContext): Promise<SkillListItem[]> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const skills = await db.select().from(schema.skill).where(eq(schema.skill.tenantId, ctx.tenantId)).orderBy(desc(schema.skill.createdAt));
    if (skills.length === 0) return [];

    const versions = await db
      .select({ skillId: schema.skillVersion.skillId, version: schema.skillVersion.version, trigger: schema.skillVersion.trigger, status: schema.skillVersion.status })
      .from(schema.skillVersion)
      .where(eq(schema.skillVersion.tenantId, ctx.tenantId));

    const bySkill = new Map<string, typeof versions>();
    for (const v of versions) {
      const list = bySkill.get(v.skillId) ?? [];
      list.push(v);
      bySkill.set(v.skillId, list);
    }

    return skills.map((skill) => {
      const own = bySkill.get(skill.id) ?? [];
      const published = own.filter((v) => v.status === "Published").sort((a, b) => b.version - a.version)[0];
      const latest = own.sort((a, b) => b.version - a.version)[0];
      const chosen = published ?? latest;
      return {
        ...(skill as SkillRow),
        versionCount: own.length,
        latestVersionNumber: chosen?.version ?? null,
        triggerSummary: chosen?.trigger ?? null,
      };
    });
  });
}

export async function getSkill(ctx: TenantContext, id: string): Promise<SkillRow> {
  const row = await withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db.select().from(schema.skill).where(and(eq(schema.skill.tenantId, ctx.tenantId), eq(schema.skill.id, id)));
    return rows[0];
  });
  if (!row) throw new SkillNotFoundError(id);
  return row as SkillRow;
}

/** Used by `resolveSkillPin` (a `"name@version"` pin string, e.g. from an agent
 * version's `spec.skills`) — `null` (never a throw) when the name doesn't resolve,
 * so the caller can produce a pin-scoped error naming the exact pin string. */
export async function findSkillByName(ctx: TenantContext, name: string): Promise<SkillRow | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db.select().from(schema.skill).where(and(eq(schema.skill.tenantId, ctx.tenantId), eq(schema.skill.name, name)));
    return (rows[0] as SkillRow) ?? null;
  });
}

export async function findSkillVersionByNumber(ctx: TenantContext, skillId: string, version: number): Promise<SkillVersionRow | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select()
      .from(schema.skillVersion)
      .where(and(eq(schema.skillVersion.tenantId, ctx.tenantId), eq(schema.skillVersion.skillId, skillId), eq(schema.skillVersion.version, version)));
    return (rows[0] as SkillVersionRow) ?? null;
  });
}

export async function insertSkillVersion(
  ctx: TenantContext,
  input: {
    skillId: string;
    version: number;
    yaml: string;
    yamlHash: string;
    trigger: string;
    scopeCapabilityGroupIds: string[];
    scopeToolIds: string[];
    scopeKnowledgeCollectionNames: string[];
    scopeJson: unknown;
    instructions: string;
    successCriteria: string;
    escalateWhen: string[];
    evalCaseIds: string[];
    createdByUserId: string;
  },
): Promise<SkillVersionRow> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const id = generateId();
    await db.insert(schema.skillVersion).values({
      id,
      tenantId: ctx.tenantId,
      skillId: input.skillId,
      version: input.version,
      yaml: input.yaml,
      yamlHash: input.yamlHash,
      trigger: input.trigger,
      scopeCapabilityGroupIds: input.scopeCapabilityGroupIds,
      scopeToolIds: input.scopeToolIds,
      scopeKnowledgeCollectionNames: input.scopeKnowledgeCollectionNames,
      scopeJson: input.scopeJson,
      instructions: input.instructions,
      successCriteria: input.successCriteria,
      escalateWhen: input.escalateWhen,
      evalCaseIds: input.evalCaseIds,
      status: "Draft",
      createdByUserId: input.createdByUserId,
    });
    const [row] = await db.select().from(schema.skillVersion).where(eq(schema.skillVersion.id, id));
    if (!row) throw new Error("insertSkillVersion: insert did not return a row");
    return row as SkillVersionRow;
  });
}

export async function listSkillVersions(ctx: TenantContext, skillId: string): Promise<SkillVersionRow[]> {
  return withTenant(ctx, (db: TenantScopedClient) =>
    db.select().from(schema.skillVersion).where(and(eq(schema.skillVersion.tenantId, ctx.tenantId), eq(schema.skillVersion.skillId, skillId))).orderBy(desc(schema.skillVersion.version)),
  ) as Promise<SkillVersionRow[]>;
}

export async function getSkillVersion(ctx: TenantContext, id: string): Promise<SkillVersionRow> {
  const row = await withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db.select().from(schema.skillVersion).where(and(eq(schema.skillVersion.tenantId, ctx.tenantId), eq(schema.skillVersion.id, id)));
    return rows[0];
  });
  if (!row) throw new SkillVersionNotFoundError(id);
  return row as SkillVersionRow;
}

/** Target Architecture Blueprint Phase 15 (BL-47a) — the non-throwing sibling of
 * `getSkillVersion`, for a caller (`@nextbot/workflows`' graph validator, V9) that
 * needs to distinguish "absent/not this tenant's" from a genuine error, and report
 * it as its own `WORKFLOW_REFERENCE_NOT_FOUND` rather than a `skills`-flavored 404. */
export async function findSkillVersionById(ctx: TenantContext, id: string): Promise<SkillVersionRow | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db.select().from(schema.skillVersion).where(and(eq(schema.skillVersion.tenantId, ctx.tenantId), eq(schema.skillVersion.id, id)));
    return (rows[0] as SkillVersionRow | undefined) ?? null;
  });
}

export async function getLatestVersionNumber(ctx: TenantContext, skillId: string): Promise<number> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select({ version: schema.skillVersion.version })
      .from(schema.skillVersion)
      .where(and(eq(schema.skillVersion.tenantId, ctx.tenantId), eq(schema.skillVersion.skillId, skillId)))
      .orderBy(desc(schema.skillVersion.version))
      .limit(1);
    return rows[0]?.version ?? 0;
  });
}

/** The only two mutations `skill_version` ever receives (LLD §14.5.1 layer 1) —
 * `skill_version_immutable_trigger` (layer 2) rejects anything else at the database
 * level regardless. */
export async function publishSkillVersion(ctx: TenantContext, id: string, publishedByUserId: string): Promise<SkillVersionRow> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    await db
      .update(schema.skillVersion)
      .set({ status: "Published", publishedByUserId, publishedAt: new Date() })
      .where(and(eq(schema.skillVersion.tenantId, ctx.tenantId), eq(schema.skillVersion.id, id)));
    const [row] = await db.select().from(schema.skillVersion).where(eq(schema.skillVersion.id, id));
    if (!row) throw new SkillVersionNotFoundError(id);
    await db.update(schema.skill).set({ currentVersionId: id, updatedAt: new Date() }).where(and(eq(schema.skill.tenantId, ctx.tenantId), eq(schema.skill.id, row.skillId)));
    return row as SkillVersionRow;
  });
}

export async function deprecateSkillVersion(ctx: TenantContext, id: string, note?: string): Promise<SkillVersionRow> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    await db
      .update(schema.skillVersion)
      .set({ status: "Deprecated", deprecatedAt: new Date(), deprecationNote: note ?? null })
      .where(and(eq(schema.skillVersion.tenantId, ctx.tenantId), eq(schema.skillVersion.id, id)));
    const [row] = await db.select().from(schema.skillVersion).where(eq(schema.skillVersion.id, id));
    if (!row) throw new SkillVersionNotFoundError(id);
    return row as SkillVersionRow;
  });
}
