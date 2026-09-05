import { and, desc, eq, isNull } from "drizzle-orm";
import { generateId, schema, withTenant, type TenantContext, type TenantScopedClient, type ResolvedAgentKnowledgeConfig } from "@nextbot/db";
import type { AgentVersionStatusValue, GitPrStatusValue, GraphTypeValue } from "@nextbot/contracts";
import { AgentDefinitionNameDuplicateError, AgentDefinitionNotFoundError, AgentVersionNotFoundError } from "@nextbot/contracts";

export interface AgentDefinitionRow {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  repoPath: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AgentDefinitionVersionRow {
  id: string;
  tenantId: string;
  agentDefinitionId: string;
  version: string;
  graphType: GraphTypeValue;
  status: AgentVersionStatusValue;
  definitionYaml: string;
  definitionHash: string;
  gitCommitSha: string | null;
  gitPrNumber: number | null;
  gitPrStatus: GitPrStatusValue;
  evalSuiteId: string | null;
  lastEvalRunId: string | null;
  modelRouteKey: string;
  /** Phase 2 (BL-33, FR-AGT-22) — the real, immutable `route@version` pin;
   * `modelRouteKey` above is retained only as a non-authoritative display snapshot.
   * Typed nullable to match the DB column (Drizzle has no single-migration "add NOT
   * NULL with a backfill" shape, see the schema's own doc comment) — every row this
   * application layer ever inserts always supplies a real value; only a
   * hand-migrated historical row could theoretically be null. */
  modelRouteVersionId: string | null;
  /** Target Architecture Blueprint Phase 10 (BL-41, FR-KB-05/06, Blueprint §7.5) —
   * the resolved `spec.plannerRoute`/`spec.knowledge` pair (see `packages/db/src/
   * schema/agent-platform.ts`'s own doc comments). Both `null` for the overwhelming
   * majority of versions (no `spec.knowledge` configured). */
  plannerRouteVersionId: string | null;
  knowledgeConfig: ResolvedAgentKnowledgeConfig | null;
  createdByUserId: string | null;
  approvedByUserId: string | null;
  /** Target Architecture Blueprint Phase 5 (BL-35, ADR-0015 §2.4) — set only on a
   * Draft the "upgrade consumers" action itself generated; `null` on every
   * ordinarily-authored version. */
  upgradeSourceVersionId: string | null;
  upgradedSkillVersionId: string | null;
  /** Phase 7 — set the first time a real sandbox conversation turn completes
   * against this version (`recordSandboxTest`); `null` until then. Gates
   * `Approved -> Production` (`promotion-policy.ts`). */
  lastSandboxTestAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export async function createAgentDefinition(ctx: TenantContext, input: { name: string; description?: string }): Promise<AgentDefinitionRow> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const existing = await db
      .select({ id: schema.agentDefinition.id })
      .from(schema.agentDefinition)
      .where(and(eq(schema.agentDefinition.tenantId, ctx.tenantId), eq(schema.agentDefinition.name, input.name)));
    if (existing.length > 0) throw new AgentDefinitionNameDuplicateError(input.name);

    const id = generateId();
    const repoPath = `agents/${id}`;
    await db.insert(schema.agentDefinition).values({ id, tenantId: ctx.tenantId, name: input.name, description: input.description, repoPath });
    const [row] = await db.select().from(schema.agentDefinition).where(eq(schema.agentDefinition.id, id));
    if (!row) throw new Error("createAgentDefinition: insert did not return a row");
    return row;
  });
}

/**
 * Target Architecture Blueprint Phase 19 (BL-51, FR-ADM-08) — a real, small, additive
 * gap closed by this phase: every other versioned-artifact module (`skills`'
 * `findSkillByName`, `workflows`' `findWorkflowByName`, `teams`' `findTeamByName`,
 * `model-gateway`'s `getRouteByName`) already exposes a name lookup; `agent-platform`
 * was the one exception. Config restore's "reuse an existing identity vs. create a
 * new one" decision needs this same lookup, consistent with the other four.
 */
export async function findAgentDefinitionByName(ctx: TenantContext, name: string): Promise<AgentDefinitionRow | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select()
      .from(schema.agentDefinition)
      .where(and(eq(schema.agentDefinition.tenantId, ctx.tenantId), eq(schema.agentDefinition.name, name)));
    return rows[0] ?? null;
  });
}

