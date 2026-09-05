import { randomUUID } from 'node:crypto';
import { logger } from '@/server/logging';
import { runWithRequestContext } from '@/server/context';
import { getTenantsService, type TenantSummary } from '@/server/platform/tenants';
import { getTenantDataSourceRegistry } from '@/server/infrastructure/database';
import { buildAttemptTimeoutSweeper } from '@/server/attempts';

/** Mirrors `server/workers/outbox-publisher.ts`'s/`pdf-stale-session-recovery.ts`'s own page-size cap —
 * bounds a single sweep pass's tenant-listing query size. */
const FULL_SWEEP_PAGE_SIZE = 100;

/**
 * `ROLE=worker`'s attempt-timeout sweep (migration plan Phase 7, FR-TAKE-6) — this dispatch's
 * composition root tying `attempts`' `AttemptTimeoutSweeper` to `platform/tenants` (enumerate every
 * `Active` tenant) and `infrastructure/database`'s tenant `DataSource` registry (acquire/release each
 * tenant's pooled connection), the exact same orchestration shape
 * `server/workers/pdf-stale-session-recovery.ts`/`server/workers/outbox-publisher.ts` already
 * established for their own tenant-scoped sweeps, applied here to a fourth, independent worker duty.
 * Split out of `server/attempts` for the identical reason `pdf-stale-session-recovery.ts` is split out
 * of `server/pdf-processing`: it crosses module boundaries (`attempts` + `platform/tenants` +
 * `infrastructure/database` + `context`) that a bounded-context module has no business owning itself.
 * Plain composition-root/entrypoint file — carries no ESLint module-boundary rule of its own.
 */
export async function runAttemptTimeoutSweep(): Promise<void> {
  const tenants = await getTenantsService();
  const registry = getTenantDataSourceRegistry();

  let page = 1;
  for (;;) {
    const { items } = await tenants.list({ status: 'Active', page, pageSize: FULL_SWEEP_PAGE_SIZE });
    if (items.length === 0) break;

    for (const tenant of items) {
      await sweepTenant(tenant, registry).catch((err: unknown) => {
        logger.error({ err, tenantId: tenant.id }, 'attempt_timeout_sweeper_tenant_failed');
      });
    }

    if (items.length < FULL_SWEEP_PAGE_SIZE) break;
    page += 1;
  }
}

/** Acquires `tenant`'s pooled `DataSource`, binds an ALS request-context matching what
 * `withTenantContext` would establish, builds a fresh tenant-scoped `AttemptTimeoutSweeper`
 * (`buildAttemptTimeoutSweeper`, re-exported by `server/attempts`'s barrel for exactly this
 * cross-module composition need), runs one `sweepTenant` pass, then always releases the acquired
 * `DataSource`. */
async function sweepTenant(tenant: TenantSummary, registry: ReturnType<typeof getTenantDataSourceRegistry>): Promise<void> {
  const dataSource = await registry.acquire(tenant.schemaName);
  try {
    await runWithRequestContext(
      { requestId: randomUUID(), tenantId: tenant.id, tenantSlug: tenant.subdomainSlug, tenantSchema: tenant.schemaName, tenantDataSource: dataSource },
      async () => {
        const sweeper = buildAttemptTimeoutSweeper(dataSource, logger);
        const closed = await sweeper.sweepTenant();
        if (closed > 0) {
          logger.info({ tenantId: tenant.id, closed }, 'attempt_timeout_sweeper_closed');
        }
      },
    );
  } finally {
    registry.release(tenant.schemaName);
  }
}
