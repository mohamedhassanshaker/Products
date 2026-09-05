import { Inject, Injectable } from '@nestjs/common';
import type { UpdateHitlGateRequest } from '@liveavatar/contracts';
import { AppError } from '../../../common/errors/app-error';
import type { AdminActor } from '../../../common/auth/admin-actor';
import { canAccessTenant } from '../../../common/auth/admin-actor';
import { TENANT_REPOSITORY, type TenantRepositoryPort } from '../../tenants';
import { TOOL_DEFINITION_REPOSITORY, type ToolDefinitionRepositoryPort } from '../../tools';
import { HITL_GATE_REPOSITORY, REVIEWER_GROUP_REPOSITORY, type HitlGateRepositoryPort, type ReviewerGroupRepositoryPort, type UpdateHitlGateInput } from '../domain/ports';
import { validateHitlGateDraft } from '../domain/hitl-validation';
import { toHitlGateDto } from './hitl-gate-dto';

/** `PATCH /tenants/:id/hitl/gates/:gateId` (BL-052/054). Re-validates R-H1/V-8 against the merged result, not just the patch — a partial update cannot leave the gate incomplete. */
@Injectable()
export class UpdateHitlGateUseCase {
  constructor(
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepositoryPort,
    @Inject(HITL_GATE_REPOSITORY) private readonly gates: HitlGateRepositoryPort,
    @Inject(REVIEWER_GROUP_REPOSITORY) private readonly reviewerGroups: ReviewerGroupRepositoryPort,
    @Inject(TOOL_DEFINITION_REPOSITORY) private readonly tools: ToolDefinitionRepositoryPort,
  ) {}

  async execute(actor: AdminActor, tenantId: string, gateId: string, input: UpdateHitlGateRequest) {
    const tenant = await this.tenants.findById(tenantId);
    if (!tenant) {
      throw AppError.notFound('TENANT_NOT_FOUND');
    }
    if (!canAccessTenant(actor, tenant.id)) {
      throw AppError.forbidden('TENANT_FORBIDDEN');
    }
    const existing = await this.gates.findById(tenantId, gateId);
    if (!existing) {
      throw AppError.notFound('HITL_GATE_NOT_FOUND');
    }

    if (input.reviewer_group_id !== undefined) {
      const group = await this.reviewerGroups.findById(tenantId, input.reviewer_group_id);
      if (!group) {
        throw AppError.notFound('HITL_REVIEWER_GROUP_NOT_FOUND');
      }
    }

    const merged = {
      attachmentKind: input.attachment_kind ?? existing.attachmentKind,
      attachmentRef: input.attachment_ref ?? existing.attachmentRef,
      triggerCondition: input.trigger_condition ?? existing.triggerCondition,
      gateType: input.gate_type ?? existing.gateType,
      reviewerGroupId: input.reviewer_group_id ?? existing.reviewerGroupId,
      slaSeconds: input.sla_seconds ?? existing.slaSeconds,
      holdTreatmentText: input.hold_treatment_text ?? existing.holdTreatmentText,
      timeoutBehavior: input.timeout_behavior ?? existing.timeoutBehavior,
      escalateToGroupId: input.escalate_to_group_id !== undefined ? input.escalate_to_group_id : existing.escalateToGroupId,
      autoApproveAckText: input.auto_approve_ack_text !== undefined ? input.auto_approve_ack_text : existing.autoApproveAckText,
      notifyChannels: input.notify_channels ?? existing.notifyChannels,
      environments: input.environments ?? existing.environments,
      status: input.status ?? existing.status,
    };

    let attachedToConsequentialTool = false;
    if (merged.attachmentKind === 'tool') {
      const tool = await this.tools.findByApiRef(tenantId, merged.attachmentRef);
      attachedToConsequentialTool = tool?.consequential ?? false;
    }

    const issues = validateHitlGateDraft({
      triggerCondition: merged.triggerCondition,
      gateType: merged.gateType,
      reviewerGroupId: merged.reviewerGroupId,
      slaSeconds: merged.slaSeconds,
      holdTreatmentText: merged.holdTreatmentText,
      timeoutBehavior: merged.timeoutBehavior,
      autoApproveAckText: merged.autoApproveAckText,
      attachedToConsequentialTool,
    });
    if (issues.length > 0) {
      throw AppError.badRequest(issues[0].code);
    }

    const patch: UpdateHitlGateInput = merged;
    const updated = await this.gates.update(tenantId, gateId, patch);
    if (!updated) {
      throw AppError.notFound('HITL_GATE_NOT_FOUND');
    }
    return toHitlGateDto(updated);
  }
}
