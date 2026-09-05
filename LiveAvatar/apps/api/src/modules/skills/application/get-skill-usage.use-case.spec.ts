import type { TenantRepositoryPort } from '../../tenants';
import type { SkillRepositoryPort } from '../domain/ports';
import type { SkillWithVersionsRecord } from '../domain/skill';
import { GetSkillUsageUseCase } from './get-skill-usage.use-case';

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

describe('GetSkillUsageUseCase', () => {
  let tenants: jest.Mocked<TenantRepositoryPort>;
  let skills: jest.Mocked<SkillRepositoryPort>;
  let useCase: GetSkillUsageUseCase;
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
      findById: jest.fn().mockResolvedValue(makeSkill()),
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
    useCase = new GetSkillUsageUseCase(tenants, skills);
  });

  it('404s a skill unknown to this tenant', async () => {
    skills.findById.mockResolvedValue(null);
    await expect(useCase.execute(actor, 'tenant-1', 'skill-1')).rejects.toMatchObject({ code: 'SKILL_NOT_FOUND' });
  });

  it("returns 0 when the skill isn't referenced by this tenant's agent", async () => {
    const result = await useCase.execute(actor, 'tenant-1', 'skill-1');
    expect(result).toEqual({ used_by_agent_count: 0 });
  });

  it('returns the resolved count from agentUsageCounts', async () => {
    skills.agentUsageCounts.mockResolvedValue(new Map([['skill-1', 1]]));
    const result = await useCase.execute(actor, 'tenant-1', 'skill-1');
    expect(result).toEqual({ used_by_agent_count: 1 });
  });
});
