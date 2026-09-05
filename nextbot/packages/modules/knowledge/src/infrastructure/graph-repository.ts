import { and, asc, desc, eq, gt, gte, ilike, inArray, lt, or, sql } from "drizzle-orm";
import { generateId, schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";
import { GraphCommunityNotFoundError, GraphEntityNotFoundError } from "@nextbot/contracts";

export type GraphEntityRow = typeof schema.graphEntity.$inferSelect;
export type GraphEdgeRow = typeof schema.graphEdge.$inferSelect;
export type GraphCommunityRow = typeof schema.graphCommunity.$inferSelect;
export type GraphEntityMergeCandidateRow = typeof schema.graphEntityMergeCandidate.$inferSelect;

export interface InsertEntityInput {
  generationId: string;
  canonicalName: string;
  type: string;
  aliases: string[];
  mentionCount: number;
  aclTags: string[];
}

/** The Postgres side of ADR-0018's split — system of record, rebuildable source for
 *  the graph store (LLD §14.4.1). BuildGraph writes here FIRST, then to Neo4j. */
export async function insertEntities(ctx: TenantContext, entities: InsertEntityInput[]): Promise<GraphEntityRow[]> {
  if (entities.length === 0) return [];
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const ids = entities.map(() => generateId());
    await db.insert(schema.graphEntity).values(
      entities.map((e, i) => ({
        id: ids[i]!,
        tenantId: ctx.tenantId,
        generationId: e.generationId,
        canonicalName: e.canonicalName,
        type: e.type,
        aliases: e.aliases,
        mentionCount: e.mentionCount,
        aclTags: e.aclTags,
      })),
    );
    return db.select().from(schema.graphEntity).where(and(eq(schema.graphEntity.tenantId, ctx.tenantId), inArray(schema.graphEntity.id, ids))) as Promise<GraphEntityRow[]>;
  });
}

export async function listEntitiesForGeneration(ctx: TenantContext, generationId: string): Promise<GraphEntityRow[]> {
  return withTenant(ctx, (db: TenantScopedClient) =>
    db.select().from(schema.graphEntity).where(and(eq(schema.graphEntity.tenantId, ctx.tenantId), eq(schema.graphEntity.generationId, generationId))),
  ) as Promise<GraphEntityRow[]>;
}

export async function getEntity(ctx: TenantContext, id: string): Promise<GraphEntityRow | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db.select().from(schema.graphEntity).where(and(eq(schema.graphEntity.id, id), eq(schema.graphEntity.tenantId, ctx.tenantId)));
    return (rows[0] as GraphEntityRow | undefined) ?? null;
  });
}

export async function getEntityOrThrow(ctx: TenantContext, id: string): Promise<GraphEntityRow> {
  const row = await getEntity(ctx, id);
  if (!row) throw new GraphEntityNotFoundError(id);
  return row;
}

/** Batch name/type lookup — used by the Graph Explorer (Phase 8, FR-KB-04) to
 *  resolve the "other side" of every relation in one round trip instead of an N+1
 *  query per edge. */
export async function listEntitiesByIds(ctx: TenantContext, ids: string[]): Promise<GraphEntityRow[]> {
  if (ids.length === 0) return [];
  return withTenant(ctx, (db: TenantScopedClient) =>
    db.select().from(schema.graphEntity).where(and(eq(schema.graphEntity.tenantId, ctx.tenantId), inArray(schema.graphEntity.id, ids))),
  ) as Promise<GraphEntityRow[]>;
}

/**
 * Target Architecture Blueprint Phase 9 (BL-40, FR-KB-05, LLD §14.4.4) — the
 * graph-local strategy's anchor-entity resolution: "does the query text MENTION this
 * entity" (canonical name or any alias), a literal substring test rather than a
 * pattern/`ILIKE` construction. Using Postgres `strpos()` (plain substring search, no
 * wildcard semantics) instead of `ILIKE '%' || canonical_name || '%'` matters here
 * specifically because `canonical_name` is untrusted extracted text that could itself
 * contain literal `%`/`_` characters — those would be misinterpreted as LIKE
 * wildcards if concatenated into a pattern, silently over-matching. `strpos` treats
 * the whole string as a literal needle, so this can't happen. Ordered by `degree
 * DESC` so the most-connected (usually most useful) anchors come first when a
 * caller's `limit` clips the result. This is deliberately simple — no NLU/entity-
 * linking model — because Phase 9's own brief is "no query classifier yet, a human
 * picks the strategy"; genuine query understanding is Phase 10's bounded retrieval
 * agent's job.
 */