export async function listAgentDefinitions(ctx: TenantContext): Promise<AgentDefinitionRow[]> {
  return withTenant(ctx, (db: TenantScopedClient) =>
    db.select().from(schema.agentDefinition).where(eq(schema.agentDefinition.tenantId, ctx.tenantId)).orderBy(desc(schema.agentDefinition.createdAt)),
  );
}

export interface AgentDefinitionListItem extends AgentDefinitionRow {
  /** U8 fix (QA 2026-08-15 UI pass, low — UX_GUIDELINES.md §6.1 step 2 names both of
   * these as required list columns). Total version count for this definition. */
  versionCount: number;
  /** The version string of whatever's currently the *active* Production deployment
   * (per `deployment.isActive`/`environment`), not merely a version whose own status
   * happens to say `Production` — a definition can have more than one version stamped
   * `Production` historically (BL-13's traffic-split/deprecation editor isn't built
   * yet), but only one deployment is ever active per BE2's own invariant. `null` when
   * nothing is currently deployed to Production. */
  productionVersion: string | null;
}

/** Same as `listAgentDefinitions`, enriched with the two summary columns
 * UX_GUIDELINES.md §6.1 step 2 calls for on the list screen. Two small, cheap
 * follow-up selects (never a per-row N+1 query) rather than a SQL aggregate, since
 * this is a low-traffic admin screen and JS-side grouping keeps the query shape
 * identical to every other plain `select()` in this file. */
export async function listAgentDefinitionsWithSummary(ctx: TenantContext): Promise<AgentDefinitionListItem[]> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const definitions = await db
      .select()
      .from(schema.agentDefinition)
      .where(eq(schema.agentDefinition.tenantId, ctx.tenantId))
      .orderBy(desc(schema.agentDefinition.createdAt));
    if (definitions.length === 0) return [];

    const versions = await db
      .select({ agentDefinitionId: schema.agentDefinitionVersion.agentDefinitionId })
      .from(schema.agentDefinitionVersion)
      .where(eq(schema.agentDefinitionVersion.tenantId, ctx.tenantId));
    const versionCountByDefinition = new Map<string, number>();
    for (const v of versions) versionCountByDefinition.set(v.agentDefinitionId, (versionCountByDefinition.get(v.agentDefinitionId) ?? 0) + 1);

    const activeProductionDeployments = await db
      .select({ agentDefinitionId: schema.deployment.agentDefinitionId, version: schema.agentDefinitionVersion.version })
      .from(schema.deployment)
      .innerJoin(schema.agentDefinitionVersion, eq(schema.deployment.agentDefinitionVersionId, schema.agentDefinitionVersion.id))
      .where(
        and(
          eq(schema.deployment.tenantId, ctx.tenantId),
          eq(schema.deployment.isActive, true),
          eq(schema.deployment.environment, "Production"),
        ),
      );
    const productionVersionByDefinition = new Map(activeProductionDeployments.map((r) => [r.agentDefinitionId, r.version]));

    return definitions.map((d) => ({
      ...d,
      versionCount: versionCountByDefinition.get(d.id) ?? 0,
      productionVersion: productionVersionByDefinition.get(d.id) ?? null,
    }));
  });
}

export async function getAgentDefinition(ctx: TenantContext, id: string): Promise<AgentDefinitionRow> {
  const row = await withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db.select().from(schema.agentDefinition).where(and(eq(schema.agentDefinition.tenantId, ctx.tenantId), eq(schema.agentDefinition.id, id)));
    return rows[0];
  });
  if (!row) throw new AgentDefinitionNotFoundError(id);
  return row;
}

