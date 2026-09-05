import type { TenantRepositoryPort } from '../../tenants';
import type { ToolDefinitionRepositoryPort } from '../../tools';
import type { HitlGateRepositoryPort } from '../../hitl';
import type { SkillRepositoryPort } from '../domain/ports';
import type { SkillVersionRecord, SkillWithVersionsRecord } from '../domain/skill';
import { PublishSkillUseCase } from './publish-skill.use-case';

function makeTenant(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tenant-1',
    name: 'Acme',
    slug: 'acme',
    status: 'active' as const,
    roomNamespace: 'acme',
    createdAt: new Date(),
    updatedAt: new Date(),
    providerStackSummary: 'Not configured',
    ...overrides,
  };
}

function makeDraft(overrides: Partial<SkillVersionRecord> = {}): SkillVersionRecord {
  return {
    id: 'v1',
    skillId: 'skill-1',
    versionNumber: 1,
    description: 'Handle refunds',
    instructions: 'Do the refund thing',
    triggerMode: 'model',
    tools: [],
    knowledgeFilters: { sourceRefs: [] },
    budgetMs: 1500,
    hitlGateId: null,
    environments: ['dev', 'staging', 'production'],
    status: 'draft',
    publishedAt: null,
    createdBy: 'admin-1',
    createdAt: new Date(),
    ...overrides,
  };
}

function makeSkillWithVersions(overrides: Partial<SkillWithVersionsRecord> = {}): SkillWithVersionsRecord {
  return {
    id: 'skill-1',
    tenantId: 'tenant-1',
    platformPublished: false,
    name: 'Refunds',
    slug: 'refunds',
    currentPublishedVersionId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    draftVersion: makeDraft(),
    publishedVersion: null,
    ...overrides,
  };
}

describe('PublishSkillUseCase', () => {
  let tenants: jest.Mocked<TenantRepositoryPort>;
  let skills: jest.Mocked<SkillRepositoryPort>;
  let toolDefs: jest.Mocked<ToolDefinitionRepositoryPort>;
  let hitlGates: jest.Mocked<HitlGateRepositoryPort>;
  let useCase: PublishSkillUseCase;
  const actor = { id: 'admin-1', email: 'a@b.com', roles: ['operator'], tenantIds: [] };

  beforeEach(() => {
    tenants = {
      create: jest.fn(),
      findById: jest.fn().mockResolvedValue(makeTenant()),
      findBySlug: jest.fn(),
      count: jest.fn(),
      list: jest.fn(),
      updateName: jest.fn(),
      updateStatus: jest.fn(),
    };
    skills = {
      listByTenant: jest.fn(),
      findById: jest.fn().mockResolvedValue(makeSkillWithVersions()),
      findBySlug: jest.fn(),
      create: jest.fn(),
      updateDraft: jest.fn(),
      publishDraft: jest.fn().mockResolvedValue(makeSkillWithVersions({ draftVersion: null, publishedVersion: makeDraft({ status: 'published' }) })),
      delete: jest.fn(),
      agentUsageCounts: jest.fn().mockResolvedValue(new Map()),
      listPublishedByTenant: jest.fn().mockResolvedValue([]),
      findPublishedVersion: jest.fn(),
      findPublishedVersionBody: jest.fn(),
    };
    toolDefs = {
      listByTenant: jest.fn().mockResolvedValue([]),
      listEnabledByApiRefs: jest.fn().mockResolvedValue([]),
      findById: jest.fn(),
      findByApiRef: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };
    hitlGates = {
      listByTenant: jest.fn().mockResolvedValue([]),
      findById: jest.fn(),
      findByIdAnyTenant: jest.fn(),
      findByAttachment: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };
    useCase = new PublishSkillUseCase(tenants, skills, toolDefs, hitlGates);
  });

  it('404s an unknown tenant', async () => {
    tenants.findById.mockResolvedValue(null);
    await expect(useCase.execute(actor, 'tenant-1', 'skill-1')).rejects.toMatchObject({ code: 'TENANT_NOT_FOUND' });
  });

  it('404s a skill unknown to this tenant', async () => {
    skills.findById.mockResolvedValue(null);
    await expect(useCase.execute(actor, 'tenant-1', 'skill-1')).rejects.toMatchObject({ code: 'SKILL_NOT_FOUND' });
  });

  it('rejects publishing with no pending draft', async () => {
    skills.findById.mockResolvedValue(makeSkillWithVersions({ draftVersion: null }));
    await expect(useCase.execute(actor, 'tenant-1', 'skill-1')).rejects.toMatchObject({ code: 'SKILL_INSTRUCTIONS_REQUIRED' });
    expect(skills.publishDraft).not.toHaveBeenCalled();
  });

  it('422s (never publishes) when the draft has an empty description', async () => {
    skills.findById.mockResolvedValue(makeSkillWithVersions({ draftVersion: makeDraft({ description: '' }) }));
    await expect(useCase.execute(actor, 'tenant-1', 'skill-1')).rejects.toMatchObject({ code: 'SKILL_DESCRIPTION_REQUIRED', httpStatus: 422 });
    expect(skills.publishDraft).not.toHaveBeenCalled();
  });

  it('422s when the draft references an unknown tool api_ref', async () => {
    skills.findById.mockResolvedValue(makeSkillWithVersions({ draftVersion: makeDraft({ tools: ['unknown_tool'] }) }));
    toolDefs.listByTenant.mockResolvedValue([]);
    await expect(useCase.execute(actor, 'tenant-1', 'skill-1')).rejects.toMatchObject({ code: 'SKILL_TOOL_REF_UNKNOWN' });
    expect(skills.publishDraft).not.toHaveBeenCalled();
  });

  it('publishes a valid draft whose tool refs all resolve', async () => {
    skills.findById.mockResolvedValue(makeSkillWithVersions({ draftVersion: makeDraft({ tools: ['issue_refund'] }) }));
    toolDefs.listByTenant.mockResolvedValue([
      { id: 't1', tenantId: 'tenant-1', apiRef: 'issue_refund', name: 'Issue refund', description: null, method: 'POST', url: 'https://x', credentialRef: null, requiresCredential: false, argsSchema: {}, enabled: true, consequential: false, autonomousUseAckText: null, lane: 'foreground', perSessionCap: null, perTurnCap: null, timeoutMs: 10000, createdAt: new Date(), updatedAt: new Date() },
    ]);

    const result = await useCase.execute(actor, 'tenant-1', 'skill-1');

    expect(skills.publishDraft).toHaveBeenCalledWith('tenant-1', 'skill-1');
    expect(result.skill.published_version?.status).toBe('published');
  });

  it('404s when the repository reports no-draft at publish time (race)', async () => {
    skills.publishDraft.mockResolvedValue('no-draft');
    await expect(useCase.execute(actor, 'tenant-1', 'skill-1')).rejects.toMatchObject({ code: 'SKILL_NOT_FOUND' });
  });
});
