import { getPlatformDataSource } from '@/server/infrastructure/database';
import { createEmailPort } from '@/server/infrastructure/mail';
import { logger } from '@/server/logging';
import { getBillingRepositories } from '@/server/platform/billing';
import { getTenantsService, PlatformTenantRepository } from '@/server/platform/tenants';
import { createProvisioningSteps } from './steps';
import { TenantProvisioningLockService } from './tenant-provisioning-lock.service';
import { TenantProvisioningStepRepository } from './tenant-provisioning-step.repository';
import { TenantProvisioningService, type ProvisionNewTenantInput } from './tenant-provisioning.service';

export { TenantProvisioningService, TenantProvisioningStepRepository, TenantProvisioningLockService };
export type { ProvisionNewTenantInput };
export { CreateSchemaStep, RunMigrationsStep, SeedRbacStep, SeedAdminUserStep, CreateSubscriptionStep, InviteAdminStep } from './steps';

/**
 * `server/platform/provisioning`'s public barrel — the orchestration workflow itself (a
 * platform-admin operation: only a Platform Admin ever provisions a new tenant), as distinct from
 * `server/tenancy`'s shared domain vocabulary (`ProvisioningStep`/`ProvisioningContext`) and
 * `server/infrastructure/database/tenant`'s DataSource plumbing — see
 * `docs/plans/nextjs-rewrite-phase1-plan.md`'s "Decisions made" for the full reasoning behind this
 * three-way split. Nothing outside this module may import `./tenant-provisioning.service`/
 * `./tenant-provisioning-lock.service`/`./tenant-provisioning-step.repository`/`./steps/**` directly
 * (enforced by `apps/next/.eslintrc.cjs`'s `platform/provisioning` module-boundary rule).
 *
 * {@link getTenantProvisioningService} is the composition root: resolves the platform `DataSource`
 * once, builds every dependency (tenants service/repo, step ledger, lock, billing repos, email port,
 * the fixed step sequence), and caches the fully-wired {@link TenantProvisioningService} on
 * `globalThis` — this app's DI-container-free equivalent of `TenantProvisioningModule`'s NestJS
 * provider graph.
 */
declare global {
  // eslint-disable-next-line no-var -- global augmentation requires `var`, not `const`/`let`.
  var __examlandTenantProvisioningService: Promise<TenantProvisioningService> | undefined;
}

export async function getTenantProvisioningService(): Promise<TenantProvisioningService> {
  if (!globalThis.__examlandTenantProvisioningService) {
    globalThis.__examlandTenantProvisioningService = (async () => {
      const [dataSource, tenantsService, billing] = await Promise.all([
        getPlatformDataSource(),
        getTenantsService(),
        getBillingRepositories(),
      ]);

      const tenantRepo = new PlatformTenantRepository(dataSource);
      const stepLedger = new TenantProvisioningStepRepository(dataSource);
      const lock = new TenantProvisioningLockService(dataSource);
      const emailPort = createEmailPort(logger);
      const steps = createProvisioningSteps({
        packages: billing.packages,
        subscriptions: billing.subscriptions,
        emailPort,
      });

      return new TenantProvisioningService(tenantsService, tenantRepo, stepLedger, steps, lock);
    })();
  }
  return globalThis.__examlandTenantProvisioningService;
}