export async function insertAgentDefinitionVersion(
  ctx: TenantContext,
  input: {
    agentDefinitionId: string;
    version: string;
    graphType: GraphTypeValue;
    definitionYaml: string;
    definitionHash: string;
    gitCommitSha: string | null;
    modelRouteKey: string;
    modelRouteVersionId: string;
    /** Target Architecture Blueprint Phase 10 (BL-41) — both `undefined` for any
     * version with no `spec.knowledge` configured; `agent-definition-service.ts`
     * only resolves/supplies these when the artifact actually declares one. */
    plannerRouteVersionId?: string | null;
    knowledgeConfig?: ResolvedAgentKnowledgeConfig | null;
    createdByUserId: string | null;
    /** Target Architecture Blueprint Phase 5 (BL-35, ADR-0015 §2.3) — resolved
     * `spec.skills` pins, written into `agent_version_skill` in the SAME
     * transaction as this version's own insert (`withTenant` wraps its whole
     * callback in one BEGIN/COMMIT — see `tenant-context.ts`), never a
     * follow-up call. Composition is resolved at save time, not turn time. */
    skillPins?: Array<{ skillId: string; skillVersionId: string; ordinal: number }>;
    /** ADR-0015 §2.4 — set only when this version is a Draft generated by
     * "upgrade consumers"; both stay `undefined`/NULL for an ordinarily-authored
     * version. */
    upgradeSourceVersionId?: string | null;
    upgradedSkillVersionId?: string | null;
  },
): Promise<AgentDefinitionVersionRow> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const id = generateId();
    await db.insert(schema.agentDefinitionVersion).values({
      id,
      tenantId: ctx.tenantId,
      agentDefinitionId: input.agentDefinitionId,
      version: input.version,
      graphType: input.graphType,
      status: "Draft",
      definitionYaml: input.definitionYaml,
      definitionHash: input.definitionHash,
      gitCommitSha: input.gitCommitSha,
      modelRouteKey: input.modelRouteKey,
      modelRouteVersionId: input.modelRouteVersionId,
      plannerRouteVersionId: input.plannerRouteVersionId ?? null,
      knowledgeConfig: input.knowledgeConfig ?? null,
      createdByUserId: input.createdByUserId,
      upgradeSourceVersionId: input.upgradeSourceVersionId ?? null,
      upgradedSkillVersionId: input.upgradedSkillVersionId ?? null,
    });
    if (input.skillPins && input.skillPins.length > 0) {
      await db.insert(schema.agentVersionSkill).values(
        input.skillPins.map((pin) => ({
          tenantId: ctx.tenantId,
          agentDefinitionVersionId: id,
          skillId: pin.skillId,
          skillVersionId: pin.skillVersionId,
          ordinal: pin.ordinal,
        })),
      );
    }
    const [row] = await db.select().from(schema.agentDefinitionVersion).where(eq(schema.agentDefinitionVersion.id, id));
    if (!row) throw new Error("insertAgentDefinitionVersion: insert did not return a row");
    return row;
  });
}

export async function listAgentDefinitionVersions(ctx: TenantContext, agentDefinitionId: string): Promise<AgentDefinitionVersionRow[]> {
  return withTenant(ctx, (db: TenantScopedClient) =>
    db
      .select()
      .from(schema.agentDefinitionVersion)
      .where(and(eq(schema.agentDefinitionVersion.tenantId, ctx.tenantId), eq(schema.agentDefinitionVersion.agentDefinitionId, agentDefinitionId)))
      .orderBy(desc(schema.agentDefinitionVersion.createdAt)),
  );
}

/**
 * **The NULL-binding fallback, and nothing more** (Target Architecture Blueprint
 * Phase 17, BL-48, ADR-0019 §2.2).
 *
 * Originally (QA Final Review S1) this was *the* live version resolution: it picks the
 * most recently promoted `Production` version across **all** of the tenant's agent
 * definitions, which is a reasonable "single active version" default for a tenant that
 * has exactly one bot in production — the only configuration the Admin Console could
 * produce before Phase 17. It takes only a `TenantContext`: no channel, no agent
 * definition, no weighting, no stickiness.
 *
 * Phase 17 replaced it as the live path with `resolveTurnAgentVersion`
 * (`application/turn-version-resolver.ts`), which resolves
 * channel → agent definition → deployment traffic split → version. This function is
 * **deliberately retained, not deleted**: it is what a channel with
 * `agent_definition_id IS NULL` still falls back to, so every tenant, fixture and test
 * that predates the binding behaves exactly as it did before Phase 17 (ADR-0019 §6
 * item 10's fallback-preservation requirement).
 *
 * It is renamed rather than left with its old name because the old name reads like the
 * authoritative answer to "which version is live", and it is not — it cannot express
 * which of two agent definitions answers a given channel, and its
 * "most recently promoted across all definitions" heuristic actively picks the wrong bot
 * the moment a tenant has two (ADR-0019 §3).
 *
 * Returns `null` if the tenant has never promoted any version to `Production` (a
 * genuinely correct "no agent run to trace yet" state, not a bug).
 */
