import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { PlatformTenantRepository } from '@/server/platform/tenants';
import type { getTenantDataSourceRegistry } from '@/server/infrastructure/database';
import { getRequestContext, runWithRequestContext } from '@/server/context';
import { DomainError, InternalDomainError } from '@/server/common/errors/domain-error';

/** This module has no direct named export for the registry *class* (only its composition-root
 * function, `getTenantDataSourceRegistry`) — `ReturnType<>` mirrors `server/workers/outbox-publisher.ts`'s
 * own identical pattern for the same reason. */
type TenantDataSourceRegistry = ReturnType<typeof getTenantDataSourceRegistry>;

/**
 * Worker code's entry point into tenant scope — ported logic (not code) from
 * `legacy/api/src/tenancy/tenant-scope.service.ts`'s `TenantScopeService`. Distinct from
 * `middleware.ts`/`withTenantContext` (the **HTTP**-request tenant-resolution path, which resolves by
 * `Host` header): worker code already knows *which* tenant it's processing (e.g. a stuck-provisioning
 * tenant row, or the next `Active` tenant in a hygiene sweep), so this resolves by tenant id instead
 * and binds the same `RequestContext` ALS store `withTenantContext` would, so any code running inside
 * `runFor`'s callback that reads `getRequestContext()` sees a consistent shape either way.
 *
 * Only `Active` tenants may be entered — a worker picking up a stale job for a since-suspended/deleted
 * tenant fails loudly rather than silently operating on a tenant that should no longer be reachable.
 *
 * **Adapted for this app's constructor-DataSource repository convention**: legacy's `runFor` callback
 * received an `EntityManager` (legacy's repositories resolve their own `Repository` from the *ambient*
 * tenant `EntityManager` at call time). This app's repository classes are constructed with an
 * already-resolved `DataSource` instead (see `UserRepository`'s doc comment) — so this version's
 * callback receives the tenant's `DataSource` directly, and callers construct whatever
 * `DataSource`-backed repository/service they need *inside* the callback (exactly the pattern
 * `server/workers/outbox-publisher.ts`'s own `processTenant` helper already establishes for the
 * outbox sweep).
 */
export class TenantScopeService {
  constructor(
    private readonly tenantRepo: PlatformTenantRepository,
    private readonly registry: TenantDataSourceRegistry,
  ) {}

  /**
   * Runs `fn` with `tenantId`'s `DataSource` bound into the same `AsyncLocalStorage` context HTTP
   * requests use, releasing the pooled connection in a `finally` regardless of `fn`'s outcome.
   * @throws {DomainError} `TENANT_NOT_FOUND` if the tenant doesn't exist (or was soft-deleted);
   *   `TENANT_UNAVAILABLE` if it exists but isn't `Active`.
   */
  async runFor<T>(tenantId: string, fn: (dataSource: DataSource) => Promise<T>): Promise<T> {
    const tenant = await this.tenantRepo.findResolvableById(tenantId);
    if (!tenant) {
      throw new DomainError('TENANT_NOT_FOUND', `No such tenant: ${tenantId}`);
    }
    if (tenant.status !== 'Active') {
      throw new DomainError('TENANT_UNAVAILABLE', `Tenant ${tenantId} is not Active (status=${tenant.status}).`);
    }

    const dataSource = await this.registry.acquire(tenant.schemaName);
    try {
      const current = getRequestContext();
      return await runWithRequestContext(
        {
          ...current,
          requestId: current?.requestId ?? randomUUID(),
          tenantId: tenant.id,
          tenantSlug: tenant.subdomainSlug,
          tenantSchema: tenant.schemaName,
          tenantDataSource: dataSource,
        },
        () =>
          fn(dataSource).catch((err) => {
            throw err instanceof DomainError ? err : new InternalDomainError(err);
          }),
      );
    } finally {
      this.registry.release(tenant.schemaName);
    }
  }
}
