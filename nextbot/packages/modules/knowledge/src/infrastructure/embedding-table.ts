import { and, cosineDistance, eq, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";
import type { SupportedEmbeddingDimension } from "@nextbot/db";
import { EmbeddingDimensionUnsupportedError } from "@nextbot/contracts";

/**
 * `packages/modules/knowledge/src/infrastructure/embedding-table.ts` — the ONE file
 * in this module allowed to switch on embedding dimension (LLD §14.4.2's own
 * naming/placement instruction). Every other file calls `tableForDimension(dim)`
 * rather than importing `knowledgeEmbeddingD*` directly.
 */
export function tableForDimension(dimension: number) {
  switch (dimension) {
    case 384:
      return schema.knowledgeEmbeddingD384;
    case 768:
      return schema.knowledgeEmbeddingD768;
    case 1024:
      return schema.knowledgeEmbeddingD1024;
    case 1536:
      return schema.knowledgeEmbeddingD1536;
    case 3072:
      return schema.knowledgeEmbeddingD3072;
    default:
      throw new EmbeddingDimensionUnsupportedError(dimension);
  }
}

export function assertSupportedDimension(dimension: number): asserts dimension is SupportedEmbeddingDimension {
  tableForDimension(dimension); // throws EmbeddingDimensionUnsupportedError if not one of the closed set
}

export interface InsertEmbeddingInput {
  generationId: string;
  dimension: number;
  kind: "Chunk" | "EntitySummary" | "CommunitySummary";
  ownerId: string;
  embedding: number[];
}

export async function upsertEmbedding(ctx: TenantContext, input: InsertEmbeddingInput): Promise<void> {
  const table = tableForDimension(input.dimension);
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db
      .delete(table)
      .where(and(eq(table.tenantId, ctx.tenantId), eq(table.generationId, input.generationId), eq(table.kind, input.kind), eq(table.ownerId, input.ownerId)));
    await db.insert(table).values({
      tenantId: ctx.tenantId,
      generationId: input.generationId,
      kind: input.kind,
      ownerId: input.ownerId,
      embedding: input.embedding,
    });
  });
}

export async function getEmbedding(ctx: TenantContext, dimension: number, generationId: string, kind: "Chunk" | "EntitySummary" | "CommunitySummary", ownerId: string): Promise<number[] | null> {
  const table = tableForDimension(dimension);
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select()
      .from(table)
      .where(and(eq(table.tenantId, ctx.tenantId), eq(table.generationId, generationId), eq(table.kind, kind), eq(table.ownerId, ownerId)));
    const row = rows[0] as { embedding: unknown } | undefined;
    return row ? (row.embedding as number[]) : null;
  });
}

export interface SimilarityHit {
  ownerId: string;
  /** `1 - cosine distance`, in `[-1, 1]` (practically `[0, 1]` for normalized
   *  embeddings) — the higher, the more similar. Never the raw pgvector `<=>`
   *  distance, so every caller in this module works in "similarity" terms
   *  consistently, matching `retrieval_event.top_score`'s own semantics. */
  score: number;
}

/** The real table each embedding `kind` denormalizes its own `acl_tags` from — the
 *  join target `buildAclOwnerFilter` below reads BEFORE ranking. `EntitySummary` has
 *  no current caller (no strategy queries that bucket yet) but is wired for
 *  completeness/defense-in-depth rather than silently left unfiltered if one is added
 *  later without revisiting this file. */
const ACL_OWNER_TABLE: Record<"Chunk" | "EntitySummary" | "CommunitySummary", string> = {
  Chunk: "knowledge_chunk",
  EntitySummary: "graph_entity",
  CommunitySummary: "graph_community",
};

/**
 * Target Architecture Blueprint Phase 11 (BL-42, FR-KB-08) — the pre-ranking ACL
 * filter every embedding-bucket lookup must apply BEFORE `ORDER BY`/`LIMIT`, never
 * after: a candidate the caller may not see must never occupy a slot in the top-K
 * that a candidate it MAY see could otherwise have won. Mirrors
 * `@nextbot/graph-store`'s own `neighbourhood()` Cypher predicate exactly
 * (`ANY(tag IN n.aclTags WHERE tag IN $aclTags)` — an ANY-overlap, not a subset,
 * check) via a real correlated `EXISTS` against the owning row's own `acl_tags`
 * column, so a chunk/community with zero tag overlap with `aclTags` is excluded at
 * the SQL level rather than merely hidden after the fact.
 *
 * `aclTags.length === 0` is deliberately NOT "no restriction" — every real
 * chunk/entity/community's `acl_tags` is non-empty by construction (`deriveAclTags`
 * always adds a visibility tag), so a caller with a genuinely empty tag set can never
 * legitimately overlap with anything; this returns a predicate that is always false
 * rather than emitting `ANY(tag IN acl_tags WHERE tag IN ())`, which some SQL
 * dialects reject outright for an empty array literal.
 */
