import { getBreakerRedisClient } from "./redis-client.js";

/**
 * Shared per-`(tenant, tool)` circuit breaker (LLD §6.2's egress choke point).
 * **Phase 18 (BL-11) rewrite**: this is now the real, Redis-backed, cross-process
 * breaker the Phase 14/16 BE2 fix's module doc explicitly deferred — `apps/gateway`
 * and `apps/web` are separate deployables (ADR-0002) and previously each held its
 * own in-memory `Map`, so a trip recorded by one process was invisible to the
 * other (and to the Admin Console's health/circuit-breaker display, which reads
 * from `apps/web`). Backing this with Redis (already-provisioned shared infra) is
 * the minimal change that makes trip state genuinely shared without a second
 * bespoke store.
 *
 * State machine: Closed -> Open after `BREAKER_TRIP_THRESHOLD` consecutive
 * failures; Open -> HalfOpen automatically once `BREAKER_COOLDOWN_MS` has elapsed
 * since it tripped (a single trial call is let through); HalfOpen -> Closed on
 * success or -> Open again immediately on failure. A HalfOpen "single trial" is a
 * simplification (no in-flight-call locking across concurrent requests) — under
 * concurrent traffic more than one trial call may be let through during the same
 * HalfOpen window; that is an acceptable relaxation of the strict half-open
 * contract for this MVP-safety bar, not a correctness bug (worst case: a couple of
 * extra trial calls against a still-unhealthy backend, not an unbounded flood).
 */

export const BREAKER_TRIP_THRESHOLD = 5;
export const BREAKER_COOLDOWN_MS = 30_000;

export type BreakerState = "Closed" | "Open" | "HalfOpen";

export interface BreakerStatus {
  state: BreakerState;
  consecutiveFailures: number;
  openedAt: string | null;
}

interface StoredBreakerState {
  consecutiveFailures: number;
  open: boolean;
  openedAt: string | null;
}

function breakerKey(tenantId: string, toolId: string): string {
  return `nextbot:breaker:${tenantId}:${toolId}`;
}

const DEFAULT_STATE: StoredBreakerState = { consecutiveFailures: 0, open: false, openedAt: null };

/** Reads the raw stored state for a `(tenant, tool)` pair. Fails open (returns the
 * default Closed state) if Redis is unreachable — a Redis outage must never turn
 * into every tool call being treated as tripped open, which would be a worse
 * failure mode than the breaker itself. */
async function readState(tenantId: string, toolId: string): Promise<StoredBreakerState> {
  try {
    const raw = await getBreakerRedisClient().get(breakerKey(tenantId, toolId));
    if (!raw) return { ...DEFAULT_STATE };
    return JSON.parse(raw) as StoredBreakerState;
  } catch (err) {
    console.error("NextBot mcp-client: breaker state read failed, failing open", err);
    return { ...DEFAULT_STATE };
  }
}

async function writeState(tenantId: string, toolId: string, state: StoredBreakerState): Promise<void> {
  try {
    // No TTL: an Open/HalfOpen breaker must persist until explicitly closed by a
    // success or a manual reset, however long that takes.
    await getBreakerRedisClient().set(breakerKey(tenantId, toolId), JSON.stringify(state));
  } catch (err) {
    console.error("NextBot mcp-client: breaker state write failed", err);
  }
}

/** Derives the effective, time-aware state (applying the Open -> HalfOpen cooldown
 * transition) from the raw stored record, for both `isBreakerOpen` and the admin
 * status display to share exactly one derivation. */
function deriveStatus(stored: StoredBreakerState): BreakerStatus {
  if (!stored.open) {
    return { state: "Closed", consecutiveFailures: stored.consecutiveFailures, openedAt: null };
  }
  const openedAtMs = stored.openedAt ? Date.parse(stored.openedAt) : 0;
  if (Date.now() - openedAtMs >= BREAKER_COOLDOWN_MS) {
    return { state: "HalfOpen", consecutiveFailures: stored.consecutiveFailures, openedAt: stored.openedAt };
  }
  return { state: "Open", consecutiveFailures: stored.consecutiveFailures, openedAt: stored.openedAt };
}