export async function findAnchorEntitiesByQueryMention(ctx: TenantContext, generationId: string, queryText: string, limit: number): Promise<GraphEntityRow[]> {
  if (!queryText.trim()) return [];
  return withTenant(ctx, (db: TenantScopedClient) =>
    db
      .select()
      .from(schema.graphEntity)
      .where(
        and(
          eq(schema.graphEntity.tenantId, ctx.tenantId),
          eq(schema.graphEntity.generationId, generationId),
          or(
            sql`strpos(lower(${queryText}), lower(${schema.graphEntity.canonicalName})) > 0`,
            sql`EXISTS (SELECT 1 FROM unnest(${schema.graphEntity.aliases}) AS alias WHERE strpos(lower(${queryText}), lower(alias)) > 0)`,
          ),
        ),
      )
      .orderBy(desc(schema.graphEntity.degree))
      .limit(limit),
  ) as Promise<GraphEntityRow[]>;
}

/** Every edge whose provenance traces to one of the given chunk ids — the Hybrid
 *  strategy's own "which entities does vector recall's top chunks already mention"
 *  step (LLD §14.4.4's "vector recall -> graph expansion of the top entities"),
 *  resolved through the pre-existing `graph_edge.tenant_provenance_chunk_idx`
 *  index. */
export async function listEdgesByProvenanceChunkIds(ctx: TenantContext, generationId: string, chunkIds: string[]): Promise<GraphEdgeRow[]> {
  if (chunkIds.length === 0) return [];
  return withTenant(ctx, (db: TenantScopedClient) =>
    db
      .select()
      .from(schema.graphEdge)
      .where(and(eq(schema.graphEdge.tenantId, ctx.tenantId), eq(schema.graphEdge.generationId, generationId), inArray(schema.graphEdge.provenanceChunkId, chunkIds))),
  ) as Promise<GraphEdgeRow[]>;
}

/** Batch edge lookup by id — the graph-local/hybrid strategies resolve
 *  `GraphStorePort.neighbourhood()`'s returned `edgeIds` (structure-only, per
 *  ADR-0018 §2.4) back into their Postgres rows (relation name, weight, confidence,
 *  provenance) to build a human-readable relation path, the same "graph store holds
 *  ids only, Postgres holds the readable content" split the Graph Explorer (Phase 8)
 *  already established for entities/communities. */
export async function listEdgesByIds(ctx: TenantContext, ids: string[]): Promise<GraphEdgeRow[]> {
  if (ids.length === 0) return [];
  return withTenant(ctx, (db: TenantScopedClient) =>
    db.select().from(schema.graphEdge).where(and(eq(schema.graphEdge.tenantId, ctx.tenantId), inArray(schema.graphEdge.id, ids))),
  ) as Promise<GraphEdgeRow[]>;
}

/**
 * The union of every `acl_tags` value present on this generation's entities. Phase 9
 * has no per-caller `effectiveScope` yet (that's the §14.2 evaluator wiring Phase
 * 10's bounded retrieval agent adds) — the Retrieval Playground is an admin-only tool
 * gated on `knowledge:Read`, so passing this union to `GraphStorePort.
 * neighbourhood()`'s required `aclTags` predicate means "show this generation's full
 * content," matching the already-QA-approved Graph Explorer's own precedent (it
 * applies no ACL narrowing at all when reading the identical data from Postgres).
 * Never used for a customer-facing/end-user retrieval path.
 */
export async function listAllAclTagsForGeneration(ctx: TenantContext, generationId: string): Promise<string[]> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const result = await db.execute<{ tag: string }>(sql`
      SELECT DISTINCT tag FROM graph_entity, unnest(acl_tags) AS tag
      WHERE tenant_id = ${ctx.tenantId} AND generation_id = ${generationId}
    `);
    return result.rows.map((r) => r.tag);
  });
}

