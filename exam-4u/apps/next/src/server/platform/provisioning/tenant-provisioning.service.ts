import { ValidationFailedError } from '@/server/common/errors/domain-error';
import { isPlausibleEmail } from '@/server/common/util/email.util';
import { logger } from '@/server/logging';
import {
  InvalidTenantStateError,
  TenantNotFoundError,
  type CreateTenantInput,
  type PlatformTenantRepository,
  type TenantsService,
  type TenantSummary,
} from '@/server/platform/tenants';
import { TenantProvisioningFailedError, type ProvisioningContext, type ProvisioningStep } from '@/server/tenancy';
import type { TenantProvisioningStepRepository } from './tenant-provisioning-step.repository';
import type { TenantProvisioningLockService } from './tenant-provisioning-lock.service';

/** Input to {@link TenantProvisioningService.provisionNewTenant} — FR-MT-4's "required inputs: tenant
 * name, desired subdomain, initial package assignment, and the first Tenant Admin's email". Ported
 * verbatim from `legacy/api/src/tenancy/provisioning/tenant-provisioning.service.ts`. `packageId` is
 * still not accepted (matching legacy's own identical-phase scope): `CreateSubscriptionStep` always
 * targets `getEnv().FALLBACK_PACKAGE_KEY` until Phase 2's Platform Admin console adds a package-choice
 * UI on top of this workflow. */
export interface ProvisionNewTenantInput extends CreateTenantInput {
  adminEmail: string;
}

/**
 * Orchestrates the full tenant-provisioning workflow (HLD §4.4, FR-MT-3/FR-MT-4) — ported (logic
 * unchanged) from `legacy/api/src/tenancy/provisioning/tenant-provisioning.service.ts`, adapted from
 * a NestJS `@Injectable()` provider to a plain class this module's barrel constructs with already-
 * resolved dependencies (no DI container, no `TenantResolutionCache` dependency — see this module's
 * `index.ts` barrel doc comment for why cache invalidation is deferred to the next Phase 1
 * sub-dispatch). Creates the `platform.tenant` row (via {@link TenantsService}, not duplicated here),
 * then drives the fixed, ordered {@link ProvisioningStep} sequence to completion, recording each
 * step's outcome in `platform.tenant_provisioning_step` so a retry resumes rather than duplicates
 * work.
 *
 * **Forward recovery, not a distributed transaction** (HLD §4.4: "Cross-store atomicity is
 * impossible — MySQL DDL is non-transactional, email is external"): a tenant only ever moves to
 * `Active` after every step reports `Completed`; any step throwing stops the sequence immediately,
 * stamps the tenant `Failed` with the step name and reason, and re-raises
 * {@link TenantProvisioningFailedError} — the tenant is never left reachable by end users in a
 * half-provisioned state.
 */
export class TenantProvisioningService {
  constructor(
    private readonly tenantsService: TenantsService,
    private readonly tenantRepo: PlatformTenantRepository,
    private readonly stepLedger: TenantProvisioningStepRepository,
    private readonly steps: ProvisioningStep[],
    private readonly lock: TenantProvisioningLockService,
  ) {}

  /**
   * Creates a brand-new tenant (delegating field validation/persistence to
   * {@link TenantsService.create}) and immediately runs it through every provisioning step.
   *
   * @throws {ValidationFailedError} if `adminEmail` is missing or not a plausible email shape.
   * @throws {import('@/server/platform/tenants').TenantNameRequiredError} |
   *   {@link import('@/server/platform/tenants').InvalidSubdomainError} |
   *   {@link import('@/server/platform/tenants').SubdomainTakenError} — see `TenantsService.create`.
   * @throws {TenantProvisioningFailedError} if any provisioning step fails — the tenant row is left
   *   `Failed` with the reason recorded, retriable via {@link retry}.
   */
  async provisionNewTenant(input: ProvisionNewTenantInput): Promise<TenantSummary> {
    if (!isPlausibleEmail(input.adminEmail)) {
      throw new ValidationFailedError([{ field: 'adminEmail', constraint: 'must be a valid email address' }]);
    }

    const tenant = await this.tenantsService.create({ name: input.name, subdomainSlug: input.subdomainSlug });
    await this.tenantRepo.setPendingAdminEmail(tenant.id, input.adminEmail.trim());

    return this.runSteps(tenant.id);
  }

