import type { TenantRepositoryPort } from '../../tenants';
import type { SkillRepositoryPort } from '../domain/ports';
import type { SkillWithVersionsRecord } from '../domain/skill';
import { ListSkillsUseCase } from './list-skills.use-case';

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

function makeSkill(overrides: Partial<SkillWithVersionsRecord> = {}): SkillWithVersionsRecord {
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

describe('ListSkillsUseCase', () => {
  let tenants: jest.Mocked<TenantRepositoryPort>;
  let skills: jest.Mocked<SkillRepositoryPort>;
  let useCase: ListSkillsUseCase;
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
      listByTenant: jest.fn().mockResolvedValue([]),
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
    useCase = new ListSkillsUseCase(tenants, skills);
  });

  it('404s an unknown tenant', async () => {
    tenants.findById.mockResolvedValue(null);
    await expect(useCase.execute(actor, 'tenant-1')).rejects.toMatchObject({ code: 'TENANT_NOT_FOUND' });
  });

  it('403s an admin not assigned to the tenant (never leaks another tenant\'s skills)', async () => {
    const unassigned = { ...actor, roles: ['admin'], tenantIds: ['other-tenant'] };
    await expect(useCase.execute(unassigned, 'tenant-1')).rejects.toMatchObject({ code: 'TENANT_FORBIDDEN' });
    expect(skills.listByTenant).not.toHaveBeenCalled();
  });

  it('always queries with the path tenant id, never a caller-supplied one', async () => {
    skills.listByTenant.mockResolvedValue([makeSkill(), makeSkill({ id: 'skill-2' })]);
    await useCase.execute(actor, 'tenant-1');
    expect(skills.listByTenant).toHaveBeenCalledWith('tenant-1');
  });

  it('attaches each skill\'s used_by_agent_count from one batched agentUsageCounts call', async () => {
    skills.listByTenant.mockResolvedValue([makeSkill(), makeSkill({ id: 'skill-2' })]);
    skills.agentUsageCounts.mockResolvedValue(new Map([['skill-1', 1]]));

    const result = await useCase.execute(actor, 'tenant-1');

    expect(skills.agentUsageCounts).toHaveBeenCalledTimes(1);
    expect(skills.agentUsageCounts).toHaveBeenCalledWith('tenant-1', ['skill-1', 'skill-2']);
    expect(result.items.find((i) => i.id === 'skill-1')?.used_by_agent_count).toBe(1);
    expect(result.items.find((i) => i.id === 'skill-2')?.used_by_agent_count).toBe(0);
  });
});
