import { and, eq, desc, gte } from "drizzle-orm";
import { generateId, schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";
import type { ModelRouteRoleValue, ModelRouteVersionStatusValue } from "@nextbot/contracts";
import type { ModelRouteChain, ModelRoutePolicy, ModelCapabilitiesFlags } from "@nextbot/db/schema";

/**
 * Target Architecture Blueprint Phase 2 (BL-33, LLD §14.8.2) — Route v2 persistence:
 * `model_route` (identity), `model_route_version` (immutable), plus the moved
 * `model_budget`/`model_cache_entry`/`model_usage_event` and the platform-level
 * `platform_provider_type_policy`. Every function here is a thin, tenant-scoped
 * (or `withPlatform`-scoped, for the one platform table) read/write — no business
 * logic lives here (that's `application/route-service.ts`'s job).
 */

export interface ModelRouteRow {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  role: ModelRouteRoleValue;
  currentVersionId: string | null;
  status: "Active" | "Archived";
  createdAt: Date;
  updatedAt: Date;
}

export interface ModelRouteVersionRow {
  id: string;
  tenantId: string;
  routeId: string;
  version: number;
  chainJson: ModelRouteChain;
  policyJson: ModelRoutePolicy;
  advertisedCapabilities: ModelCapabilitiesFlags;
  strictestDataHandling: { retainsPrompts: boolean; trainsOnData: boolean };
  maxRegionSet: string[];
  status: ModelRouteVersionStatusValue;
  createdByUserId: string | null;
  publishedAt: Date | null;
  createdAt: Date;
}

export async function listRoutes(ctx: TenantContext): Promise<ModelRouteRow[]> {
  return withTenant(ctx, (db: TenantScopedClient) => db.select().from(schema.modelRoute).where(eq(schema.modelRoute.tenantId, ctx.tenantId))) as Promise<
    ModelRouteRow[]
  >;
}

export async function getRoute(ctx: TenantContext, id: string): Promise<ModelRouteRow | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db.select().from(schema.modelRoute).where(and(eq(schema.modelRoute.id, id), eq(schema.modelRoute.tenantId, ctx.tenantId)));
    return (rows[0] as ModelRouteRow | undefined) ?? null;
  });
}

export async function getRouteByName(ctx: TenantContext, name: string): Promise<ModelRouteRow | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db.select().from(schema.modelRoute).where(and(eq(schema.modelRoute.tenantId, ctx.tenantId), eq(schema.modelRoute.name, name)));
    return (rows[0] as ModelRouteRow | undefined) ?? null;
  });
}

export async function createRoute(
  ctx: TenantContext,
  input: { name: string; description?: string; role?: ModelRouteRoleValue },
): Promise<ModelRouteRow> {
  const id = generateId();
  await withTenant(ctx, (db: TenantScopedClient) =>
    db.insert(schema.modelRoute).values({ id, tenantId: ctx.tenantId, name: input.name, description: input.description, role: input.role ?? "custom" }),
  );
  const row = await getRoute(ctx, id);
  if (!row) throw new Error("createRoute: insert did not return a row");
  return row;
}

export async function setRouteCurrentVersion(ctx: TenantContext, routeId: string, versionId: string): Promise<void> {
  await withTenant(ctx, (db: TenantScopedClient) =>
    db.update(schema.modelRoute).set({ currentVersionId: versionId, updatedAt: new Date() }).where(and(eq(schema.modelRoute.id, routeId), eq(schema.modelRoute.tenantId, ctx.tenantId))),
  );
}

export async function listRouteVersions(ctx: TenantContext, routeId: string): Promise<ModelRouteVersionRow[]> {
  return withTenant(ctx, (db: TenantScopedClient) =>
    db
      .select()
      .from(schema.modelRouteVersion)
      .where(and(eq(schema.modelRouteVersion.tenantId, ctx.tenantId), eq(schema.modelRouteVersion.routeId, routeId)))
      .orderBy(desc(schema.modelRouteVersion.version)),
  ) as Promise<ModelRouteVersionRow[]>;
}