export interface EntityListFilters {
  /** Case-insensitive substring match on `canonicalName` (the explorer's search box). */
  q?: string;
  type?: string;
  communityId?: string;
  minDegree?: number;
  /** Opaque keyset cursor minted by `encodeEntityCursor` — the last row of the
   *  previous page, never a client-supplied offset (stable under concurrent inserts
   *  between pages, unlike `OFFSET`). */
  cursor?: { degree: number; id: string };
  /** Clamped to [1, 200] by the caller (`graph-explorer-service.ts`). */
  limit: number;
}

export interface EntityListPage {
  rows: GraphEntityRow[];
  /** One extra row was fetched to detect this without a second COUNT query. */
  hasMore: boolean;
}

/**
 * The Graph Explorer's entity browser (FR-KB-04, LLD §14.4.5's
 * `GET .../graph/entities?q&type&communityId&minDegree&cursor`). Ordered by
 * `degree DESC, id ASC` — the same column the pre-existing
 * `graph_entity_tenant_generation_degree_idx` covers, so the highest-connectivity
 * (most likely genuinely important) entities surface first by default, with `id` as
 * a stable tiebreaker for the keyset cursor.
 */
export async function listEntitiesForGenerationPage(ctx: TenantContext, generationId: string, filters: EntityListFilters): Promise<EntityListPage> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const conditions = [eq(schema.graphEntity.tenantId, ctx.tenantId), eq(schema.graphEntity.generationId, generationId)];
    if (filters.q) conditions.push(ilike(schema.graphEntity.canonicalName, `%${filters.q}%`));
    if (filters.type) conditions.push(eq(schema.graphEntity.type, filters.type));
    if (filters.communityId) conditions.push(eq(schema.graphEntity.communityId, filters.communityId));
    if (filters.minDegree !== undefined) conditions.push(gte(schema.graphEntity.degree, filters.minDegree));
    if (filters.cursor) {
      conditions.push(
        or(
          lt(schema.graphEntity.degree, filters.cursor.degree),
          and(eq(schema.graphEntity.degree, filters.cursor.degree), gt(schema.graphEntity.id, filters.cursor.id))!,
        )!,
      );
    }
    const rows = (await db
      .select()
      .from(schema.graphEntity)
      .where(and(...conditions))
      .orderBy(desc(schema.graphEntity.degree), asc(schema.graphEntity.id))
      .limit(filters.limit + 1)) as GraphEntityRow[];
    const hasMore = rows.length > filters.limit;
    return { rows: hasMore ? rows.slice(0, filters.limit) : rows, hasMore };
  });
}

export async function updateEntityDegree(ctx: TenantContext, id: string, degree: number): Promise<void> {
  await withTenant(ctx, (db: TenantScopedClient) => db.update(schema.graphEntity).set({ degree }).where(and(eq(schema.graphEntity.id, id), eq(schema.graphEntity.tenantId, ctx.tenantId))));
}

export async function updateEntityCommunity(ctx: TenantContext, id: string, communityId: string): Promise<void> {
  await withTenant(ctx, (db: TenantScopedClient) => db.update(schema.graphEntity).set({ communityId }).where(and(eq(schema.graphEntity.id, id), eq(schema.graphEntity.tenantId, ctx.tenantId))));
}

export async function updateEntitySummary(ctx: TenantContext, id: string, summary: string): Promise<void> {
  await withTenant(ctx, (db: TenantScopedClient) => db.update(schema.graphEntity).set({ summary }).where(and(eq(schema.graphEntity.id, id), eq(schema.graphEntity.tenantId, ctx.tenantId))));
}

export interface InsertEdgeInput {
  generationId: string;
  srcEntityId: string;
  dstEntityId: string;
  relation: string;
  weight?: number;
  confidence: number;
  provenanceChunkId: string;
  provenanceSpan?: { charStart: number; charEnd: number } | null;
  aclTags: string[];
}

