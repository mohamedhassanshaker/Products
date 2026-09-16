/**
 * The Redis half of B5 tab 4 — `data-model.md` §8 key #4 (`{slug}:cb:{targetKind}:{ref}`)
 * and key #6 (`{slug}:cb:degraded`). "Live state is in Redis" (`CircuitBreakerConfig`'s own
 * doc comment) — "a breaker tripped on one pod is tripped on all," so this is the one
 * source of truth for "is it open right now," never derived from `CircuitBreakerEvent`
 * (the ledger records history, it does not compute current state).
 *
 * `ref` is `domain/circuit-breaker.ts`'s `breakerRef()` — whichever of `targetId`/
 * `targetKey` a config row actually has (`CK_CircuitBreakerConfigs_targetPaired` requires
 * exactly one) — so this port never needs to know which discriminator was used.
 */

import type { BreakerTransition } from "../domain/circuit-breaker.js";

export interface BreakerLiveState {
  readonly state: BreakerTransition;
  readonly openedAt: Date | null;
  readonly cooldownUntil: Date | null;
  readonly consecutiveProbeFailures: number;
}

export const DEFAULT_BREAKER_STATE: BreakerLiveState = {
  state: "Closed",
  openedAt: null,
  cooldownUntil: null,
  consecutiveProbeFailures: 0,
};

export interface CircuitBreakerStateStore {
  /** `null` means no key exists yet — the caller treats this identically to `DEFAULT_BREAKER_STATE` (a breaker that has never tripped is closed), never as an error. */
  getState(targetKind: string, ref: string): Promise<BreakerLiveState | null>;

  /** Refreshes the key's TTL on every write (`data-model.md` §8: "24 h, refreshed on write") — a stale, long-untouched breaker naturally expires back to unknown/closed rather than being pinned open forever by a Redis flush that never happens. The TTL is a fixed constant, not derived from wall-clock time, so this takes no `now` — nothing about it needs a controllable clock. */
  setState(targetKind: string, ref: string, state: BreakerLiveState): Promise<void>;

  isDegraded(): Promise<boolean>;
  setDegraded(degraded: boolean, cooldownSeconds: number): Promise<void>;
}
