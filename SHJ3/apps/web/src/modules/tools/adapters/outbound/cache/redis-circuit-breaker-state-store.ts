/**
 * The Redis half of B5 tab 4 — `data-model.md` §8 key #4 (`{slug}:cb:{targetKind}:{ref}`)
 * and key #6 (`{slug}:cb:degraded`).
 *
 * Stored as a JSON string via `getTenantCache()`'s plain `get`/`set`, not a native Redis
 * hash — `TenantCache`'s deliberately narrow surface (`tenant-cache.ts`) exposes no hash
 * commands at all, and `RedisSessionStore` already establishes this exact precedent for a
 * key `data-model.md` also describes abstractly as a "Hash": the doc's column is a
 * conceptual value shape, not a literal Redis data-type requirement.
 *
 * **Out of scope for this wave, and why**: `data-model.md` §8 key #5 (the sliding-window
 * failure sorted set) drives *automatic* tripping, which only makes sense once something
 * actually calls tools and can observe failures — that is the agent runtime's job (B-5),
 * which does not exist yet. This adapter only supports the *manual* trip/reset B5 tab 4
 * exposes today; automatic threshold-breach detection is left for whichever wave builds
 * the runtime, not faked here.
 */

import { getTenantCache } from "../../../../platform/adapters/outbound/cache/tenant-cache.js";
import { isBreakerTransition } from "../../../domain/circuit-breaker.js";
import {
  DEFAULT_BREAKER_STATE,
  type BreakerLiveState,
  type CircuitBreakerStateStore,
} from "../../../ports/circuit-breaker-state-store.js";

/** `data-model.md` §8 key #4's own documented TTL — "24 h, refreshed on write". */
const STATE_TTL_SECONDS = 24 * 60 * 60;
/** Key #6's documented TTL is the configured `cooldownSeconds`, passed in by the caller. */
const DEGRADED_KEY = "cb:degraded";

function stateKey(targetKind: string, ref: string): string {
  return `cb:${targetKind}:${ref}`;
}

interface StoredState {
  readonly state: string;
  readonly openedAt: string | null;
  readonly cooldownUntil: string | null;
  readonly consecutiveProbeFailures: number;
}

function reviveState(raw: string): BreakerLiveState | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const stored = parsed as Partial<StoredState>;
  if (
    typeof stored.state !== "string" ||
    !isBreakerTransition(stored.state) ||
    typeof stored.consecutiveProbeFailures !== "number" ||
    (stored.openedAt !== null && typeof stored.openedAt !== "string") ||
    (stored.cooldownUntil !== null && typeof stored.cooldownUntil !== "string")
  ) {
    return null;
  }
  const openedAt = stored.openedAt ? new Date(stored.openedAt) : null;
  const cooldownUntil = stored.cooldownUntil ? new Date(stored.cooldownUntil) : null;
  if (
    (openedAt && Number.isNaN(openedAt.getTime())) ||
    (cooldownUntil && Number.isNaN(cooldownUntil.getTime()))
  ) {
    return null;
  }
  return {
    state: stored.state,
    openedAt,
    cooldownUntil,
    consecutiveProbeFailures: stored.consecutiveProbeFailures,
  };
}

function serialiseState(state: BreakerLiveState): string {
  const stored: StoredState = {
    state: state.state,
    openedAt: state.openedAt ? state.openedAt.toISOString() : null,
    cooldownUntil: state.cooldownUntil ? state.cooldownUntil.toISOString() : null,
    consecutiveProbeFailures: state.consecutiveProbeFailures,
  };
  return JSON.stringify(stored);
}

export class RedisCircuitBreakerStateStore implements CircuitBreakerStateStore {
  async getState(targetKind: string, ref: string): Promise<BreakerLiveState | null> {
    const raw = await getTenantCache("breaker state read").get(stateKey(targetKind, ref));
    if (raw === null) return null;
    const revived = reviveState(raw);
    // A record written under an older shape (or corrupted) is treated as absent rather
    // than partially trusted — matching RedisSessionStore's identical reasoning — which
    // here means "unknown state" falls back to DEFAULT_BREAKER_STATE at the caller, never
    // a thrown error over a breaker's own live-state read.
    return revived ?? DEFAULT_BREAKER_STATE;
  }

  async setState(targetKind: string, ref: string, state: BreakerLiveState): Promise<void> {
    await getTenantCache("breaker state write").set(
      stateKey(targetKind, ref),
      serialiseState(state),
      STATE_TTL_SECONDS,
    );
  }

  async isDegraded(): Promise<boolean> {
    return (await getTenantCache("breaker degraded read").get(DEGRADED_KEY)) === "1";
  }

  async setDegraded(degraded: boolean, cooldownSeconds: number): Promise<void> {
    const cache = getTenantCache("breaker degraded write");
    if (degraded) {
      await cache.set(DEGRADED_KEY, "1", cooldownSeconds);
    } else {
      await cache.del(DEGRADED_KEY);
    }
  }
}
