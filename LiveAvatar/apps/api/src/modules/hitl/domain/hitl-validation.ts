import type { AppErrorCode } from '@liveavatar/contracts';
import type { HitlGateType, HitlTimeoutBehavior } from './hitl-gate';
import { SUPPORTED_HITL_GATE_TYPES } from './hitl-gate';

/** One publish/save-blocking issue — mirrors `SkillValidationIssue`'s shape (`skills/domain/skill-validation.ts`). */
export interface HitlGateValidationIssue {
  code: Extract<AppErrorCode, 'HITL_GATE_INCOMPLETE' | 'HITL_AUTO_APPROVE_ACK_REQUIRED'>;
  field?: string;
}

/** The subset of a gate's fields R-H1/V-8 need — deliberately narrow so callers don't have to build a full `HitlGateRecord` just to validate a draft merge. */
export interface HitlGateDraftForValidation {
  triggerCondition: Record<string, unknown> | undefined;
  gateType: HitlGateType | undefined;
  reviewerGroupId: string | undefined;
  slaSeconds: number | undefined;
  holdTreatmentText: string | undefined;
  timeoutBehavior: HitlTimeoutBehavior | undefined;
  autoApproveAckText: string | null | undefined;
  /** `true` when this gate is attached to a `consequential: true` tool — resolved by the caller (this file has no DB access). */
  attachedToConsequentialTool: boolean;
}

/**
 * R-H1 — "all six [fields] are mandatory; a gate cannot be saved partially
 * specified" — plus V-8 ("`auto_approve` timeout on a consequential tool
 * requires an explicit written acknowledgement"). The wire schema
 * (`CreateHitlGateRequestSchema`) already makes five of R-H1's six fields
 * required at the type level for a create; this function is what makes a
 * **PATCH-then-merge** update honor the same rule (a partial update could
 * otherwise null out a previously-required field) and is the one place V-8
 * is actually enforced (`ARCHITECTURE_NOTES.md` §7: "own field-presence
 * check in the `hitl` module, gates aren't inlined YAML" — this is
 * deliberately not a `deployment-config` Gate A/B rule).
 * @param draft - The gate's fields after merging a create/update input onto any existing row
 */
export function validateHitlGateDraft(draft: HitlGateDraftForValidation): HitlGateValidationIssue[] {
  const issues: HitlGateValidationIssue[] = [];

  const hasTriggerCondition = draft.triggerCondition !== undefined && draft.triggerCondition !== null;
  const mandatoryFieldsPresent =
    hasTriggerCondition &&
    Boolean(draft.gateType) &&
    Boolean(draft.reviewerGroupId) &&
    typeof draft.slaSeconds === 'number' &&
    draft.slaSeconds > 0 &&
    Boolean(draft.holdTreatmentText?.trim()) &&
    Boolean(draft.timeoutBehavior);
  if (!mandatoryFieldsPresent) {
    issues.push({ code: 'HITL_GATE_INCOMPLETE' });
  }

  if (draft.gateType && !SUPPORTED_HITL_GATE_TYPES.includes(draft.gateType)) {
    // Whisper/post_hoc are visible-but-disabled in the builder (`UX_SCOPE.md`)
    // — rejected here defensively in case a client bypasses the disabled UI.
    issues.push({ code: 'HITL_GATE_INCOMPLETE', field: 'gate_type' });
  }

  if (draft.timeoutBehavior === 'auto_approve' && draft.attachedToConsequentialTool && !draft.autoApproveAckText?.trim()) {
    issues.push({ code: 'HITL_AUTO_APPROVE_ACK_REQUIRED' });
  }

  return issues;
}
