import type pino from 'pino';
import type { DataSource } from 'typeorm';
import { getTenantDataSourceRegistry, getPlatformDataSource } from '@/server/infrastructure/database';
import { getEnv } from '@/server/config';
import { logger } from '@/server/logging';
import { PlatformTenantRepository } from '@/server/platform/tenants';
import { getTenantProvisioningService, type TenantProvisioningService } from '@/server/platform/provisioning';
import { TenantScopeService } from '@/server/tenancy';
import { TenantHygieneService, FileCleanupRepository } from '@/server/reliability';
import { UserRepository } from '@/server/auth';
import { createStoragePort } from '@/server/infrastructure/storage';
import type { StoragePort } from '@/server/common/ports/storage.port';

/** Mirrors `TenantsService.list`'s own page-size cap — bounds a single hygiene-sweep pass's query
 * size, matching `server/workers/outbox-publisher.ts`'s identical paging convention. */
const HYGIENE_SWEEP_PAGE_SIZE = 100;

/**
 * `TenantMaintenanceWorker` (HLD §10.1) — ported logic (not code) from
 * `legacy/api/src/tenancy/provisioning/tenant-maintenance.worker.ts`. A plain class, unit-testable
 * with fakes (no `DataSource`/I/O of its own — everything crosses through its five injected
 * collaborators), constructed by this file's own composition root ({@link getTenantMaintenanceWorker})
 * and driven on its own tick by `server/workers/worker-entrypoint.ts` — mirrors
 * `server/reliability`'s `OutboxPublisherService` vs. `server/workers/outbox-publisher.ts` split (the
 * real, testable class lives near its own collaborators; the composition root that ties multiple
 * modules together lives in `server/workers/` as a plain, module-boundary-rule-free entrypoint file).
 *
 * Deliberately tolerant of a single tenant's failure in both sweep methods below: one stuck tenant
 * erroring again, or one tenant's hygiene pass throwing, must never stop the sweep from attempting
 * every other tenant in the same pass.
 */
export class TenantMaintenanceWorker {
  constructor(
    private readonly tenantRepo: PlatformTenantRepository,
    private readonly provisioningService: TenantProvisioningService,
    private readonly tenantScope: TenantScopeService,
    /** Builds a fresh, tenant-`DataSource`-bound {@link TenantHygieneService} — this app's own
     * per-tenant-construction adaptation of legacy's ambient-tenant-context design (see
     * `TenantHygieneService`'s own doc comment for the full reasoning). */
    private readonly hygieneFactory: (dataSource: DataSource) => TenantHygieneService,
    private readonly provisioningHeartbeatStaleMs: number,
    private readonly logger: pino.Logger,
  ) {}

  /**
   * Finds every tenant stuck in `Provisioning`/`Failed` with a stale (or never-set)
   * `provisioning_heartbeat_at` and retries each one via `TenantProvisioningService.retry`.
   *
   * @returns the ids of every tenant a retry was attempted for, and how many of those attempts
   *   themselves failed again.
   */
  async sweepStuckProvisioning(): Promise<{ attempted: string[]; stillFailing: string[] }> {
    const stuck = await this.tenantRepo.findStuckProvisioning(this.provisioningHeartbeatStaleMs);
    const attempted: string[] = [];
    const stillFailing: string[] = [];

    for (const tenant of stuck) {
      attempted.push(tenant.id);
      try {
        await this.provisioningService.retry(tenant.id);
        this.logger.info({ tenantId: tenant.id }, 'tenant_maintenance_provisioning_retry_succeeded');
      } catch (err) {
        stillFailing.push(tenant.id);
        this.logger.warn({ err, tenantId: tenant.id }, 'tenant_maintenance_provisioning_retry_failed');
      }
    }

    return { attempted, stillFailing };
  }