export async function insertEdges(ctx: TenantContext, edges: InsertEdgeInput[]): Promise<GraphEdgeRow[]> {
  if (edges.length === 0) return [];
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const ids = edges.map(() => generateId());
    await db.insert(schema.graphEdge).values(
      edges.map((e, i) => ({
        id: ids[i]!,
        tenantId: ctx.tenantId,
        generationId: e.generationId,
        srcEntityId: e.srcEntityId,
        dstEntityId: e.dstEntityId,
        relation: e.relation,
        weight: e.weight ?? 1.0,
        confidence: e.confidence,
        provenanceChunkId: e.provenanceChunkId,
        provenanceSpan: e.provenanceSpan,
        aclTags: e.aclTags,
      })),
    );
    return db.select().from(schema.graphEdge).where(and(eq(schema.graphEdge.tenantId, ctx.tenantId), inArray(schema.graphEdge.id, ids))) as Promise<GraphEdgeRow[]>;
  });
}

export async function listEdgesForGeneration(ctx: TenantContext, generationId: string): Promise<GraphEdgeRow[]> {
  return withTenant(ctx, (db: TenantScopedClient) =>
    db.select().from(schema.graphEdge).where(and(eq(schema.graphEdge.tenantId, ctx.tenantId), eq(schema.graphEdge.generationId, generationId))),
  ) as Promise<GraphEdgeRow[]>;
}

/** Every relation touching one entity, in EITHER direction (FR-KB-04's entity
 *  inspector: "their relations", not just the ones where this entity is the
 *  subject). The caller (`graph-explorer-service.ts`) tags each row with its
 *  direction relative to `entityId` since a single edge row doesn't know which side
 *  the caller is looking from. */
export async function listEdgesForEntity(ctx: TenantContext, generationId: string, entityId: string): Promise<GraphEdgeRow[]> {
  return withTenant(ctx, (db: TenantScopedClient) =>
    db
      .select()
      .from(schema.graphEdge)
      .where(
        and(
          eq(schema.graphEdge.tenantId, ctx.tenantId),
          eq(schema.graphEdge.generationId, generationId),
          or(eq(schema.graphEdge.srcEntityId, entityId), eq(schema.graphEdge.dstEntityId, entityId)),
        ),
      )
      .orderBy(desc(schema.graphEdge.weight)),
  ) as Promise<GraphEdgeRow[]>;
}

export interface InsertCommunityInput {
  generationId: string;
  level: number;
  parentId?: string | null;
  externalKey: string;
  entityCount: number;
  aclTags: string[];
}

export async function insertCommunities(ctx: TenantContext, communities: InsertCommunityInput[]): Promise<GraphCommunityRow[]> {
  if (communities.length === 0) return [];
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const ids = communities.map(() => generateId());
    await db.insert(schema.graphCommunity).values(
      communities.map((c, i) => ({
        id: ids[i]!,
        tenantId: ctx.tenantId,
        generationId: c.generationId,
        level: c.level,
        parentId: c.parentId,
        externalKey: c.externalKey,
        entityCount: c.entityCount,
        aclTags: c.aclTags,
      })),
    );
    return db.select().from(schema.graphCommunity).where(and(eq(schema.graphCommunity.tenantId, ctx.tenantId), inArray(schema.graphCommunity.id, ids))) as Promise<GraphCommunityRow[]>;
  });
}

export async function listStaleCommunitiesForGeneration(ctx: TenantContext, generationId: string): Promise<GraphCommunityRow[]> {
  return withTenant(ctx, (db: TenantScopedClient) =>
    db
      .select()
      .from(schema.graphCommunity)
      .where(and(eq(schema.graphCommunity.tenantId, ctx.tenantId), eq(schema.graphCommunity.generationId, generationId), eq(schema.graphCommunity.summaryStale, true))),
  ) as Promise<GraphCommunityRow[]>;
}

export async function listCommunitiesForGeneration(ctx: TenantContext, generationId: string, level?: number): Promise<GraphCommunityRow[]> {
  return withTenant(ctx, (db: TenantScopedClient) => {
    const conditions = [eq(schema.graphCommunity.tenantId, ctx.tenantId), eq(schema.graphCommunity.generationId, generationId)];
    if (level !== undefined) conditions.push(eq(schema.graphCommunity.level, level));
    return db
      .select()
      .from(schema.graphCommunity)
      .where(and(...conditions))
      .orderBy(desc(schema.graphCommunity.entityCount));
  }) as Promise<GraphCommunityRow[]>;
}