export async function findActiveAgentDefinitionVersionTenantWideFallback(ctx: TenantContext): Promise<AgentDefinitionVersionRow | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select()
      .from(schema.agentDefinitionVersion)
      .where(and(eq(schema.agentDefinitionVersion.tenantId, ctx.tenantId), eq(schema.agentDefinitionVersion.status, "Production")))
      .orderBy(desc(schema.agentDefinitionVersion.updatedAt))
      .limit(1);
    return rows[0] ?? null;
  });
}

/**
 * Target Architecture Blueprint Phase 14 (BL-46, FR-ORC-03) — resolves a
 * `"<definitionName>@<version>"` pin (the form a `team_member` is authored with) to
 * the real, immutable `agent_definition_version` row.
 *
 * Returns `null` rather than throwing when either half doesn't resolve: the caller
 * (`@nextbot/teams`' team-version validator) turns that into a
 * `TEAM_VALIDATION_FAILED` naming the exact offending member, which is far more
 * useful to an author than a generic not-found.
 */
export async function findAgentDefinitionVersionByPin(
  ctx: TenantContext,
  definitionName: string,
  version: string,
): Promise<AgentDefinitionVersionRow | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select({ v: schema.agentDefinitionVersion })
      .from(schema.agentDefinitionVersion)
      .innerJoin(schema.agentDefinition, eq(schema.agentDefinition.id, schema.agentDefinitionVersion.agentDefinitionId))
      .where(
        and(
          eq(schema.agentDefinitionVersion.tenantId, ctx.tenantId),
          eq(schema.agentDefinition.name, definitionName),
          eq(schema.agentDefinitionVersion.version, version),
        ),
      );
    return rows[0]?.v ?? null;
  });
}

/** Phase 14 (BL-46) — the non-throwing sibling of `getAgentDefinitionVersion`, for
 * callers that need to distinguish "absent" from "error" (the delegation executor's
 * member-availability check, FR-ORC-10). */
export async function findAgentDefinitionVersionById(ctx: TenantContext, id: string): Promise<AgentDefinitionVersionRow | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select()
      .from(schema.agentDefinitionVersion)
      .where(and(eq(schema.agentDefinitionVersion.tenantId, ctx.tenantId), eq(schema.agentDefinitionVersion.id, id)));
    return rows[0] ?? null;
  });
}

export async function getAgentDefinitionVersion(ctx: TenantContext, id: string): Promise<AgentDefinitionVersionRow> {
  const row = await withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select()
      .from(schema.agentDefinitionVersion)
      .where(and(eq(schema.agentDefinitionVersion.tenantId, ctx.tenantId), eq(schema.agentDefinitionVersion.id, id)));
    return rows[0];
  });
  if (!row) throw new AgentVersionNotFoundError(id);
  return row;
}

/**
 * BE2 fix (QA 2026-08-15 backend pass, significant — check-then-act promotion race).
 * When `expectedCurrentStatus` is supplied, the `UPDATE` only affects a row that is
 * *still* at that status at the moment Postgres applies it — an optimistic-
 * concurrency guard, not just a read-then-write check in application code. Two
 * concurrent callers promoting the same version both read the same `currentStatus`,
 * but only the first `UPDATE` to actually commit will find a matching row; Postgres
 * serializes concurrent `UPDATE`s to the same row and re-evaluates the `WHERE` clause
 * against the just-committed value for the second one, so it is guaranteed to affect
 * zero rows — no explicit advisory lock or `SERIALIZABLE` isolation is needed for
 * this specific guarantee. Returns whether a row was actually updated so the caller
 * can distinguish "promoted" from "someone else changed it first".
 */
