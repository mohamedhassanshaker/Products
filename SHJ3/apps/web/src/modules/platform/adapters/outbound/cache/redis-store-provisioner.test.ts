import { beforeEach, describe, expect, it } from "vitest";
import { assertValidSlugShape, redisPrefixFor } from "../../../tenancy/tenant-slug.js";
import type { TenantSlug } from "../../../tenancy/tenant-slug.js";
import { RedisStoreProvisioner } from "./redis-store-provisioner.js";
import type { TenantCache } from "./tenant-cache.js";

/**
 * Tests for the Redis limb of provisioning.
 *
 * Two things are being pinned down.
 *
 * **The sentinel decision.** Redis is not backed up (ADR-0003 rule 2), so the sentinel can
 * vanish under a legitimately provisioned tenant. `verify` therefore reports the literal
 * truth rather than self-healing: a check that repairs what it is measuring cannot fail,
 * and the provisioning use case leans on this method to tell it whether the isolation unit
 * exists. The test that matters is the one asserting a flushed Redis makes `verify` false
 * *without* the sentinel being rewritten — and that `create` then repairs it, which is
 * RB-11's path.
 *
 * **Prefix-bounded erasure.** The sweep must never be able to touch another government
 * entity's keys. The handle is prefix-bounded by construction, so what is tested here is
 * that the sweep terminates, confirms with repeated empty passes rather than one, and
 * removes the sentinel last.
 *
 * Covers FR-PLAT-02 and FR-PLAT-04.
 */

const SEWA = assertValidSlugShape("sewa");
const SENTINEL = "__provisioned";
const NOW = new Date("2026-09-08T09:00:00.000Z");

/**
 * An in-memory Redis whose keys are physical — prefixed exactly as the real handle would
 * write them — so a sweep that escaped its prefix would be visible here.
 */
class FakeRedis {
  readonly keys = new Map<string, string>();
  scanCalls = 0;
  deleted: string[][] = [];

  handleFor(slug: TenantSlug): TenantCache {
    const prefix = redisPrefixFor(slug);
    const physical = (key: string) => `${prefix}${key}`;

    return {
      prefix,
      get: async (key) => this.keys.get(physical(key)) ?? null,
      set: async (key, value) => {
        this.keys.set(physical(key), value);
      },
      setIfAbsent: async (key, value) => {
        if (this.keys.has(physical(key))) return false;
        this.keys.set(physical(key), value);
        return true;
      },
      del: async (...keys) => {
        this.deleted.push([...keys]);
        let removed = 0;
        for (const key of keys) if (this.keys.delete(physical(key))) removed += 1;
        return removed;
      },
      incr: async () => 0,
      expire: async () => undefined,
      ttl: async () => -1,
      scanKeys: async (pattern, limit = 1000) => {
        this.scanCalls += 1;
        const matcher = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
        return [...this.keys.keys()]
          .filter((key) => matcher.test(key))
          .map((key) => key.slice(prefix.length))
          .filter((key) => pattern === "*" || key === pattern)
          .slice(0, limit);
      },
      pushQueue: async () => undefined,
      popQueue: async () => [],
    };
  }
}

let redis: FakeRedis;

beforeEach(() => {
  redis = new FakeRedis();
});

function provisioner(): RedisStoreProvisioner {
  return new RedisStoreProvisioner({
    cacheFor: (slug) => redis.handleFor(slug),
    now: () => NOW,
  });
}

describe("RedisStoreProvisioner", () => {
  it("declares the Redis store, which orders it last in PROVISIONING_STORES", () => {
    expect(provisioner().store).toBe("Redis");
  });
});

describe("create", () => {
  it("claims the namespace with a sentinel under the tenant's prefix", async () => {
    await provisioner().create(SEWA);

    expect(redis.keys.get(`sewa:${SENTINEL}`)).toBe(NOW.toISOString());
  });

  it("writes nothing outside the tenant's prefix", async () => {
    await provisioner().create(SEWA);

    expect([...redis.keys.keys()].every((key) => key.startsWith("sewa:"))).toBe(true);
  });

  it("gives the sentinel no expiry, because it marks a fact with no expiry date", async () => {
    // `set` without a TTL. A sentinel that expired would make a healthy tenant fail
    // verification on a timer.
    const cache = redis.handleFor(SEWA);
    await provisioner().create(SEWA);

    expect(await cache.ttl(SENTINEL)).toBe(-1);
  });

  it("refreshes the timestamp on a re-run, so a recreated sentinel is distinguishable", async () => {
    await provisioner().create(SEWA);

    const later = new Date("2026-09-09T09:00:00.000Z");
    await new RedisStoreProvisioner({
      cacheFor: (slug) => redis.handleFor(slug),
      now: () => later,
    }).create(SEWA);

    // That is how an operator following RB-11 tells "this tenant was re-provisioned" apart
    // from "this Redis was flushed".
    expect(redis.keys.get(`sewa:${SENTINEL}`)).toBe(later.toISOString());
  });

  it("is idempotent", async () => {
    await provisioner().create(SEWA);
    await expect(provisioner().create(SEWA)).resolves.toBeUndefined();
  });

  it("fails when the sentinel cannot be read back", async () => {
    // A Redis that cannot hold a key written a millisecond ago is broken, and finding out
    // during provisioning is much better than finding out on a citizen's first message.
    const amnesiac = new RedisStoreProvisioner({
      cacheFor: (slug) => ({ ...redis.handleFor(slug), get: async () => null }),
      now: () => NOW,
    });

    await expect(amnesiac.create(SEWA)).rejects.toThrow(/cannot be claimed/);
  });
});

