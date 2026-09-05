import type { ChunkingStrategy, KnowledgeSourceParser, KnowledgeSourceRecord, KnowledgeSourceStatus } from './knowledge-source';

/** Fields accepted on create. */
export interface CreateKnowledgeSourceInput {
  tenantId: string;
  name: string;
  originalFilename: string;
  mimeType: string;
  fileSizeBytes: number;
  rawContent: Buffer;
  parser: KnowledgeSourceParser;
  chunkingStrategy: ChunkingStrategy;
  chunkSize: number;
  chunkOverlap: number;
  embeddingModel: string;
  embeddingCredentialRef: string | null;
  status: KnowledgeSourceStatus;
  chunkCount: number;
  createdBy: string | null;
}

/**
 * Partial fields accepted on update. Separate from `Partial<CreateKnowledgeSourceInput>`
 * (rather than derived via `Omit`) because the ingestion pipeline
 * (`RunKnowledgeIngestionUseCase`) also needs to patch `errorMessage`/
 * `lastIndexedAt`, which are never part of a create call.
 */
export interface UpdateKnowledgeSourceInput {
  name?: string;
  parser?: KnowledgeSourceParser;
  chunkingStrategy?: ChunkingStrategy;
  chunkSize?: number;
  chunkOverlap?: number;
  embeddingModel?: string;
  embeddingCredentialRef?: string | null;
  status?: KnowledgeSourceStatus;
  chunkCount?: number;
  errorMessage?: string | null;
  configUpdatedAt?: Date;
  lastIndexedAt?: Date | null;
}

/**
 * `KnowledgeSource` persistence (Phase 12a, BL-044/046). Optimistic
 * concurrency mirrors `ToolDefinitionRepositoryPort.update`'s `Date`-compared
 * `updatedAt` shape exactly.
 */
export interface KnowledgeSourceRepositoryPort {
  create(input: CreateKnowledgeSourceInput): Promise<KnowledgeSourceRecord>;

  /** Single source, tenant-scoped. */
  findById(tenantId: string, id: string): Promise<KnowledgeSourceRecord | null>;

  /** Every source for a tenant. */
  findMany(tenantId: string): Promise<KnowledgeSourceRecord[]>;

  update(
    tenantId: string,
    id: string,
    ifMatch: Date,
    patch: UpdateKnowledgeSourceInput,
  ): Promise<KnowledgeSourceRecord | 'conflict' | 'missing'>;

  delete(tenantId: string, id: string): Promise<boolean>;
}

export const KNOWLEDGE_SOURCE_REPOSITORY = Symbol('KNOWLEDGE_SOURCE_REPOSITORY');

/** One chunk row to persist, before it has a DB-assigned id. */
export interface KnowledgeChunkInput {
  chunkIndex: number;
  text: string;
  tokenCount: number;
}

/** A persisted chunk row (id assigned). */
export interface KnowledgeChunkRecord extends KnowledgeChunkInput {
  id: string;
}

/** One metadata-filter condition (Phase 12b, BL-045/047) — mirrors `KnowledgeSearchFilterCondition` in `@liveavatar/contracts`. */
export interface KnowledgeFilterCondition {
  field: string;
  op: 'eq' | 'neq' | 'contains';
  value: string;
}

/** One hybrid-search request (Phase 12b) — everything `hybridSearch` needs, pre-resolved by the caller (the embedding is computed by Python, this port never computes one). */
export interface HybridSearchQuery {
  tenantId: string;
  sourceRefs: string[];
  queryText: string;
  queryEmbedding: number[];
  vectorWeight: number;
  keywordWeight: number;
  candidates: number;
  filter?: KnowledgeFilterCondition;
}

/** One ranked candidate — mirrors `KnowledgeSearchCandidate` in `@liveavatar/contracts`. */
export interface KnowledgeSearchCandidate {
  chunkId: string;
  sourceId: string;
  sourceName: string;
  text: string;
  vectorScore: number;
  keywordScore: number;
  blendScore: number;
  passedFilter: boolean;
}

/**
 * `KnowledgeChunk` persistence, including the pgvector embedding write and
 * (Phase 12b) hybrid search — kept as its own port (rather than folded into
 * `KnowledgeSourceRepositoryPort`) because both go through the raw-SQL
 * escape hatch (`$executeRaw`/`$queryRaw`, mirrors
 * `prisma-utterance.repository.ts`) while the rest of this module never
 * needs to.
 */
export interface KnowledgeChunkRepositoryPort {
  /**
   * Deletes every existing chunk for `sourceId` and inserts `chunks` in its
   * place (a re-index replaces, never merges), returning the persisted rows
   * (with their DB-assigned ids) in `chunkIndex` order so the caller can key
   * embeddings back to a chunk id.
   */
  replaceForSource(tenantId: string, sourceId: string, chunks: KnowledgeChunkInput[]): Promise<KnowledgeChunkRecord[]>;

  /** Writes one embedding vector per chunk id via the pgvector raw-SQL escape hatch. */
  writeEmbeddings(tenantId: string, sourceId: string, items: { chunkId: string; embedding: number[] }[]): Promise<void>;