export async function getRouteVersion(ctx: TenantContext, id: string): Promise<ModelRouteVersionRow | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db.select().from(schema.modelRouteVersion).where(and(eq(schema.modelRouteVersion.id, id), eq(schema.modelRouteVersion.tenantId, ctx.tenantId)));
    return (rows[0] as ModelRouteVersionRow | undefined) ?? null;
  });
}

/** The immutable insert — a route version is NEVER updated once created (same triple
 * enforcement as `agent_definition_version`/`skill_version`); "editing" a route always
 * means calling this again with a new, incremented `version` number. */
export async function insertRouteVersion(
  ctx: TenantContext,
  input: {
    routeId: string;
    version: number;
    chainJson: ModelRouteChain;
    policyJson: ModelRoutePolicy;
    advertisedCapabilities: ModelCapabilitiesFlags;
    strictestDataHandling: { retainsPrompts: boolean; trainsOnData: boolean };
    maxRegionSet: string[];
    status?: ModelRouteVersionStatusValue;
    createdByUserId?: string;
  },
): Promise<ModelRouteVersionRow> {
  const id = generateId();
  await withTenant(ctx, (db: TenantScopedClient) =>
    db.insert(schema.modelRouteVersion).values({
      id,
      tenantId: ctx.tenantId,
      routeId: input.routeId,
      version: input.version,
      chainJson: input.chainJson,
      policyJson: input.policyJson,
      advertisedCapabilities: input.advertisedCapabilities,
      strictestDataHandling: input.strictestDataHandling,
      maxRegionSet: input.maxRegionSet,
      status: input.status ?? "Draft",
      createdByUserId: input.createdByUserId,
      publishedAt: input.status === "Published" ? new Date() : undefined,
    }),
  );
  const row = await getRouteVersion(ctx, id);
  if (!row) throw new Error("insertRouteVersion: insert did not return a row");
  return row;
}

export async function publishRouteVersion(ctx: TenantContext, id: string): Promise<ModelRouteVersionRow> {
  await withTenant(ctx, (db: TenantScopedClient) =>
    db.update(schema.modelRouteVersion).set({ status: "Published", publishedAt: new Date() }).where(and(eq(schema.modelRouteVersion.id, id), eq(schema.modelRouteVersion.tenantId, ctx.tenantId))),
  );
  const row = await getRouteVersion(ctx, id);
  if (!row) throw new Error("publishRouteVersion: row disappeared after update");
  return row;
}

// ---------------------------------------------------------------------------
// model_usage_event (FR-AGT-24 — the renamed model_call_log)
// ---------------------------------------------------------------------------

export interface InsertUsageEventInput {
  agentRunId?: string;
  routeVersionId?: string;
  catalogEntryId?: string;
  providerId?: string;
  routeKey: string;
  providerKey: string;
  model: string;
  agentDefinitionVersionId?: string;
  conversationId?: string;
  hopIndex?: number;
  attempt?: number;
  cached?: boolean;
  cacheKind?: "None" | "Exact" | "Semantic";
  tokensIn?: number;
  tokensOut?: number;
  cachedTokens?: number;
  costUsd?: string;
  latencyMs?: number;
  outcome: "Success" | "ProviderError" | "Timeout" | "RateLimited" | "Filtered" | "CacheHit" | "BudgetStopped";
  errorCode?: string;
  channelType?: string;
  /** Target Architecture Blueprint Phase 7b (FR-AGT-24) — attributes an ingestion
   *  model call (Extract/Embed stages) to the `knowledge_index_generation` it ran
   *  for. The column already existed on `model_usage_event` (added in Phase 2, in
   *  anticipation of this exact use) but was never wired to an insert path until now. */
  knowledgeGenerationId?: string;
}

