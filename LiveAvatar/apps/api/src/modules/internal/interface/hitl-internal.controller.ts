import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import {
  CreateHitlDecisionRequestSchema,
  type CreateHitlDecisionRequest,
  type CreateHitlDecisionResponse,
  type InternalHitlDecisionResponse,
} from '@liveavatar/contracts';
import { TypeBoxValidationPipe } from '../../../common/validation/typebox-pipe';
import { InternalTokenGuard } from '../../../common/auth/internal-token.guard';
import { CreateHitlDecisionUseCase, GetHitlDecisionUseCase } from '../../hitl';

/**
 * Agent-facing `/internal/hitl-decisions` surface (Phase 14, BL-052/053;
 * `ARCHITECTURE_NOTES.md` §6.2/§6.3) — `X-Internal-Token`-guarded exactly
 * like `SkillsInternalController`, kept as its own controller for the same
 * reason: the `hitl` bounded context's agent-facing routes stay grouped
 * with their own module rather than leaking through `SessionsModule`'s
 * import graph (the pre-existing architecture debt this phase was asked not
 * to add to — see `HitlModule`'s own doc comment).
 */
@Controller('internal/hitl-decisions')
@UseGuards(InternalTokenGuard)
export class HitlInternalController {
  constructor(
    private readonly createDecision: CreateHitlDecisionUseCase,
    private readonly getDecision: GetHitlDecisionUseCase,
  ) {}

  /** `POST /internal/hitl-decisions` — creates the pending decision the interpreter then polls. */
  @Post()
  async create(
    @Body(new TypeBoxValidationPipe(CreateHitlDecisionRequestSchema, 'INTERNAL_PAYLOAD_INVALID'))
    body: CreateHitlDecisionRequest,
  ): Promise<CreateHitlDecisionResponse> {
    const result = await this.createDecision.execute({
      tenantId: body.tenant_id,
      sessionId: body.session_id,
      gateId: body.gate_id,
      utteranceSeq: body.utterance_seq,
      proposedAction: {
        kind: body.proposed_action.kind,
        summary: body.proposed_action.summary,
        arguments: body.proposed_action.arguments,
        transcriptExcerpt: body.proposed_action.transcript_excerpt,
        callerIdentity: body.proposed_action.caller_identity,
        retrievedSources: body.proposed_action.retrieved_sources,
        modelReasoning: body.proposed_action.model_reasoning,
      },
    });
    return { id: result.id, hold_treatment_text: result.holdTreatmentText, sla_seconds: result.slaSeconds };
  }

  /** `GET /internal/hitl-decisions/{id}` — the short-poll target; 1-2s interval, bounded by the gate's own `sla_seconds` (`ARCHITECTURE_NOTES.md` §6.2 point 3). */
  @Get(':id')
  get(@Param('id') id: string): Promise<InternalHitlDecisionResponse> {
    return this.getDecision.execute(id);
  }
}
