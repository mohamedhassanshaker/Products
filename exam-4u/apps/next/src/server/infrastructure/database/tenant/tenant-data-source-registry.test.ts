import { describe, expect, it, vi } from 'vitest';
import type { EnvVars } from '@/server/config';
import type { TenantDataSourceFactory } from './tenant-data-source-factory';
import { TenantDataSourceRegistry } from './tenant-data-source-registry';

/**
 * Pure-logic unit tests for the LRU/refcount/idle-reaping registry (migration plan's "Per-phase
 * verification" item 4) — a fake {@link TenantDataSourceFactory} stands in for a real MySQL
 * connection, so every invariant documented on the class itself (dedup concurrent acquires, refCount-
 * safe eviction, deferred destroy, idle reaping) is exercised without a real database.
 */

function fakeDs(schema: string) {
  return { schema, destroy: vi.fn(async () => undefined) } as unknown as { schema: string; destroy: () => Promise<void> };
}

function createFakeEnv(overrides: Partial<EnvVars> = {}): EnvVars {
  return {
    TENANT_POOL_MAX: 3,
    TENANT_REGISTRY_MAX: 2,
    TENANT_IDLE_TTL_MS: 900_000,
    ...overrides,
  } as EnvVars;
}

function createFakeLogger() {
  return { warn: vi.fn(), info: vi.fn(), error: vi.fn() } as never;
}

