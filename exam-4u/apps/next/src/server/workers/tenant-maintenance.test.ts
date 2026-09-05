import { describe, expect, it, vi } from 'vitest';
import type pino from 'pino';
import type { DataSource } from 'typeorm';
import { TenantMaintenanceWorker } from './tenant-maintenance';
import type { PlatformTenantRepository } from '@/server/platform/tenants';
import type { TenantProvisioningService } from '@/server/platform/provisioning';
import type { TenantScopeService } from '@/server/tenancy';
import type { TenantHygieneService } from '@/server/reliability';

/** Unit coverage for `TenantMaintenanceWorker` — ported test cases from
 * `legacy/api/src/tenancy/provisioning/tenant-maintenance.worker.spec.ts`, translated to vitest and
 * adapted for this app's own per-tenant `hygieneFactory` construction (see the class's own doc
 * comment for why a single shared `TenantHygieneService` instance isn't used here). This dispatch's
 * own exit-gate items ("sweep tolerant-of-one-tenant-failing behavior") are proven directly below. */
function makeWorker(overrides?: {
  stuck?: { id: string }[];
  retry?: ReturnType<typeof vi.fn>;
  active?: { id: string }[];
  purgeEligible?: { id: string }[];
  pruneExpiredResetTokens?: ReturnType<typeof vi.fn>;
  drainFileCleanupQueue?: ReturnType<typeof vi.fn>;
}) {
  const tenantRepo = {
    findStuckProvisioning: vi.fn().mockResolvedValue(overrides?.stuck ?? []),
    findMany: vi.fn().mockResolvedValue({ items: overrides?.active ?? [], total: (overrides?.active ?? []).length }),
    findPurgeEligible: vi.fn().mockResolvedValue(overrides?.purgeEligible ?? []),
  } as unknown as PlatformTenantRepository;

  const provisioningService = {
    retry: overrides?.retry ?? vi.fn().mockResolvedValue(undefined),
  } as unknown as TenantProvisioningService;

  const tenantScope = {
    runFor: vi.fn().mockImplementation(async (_tenantId: string, fn: (ds: DataSource) => Promise<void>) => fn({} as DataSource)),
  } as unknown as TenantScopeService;

  const hygiene = {
    pruneExpiredResetTokens: overrides?.pruneExpiredResetTokens ?? vi.fn().mockResolvedValue(0),
    drainFileCleanupQueue: overrides?.drainFileCleanupQueue ?? vi.fn().mockResolvedValue(0),
  } as unknown as TenantHygieneService;
  const hygieneFactory = vi.fn().mockReturnValue(hygiene);

  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as pino.Logger;

  const worker = new TenantMaintenanceWorker(tenantRepo, provisioningService, tenantScope, hygieneFactory, 300_000, logger);
  return { worker, tenantRepo, provisioningService, tenantScope, hygiene, hygieneFactory, logger };
}

