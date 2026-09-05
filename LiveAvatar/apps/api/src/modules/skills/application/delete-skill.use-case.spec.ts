import type { TenantRepositoryPort } from '../../tenants';
import type { SkillRepositoryPort } from '../domain/ports';
import type { SkillWithVersionsRecord } from '../domain/skill';
import { DeleteSkillUseCase } from './delete-skill.use-case';

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

describe('DeleteSkillUseCase', () => {
  let tenants: jest.Mocked<TenantRepositoryPort>;
  let skills: jest.Mocked<SkillRepositoryPort>;
  let useCase: DeleteSkillUseCase;
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
      delete: jest.fn().mockResolvedValue(true),
      agentUsageCounts: jest.fn().mockResolvedValue(new Map()),
      listPublishedByTenant: jest.fn().mockResolvedValue([]),
      findPublishedVersion: jest.fn(),
      findPublishedVersionBody: jest.fn(),
    };
    useCase = new DeleteSkillUseCase(tenants, skills);
  });

  it('404s an unknown tenant', async () => {
    tenants.findById.mockResolvedValue(null);
    await expect(useCase.execute(actor, 'tenant-1', 'skill-1')).rejects.toMatchObject({ code: 'TENANT_NOT_FOUND' });
  });

  it('404s a skill unknown to this tenant, never calling delete', async () => {
    skills.findById.mockResolvedValue(null);
    await expect(useCase.execute(actor, 'tenant-1', 'skill-1')).rejects.toMatchObject({ code: 'SKILL_NOT_FOUND' });
    expect(skills.delete).not.toHaveBeenCalled();
  });

  it('deletes, scoped to the tenant', async () => {
    await useCase.execute(actor, 'tenant-1', 'skill-1');
    expect(skills.delete).toHaveBeenCalledWith('tenant-1', 'skill-1');
  });
});
