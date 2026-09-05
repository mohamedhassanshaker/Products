import { and, asc, eq, sql } from "drizzle-orm";
import { generateId, schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";
import type { RetrievalStrategyValue } from "@nextbot/contracts";

export type RetrievalEventRow = typeof schema.retrievalEvent.$inferSelect;

export interface InsertRetrievalEventInput {
  conversationId?: string | null;
  agentRunId?: string | null;
  agentDefinitionVersionId?: string | null;
  collectionId: string;
  generationId: string;
  strategy: RetrievalStrategyValue;
  strategySource: "Auto" | "Pinned" | "PlaygroundOverride";
  queryTextHash: string;
  queryTextMasked?: string | null;
  hops: number;
  expansions: number;
  chunkIds: string[];
  citationIds: string[];
  topScore: number | null;
  grounded: boolean;
  refused: boolean;
  truncatedByBudget: boolean;
  latencyMs: number;
  costUsd: string;
  scopeHash: string;
}

/**
 * Target Architecture Blueprint Phase 10 (BL-41, FR-KB-06, LLD §14.4.2/§14.4.4 step 7)
 * — "write retrieval_event; return." Every retrieval the bounded retrieval agent
 * performs writes exactly one row here, win or refuse alike — this is the real,
 * queryable data Runtime Traces/Conversations/the future coverage report render, not
 * an aspiration. Append-only: no update/delete function exists in this file, by
 * design (this table is an audit/observability trail).
 */
export async function insertRetrievalEvent(ctx: TenantContext, input: InsertRetrievalEventInput): Promise<RetrievalEventRow> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const id = generateId();
    await db.insert(schema.retrievalEvent).values({
      id,
      tenantId: ctx.tenantId,
      conversationId: input.conversationId ?? null,
      agentRunId: input.agentRunId ?? null,
      agentDefinitionVersionId: input.agentDefinitionVersionId ?? null,
      collectionId: input.collectionId,
      generationId: input.generationId,
      strategy: input.strategy,
      strategySource: input.strategySource,
      queryTextHash: input.queryTextHash,
      queryTextMasked: input.queryTextMasked ?? null,
      hops: input.hops,
      expansions: input.expansions,
      chunkIds: input.chunkIds,
      citationIds: input.citationIds,
      topScore: input.topScore,
      grounded: input.grounded,
      refused: input.refused,
      truncatedByBudget: input.truncatedByBudget,
      latencyMs: input.latencyMs,
      costUsd: input.costUsd,
      scopeHash: input.scopeHash,
    });
    const [row] = await db.select().from(schema.retrievalEvent).where(eq(schema.retrievalEvent.id, id));
    if (!row) throw new Error("insertRetrievalEvent: insert did not return a row");
    return row as RetrievalEventRow;
  });
}

/** All retrieval events for one conversation, oldest first — Conversations detail /
 *  Runtime Traces read path. */
export async function listRetrievalEventsForConversation(ctx: TenantContext, conversationId: string): Promise<RetrievalEventRow[]> {
  return withTenant(ctx, (db: TenantScopedClient) =>
    db
      .select()
      .from(schema.retrievalEvent)
      .where(and(eq(schema.retrievalEvent.tenantId, ctx.tenantId), eq(schema.retrievalEvent.conversationId, conversationId)))
      .orderBy(asc(schema.retrievalEvent.createdAt)),
  ) as Promise<RetrievalEventRow[]>;
}

export interface CoverageGapRow {
  queryTextHash: string;
  /** The most recent non-null `query_text_masked` value seen for this hash group —
   *  `null` only if every occurrence predates Phase 11's masked-query capture. */
  sampleQueryTextMasked: string | null;
  occurrences: number;
  refusedCount: number;
  /** `null` across every occurrence in the group means nothing was ever retrieved
   *  at all for this question — distinct from a real, low, sub-threshold score. */
  maxTopScore: number | null;
  /** A raw `db.execute()` aggregate result — the driver does not always parse this
   *  back into a `Date` instance the way a named-column `select()` does; callers
   *  should normalize via `new Date(lastSeenAt)` rather than assume the shape. */
  lastSeenAt: Date | string;
}

/**
 * Target Architecture Blueprint Phase 11 (BL-42, FR-KB-08) — the Coverage
 * sub-requirement's own query: "production questions that retrieved nothing above a
 * relevance threshold" (parallels FR-RP-03's existing gap-analysis pattern),
 * grouped by `query_text_hash` so a recurring ungrounded question surfaces as ONE
 * row with a real occurrence count, not N indistinguishable rows. A row qualifies
 * as a coverage gap when it was refused OR its `top_score` is null/below
 * `minRelevanceScore` — the caller (`coverage-service.ts`) supplies the
 * collection's own configured threshold, this function has no opinion of its own
 * on what "above threshold" means.
 */
export async function listCoverageGapsForCollection(ctx: TenantContext, collectionId: string, minRelevanceScore: number, sinceDate: Date): Promise<CoverageGapRow[]> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const result = await db.execute<{
      query_text_hash: string;
      sample_query_text_masked: string | null;
      occurrences: string;
      refused_count: string;
      max_top_score: number | null;
      last_seen_at: Date;
    }>(sql`
      SELECT
        query_text_hash,
        (array_agg(query_text_masked ORDER BY created_at DESC) FILTER (WHERE query_text_masked IS NOT NULL))[1] AS sample_query_text_masked,
        count(*) AS occurrences,
        count(*) FILTER (WHERE refused) AS refused_count,
        max(top_score) AS max_top_score,
        max(created_at) AS last_seen_at
      FROM retrieval_event
      WHERE tenant_id = ${ctx.tenantId}
        AND collection_id = ${collectionId}
        AND created_at >= ${sinceDate}
        AND (refused OR top_score IS NULL OR top_score < ${minRelevanceScore})
      GROUP BY query_text_hash
      ORDER BY occurrences DESC, last_seen_at DESC
    `);
    return result.rows.map((r) => ({
      queryTextHash: r.query_text_hash,
      sampleQueryTextMasked: r.sample_query_text_masked,
      occurrences: Number(r.occurrences),
      refusedCount: Number(r.refused_count),
      maxTopScore: r.max_top_score,
      lastSeenAt: r.last_seen_at,
    }));
  });
}
