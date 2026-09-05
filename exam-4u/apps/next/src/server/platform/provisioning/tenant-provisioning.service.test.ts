import { describe, expect, it, vi } from 'vitest';
import type { PlatformTenantRepository, TenantsService, TenantSummary } from '@/server/platform/tenants';
import { TenantProvisioningFailedError, type ProvisioningContext, type ProvisioningStep } from '@/server/tenancy';
import type { TenantProvisioningLockService } from './tenant-provisioning-lock.service';
import type { TenantProvisioningStepRepository } from './tenant-provisioning-step.repository';
import { TenantProvisioningService } from './tenant-provisioning.service';

/**
 * Pure-logic unit tests for the provisioning orchestrator's step-sequencing/idempotency guarantees
 * (migration plan's "Per-phase verification" item 4) — every dependency is a hand-built fake, no real
 * database/HTTP involved. Mirrors the assertion intent of legacy's
 * `apps/api/src/tenancy/provisioning/tenant-provisioning.service.spec.ts` and
 * `apps/api/test/provisioning-workflow.e2e-spec.ts`'s unit-testable subset (the real end-to-end
 * proof against MySQL is this dispatch's separate `scripts/provision-demo-tenant.ts` run, not
 * re-derived here).
 */

const BASE_TENANT_ROW: {
  id: string;
  name: string;
  subdomainSlug: string;
  schemaName: string;
  pendingAdminEmail: string;
  status: 'Provisioning' | 'Active' | 'Suspended' | 'Failed';
} = {
  id: 'tenant-1',
  name: 'Acme',
  subdomainSlug: 'acme',
  schemaName: 't_acme_deadbeef',
  pendingAdminEmail: 'admin@acme.test',
  status: 'Provisioning',
};

/** Builds a fresh `TenantProvisioningStepRepository` fake backed by an in-memory ledger keyed on
 * `(tenantId, step)` — close enough to the real repository's natural-key-upsert behavior to exercise
 * the orchestrator's "skip already-Completed steps" logic faithfully. */
function createFakeStepLedger() {
  const ledger = new Map<string, { status: string; attempts: number }>();
  const key = (tenantId: string, step: string) => `${tenantId}:${step}`;

  const repo: Partial<TenantProvisioningStepRepository> = {
    find: vi.fn(async (tenantId: string, step: string) => {
      const row = ledger.get(key(tenantId, step));
      return row ? ({ status: row.status, attempts: row.attempts } as never) : null;
    }),
    markRunning: vi.fn(async (tenantId: string, step: string) => {
      const existing = ledger.get(key(tenantId, step));
      ledger.set(key(tenantId, step), { status: 'Running', attempts: (existing?.attempts ?? 0) + 1 });
    }),
    markCompleted: vi.fn(async (tenantId: string, step: string) => {
      const existing = ledger.get(key(tenantId, step));
      ledger.set(key(tenantId, step), { status: 'Completed', attempts: existing?.attempts ?? 1 });
    }),
    markFailed: vi.fn(async (tenantId: string, step: string) => {
      const existing = ledger.get(key(tenantId, step));
      ledger.set(key(tenantId, step), { status: 'Failed', attempts: existing?.attempts ?? 1 });
    }),
  };
  return { repo: repo as TenantProvisioningStepRepository, ledger };
}

/** A trivial pass-through lock — the real `GET_LOCK`/`RELEASE_LOCK` behavior needs a real MySQL
 * connection (covered by the integration test), so this fake just runs `fn` directly. */
function createFakeLock(): TenantProvisioningLockService {
  return { withLock: vi.fn(async (_tenantId: string, fn: () => Promise<unknown>) => fn()) } as unknown as TenantProvisioningLockService;
}

function createFakeTenantRepo(overrides: Partial<typeof BASE_TENANT_ROW> = {}) {
  const row = { ...BASE_TENANT_ROW, ...overrides };
  const repo: Partial<PlatformTenantRepository> = {
    findById: vi.fn(async () => row as never),
    setPendingAdminEmail: vi.fn(async () => undefined),
    touchProvisioningHeartbeat: vi.fn(async () => undefined),
    markProvisioningActive: vi.fn(async () => ({ ...row, status: 'Active' }) as never),
    markProvisioningFailed: vi.fn(async () => undefined),
  };
  return repo as PlatformTenantRepository;
}

function createFakeTenantsService(overrides: Partial<TenantSummary> = {}): TenantsService {
  const summary: TenantSummary = {
    id: BASE_TENANT_ROW.id,
    name: BASE_TENANT_ROW.name,
    subdomainSlug: BASE_TENANT_ROW.subdomainSlug,
    schemaName: BASE_TENANT_ROW.schemaName,
    status: 'Provisioning',
    isDefault: false,
    allowEmailRegistration: true,
    allowGoogleSignIn: false,
    defaultSelfRegisterRole: null,
    logoUrl: null,
    accentColorOverride: null,
    assignedAiModelId: null,
    provisioningError: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    purgeAfterAt: null,
    ...overrides,
  };
  return { create: vi.fn(async () => summary), get: vi.fn(async () => summary) } as unknown as TenantsService;
}

/** A fake step that records every `run()` call and can be told to fail. */
function createFakeStep(name: string, opts: { shouldFail?: boolean } = {}): ProvisioningStep & { calls: number } {
  const step = {
    name: name as never,
    calls: 0,
    async run(_ctx: ProvisioningContext) {
      step.calls += 1;
      if (opts.shouldFail) throw new Error(`${name} exploded`);
    },
  };
  return step;
}