describe('TenantMaintenanceWorker', () => {
  describe('sweepStuckProvisioning', () => {
    it('does nothing and returns empty lists when no tenant is stuck', async () => {
      const { worker, provisioningService } = makeWorker({ stuck: [] });
      const result = await worker.sweepStuckProvisioning();
      expect(result).toEqual({ attempted: [], stillFailing: [] });
      expect(provisioningService.retry).not.toHaveBeenCalled();
    });

    it('queries the repository using the configured provisioningHeartbeatStaleMs threshold', async () => {
      const { worker, tenantRepo } = makeWorker();
      await worker.sweepStuckProvisioning();
      expect(tenantRepo.findStuckProvisioning).toHaveBeenCalledWith(300_000);
    });

    it('retries every stuck tenant and reports success', async () => {
      const { worker, provisioningService } = makeWorker({ stuck: [{ id: 'tenant-1' }, { id: 'tenant-2' }] });

      const result = await worker.sweepStuckProvisioning();

      expect(provisioningService.retry).toHaveBeenCalledWith('tenant-1');
      expect(provisioningService.retry).toHaveBeenCalledWith('tenant-2');
      expect(result).toEqual({ attempted: ['tenant-1', 'tenant-2'], stillFailing: [] });
    });

    it("one tenant's retry failing never stops the sweep from attempting the rest, and is reported in stillFailing", async () => {
      const retry = vi
        .fn()
        .mockRejectedValueOnce(new Error('still broken'))
        .mockResolvedValueOnce(undefined);
      const { worker, logger } = makeWorker({ stuck: [{ id: 'tenant-1' }, { id: 'tenant-2' }], retry });

      const result = await worker.sweepStuckProvisioning();

      expect(retry).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ attempted: ['tenant-1', 'tenant-2'], stillFailing: ['tenant-1'] });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 'tenant-1' }),
        'tenant_maintenance_provisioning_retry_failed',
      );
    });
  });

  describe('sweepTenantHygiene', () => {
    it('runs both hygiene duties, inside tenant scope, for every Active tenant', async () => {
      const pruneExpiredResetTokens = vi.fn().mockResolvedValue(3);
      const drainFileCleanupQueue = vi.fn().mockResolvedValue(2);
      const { worker, tenantScope, hygieneFactory } = makeWorker({
        active: [{ id: 't1' }, { id: 't2' }],
        pruneExpiredResetTokens,
        drainFileCleanupQueue,
      });

      const result = await worker.sweepTenantHygiene();

      expect(tenantScope.runFor).toHaveBeenCalledWith('t1', expect.any(Function));
      expect(tenantScope.runFor).toHaveBeenCalledWith('t2', expect.any(Function));
      expect(hygieneFactory).toHaveBeenCalledTimes(2); // a fresh TenantHygieneService per tenant
      expect(pruneExpiredResetTokens).toHaveBeenCalledTimes(2);
      expect(drainFileCleanupQueue).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ prunedResetTokens: 6, deletedFiles: 4, tenantsVisited: 2 });
    });

    it("one tenant's hygiene pass failing never stops the sweep from visiting the rest", async () => {
      const tenantScope = {
        runFor: vi
          .fn()
          .mockRejectedValueOnce(new Error('tenant scope boom'))
          .mockImplementationOnce(async (_id: string, fn: (ds: DataSource) => Promise<void>) => fn({} as DataSource)),
      };
      const hygiene = {
        pruneExpiredResetTokens: vi.fn().mockResolvedValue(1),
        drainFileCleanupQueue: vi.fn().mockResolvedValue(1),
      };
      const tenantRepo = {
        findMany: vi.fn().mockResolvedValue({ items: [{ id: 't1' }, { id: 't2' }], total: 2 }),
      } as unknown as PlatformTenantRepository;
      const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as pino.Logger;

      const worker = new TenantMaintenanceWorker(
        tenantRepo,
        {} as TenantProvisioningService,
        tenantScope as unknown as TenantScopeService,
        vi.fn().mockReturnValue(hygiene),
        300_000,
        logger,
      );

      const result = await worker.sweepTenantHygiene();

      expect(result.tenantsVisited).toBe(2);
      expect(result.prunedResetTokens).toBe(1); // Only the second tenant's pass actually ran.
      expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1' }), 'tenant_maintenance_hygiene_failed');
    });

    it('pages past the first 100 Active tenants rather than silently capping', async () => {
      const page1 = Array.from({ length: 100 }, (_, i) => ({ id: `t${i}` }));
      const page2 = [{ id: 't100' }];
      const findMany = vi
        .fn()
        .mockResolvedValueOnce({ items: page1, total: 101 })
        .mockResolvedValueOnce({ items: page2, total: 101 });
      const tenantRepo = { findMany } as unknown as PlatformTenantRepository;
      const tenantScope = {
        runFor: vi.fn().mockImplementation(async (_id: string, fn: (ds: DataSource) => Promise<void>) => fn({} as DataSource)),
      } as unknown as TenantScopeService;
      const hygiene = { pruneExpiredResetTokens: vi.fn().mockResolvedValue(0), drainFileCleanupQueue: vi.fn().mockResolvedValue(0) };
      const worker = new TenantMaintenanceWorker(
        tenantRepo,
        {} as TenantProvisioningService,
        tenantScope,
        vi.fn().mockReturnValue(hygiene),
        300_000,
        { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as pino.Logger,
      );

      const result = await worker.sweepTenantHygiene();

      expect(findMany).toHaveBeenCalledTimes(2);
      expect(findMany).toHaveBeenNthCalledWith(1, { status: 'Active', page: 1, pageSize: 100 });
      expect(findMany).toHaveBeenNthCalledWith(2, { status: 'Active', page: 2, pageSize: 100 });
      expect(result.tenantsVisited).toBe(101);
    });
  });

  describe('listPurgeEligibleTenants', () => {
    it('returns the ids of every purge-eligible tenant, never acting on them', async () => {
      const { worker, tenantRepo } = makeWorker({ purgeEligible: [{ id: 'gone-1' }, { id: 'gone-2' }] });
      const result = await worker.listPurgeEligibleTenants();
      expect(result).toEqual(['gone-1', 'gone-2']);
      expect(tenantRepo.findPurgeEligible).toHaveBeenCalledTimes(1);
    });
  });
});
