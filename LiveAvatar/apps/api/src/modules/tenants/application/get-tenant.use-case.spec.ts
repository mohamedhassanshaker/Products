import type { AdminActor } from '../../../common/auth/admin-actor';
import type { TenantRepositoryPort } from '../domain/ports';
import { GetTenantUseCase } from './get-tenant.use-case';

const record = {
  id: 'tenant-1',
  name: 'Acme',
  slug: 'acme',
  status: 'active' as const,
  roomNamespace: 'acme',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  providerStackSummary: 'Not configured',
};

const operator: AdminActor = { id: 'admin-1', email: 'op@example.com', roles: ['operator'], tenantIds: [] };
const scopedAdmin: AdminActor = {
  id: 'admin-2',
  email: 'admin@example.com',
  roles: ['admin'],
  tenantIds: ['tenant-1'],
};
const otherAdmin: AdminActor = {
  id: 'admin-3',
  email: 'other@example.com',
  roles: ['admin'],
  tenantIds: ['tenant-99'],
};

describe('GetTenantUseCase', () => {
  let repo: jest.Mocked<TenantRepositoryPort>;
  let useCase: GetTenantUseCase;

  beforeEach(() => {
    repo = {
      create: jest.fn(),
      findById: jest.fn(),
      findBySlug: jest.fn(),
      count: jest.fn(),
      list: jest.fn(),
      updateName: jest.fn(),
      updateStatus: jest.fn(),
    };
    useCase = new GetTenantUseCase(repo);
  });

  it('returns the tenant for an operator', async () => {
    repo.findById.mockResolvedValue(record);
    const result = await useCase.execute(operator, 'tenant-1');
    expect(result.id).toBe('tenant-1');
  });

  it('returns the tenant for an assigned admin', async () => {
    repo.findById.mockResolvedValue(record);
    const result = await useCase.execute(scopedAdmin, 'tenant-1');
    expect(result.id).toBe('tenant-1');
  });

  it('returns 404 (never 403) for an unassigned admin', async () => {
    repo.findById.mockResolvedValue(record);
    await expect(useCase.execute(otherAdmin, 'tenant-1')).rejects.toMatchObject({
      code: 'TENANT_NOT_FOUND',
      httpStatus: 404,
    });
  });

  it('returns 404 for an unknown id', async () => {
    repo.findById.mockResolvedValue(null);
    await expect(useCase.execute(operator, 'missing')).rejects.toMatchObject({
      code: 'TENANT_NOT_FOUND',
    });
  });
});
