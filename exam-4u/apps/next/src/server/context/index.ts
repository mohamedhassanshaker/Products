import { getRequestContext, runWithRequestContext, requestContextStorage } from './request-context';
import { requireTenantDataSource, requireTenantId } from './tenant-context';
import { withTenantContext } from './with-tenant-context';
import { withPlatformAuth, type AuthenticatedPlatformAdmin } from './with-platform-auth';

export { getRequestContext, runWithRequestContext, requestContextStorage, requireTenantDataSource, requireTenantId };
export { withTenantContext, withPlatformAuth };
export type { RequestContext } from './request-context';
export type { AuthenticatedPlatformAdmin };

/**
 * `server/context`'s public barrel (migration plan's "New app structure": `context/ (request-
 * context.ts ALS + withTenantContext/withPlatformAuth)`) — the ALS-backed per-request context store
 * plus the two composition wrappers every Route Handler/Server Action uses to establish it. Nothing
 * outside this module may import `./request-context`/`./tenant-context`/`./with-tenant-context`/
 * `./with-platform-auth` directly (enforced by `apps/next/.eslintrc.cjs`'s `context` module-boundary
 * rule).
 */
