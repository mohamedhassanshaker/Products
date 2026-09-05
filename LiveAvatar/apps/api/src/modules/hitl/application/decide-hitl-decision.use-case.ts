import { Inject, Injectable } from '@nestjs/common';
import type { DecideHitlDecisionRequest } from '@liveavatar/contracts';
import { AppError } from '../../../common/errors/app-error';
import type { AdminActor } from '../../../common/auth/admin-actor';
import { canAccessTenant } from '../../../common/auth/admin-actor';
import { TENANT_REPOSITORY, type TenantRepositoryPort } from '../../tenants';
import {
  HITL_DECISION_REPOSITORY,
  HITL_DEFERRED_FOLLOWUP_QUEUE_PORT,
  HITL_GATE_REPOSITORY,
  REVIEWER_GROUP_REPOSITORY,
  type HitlDecisionRepositoryPort,
  type HitlDeferredFollowupQueuePort,
  type HitlGateRepositoryPort,
  type ReviewerGroupRepositoryPort,
} from '../domain/ports';
import { toHitlDecisionDto } from './hitl-decision-dto';

const ACTION_TO_DECISION = {
  approve: 'approved',
  deny: 'denied',
  edit_approve: 'edited_approved',
} as const;

/** `POST /tenants/:id/hitl/decisions/:decisionId/decide` (BL-055) — R-H6: approve, deny, or edit-and-approve. */
@Injectable()
export class DecideHitlDecisionUseCase {
  constructor(
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepositoryPort,
    @Inject(HITL_DECISION_REPOSITORY) private readonly decisions: HitlDecisionRepositoryPort,
    @Inject(HITL_GATE_REPOSITORY) private readonly gates: HitlGateRepositoryPort,
    @Inject(REVIEWER_GROUP_REPOSITORY) private readonly reviewerGroups: ReviewerGroupRepositoryPort,
    @Inject(HITL_DEFERRED_FOLLOWUP_QUEUE_PORT) private readonly deferredFollowup: HitlDeferredFollowupQueuePort,
  ) {}

  async execute(actor: AdminActor, tenantId: string, decisionId: string, input: DecideHitlDecisionRequest) {
    const tenant = await this.tenants.findById(tenantId);
    if (!tenant) {
      throw AppError.notFound('TENANT_NOT_FOUND');
    }
    if (!canAccessTenant(actor, tenant.id)) {
      throw AppError.forbidden('TENANT_FORBIDDEN');
    }
    const decision = await this.decisions.findById(tenantId, decisionId);
    if (!decision) {
      throw AppError.notFound('HITL_DECISION_NOT_FOUND');
    }
    if (decision.decision !== 'pending') {
      throw AppError.conflict('HITL_DECISION_ALREADY_DECIDED');
    }

    const gate = await this.gates.findById(tenantId, decision.gateId);
    if (gate) {
      const group = await this.reviewerGroups.findById(tenantId, gate.reviewerGroupId);
      if (group && !group.members.includes(actor.id)) {
        throw AppError.forbidden('HITL_DECISION_FORBIDDEN');
      }
    }

    if (input.action === 'edit_approve' && !input.edited_arguments) {
      throw AppError.badRequest('INTERNAL_PAYLOAD_INVALID');
    }

    const updated = await this.decisions.decide(decisionId, {
      reviewerId: actor.id,
      decision: ACTION_TO_DECISION[input.action],
      editedArguments: input.edited_arguments,
      justificationNote: input.justification_note,
    });
    if (!updated) {
      throw AppError.conflict('HITL_DECISION_ALREADY_DECIDED');
    }

    // BL-056 — a `deferred`-type gate's whole point is that the caller has
    // already left; a human approval here still needs the same out-of-band
    // tool execution the SLA sweep's own auto-approve path triggers
    // (`HitlSlaSweepProcessor`'s mirror of this block).
    if (gate?.gateType === 'deferred' && (updated.decision === 'approved' || updated.decision === 'edited_approved') && updated.proposedAction.kind === 'tool_call') {
      await this.deferredFollowup.enqueue({ tenantId, decisionId: updated.id });
    }

    return toHitlDecisionDto(updated);
  }
}