export async function insertUsageEvent(ctx: TenantContext, input: InsertUsageEventInput): Promise<void> {
  await withTenant(ctx, (db: TenantScopedClient) =>
    db.insert(schema.modelUsageEvent).values({
      id: generateId(),
      tenantId: ctx.tenantId,
      agentRunId: input.agentRunId,
      routeVersionId: input.routeVersionId,
      catalogEntryId: input.catalogEntryId,
      providerId: input.providerId,
      routeKey: input.routeKey,
      providerKey: input.providerKey,
      model: input.model,
      agentDefinitionVersionId: input.agentDefinitionVersionId,
      conversationId: input.conversationId,
      hopIndex: input.hopIndex ?? 0,
      attempt: input.attempt ?? 1,
      cached: input.cached ?? false,
      cacheKind: input.cacheKind ?? "None",
      tokensIn: input.tokensIn,
      tokensOut: input.tokensOut,
      cachedTokens: input.cachedTokens ?? 0,
      costUsd: input.costUsd,
      latencyMs: input.latencyMs,
      outcome: input.outcome,
      errorCode: input.errorCode,
      channelType: input.channelType as (typeof schema.modelUsageEvent.$inferInsert)["channelType"],
      knowledgeGenerationId: input.knowledgeGenerationId,
    }),
  );
}

/** Every raw usage-event row for this tenant in `[from, to]` — used by
 * `usage-service.ts`'s in-process aggregation and the ClickHouse mirror-write bridge.
 * Not paginated (this phase's usage view aggregates a bounded reporting window, same
 * scale assumption `sumModelCallCostSince` already made pre-Phase-2). */
export async function listUsageEventsInRange(ctx: TenantContext, from: Date, to: Date) {
  return withTenant(ctx, (db: TenantScopedClient) =>
    db.select().from(schema.modelUsageEvent).where(eq(schema.modelUsageEvent.tenantId, ctx.tenantId)),
  ).then((rows) => (rows as Array<typeof schema.modelUsageEvent.$inferSelect>).filter((r) => r.createdAt >= from && r.createdAt <= to));
}

// ---------------------------------------------------------------------------
// model_budget / model_cache_entry (moved unchanged, LLD §14.8.6 rule 3)
// ---------------------------------------------------------------------------

export interface ModelBudgetRow {
  id: string;
  tenantId: string;
  scope: "Tenant" | "Agent";
  agentDefinitionId: string | null;
  routeId: string | null;
  period: "Day" | "Month";
  capUsd: string;
  alertPcts: number[];
  onExceed: "Throttle" | "HardStop" | "AlertOnly";
  degradedMode: "KnowledgeBaseOnly" | "ImmediateEscalation" | "StaticMessage" | null;
  degradedMessage: string | null;
}

export async function insertModelBudget(
  ctx: TenantContext,
  input: {
    scope: "Tenant" | "Agent";
    agentDefinitionId?: string;
    routeId?: string;
    period: "Day" | "Month";
    capUsd: string;
    alertPcts?: number[];
    onExceed?: "Throttle" | "HardStop" | "AlertOnly";
    degradedMode?: "KnowledgeBaseOnly" | "ImmediateEscalation" | "StaticMessage";
    degradedMessage?: string;
  },
): Promise<ModelBudgetRow> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const id = generateId();
    await db.insert(schema.modelBudget).values({
      id,
      tenantId: ctx.tenantId,
      scope: input.scope,
      agentDefinitionId: input.agentDefinitionId,
      routeId: input.routeId,
      period: input.period,
      capUsd: input.capUsd,
      alertPcts: input.alertPcts,
      onExceed: input.onExceed ?? "AlertOnly",
      degradedMode: input.degradedMode,
      degradedMessage: input.degradedMessage,
    });
    const [row] = await db.select().from(schema.modelBudget).where(eq(schema.modelBudget.id, id));
    if (!row) throw new Error("insertModelBudget: insert did not return a row");
    return row as ModelBudgetRow;
  });
}

export async function listApplicableModelBudgets(ctx: TenantContext, agentDefinitionId: string): Promise<ModelBudgetRow[]> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = (await db.select().from(schema.modelBudget).where(eq(schema.modelBudget.tenantId, ctx.tenantId))) as ModelBudgetRow[];
    return rows.filter((r) => r.scope === "Tenant" || (r.scope === "Agent" && r.agentDefinitionId === agentDefinitionId));
  });
}

