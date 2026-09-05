import { getEnv, type EnvVars } from '@/server/config';
import { TenantNotFoundError, type ResolvedTenant } from '@/server/platform/tenants';
import { TenantResolutionCache } from './tenant-resolution-cache';
import { TenantSuspendedError, TenantUnavailableError } from './errors';
import { findResolvableTenantBySlugRaw } from './raw-tenant-lookup';

/**
 * Derives the tenant subdomain slug from the request's `Host` header — ported **exactly** from
 * `legacy/api/src/tenancy/tenant-resolution.middleware.ts`'s `deriveSlug` (migration plan: "does the
 * cached lookup exactly as `TenantResolutionMiddleware` does today"), including its environment-gated
 * dev/test bypass:
 *
 * - If `NODE_ENV` is anything other than `production`/`staging`, the `Host` header is **ignored
 *   entirely** and the slug is always {@link EnvVars.DEFAULT_TENANT_SUBDOMAIN} — a deliberate
 *   dev-convenience bypass ported verbatim, not something this port added.
 * - Otherwise: strip a `:port` suffix, take the first dot-label, lower-case it. No apex-domain
 *   suffix-stripping logic exists (matches legacy) — this is "first label before the first dot", not
 *   "strip a known apex suffix". A missing `Host` header degenerates to slug `''`, which simply falls
 *   through to a real (always-miss) lookup — there is no dedicated "missing Host" error.
 */
export function deriveTenantSlug(host: string | null, env: Pick<EnvVars, 'NODE_ENV' | 'DEFAULT_TENANT_SUBDOMAIN'>): string {
  const isProdLike = env.NODE_ENV === 'production' || env.NODE_ENV === 'staging';
  if (!isProdLike) {
    return env.DEFAULT_TENANT_SUBDOMAIN;
  }
  const rawHost = host ?? '';
  const firstLabel = rawHost.split(':')[0].split('.')[0];
  return firstLabel.toLowerCase();
}

/** True if `slug` is platform-reserved (`admin`, `www`, `api`, ...) — ported verbatim. A reserved
 * slug is rejected as `TENANT_NOT_FOUND` **without ever querying the repository or touching the
 * cache** (see {@link resolveTenantBySlug}), so no enumeration signal distinguishes "reserved" from
 * "genuinely nonexistent". */
export function isReservedSlug(slug: string, env: Pick<EnvVars, 'RESERVED_SUBDOMAINS'>): boolean {
  return env.RESERVED_SUBDOMAINS.includes(slug);
}

/** The narrow read this module needs from *some* tenant lookup — deliberately not typed against
 * `PlatformTenantRepository` directly (a real class, entity-backed). Satisfied both by
 * `raw-tenant-lookup.ts`'s entity-free `findResolvableTenantBySlugRaw` (the real production path, see
 * that file's own doc comment for why) and by `PlatformTenantRepository.findResolvableBySlug` itself
 * (structurally compatible, used only by tests/other call sites that don't cross the middleware
 * bundle boundary). */
export interface TenantLookup {
  findResolvableBySlug(slug: string): Promise<ResolvedTenant | null>;
}

/** Narrow dependency shape {@link resolveTenantBySlug} needs — lets unit tests inject a fake repo/cache
 * without touching real MySQL or the process-wide cache singleton. */
export interface TenantResolutionDeps {
  repo: TenantLookup;
  cache: Pick<TenantResolutionCache, 'get' | 'setFound' | 'setNotFound'>;
  env: Pick<EnvVars, 'RESERVED_SUBDOMAINS'>;
}

/**
 * Resolves `slug` to an `Active` tenant, or throws the exact `DomainError` legacy's
 * `TenantResolutionMiddleware` would for every other case — ported verbatim decision table:
 *
 * | Condition | Thrown |
 * |---|---|
 * | reserved slug | {@link TenantNotFoundError} (repo/cache never touched) |
 * | not found (row absent or soft-deleted) | {@link TenantNotFoundError} |
 * | `status === 'Suspended'` | {@link TenantSuspendedError} |
 * | `status === 'Provisioning'` \| `'Failed'` | {@link TenantUnavailableError} |
 * | `status === 'Active'` | returns the resolved tenant |
 */
export async function resolveTenantBySlug(slug: string, deps: TenantResolutionDeps): Promise<ResolvedTenant> {
  if (isReservedSlug(slug, deps.env)) {
    throw new TenantNotFoundError();
  }

  let tenant: ResolvedTenant | null;
  const cached = deps.cache.get(slug);
  if (cached.hit) {
    tenant = cached.value;
  } else {
    tenant = await deps.repo.findResolvableBySlug(slug);
    if (tenant) {
      deps.cache.setFound(slug, tenant);
    } else {
      deps.cache.setNotFound(slug);
    }
  }

  if (!tenant) throw new TenantNotFoundError();
  if (tenant.status === 'Suspended') throw new TenantSuspendedError();
  if (tenant.status === 'Provisioning' || tenant.status === 'Failed') throw new TenantUnavailableError();
  return tenant;
}

declare global {
  // eslint-disable-next-line no-var -- global augmentation requires `var`, not `const`/`let`.
  var __examlandTenantResolutionCache: TenantResolutionCache | undefined;
}

/** Process-wide {@link TenantResolutionCache} singleton, cached on `globalThis` for the same Next.js
 * dev-hot-reload reason every other singleton in this app is. */
export function getTenantResolutionCache(): TenantResolutionCache {
  if (!globalThis.__examlandTenantResolutionCache) {
    const env = getEnv();
    globalThis.__examlandTenantResolutionCache = new TenantResolutionCache(env.TENANT_CACHE_TTL_MS, env.TENANT_CACHE_NEG_TTL_MS);
  }
  return globalThis.__examlandTenantResolutionCache;
}

/**
 * `middleware.ts`'s sole entry point: derives the slug from `host`, resolves it against the cache/
 * platform DB, and returns the `Active` tenant or throws. Composes the process-wide cache singleton
 * and {@link findResolvableTenantBySlugRaw}'s dedicated, entity-free connection pool — **deliberately
 * not** `getPlatformDataSource()`/`PlatformTenantRepository` (see `raw-tenant-lookup.ts`'s own doc
 * comment: calling the shared, entity-based platform `DataSource` from inside `middleware.ts`'s
 * always-separate webpack bundle corrupts TypeORM's entity-metadata lookup for every other route in
 * the whole running process — a real failure found by actually booting the app and sending a real
 * `Host`-header request, not assumed from a pattern).
 */
export async function resolveTenantForRequest(host: string | null): Promise<ResolvedTenant> {
  const env = getEnv();
  const slug = deriveTenantSlug(host, env);
  const repo: TenantLookup = { findResolvableBySlug: (s) => findResolvableTenantBySlugRaw(s, env) };
  return resolveTenantBySlug(slug, { repo, cache: getTenantResolutionCache(), env });
}
