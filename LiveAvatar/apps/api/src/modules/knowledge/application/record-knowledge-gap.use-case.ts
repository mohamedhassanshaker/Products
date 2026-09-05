import { Inject, Injectable } from '@nestjs/common';
import type { KnowledgeGapRequest } from '@liveavatar/contracts';
import { KNOWLEDGE_GAP_REPOSITORY, type KnowledgeGapRepositoryPort } from '../domain/ports';

/**
 * `POST /internal/knowledge/gaps` (Phase 12b, BL-045/047, R-R7) — the live
 * Retrieve node executor's threshold stage calls this for every query whose
 * best-scoring candidate still fell below `min_score` (or that returned no
 * candidates at all). The Playground preview never calls this (see the plan
 * doc's "Decisions made this phase" #9) — a diagnostic query an admin types
 * while tuning the pipeline is not a real caller's turn, and would pollute
 * the gap report's signal with the admin's own repeated test queries.
 */
@Injectable()
export class RecordKnowledgeGapUseCase {
  constructor(@Inject(KNOWLEDGE_GAP_REPOSITORY) private readonly gaps: KnowledgeGapRepositoryPort) {}

  async execute(input: KnowledgeGapRequest): Promise<void> {
    await this.gaps.record({
      tenantId: input.tenant_id,
      sourceId: input.source_id ?? null,
      query: input.query,
      bestScore: input.best_score ?? null,
    });
  }
}
