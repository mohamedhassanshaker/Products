import { Inject, Injectable } from '@nestjs/common';
import type { CreateHitlGateRequest } from '@liveavatar/contracts';
import { AppError } from '../../../common/errors/app-error';
import type { AdminActor } from '../../../common/auth/admin-actor';
import { canAccessTenant } from '../../../common/auth/admin-actor';
import { TENANT_REPOSITORY, type TenantRepositoryPort } from '../../tenants';
import { TOOL_DEFINITION_REPOSITORY, type ToolDefinitionRepositoryPort } from '../../tools';
import { HITL_GATE_REPOSITORY, REVIEWER_GROUP_REPOSITORY, type HitlGateRepositoryPort, type ReviewerGroupRepositoryPort } from '../domain/ports';
import { validateHitlGateDraft } from '../domain/hitl-validation';
import { toHitlGateDto } from './hitl-gate-dto';

/** `POST /tenants/:id/hitl/gates` (BL-052/054). R-H1 — all six mandatory fields required together; see `hitl-validation.ts`. */
@Injectable()
export class CreateHitlGateUseCase {
  constructor(
    @Inject(TENANT_REPOSITORY) private readonly tenants: TenantRepositoryPort,
    @Inject(HITL_GATE_REPOSITORY) private readonly gates: HitlGateRepositoryPort,
    @Inject(REVIEWER_GROUP_REPOSITORY) private readonly reviewerGroups: ReviewerGroupRepositoryPort,
    @Inject(TOOL_DEFINITION_REPOSITORY) private readonly tools: ToolDefinitionRepositoryPort,
  ) {}

  async execute(actor: AdminActor, tenantId: string, input: CreateHitlGateRequest) {
    const tenant = await this.tenants.findById(tenantId);
    if (!tenant) {
      throw AppError.notFound('TENANT_NOT_FOUND');
    }
    if (!canAccessTenant(actor, tenant.id)) {
      throw AppError.forbidden('TENANT_FORBIDDEN');
    }

    const reviewerGroup = await this.reviewerGroups.findById(tenantId, input.reviewer_group_id);
    if (!reviewerGroup) {
      throw AppError.notFound('HITL_REVIEWER_GROUP_NOT_FOUND');
    }

    let attachedToConsequentialTool = false;
    if (input.attachment_kind === 'tool') {
      const tool = await this.tools.findByApiRef(tenantId, input.attachment_ref);
      attachedToConsequentialTool = tool?.consequential ?? false;
    }

    const issues = validateHitlGateDraft({
      triggerCondition: input.trigger_condition ?? {},
      gateType: input.gate_type,
      reviewerGroupId: input.reviewer_group_id,
      slaSeconds: input.sla_seconds,
      holdTreatmentText: input.hold_treatment_text,
      timeoutBehavior: input.timeout_behavior,
      autoApproveAckText: input.auto_approve_ack_text,
      attachedToConsequentialTool,
    });
    if (issues.length > 0) {
      throw AppError.badRequest(issues[0].code);
    }

    const created = await this.gates.create({
      tenantId,
      attachmentKind: input.attachment_kind,
      attachmentRef: input.attachment_ref,
      triggerCondition: input.trigger_condition ?? {},
      gateType: input.gate_type,
      reviewerGroupId: input.reviewer_group_id,
      slaSeconds: input.sla_seconds,
      holdTreatmentText: input.hold_treatment_text,
      timeoutBehavior: input.timeout_behavior,
      escalateToGroupId: input.escalate_to_group_id ?? null,
      autoApproveAckText: input.auto_approve_ack_text ?? null,
      notifyChannels: input.notify_channels ?? [],
      environments: input.environments ?? ['dev', 'staging', 'production'],
      status: 'active',
      createdBy: actor.id,
    });
    return toHitlGateDto(created);
  }
}
