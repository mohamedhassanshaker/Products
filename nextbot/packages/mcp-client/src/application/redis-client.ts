import Redis from "ioredis";

/**
 * Shared Redis client for `@nextbot/mcp-client`'s circuit-breaker state (Phase 18,
 * BL-11). Mirrors `apps/gateway/src/lib/rate-limit.ts`'s connection-handling
 * convention exactly (lazy singleton, short connect timeout, fail-open on error,
 * test-only reset hook) rather than inventing a second Redis-wiring pattern.
 *
 * This is the fix for the cross-process gap the Phase 14/16 BE2 in-memory breaker
 * flagged: `apps/gateway` and `apps/web` are separate Node processes (ADR-0002), so
 * an in-memory `Map` in each could never agree on trip state. Redis is already
 * provisioned per-environment infra (`compose.yaml`/`compose.test.yml`), so both
 * processes reading/writing the same keys here gives genuine cross-process breaker
 * state without introducing a new dependency.
 */
let client: Redis | undefined;

function getRedisUrl(): string {
  const isTest = process.env.NEXTBOT_DB_ENV === "test";
  return (isTest ? process.env.NEXTBOT_REDIS_TEST_URL : process.env.NEXTBOT_REDIS_URL) ?? "redis://localhost:6379";
}

/** Lazily creates (or returns) the module-level Redis singleton. Never re-created
 * per call — a fresh connection per breaker check would itself be a resource
 * problem under load. */
export function getBreakerRedisClient(): Redis {
  if (!client) {
    client = new Redis(getRedisUrl(), {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
    });
    client.on("error", (err) => {
      // Required so a zero-listener "error" event never crashes the process; the
      // real handling is each caller's own try/catch fail-open path.
      console.error("NextBot mcp-client: Redis breaker client error", err);
    });
  }
  return client;
}

/** Test-only: closes and clears the singleton so a test can reconnect cleanly. */
export async function _resetBreakerRedisClientForTests(): Promise<void> {
  if (client) {
    await client.quit().catch(() => {});
  }
  client = undefined;
}
