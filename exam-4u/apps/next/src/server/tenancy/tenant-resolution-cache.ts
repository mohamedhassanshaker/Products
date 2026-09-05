import type { ResolvedTenant } from '@/server/platform/tenants';

/** One cache entry — `value: null` represents a cached **negative** ("no such tenant") result, not an
 * absent entry (an absent entry is simply not in {@link TenantResolutionCache.store} at all). Ported
 * verbatim from `legacy/api/src/tenancy/tenant-resolution-cache.ts`. */
interface CacheRecord {
  value: ResolvedTenant | null;
  expiresAt: number;
}

/** Discriminated lookup result — `hit: true` may still carry `value: null` (a cached miss). */
export type TenantCacheLookup = { hit: true; value: ResolvedTenant | null } | { hit: false };

/**
 * Per-process, in-memory tenant-resolution cache — ported verbatim (logic unchanged) from
 * `legacy/api/src/tenancy/tenant-resolution-cache.ts`'s `TenantResolutionCache`. Deliberately caches
 * **negative** results too (a nonexistent slug), not just positive ones: without that, a
 * subdomain-enumeration attempt would hit the platform DB with one query per guessed slug — see
 * {@link setNotFound}.
 *
 * Single in-process `Map`, keyed by slug — no Redis/shared cache (an explicit, documented MVP
 * limitation ported from legacy: a suspend on one API instance propagates to another only after that
 * instance's own TTL lapses). No max-size cap or LRU — only time-based expiry (lazy-on-read plus a
 * periodic sweep), matching legacy exactly.
 */
export class TenantResolutionCache {
  private readonly store = new Map<string, CacheRecord>();
  private readonly sweepTimer: NodeJS.Timeout;

  /**
   * @param ttlMs Positive-result TTL (`TENANT_CACHE_TTL_MS`, default 60000).
   * @param negTtlMs Negative-result TTL (`TENANT_CACHE_NEG_TTL_MS`, default 15000).
   */
  constructor(
    private readonly ttlMs: number,
    private readonly negTtlMs: number,
  ) {
    // Ported verbatim: `Math.max(1000, Math.min(ttlMs, negTtlMs))` — floor of 1s so a misconfigured
    // near-zero TTL can't spin the sweep interval into a busy loop.
    const intervalMs = Math.max(1000, Math.min(ttlMs, negTtlMs));
    // `.unref()` so this timer never keeps the Node process alive on its own (tests, graceful shutdown).
    this.sweepTimer = setInterval(() => this.sweepExpired(), intervalMs).unref();
  }

  /** Lazy-evicts on read: an expired entry is deleted and reported as a miss, even though the
   * periodic sweep would eventually remove it anyway. */
  get(slug: string): TenantCacheLookup {
    const record = this.store.get(slug);
    if (!record) return { hit: false };
    if (Date.now() >= record.expiresAt) {
      this.store.delete(slug);
      return { hit: false };
    }
    return { hit: true, value: record.value };
  }

  setFound(slug: string, value: ResolvedTenant): void {
    this.store.set(slug, { value, expiresAt: Date.now() + this.ttlMs });
  }

  /** Caches "no such tenant" for {@link negTtlMs} — the slug-enumeration mitigation. */
  setNotFound(slug: string): void {
    this.store.set(slug, { value: null, expiresAt: Date.now() + this.negTtlMs });
  }

  /** Forces an immediate miss for `slug`, regardless of remaining TTL — called by tenant-mutation
   * code paths (create/suspend/reactivate/soft-delete/registration-settings) on the same instance
   * that also serves the next request for that slug. Not yet wired to `TenantsService`'s mutation
   * methods this dispatch (see `docs/plans/nextjs-rewrite-phase1-plan.md`'s sub-slice 1a "Decisions
   * made" #5) — this dispatch (1b) is what makes the cache itself exist; wiring every mutation call
   * site is a small follow-up left to whichever dispatch first needs cache-coherent same-instance
   * suspend behavior, since sub-slice 1a's `TenantsService.suspend()`/etc. already call
   * `registry.destroyFor(...)` unconditionally and this cache's own TTL (60s positive / 15s negative)
   * bounds the staleness window regardless.
   */
  invalidate(slug: string): void {
    this.store.delete(slug);
  }

  /** Removes every expired entry regardless of whether it's been read since expiring — prevents an
   * attacker who never re-reads a guessed slug from growing the map unboundedly via lazy-eviction
   * alone. Public for deterministic testing; the constructor's interval already drives it in
   * production. */
  sweepExpired(): void {
    const now = Date.now();
    for (const [slug, record] of this.store) {
      if (record.expiresAt <= now) this.store.delete(slug);
    }
  }

  /** Stops the sweep timer — exposed for tests and a future graceful-shutdown hook (no DI container
   * lifecycle hook exists in this app to call it automatically). */
  destroy(): void {
    clearInterval(this.sweepTimer);
  }
}