/** Batch title lookup — resolves the community column an entity-list page's rows
 *  carry (`graph_entity.community_id`) into human-readable titles in one round trip,
 *  the same N+1-avoidance shape `listEntitiesByIds` provides for relations. */
export async function listCommunitiesByIds(ctx: TenantContext, ids: string[]): Promise<GraphCommunityRow[]> {
  if (ids.length === 0) return [];
  return withTenant(ctx, (db: TenantScopedClient) =>
    db.select().from(schema.graphCommunity).where(and(eq(schema.graphCommunity.tenantId, ctx.tenantId), inArray(schema.graphCommunity.id, ids))),
  ) as Promise<GraphCommunityRow[]>;
}

export async function getCommunity(ctx: TenantContext, id: string): Promise<GraphCommunityRow | null> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db.select().from(schema.graphCommunity).where(and(eq(schema.graphCommunity.id, id), eq(schema.graphCommunity.tenantId, ctx.tenantId)));
    return (rows[0] as GraphCommunityRow | undefined) ?? null;
  });
}

export async function getCommunityOrThrow(ctx: TenantContext, id: string): Promise<GraphCommunityRow> {
  const row = await getCommunity(ctx, id);
  if (!row) throw new GraphCommunityNotFoundError(id);
  return row;
}

/** The Graph Explorer's community view (FR-KB-04: "entities grouped by community,
 *  with the community's own generated summary visible") — members ordered by degree
 *  so the community's most-connected entities (usually its clearest members) show
 *  first. */
export async function listEntitiesForCommunity(ctx: TenantContext, generationId: string, communityId: string): Promise<GraphEntityRow[]> {
  return withTenant(ctx, (db: TenantScopedClient) =>
    db
      .select()
      .from(schema.graphEntity)
      .where(and(eq(schema.graphEntity.tenantId, ctx.tenantId), eq(schema.graphEntity.generationId, generationId), eq(schema.graphEntity.communityId, communityId)))
      .orderBy(desc(schema.graphEntity.degree)),
  ) as Promise<GraphEntityRow[]>;
}

export async function setCommunitySummary(ctx: TenantContext, id: string, title: string, summary: string): Promise<void> {
  await withTenant(ctx, (db: TenantScopedClient) =>
    db.update(schema.graphCommunity).set({ title, summary, summaryStale: false, updatedAt: new Date() }).where(and(eq(schema.graphCommunity.id, id), eq(schema.graphCommunity.tenantId, ctx.tenantId))),
  );
}

/** Target Architecture Blueprint Phase 11 (BL-42, FR-KB-08) — the retention-purge
 *  cascade's own community-membership-change follow-up: a community's OWN denormalized
 *  `acl_tags` (LLD §14.4.2: "union over member entities") must be recomputed after a
 *  member entity is removed, or a purged entity's ACL grant would stay baked into the
 *  community's own tag set indefinitely — a residual over-exposure this function
 *  closes. Never touches `summary`/`summary_stale` (that is `markCommunitiesStale`'s
 *  and `setCommunitySummary`'s job respectively). */
export async function updateCommunityAclTags(ctx: TenantContext, id: string, aclTags: string[]): Promise<void> {
  await withTenant(ctx, (db: TenantScopedClient) =>
    db.update(schema.graphCommunity).set({ aclTags, updatedAt: new Date() }).where(and(eq(schema.graphCommunity.id, id), eq(schema.graphCommunity.tenantId, ctx.tenantId))),
  );
}

export interface InsertMergeCandidateInput {
  generationId: string;
  leftEntityId: string;
  rightEntityId: string;
  similarity: number;
  rationale: string;
}

export async function insertMergeCandidates(ctx: TenantContext, candidates: InsertMergeCandidateInput[]): Promise<void> {
  if (candidates.length === 0) return;
  await withTenant(ctx, (db: TenantScopedClient) =>
    db.insert(schema.graphEntityMergeCandidate).values(
      candidates.map((c) => ({
        id: generateId(),
        tenantId: ctx.tenantId,
        generationId: c.generationId,
        leftEntityId: c.leftEntityId,
        rightEntityId: c.rightEntityId,
        similarity: c.similarity,
        rationale: c.rationale,
      })),
    ),
  );
}