export async function updateAgentDefinitionVersionStatus(
  ctx: TenantContext,
  id: string,
  input: { status: AgentVersionStatusValue; approvedByUserId?: string | null; expectedCurrentStatus?: AgentVersionStatusValue },
): Promise<boolean> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const conditions = [eq(schema.agentDefinitionVersion.tenantId, ctx.tenantId), eq(schema.agentDefinitionVersion.id, id)];
    if (input.expectedCurrentStatus) conditions.push(eq(schema.agentDefinitionVersion.status, input.expectedCurrentStatus));
    const updated = await db
      .update(schema.agentDefinitionVersion)
      .set({ status: input.status, approvedByUserId: input.approvedByUserId, updatedAt: new Date() })
      .where(and(...conditions))
      .returning({ id: schema.agentDefinitionVersion.id });
    return updated.length > 0;
  });
}

/**
 * Phase 7 (client-feedback-batch item 6) — records that a real sandbox conversation
 * turn completed against this exact version. Only ever sets the column the *first*
 * time (the `isNull` guard below): versions are immutable once created, so this is a
 * one-shot "has this happened at least once" flag, not a mutable history — a second
 * or third real sandbox test against the same version is a harmless no-op here
 * (`updated.length` can be 0 on a re-call without that being an error).
 */
export async function recordAgentDefinitionVersionSandboxTest(ctx: TenantContext, id: string): Promise<void> {
  await withTenant(ctx, (db: TenantScopedClient) =>
    db
      .update(schema.agentDefinitionVersion)
      .set({ lastSandboxTestAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(schema.agentDefinitionVersion.tenantId, ctx.tenantId),
          eq(schema.agentDefinitionVersion.id, id),
          isNull(schema.agentDefinitionVersion.lastSandboxTestAt),
        ),
      ),
  );
}

export async function setVersionEvalBinding(ctx: TenantContext, id: string, input: { evalSuiteId?: string | null; lastEvalRunId?: string | null }): Promise<void> {
  await withTenant(ctx, (db: TenantScopedClient) =>
    db
      .update(schema.agentDefinitionVersion)
      .set({ ...input, updatedAt: new Date() })
      .where(and(eq(schema.agentDefinitionVersion.tenantId, ctx.tenantId), eq(schema.agentDefinitionVersion.id, id))),
  );
}

export async function setVersionGitPrInfo(ctx: TenantContext, id: string, input: { gitPrNumber: number; gitPrStatus: GitPrStatusValue }): Promise<void> {
  await withTenant(ctx, (db: TenantScopedClient) =>
    db
      .update(schema.agentDefinitionVersion)
      .set({ ...input, updatedAt: new Date() })
      .where(and(eq(schema.agentDefinitionVersion.tenantId, ctx.tenantId), eq(schema.agentDefinitionVersion.id, id))),
  );
}

export async function updateVersionGitPrStatus(ctx: TenantContext, gitPrNumber: number, gitPrStatus: GitPrStatusValue): Promise<AgentDefinitionVersionRow | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select()
      .from(schema.agentDefinitionVersion)
      .where(and(eq(schema.agentDefinitionVersion.tenantId, ctx.tenantId), eq(schema.agentDefinitionVersion.gitPrNumber, gitPrNumber)));
    const existing = rows[0];
    if (!existing) return null;
    await db
      .update(schema.agentDefinitionVersion)
      .set({ gitPrStatus, updatedAt: new Date() })
      .where(and(eq(schema.agentDefinitionVersion.tenantId, ctx.tenantId), eq(schema.agentDefinitionVersion.id, existing.id)));
    return { ...existing, gitPrStatus };
  });
}

/** Every version with an open (`Open`) PR/MR for this one tenant — the 15-minute
 * polling reconciliation sweep (ADR-0009) calls this once per tenant (enumerated via
 * `@nextbot/tenancy`'s `listActiveTenantContexts()`), never across tenants in one
 * query, since `withTenant` cannot cross a tenant boundary by design (LLD §3.2). */
export async function listOpenGitPrVersions(ctx: TenantContext): Promise<AgentDefinitionVersionRow[]> {
  return withTenant(ctx, (db: TenantScopedClient) =>
    db
      .select()
      .from(schema.agentDefinitionVersion)
      .where(and(eq(schema.agentDefinitionVersion.tenantId, ctx.tenantId), eq(schema.agentDefinitionVersion.gitPrStatus, "Open"))),
  );
}
