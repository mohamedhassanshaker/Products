import type { DataSource } from 'typeorm';
import { InternalDomainError } from '@/server/common/errors/domain-error';
import { getRequestContext } from './request-context';

/**
 * Returns the current request's tenant-scoped `DataSource` — ported equivalent of legacy's
 * `TenantContextService.requireDataSource()`. The only intended way tenant-scoped repositories
 * (`auth`/`rbac`) obtain a `DataSource`: never import `server/infrastructure/database` directly for
 * per-request tenant access, always go through this function so a raw `DataSource` never leaks into
 * business logic outside a resolved tenant scope.
 *
 * @throws {InternalDomainError} if called outside {@link import('./with-tenant-context').withTenantContext}'s
 *   ALS binding (a programmer error — every tenant-scoped Route Handler must be wrapped in
 *   `withTenantContext` before calling any repository that needs this).
 */
export function requireTenantDataSource(): DataSource {
  const ds = getRequestContext()?.tenantDataSource;
  if (!ds) {
    throw new InternalDomainError(
      new Error('requireTenantDataSource() called outside any resolved tenant scope.'),
    );
  }
  return ds;
}

/**
 * Returns the current request's resolved tenant id — ported equivalent of reading
 * `getRequestContext()?.tenantId` directly, wrapped so every call site gets the identical
 * "unreachable in practice" defensive error rather than each one re-deriving its own message.
 *
 * @throws {InternalDomainError} if called outside a resolved tenant scope.
 */
export function requireTenantId(): string {
  const tenantId = getRequestContext()?.tenantId;
  if (!tenantId) {
    throw new InternalDomainError(new Error('requireTenantId() called outside any resolved tenant scope.'));
  }
  return tenantId;
}
