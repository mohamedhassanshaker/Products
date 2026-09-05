import { and, eq } from "drizzle-orm";
import { generateId, schema, withTenant, type TenantContext, type TenantScopedClient, type Region } from "@nextbot/db";
import type { ModelCapabilitiesValue, ModelProviderTypeValue } from "@nextbot/contracts";

/** Public row shapes — deliberately close to the DB column names (camelCase), since
 * every consumer of this module (agent-platform, apps/web routes) works with these
 * directly rather than a further-mapped view model. */
export interface ModelProviderRow {
  id: string;
  tenantId: string | null;
  type: ModelProviderTypeValue;
  name: string;
  baseUrl: string | null;
  region: Region;
  regionsServed: string[];
  authMethod: "ApiKey" | "EntraId" | "ServiceAccount" | "IamRole" | "Mtls" | "None";
  credentialId: string | null;
  orgOrProjectId: string | null;
  retainsPrompts: boolean;
  trainsOnData: boolean;
  rateLimitJson: { requestsPerMinute?: number; tokensPerMinute?: number; maxConcurrent?: number } | null;
  status: "Active" | "Unreachable" | "Disabled" | "CredentialInvalid";
  healthIntervalSeconds: number;
  lastProbeAt: Date | null;
  lastProbeError: { code: string; message: string } | null;
  catalogSyncedAt: Date | null;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ModelCatalogEntryRow {
  id: string;
  tenantId: string | null;
  providerId: string;
  modelId: string;
  displayName: string;
  modality: "Text" | "Vision" | "Audio" | "Embedding" | "Rerank" | "Multimodal";
  contextWindow: number;
  maxOutput: number;
  dimension: number | null;
  capabilitiesJson: ModelCapabilitiesValue;
  tokenizer: string;
  priceIn: string;
  priceOut: string;
  priceCached: string;
  latencyProfile: { p50Ms: number; p95Ms: number; sampledAt: string } | null;
  status: "Available" | "Preview" | "Deprecating" | "Retired";
  deprecatesAt: Date | null;
  source: "Synced" | "Manual";
  syncedAt: Date | null;
  needsReview: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** Every provider row this tenant can see — its own BYO providers plus every
 * platform-registered one (RLS's `tenant_id IS NULL OR tenant_id = current_tenant`
 * does the actual filtering; this query has no extra WHERE beyond what RLS already
 * enforces, matching this codebase's "RLS is the backstop, not a redundant client
 * filter we also hand-roll" convention for platform-shared tables specifically —
 * unlike ordinary tenant-scoped tables, where LLD §3.2 rule 4 asks for defense in
 * depth, a platform-shared table's whole point is that both branches are legitimately
 * visible). */
export async function listProviders(ctx: TenantContext): Promise<ModelProviderRow[]> {
  return withTenant(ctx, (db: TenantScopedClient) => db.select().from(schema.modelProvider)) as Promise<ModelProviderRow[]>;
}

export async function getProvider(ctx: TenantContext, id: string): Promise<ModelProviderRow | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db.select().from(schema.modelProvider).where(eq(schema.modelProvider.id, id));
    return (rows[0] as ModelProviderRow | undefined) ?? null;
  });
}

/** First provider row matching `type` visible to this tenant (own row preferred over
 * a platform-shared one of the same type, so a tenant's own BYO override always wins)
 * — the read path `resolveModelChainForRoute` (agent-platform) uses in place of the
 * old cross-module `getModelProviderByKey`. */
export async function getProviderByType(ctx: TenantContext, type: ModelProviderTypeValue): Promise<ModelProviderRow | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = (await db.select().from(schema.modelProvider).where(eq(schema.modelProvider.type, type))) as ModelProviderRow[];
    if (rows.length === 0) return null;
    return rows.find((r) => r.tenantId === ctx.tenantId) ?? rows.find((r) => r.tenantId === null) ?? rows[0]!;
  });
}

