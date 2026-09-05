import { Prisma } from '../../generated/prisma/client';
import { TenantContext } from '../tenancy/tenant-context';
import { TenantScopeViolationError } from '../errors/app-error';

/** Models that must always be filtered or written with tenant_id (FR-TENANT-5). */
const TENANT_SCOPED = new Set([
  'ProviderCredential',
  'DeploymentConfig',
  'DataResidencyPolicy',
  'AlertPolicy',
  'ToolDefinition',
  'Session',
  'TranscriptUtterance',
  'LatencyHop',
  'Feedback',
  'AlertEvent',
]);

const WRITE_OPS = new Set(['create', 'createMany', 'update', 'updateMany', 'delete', 'deleteMany', 'upsert']);

/**
 * Returns true when `where` already constrains tenantId.
 * @param where - Prisma where clause
 */
function whereHasTenantId(where: unknown): boolean {
  if (!where || typeof where !== 'object') {
    return false;
  }
  const w = where as Record<string, unknown>;
  if (w.tenantId !== undefined) {
    return true;
  }
  if (Array.isArray(w.AND)) {
    return w.AND.some((part) => whereHasTenantId(part));
  }
  return false;
}

/**
 * Prisma client extension that injects tenant_id from ALS or throws a server
 * defect when a tenant-scoped query is unscoped (FR-TENANT-5).
 */
export function createTenantGuardExtension() {
  return Prisma.defineExtension({
    name: 'tenantGuard',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!TENANT_SCOPED.has(model) || TenantContext.isBypassed()) {
            return query(args);
          }
          const scope = TenantContext.get();
          const tenantId = scope?.tenantId ?? null;
          const nextArgs = { ...(args as Record<string, unknown>) };

          if (operation === 'create') {
            const data = (nextArgs.data ?? {}) as Record<string, unknown>;
            if (!data.tenantId) {
              if (!tenantId) {
                throw new TenantScopeViolationError(model);
              }
              nextArgs.data = { ...data, tenantId };
            }
            return query(nextArgs);
          }

          if (operation === 'createMany') {
            const data = nextArgs.data as Record<string, unknown> | Record<string, unknown>[];
            const rows = Array.isArray(data) ? data : [data];
            if (rows.some((row) => !row?.tenantId) && !tenantId) {
              throw new TenantScopeViolationError(model);
            }
            return query(nextArgs);
          }

          const where = (nextArgs.where ?? {}) as Record<string, unknown>;
          if (!whereHasTenantId(where)) {
            if (!tenantId && WRITE_OPS.has(operation)) {
              throw new TenantScopeViolationError(model);
            }
            if (!tenantId && (operation.startsWith('find') || operation === 'count' || operation === 'aggregate')) {
              throw new TenantScopeViolationError(model);
            }
            if (tenantId) {
              nextArgs.where = { ...where, tenantId };
            }
          }
          return query(nextArgs);
        },
      },
    },
  });
}
