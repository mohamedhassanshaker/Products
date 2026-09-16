/**
 * Cross-tenant, pre-tenant-resolution replay protection for the inbound WhatsApp webhook
 * (api.md §10.1 rule 2, §9.7). `SETNX public:wa:msg:{messageId}` with a 72-hour TTL —
 * already present means a replay, and Meta gets a plain `200` with no processing rather than
 * a `4xx` (which would trigger Meta's own redelivery of the exact duplicate it just sent).
 *
 * ## Why this lives in `platform/`, not in `modules/channels/`
 *
 * Moved here (B-6 integration pass) from `modules/channels/adapters/outbound/cache/` once
 * `gate:clients` (`scripts/gates/no-unscoped-store-clients.mjs`) correctly refused a raw
 * `redis` client constructed outside `platform/adapters/outbound/cache/` or
 * `shj3_ai/adapters/outbound/cache/` — the gate's own directory allowlist, not a false
 * positive. The reasoning below for *why* a raw client is justified at all was already
 * correct; only its address was wrong. `getPlatformDb()`
 * (`platform/adapters/outbound/sql/tenant-db.ts`) is the exact precedent: a genuinely
 * cross-tenant, pre-tenant-context primitive belongs in `platform` (architecture.md §3:
 * "`platform` depends on nothing. Everything may depend on it"), not in the feature module
 * that happens to be its first caller.
 *
 * ## Why this reaches a raw Redis client directly, unlike everywhere else in this codebase
 *
 * `tenant-cache.ts`'s own module comment explains why its raw client is module-private and
 * never exported: every command needs a tenant key prefix applied, and the only way to
 * guarantee that is to make the raw client unreachable except through the prefixing wrapper.
 * This webhook is the one place in the whole application that must dedupe a message BEFORE
 * the tenant is known at all — Meta's payload names only a `phone_number_id`, and resolving
 * which tenant owns it (`modules/channels/adapters/inbound/resolve-tenant-by-phone-number.ts`)
 * is itself the next step, not a precondition of this one. There is no tenant to prefix by
 * yet, so `getTenantCache()` cannot serve this call, and `getProvisioningCache()` is gated to
 * `platformScope: "provisioning"` specifically (a different, audited operation). A dedicated,
 * narrowly-scoped raw client — used for exactly one key pattern (`public:wa:msg:*`), never for
 * anything tenant-scoped — is the documented exception, mirroring `tenant-cache.ts`'s own
 * reasoning for why the raw client is normally never exported: this module is the one place a
 * schema-free key is actually correct, because there genuinely is no tenant yet.
 */
import { createClient, type RedisClientType } from "redis";

const REPLAY_KEY_PREFIX = "public:wa:msg:";
const REPLAY_TTL_SECONDS = 72 * 60 * 60;

let client: RedisClientType | null = null;
let connecting: Promise<RedisClientType> | null = null;

async function connection(): Promise<RedisClientType> {
  if (client?.isReady) return client;
  if (connecting) return connecting;

  const url = process.env.SHJ3_REDIS_URL;
  if (!url) {
    throw new Error(
      "SHJ3_REDIS_URL is not set. The webhook route cannot dedupe inbound messages without it.",
    );
  }

  connecting = (async () => {
    const created: RedisClientType = createClient({ url });
    created.on("error", (error) => {
      // A Redis outage here degrades to "every message looks new" (ADR-0003's own
      // ephemeral-store posture) — logged, never crashing the route.
      console.error("[whatsapp-webhook][replay-guard] redis client error", {
        message: (error as Error).message,
      });
    });
    await created.connect();
    client = created;
    connecting = null;
    return created;
  })();

  return connecting;
}

/** `true` if this is the first time `messageId` has been seen in the last 72 hours (i.e. NOT
 *  a replay) — claims the dedupe key as a side effect, so callers should only call this once
 *  per inbound message and trust the return value, not call it speculatively. */
export async function claimMessageIdNotSeenBefore(messageId: string): Promise<boolean> {
  const redis = await connection();
  const result = await redis.set(`${REPLAY_KEY_PREFIX}${messageId}`, "1", {
    NX: true,
    EX: REPLAY_TTL_SECONDS,
  });
  return result === "OK";
}

/** Read-only check, no side effect — for tests proving a message either was or was not
 *  claimed, without the assertion itself claiming it. Never used by the route handler
 *  itself, which must always go through `claimMessageIdNotSeenBefore`'s atomic `SETNX`. */
export async function hasClaimedMessageId(messageId: string): Promise<boolean> {
  const redis = await connection();
  const value = await redis.get(`${REPLAY_KEY_PREFIX}${messageId}`);
  return value !== null;
}

/** Shutdown / between-test hygiene, matching `tenant-cache.ts`'s own `disconnectCache()`. */
export async function disconnectReplayGuard(): Promise<void> {
  const current = client;
  client = null;
  connecting = null;
  if (current?.isOpen) await current.quit();
}
