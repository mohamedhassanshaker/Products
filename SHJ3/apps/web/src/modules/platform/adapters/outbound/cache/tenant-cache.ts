/**
 * Tenant-scoped Redis access.
 *
 * ADR-0002 rule 3 again, and the pattern here is the clearest example of why the
 * rule is phrased as "unscoped clients are not exported" rather than "remember
 * to add the prefix".
 *
 * Redis has no schemas, databases-per-tenant or collections, so its isolation
 * unit is a key prefix. A prefix applied *per call* is a rule that has to hold
 * at every call site forever. A prefix applied by a wrapper that owns the only
 * reference to the client is a rule that holds because there is no other way to
 * issue a command.
 *
 * So: the raw client is module-private, and every method on the returned handle
 * prepends the prefix internally. `getTenantCache().get("session:x")` reads
 * `sewa:session:x` and there is no path by which an unprefixed key can be
 * written.
 *
 * ## What may live here
 *
 * Ephemeral state only (ADR-0003): chat sessions, circuit-breaker state, rate
 * limits, the campaign queue, short-lived caches. Redis is deliberately not
 * backed up, so anything whose loss would destroy a record belongs in SQL
 * Server. The rule ADR-0003 settled on after review: **if losing a key can cause
 * a side effect to repeat, the key is not ephemeral** — which is why payment
 * idempotency is a unique constraint on the transaction row and only its
 * short-lived in-flight lock is here.
 */

import { createClient, type RedisClientType } from "redis";
import { currentTenant, requireTenantContext } from "../../../tenancy/tenant-context.js";
import { redisPrefixFor, type TenantSlug } from "../../../tenancy/tenant-slug.js";

/**
 * Module-private. Never exported, never returned, never reachable from a feature
 * module — the `no-unscoped-store-clients` gate fails the build if anything
 * re-exports it.
 */
let raw: RedisClientType | null = null;
let connecting: Promise<RedisClientType> | null = null;

async function connection(): Promise<RedisClientType> {
  if (raw?.isReady) return raw;
  if (connecting) return connecting;

  const url = process.env.SHJ3_REDIS_URL;
  if (!url) {
    throw new Error(
      "SHJ3_REDIS_URL is not set. The process should have refused to start — check the boot-time config validation.",
    );
  }

  connecting = (async () => {
    const client: RedisClientType = createClient({ url });
    // A Redis outage degrades conversations; it must not crash the process.
    // ADR-0003 rule 2 is what makes that an acceptable posture.
    client.on("error", (error) => {
      console.error("[redis] client error", { message: (error as Error).message });
    });
    await client.connect();
    raw = client;
    connecting = null;
    return client;
  })();

  return connecting;
}

/**
 * A tenant-scoped cache handle.
 *
 * Intentionally a narrow surface rather than a passthrough of the whole Redis
 * API. Two reasons: a narrow surface is auditable, and every command that could
 * take a key pattern (`KEYS`, `SCAN`, `FLUSHDB`) is either absent or
 * prefix-bounded, so no caller can enumerate outside its tenant.
 */
export interface TenantCache {
  readonly prefix: string;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  /** Returns true only if the key did not already exist — the lock primitive. */
  setIfAbsent(key: string, value: string, ttlSeconds: number): Promise<boolean>;
  del(...keys: string[]): Promise<number>;
  incr(key: string): Promise<number>;
  expire(key: string, ttlSeconds: number): Promise<void>;
  ttl(key: string): Promise<number>;
  /** Prefix-bounded scan. Cannot escape the tenant: the pattern is prefixed. */
  scanKeys(patternWithinTenant: string, limit?: number): Promise<string[]>;
  /** Campaign queue append (B10 tab 4). Durable truth stays in SQL Server. */
  pushQueue(queue: string, payload: string): Promise<void>;
  popQueue(queue: string, count: number): Promise<string[]>;
}

function handleFor(slug: TenantSlug): TenantCache {
  const prefix = redisPrefixFor(slug);
  const k = (key: string) => `${prefix}${key}`;

  return {
    prefix,

    async get(key) {
      return (await connection()).get(k(key));
    },

    async set(key, value, ttlSeconds) {
      const client = await connection();
      if (ttlSeconds === undefined) {
        await client.set(k(key), value);
      } else {
        await client.set(k(key), value, { EX: ttlSeconds });
      }
    },

    async setIfAbsent(key, value, ttlSeconds) {
      const client = await connection();
      const result = await client.set(k(key), value, { NX: true, EX: ttlSeconds });
      return result === "OK";
    },

    async del(...keys) {
      if (keys.length === 0) return 0;
      const client = await connection();
      return client.del(keys.map(k));
    },

    async incr(key) {
      return (await connection()).incr(k(key));
    },

    async expire(key, ttlSeconds) {
      await (await connection()).expire(k(key), ttlSeconds);
    },

    async ttl(key) {
      return (await connection()).ttl(k(key));
    },

    async scanKeys(patternWithinTenant, limit = 1000) {
      const client = await connection();
      const found: string[] = [];
      let cursor = "0";
      do {
        // SCAN rather than KEYS: KEYS blocks the server, and a tenant sweep
        // during erasure could be large.
        const reply = await client.scan(cursor, {
          MATCH: k(patternWithinTenant),
          COUNT: 250,
        });
        cursor = String(reply.cursor);
        // Strip the prefix so callers see keys in their own namespace and never
        // learn the physical key shape.
        for (const key of reply.keys) found.push(key.slice(prefix.length));
        if (found.length >= limit) break;
      } while (cursor !== "0");
      return found.slice(0, limit);
    },

    async pushQueue(queue, payload) {
      await (await connection()).rPush(k(queue), payload);
    },

    async popQueue(queue, count) {
      const client = await connection();
      const items: string[] = [];
      for (let i = 0; i < count; i++) {
        const item = await client.lPop(k(queue));
        if (item === null) break;
        items.push(item);
      }
      return items;
    },
  };
}

/** **The only way feature code reaches Redis.** */
export function getTenantCache(operation = "cache access"): TenantCache {
  return handleFor(currentTenant(operation));
}

/**
 * A cache handle for a tenant **other than** the bound one.
 *
 * Provisioning is the one operation that legitimately needs this: it acts on a tenant
 * that does not yet exist, so there is no principal to resolve a context from and
 * `getTenantCache()` has nothing to return. The alternative would be a Redis client
 * constructed inside the provisioning adapter, which would put a second raw client in the
 * codebase and defeat the reason this module keeps the only one private (ADR-0002 rule 3).
 *
 * So it is exported here, deliberately narrow and gated exactly as `getPlatformDb()` is:
 * the caller must be inside a context that declared `platformScope: "provisioning"`, and
 * that scope is one of the two audited cross-tenant paths (ADR-0002 rule 5). The handle
 * it returns is still prefix-bounded — this widens *which* tenant may be addressed, never
 * whether the prefix applies.
 */
export function getProvisioningCache(
  slug: TenantSlug,
  operation = "cache provisioning",
): TenantCache {
  const context = requireTenantContext(operation);
  if (context.platformScope !== "provisioning") {
    throw new Error(
      `"${operation}" addressed another tenant's cache namespace without a provisioning scope. ` +
        "Only tenant provisioning may do that (ADR-0002 rule 5); it must run inside " +
        'runWithTenant({ platformScope: "provisioning" }) and write an audit entry.',
    );
  }
  return handleFor(slug);
}

/** Close the connection. Shutdown, and between integration tests. */
export async function disconnectCache(): Promise<void> {
  const client = raw;
  raw = null;
  connecting = null;
  if (client?.isOpen) await client.quit();
}
