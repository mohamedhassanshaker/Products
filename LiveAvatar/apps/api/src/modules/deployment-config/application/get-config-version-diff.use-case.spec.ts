import type { TenantRepositoryPort } from '../../tenants';
import type { ConfigVersionRepositoryPort } from '../domain/ports';
import { GetConfigVersionDiffUseCase } from './get-config-version-diff.use-case';

const actor = { id: 'admin-1', email: 'a@b.com', roles: ['operator'], tenantIds: [] };

function makeTenant(overrides: Record<string, unknown> = {}) {
  return { id: 'tenant-1', name: 'Acme', slug: 'acme', ...overrides };
}

function makeVersion(overrides: Record<string, unknown> = {}) {
  return {
    id: 'version-1',
    tenantId: 'tenant-1',
    versionNumber: 1,
    yamlText: 'a\nb',
    status: 'published' as const,
    publishedAt: new Date('2026-01-01T00:00:00.000Z'),
    createdBy: 'admin-1',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    rolledBackFrom: null,
    ...overrides,
  };
}

describe('GetConfigVersionDiffUseCase', () => {
  function make(tenant: unknown = makeTenant()) {
    const tenants = { findById: jest.fn().mockResolvedValue(tenant) } as unknown as jest.Mocked<TenantRepositoryPort>;
    const versionsRepo = { findByTenantAndVersion: jest.fn() } as unknown as jest.Mocked<ConfigVersionRepositoryPort>;
    const useCase = new GetConfigVersionDiffUseCase(tenants, versionsRepo);
    return { useCase, tenants, versionsRepo };
  }

  it('404s an unknown tenant', async () => {
    const { useCase } = make(null);
    await expect(useCase.execute(actor, 'tenant-1', 1, 2)).rejects.toMatchObject({ code: 'TENANT_NOT_FOUND' });
  });

  it('404s (not 403) an admin not assigned to this tenant', async () => {
    const { useCase } = make(makeTenant());
    const unassigned = { ...actor, roles: ['admin'], tenantIds: ['other-tenant'] };
    await expect(useCase.execute(unassigned, 'tenant-1', 1, 2)).rejects.toMatchObject({ code: 'TENANT_NOT_FOUND' });
  });

  it('404s CONFIG_VERSION_NOT_FOUND when the `from` version does not exist', async () => {
    const { useCase, versionsRepo } = make();
    versionsRepo.findByTenantAndVersion.mockImplementation(async (_tenantId, versionNumber) =>
      versionNumber === 1 ? null : makeVersion({ versionNumber: 2 }),
    );
    await expect(useCase.execute(actor, 'tenant-1', 1, 2)).rejects.toMatchObject({ code: 'CONFIG_VERSION_NOT_FOUND' });
  });

  it('404s CONFIG_VERSION_NOT_FOUND when the `to` version does not exist', async () => {
    const { useCase, versionsRepo } = make();
    versionsRepo.findByTenantAndVersion.mockImplementation(async (_tenantId, versionNumber) =>
      versionNumber === 1 ? makeVersion({ versionNumber: 1 }) : null,
    );
    await expect(useCase.execute(actor, 'tenant-1', 1, 2)).rejects.toMatchObject({ code: 'CONFIG_VERSION_NOT_FOUND' });
  });

  it('computes a line-level diff between the two versions\' yamlText and echoes from/to', async () => {
    const { useCase, versionsRepo } = make();
    versionsRepo.findByTenantAndVersion.mockImplementation(async (_tenantId, versionNumber) =>
      versionNumber === 1 ? makeVersion({ versionNumber: 1, yamlText: 'a\nb' }) : makeVersion({ versionNumber: 2, yamlText: 'a\nc' }),
    );
    const result = await useCase.execute(actor, 'tenant-1', 1, 2);
    expect(result.from).toBe(1);
    expect(result.to).toBe(2);
    expect(result.lines).toEqual([
      { op: 'equal', text: 'a' },
      { op: 'remove', text: 'b' },
      { op: 'add', text: 'c' },
    ]);
  });

  it('returns an all-equal diff when both versions are byte-identical', async () => {
    const { useCase, versionsRepo } = make();
    versionsRepo.findByTenantAndVersion.mockResolvedValue(makeVersion({ yamlText: 'same\ntext' }));
    const result = await useCase.execute(actor, 'tenant-1', 3, 4);
    expect(result.lines.every((l) => l.op === 'equal')).toBe(true);
  });
});
