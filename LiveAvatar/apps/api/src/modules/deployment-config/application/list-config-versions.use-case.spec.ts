import type { TenantRepositoryPort } from '../../tenants';
import type { ConfigVersionRepositoryPort } from '../domain/ports';
import { ListConfigVersionsUseCase } from './list-config-versions.use-case';

const actor = { id: 'admin-1', email: 'a@b.com', roles: ['operator'], tenantIds: [] };

function makeTenant(overrides: Record<string, unknown> = {}) {
  return { id: 'tenant-1', name: 'Acme', slug: 'acme', ...overrides };
}

function makeVersion(overrides: Record<string, unknown> = {}) {
  return {
    id: 'version-1',
    tenantId: 'tenant-1',
    versionNumber: 1,
    yamlText: 'version: 1',
    status: 'published' as const,
    publishedAt: new Date('2026-01-01T00:00:00.000Z'),
    createdBy: 'admin-1',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    rolledBackFrom: null,
    ...overrides,
  };
}

describe('ListConfigVersionsUseCase', () => {
  function make(tenant: unknown = makeTenant(), versions: unknown[] = []) {
    const tenants = { findById: jest.fn().mockResolvedValue(tenant) } as unknown as jest.Mocked<TenantRepositoryPort>;
    const versionsRepo = { listByTenantId: jest.fn().mockResolvedValue(versions) } as unknown as jest.Mocked<ConfigVersionRepositoryPort>;
    const useCase = new ListConfigVersionsUseCase(tenants, versionsRepo);
    return { useCase, tenants, versionsRepo };
  }

  it('404s an unknown tenant', async () => {
    const { useCase } = make(null);
    await expect(useCase.execute(actor, 'tenant-1')).rejects.toMatchObject({ code: 'TENANT_NOT_FOUND' });
  });

  it('404s (not 403) an admin not assigned to this tenant', async () => {
    const { useCase } = make(makeTenant());
    const unassigned = { ...actor, roles: ['admin'], tenantIds: ['other-tenant'] };
    await expect(useCase.execute(unassigned, 'tenant-1')).rejects.toMatchObject({ code: 'TENANT_NOT_FOUND' });
  });

  it('returns an empty list for a tenant with no published versions yet', async () => {
    const { useCase, versionsRepo } = make(makeTenant(), []);
    const result = await useCase.execute(actor, 'tenant-1');
    expect(versionsRepo.listByTenantId).toHaveBeenCalledWith('tenant-1');
    expect(result).toEqual({ versions: [] });
  });

  it('maps every version row to its wire DTO', async () => {
    const { useCase } = make(makeTenant(), [makeVersion()]);
    const result = await useCase.execute(actor, 'tenant-1');
    expect(result.versions).toEqual([
      {
        version_number: 1,
        status: 'published',
        published_at: new Date('2026-01-01T00:00:00.000Z').toISOString(),
        created_by: 'admin-1',
        rolled_back_from: null,
      },
    ]);
  });

  it('resolves rolled_back_from to the source version\'s versionNumber, not its raw id', async () => {
    const source = makeVersion({ id: 'version-1', versionNumber: 1, status: 'rolled_back' });
    const rollback = makeVersion({ id: 'version-2', versionNumber: 2, rolledBackFrom: 'version-1' });
    const { useCase } = make(makeTenant(), [rollback, source]);
    const result = await useCase.execute(actor, 'tenant-1');
    const rollbackDto = result.versions.find((v) => v.version_number === 2);
    expect(rollbackDto?.rolled_back_from).toBe(1);
  });

  it('resolves rolled_back_from to null when the source version id is unresolvable (defensive)', async () => {
    const rollback = makeVersion({ id: 'version-2', versionNumber: 2, rolledBackFrom: 'version-does-not-exist' });
    const { useCase } = make(makeTenant(), [rollback]);
    const result = await useCase.execute(actor, 'tenant-1');
    expect(result.versions[0].rolled_back_from).toBeNull();
  });
});
