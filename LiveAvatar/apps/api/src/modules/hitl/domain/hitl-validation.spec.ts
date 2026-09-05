import { validateHitlGateDraft, type HitlGateDraftForValidation } from './hitl-validation';

function makeDraft(overrides: Partial<HitlGateDraftForValidation> = {}): HitlGateDraftForValidation {
  return {
    triggerCondition: {},
    gateType: 'blocking',
    reviewerGroupId: 'group-1',
    slaSeconds: 45,
    holdTreatmentText: 'One moment while I check on that.',
    timeoutBehavior: 'auto_deny',
    autoApproveAckText: null,
    attachedToConsequentialTool: false,
    ...overrides,
  };
}

describe('validateHitlGateDraft', () => {
  it('passes a fully-specified draft (R-H1)', () => {
    expect(validateHitlGateDraft(makeDraft())).toEqual([]);
  });

  it.each([
    ['triggerCondition', { triggerCondition: undefined }],
    ['gateType', { gateType: undefined }],
    ['reviewerGroupId', { reviewerGroupId: undefined }],
    ['slaSeconds', { slaSeconds: undefined }],
    ['holdTreatmentText', { holdTreatmentText: '  ' }],
    ['timeoutBehavior', { timeoutBehavior: undefined }],
  ])('rejects a draft missing %s (R-H1 — no partially-specified gate)', (_name, patch) => {
    const issues = validateHitlGateDraft(makeDraft(patch as Partial<HitlGateDraftForValidation>));
    expect(issues).toContainEqual({ code: 'HITL_GATE_INCOMPLETE' });
  });

  it('rejects a non-positive SLA', () => {
    const issues = validateHitlGateDraft(makeDraft({ slaSeconds: 0 }));
    expect(issues).toContainEqual({ code: 'HITL_GATE_INCOMPLETE' });
  });

  it('rejects an unsupported v1 gate type (whisper/post_hoc)', () => {
    const issues = validateHitlGateDraft(makeDraft({ gateType: 'whisper' }));
    expect(issues).toContainEqual({ code: 'HITL_GATE_INCOMPLETE', field: 'gate_type' });
  });

  it('requires a written acknowledgement for auto_approve on a consequential tool (V-8)', () => {
    const issues = validateHitlGateDraft(
      makeDraft({ timeoutBehavior: 'auto_approve', attachedToConsequentialTool: true, autoApproveAckText: null }),
    );
    expect(issues).toContainEqual({ code: 'HITL_AUTO_APPROVE_ACK_REQUIRED' });
  });

  it('passes auto_approve on a consequential tool once acknowledged (V-8)', () => {
    const issues = validateHitlGateDraft(
      makeDraft({ timeoutBehavior: 'auto_approve', attachedToConsequentialTool: true, autoApproveAckText: 'Reviewed and accepted.' }),
    );
    expect(issues).toEqual([]);
  });

  it('does not require an acknowledgement for auto_approve on a non-consequential attachment', () => {
    const issues = validateHitlGateDraft(
      makeDraft({ timeoutBehavior: 'auto_approve', attachedToConsequentialTool: false, autoApproveAckText: null }),
    );
    expect(issues).toEqual([]);
  });
});
