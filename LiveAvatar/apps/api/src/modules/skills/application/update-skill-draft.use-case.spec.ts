import type { TenantRepositoryPort } from '../../tenants';
import type { SkillRepositoryPort } from '../domain/ports';
import type { SkillWithVersionsRecord } from '../domain/skill';
import { UpdateSkillDraftUseCase } from './update-skill-draft.use-case';

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
    draftVersion: null,
    publishedVersion: null,
    ...overrides,
  };
}

describe('UpdateSkillDraftUseCase', () => {
  let tenants: jest.Mocked<TenantRepositoryPort>;
  let skills: jest.Mocked<SkillRepositoryPort>;
  let useCase: UpdateSkillDraftUseCase;
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
      publishDraft: jest.fn(),
      delete: jest.fn(),
      agentUsageCounts: jest.fn().mockResolvedValue(new Map()),
      listPublishedByTenant: jest.fn().mockResolvedValue([]),
      findPublishedVersion: jest.fn(),
      findPublishedVersionBody: jest.fn(),
    };
    useCase = new UpdateSkillDraftUseCase(tenants, skills);
  });

  it('404s an unknown tenant', async () => {
    tenants.findById.mockResolvedValue(null);
    await expect(useCase.execute(actor, 'tenant-1', 'skill-1', {})).rejects.toMatchObject({ code: 'TENANT_NOT_FOUND' });
  });

  it('404s a skill unknown to this tenant', async () => {
    skills.findById.mockResolvedValue(null);
    await expect(useCase.execute(actor, 'tenant-1', 'skill-1', {})).rejects.toMatchObject({ code: 'SKILL_NOT_FOUND' });
  });

  it('rejects an empty name patch', async () => {
    await expect(useCase.execute(actor, 'tenant-1', 'skill-1', { name: '  ' })).rejects.toMatchObject({ code: 'SKILL_NAME_REQUIRED' });
    expect(skills.updateDraft).not.toHaveBeenCalled();
  });

  it('maps knowledge_filters snake_case wire fields to the domain camelCase shape', async () => {
    skills.updateDraft.mockResolvedValue(makeSkillWithVersions());

    await useCase.execute(actor, 'tenant-1', 'skill-1', { knowledge_filters: { source_refs: ['source-1'], top_k: 3, min_score: 0.75 } });

    expect(skills.updateDraft).toHaveBeenCalledWith(
      'tenant-1',
      'skill-1',
      { knowledgeFilters: { sourceRefs: ['source-1'], topK: 3, minScore: 0.75 } },
      'admin-1',
    );
  });

  it('only patches fields explicitly present in the request', async () => {
    skills.updateDraft.mockResolvedValue(makeSkillWithVersions());
    await useCase.execute(actor, 'tenant-1', 'skill-1', { description: 'new desc' });
    expect(skills.updateDraft).toHaveBeenCalledWith('tenant-1', 'skill-1', { description: 'new desc' }, 'admin-1');
  });

  it('404s when the repository reports the skill went missing mid-update', async () => {
    skills.updateDraft.mockResolvedValue('missing');
    await expect(useCase.execute(actor, 'tenant-1', 'skill-1', { description: 'x' })).rejects.toMatchObject({ code: 'SKILL_NOT_FOUND' });
  });
});
