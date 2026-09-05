import type { DataSource } from 'typeorm';
import type pino from 'pino';
import type { EnvVars } from '@/server/config';
import type { TenantDataSourceFactory } from './tenant-data-source-factory';

/** One resident tenant `DataSource` and its bookkeeping (LLD §9.1) — ported verbatim from
 * `legacy/api/src/infrastructure/database/tenant/tenant-data-source-registry.ts`. */
interface RegistryEntry {
  ds: DataSource;
  lastUsedAt: number;
  refCount: number;
}

/** Snapshot returned by {@link TenantDataSourceRegistry.stats} — a future `/api/health/metrics`
 * consumer's read model (not wired to any route yet this dispatch). */
export interface TenantDataSourceRegistryStats {
  resident: number;
  byTenant: Record<string, { refCount: number; pool: number }>;
}

/**
 * The only thing in the system that constructs a pooled tenant `DataSource` (HLD §4.3, LLD §9.1) —
 * ported verbatim (logic unchanged) from `legacy/api/src/infrastructure/database/tenant/
 * tenant-data-source-registry.ts`, adapted from a NestJS `@Injectable()`/`OnModuleDestroy` provider to
 * a plain class this app's `infrastructure/database` barrel constructs and caches on `globalThis` (no
 * DI container/lifecycle hooks in this app — see `../index.ts`'s `getTenantDataSourceRegistry()`).
 *
 * Bounded LRU cache over resident tenants, with idle reaping and refCount-safe eviction:
 *
 * 1. Two concurrent first-requests for the same tenant create exactly one `DataSource` (de-duplicated
 *    via {@link inFlight}).
 * 2. An entry with `refCount > 0` is never destroyed (eviction skips it; `destroyFor` defers).
 * 3. Exceeding `TENANT_REGISTRY_MAX` evicts the least-recently-used *idle* (`refCount === 0`) entry.
 * 4. A destroyed pool is transparently rebuilt on the next `acquire()` for that schema.
 * 5. Callers must `release()` in a `finally` — the registry cannot detect a caller that forgets.
 *
 * The public API exposes only `acquire(schemaName)` / `release(schemaName)` / `destroyFor(schemaName)`
 * — no method could return a different tenant's `DataSource` than the one asked for, and no method
 * accepts a raw query, so an accidental cross-schema query is not expressible through the registry's
 * public API. No request-scoped consumer exists yet in this app (`auth`/tenant-resolution middleware
 * is a later Phase 1 sub-dispatch) — this dispatch's only caller is `TenantsService` (`destroyFor` on
 * suspend/reactivate/soft-delete), proving the registry itself works ahead of that later wiring.
 */
export class TenantDataSourceRegistry {
  private readonly entries = new Map<string, RegistryEntry>();
  private readonly inFlight = new Map<string, Promise<DataSource>>();
  /** Entries removed from {@link entries} by `destroyFor` while still in use (`refCount > 0`),
   * awaiting their last `release()` before actual teardown (invariant 2). See the identical field in
   * the legacy registry for the documented "schema-name-keyed, not handle-keyed" limitation. */
  private readonly pendingDestroy = new Map<string, RegistryEntry>();
  private readonly idleReapTimer: NodeJS.Timeout;

  constructor(
    private readonly factory: TenantDataSourceFactory,
    private readonly env: EnvVars,
    private readonly logger: pino.Logger,
  ) {
    // `.unref()` so this timer never keeps the Node process alive on its own (e.g. during tests or
    // graceful shutdown draining).
    this.idleReapTimer = setInterval(() => this.reapIdle(), this.reapIntervalMs()).unref();
  }

  /** How often idle reaping runs — tied to the configured idle TTL so a tenant is reaped reasonably
   * soon after crossing it, without polling far more often than the TTL could ever matter. */
  private reapIntervalMs(): number {
    return Math.max(1000, Math.min(this.env.TENANT_IDLE_TTL_MS, 60_000));
  }

  /**
   * Returns the pooled `DataSource` for `schemaName`, creating it (and evicting an LRU idle entry
   * first if the registry is at capacity) on first use. Every successful `acquire()` **must** be
   * matched by exactly one `release()`.
   */
  async acquire(schemaName: string): Promise<DataSource> {
    const existing = this.entries.get(schemaName);
    if (existing) {
      existing.refCount += 1;
      existing.lastUsedAt = Date.now();
      return existing.ds;
    }

    let inflight = this.inFlight.get(schemaName);
    const isInitiator = !inflight;
    if (!inflight) {
      inflight = this.buildAndRegister(schemaName);
      this.inFlight.set(schemaName, inflight);
    }

    const ds = await inflight;
    if (!isInitiator) {
      // We joined a creation that another concurrent caller already started; the initiator's own
      // acquisition already set refCount to 1 inside buildAndRegister, so this caller's own use
      // needs its own increment.
      const entry = this.entries.get(schemaName);
      if (entry) {
        entry.refCount += 1;
        entry.lastUsedAt = Date.now();
      }
    }
    return ds;
  }

