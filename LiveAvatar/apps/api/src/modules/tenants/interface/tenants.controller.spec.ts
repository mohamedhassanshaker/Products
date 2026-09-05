import { TenantsController } from './tenants.controller';
import type { AdminActor } from '../../../common/auth/admin-actor';

const actor: AdminActor = { id: 'admin-1', email: 'a@b.com', roles: ['operator'], tenantIds: [] };

describe('TenantsController', () => {
  const createTenant = { execute: jest.fn() };
  const getTenant = { execute: jest.fn() };
  const listTenants = { execute: jest.fn() };
  const updateTenant = { execute: jest.fn() };
  const changeStatus = { execute: jest.fn() };

  const controller = new TenantsController(
    createTenant as never,
    getTenant as never,
    listTenants as never,
    updateTenant as never,
    changeStatus as never,
  );

  afterEach(() => jest.clearAllMocks());

  it('create delegates to CreateTenantUseCase', async () => {
    createTenant.execute.mockResolvedValue({ id: 'tenant-1' });
    const body = { name: 'Acme', slug: 'acme' };
    const result = await controller.create(body);
    expect(createTenant.execute).toHaveBeenCalledWith(body);
    expect(result).toEqual({ id: 'tenant-1' });
  });

  it('list delegates to ListTenantsUseCase with the actor', async () => {
    listTenants.execute.mockResolvedValue({ items: [], total: 0 });
    await controller.list(actor, { page: 1 });
    expect(listTenants.execute).toHaveBeenCalledWith(actor, { page: 1 });
  });

  it('get delegates to GetTenantUseCase', async () => {
    getTenant.execute.mockResolvedValue({ id: 'tenant-1' });
    await controller.get(actor, 'tenant-1');
    expect(getTenant.execute).toHaveBeenCalledWith(actor, 'tenant-1');
  });

  it('update delegates to UpdateTenantUseCase with the If-Match header', async () => {
    updateTenant.execute.mockResolvedValue({ id: 'tenant-1' });
    await controller.update(actor, 'tenant-1', { name: 'New' }, '2026-01-01T00:00:00.000Z');
    expect(updateTenant.execute).toHaveBeenCalledWith(
      actor,
      'tenant-1',
      { name: 'New' },
      '2026-01-01T00:00:00.000Z',
    );
  });

  it('changeTenantStatus delegates to ChangeTenantStatusUseCase', async () => {
    changeStatus.execute.mockResolvedValue({ id: 'tenant-1', status: 'paused' });
    await controller.changeTenantStatus(actor, 'tenant-1', { status: 'paused' });
    expect(changeStatus.execute).toHaveBeenCalledWith(actor, 'tenant-1', { status: 'paused' });
  });
});
