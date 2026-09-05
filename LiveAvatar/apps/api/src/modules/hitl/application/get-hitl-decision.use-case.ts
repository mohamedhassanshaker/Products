import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import { HITL_DECISION_REPOSITORY, type HitlDecisionRepositoryPort } from '../domain/ports';
import { toHitlDecisionDto } from './hitl-decision-dto';

/**
 * `GET /internal/hitl-decisions/{id}` — the agent's short-poll target
 * (`ARCHITECTURE_NOTES.md` §6.2 point 3). No tenant scoping on the lookup
 * itself (the agent polls by decision id alone, minted by
 * `CreateHitlDecisionUseCase` and never guessable) — same "id is the
 * capability" trust model `GetSkillBodyUseCase` already uses for its own
 * internal surface.
 */
@Injectable()
export class GetHitlDecisionUseCase {
  constructor(@Inject(HITL_DECISION_REPOSITORY) private readonly decisions: HitlDecisionRepositoryPort) {}

  async execute(decisionId: string) {
    const decision = await this.decisions.findByIdAnyTenant(decisionId);
    if (!decision) {
      throw AppError.notFound('HITL_DECISION_NOT_FOUND');
    }
    return toHitlDecisionDto(decision);
  }
}
