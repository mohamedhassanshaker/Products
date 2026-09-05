import { DomainError } from '@/server/common/errors/domain-error';
import type { ProvisioningStepName } from '@examland/contracts';

/**
 * Thrown when any provisioning step fails (HLD §4.4: "500 { code: TENANT_PROVISIONING_FAILED, step,
 * reason }") — ported verbatim from `legacy/api/src/tenancy/domain/errors.ts`. The tenant row is
 * already stamped `Failed`/`provisioningError` by `TenantProvisioningService` before this is thrown —
 * this error is what surfaces that failure to whichever caller (a future Route Handler, or a test)
 * invoked `provisionNewTenant()`/`retry()`.
 */
export class TenantProvisioningFailedError extends DomainError {
  constructor(step: ProvisioningStepName, reason: string) {
    super('TENANT_PROVISIONING_FAILED', `Provisioning step '${step}' failed: ${reason}`, { step, reason });
  }
}

/**
 * Thrown by tenant resolution (`middleware.ts` via `resolveTenantForRequest`) when the resolved slug
 * belongs to a tenant whose `status === 'Suspended'` — ported verbatim (code/message/HTTP 403) from
 * legacy's `TenantResolutionMiddleware`.
 */
export class TenantSuspendedError extends DomainError {
  constructor() {
    super('TENANT_SUSPENDED', 'This tenant has been suspended.');
  }
}

/**
 * Thrown by tenant resolution when the resolved tenant is `Provisioning` or `Failed` — neither status
 * is safe to serve traffic for (HLD/FR-MT-4) — ported verbatim (code/message/HTTP 503) from legacy's
 * `TenantResolutionMiddleware`. Deliberately the *same* code/status for both statuses (a client has no
 * actionable difference between "still provisioning" and "provisioning failed" other than "try again
 * later").
 */
export class TenantUnavailableError extends DomainError {
  constructor() {
    super('TENANT_UNAVAILABLE', 'This tenant is not currently available.');
  }
}