export interface CreateProviderInput {
  id?: string;
  type: ModelProviderTypeValue;
  name: string;
  baseUrl?: string;
  region: Region;
  regionsServed?: string[];
  authMethod: ModelProviderRow["authMethod"];
  credentialId?: string;
  orgOrProjectId?: string;
  retainsPrompts?: boolean;
  trainsOnData?: boolean;
  rateLimitJson?: ModelProviderRow["rateLimitJson"];
  healthIntervalSeconds?: number;
  enabled?: boolean;
}

/** Always creates a TENANT-owned row (`tenant_id = ctx.tenantId`) — writing a
 * platform-shared (`tenant_id IS NULL`) row requires `withPlatform()`, callable only
 * from tenancy provisioning / `/api/internal/ops/**` (LLD §3.2 rule 4); no such ops
 * endpoint is in this phase's scope (flagged in the plan doc, not a silent gap). */
export async function createProvider(ctx: TenantContext, input: CreateProviderInput): Promise<ModelProviderRow> {
  const id = input.id ?? generateId();
  await withTenant(ctx, (db: TenantScopedClient) =>
    db.insert(schema.modelProvider).values({
      id,
      tenantId: ctx.tenantId,
      type: input.type,
      name: input.name,
      baseUrl: input.baseUrl,
      region: input.region,
      regionsServed: input.regionsServed ?? [],
      authMethod: input.authMethod,
      credentialId: input.credentialId,
      orgOrProjectId: input.orgOrProjectId,
      retainsPrompts: input.retainsPrompts ?? false,
      trainsOnData: input.trainsOnData ?? false,
      rateLimitJson: input.rateLimitJson,
      healthIntervalSeconds: input.healthIntervalSeconds ?? 300,
      enabled: input.enabled ?? true,
    }),
  );
  const row = await getProvider(ctx, id);
  if (!row) throw new Error("createProvider: insert did not return a row");
  return row;
}

export interface UpdateProviderInput {
  name?: string;
  baseUrl?: string;
  region?: Region;
  regionsServed?: string[];
  credentialId?: string;
  orgOrProjectId?: string;
  retainsPrompts?: boolean;
  trainsOnData?: boolean;
  rateLimitJson?: ModelProviderRow["rateLimitJson"];
  healthIntervalSeconds?: number;
  enabled?: boolean;
}

/** Scoped to `(id, tenant_id = ctx.tenantId)` at the query level too (defense in
 * depth on top of RLS, per LLD §3.2 rule 4) — updating a platform row or another
 * tenant's row silently affects zero rows rather than ever touching one. */
export async function updateOwnProvider(ctx: TenantContext, id: string, patch: UpdateProviderInput): Promise<number> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const result = await db
      .update(schema.modelProvider)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(schema.modelProvider.id, id), eq(schema.modelProvider.tenantId, ctx.tenantId)));
    return (result as unknown as { rowCount: number }).rowCount ?? 0;
  });
}

export async function setProviderStatus(
  ctx: TenantContext,
  id: string,
  patch: { status?: ModelProviderRow["status"]; lastProbeAt?: Date; lastProbeError?: ModelProviderRow["lastProbeError"]; catalogSyncedAt?: Date },
): Promise<void> {
  await withTenant(ctx, (db: TenantScopedClient) =>
    db.update(schema.modelProvider).set({ ...patch, updatedAt: new Date() }).where(eq(schema.modelProvider.id, id)),
  );
}

/**
 * Backward-compat surface (pre-existing behavior, moved from
 * `packages/modules/agent-platform`): a platform-level, upsert-by-`(tenant, type)`
 * registration used by `scripts/seed.ts` and the v1 Model Gateway console screen —
 * see this module's `index.ts` doc comment for why the signature/shape must not
 * change. Post-migration, this always upserts a **tenant-owned** row scoped to
 * `ctx.tenantId` (never `tenant_id IS NULL` — see `createProvider`'s doc comment for
 * why), which is a deliberate, flagged narrowing from the pre-Phase-1 "one shared
 * platform row" semantics; the pre-existing platform row from before this migration
 * (seeded data) is untouched and keeps resolving exactly as it did.
 */