/** True if the breaker for this `(tenant, tool)` pair currently blocks egress
 * (state is `Open`, i.e. not yet past its cooldown into `HalfOpen`). */
export async function isBreakerOpen(tenantId: string, toolId: string): Promise<boolean> {
  const status = deriveStatus(await readState(tenantId, toolId));
  return status.state === "Open";
}

/** Records the outcome of an egress call and applies the state-machine transition
 * described above. */
export async function recordBreakerOutcome(tenantId: string, toolId: string, ok: boolean): Promise<void> {
  if (ok) {
    await writeState(tenantId, toolId, { consecutiveFailures: 0, open: false, openedAt: null });
    return;
  }
  const stored = await readState(tenantId, toolId);
  const consecutiveFailures = stored.consecutiveFailures + 1;
  const shouldOpen = consecutiveFailures >= BREAKER_TRIP_THRESHOLD;
  await writeState(tenantId, toolId, {
    consecutiveFailures,
    open: shouldOpen,
    openedAt: shouldOpen ? new Date().toISOString() : null,
  });
}

/** The full, time-aware status for a `(tenant, tool)` pair — what the MCP health
 * admin UI's circuit-breaker column reads. */
export async function getBreakerStatus(tenantId: string, toolId: string): Promise<BreakerStatus> {
  return deriveStatus(await readState(tenantId, toolId));
}

/** Manual "Reset" action (B.3A.4) — explicitly closes the breaker regardless of
 * cooldown state. Requires an explicit operator action per FR-MCP-08; never
 * triggered automatically. */
export async function resetBreaker(tenantId: string, toolId: string): Promise<void> {
  try {
    await getBreakerRedisClient().del(breakerKey(tenantId, toolId));
  } catch (err) {
    console.error("NextBot mcp-client: breaker reset failed", err);
  }
}

/** Lists the current status for every tool this tenant has an existing breaker
 * record for (skips tools that have never recorded an outcome — those are
 * implicitly Closed with zero failures). Used by the MCP health admin surface to
 * build the tool-level health table without one round trip per tool. */
export async function listBreakerStatuses(tenantId: string): Promise<Record<string, BreakerStatus>> {
  const result: Record<string, BreakerStatus> = {};
  try {
    const redis = getBreakerRedisClient();
    const prefix = `nextbot:breaker:${tenantId}:`;
    let cursor = "0";
    do {
      const [nextCursor, keys] = await redis.scan(cursor, "MATCH", `${prefix}*`, "COUNT", 100);
      cursor = nextCursor;
      for (const key of keys) {
        const toolId = key.slice(prefix.length);
        const raw = await redis.get(key);
        if (raw) result[toolId] = deriveStatus(JSON.parse(raw) as StoredBreakerState);
      }
    } while (cursor !== "0");
  } catch (err) {
    console.error("NextBot mcp-client: listBreakerStatuses failed, returning partial/empty result", err);
  }
  return result;
}

/** Test-only escape hatch — clears every breaker key so state never leaks between
 * tests. Uses `SCAN`+`DEL` rather than `FLUSHDB` so it is safe to call against a
 * shared test Redis instance used by other suites concurrently. */
export async function __resetBreakerStateForTests(): Promise<void> {
  try {
    const redis = getBreakerRedisClient();
    let cursor = "0";
    do {
      const [nextCursor, keys] = await redis.scan(cursor, "MATCH", "nextbot:breaker:*", "COUNT", 100);
      cursor = nextCursor;
      if (keys.length > 0) await redis.del(...keys);
    } while (cursor !== "0");
  } catch {
    // Best-effort cleanup only; a failure here must not fail the test itself.
  }
}
