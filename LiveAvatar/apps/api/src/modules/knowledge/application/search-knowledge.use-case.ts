import { Inject, Injectable } from '@nestjs/common';
import type { KnowledgeSearchRequest, KnowledgeSearchResponse } from '@liveavatar/contracts';
import { KNOWLEDGE_CHUNK_REPOSITORY, type KnowledgeChunkRepositoryPort } from '../domain/ports';

/**
 * `POST /internal/knowledge/search` (Phase 12b, BL-045/047) — the one seam
 * that actually touches Postgres on behalf of a Python process (the live
 * Retrieve node executor, or `ai_service`'s `/retrieve-preview` for the
 * Playground) — neither ever holds a Postgres client itself (ADR-001;
 * confirmed no `psycopg`/`asyncpg` dependency exists anywhere in
 * `apps/agent`). No `AdminActor`/`canAccessTenant` check here — this route
 * lives on the internal listener behind `InternalTokenGuard`, the same
 * trust boundary every other agent-facing `/internal` route uses
 * (`tenant_id` comes from the request body directly, same as
 * `AlertRequest`).
 */
@Injectable()
export class SearchKnowledgeUseCase {
  constructor(@Inject(KNOWLEDGE_CHUNK_REPOSITORY) private readonly chunks: KnowledgeChunkRepositoryPort) {}

  async execute(input: KnowledgeSearchRequest): Promise<KnowledgeSearchResponse> {
    const candidates = await this.chunks.hybridSearch({
      tenantId: input.tenant_id,
      sourceRefs: input.source_refs,
      queryText: input.query_text,
      queryEmbedding: input.query_embedding,
      vectorWeight: input.vector_weight,
      keywordWeight: input.keyword_weight,
      candidates: input.candidates,
      filter: input.filter,
    });
    return {
      candidates: candidates.map((c) => ({
        chunk_id: c.chunkId,
        source_id: c.sourceId,
        source_name: c.sourceName,
        text: c.text,
        vector_score: c.vectorScore,
        keyword_score: c.keywordScore,
        blend_score: c.blendScore,
        passed_filter: c.passedFilter,
      })),
    };
  }
}
