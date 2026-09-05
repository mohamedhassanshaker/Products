import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import { HITL_DECISION_REPOSITORY, HITL_GATE_REPOSITORY, type CreateHitlDecisionInput, type HitlDecisionRepositoryPort, type HitlGateRepositoryPort } from '../domain/ports';

/**
 * `POST /internal/hitl-decisions` — the agent-facing entry point for a live
 * blocking/deferred/pre-speech gate hit (`ARCHITECTURE_NOTES.md` §6.2 point
 * 1/3). Creates the `pending` `HitlDecision` row the interpreter then
 * short-polls (`GetHitlDecisionUseCase`) until it resolves or its own
 * locally-tracked SLA deadline elapses. No `AdminActor` — this is the
 * unauthenticated-by-admin-JWT internal surface (X-Internal-Token guarded at
 * the controller), same trust boundary every other `/internal/*` route uses.
 */
@Injectable()
export class CreateHitlDecisionUseCase {
  constructor(
    @Inject(HITL_GATE_REPOSITORY) private readonly gates: HitlGateRepositoryPort,
    @Inject(HITL_DECISION_REPOSITORY) private readonly decisions: HitlDecisionRepositoryPort,
  ) {}

  async execute(input: CreateHitlDecisionInput): Promise<{ id: string; holdTreatmentText: string; slaSeconds: number }> {
    const gate = await this.gates.findById(input.tenantId, input.gateId);
    if (!gate) {
      throw AppError.notFound('HITL_GATE_NOT_FOUND');
    }
    const created = await this.decisions.create(input);
    return { id: created.id, holdTreatmentText: gate.holdTreatmentText, slaSeconds: gate.slaSeconds };
  }
}