  /**
   * Hybrid search (Phase 12b, BL-045/047, R-R4): pgvector cosine `<=>` +
   * Postgres FTS `ts_rank` against the generated `search_vector` column
   * (12a), blended by `vectorWeight`/`keywordWeight`, with an optional
   * metadata-filter pass computed in the same query (`passedFilter` on each
   * row) rather than a second round trip. Every value — including
   * `filter.field`/`filter.value` — is a bound query parameter; none is ever
   * string-concatenated into the SQL text (see the implementation's own
   * doc comment for why `field` binds safely as `metadata ->> $n`, unlike a
   * column/table identifier).
   */
  hybridSearch(query: HybridSearchQuery): Promise<KnowledgeSearchCandidate[]>;
}

export const KNOWLEDGE_CHUNK_REPOSITORY = Symbol('KNOWLEDGE_CHUNK_REPOSITORY');

/** One `KnowledgeGap` row to record (Phase 12b, R-R7) — the live Retrieve node executor's threshold stage is the only writer (never the Playground preview). */
export interface KnowledgeGapInput {
  tenantId: string;
  sourceId: string | null;
  query: string;
  bestScore: number | null;
}

export interface KnowledgeGapRepositoryPort {
  record(input: KnowledgeGapInput): Promise<void>;
}

export const KNOWLEDGE_GAP_REPOSITORY = Symbol('KNOWLEDGE_GAP_REPOSITORY');

/**
 * Request/response shape for the Nest -> `ai_service` `/retrieve-preview`
 * internal call (Phase 12b, BL-045/047/048) — the Playground's real code
 * path (`ARCHITECTURE_NOTES.md` §4.5's "thin dry-run wrapper" around the
 * same `retrieval_pipeline.py` module the live Retrieve node executor
 * uses). Mirrors `EmbeddingClientPort`'s existing precedent: a plain TS
 * interface here, a Pydantic model on the Python side, kept aligned by
 * convention/code review (not a shared TypeBox schema — same as `/embed`).
 */
export interface RetrievePreviewLlmLeg {
  provider: string;
  model: string;
  credentialRef: string | null;
}

export interface RetrievePreviewRequest {
  tenantId: string;
  query: string;
  conversationContext: string | null;
  sourceRefs: string[];
  llm: RetrievePreviewLlmLeg | null;
  embeddingModel: string;
  embeddingCredentialRef: string | null;
  pipeline: {
    rewrite: { enabled: boolean; context_turns: number; budget_ms: number };
    hybrid_search: { vector_weight: number; keyword_weight: number; candidates: number; budget_ms: number };
    metadata_filter: { enabled: boolean; condition?: KnowledgeFilterCondition; budget_ms: number };
    rerank: { enabled: false };
    threshold: { min_score: number; budget_ms: number };
    inject: { token_cap: number; citation_format: 'numbered' | 'inline' | 'none'; budget_ms: number };
  };
}

export interface RetrievePreviewCandidate {
  chunk_id: string;
  source_id: string;
  source_name: string;
  text_excerpt: string;
  vector_score: number;
  keyword_score: number;
  blend_score: number;
  passed_filter: boolean;
  passed_threshold: boolean;
}

export interface RetrievePreviewInjectedChunk {
  citation_label: string;
  source_name: string;
  text_excerpt: string;
  token_count: number;
}

export interface RetrievePreviewResponse {
  rewrite: { enabled: boolean; rewritten_query: string | null; ms: number; timed_out: boolean };
  hybrid_search: { candidates: RetrievePreviewCandidate[]; ms: number; timed_out: boolean };
  filter: { enabled: boolean; before_count: number; after_count: number; ms: number };
  rerank: { enabled: boolean; note: string };
  threshold: { min_score: number; pass_count: number; dropped_count: number; ms: number };
  inject: { chunks: RetrievePreviewInjectedChunk[]; token_total: number; token_cap: number; ms: number };
  total_ms: number;
  budget_ms: number;
  over_budget: boolean;
}

export interface AiServiceClientPort {
  retrievePreview(request: RetrievePreviewRequest): Promise<RetrievePreviewResponse>;
}

export const AI_SERVICE_CLIENT = Symbol('AI_SERVICE_CLIENT');

/** Request/response shape for the Nest -> Python `/embed` internal call. */
export interface EmbeddingClientPort {
  embed(request: {
    provider: string;
    model: string;
    credentialRef: string | null;
    inputs: string[];
  }): Promise<{ dimension: number; embeddings: number[][] }>;
}

export const EMBEDDING_CLIENT = Symbol('EMBEDDING_CLIENT');

/**
 * BullMQ queue name for RAG ingestion (Phase 12a, BL-044/046). Owned here
 * (not `jobs/domain/queue-names.ts`) so `KnowledgeModule`'s own
 * `BullModule.registerQueue({ name: KNOWLEDGE_INGEST_QUEUE })` and its
 * producer can reach it via a same-module import — `import/no-restricted-paths`
 * only allows a module to be reached through its own `index.ts` barrel, and
 * `KnowledgeModule` must not depend on `JobsModule` (wrong dependency
 * direction — `JobsModule` depends on domain modules, never the reverse).
 * `jobs/domain/queue-names.ts` re-exports this constant from `knowledge`'s
 * barrel instead of the other way around.
 */
export const KNOWLEDGE_INGEST_QUEUE = 'knowledge-ingest';

/** Producer side of the `knowledge-ingest` BullMQ queue (consumed by `KnowledgeIngestProcessor`). */
export interface KnowledgeIngestQueuePort {
  enqueue(input: { tenantId: string; sourceId: string }): Promise<void>;
}

export const KNOWLEDGE_INGEST_QUEUE_PORT = Symbol('KNOWLEDGE_INGEST_QUEUE_PORT');