describe("verify", () => {
  it("is false before provisioning", async () => {
    expect(await provisioner().verify(SEWA)).toBe(false);
  });

  it("is true once the namespace is claimed", async () => {
    await provisioner().create(SEWA);
    expect(await provisioner().verify(SEWA)).toBe(true);
  });

  it("is false after a flush, and does not silently rewrite the sentinel", async () => {
    // THE test for the sentinel decision. A `verify` that repaired what it measures could
    // never fail, and the provisioning use case relies on it to confirm the step.
    await provisioner().create(SEWA);
    redis.keys.clear();

    expect(await provisioner().verify(SEWA)).toBe(false);
    expect(redis.keys.size).toBe(0);
  });

  it("recovers by re-running create, which is what RB-11 does", async () => {
    // A missing sentinel is a re-creatable condition, not a provisioning failure: the
    // authority on whether a tenant is provisioned is the registry row in SQL Server,
    // which *is* backed up. The sentinel is evidence, not truth.
    await provisioner().create(SEWA);
    redis.keys.clear();

    await provisioner().create(SEWA);

    expect(await provisioner().verify(SEWA)).toBe(true);
  });

  it("does not read another tenant's sentinel", async () => {
    await provisioner().create(SEWA);

    expect(await provisioner().verify(assertValidSlugShape("customs"))).toBe(false);
  });

  it("is false after destroy, which is what confirms the rollback", async () => {
    await provisioner().create(SEWA);
    await provisioner().destroy(SEWA);

    expect(await provisioner().verify(SEWA)).toBe(false);
  });
});

describe("destroy", () => {
  it("removes every key under the tenant's prefix", async () => {
    await provisioner().create(SEWA);
    redis.keys.set("sewa:session:abc", "{}");
    redis.keys.set("sewa:breaker:tool_x", "open");
    redis.keys.set("sewa:ratelimit:citizen_1", "3");

    await provisioner().destroy(SEWA);

    expect([...redis.keys.keys()].filter((key) => key.startsWith("sewa:"))).toEqual([]);
  });

  it("leaves other tenants untouched", async () => {
    // The reason `FLUSHDB` is forbidden: it would erase every other government entity's
    // sessions as a side effect of a single-tenant operation.
    await provisioner().create(SEWA);
    redis.keys.set("customs:session:abc", "{}");
    redis.keys.set("customs:__provisioned", NOW.toISOString());

    await provisioner().destroy(SEWA);

    expect(redis.keys.get("customs:session:abc")).toBe("{}");
    expect(redis.keys.get("customs:__provisioned")).toBe(NOW.toISOString());
  });

  it("removes the sentinel last, so an interrupted sweep is still identifiable", async () => {
    await provisioner().create(SEWA);
    redis.keys.set("sewa:session:abc", "{}");

    await provisioner().destroy(SEWA);

    const flattened = redis.deleted.flat();
    expect(flattened.indexOf("session:abc")).toBeLessThan(flattened.lastIndexOf(SENTINEL));
  });

  it("confirms with repeated empty passes rather than one", async () => {
    // SCAN is a cursor over a mutating keyspace, so a single empty pass is not proof.
    await provisioner().create(SEWA);
    await provisioner().destroy(SEWA);

    expect(redis.scanCalls).toBeGreaterThanOrEqual(3);
  });

  it("tolerates a namespace that was never claimed", async () => {
    // Rollback runs after a failure and cannot assume what got created.
    await expect(provisioner().destroy(SEWA)).resolves.toBeUndefined();
  });

  it("reports residue rather than looping forever when keys keep reappearing", async () => {
    // A rollback that never returns is strictly worse than one that reports residue and
    // lets RB-10 take over.
    const busy = new RedisStoreProvisioner({
      cacheFor: (slug) => ({
        ...redis.handleFor(slug),
        scanKeys: async () => ["session:reappears"],
        del: async () => 0,
      }),
      now: () => NOW,
    });

    await expect(busy.destroy(SEWA)).rejects.toThrow(/keys keep reappearing/);
  });
});

describe("isNamespaceEmpty", () => {
  it("is true for an unclaimed namespace", async () => {
    expect(await provisioner().isNamespaceEmpty(SEWA)).toBe(true);
  });

  it("is false while the sentinel is present", async () => {
    // Deliberately a different question from `verify`: this asks whether anything is left
    // in the namespace, which is the post-destroy assertion.
    await provisioner().create(SEWA);
    expect(await provisioner().isNamespaceEmpty(SEWA)).toBe(false);
  });

  it("is true after destroy", async () => {
    await provisioner().create(SEWA);
    redis.keys.set("sewa:session:abc", "{}");

    await provisioner().destroy(SEWA);

    expect(await provisioner().isNamespaceEmpty(SEWA)).toBe(true);
  });
});
