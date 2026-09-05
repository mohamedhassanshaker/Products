import { and, eq, isNull } from "drizzle-orm";
import { generateId, schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";
import type { ChunkingConfig, KnowledgeTrustLevel } from "@nextbot/db";
import { KnowledgeCollectionNameDuplicateError, KnowledgeCollectionNotFoundError } from "@nextbot/contracts";

export type KnowledgeCollectionRow = typeof schema.knowledgeCollection.$inferSelect;

export interface CreateCollectionInput {
  name: string;
  description?: string;
  region: "UAE" | "EU" | "US";
  retentionDays?: number | null;
  trustLevel?: KnowledgeTrustLevel;
  chunkingConfig?: ChunkingConfig;
  extractionRouteVersionId: string;
  embeddingRouteVersionId: string;
  rerankRouteVersionId?: string | null;
  defaultStrategy?: "Vector" | "GraphLocal" | "GraphGlobal" | "Hybrid" | null;
  maxStalenessHours?: number | null;
  minRelevanceScore?: number;
}

/** All repository access wrapped in `withTenant()` — no RBAC awareness inside this
 *  module (enforced only at the composition root, per this codebase's established
 *  skills/mcp-registry convention). */
export async function createCollection(ctx: TenantContext, input: CreateCollectionInput): Promise<KnowledgeCollectionRow> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const existing = await db
      .select({ id: schema.knowledgeCollection.id })
      .from(schema.knowledgeCollection)
      .where(and(eq(schema.knowledgeCollection.tenantId, ctx.tenantId), eq(schema.knowledgeCollection.name, input.name)));
    if (existing.length > 0) throw new KnowledgeCollectionNameDuplicateError(input.name);

    const id = generateId();
    await db.insert(schema.knowledgeCollection).values({
      id,
      tenantId: ctx.tenantId,
      name: input.name,
      description: input.description,
      region: input.region,
      retentionDays: input.retentionDays ?? null,
      trustLevel: input.trustLevel ?? "SemiTrusted",
      chunkingConfig: input.chunkingConfig,
      extractionRouteVersionId: input.extractionRouteVersionId,
      embeddingRouteVersionId: input.embeddingRouteVersionId,
      rerankRouteVersionId: input.rerankRouteVersionId,
      defaultStrategy: input.defaultStrategy,
      maxStalenessHours: input.maxStalenessHours,
      minRelevanceScore: input.minRelevanceScore,
    });
    const [row] = await db.select().from(schema.knowledgeCollection).where(eq(schema.knowledgeCollection.id, id));
    if (!row) throw new Error("createCollection: insert did not return a row");
    return row as KnowledgeCollectionRow;
  });
}

export async function listCollections(ctx: TenantContext): Promise<KnowledgeCollectionRow[]> {
  return withTenant(ctx, (db: TenantScopedClient) =>
    db
      .select()
      .from(schema.knowledgeCollection)
      .where(and(eq(schema.knowledgeCollection.tenantId, ctx.tenantId), isNull(schema.knowledgeCollection.deletedAt))),
  ) as Promise<KnowledgeCollectionRow[]>;
}

export async function getCollection(ctx: TenantContext, id: string): Promise<KnowledgeCollectionRow | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db.select().from(schema.knowledgeCollection).where(and(eq(schema.knowledgeCollection.id, id), eq(schema.knowledgeCollection.tenantId, ctx.tenantId)));
    return (rows[0] as KnowledgeCollectionRow | undefined) ?? null;
  });
}

export async function getCollectionOrThrow(ctx: TenantContext, id: string): Promise<KnowledgeCollectionRow> {
  const row = await getCollection(ctx, id);
  if (!row) throw new KnowledgeCollectionNotFoundError(id);
  return row;
}

/**
 * Target Architecture Blueprint Phase 10 (BL-41, FR-KB-05, Blueprint §7.5) — looks up
 * a collection by its (tenant-unique, `knowledge_collection_tenant_name_key`) name,
 * for `resolveKnowledgeCollectionPin`'s save-time `"<name>@<N>"` pin resolution. `null`
 * (never throws) — the caller decides whether an unresolvable name is a hard save-time
 * failure (it is, for an agent version's `spec.knowledge.collections` pin).
 */
export async function getCollectionByName(ctx: TenantContext, name: string): Promise<KnowledgeCollectionRow | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select()
      .from(schema.knowledgeCollection)
      .where(and(eq(schema.knowledgeCollection.tenantId, ctx.tenantId), eq(schema.knowledgeCollection.name, name), isNull(schema.knowledgeCollection.deletedAt)));
    return (rows[0] as KnowledgeCollectionRow | undefined) ?? null;
  });
}

export interface UpdateCollectionFields {
  name?: string;
  description?: string | null;
  retentionDays?: number | null;
  defaultStrategy?: "Vector" | "GraphLocal" | "GraphGlobal" | "Hybrid" | null;
  maxStalenessHours?: number | null;
  minRelevanceScore?: number;
}

/** Updates only the fields the `knowledge` module (not `knowledge_config`) governs —
 *  see `application/collection-service.ts` for which fields require which RBAC
 *  module, enforced at the HTTP composition-root layer. */
export async function updateCollectionFields(ctx: TenantContext, id: string, fields: UpdateCollectionFields): Promise<KnowledgeCollectionRow> {
  await withTenant(ctx, (db: TenantScopedClient) =>
    db
      .update(schema.knowledgeCollection)
      .set({ ...fields, updatedAt: new Date() })
      .where(and(eq(schema.knowledgeCollection.id, id), eq(schema.knowledgeCollection.tenantId, ctx.tenantId))),
  );
  return getCollectionOrThrow(ctx, id);
}

/** Updates the `knowledge_config`-gated fields only (embedding/rerank route pins,
 *  chunking/extraction policy) — kept as a SEPARATE function (not folded into
 *  `updateCollectionFields`) so it is impossible to accidentally change a
 *  config field through the general-purpose update path without going through this
 *  one, more scrutinized call site. */
export async function updateCollectionConfig(
  ctx: TenantContext,
  id: string,
  fields: { extractionRouteVersionId?: string; embeddingRouteVersionId?: string; rerankRouteVersionId?: string | null; chunkingConfig?: ChunkingConfig },
): Promise<KnowledgeCollectionRow> {
  await withTenant(ctx, (db: TenantScopedClient) =>
    db
      .update(schema.knowledgeCollection)
      .set({ ...fields, updatedAt: new Date() })
      .where(and(eq(schema.knowledgeCollection.id, id), eq(schema.knowledgeCollection.tenantId, ctx.tenantId))),
  );
  return getCollectionOrThrow(ctx, id);
}

export async function setCollectionStatus(ctx: TenantContext, id: string, status: KnowledgeCollectionRow["status"]): Promise<void> {
  await withTenant(ctx, (db: TenantScopedClient) =>
    db.update(schema.knowledgeCollection).set({ status, updatedAt: new Date() }).where(and(eq(schema.knowledgeCollection.id, id), eq(schema.knowledgeCollection.tenantId, ctx.tenantId))),
  );
}

export async function softDeleteCollection(ctx: TenantContext, id: string): Promise<void> {
  await withTenant(ctx, (db: TenantScopedClient) =>
    db.update(schema.knowledgeCollection).set({ deletedAt: new Date(), updatedAt: new Date() }).where(and(eq(schema.knowledgeCollection.id, id), eq(schema.knowledgeCollection.tenantId, ctx.tenantId))),
  );
}