  /**
   * Runs `TenantHygieneService`'s two per-tenant duties for every `Active` tenant, tolerant of a
   * single tenant's failure exactly like {@link sweepStuckProvisioning}. Paged so this scales past
   * 100 tenants rather than silently capping at the first page.
   *
   * @returns per-tenant totals, purely for the caller's own logging/tests.
   */
  async sweepTenantHygiene(): Promise<{ prunedResetTokens: number; deletedFiles: number; tenantsVisited: number }> {
    let prunedResetTokens = 0;
    let deletedFiles = 0;
    let tenantsVisited = 0;
    let page = 1;

    for (;;) {
      const { items } = await this.tenantRepo.findMany({ status: 'Active', page, pageSize: HYGIENE_SWEEP_PAGE_SIZE });
      if (items.length === 0) break;

      for (const tenant of items) {
        tenantsVisited += 1;
        try {
          await this.tenantScope.runFor(tenant.id, async (dataSource) => {
            const hygiene = this.hygieneFactory(dataSource);
            prunedResetTokens += await hygiene.pruneExpiredResetTokens();
            deletedFiles += await hygiene.drainFileCleanupQueue();
          });
        } catch (err) {
          this.logger.error({ err, tenantId: tenant.id }, 'tenant_maintenance_hygiene_failed');
        }
      }

      if (items.length < HYGIENE_SWEEP_PAGE_SIZE) break;
      page += 1;
    }

    return { prunedResetTokens, deletedFiles, tenantsVisited };
  }

  /**
   * HLD §9/§10.1: lists (never acts on) tenants past their retention window — soft-deleted with
   * `purge_after_at` already elapsed. `TENANT_PURGE_ENABLED` (default `false`) gates whether anything
   * ever actually acts on this list; no code path in this app performs the actual purge — that remains
   * a Platform Admin's explicit, future action.
   */
  async listPurgeEligibleTenants(): Promise<string[]> {
    const tenants = await this.tenantRepo.findPurgeEligible();
    return tenants.map((t) => t.id);
  }
}

declare global {
  // eslint-disable-next-line no-var -- global augmentation requires `var`, not `const`/`let`.
  var __examlandTenantMaintenanceWorker: Promise<TenantMaintenanceWorker> | undefined;
}

/**
 * Composition root for {@link TenantMaintenanceWorker} — cached on `globalThis` for the same Next.js
 * dev-hot-reload reason every other async singleton in this app is. Builds every collaborator plainly
 * (no DI container): the platform-schema `PlatformTenantRepository`/`TenantScopeService` pair, the
 * already-built `TenantProvisioningService`, a `hygieneFactory` closure capturing the one process-wide
 * `StoragePort` (constructed once, matching `server/files`' own established `createStoragePort` call
 * site convention) so each per-tenant `TenantHygieneService` only needs a fresh `UserRepository`/
 * `FileCleanupRepository` pair, and the two config values (`PROVISIONING_HEARTBEAT_STALE_MS`) this
 * worker needs.
 */
export async function getTenantMaintenanceWorker(): Promise<TenantMaintenanceWorker> {
  if (!globalThis.__examlandTenantMaintenanceWorker) {
    globalThis.__examlandTenantMaintenanceWorker = (async () => {
      const env = getEnv();
      const [platformDataSource, provisioningService] = await Promise.all([
        getPlatformDataSource(),
        getTenantProvisioningService(),
      ]);

      const tenantRepo = new PlatformTenantRepository(platformDataSource);
      const registry = getTenantDataSourceRegistry();
      const tenantScope = new TenantScopeService(tenantRepo, registry);
      const storage: StoragePort = createStoragePort(env.STORAGE_DRIVER, env.STORAGE_ROOT);
      const hygieneFactory = (dataSource: DataSource): TenantHygieneService =>
        new TenantHygieneService(new UserRepository(dataSource), new FileCleanupRepository(dataSource), storage, logger);

      return new TenantMaintenanceWorker(
        tenantRepo,
        provisioningService,
        tenantScope,
        hygieneFactory,
        env.PROVISIONING_HEARTBEAT_STALE_MS,
        logger,
      );
    })();
  }
  return globalThis.__examlandTenantMaintenanceWorker;
}
