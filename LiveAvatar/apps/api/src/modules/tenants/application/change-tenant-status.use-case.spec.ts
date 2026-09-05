import type { AdminActor } from '../../../common/auth/admin-actor';
import type { TenantRepositoryPort } from '../domain/ports';
import { ChangeTenantStatusUseCase } from './change-tenant-status.use-case';

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
const otherAdmin: AdminActor = {
  id: 'admin-3',
  email: 'other@example.com',
  roles: ['admin'],
  tenantIds: ['tenant-99'],
};

describe('ChangeTenantStatusUseCase', () => {
  let repo: jest.Mocked<TenantRepositoryPort>;
  let useCase: ChangeTenantStatusUseCase;

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
    useCase = new ChangeTenantStatusUseCase(repo);
  });

  it('rejects an invalid status value', async () => {
    await expect(useCase.execute(operator, 'tenant-1', { status: 'disabled' })).rejects.toMatchObject({
      code: 'TENANT_STATUS_INVALID',
      httpStatus: 400,
    });
  });

  it('returns 404 for an unknown tenant', async () => {
    repo.findById.mockResolvedValue(null);
    await expect(useCase.execute(operator, 'missing', { status: 'paused' })).rejects.toMatchObject({
      code: 'TENANT_NOT_FOUND',
    });
  });

  it('returns 404 (never 403) for an unassigned admin — no existence leak (FR-TENANT-5)', async () => {
    repo.findById.mockResolvedValue(record);
    await expect(useCase.execute(otherAdmin, 'tenant-1', { status: 'paused' })).rejects.toMatchObject({
      code: 'TENANT_NOT_FOUND',
      httpStatus: 404,
    });
  });

  it('is an idempotent no-op (200, no repo write) when the status is unchanged', async () => {
    repo.findById.mockResolvedValue(record);
    const result = await useCase.execute(operator, 'tenant-1', { status: 'active' });
    expect(result.status).toBe('active');
    expect(repo.updateStatus).not.toHaveBeenCalled();
  });

  it('pauses an active tenant', async () => {
    repo.findById.mockResolvedValue(record);
    repo.updateStatus.mockResolvedValue({ ...record, status: 'paused' });
    const result = await useCase.execute(operator, 'tenant-1', { status: 'paused' });
    expect(result.status).toBe('paused');
    expect(repo.updateStatus).toHaveBeenCalledWith('tenant-1', 'paused');
  });

  it('returns 404 if the row vanishes between the read and the write', async () => {
    repo.findById.mockResolvedValue(record);
    repo.updateStatus.mockResolvedValue(null);
    await expect(useCase.execute(operator, 'tenant-1', { status: 'paused' })).rejects.toMatchObject({
      code: 'TENANT_NOT_FOUND',
    });
  });
});