export async function listMergeCandidatesForGeneration(ctx: TenantContext, generationId: string, status?: "Pending" | "Merged" | "Rejected"): Promise<GraphEntityMergeCandidateRow[]> {
  return withTenant(ctx, (db: TenantScopedClient) => {
    const conditions = [eq(schema.graphEntityMergeCandidate.tenantId, ctx.tenantId), eq(schema.graphEntityMergeCandidate.generationId, generationId)];
    if (status) conditions.push(eq(schema.graphEntityMergeCandidate.status, status));
    return db.select().from(schema.graphEntityMergeCandidate).where(and(...conditions));
  }) as Promise<GraphEntityMergeCandidateRow[]>;
}

export async function decideMergeCandidate(ctx: TenantContext, id: string, decision: "Merged" | "Rejected", userId: string): Promise<void> {
  await withTenant(ctx, (db: TenantScopedClient) =>
    db
      .update(schema.graphEntityMergeCandidate)
      .set({ status: decision, decidedByUserId: userId, decidedAt: new Date() })
      .where(and(eq(schema.graphEntityMergeCandidate.id, id), eq(schema.graphEntityMergeCandidate.tenantId, ctx.tenantId))),
  );
}

// ---------------------------------------------------------------------------
// Target Architecture Blueprint Phase 11 (BL-42, FR-KB-08/FR-ADM-06) — the
// retention-purge cascade's own graph-maintenance primitives. Never called for any
// other reason — the graph is otherwise append-only for the lifetime of a
// generation (LLD §14.4.1).
// ---------------------------------------------------------------------------

/** Deletes edges by id (Postgres side only — the caller is responsible for also
 *  calling `Neo4jGraphStore.deleteNodes`/removing the matching relationships in the
 *  graph store, per ADR-0018's "Postgres is system of record, rebuild the graph
 *  store from it" split; this repository has no graph-store dependency itself). */
export async function deleteEdgesByIds(ctx: TenantContext, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await withTenant(ctx, (db: TenantScopedClient) => db.delete(schema.graphEdge).where(and(eq(schema.graphEdge.tenantId, ctx.tenantId), inArray(schema.graphEdge.id, ids))));
}

/** Deletes entities by id — the caller must have already confirmed each entity has
 *  NO remaining edge (in EITHER direction) before calling this; deleting an entity
 *  that still has a live edge would leave a dangling FK reference. */
export async function deleteEntitiesByIds(ctx: TenantContext, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await withTenant(ctx, (db: TenantScopedClient) => db.delete(schema.graphEntity).where(and(eq(schema.graphEntity.tenantId, ctx.tenantId), inArray(schema.graphEntity.id, ids))));
}

/** Deletes communities by id — used only when a community's own membership drops to
 *  zero as a result of the purge cascade (a community with surviving members is
 *  instead marked stale via `markCommunitiesStale`, triggering re-summarization,
 *  never deleted). */
export async function deleteCommunitiesByIds(ctx: TenantContext, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await withTenant(ctx, (db: TenantScopedClient) => db.delete(schema.graphCommunity).where(and(eq(schema.graphCommunity.tenantId, ctx.tenantId), inArray(schema.graphCommunity.id, ids))));
}

/** FR-KB-08's own retention wording: purging a source "triggers community
 *  re-summarization for affected communities" — implemented as the SAME
 *  `summary_stale` flag the CommunitySummaries pipeline stage already regenerates
 *  incrementally from (`stage-community-embed-index.ts`), never a second
 *  re-summarization mechanism. */
export async function markCommunitiesStale(ctx: TenantContext, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await withTenant(ctx, (db: TenantScopedClient) =>
    db.update(schema.graphCommunity).set({ summaryStale: true, updatedAt: new Date() }).where(and(eq(schema.graphCommunity.tenantId, ctx.tenantId), inArray(schema.graphCommunity.id, ids))),
  );
}
