/**
 * The vector-store port (migration plan Phase 5, HLD §6.2 equivalent) — ported verbatim from
 * `legacy/api/src/vector/domain/vector-store.port.ts`. Framework-free by construction (no Next.js/
 * TypeORM import here) — application code depends only on this interface, never on the concrete
 * Qdrant adapter directly.
 *
 * Every method below takes a {@link TenantScope} as its first, non-optional argument — this is what
 * makes "call the vector store without a tenant scope" a **compile-time** error rather than a
 * runtime one to catch (see `vector-store-tenant-scope.compile-check.ts`'s `@ts-expect-error` case).
 * There is deliberately no method anywhere on this interface that accepts an arbitrary/raw Qdrant
 * filter object — every filter is expressed through the narrow, whitelisted shapes below, so a
 * caller cannot smuggle a cross-tenant condition through a "just this once" escape hatch.
 */
export interface TenantScope {
  readonly tenantId: string;
}

/** A single point to upsert. `payload.tenantId` is set by the adapter from `scope`, never trusted
 * from the caller-supplied payload (a caller-supplied `tenantId` key, if present, is overwritten). */
export interface VectorPoint {
  id: string;
  vector: number[];
  payload: Record<string, unknown>;
}

/** A point returned from a search/scroll call. `vector` is only populated when the caller asked for
 * it (`withVector: true`) — omitted by default to keep response payloads small. */
export interface ScoredPoint {
  id: string;
  score: number;
  payload: Record<string, unknown>;
  vector?: number[];
}

/** Non-tenant filter fields accepted by the `<prefix>_chunks` surface. */
export interface ChunkFilter {
  curriculumId?: string;
  documentId?: string;
}

/** Non-tenant filter fields accepted by the `<prefix>_question_bank` surface. */
export interface QuestionFilter {
  scopeKey?: string;
  examTypeId?: string;
}

/** Non-tenant filter fields accepted by {@link VectorStorePort.deleteQuestions}. */
export interface DeleteQuestionsFilter {
  examTypeId?: string;
  questionKeys?: string[];
}

export interface ScrollOptions {
  limit: number;
  withVector?: boolean;
}

/**
 * The sole vector-store surface application code may depend on. The concrete implementation,
 * `QdrantVectorStoreAdapter` (`server/infrastructure/vector`), is the only file in this app permitted
 * to import `@qdrant/js-client-rest` (ESLint-enforced, `apps/next/.eslintrc.cjs`).
 */
export interface VectorStorePort {
  upsertChunks(scope: TenantScope, points: VectorPoint[]): Promise<void>;
  searchChunks(
    scope: TenantScope,
    queryVector: number[],
    filter: ChunkFilter,
    limit: number,
    scoreThreshold?: number,
  ): Promise<ScoredPoint[]>;
  scrollChunks(scope: TenantScope, filter: ChunkFilter, opts: ScrollOptions): Promise<ScoredPoint[]>;
  deleteChunks(scope: TenantScope, filter: ChunkFilter): Promise<void>;

  upsertFingerprint(scope: TenantScope, point: VectorPoint): Promise<void>;
  searchFingerprint(scope: TenantScope, queryVector: number[], threshold: number): Promise<ScoredPoint[]>;

  upsertQuestions(scope: TenantScope, points: VectorPoint[]): Promise<void>;
  searchQuestions(
    scope: TenantScope,
    queryVector: number[],
    filter: QuestionFilter,
    limit: number,
    scoreThreshold?: number,
  ): Promise<ScoredPoint[]>;
  scrollQuestions(scope: TenantScope, filter: QuestionFilter, opts: ScrollOptions): Promise<ScoredPoint[]>;
  deleteQuestions(scope: TenantScope, filter: DeleteQuestionsFilter): Promise<void>;

  /** Deletes every point belonging to `scope.tenantId` across all three collections (tenant purge). */
  purgeTenant(scope: TenantScope): Promise<void>;

  /** Live per-collection point counts for `scope.tenantId` (tenant-isolation reporting/verification). */
  countsForTenant(scope: TenantScope): Promise<Record<string, number>>;
}
