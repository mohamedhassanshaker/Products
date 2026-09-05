import Redis from "ioredis";

/**
 * BE2 fix (QA fix pass): a basic, real, enforced ceiling on the widget's
 * anonymous, unauthenticated `/api/v1/widget/{sessions,messages}` surface (LLD
 * §5.1 names "per-IP + per-session rate limits" as this surface's contract; none
 * existed — QA verified 100/100 concurrent unauthenticated session-creates
 * succeeded instantly, a live resource-exhaustion vector). Backed by Redis (LLD
 * §2's own cache/rate-limit store, already provisioned in `compose.yaml`/
 * `compose.test.yml` — nothing new to stand up).
 *
 * Deliberately a **fixed-window** counter (`INCR` + a one-time `EXPIRE`), not a
 * sliding window or token bucket — this fix pass's bar is "a real enforced
 * ceiling," not the more precise variant; a fixed window can very slightly
 * over-admit right at a window boundary, which is an acceptable simplification
 * for a resource-exhaustion backstop, not a security-critical precision
 * requirement. Upgrading this to a token-bucket/BullMQ-based limiter is future
 * hardening, not required for this defect's correctness bar.
 */

/** Module-level singleton — `undefined` before first use, a real client after.
 * Never re-created per request (a fresh `ioredis` connection per HTTP request
 * would itself be a resource-exhaustion problem). */
let client: Redis | undefined;

function getRedisUrl(): string {
  const isTest = process.env.NEXTBOT_DB_ENV === "test";
  return (isTest ? process.env.NEXTBOT_REDIS_TEST_URL : process.env.NEXTBOT_REDIS_URL) ?? "redis://localhost:6379";
}

function getClient(): Redis {
  if (!client) {
    client = new Redis(getRedisUrl(), {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      // A hung connection attempt must never make every widget request hang
      // waiting on Redis — better to fail the rate-limit check fast and fall
      // through to `checkRateLimit`'s fail-open catch below.
      connectTimeout: 2000,
    });
    client.on("error", (err) => {
      // node's `EventEmitter` throws if an `error` event has zero listeners — this
      // handler's only job is to prevent that crash; the actual failure handling
      // lives in `checkRateLimit`'s try/catch around each call.
      console.error("NextBot gateway: Redis rate-limit client error", err);
    });
  }
  return client;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
}

/**
 * Increments `key`'s counter for the current fixed window and reports whether
 * `limit` has been exceeded.
 *
 * **Fails open, deliberately:** if Redis is unreachable, this returns
 * `{ allowed: true, ... }` rather than throwing — a Redis outage must never take
 * down the entire widget ingress surface (a hard dependency here would turn a
 * transient Redis blip into a total widget outage, a worse failure mode than the
 * resource-exhaustion gap this function exists to close). The error is logged
 * server-side so an actual outage is still observable.
 *
 * @param key unique per rate-limited subject, e.g. `widget-session:<ip>` or
 *   `widget-message:<conversationId>` — namespaced with `nextbot:ratelimit:` so
 *   these keys are visually distinguishable in Redis from any other cache use.
 * @param limit maximum allowed increments within `windowSeconds`.
 * @param windowSeconds fixed-window length.
 */
export async function checkRateLimit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
  const fullKey = `nextbot:ratelimit:${key}`;
  try {
    const redis = getClient();
    const count = await redis.incr(fullKey);
    if (count === 1) {
      // Only the increment that *created* the key sets its TTL — every subsequent
      // increment within the same window must not keep pushing the expiry out
      // (that would turn a fixed window into an unbounded one under sustained
      // traffic).
      await redis.expire(fullKey, windowSeconds);
    }
    return { allowed: count <= limit, remaining: Math.max(0, limit - count), limit };
  } catch (err) {
    console.error(`NextBot gateway: rate limit check failed for "${fullKey}", failing open`, err);
    return { allowed: true, remaining: limit, limit };
  }
}

/** Test-only: closes and clears the module-level client so a test can reconnect
 * cleanly (e.g. after pointing `NEXTBOT_REDIS_TEST_URL` at a fresh instance). */
export async function _resetRateLimitClientForTests(): Promise<void> {
  if (client) {
    await client.quit().catch(() => {});
  }
  client = undefined;
}
