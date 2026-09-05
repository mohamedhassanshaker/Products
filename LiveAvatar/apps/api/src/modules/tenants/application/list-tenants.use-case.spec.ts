import type { AdminActor } from '../../../common/auth/admin-actor';
import type { TenantRepositoryPort } from '../domain/ports';
import { ListTenantsUseCase } from './list-tenants.use-case';

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

describe('ListTenantsUseCase', () => {
  let repo: jest.Mocked<TenantRepositoryPort>;
  let useCase: ListTenantsUseCase;

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
    useCase = new ListTenantsUseCase(repo);
  });

  it('passes tenantIds:null for an operator (sees all)', async () => {
    repo.list.mockResolvedValue({ items: [record], total: 1 });
    const result = await useCase.execute(operator, {});
    expect(repo.list).toHaveBeenCalledWith(expect.objectContaining({ tenantIds: null }));
    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(result.page).toBe(1);
    expect(result.page_size).toBe(25);
  });

  it('scopes an admin to their assigned tenant ids', async () => {
    repo.list.mockResolvedValue({ items: [], total: 0 });
    await useCase.execute(scopedAdmin, {});
    expect(repo.list).toHaveBeenCalledWith(expect.objectContaining({ tenantIds: ['tenant-1'] }));
  });

  it('returns an empty list rather than an error for an unassigned admin', async () => {
    repo.list.mockResolvedValue({ items: [], total: 0 });
    const result = await useCase.execute({ ...scopedAdmin, tenantIds: [] }, {});
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('rejects page_size over 100', async () => {
    await expect(useCase.execute(operator, { page_size: 101 })).rejects.toMatchObject({
      code: 'PAGE_SIZE_INVALID',
      httpStatus: 400,
    });
  });

  it('rejects page_size below 1', async () => {
    await expect(useCase.execute(operator, { page_size: 0 })).rejects.toMatchObject({
      code: 'PAGE_SIZE_INVALID',
    });
  });

  it('defaults page to 1 for a non-positive value', async () => {
    repo.list.mockResolvedValue({ items: [], total: 0 });
    await useCase.execute(operator, { page: 0 });
    expect(repo.list).toHaveBeenCalledWith(expect.objectContaining({ page: 1 }));
  });

  it('forwards q and status filters', async () => {
    repo.list.mockResolvedValue({ items: [], total: 0 });
    await useCase.execute(operator, { q: 'acme', status: 'paused', page: 2, page_size: 10 });
    expect(repo.list).toHaveBeenCalledWith(
      expect.objectContaining({ q: 'acme', status: 'paused', page: 2, pageSize: 10 }),
    );
  });
});