export async function registerModelProvider(
  ctx: TenantContext,
  input: { key: ModelProviderTypeValue; label: string; baseUrl?: string; credentialId?: string; regions: string[]; enabled?: boolean },
): Promise<ModelProviderRow> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const existing = await db
      .select({ id: schema.modelProvider.id })
      .from(schema.modelProvider)
      .where(and(eq(schema.modelProvider.tenantId, ctx.tenantId), eq(schema.modelProvider.type, input.key)));

    const values = {
      name: input.label,
      baseUrl: input.baseUrl,
      region: (input.regions[0] as Region | undefined) ?? ctx.region,
      regionsServed: input.regions,
      authMethod: input.credentialId ? ("ApiKey" as const) : ("None" as const),
      credentialId: input.credentialId,
      enabled: input.enabled ?? true,
      updatedAt: new Date(),
    };

    if (existing[0]) {
      await db.update(schema.modelProvider).set(values).where(eq(schema.modelProvider.id, existing[0].id));
      const [row] = await db.select().from(schema.modelProvider).where(eq(schema.modelProvider.id, existing[0].id));
      if (!row) throw new Error("registerModelProvider: row disappeared after update");
      return row as ModelProviderRow;
    }

    const id = generateId();
    await db.insert(schema.modelProvider).values({ id, tenantId: ctx.tenantId, type: input.key, ...values });
    const [row] = await db.select().from(schema.modelProvider).where(eq(schema.modelProvider.id, id));
    if (!row) throw new Error("registerModelProvider: insert did not return a row");
    return row as ModelProviderRow;
  });
}

// ---------------------------------------------------------------------------
// model_catalog_entry
// ---------------------------------------------------------------------------

export async function listCatalogEntries(
  ctx: TenantContext,
  filters: { providerId?: string; modality?: ModelCatalogEntryRow["modality"]; status?: ModelCatalogEntryRow["status"] } = {},
): Promise<ModelCatalogEntryRow[]> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const conditions = [
      filters.providerId ? eq(schema.modelCatalogEntry.providerId, filters.providerId) : undefined,
      filters.modality ? eq(schema.modelCatalogEntry.modality, filters.modality) : undefined,
      filters.status ? eq(schema.modelCatalogEntry.status, filters.status) : undefined,
    ].filter((c): c is NonNullable<typeof c> => c !== undefined);
    const query = db.select().from(schema.modelCatalogEntry);
    const rows = conditions.length > 0 ? await query.where(and(...conditions)) : await query;
    return rows as ModelCatalogEntryRow[];
  });
}

export async function getCatalogEntry(ctx: TenantContext, id: string): Promise<ModelCatalogEntryRow | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db.select().from(schema.modelCatalogEntry).where(eq(schema.modelCatalogEntry.id, id));
    return (rows[0] as ModelCatalogEntryRow | undefined) ?? null;
  });
}

export interface CreateCatalogEntryInput {
  id?: string;
  providerId: string;
  modelId: string;
  displayName: string;
  modality: ModelCatalogEntryRow["modality"];
  contextWindow: number;
  maxOutput: number;
  dimension?: number;
  capabilitiesJson: ModelCapabilitiesValue;
  tokenizer: string;
  priceIn?: string;
  priceOut?: string;
  priceCached?: string;
  status?: ModelCatalogEntryRow["status"];
  deprecatesAt?: Date;
  source: ModelCatalogEntryRow["source"];
  syncedAt?: Date;
  needsReview?: boolean;
}

