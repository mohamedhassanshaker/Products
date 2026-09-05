import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import {
  KnowledgeGapRequestSchema,
  KnowledgeSearchRequestSchema,
  type KnowledgeGapRequest,
  type KnowledgeSearchRequest,
  type KnowledgeSearchResponse,
} from '@liveavatar/contracts';
import { TypeBoxValidationPipe } from '../../../common/validation/typebox-pipe';
import { InternalTokenGuard } from '../../../common/auth/internal-token.guard';
import { SearchKnowledgeUseCase, RecordKnowledgeGapUseCase } from '../../knowledge';

/**
 * Agent-facing `/internal/knowledge/*` surface (Phase 12b, BL-045/047) —
 * `X-Internal-Token`-guarded like `AgentInternalController`, kept as its
 * own controller (rather than folded into that one) so the `knowledge`
 * bounded context's agent-facing routes stay grouped with its own module,
 * mirroring `InternalController`/`AgentInternalController`'s existing
 * split-by-concern precedent.
 *
 * `hybrid-search` is the one seam that touches Postgres on a Python
 * process's behalf (ADR-001 — no Python process holds a Postgres client);
 * `gaps` is R-R7's `KnowledgeGap` writer, called only by the live Retrieve
 * node executor (never the Playground preview — see the plan doc).
 */
@Controller('internal/knowledge')
@UseGuards(InternalTokenGuard)
export class KnowledgeInternalController {
  constructor(
    private readonly searchKnowledge: SearchKnowledgeUseCase,
    private readonly recordGap: RecordKnowledgeGapUseCase,
  ) {}

  /** `POST /internal/knowledge/search` — hybrid search + optional metadata filter. */
  @Post('search')
  @HttpCode(200)
  async search(
    @Body(new TypeBoxValidationPipe(KnowledgeSearchRequestSchema, 'INTERNAL_PAYLOAD_INVALID')) body: KnowledgeSearchRequest,
  ): Promise<KnowledgeSearchResponse> {
    return this.searchKnowledge.execute(body);
  }

  /** `POST /internal/knowledge/gaps` — R-R7's below-threshold retrieval event. */
  @Post('gaps')
  @HttpCode(204)
  async gap(
    @Body(new TypeBoxValidationPipe(KnowledgeGapRequestSchema, 'INTERNAL_PAYLOAD_INVALID')) body: KnowledgeGapRequest,
  ): Promise<void> {
    await this.recordGap.execute(body);
  }
}
