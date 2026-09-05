import { TenantResolutionCache, type TenantCacheLookup } from './tenant-resolution-cache';
import {
  deriveTenantSlug,
  isReservedSlug,
  resolveTenantBySlug,
  resolveTenantForRequest,
  getTenantResolutionCache,
  type TenantResolutionDeps,
} from './tenant-resolution';
import { TenantScopeService } from './tenant-scope';

export type { ProvisioningContext, ProvisioningStep, ProvisioningTenantRef } from './provisioning.types';
export { TenantProvisioningFailedError, TenantSuspendedError, TenantUnavailableError } from './errors';
export type { EmailPort } from './email.port';
export { TenantResolutionCache, deriveTenantSlug, isReservedSlug, resolveTenantBySlug, resolveTenantForRequest, getTenantResolutionCache };
export type { TenantCacheLookup, TenantResolutionDeps };
export { TenantScopeService };

/**
 * `server/tenancy`'s public barrel — the shared tenancy-domain vocabulary
 * (`ProvisioningStep`/`ProvisioningContext`/`EmailPort`, added sub-slice 1a) **plus**, as of Phase 1
 * sub-slice 1b, the full `Host`-header tenant-*resolution* primitives legacy also keeps under
 * `tenancy/` (`TenantResolutionCache`, `deriveTenantSlug`/`resolveTenantForRequest`) — sub-slice 1a's
 * own doc comment explicitly forward-referenced this: "that sub-dispatch adds them to this same
 * barrel when it lands." Nothing outside this module may import `./provisioning.types`/`./errors`/
 * `./email.port`/`./tenant-resolution-cache`/`./tenant-resolution` directly (enforced by
 * `apps/next/.eslintrc.cjs`'s `tenancy` module-boundary rule).
 *
 * {@link resolveTenantForRequest} is `middleware.ts`'s sole entry point (see that file). Deliberately
 * does **not** include `TenantContextService`'s ALS-based ambient-ready-`EntityManager` plumbing
 * legacy also keeps under `tenancy/` — this app's HTTP-request equivalent (`withTenantContext`/
 * `requireTenantDataSource`) lives in `server/context` instead (this dispatch's own "Decisions made"
 * explains the split): `tenancy/` stays scoped to "resolve a `Host` header to a tenant row (or, for
 * worker code, a tenant id), and bind it into ALS", while `server/context`'s narrower job is the
 * *HTTP-request-specific* flavor of that same idea (reading trusted `x-tenant-*` headers). The two are
 * genuinely different entry points into the identical ALS store, which is why {@link TenantScopeService}
 * (added Phase 2 sub-slice "2d" — worker code's own entry point, resolving by tenant id rather than
 * `Host` header) lives here rather than in `server/context`.
 */
