import "server-only";
import Redis from "ioredis";

/**
 * Phase 13 (BL-06) — a real, enforced ceiling on the conversation export endpoint
 * (`GET /api/v1/admin/conversations/export`), which accepts caller-controlled filter/
 * volume parameters and can otherwise be hit repeatedly to force expensive full-table
 * scans/CSV serialization (a resource-exhaustion vector on an *authenticated* admin
 * surface, distinct from the widget's anonymous-surface rate limiter but the same
 * mechanism). Mirrors `apps/gateway/src/lib/rate-limit.ts`'s fixed-window Redis
 * counter exactly (same fail-open-on-Redis-outage rationale) — duplicated rather than
 * imported because `apps/gateway`'s `src/lib/*` is app-private, not a shared package,
 * and this project has no dedicated `@nextbot/rate-limit` package yet; promoting this
 * into one is a reasonable future consolidation, not required for this fix's scope.
 */
let client: Redis | undefined;

function getRedisUrl(): string {
  const isTest = process.env.NEXTBOT_DB_ENV === "test";
  return (isTest ? process.env.NEXTBOT_REDIS_TEST_URL : process.env.NEXTBOT_REDIS_URL) ?? "redis://localhost:6379";
}

function getClient(): Redis {
  if (!client) {
    client = new Redis(getRedisUrl(), { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 2000 });
    client.on("error", (err) => {
      console.error("NextBot web: Redis rate-limit client error", err);
    });
  }
  return client;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
}

/** Fails open on a Redis outage (never take down the whole admin export surface over
 * a transient cache blip) — see `apps/gateway/src/lib/rate-limit.ts`'s identical doc. */
export async function checkRateLimit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
  const fullKey = `nextbot:ratelimit:${key}`;
  try {
    const redis = getClient();
    const count = await redis.incr(fullKey);
    if (count === 1) await redis.expire(fullKey, windowSeconds);
    return { allowed: count <= limit, remaining: Math.max(0, limit - count), limit };
  } catch (err) {
    console.error(`NextBot web: rate limit check failed for "${fullKey}", failing open`, err);
    return { allowed: true, remaining: limit, limit };
  }
}

/** Test-only: closes and clears the module-level client. */
export async function _resetRateLimitClientForTests(): Promise<void> {
  if (client) await client.quit().catch(() => {});
  client = undefined;
}
