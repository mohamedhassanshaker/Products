import { describe, expect, it, vi } from 'vitest';
import type { DataSource } from 'typeorm';
import { TenantScopeService } from './tenant-scope';
import { DomainError, InternalDomainError } from '@/server/common/errors/domain-error';
import { getRequestContext } from '@/server/context';
import type { PlatformTenantRepository, ResolvedTenant } from '@/server/platform/tenants';

/** Unit coverage for `TenantScopeService` — ported test cases from
 * `legacy/api/src/tenancy/tenant-scope.service.spec.ts`, translated to vitest and adapted for this
 * app's own `runFor(tenantId, (dataSource) => ...)` callback signature (a `DataSource`, not an
 * `EntityManager` — see this class's own doc comment for why). */
function fakeDataSource(): DataSource {
  return {} as unknown as DataSource;
}

describe('TenantScopeService', () => {
  it('throws TENANT_NOT_FOUND for an unknown tenant id, without ever touching the registry', async () => {
    const tenantRepo = { findResolvableById: vi.fn().mockResolvedValue(null) } as unknown as PlatformTenantRepository;
    const registry = { acquire: vi.fn(), release: vi.fn() } as unknown as ConstructorParameters<typeof TenantScopeService>[1];
    const svc = new TenantScopeService(tenantRepo, registry);

    await expect(svc.runFor('missing', async () => 'x')).rejects.toMatchObject({ code: 'TENANT_NOT_FOUND' });
    expect(registry.acquire).not.toHaveBeenCalled();
  });

  it.each(['Provisioning', 'Suspended', 'Failed'] as const)(
    'throws TENANT_UNAVAILABLE for a non-Active tenant (status=%s)',
    async (status) => {
      const tenant: ResolvedTenant = { id: 't1', subdomainSlug: 'acme', schemaName: 't_acme', status };
      const tenantRepo = { findResolvableById: vi.fn().mockResolvedValue(tenant) } as unknown as PlatformTenantRepository;
      const registry = { acquire: vi.fn(), release: vi.fn() } as unknown as ConstructorParameters<typeof TenantScopeService>[1];
      const svc = new TenantScopeService(tenantRepo, registry);

      await expect(svc.runFor('t1', async () => 'x')).rejects.toMatchObject({ code: 'TENANT_UNAVAILABLE' });
      expect(registry.acquire).not.toHaveBeenCalled();
    },
  );

  it('runs fn with the tenant DataSource bound into the ALS context, then releases in a finally', async () => {
    const tenant: ResolvedTenant = { id: 't1', subdomainSlug: 'acme', schemaName: 't_acme_9f3b21ac', status: 'Active' };
    const ds = fakeDataSource();
    const tenantRepo = { findResolvableById: vi.fn().mockResolvedValue(tenant) } as unknown as PlatformTenantRepository;
    const registry = {
      acquire: vi.fn().mockResolvedValue(ds),
      release: vi.fn(),
    } as unknown as ConstructorParameters<typeof TenantScopeService>[1];
    const svc = new TenantScopeService(tenantRepo, registry);

    const result = await svc.runFor('t1', async (dataSource) => {
      expect(dataSource).toBe(ds);
      expect(getRequestContext()?.tenantId).toBe('t1');
      expect(getRequestContext()?.tenantSchema).toBe('t_acme_9f3b21ac');
      return 'done';
    });

    expect(result).toBe('done');
    expect(registry.acquire).toHaveBeenCalledWith('t_acme_9f3b21ac');
    expect(registry.release).toHaveBeenCalledWith('t_acme_9f3b21ac');
  });

  it('releases the DataSource even when fn throws, and preserves a thrown DomainError as-is', async () => {
    const tenant: ResolvedTenant = { id: 't1', subdomainSlug: 'acme', schemaName: 't_acme', status: 'Active' };
    const tenantRepo = { findResolvableById: vi.fn().mockResolvedValue(tenant) } as unknown as PlatformTenantRepository;
    const registry = {
      acquire: vi.fn().mockResolvedValue(fakeDataSource()),
      release: vi.fn(),
    } as unknown as ConstructorParameters<typeof TenantScopeService>[1];
    const svc = new TenantScopeService(tenantRepo, registry);

    await expect(
      svc.runFor('t1', async () => {
        throw new DomainError('QUESTION_NOT_FOUND', 'nope');
      }),
    ).rejects.toMatchObject({ code: 'QUESTION_NOT_FOUND' });
    expect(registry.release).toHaveBeenCalledWith('t_acme');
  });

  it('wraps a raw thrown error from fn as an InternalDomainError rather than leaking it', async () => {
    const tenant: ResolvedTenant = { id: 't1', subdomainSlug: 'acme', schemaName: 't_acme', status: 'Active' };
    const tenantRepo = { findResolvableById: vi.fn().mockResolvedValue(tenant) } as unknown as PlatformTenantRepository;
    const registry = {
      acquire: vi.fn().mockResolvedValue(fakeDataSource()),
      release: vi.fn(),
    } as unknown as ConstructorParameters<typeof TenantScopeService>[1];
    const svc = new TenantScopeService(tenantRepo, registry);

    await expect(
      svc.runFor('t1', async () => {
        throw new Error('raw driver failure');
      }),
    ).rejects.toBeInstanceOf(InternalDomainError);
    expect(registry.release).toHaveBeenCalledWith('t_acme');
  });
});
