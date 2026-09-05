import { Type, type Static } from '@sinclair/typebox';

/**
 * Real (`plain_text`/`markdown`) vs. present-but-disabled (`pdf`) parser
 * values (Phase 12a plan doc "Decisions made this phase" #5) — kept as a
 * real enum value so the admin UI can show PDF as a visible "coming soon"
 * option without a later schema change.
 */
export const KnowledgeSourceParserSchema = Type.Union([
  Type.Literal('plain_text'),
  Type.Literal('markdown'),
  Type.Literal('pdf'),
]);
export type KnowledgeSourceParser = Static<typeof KnowledgeSourceParserSchema>;

/** Real (`fixed`) vs. present-but-disabled (`semantic`/`heading_aware`) strategies (BL-071). */
export const ChunkingStrategySchema = Type.Union([
  Type.Literal('fixed'),
  Type.Literal('semantic'),
  Type.Literal('heading_aware'),
]);
export type ChunkingStrategy = Static<typeof ChunkingStrategySchema>;

export const KnowledgeSourceStatusSchema = Type.Union([
  Type.Literal('pending'),
  Type.Literal('processing'),
  Type.Literal('ready'),
  Type.Literal('failed'),
]);
export type KnowledgeSourceStatus = Static<typeof KnowledgeSourceStatusSchema>;

const KnowledgeSourceConfigFields = {
  name: Type.String({ minLength: 1, maxLength: 160 }),
  parser: Type.Optional(KnowledgeSourceParserSchema),
  chunking_strategy: Type.Optional(ChunkingStrategySchema),
  chunk_size: Type.Optional(Type.Integer({ minimum: 100, maximum: 4000 })),
  chunk_overlap: Type.Optional(Type.Integer({ minimum: 0, maximum: 2000 })),
  embedding_model: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
  embedding_credential_ref: Type.Optional(Type.Union([Type.String({ minLength: 1, maxLength: 256 }), Type.Null()])),
};

/** `POST /tenants/:id/knowledge-sources` non-file body fields (multipart — the
 * uploaded file arrives as a separate `file` part, handled by multer). */
export const CreateKnowledgeSourceRequestSchema = Type.Object(KnowledgeSourceConfigFields, {
  additionalProperties: false,
});
export type CreateKnowledgeSourceRequest = Static<typeof CreateKnowledgeSourceRequestSchema>;

/** `PATCH /tenants/:id/knowledge-sources/:sourceId` body — all optional. */
export const UpdateKnowledgeSourceRequestSchema = Type.Object(
  { ...KnowledgeSourceConfigFields, name: Type.Optional(KnowledgeSourceConfigFields.name) },
  { additionalProperties: false },
);
export type UpdateKnowledgeSourceRequest = Static<typeof UpdateKnowledgeSourceRequestSchema>;

export const KnowledgeSourceSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  tenant_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  source_type: Type.Literal('upload'),
  original_filename: Type.String(),
  mime_type: Type.String(),
  file_size_bytes: Type.Integer(),
  parser: KnowledgeSourceParserSchema,
  chunking_strategy: ChunkingStrategySchema,
  chunk_size: Type.Integer(),
  chunk_overlap: Type.Integer(),
  embedding_model: Type.String(),
  embedding_credential_ref: Type.Union([Type.String(), Type.Null()]),
  status: KnowledgeSourceStatusSchema,
  chunk_count: Type.Integer(),
  error_message: Type.Union([Type.String(), Type.Null()]),
  is_stale: Type.Boolean(),
  config_updated_at: Type.String(),
  last_indexed_at: Type.Union([Type.String(), Type.Null()]),
  created_at: Type.String(),
  updated_at: Type.String(),
});
export type KnowledgeSourceDto = Static<typeof KnowledgeSourceSchema>;

export const ListKnowledgeSourcesResponseSchema = Type.Object({ items: Type.Array(KnowledgeSourceSchema) });
export type ListKnowledgeSourcesResponseDto = Static<typeof ListKnowledgeSourcesResponseSchema>;

/** `GET /tenants/:id/knowledge-sources/:sourceId/reindex-estimate` — a coarse,
 * explicitly-labelled linear estimate (chunk_count × constants), never a real
 * measurement (plan doc §"Decisions made this phase" #8). */