  /**
   * Resumes provisioning for a tenant currently stuck in `Provisioning` (crashed mid-run) or `Failed`
   * (a step errored). Re-runs the fixed step sequence, skipping any step already recorded `Completed`
   * in the ledger — this is what makes a retry idempotent.
   *
   * @throws {TenantNotFoundError} if `tenantId` does not resolve to any tenant.
   * @throws {InvalidTenantStateError} if the tenant is not currently `Provisioning` or `Failed`.
   * @throws {TenantProvisioningFailedError} if a step fails again.
   */
  async retry(tenantId: string): Promise<TenantSummary> {
    const current = await this.tenantsService.get(tenantId);
    if (current.status !== 'Provisioning' && current.status !== 'Failed') {
      throw new InvalidTenantStateError(
        `Cannot retry provisioning for a tenant in status '${current.status}'; only 'Provisioning' or 'Failed' can be retried.`,
      );
    }
    return this.runSteps(tenantId);
  }

  /** Drives {@link steps} to completion for `tenantId`, skipping any already-`Completed` step, shared
   * by both {@link provisionNewTenant} and {@link retry}. Serialized per-tenant via
   * {@link TenantProvisioningLockService}.
   *
   * @throws {InvalidTenantStateError} if another provisioning run is already in progress for this
   *   tenant and the lock could not be acquired within the timeout.
   */
  private async runSteps(tenantId: string): Promise<TenantSummary> {
    return this.lock.withLock(tenantId, () => this.runStepsLocked(tenantId));
  }

  /** The actual step-driving logic, always called while {@link runSteps}' per-tenant lock is held. */
  private async runStepsLocked(tenantId: string): Promise<TenantSummary> {
    const row = await this.tenantRepo.findById(tenantId);
    if (!row) throw new TenantNotFoundError();
    if (!row.pendingAdminEmail) {
      // Should be unreachable in practice (set immediately after `create` in `provisionNewTenant`,
      // before any step runs) — a defensive guard against ever running `seed_admin_user` with no
      // target email, rather than letting that step fail with a confusing raw SQL error.
      throw new Error(`Tenant ${tenantId} has no pendingAdminEmail recorded; cannot run seed_admin_user.`);
    }

    const ctx: ProvisioningContext = {
      tenant: { id: row.id, name: row.name, subdomainSlug: row.subdomainSlug, schemaName: row.schemaName },
      adminEmail: row.pendingAdminEmail,
    };

    for (const step of this.steps) {
      const ledgerRow = await this.stepLedger.find(tenantId, step.name);
      if (ledgerRow?.status === 'Completed') {
        // Already done — this is the "resumes rather than duplicates" guarantee in action.
        continue;
      }

      await this.stepLedger.markRunning(tenantId, step.name);
      await this.tenantRepo.touchProvisioningHeartbeat(tenantId);

      try {
        await step.run(ctx);
        await this.stepLedger.markCompleted(tenantId, step.name);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        await this.stepLedger.markFailed(tenantId, step.name, reason);
        await this.tenantRepo.markProvisioningFailed(tenantId, `Step '${step.name}' failed: ${reason}`);
        logger.error({ err, tenantId, step: step.name }, 'tenant_provisioning_step_failed');
        throw new TenantProvisioningFailedError(step.name, reason);
      }
    }

    const activated = await this.tenantRepo.markProvisioningActive(tenantId);
    logger.info({ tenantId }, 'tenant_provisioning_completed');
    return {
      id: activated.id,
      name: activated.name,
      subdomainSlug: activated.subdomainSlug,
      schemaName: activated.schemaName,
      status: activated.status,
      isDefault: activated.isDefault,
      allowEmailRegistration: activated.allowEmailRegistration,
      allowGoogleSignIn: activated.allowGoogleSignIn,
      defaultSelfRegisterRole: activated.defaultSelfRegisterRole,
      logoUrl: activated.logoUrl,
      accentColorOverride: activated.accentColorOverride,
      assignedAiModelId: activated.assignedAiModelId,
      provisioningError: activated.provisioningError,
      createdAt: activated.createdAt,
      updatedAt: activated.updatedAt,
      deletedAt: activated.deletedAt,
      purgeAfterAt: activated.purgeAfterAt,
    };
  }
}