/**
 * Sums this period's model spend, optionally scoped to one agent definition (via the
 * `model_usage_event -> agent_run -> agent_definition_version` join below). Backs
 * `enforceModelBudget`'s `model_budget` check at the new-agent-run boundary.
 *
 * **Shadow-run audit disposition (Target Architecture Blueprint Phase 17, BL-48,
 * ADR-0019 §2.5): deliberately INCLUDES `agent_run.trigger = 'ShadowEvaluation'`, and
 * that inclusion is the correct behavior, not an oversight.**
 *
 * Shadow evaluation replays a candidate version through the real Model Gateway against
 * real customer content: the provider round-trip happens, the tokens are billed, and the
 * money is genuinely spent. ADR-0019 §2.5 is explicit — "Shadow inference is **real spend
 * and is charged and attributed normally** through the Model Gateway against
 * `model_budget`; hiding it would be dishonest about the price of the experiment."
 * Excluding it here would let an experiment spend past a tenant's `HardStop` budget while
 * the budget gauge read clean.
 *
 * This is therefore the one reader in the `agent_run` audit whose disposition is
 * "explicitly handled — includes shadow" rather than "excluded". Every reporting/analytics
 * reader takes the opposite disposition; see `agent-run-repository.ts`'s
 * `excludeShadowRuns()`.
 */
export async function sumModelUsageCostSince(ctx: TenantContext, input: { since: Date; agentDefinitionId?: string }): Promise<number> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    if (input.agentDefinitionId) {
      const rows = await db
        .select({ costUsd: schema.modelUsageEvent.costUsd })
        .from(schema.modelUsageEvent)
        .innerJoin(schema.agentRun, eq(schema.modelUsageEvent.agentRunId, schema.agentRun.id))
        .innerJoin(schema.agentDefinitionVersion, eq(schema.agentRun.agentDefinitionVersionId, schema.agentDefinitionVersion.id))
        .where(
          and(
            eq(schema.modelUsageEvent.tenantId, ctx.tenantId),
            eq(schema.agentDefinitionVersion.agentDefinitionId, input.agentDefinitionId),
            gte(schema.modelUsageEvent.createdAt, input.since),
          ),
        );
      return rows.reduce((sum, r) => sum + Number(r.costUsd ?? 0), 0);
    }
    const rows = await db
      .select({ costUsd: schema.modelUsageEvent.costUsd })
      .from(schema.modelUsageEvent)
      .where(and(eq(schema.modelUsageEvent.tenantId, ctx.tenantId), gte(schema.modelUsageEvent.createdAt, input.since)));
    return rows.reduce((sum, r) => sum + Number(r.costUsd ?? 0), 0);
  });
}

export async function getCacheEntry(ctx: TenantContext, routeKey: string, promptHash: string) {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select()
      .from(schema.modelCacheEntry)
      .where(and(eq(schema.modelCacheEntry.tenantId, ctx.tenantId), eq(schema.modelCacheEntry.routeKey, routeKey), eq(schema.modelCacheEntry.promptHash, promptHash)));
    return rows[0] ?? null;
  });
}

export async function upsertCacheEntry(
  ctx: TenantContext,
  input: { routeKey: string; routeId?: string; promptHash: string; response: unknown; tokensSaved: number; expiresAt: Date },
): Promise<void> {
  await withTenant(ctx, async (db: TenantScopedClient) => {
    const existing = await db
      .select({ id: schema.modelCacheEntry.id, hits: schema.modelCacheEntry.hits })
      .from(schema.modelCacheEntry)
      .where(and(eq(schema.modelCacheEntry.tenantId, ctx.tenantId), eq(schema.modelCacheEntry.routeKey, input.routeKey), eq(schema.modelCacheEntry.promptHash, input.promptHash)));
    if (existing[0]) {
      await db.update(schema.modelCacheEntry).set({ hits: (existing[0].hits ?? 0) + 1 }).where(eq(schema.modelCacheEntry.id, existing[0].id));
      return;
    }
    await db.insert(schema.modelCacheEntry).values({
      id: generateId(),
      tenantId: ctx.tenantId,
      routeKey: input.routeKey,
      routeId: input.routeId,
      promptHash: input.promptHash,
      response: input.response,
      tokensSaved: input.tokensSaved,
      expiresAt: input.expiresAt,
    });
  });
}
