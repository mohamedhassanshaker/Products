import { validateSkillDraftForPublish } from './skill-validation';

describe('validateSkillDraftForPublish', () => {
  const validDraft = {
    description: 'Handle refunds',
    instructions: 'Do the refund thing',
    tools: ['issue_refund'],
    hitlGateId: null as string | null,
  };

  it('passes a fully-specified draft with known tool refs and no attached gate', () => {
    expect(validateSkillDraftForPublish(validDraft, new Set(['issue_refund']), new Set())).toEqual([]);
  });

  it('rejects an empty description', () => {
    const issues = validateSkillDraftForPublish({ ...validDraft, description: '  ' }, new Set(['issue_refund']), new Set());
    expect(issues).toContainEqual({ code: 'SKILL_DESCRIPTION_REQUIRED' });
  });

  it('rejects empty instructions', () => {
    const issues = validateSkillDraftForPublish({ ...validDraft, instructions: '' }, new Set(['issue_refund']), new Set());
    expect(issues).toContainEqual({ code: 'SKILL_INSTRUCTIONS_REQUIRED' });
  });

  it('rejects a tool ref that does not exist for the tenant, attaching the ref as the field', () => {
    const issues = validateSkillDraftForPublish(validDraft, new Set(), new Set());
    expect(issues).toContainEqual({ code: 'SKILL_TOOL_REF_UNKNOWN', field: 'issue_refund' });
  });

  it('passes a draft with a gate id that resolves against the known set (Phase 14)', () => {
    const issues = validateSkillDraftForPublish({ ...validDraft, hitlGateId: 'gate-1' }, new Set(['issue_refund']), new Set(['gate-1']));
    expect(issues).toEqual([]);
  });

  it('rejects a gate id that does not resolve for the tenant (Phase 14)', () => {
    const issues = validateSkillDraftForPublish({ ...validDraft, hitlGateId: 'gate-missing' }, new Set(['issue_refund']), new Set());
    expect(issues).toContainEqual({ code: 'CONFIG_HITL_GATE_UNKNOWN', field: 'gate-missing' });
  });

  it('reports every violated rule, not just the first', () => {
    const issues = validateSkillDraftForPublish(
      { description: '', instructions: '', tools: ['unknown_tool'], hitlGateId: 'gate-missing' },
      new Set(),
      new Set(),
    );
    expect(issues).toHaveLength(4);
  });
});
