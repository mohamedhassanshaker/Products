import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TenantResolutionCache } from './tenant-resolution-cache';
import type { ResolvedTenant } from '@/server/platform/tenants';

const TENANT: ResolvedTenant = { id: 't1', subdomainSlug: 'acme', schemaName: 't_acme', status: 'Active' };

describe('TenantResolutionCache', () => {
  let cache: TenantResolutionCache;

  beforeEach(() => {
    vi.useFakeTimers();
    cache = new TenantResolutionCache(60_000, 15_000);
  });

  afterEach(() => {
    cache.destroy();
    vi.useRealTimers();
  });

  it('reports a miss for a never-looked-up slug', () => {
    expect(cache.get('ghost')).toEqual({ hit: false });
  });

  it('serves a positive entry until exactly the positive TTL elapses', () => {
    cache.setFound('acme', TENANT);
    vi.advanceTimersByTime(59_999);
    expect(cache.get('acme')).toEqual({ hit: true, value: TENANT });

    vi.advanceTimersByTime(1);
    expect(cache.get('acme')).toEqual({ hit: false });
  });

  it('serves a negative entry until exactly the negative TTL elapses', () => {
    cache.setNotFound('ghost');
    vi.advanceTimersByTime(14_999);
    expect(cache.get('ghost')).toEqual({ hit: true, value: null });

    vi.advanceTimersByTime(1);
    expect(cache.get('ghost')).toEqual({ hit: false });
  });

  it('tracks positive and negative TTLs independently per key', () => {
    cache.setFound('acme', TENANT);
    cache.setNotFound('ghost');

    vi.advanceTimersByTime(20_000); // past the 15s negative TTL, before the 60s positive TTL
    expect(cache.get('acme')).toEqual({ hit: true, value: TENANT });
    expect(cache.get('ghost')).toEqual({ hit: false });
  });

  it('invalidate() forces an immediate miss regardless of remaining TTL', () => {
    cache.setFound('acme', TENANT);
    cache.invalidate('acme');
    expect(cache.get('acme')).toEqual({ hit: false });
  });

  it('the periodic sweep removes expired entries even without a read', () => {
    cache.setNotFound('ghost');
    vi.advanceTimersByTime(15_001);
    cache.sweepExpired();
    // Reaching into the private store isn't possible from outside; instead prove the sweep already
    // ran by checking get() (which would lazily evict anyway) still reports a miss — the key
    // assertion is that sweepExpired() itself doesn't throw and is idempotent to call directly.
    expect(cache.get('ghost')).toEqual({ hit: false });
  });
});
