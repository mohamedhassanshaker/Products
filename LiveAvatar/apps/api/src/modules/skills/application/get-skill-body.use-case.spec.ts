import type { ToolDefinitionRepositoryPort } from '../../tools';
import type { SkillRepositoryPort, SkillBodyRecord } from '../domain/ports';
import { GetSkillBodyUseCase } from './get-skill-body.use-case';

function makeBody(overrides: Partial<SkillBodyRecord> = {}): SkillBodyRecord {
  return {
    skillId: 'skill-1',
    tenantId: 'tenant-1',
    versionNumber: 1,
    name: 'Refunds',
    description: 'Handle refunds',
    instructions: 'Do the refund thing',
    triggerMode: 'model',
    tools: ['issue_refund'],
    knowledgeFilters: { sourceRefs: ['source-1'] },
    budgetMs: 1500,
    ...overrides,
  };
}

describe('GetSkillBodyUseCase', () => {
  let skills: jest.Mocked<SkillRepositoryPort>;
  let toolDefs: jest.Mocked<ToolDefinitionRepositoryPort>;
  let useCase: GetSkillBodyUseCase;

  beforeEach(() => {
    skills = {
      listByTenant: jest.fn(),
      findById: jest.fn(),
      findBySlug: jest.fn(),
      create: jest.fn(),
      updateDraft: jest.fn(),
      publishDraft: jest.fn(),
      delete: jest.fn(),
      agentUsageCounts: jest.fn(),
      listPublishedByTenant: jest.fn(),
      findPublishedVersion: jest.fn(),
      findPublishedVersionBody: jest.fn(),
    };
    toolDefs = {
      listByTenant: jest.fn(),
      listEnabledByApiRefs: jest.fn().mockResolvedValue([]),
      findById: jest.fn(),
      findByApiRef: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };
    useCase = new GetSkillBodyUseCase(skills, toolDefs);
  });

  it('404s an unpublished/unknown version', async () => {
    skills.findPublishedVersionBody.mockResolvedValue(null);
    await expect(useCase.execute('skill-1', 1)).rejects.toMatchObject({ code: 'SKILL_VERSION_NOT_FOUND' });
  });

  it('resolves tool_definitions using the skill\'s own tenantId — never a caller-supplied one (no cross-tenant leak vector)', async () => {
    skills.findPublishedVersionBody.mockResolvedValue(makeBody({ tenantId: 'the-real-tenant' }));
    toolDefs.listEnabledByApiRefs.mockResolvedValue([
      { id: 't1', tenantId: 'the-real-tenant', apiRef: 'issue_refund', name: 'Issue refund', description: 'desc', method: 'POST', url: 'https://x.example.com', credentialRef: null, requiresCredential: false, argsSchema: {}, enabled: true, consequential: false, autonomousUseAckText: null, lane: 'foreground', perSessionCap: null, perTurnCap: null, timeoutMs: 10000, createdAt: new Date(), updatedAt: new Date() },
    ]);

    const result = await useCase.execute('skill-1', 1);

    expect(toolDefs.listEnabledByApiRefs).toHaveBeenCalledWith('the-real-tenant', ['issue_refund']);
    expect(result.tool_definitions).toHaveLength(1);
    expect(result.tool_definitions[0].api_ref).toBe('issue_refund');
  });

  it('skips the tool-resolution call entirely when the skill has no tools', async () => {
    skills.findPublishedVersionBody.mockResolvedValue(makeBody({ tools: [] }));
    await useCase.execute('skill-1', 1);
    expect(toolDefs.listEnabledByApiRefs).not.toHaveBeenCalled();
  });

  it('returns the full body shape (instructions/knowledge_filters/budget_ms) — this is the progressive-disclosure lazy fetch', async () => {
    skills.findPublishedVersionBody.mockResolvedValue(makeBody());
    const result = await useCase.execute('skill-1', 1);
    expect(result).toMatchObject({
      id: 'skill-1',
      version: 1,
      name: 'Refunds',
      description: 'Handle refunds',
      instructions: 'Do the refund thing',
      trigger_mode: 'model',
      knowledge_filters: { source_refs: ['source-1'] },
      budget_ms: 1500,
    });
  });
});