describe('TenantDataSourceRegistry', () => {
  it('creates exactly one DataSource for two concurrent acquire() calls on the same schema', async () => {
    let createCalls = 0;
    const factory: TenantDataSourceFactory = {
      create: vi.fn(async (schema: string) => {
        createCalls += 1;
        await new Promise((r) => setTimeout(r, 5));
        return fakeDs(schema) as never;
      }),
    };
    const registry = new TenantDataSourceRegistry(factory, createFakeEnv(), createFakeLogger());

    const [a, b] = await Promise.all([registry.acquire('t_a'), registry.acquire('t_a')]);
    expect(a).toBe(b);
    expect(createCalls).toBe(1);

    await registry.destroyAll();
  });

  it('acquire() increments refCount; release() decrements it without destroying a live entry', async () => {
    const factory: TenantDataSourceFactory = { create: vi.fn(async (s: string) => fakeDs(s) as never) };
    const registry = new TenantDataSourceRegistry(factory, createFakeEnv(), createFakeLogger());

    const ds = await registry.acquire('t_a');
    registry.release('t_a');
    // Still resolvable (not destroyed) after a single release matching a single acquire.
    const again = await registry.acquire('t_a');
    expect(again).toBe(ds);

    await registry.destroyAll();
  });

  it('destroyFor() destroys immediately when nothing holds a reference', async () => {
    const ds = fakeDs('t_a');
    const factory: TenantDataSourceFactory = { create: vi.fn(async () => ds as never) };
    const registry = new TenantDataSourceRegistry(factory, createFakeEnv(), createFakeLogger());

    await registry.acquire('t_a');
    registry.release('t_a'); // refCount back to 0
    await registry.destroyFor('t_a');

    expect(ds.destroy).toHaveBeenCalledTimes(1);
  });

  it('destroyFor() defers actual teardown until the last release() when still in use', async () => {
    const ds = fakeDs('t_a');
    const factory: TenantDataSourceFactory = { create: vi.fn(async () => ds as never) };
    const registry = new TenantDataSourceRegistry(factory, createFakeEnv(), createFakeLogger());

    await registry.acquire('t_a'); // refCount = 1
    await registry.destroyFor('t_a'); // still in use — deferred
    expect(ds.destroy).not.toHaveBeenCalled();

    registry.release('t_a'); // last holder releases — now torn down
    expect(ds.destroy).toHaveBeenCalledTimes(1);
  });

  it('a schema re-acquired after destroyFor gets a brand-new DataSource', async () => {
    let instance = 0;
    const factory: TenantDataSourceFactory = {
      create: vi.fn(async (s: string) => {
        instance += 1;
        return fakeDs(`${s}-${instance}`) as never;
      }),
    };
    const registry = new TenantDataSourceRegistry(factory, createFakeEnv(), createFakeLogger());

    const first = await registry.acquire('t_a');
    registry.release('t_a');
    await registry.destroyFor('t_a');

    const second = await registry.acquire('t_a');
    expect(second).not.toBe(first);

    await registry.destroyAll();
  });

  it('evicts the least-recently-used idle entry when at capacity (TENANT_REGISTRY_MAX)', async () => {
    const destroyed: string[] = [];
    const factory: TenantDataSourceFactory = {
      create: vi.fn(async (s: string) => {
        const d = fakeDs(s);
        d.destroy = vi.fn(async () => {
          destroyed.push(s);
        });
        return d as never;
      }),
    };
    // Capacity of 2: acquiring a 3rd idle schema must evict the LRU idle one.
    const registry = new TenantDataSourceRegistry(factory, createFakeEnv({ TENANT_REGISTRY_MAX: 2 }), createFakeLogger());

    await registry.acquire('t_a');
    registry.release('t_a');
    await new Promise((r) => setTimeout(r, 2));
    await registry.acquire('t_b');
    registry.release('t_b');
    await new Promise((r) => setTimeout(r, 2));
    await registry.acquire('t_c'); // registry now at/over capacity — evicts t_a (oldest idle)
    registry.release('t_c');

    // Eviction destroys off-path (fire-and-forget) — poll briefly for the async destroy to land.
    await new Promise((r) => setTimeout(r, 20));
    expect(destroyed).toContain('t_a');

    await registry.destroyAll();
  });

  it('never evicts an entry with refCount > 0, even at capacity (accepts transient overshoot)', async () => {
    const destroyed: string[] = [];
    const factory: TenantDataSourceFactory = {
      create: vi.fn(async (s: string) => {
        const d = fakeDs(s);
        d.destroy = vi.fn(async () => {
          destroyed.push(s);
        });
        return d as never;
      }),
    };
    const registry = new TenantDataSourceRegistry(factory, createFakeEnv({ TENANT_REGISTRY_MAX: 1 }), createFakeLogger());

    await registry.acquire('t_a'); // held (refCount 1) — never released in this test
    await registry.acquire('t_b'); // registry at capacity, but t_a is in use — must not be evicted

    await new Promise((r) => setTimeout(r, 10));
    expect(destroyed).not.toContain('t_a');

    await registry.destroyAll();
  });

  it('reapIdle() destroys entries idle past TENANT_IDLE_TTL_MS and leaves recently-used ones alone', async () => {
    const destroyed: string[] = [];
    const factory: TenantDataSourceFactory = {
      create: vi.fn(async (s: string) => {
        const d = fakeDs(s);
        d.destroy = vi.fn(async () => {
          destroyed.push(s);
        });
        return d as never;
      }),
    };
    // A negative-ish TTL (0ms) means "idle immediately" — deterministic without real sleeping.
    const registry = new TenantDataSourceRegistry(factory, createFakeEnv({ TENANT_IDLE_TTL_MS: 1 }), createFakeLogger());

    await registry.acquire('t_a');
    registry.release('t_a');
    await new Promise((r) => setTimeout(r, 5)); // ensure lastUsedAt is now older than the 1ms TTL

    registry.reapIdle();
    await new Promise((r) => setTimeout(r, 5));
    expect(destroyed).toContain('t_a');

    await registry.destroyAll();
  });

  it('stats() reports resident count and per-tenant refCount/pool size', async () => {
    const factory: TenantDataSourceFactory = { create: vi.fn(async (s: string) => fakeDs(s) as never) };
    const registry = new TenantDataSourceRegistry(factory, createFakeEnv({ TENANT_POOL_MAX: 7 }), createFakeLogger());

    await registry.acquire('t_a');
    const snapshot = registry.stats();
    expect(snapshot.resident).toBe(1);
    expect(snapshot.byTenant.t_a).toEqual({ refCount: 1, pool: 7 });

    await registry.destroyAll();
  });

  it('destroyAll() tears down every resident and pending-destroy entry', async () => {
    const dsA = fakeDs('t_a');
    const factory: TenantDataSourceFactory = { create: vi.fn(async () => dsA as never) };
    const registry = new TenantDataSourceRegistry(factory, createFakeEnv(), createFakeLogger());

    await registry.acquire('t_a');
    await registry.destroyAll();

    expect(dsA.destroy).toHaveBeenCalled();
  });

  it('release() on an unknown schema is a safe no-op', () => {
    const factory: TenantDataSourceFactory = { create: vi.fn(async (s: string) => fakeDs(s) as never) };
    const registry = new TenantDataSourceRegistry(factory, createFakeEnv(), createFakeLogger());
    expect(() => registry.release('never-acquired')).not.toThrow();
  });
});