export const ReindexEstimateResponseSchema = Type.Object({
  chunk_count: Type.Integer(),
  estimated_cost_usd: Type.Number(),
  estimated_duration_ms: Type.Integer(),
  is_estimate: Type.Literal(true),
});
export type ReindexEstimateResponseDto = Static<typeof ReindexEstimateResponseSchema>;

export const TriggerReindexResponseSchema = Type.Object({ enqueued: Type.Boolean() });
export type TriggerReindexResponseDto = Static<typeof TriggerReindexResponseSchema>;

/**
 * Phase 12b (BL-045/047/048) — Retrieval playground
 * (`POST /tenants/:id/knowledge/playground/run`). A **dedicated**
 * retrieval-only invocation, not the Phase 9 `TestCallRequestSchema` harness
 * (`deployment-config/schemas.ts`) — see the plan doc's Phase 12b "Decisions
 * made this phase" #8 for why: it runs the real six-stage pipeline against
 * the tenant's live pgvector index via `ai_service`'s `/retrieve-preview`,
 * never a structural simulation, so a structurally different (richer,
 * per-stage-scored) response shape is warranted rather than overloading
 * `TestCallNodeResultDto.detail: string`.
 */
export const RunRetrievalPlaygroundRequestSchema = Type.Object({
  query: Type.String({ minLength: 1, maxLength: 1000 }),
  conversation_context: Type.Optional(Type.String({ maxLength: 4000 })),
  /** Defaults to every `retrieve`-type node's `source_refs` (unioned) in the tenant's current draft config when omitted. */
  source_refs: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 256 }))),
});
export type RunRetrievalPlaygroundRequest = Static<typeof RunRetrievalPlaygroundRequestSchema>;

export const RetrievalPlaygroundCandidateSchema = Type.Object({
  chunk_id: Type.String(),
  source_id: Type.String(),
  source_name: Type.String(),
  text_excerpt: Type.String(),
  vector_score: Type.Number(),
  keyword_score: Type.Number(),
  blend_score: Type.Number(),
  passed_filter: Type.Boolean(),
  passed_threshold: Type.Boolean(),
});
export type RetrievalPlaygroundCandidateDto = Static<typeof RetrievalPlaygroundCandidateSchema>;

export const RetrievalPlaygroundInjectedChunkSchema = Type.Object({
  citation_label: Type.String(),
  source_name: Type.String(),
  text_excerpt: Type.String(),
  token_count: Type.Integer(),
});
export type RetrievalPlaygroundInjectedChunkDto = Static<typeof RetrievalPlaygroundInjectedChunkSchema>;

/** One row per pipeline stage — §A7.5's "stage-by-stage table" shape. */
export const RunRetrievalPlaygroundResponseSchema = Type.Object({
  rewrite: Type.Object({
    enabled: Type.Boolean(),
    rewritten_query: Type.Union([Type.String(), Type.Null()]),
    ms: Type.Integer(),
    timed_out: Type.Boolean(),
  }),
  hybrid_search: Type.Object({
    candidates: Type.Array(RetrievalPlaygroundCandidateSchema),
    ms: Type.Integer(),
    timed_out: Type.Boolean(),
  }),
  filter: Type.Object({
    enabled: Type.Boolean(),
    before_count: Type.Integer(),
    after_count: Type.Integer(),
    ms: Type.Integer(),
  }),
  rerank: Type.Object({ enabled: Type.Boolean(), note: Type.String() }),
  threshold: Type.Object({
    min_score: Type.Number(),
    pass_count: Type.Integer(),
    dropped_count: Type.Integer(),
    ms: Type.Integer(),
  }),
  inject: Type.Object({
    chunks: Type.Array(RetrievalPlaygroundInjectedChunkSchema),
    token_total: Type.Integer(),
    token_cap: Type.Integer(),
    ms: Type.Integer(),
  }),
  total_ms: Type.Integer(),
  budget_ms: Type.Integer(),
  over_budget: Type.Boolean(),
});
export type RunRetrievalPlaygroundResponseDto = Static<typeof RunRetrievalPlaygroundResponseSchema>;