function buildAclOwnerFilter(kind: "Chunk" | "EntitySummary" | "CommunitySummary", ownerIdColumn: AnyPgColumn, tenantId: string, aclTags: string[]): SQL {
  if (aclTags.length === 0) return sql`false`;
  const ownerTable = ACL_OWNER_TABLE[kind];
  // Each tag is bound as its OWN parameter (never string-concatenated — these values
  // are opaque hashes, not a closed enum, so they must go through real parameter
  // binding) and reassembled into a genuine `ARRAY[$1, $2, ...]::text[]` literal —
  // interpolating the JS array directly (`${aclTags}::text[]`) does NOT work with
  // this driver/version combination (`node-postgres` + this drizzle-orm version):
  // it serializes the array as a single malformed string parameter rather than a
  // real Postgres array, confirmed against a real Postgres instance while
  // implementing this.
  const arrayLiteral = sql.join(
    aclTags.map((tag) => sql`${tag}`),
    sql.raw(", "),
  );
  return sql`EXISTS (
    SELECT 1 FROM ${sql.raw(ownerTable)} AS owner_acl
    WHERE owner_acl.id = ${ownerIdColumn}
      AND owner_acl.tenant_id = ${tenantId}
      AND owner_acl.acl_tags && ARRAY[${arrayLiteral}]::text[]
  )`;
}

/**
 * Target Architecture Blueprint Phase 9 (BL-40, FR-KB-05, LLD §14.4.4) — the top-K
 * nearest-neighbour query every vector-recall strategy (Vector, Hybrid's recall step,
 * GraphGlobal's "map" step) needs. Uses drizzle-orm's built-in `cosineDistance()`
 * (emits the pgvector `<=>` operator), which works identically for both the
 * full-precision `vector` and half-precision `halfvec` (dimension 3072) column types
 * this table factory produces — no dimension-specific branching needed here beyond
 * the existing `tableForDimension()` dispatch every other function in this file uses.
 *
 * `kind` scopes the search to one embedding "bucket" (Chunk / EntitySummary /
 * CommunitySummary) — the three are different vector spaces conceptually even though
 * they share a physical table, so mixing them in one ranking pass would be a
 * correctness bug, not merely a relevance-quality one.
 *
 * **Target Architecture Blueprint Phase 11 (BL-42, FR-KB-08)**: `aclTags`, when
 * supplied, applies `buildAclOwnerFilter` above as part of THIS SAME query's `WHERE`
 * clause — before `ORDER BY`/`LIMIT`, i.e. before ranking, exactly as FR-KB-08
 * requires. `undefined` (never passed by any real caller in this module as of this
 * phase — see `RetrievalStrategyParams.aclTags`'s own doc comment) applies no ACL
 * filter at all, preserved only so a pre-Phase-11 test fixture predating this
 * parameter still compiles/passes unmodified.
 */
export async function topKByCosineSimilarity(
  ctx: TenantContext,
  dimension: number,
  generationId: string,
  kind: "Chunk" | "EntitySummary" | "CommunitySummary",
  queryEmbedding: number[],
  k: number,
  aclTags?: string[],
): Promise<SimilarityHit[]> {
  const table = tableForDimension(dimension);
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const distanceExpr = cosineDistance(table.embedding, queryEmbedding);
    const conditions = [eq(table.tenantId, ctx.tenantId), eq(table.generationId, generationId), eq(table.kind, kind)];
    if (aclTags !== undefined) conditions.push(buildAclOwnerFilter(kind, table.ownerId, ctx.tenantId, aclTags));
    const rows = await db
      .select({ ownerId: table.ownerId, distance: distanceExpr })
      .from(table)
      .where(and(...conditions))
      .orderBy(distanceExpr)
      .limit(k);
    return rows.map((r) => ({ ownerId: r.ownerId, score: 1 - Number(r.distance) }));
  });
}

export async function countEmbeddingsForGeneration(ctx: TenantContext, dimension: number, generationId: string): Promise<number> {
  const table = tableForDimension(dimension);
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db.select().from(table).where(and(eq(table.tenantId, ctx.tenantId), eq(table.generationId, generationId)));
    return rows.length;
  });
}
