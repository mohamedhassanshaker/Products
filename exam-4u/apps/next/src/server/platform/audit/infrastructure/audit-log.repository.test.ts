import { describe, expect, it, vi } from 'vitest';
import type { DataSource, Repository } from 'typeorm';
import { AuditLogRepository } from './audit-log.repository';
import type { AuditLogEntity } from '@/server/infrastructure/database';

function fakeDataSource(overrides: Partial<Record<keyof Repository<AuditLogEntity>, ReturnType<typeof vi.fn>>>): DataSource {
  const repo = { ...overrides } as unknown as Repository<AuditLogEntity>;
  return { getRepository: vi.fn().mockReturnValue(repo) } as unknown as DataSource;
}

/** Unit coverage for `AuditLogRepository` — ported test cases from `legacy/api/src/platform/audit/
 * infrastructure/repositories/audit-log.repository.spec.ts`, translated to vitest, plus new coverage
 * for `findMany` (this dispatch's own new Audit Log console read path, no legacy precedent). */
describe('AuditLogRepository', () => {
  it('append() creates a row with a generated id and defaults every optional field to null', async () => {
    const create = vi.fn((data) => data);
    const save = vi.fn((entity) => Promise.resolve(entity));
    const repo = new AuditLogRepository(fakeDataSource({ create, save }));

    await repo.append({ actorType: 'PlatformAdmin', action: 'tenant.create' });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.any(String),
        actorType: 'PlatformAdmin',
        actorId: null,
        tenantId: null,
        action: 'tenant.create',
        targetType: null,
        targetId: null,
        summary: null,
        ip: null,
      }),
    );
    expect(save).toHaveBeenCalled();
  });

  it('append() passes through every explicitly-provided optional field', async () => {
    const create = vi.fn((data) => data);
    const save = vi.fn((entity) => Promise.resolve(entity));
    const repo = new AuditLogRepository(fakeDataSource({ create, save }));

    await repo.append({
      actorType: 'PlatformAdmin',
      actorId: 'admin-1',
      tenantId: 'tenant-1',
      action: 'tenant.suspend',
      targetType: 'Tenant',
      targetId: 'tenant-1',
      summary: { statusAfter: 'Suspended' },
      ip: '127.0.0.1',
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'admin-1',
        tenantId: 'tenant-1',
        targetType: 'Tenant',
        targetId: 'tenant-1',
        summary: { statusAfter: 'Suspended' },
        ip: '127.0.0.1',
      }),
    );
  });

  it('findByTenant() queries by tenantId ordered ascending, projected to the wire shape', async () => {
    const createdAt = new Date('2026-08-15T00:00:00.000Z');
    const find = vi.fn().mockResolvedValue([
      {
        id: 'row-1',
        actorType: 'PlatformAdmin',
        actorId: 'admin-1',
        tenantId: 'tenant-1',
        action: 'tenant.suspend',
        targetType: 'Tenant',
        targetId: 'tenant-1',
        summary: null,
        ip: null,
        createdAt,
      },
    ]);
    const repo = new AuditLogRepository(fakeDataSource({ find }));

    const result = await repo.findByTenant('tenant-1');

    expect(find).toHaveBeenCalledWith({ where: { tenantId: 'tenant-1' }, order: { createdAt: 'ASC' } });
    expect(result).toEqual([
      {
        id: 'row-1',
        actorType: 'PlatformAdmin',
        actorId: 'admin-1',
        tenantId: 'tenant-1',
        action: 'tenant.suspend',
        targetType: 'Tenant',
        targetId: 'tenant-1',
        summary: null,
        ip: null,
        createdAt: createdAt.toISOString(),
      },
    ]);
  });

  it('findMany() builds an AND-combined where clause from only the supplied filters, paginated newest-first', async () => {
    const findAndCount = vi.fn().mockResolvedValue([[], 0]);
    const repo = new AuditLogRepository(fakeDataSource({ findAndCount }));

    await repo.findMany({ actorId: 'admin-1', action: 'tenant.suspend', page: 2, pageSize: 10 });

    expect(findAndCount).toHaveBeenCalledWith({
      where: { actorId: 'admin-1', action: 'tenant.suspend' },
      order: { createdAt: 'DESC' },
      skip: 10,
      take: 10,
    });
  });

  it('findMany() defaults to page 1 / pageSize 25 and caps pageSize at 100', async () => {
    const findAndCount = vi.fn().mockResolvedValue([[], 0]);
    const repo = new AuditLogRepository(fakeDataSource({ findAndCount }));

    await repo.findMany({ pageSize: 500 });

    expect(findAndCount).toHaveBeenCalledWith({ where: {}, order: { createdAt: 'DESC' }, skip: 0, take: 100 });
  });
});
