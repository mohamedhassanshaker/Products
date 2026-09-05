import { randomUUID } from 'node:crypto';
import { getEnv } from '@/server/config';
import { logger } from '@/server/logging';
import { runWithRequestContext } from '@/server/context';
import { getTenantsService, type TenantSummary } from '@/server/platform/tenants';
import { getTenantDataSourceRegistry } from '@/server/infrastructure/database';
import { StaleSessionRecoveryWorker, PdfProcessingSessionRepository, buildPdfProcessingService } from '@/server/pdf-processing';

/** Mirrors `server/workers/outbox-publisher.ts`'s own page-size cap — bounds a single sweep pass's
 * tenant-listing query size. */
const FULL_SWEEP_PAGE_SIZE = 100;

/**
 * `ROLE=worker`'s PDF stale-session-recovery sweep (migration plan Phase 6, sub-slice "6a") — this
 * dispatch's composition root tying `pdf-processing`'s `StaleSessionRecoveryWorker` to
 * `platform/tenants` (enumerate every `Active` tenant) and `infrastructure/database`'s tenant
 * `DataSource` registry (acquire/release each tenant's pooled connection) — the exact same
 * orchestration shape `server/workers/outbox-publisher.ts`/`server/workers/tenant-maintenance.ts`
 * already established for their own tenant-scoped sweeps, applied here to a third, independent
 * worker duty. Split out of `server/pdf-processing` for the identical reason `outbox-publisher.ts` is
 * split out of `server/reliability`: it crosses module boundaries (`pdf-processing` +
 * `platform/tenants` + `infrastructure/database` + `context`) that a bounded-context module has no
 * business owning itself. Plain composition-root/entrypoint file — carries no ESLint module-boundary
 * rule of its own.
 */
export async function runPdfStaleSessionRecoverySweep(workerId: string): Promise<void> {
  const tenants = await getTenantsService();
  const registry = getTenantDataSourceRegistry();

  let page = 1;
  for (;;) {
    const { items } = await tenants.list({ status: 'Active', page, pageSize: FULL_SWEEP_PAGE_SIZE });
    if (items.length === 0) break;

    for (const tenant of items) {
      await sweepTenant(tenant, workerId, registry).catch((err: unknown) => {
        logger.error({ err, tenantId: tenant.id }, 'pdf_stale_session_recovery_tenant_failed');
      });
    }

    if (items.length < FULL_SWEEP_PAGE_SIZE) break;
    page += 1;
  }
}

/** Acquires `tenant`'s pooled `DataSource`, binds an ALS request-context matching what
 * `withTenantContext` would establish, builds a fresh tenant-scoped `StaleSessionRecoveryWorker` +
 * `PdfProcessingService` pair (`buildPdfProcessingService`/`PdfProcessingSessionRepository`, both
 * re-exported by `server/pdf-processing`'s barrel for exactly this cross-module composition need — the
 * same "process-wide composition-root file constructs a fresh per-tenant instance" pattern
 * `TenantMaintenanceWorker`'s own `hygieneFactory` closure already established), runs one `sweepTenant`
 * pass, then always releases the acquired `DataSource`. */
async function sweepTenant(
  tenant: TenantSummary,
  workerId: string,
  registry: ReturnType<typeof getTenantDataSourceRegistry>,
): Promise<void> {
  const dataSource = await registry.acquire(tenant.schemaName);
  try {
    await runWithRequestContext(
      { requestId: randomUUID(), tenantId: tenant.id, tenantSlug: tenant.subdomainSlug, tenantSchema: tenant.schemaName, tenantDataSource: dataSource },
      async () => {
        const env = getEnv();
        const pdfProcessingService = buildPdfProcessingService(dataSource);
        const sessions = new PdfProcessingSessionRepository(dataSource);
        const worker = new StaleSessionRecoveryWorker(
          sessions,
          (sessionId) => pdfProcessingService.resumeProcessing(sessionId),
          env.SESSION_HEARTBEAT_STALE_MS,
          env.MAX_RESUME_ATTEMPTS,
          logger,
        );
        await worker.sweepTenant(workerId);
      },
    );
  } finally {
    registry.release(tenant.schemaName);
  }
}
