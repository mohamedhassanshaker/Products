import type { TenantRepositoryPort } from '../../tenants';
import type { SkillRepositoryPort } from '../domain/ports';
import type { SkillWithVersionsRecord } from '../domain/skill';
import { GetSkillUseCase } from './get-skill.use-case';

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

describe('GetSkillUseCase', () => {
  let tenants: jest.Mocked<TenantRepositoryPort>;
  let skills: jest.Mocked<SkillRepositoryPort>;
  let useCase: GetSkillUseCase;
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
    useCase = new GetSkillUseCase(tenants, skills);
  });

  it('404s an unknown tenant', async () => {
    tenants.findById.mockResolvedValue(null);
    await expect(useCase.execute(actor, 'tenant-1', 'skill-1')).rejects.toMatchObject({ code: 'TENANT_NOT_FOUND' });
  });

  it("404s a skill that exists but belongs to a different tenant (never leaks it as 403)", async () => {
    skills.findById.mockResolvedValue(null); // repository itself is tenant-scoped, so a cross-tenant id resolves to null
    await expect(useCase.execute(actor, 'tenant-1', 'skill-1')).rejects.toMatchObject({ code: 'SKILL_NOT_FOUND' });
    expect(skills.findById).toHaveBeenCalledWith('tenant-1', 'skill-1');
  });

  it('returns the skill with its resolved usage count', async () => {
    skills.findById.mockResolvedValue(makeSkill());
    skills.agentUsageCounts.mockResolvedValue(new Map([['skill-1', 1]]));

    const result = await useCase.execute(actor, 'tenant-1', 'skill-1');

    expect(result.used_by_agent_count).toBe(1);
  });
});