describe('TenantProvisioningService', () => {
  it('runs every step exactly once and activates the tenant on full success', async () => {
    const { repo: stepLedger } = createFakeStepLedger();
    const tenantRepo = createFakeTenantRepo();
    const tenantsService = createFakeTenantsService();
    const stepA = createFakeStep('create_schema');
    const stepB = createFakeStep('run_migrations');

    const service = new TenantProvisioningService(tenantsService, tenantRepo, stepLedger, [stepA, stepB], createFakeLock());

    const result = await service.provisionNewTenant({ name: 'Acme', subdomainSlug: 'acme', adminEmail: 'admin@acme.test' });

    expect(stepA.calls).toBe(1);
    expect(stepB.calls).toBe(1);
    expect(result.status).toBe('Active');
    expect(tenantRepo.markProvisioningActive).toHaveBeenCalledWith(BASE_TENANT_ROW.id);
  });

  it('skips an already-Completed step on retry (resumes rather than duplicates)', async () => {
    const { repo: stepLedger, ledger } = createFakeStepLedger();
    // Pre-seed the ledger as if `create_schema` already completed in a prior run.
    ledger.set(`${BASE_TENANT_ROW.id}:create_schema`, { status: 'Completed', attempts: 1 });

    const tenantRepo = createFakeTenantRepo({ status: 'Failed' });
    const tenantsService = createFakeTenantsService({ status: 'Failed' });
    const stepA = createFakeStep('create_schema');
    const stepB = createFakeStep('run_migrations');

    const service = new TenantProvisioningService(tenantsService, tenantRepo, stepLedger, [stepA, stepB], createFakeLock());
    await service.retry(BASE_TENANT_ROW.id);

    expect(stepA.calls).toBe(0); // already Completed — never re-run
    expect(stepB.calls).toBe(1);
  });

  it('stops the sequence, marks the tenant Failed, and throws on a step failure', async () => {
    const { repo: stepLedger } = createFakeStepLedger();
    const tenantRepo = createFakeTenantRepo();
    const tenantsService = createFakeTenantsService();
    const stepA = createFakeStep('create_schema', { shouldFail: true });
    const stepB = createFakeStep('run_migrations');

    const service = new TenantProvisioningService(tenantsService, tenantRepo, stepLedger, [stepA, stepB], createFakeLock());

    await expect(
      service.provisionNewTenant({ name: 'Acme', subdomainSlug: 'acme', adminEmail: 'admin@acme.test' }),
    ).rejects.toBeInstanceOf(TenantProvisioningFailedError);

    expect(stepA.calls).toBe(1);
    expect(stepB.calls).toBe(0); // sequence stopped — later steps never run
    expect(tenantRepo.markProvisioningFailed).toHaveBeenCalledWith(
      BASE_TENANT_ROW.id,
      expect.stringContaining('create_schema'),
    );
    expect(tenantRepo.markProvisioningActive).not.toHaveBeenCalled();
  });

  it('rejects an implausible adminEmail before creating any tenant row', async () => {
    const { repo: stepLedger } = createFakeStepLedger();
    const tenantRepo = createFakeTenantRepo();
    const tenantsService = createFakeTenantsService();
    const service = new TenantProvisioningService(tenantsService, tenantRepo, stepLedger, [], createFakeLock());

    await expect(
      service.provisionNewTenant({ name: 'Acme', subdomainSlug: 'acme', adminEmail: 'not-an-email' }),
    ).rejects.toThrow(/one or more fields failed validation/i);
    expect(tenantsService.create).not.toHaveBeenCalled();
  });

  it('permanent failure: a step that always fails leaves the tenant Failed forever, and retry keeps failing the same way', async () => {
    // Mirrors legacy's `provisioning-workflow.e2e-spec.ts` "permanent failure" scenario — the
    // highest-value assertion from that spec this dispatch's own scope can meaningfully adapt
    // (auth/rbac/tenant-resolution's own e2e specs need modules this dispatch explicitly defers).
    const { repo: stepLedger } = createFakeStepLedger();
    const tenantRepo = createFakeTenantRepo({ status: 'Failed' });
    const tenantsService = createFakeTenantsService({ status: 'Failed' });
    const alwaysFailingStep = createFakeStep('seed_rbac', { shouldFail: true });

    const service = new TenantProvisioningService(tenantsService, tenantRepo, stepLedger, [alwaysFailingStep], createFakeLock());

    await expect(service.retry(BASE_TENANT_ROW.id)).rejects.toBeInstanceOf(TenantProvisioningFailedError);
    expect(alwaysFailingStep.calls).toBe(1);

    // A second retry attempt fails again, identically — never silently succeeds/skips.
    await expect(service.retry(BASE_TENANT_ROW.id)).rejects.toBeInstanceOf(TenantProvisioningFailedError);
    expect(alwaysFailingStep.calls).toBe(2);
    expect(tenantRepo.markProvisioningActive).not.toHaveBeenCalled();
  });

  it('retry() rejects an Active tenant with InvalidTenantStateError', async () => {
    const { repo: stepLedger } = createFakeStepLedger();
    const tenantRepo = createFakeTenantRepo();
    const tenantsService = createFakeTenantsService({ status: 'Active' });
    const service = new TenantProvisioningService(tenantsService, tenantRepo, stepLedger, [], createFakeLock());

    await expect(service.retry(BASE_TENANT_ROW.id)).rejects.toThrow(/only 'Provisioning' or 'Failed' can be retried/);
  });
});
