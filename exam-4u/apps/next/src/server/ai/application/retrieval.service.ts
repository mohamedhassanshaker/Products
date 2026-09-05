import { getEnv } from '@/server/config';
import type { EmbeddingsPort, ScoredPoint, TenantScope, VectorStorePort } from '@/server/vector';
import { cosineSimilarity, rerankFuseAndFilter, type RerankCandidate } from '../domain/hybrid-rerank';

/**
 * The single, caller-side grounding chokepoint (migration plan Phase 5) — ported from
 * `legacy/api/src/ai/application/retrieval.service.ts`. The AI model has no retrieval tool of its
 * own — it can only see what this service resolves and passes inline as grounding text on the
 * request. This is what makes the tenant filter structurally inexpressible to omit: every retrieval
 * call goes through {@link VectorStorePort}'s mandatory `TenantScope` argument, so there is no code
 * path in this service capable of a cross-tenant read.
 *
 * **Deviates from legacy in one deliberate way**: takes an explicit {@link TenantScope} parameter
 * instead of reading `getRequestContext()`'s ambient tenant id — `server/ai`/`server/vector` have no
 * dependency on `server/context` by construction (see `docs/plans/nextjs-rewrite-phase5-plan.md`'s
 * "Decisions made" #3); every `AiServicePort` method's own `AiInvocationContext.tenantId` already
 * carries the tenant id explicitly, so this service simply receives it one layer deeper.
 *
 * **Zero results is a valid, non-error retrieval state** — this method returns `[]` rather than
 * throwing when nothing relevant is found; callers are expected to treat an empty/short array as a
 * normal input to confidence calibration, not a failure to handle specially.
 *
 * Does hybrid dense+lexical fusion + a relevance floor (mirrors legacy's own Dev-30/BL-29 addition):
 * a dense `searchChunks` top-K pool is merged with a bounded `scrollChunks` candidate pool (lexical
 * recall on chunks a dense-only top-K might miss), fused via `hybrid-rerank.ts`'s pure
 * `rerankFuseAndFilter`, with a relevance floor applied before slicing to `topK`.
 */
export class RetrievalService {
  constructor(
    private readonly vectorStore: VectorStorePort,
    private readonly embeddings: EmbeddingsPort,
  ) {}

  /**
   * Embeds `queryText` and searches the tenant's indexed chunks, narrowed by `scope` (curriculum
   * and/or document — both optional, matching `ChunkFilter`'s own shape).
   *
   * **No embedding call for empty/whitespace-only query text** — an empty query can never usefully
   * retrieve anything, so this returns `[]` immediately rather than embedding an empty string.
   *
   * @param tenant The tenant to search within (mandatory, explicit — see this class's own doc
   *   comment for why this deviates from legacy's ALS-read equivalent).
   * @param scope Narrows the search to one Curriculum and/or Document; omit either to search every
   *   chunk the tenant owns.
   * @param queryText The raw text to embed and search against.
   * @param topK Maximum number of chunks to return — feature-specific (5/12/12, `RETRIEVAL_TOPK_*`).
   */
  async retrieve(tenant: TenantScope, scope: RetrievalScope, queryText: string, topK: number): Promise<RetrievedChunk[]> {
    const trimmed = queryText.trim();
    if (trimmed.length === 0) return [];

    const [queryVector] = await this.embeddings.embed([trimmed]);
    const env = getEnv();
    const hybridCandidateMultiplier = env.RETRIEVAL_HYBRID_CANDIDATE_MULTIPLIER;
    const hybridLexicalScanLimit = env.RETRIEVAL_HYBRID_LEXICAL_SCAN_LIMIT;
    const hybridLexicalWeight = env.RETRIEVAL_HYBRID_LEXICAL_WEIGHT;
    const relevanceFloor = env.RETRIEVAL_RELEVANCE_FLOOR;

    // Dense channel: a wider-than-topK candidate pool so the reranker has real material to reorder
    // rather than just re-scoring an already-final list.
    const denseCandidateLimit = Math.max(topK, topK * hybridCandidateMultiplier);
    const densePoints = await this.vectorStore.searchChunks(tenant, queryVector, scope, denseCandidateLimit);

    // Lexical channel: a bounded scroll pool (in-scope chunks only, capped) with vectors attached so
    // a scroll-only point (not among the dense top-K) can still get a genuine dense score computed
    // locally, rather than being unfairly zeroed out on the channel it wasn't found through.
    const scrollPoints = await this.vectorStore.scrollChunks(tenant, scope, { limit: hybridLexicalScanLimit, withVector: true });

    const merged = mergeCandidates(densePoints, scrollPoints, queryVector);
    const reranked = rerankFuseAndFilter(merged, { queryText: trimmed, lexicalWeight: hybridLexicalWeight, relevanceFloor, topK });

    return reranked.map((result) => toRetrievedChunk({ score: result.fusedScore, payload: result.payload }));
  }
}

/** Merges the dense-search and lexical-scroll candidate pools by point id (a dense hit's own
 * Qdrant-reported score always wins over a locally-recomputed one) into the flat shape
 * `rerankFuseAndFilter` expects. A scroll-only point's dense component is computed via
 * {@link cosineSimilarity} against `queryVector` — it was fetched `withVector: true` specifically so
 * this is possible without a second Qdrant round-trip. */
function mergeCandidates(densePoints: ScoredPoint[], scrollPoints: ScoredPoint[], queryVector: number[]): RerankCandidate[] {
  const byId = new Map<string, RerankCandidate>();
  for (const point of densePoints) {
    byId.set(point.id, { id: point.id, denseScore: point.score, text: readText(point), payload: point.payload });
  }
  for (const point of scrollPoints) {
    if (byId.has(point.id)) continue;
    const denseScore = point.vector ? cosineSimilarity(queryVector, point.vector) : 0;
    byId.set(point.id, { id: point.id, denseScore, text: readText(point), payload: point.payload });
  }
  return Array.from(byId.values());
}

function readText(point: { payload: Record<string, unknown> }): string {
  return typeof point.payload['text'] === 'string' ? point.payload['text'] : '';
}

/** `VectorStorePort.searchChunks`'s `ChunkFilter` shape, re-exported under this service's own
 * vocabulary — both fields optional, narrowing rather than requiring either. */
export interface RetrievalScope {
  curriculumId?: string;
  documentId?: string;
}

/** This service's own `RetrievedChunk` shape — identical fields to `@examland/contracts`'s
 * `GroundingChunk`, but declared separately since this service is framework- and contract-agnostic by
 * design; callers map between the two one-for-one. */
export interface RetrievedChunk {
  text: string;
  fileName: string;
  pageNumber: number;
  score: number;
}

/** Maps one `ScoredPoint` (payload written by whichever ingestion pipeline indexed it — Phase 6's
 * job, keyed `text`/`fileName`/`pageNumber`) to this service's public shape — read defensively since
 * `payload: Record<string, unknown>` is untyped at the vector-store-port boundary. */
function toRetrievedChunk(point: { score: number; payload: Record<string, unknown> }): RetrievedChunk {
  const payload = point.payload;
  return {
    text: typeof payload['text'] === 'string' ? payload['text'] : '',
    fileName: typeof payload['fileName'] === 'string' ? payload['fileName'] : '',
    pageNumber: typeof payload['pageNumber'] === 'number' ? payload['pageNumber'] : 0,
    score: point.score,
  };
}
