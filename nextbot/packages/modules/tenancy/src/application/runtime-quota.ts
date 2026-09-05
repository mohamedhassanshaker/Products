import Redis from "ioredis";
import { eq } from "drizzle-orm";
import { QuotaExceededError } from "@nextbot/contracts";
import { schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";

/**
 * Phase 18 (BL-11, FR-AGT-10/NFR-4/NFR-4a) — live enforcement of
 * `tenant_runtime_quota` (seeded from `plan_tier` at provisioning, Phase 1). This is
 * the "noisy-neighbour bulkhead" HLD §11 describes: a tenant that would otherwise
 * saturate shared resources is capped in real time, with a distinct
 * "quota exceeded for your plan" error (never a generic 500/429) so the caller can
 * render the right message per NFR-4a.
 *
 * Counters live in Redis (already-provisioned shared infra, same connection
 * convention as `apps/gateway/src/lib/rate-limit.ts` and `mcp-client`'s circuit
 * breaker) rather than Postgres — a per-request quota check must be cheap and must
 * not itself become a contention point on the primary database under load.
 *
 * **Fails open** on a Redis outage, exactly like the rate limiter and breaker: a
 * transient Redis blip must not turn into every tenant being denied service, which
 * would be a worse failure mode than the noisy-neighbour problem this guards
 * against.
 */

let client: Redis | undefined;
function getClient(): Redis {
  if (!client) {
    const isTest = process.env.NEXTBOT_DB_ENV === "test";
    const url = (isTest ? process.env.NEXTBOT_REDIS_TEST_URL : process.env.NEXTBOT_REDIS_URL) ?? "redis://localhost:6379";
    client = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 2000 });
    client.on("error", (err) => console.error("NextBot tenancy: Redis quota client error", err));
  }
  return client;
}

/** Test-only: closes and clears the singleton. */
export async function _resetRuntimeQuotaClientForTests(): Promise<void> {
  if (client) await client.quit().catch(() => {});
  client = undefined;
}

/** Reads this tenant's live quota row (NULL fields mean "no cap"). */
export async function getRuntimeQuota(ctx: TenantContext) {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select()
      .from(schema.tenantRuntimeQuota)
      .where(eq(schema.tenantRuntimeQuota.tenantId, ctx.tenantId));
    return rows[0] ?? null;
  });
}

/**
 * Claims one concurrent-run "slot" for the duration of a turn-pipeline invocation.
 * Returns a `release()` callback the caller MUST invoke (in a `finally`) once the
 * run completes, regardless of outcome — an unreleased slot would permanently leak
 * capacity from the tenant's gauge.
 *
 * @throws QuotaExceededError if `maxConcurrentRuns` (NULL = no cap) would be exceeded.
 */
export async function claimConcurrentRunSlot(ctx: TenantContext): Promise<() => Promise<void>> {
  const quota = await getRuntimeQuota(ctx);
  const limit = quota?.maxConcurrentRuns ?? null;
  const key = `nextbot:quota:concurrent-runs:${ctx.tenantId}`;
  if (limit === null) {
    return async () => {};
  }
  try {
    const redis = getClient();
    const current = await redis.incr(key);
    // The gauge must never grow unbounded if a process crashes without releasing —
    // a short TTL (refreshed on every increment) bounds the blast radius of a leaked
    // slot to a few minutes rather than forever.
    await redis.expire(key, 300);
    if (current > limit) {
      await redis.decr(key);
      throw new QuotaExceededError("ConcurrentRuns");
    }
  } catch (err) {
    if (err instanceof QuotaExceededError) throw err;
    console.error("NextBot tenancy: concurrent-run quota check failed, failing open", err);
    return async () => {};
  }
  return async () => {
    try {
      await getClient().decr(key);
    } catch (err) {
      console.error("NextBot tenancy: failed to release concurrent-run slot", err);
    }
  };
}

/**
 * Fixed-window (1s) tool-calls/sec check, mirroring `checkRateLimit`'s convention.
 * @throws QuotaExceededError if `maxToolCallsPerSecond` (NULL = no cap) is exceeded.
 */
export async function checkToolCallRate(ctx: TenantContext): Promise<void> {
  const quota = await getRuntimeQuota(ctx);
  const limit = quota?.maxToolCallsPerSecond ?? null;
  if (limit === null) return;
  const key = `nextbot:quota:tool-calls-sec:${ctx.tenantId}:${Math.floor(Date.now() / 1000)}`;
  try {
    const redis = getClient();
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, 2);
    if (count > limit) throw new QuotaExceededError("ToolCallsPerSecond");
  } catch (err) {
    if (err instanceof QuotaExceededError) throw err;
    console.error("NextBot tenancy: tool-call rate quota check failed, failing open", err);
  }
}

/** Live count of in-flight runs — the operator console's "concurrent runs" gauge. */
export async function getLiveConcurrentRunCount(tenantId: string): Promise<number> {
  try {
    const raw = await getClient().get(`nextbot:quota:concurrent-runs:${tenantId}`);
    return raw ? Number(raw) : 0;
  } catch (err) {
    console.error("NextBot tenancy: failed to read concurrent-run gauge", err);
    return 0;
  }
}
