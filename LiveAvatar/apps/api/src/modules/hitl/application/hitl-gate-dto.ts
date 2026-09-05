import type { HitlGateDto } from '@liveavatar/contracts';
import type { HitlGateRecord } from '../domain/hitl-gate';

/** Maps a `HitlGate` record to its wire DTO. */
export function toHitlGateDto(record: HitlGateRecord): HitlGateDto {
  return {
    id: record.id,
    tenant_id: record.tenantId,
    attachment_kind: record.attachmentKind,
    attachment_ref: record.attachmentRef,
    trigger_condition: record.triggerCondition,
    gate_type: record.gateType,
    reviewer_group_id: record.reviewerGroupId,
    sla_seconds: record.slaSeconds,
    hold_treatment_text: record.holdTreatmentText,
    timeout_behavior: record.timeoutBehavior,
    escalate_to_group_id: record.escalateToGroupId,
    auto_approve_ack_text: record.autoApproveAckText,
    notify_channels: record.notifyChannels,
    environments: record.environments,
    status: record.status,
    created_at: record.createdAt.toISOString(),
    updated_at: record.updatedAt.toISOString(),
  };
}
