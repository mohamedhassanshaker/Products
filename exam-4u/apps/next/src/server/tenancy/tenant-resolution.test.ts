import { describe, expect, it, vi } from 'vitest';
import { deriveTenantSlug, isReservedSlug, resolveTenantBySlug, type TenantResolutionDeps } from './tenant-resolution';
import { TenantSuspendedError, TenantUnavailableError } from './errors';
import { TenantNotFoundError, type ResolvedTenant } from '@/server/platform/tenants';

const RESERVED = { RESERVED_SUBDOMAINS: ['admin', 'www', 'api', 'app', 'auth', 'static', 'mail', 'status'] };

describe('deriveTenantSlug', () => {
  it('ignores the Host header entirely in development, always returning DEFAULT_TENANT_SUBDOMAIN', () => {
    const env = { NODE_ENV: 'development' as const, DEFAULT_TENANT_SUBDOMAIN: 'default' };
    expect(deriveTenantSlug('acme.examland.app', env)).toBe('default');
    expect(deriveTenantSlug(null, env)).toBe('default');
  });

  it('ignores the Host header in test the same way as development', () => {
    const env = { NODE_ENV: 'test' as const, DEFAULT_TENANT_SUBDOMAIN: 'default' };
    expect(deriveTenantSlug('acme.examland.app', env)).toBe('default');
  });

  it('derives the first dot-label of Host in production, stripping a port suffix', () => {
    const env = { NODE_ENV: 'production' as const, DEFAULT_TENANT_SUBDOMAIN: 'default' };
    expect(deriveTenantSlug('acme.examland.app:3000', env)).toBe('acme');
    expect(deriveTenantSlug('acme.examland.app', env)).toBe('acme');
  });

  it('treats staging identically to production', () => {
    const env = { NODE_ENV: 'staging' as const, DEFAULT_TENANT_SUBDOMAIN: 'default' };
    expect(deriveTenantSlug('acme.examland.app', env)).toBe('acme');
  });

  it('lower-cases the derived slug', () => {
    const env = { NODE_ENV: 'production' as const, DEFAULT_TENANT_SUBDOMAIN: 'default' };
    expect(deriveTenantSlug('ACME.examland.app', env)).toBe('acme');
  });

  it('degenerates to an empty-string slug for a missing Host header in production (no dedicated error)', () => {
    const env = { NODE_ENV: 'production' as const, DEFAULT_TENANT_SUBDOMAIN: 'default' };
    expect(deriveTenantSlug(null, env)).toBe('');
  });

  it('has no apex-domain-suffix-stripping logic — a raw IP/localhost host resolves its first label', () => {
    const env = { NODE_ENV: 'production' as const, DEFAULT_TENANT_SUBDOMAIN: 'default' };
    expect(deriveTenantSlug('127.0.0.1', env)).toBe('127');
    expect(deriveTenantSlug('localhost', env)).toBe('localhost');
  });
});

describe('isReservedSlug', () => {
  it('flags every documented default reserved subdomain', () => {
    for (const slug of RESERVED.RESERVED_SUBDOMAINS) {
      expect(isReservedSlug(slug, RESERVED)).toBe(true);
    }
  });

  it('does not flag a genuine tenant slug', () => {
    expect(isReservedSlug('acme', RESERVED)).toBe(false);
  });
});

/** Minimal fake cache — a real `Map`, not a mock, so `resolveTenantBySlug`'s actual caching behavior
 * (setFound/setNotFound/get) is genuinely exercised, not just "was called". */
function fakeCache(): TenantResolutionDeps['cache'] {
  const store = new Map<string, ResolvedTenant | null>();
  return {
    get: (slug) => (store.has(slug) ? { hit: true, value: store.get(slug) ?? null } : { hit: false }),
    setFound: (slug, value) => void store.set(slug, value),
    setNotFound: (slug) => void store.set(slug, null),
  };
}

describe('resolveTenantBySlug', () => {
  it('rejects a reserved slug as TENANT_NOT_FOUND without ever querying the repository', async () => {
    const findResolvableBySlug = vi.fn();
    const deps: TenantResolutionDeps = { repo: { findResolvableBySlug }, cache: fakeCache(), env: RESERVED };

    await expect(resolveTenantBySlug('admin', deps)).rejects.toThrow(TenantNotFoundError);
    expect(findResolvableBySlug).not.toHaveBeenCalled();
  });

  it('rejects a nonexistent slug as TENANT_NOT_FOUND', async () => {
    const deps: TenantResolutionDeps = {
      repo: { findResolvableBySlug: vi.fn().mockResolvedValue(null) },
      cache: fakeCache(),
      env: RESERVED,
    };
    await expect(resolveTenantBySlug('ghost', deps)).rejects.toThrow(TenantNotFoundError);
  });

  it('rejects a Suspended tenant as TenantSuspendedError', async () => {
    const tenant: ResolvedTenant = { id: 't1', subdomainSlug: 'acme', schemaName: 't_acme', status: 'Suspended' };
    const deps: TenantResolutionDeps = { repo: { findResolvableBySlug: vi.fn().mockResolvedValue(tenant) }, cache: fakeCache(), env: RESERVED };
    await expect(resolveTenantBySlug('acme', deps)).rejects.toThrow(TenantSuspendedError);
  });

  it.each(['Provisioning', 'Failed'] as const)('rejects a %s tenant as TenantUnavailableError', async (status) => {
    const tenant: ResolvedTenant = { id: 't1', subdomainSlug: 'acme', schemaName: 't_acme', status };
    const deps: TenantResolutionDeps = { repo: { findResolvableBySlug: vi.fn().mockResolvedValue(tenant) }, cache: fakeCache(), env: RESERVED };
    await expect(resolveTenantBySlug('acme', deps)).rejects.toThrow(TenantUnavailableError);
  });

  it('resolves an Active tenant', async () => {
    const tenant: ResolvedTenant = { id: 't1', subdomainSlug: 'acme', schemaName: 't_acme', status: 'Active' };
    const deps: TenantResolutionDeps = { repo: { findResolvableBySlug: vi.fn().mockResolvedValue(tenant) }, cache: fakeCache(), env: RESERVED };
    await expect(resolveTenantBySlug('acme', deps)).resolves.toEqual(tenant);
  });

  it('serves a cache hit without calling the repository again', async () => {
    const findResolvableBySlug = vi.fn().mockResolvedValue({ id: 't1', subdomainSlug: 'acme', schemaName: 't_acme', status: 'Active' });
    const cache = fakeCache();
    const deps: TenantResolutionDeps = { repo: { findResolvableBySlug }, cache, env: RESERVED };

    await resolveTenantBySlug('acme', deps);
    await resolveTenantBySlug('acme', deps);
    expect(findResolvableBySlug).toHaveBeenCalledTimes(1);
  });

  it('caches a negative result so a repeat lookup of the same nonexistent slug is also served from cache', async () => {
    const findResolvableBySlug = vi.fn().mockResolvedValue(null);
    const cache = fakeCache();
    const deps: TenantResolutionDeps = { repo: { findResolvableBySlug }, cache, env: RESERVED };

    await expect(resolveTenantBySlug('ghost', deps)).rejects.toThrow(TenantNotFoundError);
    await expect(resolveTenantBySlug('ghost', deps)).rejects.toThrow(TenantNotFoundError);
    expect(findResolvableBySlug).toHaveBeenCalledTimes(1);
  });
});