export async function createCatalogEntry(ctx: TenantContext, input: CreateCatalogEntryInput): Promise<ModelCatalogEntryRow> {
  const id = input.id ?? generateId();
  await withTenant(ctx, (db: TenantScopedClient) =>
    db.insert(schema.modelCatalogEntry).values({
      id,
      // Overwritten by the `model_catalog_entry_mirror_tenant_trigger` regardless of
      // what's supplied here — passing `ctx.tenantId` documents intent but the DB
      // trigger is the actual enforcement (LLD §14.8.2).
      tenantId: ctx.tenantId,
      providerId: input.providerId,
      modelId: input.modelId,
      displayName: input.displayName,
      modality: input.modality,
      contextWindow: input.contextWindow,
      maxOutput: input.maxOutput,
      dimension: input.dimension,
      capabilitiesJson: input.capabilitiesJson,
      tokenizer: input.tokenizer,
      priceIn: input.priceIn ?? "0",
      priceOut: input.priceOut ?? "0",
      priceCached: input.priceCached ?? "0",
      status: input.status ?? "Available",
      deprecatesAt: input.deprecatesAt,
      source: input.source,
      syncedAt: input.syncedAt,
      needsReview: input.needsReview ?? false,
    }),
  );
  const row = await getCatalogEntry(ctx, id);
  if (!row) throw new Error("createCatalogEntry: insert did not return a row");
  return row;
}

export interface UpdateCatalogEntryInput {
  displayName?: string;
  contextWindow?: number;
  maxOutput?: number;
  dimension?: number;
  capabilitiesJson?: ModelCapabilitiesValue;
  priceIn?: string;
  priceOut?: string;
  priceCached?: string;
  status?: ModelCatalogEntryRow["status"];
  deprecatesAt?: Date | null;
  syncedAt?: Date;
  needsReview?: boolean;
}

export async function updateCatalogEntry(ctx: TenantContext, id: string, patch: UpdateCatalogEntryInput): Promise<void> {
  await withTenant(ctx, (db: TenantScopedClient) =>
    db.update(schema.modelCatalogEntry).set({ ...patch, updatedAt: new Date() }).where(eq(schema.modelCatalogEntry.id, id)),
  );
}

/** A real DELETE — reserved for manually-declared entries only (the application
 * layer enforces that; this function just executes it). A synced entry is never hard-
 * deleted, only retired (ADR-0011 §4: "a model that disappears from the provider's
 * listing is set to `status='Retired'`, never deleted, so a route referencing it
 * still resolves"). */
export async function deleteCatalogEntry(ctx: TenantContext, id: string): Promise<void> {
  await withTenant(ctx, (db: TenantScopedClient) => db.delete(schema.modelCatalogEntry).where(eq(schema.modelCatalogEntry.id, id)));
}

/**
 * A single tenant's OWN provider rows only (excludes platform-shared ones) — used by
 * the `model-gateway.catalog-sync` / `model-gateway.provider-probe` scheduled jobs.
 *
 * **Scope trim, flagged deliberately**: these jobs update `model_provider.status` /
 * `last_probe_at` / `last_probe_error` / `catalog_synced_at`, which per LLD §14.8.7's
 * RLS shape can only be written to a `tenant_id IS NOT NULL` row through the ordinary
 * `withTenant()` path — writing a `tenant_id IS NULL` platform row requires
 * `withPlatform()`, callable only from tenancy provisioning / `/api/internal/ops/**`
 * (LLD §3.2 rule 4), neither of which a scheduled worker job is. Keeping a platform-
 * shared provider's health/catalog current from a background job is therefore out of
 * this phase's scope (it would need a small `/api/internal/ops/model-gateway/**`
 * surface, not built here) — the pre-existing seeded platform provider keeps
 * resolving exactly as it did (§14.8.6's migration guarantee), it simply isn't
 * probed/synced by these jobs. A tenant's own BYO provider (the common case this
 * phase's console screens create) IS fully probed/synced.
 */
export async function listOwnProvidersForTenant(ctx: TenantContext): Promise<ModelProviderRow[]> {
  return withTenant(ctx, (db: TenantScopedClient) =>
    db.select().from(schema.modelProvider).where(eq(schema.modelProvider.tenantId, ctx.tenantId)),
  ) as Promise<ModelProviderRow[]>;
}