  /** Decrements `refCount` for `schemaName` (never below zero). If the entry is currently in the live
   * map, this is all that happens (its eventual teardown is `evictIfNeeded`/`reapIdle`'s job). If it
   * was instead moved to {@link pendingDestroy} by `destroyFor` while still in use, and this was the
   * last holder, tears it down now. Safe to call defensively even if the schema is unknown to the
   * registry. */
  release(schemaName: string): void {
    const live = this.entries.get(schemaName);
    if (live) {
      live.refCount = Math.max(0, live.refCount - 1);
      return;
    }
    const pending = this.pendingDestroy.get(schemaName);
    if (!pending) return;
    pending.refCount = Math.max(0, pending.refCount - 1);
    if (pending.refCount === 0) {
      this.pendingDestroy.delete(schemaName);
      this.destroyQuietly(schemaName, pending.ds);
    }
  }

  /** Forces `schemaName`'s pool to be rebuilt on next use (HLD §9.1: "used on suspend/delete/purge").
   * If nothing currently holds a reference, destroys immediately; otherwise moves the entry to
   * {@link pendingDestroy} — removed from the live map right away (so a concurrent `acquire()` always
   * builds a fresh `DataSource` and never reuses the one being torn down) but the actual
   * `DataSource.destroy()` is deferred until the last holder calls `release()` (invariant 2). */
  async destroyFor(schemaName: string): Promise<void> {
    const entry = this.entries.get(schemaName);
    if (!entry) return;
    this.entries.delete(schemaName);
    if (entry.refCount > 0) {
      this.pendingDestroy.set(schemaName, entry);
      return;
    }
    await entry.ds.destroy();
  }

  /** Point-in-time snapshot for a future `/api/health/metrics`-equivalent route. */
  stats(): TenantDataSourceRegistryStats {
    const byTenant: Record<string, { refCount: number; pool: number }> = {};
    for (const [schema, entry] of this.entries) {
      byTenant[schema] = { refCount: entry.refCount, pool: this.env.TENANT_POOL_MAX };
    }
    return { resident: this.entries.size, byTenant };
  }

  /** Public for deterministic testing; production callers never need to invoke this directly — the
   * constructor's interval already drives it. */
  reapIdle(): void {
    const cutoff = Date.now() - this.env.TENANT_IDLE_TTL_MS;
    for (const [schema, entry] of [...this.entries.entries()]) {
      if (entry.refCount === 0 && entry.lastUsedAt <= cutoff) {
        this.entries.delete(schema);
        this.destroyQuietly(schema, entry.ds);
      }
    }
  }

  /** Destroys every resident (and any still-pending-destroy) `DataSource`. No framework lifecycle
   * hook calls this in this app yet (no DI container) — exposed for tests and a future graceful-
   * shutdown hook. */
  async destroyAll(): Promise<void> {
    clearInterval(this.idleReapTimer);
    const all = [...this.entries.values(), ...this.pendingDestroy.values()];
    this.entries.clear();
    this.pendingDestroy.clear();
    await Promise.all(all.map((entry) => entry.ds.destroy().catch(() => undefined)));
  }

  /** Evicts (if needed) then creates and registers a brand-new entry with `refCount = 1` for the
   * initiating caller. Runs entirely inside the `inFlight` promise so concurrent callers awaiting the
   * same promise never race the map mutation. */
  private async buildAndRegister(schemaName: string): Promise<DataSource> {
    try {
      await this.evictIfNeeded();
      const ds = await this.factory.create(schemaName);
      this.entries.set(schemaName, { ds, lastUsedAt: Date.now(), refCount: 1 });
      return ds;
    } finally {
      this.inFlight.delete(schemaName);
    }
  }

  /** Evicts the least-recently-used *idle* entry if the registry is at or above capacity. If every
   * resident entry is currently in use, accepts a transient overshoot rather than destroying a
   * `DataSource` mid-request (invariant 2 takes priority over the cap). */
  private async evictIfNeeded(): Promise<void> {
    const max = this.env.TENANT_REGISTRY_MAX;
    if (this.entries.size < max) return;

    const idle = [...this.entries.entries()].filter(([, entry]) => entry.refCount === 0);
    if (idle.length === 0) return;

    idle.sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt);
    const [lruSchema, lruEntry] = idle[0];
    this.entries.delete(lruSchema);
    // Destroyed off the request path: the caller creating a *new* tenant's DataSource must not wait
    // on the old one's teardown.
    this.destroyQuietly(lruSchema, lruEntry.ds);
  }

  /** Fire-and-forget teardown with error logging — never lets a destroy failure propagate into an
   * unrelated caller's `acquire()`/`release()`/`reapIdle()` call. */
  private destroyQuietly(schemaName: string, ds: DataSource): void {
    void ds.destroy().catch((err: unknown) => {
      this.logger.warn({ err, schema: schemaName }, 'tenant_datasource_destroy_failed');
    });
  }
}
