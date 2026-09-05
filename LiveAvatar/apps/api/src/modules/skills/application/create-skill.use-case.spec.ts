import type { TenantRepositoryPort } from '../../tenants';
import type { SkillRepositoryPort } from '../domain/ports';
import type { SkillWithVersionsRecord } from '../domain/skill';
import { CreateSkillUseCase } from './create-skill.use-case';

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
    draftVersion: {
      id: 'v1',
      skillId: 'skill-1',
      versionNumber: 1,
      description: '',
      instructions: '',
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
    },
    publishedVersion: null,
    ...overrides,
  };
}

describe('CreateSkillUseCase', () => {
  let tenants: jest.Mocked<TenantRepositoryPort>;
  let skills: jest.Mocked<SkillRepositoryPort>;
  let useCase: CreateSkillUseCase;
  const actor = { id: 'admin-1', email: 'a@b.com', roles: ['operator'], tenantIds: [] };

  beforeEach(() => {
    tenants = {
      create: jest.fn(),
      findById: jest.fn(),
      findBySlug: jest.fn(),
      count: jest.fn(),
      list: jest.fn(),
      updateName: jest.fn(),
      updateStatus: jest.fn(),
    };
    skills = {
      listByTenant: jest.fn(),
      findById: jest.fn(),
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
    useCase = new CreateSkillUseCase(tenants, skills);
  });

  it('404s an unknown tenant', async () => {
    tenants.findById.mockResolvedValue(null);
    await expect(useCase.execute(actor, 'tenant-1', { name: 'Refunds' })).rejects.toMatchObject({ code: 'TENANT_NOT_FOUND' });
  });

  it('403s an admin not assigned to the tenant', async () => {
    tenants.findById.mockResolvedValue(makeTenant());
    const unassigned = { ...actor, roles: ['admin'], tenantIds: ['other-tenant'] };
    await expect(useCase.execute(unassigned, 'tenant-1', { name: 'Refunds' })).rejects.toMatchObject({ code: 'TENANT_FORBIDDEN' });
  });

  it('rejects an empty name', async () => {
    tenants.findById.mockResolvedValue(makeTenant());
    await expect(useCase.execute(actor, 'tenant-1', { name: '  ' })).rejects.toMatchObject({ code: 'SKILL_NAME_REQUIRED' });
  });

  it('derives a hyphenated slug from the name', async () => {
    tenants.findById.mockResolvedValue(makeTenant());
    skills.findBySlug.mockResolvedValue(null);
    skills.create.mockResolvedValue(makeSkillWithVersions());

    await useCase.execute(actor, 'tenant-1', { name: 'Order Tracking' });

    expect(skills.findBySlug).toHaveBeenCalledWith('tenant-1', 'order-tracking');
    expect(skills.create).toHaveBeenCalledWith(expect.objectContaining({ slug: 'order-tracking' }));
  });

  it('rejects a duplicate slug for the tenant', async () => {
    tenants.findById.mockResolvedValue(makeTenant());
    skills.findBySlug.mockResolvedValue({ id: 'skill-existing', tenantId: 'tenant-1', platformPublished: false, name: 'Refunds', slug: 'refunds', currentPublishedVersionId: null, createdAt: new Date(), updatedAt: new Date() });
    await expect(useCase.execute(actor, 'tenant-1', { name: 'Refunds' })).rejects.toMatchObject({ code: 'SKILL_SLUG_EXISTS', httpStatus: 409 });
  });

  it('creates a skill with defaults applied when optional fields are omitted', async () => {
    tenants.findById.mockResolvedValue(makeTenant());
    skills.findBySlug.mockResolvedValue(null);
    skills.create.mockResolvedValue(makeSkillWithVersions());

    const result = await useCase.execute(actor, 'tenant-1', { name: 'Refunds' });

    expect(skills.create).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        name: 'Refunds',
        description: '',
        instructions: '',
        triggerMode: 'model',
        tools: [],
        budgetMs: 1500,
        environments: ['dev', 'staging', 'production'],
        createdBy: 'admin-1',
      }),
    );
    expect(result.used_by_agent_count).toBe(0);
  });

  it('passes through caller-supplied content fields', async () => {
    tenants.findById.mockResolvedValue(makeTenant());
    skills.findBySlug.mockResolvedValue(null);
    skills.create.mockResolvedValue(makeSkillWithVersions());

    await useCase.execute(actor, 'tenant-1', {
      name: 'Refunds',
      description: 'Handle refunds',
      instructions: 'Do the thing',
      trigger_mode: 'router',
      tools: ['issue_refund'],
      knowledge_filters: { source_refs: ['source-1'], top_k: 3, min_score: 0.75 },
      budget_ms: 2000,
      environments: ['production'],
    });

    expect(skills.create).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'Handle refunds',
        instructions: 'Do the thing',
        triggerMode: 'router',
        tools: ['issue_refund'],
        knowledgeFilters: { sourceRefs: ['source-1'], topK: 3, minScore: 0.75 },
        budgetMs: 2000,
        environments: ['production'],
      }),
    );
  });
});
