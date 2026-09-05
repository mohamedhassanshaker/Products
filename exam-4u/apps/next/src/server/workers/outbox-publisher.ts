import { randomUUID } from 'node:crypto';
import type pino from 'pino';
import { getTenantDataSourceRegistry } from '@/server/infrastructure/database';
import { getTenantsService, type TenantSummary } from '@/server/platform/tenants';
import { runWithRequestContext } from '@/server/context';
import { OutboxRepository, OutboxPublisherService, LoggingAuditTrailConsumer } from '@/server/reliability';
import { logger } from '@/server/logging';

/** Mirrors `TenantsService.list`'s own page-size cap — bounds a single sweep pass's query size. */
const FULL_SWEEP_PAGE_SIZE = 100;

/**
 * `ROLE=worker`'s outbox sweep — this dispatch's composition root tying `reliability`'s per-tenant
 * `OutboxPublisherService` to `platform/tenants` (enumerate every `Active` tenant) and
 * `infrastructure/database`'s tenant `DataSource` registry (acquire/release each tenant's pooled
 * connection), the orchestration legacy's `OutboxPublisher.runFullSweep` performed itself via
 * `TenantScopeService.runFor`. Split out of `server/reliability` specifically because it crosses
 * module boundaries (`reliability` + `platform/tenants` + `infrastructure/database` + `context`) that
 * a bounded-context module has no business owning itself — this file is a plain composition
 * root/entrypoint (like `scripts/provision-demo-tenant.ts`), not a module other code imports from, so
 * it carries no ESLint module-boundary rule of its own.
 *
 * **Only the full-sweep safety net is built this dispatch** (no hinted sweep/`tenant_work_hint`
 * table — see `server/reliability`'s own doc comment for why) — every `Active` tenant is visited on
 * every tick (`WORKER_OUTBOX_TICK_MS`), tolerant of any single tenant's failure (logged, never
 * aborts the rest of the sweep, matching legacy's identical resilience convention).
 */
export async function runOutboxFullSweep(workerId: string): Promise<void> {
  const tenants = await getTenantsService();
  const registry = getTenantDataSourceRegistry();

  let page = 1;
  for (;;) {
    const { items } = await tenants.list({ status: 'Active', page, pageSize: FULL_SWEEP_PAGE_SIZE });
    if (items.length === 0) break;

    for (const tenant of items) {
      await processTenant(tenant, workerId, registry, logger).catch((err) => {
        logger.error({ err, tenantId: tenant.id }, 'outbox_full_sweep_tenant_failed');
      });
    }

    if (items.length < FULL_SWEEP_PAGE_SIZE) break;
    page += 1;
  }
}

/** Acquires `tenant`'s pooled `DataSource`, binds an ALS request-context matching what
 * `withTenantContext` would establish for an HTTP request (so any future consumer that reads
 * `getRequestContext()` inside a handler sees a consistent shape either way), runs one
 * `processTenantBatch` pass, then always releases the acquired `DataSource` — mirrors
 * `auth-rbac-platform.integration.test.ts`'s own `withRealTenantScope` helper, this app's
 * established pattern for tenant-scoped code that isn't driven by a real `NextRequest`. */
async function processTenant(
  tenant: TenantSummary,
  workerId: string,
  registry: ReturnType<typeof getTenantDataSourceRegistry>,
  log: pino.Logger,
): Promise<void> {
  const dataSource = await registry.acquire(tenant.schemaName);
  try {
    await runWithRequestContext(
      {
        requestId: randomUUID(),
        tenantId: tenant.id,
        tenantSlug: tenant.subdomainSlug,
        tenantSchema: tenant.schemaName,
        tenantDataSource: dataSource,
      },
      async () => {
        const outbox = new OutboxRepository(dataSource);
        const publisher = new OutboxPublisherService(outbox, [new LoggingAuditTrailConsumer(log)], log);
        const result = await publisher.processTenantBatch(workerId);
        if (result.claimed > 0) {
          log.info({ tenantId: tenant.id, ...result }, 'outbox_tenant_batch_processed');
        }
      },
    );
  } finally {
    registry.release(tenant.schemaName);
  }
}
