import type { AdminActor } from '../../../common/auth/admin-actor';
import type { TenantRepositoryPort } from '../domain/ports';
import { UpdateTenantUseCase } from './update-tenant.use-case';

const record = {
  id: 'tenant-1',
  name: 'Acme',
  slug: 'acme',
  status: 'active' as const,
  roomNamespace: 'acme',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  providerStackSummary: 'Not configured',
};

const operator: AdminActor = { id: 'admin-1', email: 'op@example.com', roles: ['operator'], tenantIds: [] };
const otherAdmin: AdminActor = {
  id: 'admin-3',
  email: 'other@example.com',
  roles: ['admin'],
  tenantIds: ['tenant-99'],
};

describe('UpdateTenantUseCase', () => {
  let repo: jest.Mocked<TenantRepositoryPort>;
  let useCase: UpdateTenantUseCase;

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
    useCase = new UpdateTenantUseCase(repo);
  });

  it('rejects any body containing a slug key, regardless of value', async () => {
    await expect(
      useCase.execute(operator, 'tenant-1', { slug: 'acme' }, record.updatedAt.toISOString()),
    ).rejects.toMatchObject({ code: 'TENANT_SLUG_IMMUTABLE', httpStatus: 400 });
    expect(repo.findById).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown tenant', async () => {
    repo.findById.mockResolvedValue(null);
    await expect(
      useCase.execute(operator, 'missing', { name: 'New' }, record.updatedAt.toISOString()),
    ).rejects.toMatchObject({ code: 'TENANT_NOT_FOUND', httpStatus: 404 });
  });

  it('returns 404 (never 403) for an unassigned admin — no existence leak (FR-TENANT-5)', async () => {
    repo.findById.mockResolvedValue(record);
    await expect(
      useCase.execute(otherAdmin, 'tenant-1', { name: 'New' }, record.updatedAt.toISOString()),
    ).rejects.toMatchObject({ code: 'TENANT_NOT_FOUND', httpStatus: 404 });
  });

  it('returns 409 on a malformed If-Match header', async () => {
    repo.findById.mockResolvedValue(record);
    await expect(
      useCase.execute(operator, 'tenant-1', { name: 'New' }, 'not-a-date'),
    ).rejects.toMatchObject({ code: 'TENANT_CONFLICT', httpStatus: 409 });
  });

  it('returns 409 when the repository reports a stale If-Match', async () => {
    repo.findById.mockResolvedValue(record);
    repo.updateName.mockResolvedValue('conflict');
    await expect(
      useCase.execute(operator, 'tenant-1', { name: 'New' }, record.updatedAt.toISOString()),
    ).rejects.toMatchObject({ code: 'TENANT_CONFLICT' });
  });

  it('returns 404 when the repository reports the row vanished mid-update', async () => {
    repo.findById.mockResolvedValue(record);
    repo.updateName.mockResolvedValue('missing');
    await expect(
      useCase.execute(operator, 'tenant-1', { name: 'New' }, record.updatedAt.toISOString()),
    ).rejects.toMatchObject({ code: 'TENANT_NOT_FOUND' });
  });

  it('updates the name and returns the DTO on success', async () => {
    repo.findById.mockResolvedValue(record);
    repo.updateName.mockResolvedValue({ ...record, name: 'New Name' });
    const result = await useCase.execute(
      operator,
      'tenant-1',
      { name: 'New Name' },
      record.updatedAt.toISOString(),
    );
    expect(result.name).toBe('New Name');
    expect(repo.updateName).toHaveBeenCalledWith('tenant-1', 'New Name', record.updatedAt);
  });

  it('keeps the existing name when name is omitted from the body', async () => {
    repo.findById.mockResolvedValue(record);
    repo.updateName.mockResolvedValue(record);
    await useCase.execute(operator, 'tenant-1', {}, record.updatedAt.toISOString());
    expect(repo.updateName).toHaveBeenCalledWith('tenant-1', record.name, record.updatedAt);
  });
});
