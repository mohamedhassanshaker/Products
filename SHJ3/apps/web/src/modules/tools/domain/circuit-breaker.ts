/**
 * Circuit-breaker enums and pure state-transition logic — B5 tab 4.
 *
 * Configuration lives in SQL (`CircuitBreakerConfig`), **live state lives in Redis**
 * (`CircuitBreakerConfig`'s own doc comment: "a breaker tripped on one pod is tripped on
 * all"), and every transition is durably logged to `CircuitBreakerEvent` — an append-only
 * ledger, `DENY UPDATE, DELETE` at the database (confirmed in `001_constraints.sql`). This
 * module knows the *shape* of a transition; the Redis read/write lives in
 * `ports/circuit-breaker-state-store.ts` and its adapter, never here (architecture.md §4).
 */

/** `CK_CircuitBreakerConfigs_targetKind`. */
export const CIRCUIT_BREAKER_TARGET_KINDS = [
  "ApiConnector",
  "McpServer",
  "Channel",
  "Internal",
] as const;
export type CircuitBreakerTargetKind = (typeof CIRCUIT_BREAKER_TARGET_KINDS)[number];
export function isCircuitBreakerTargetKind(value: string): value is CircuitBreakerTargetKind {
  return (CIRCUIT_BREAKER_TARGET_KINDS as readonly string[]).includes(value);
}

/** `CK_CircuitBreakerConfigs_fallbackStrategy`. */
export const FALLBACK_STRATEGIES = [
  "ApologiseOfferLiveAgent",
  "ServeCachedAnswer",
  "QueueAndRetry",
  "FailClosed",
] as const;
export type FallbackStrategy = (typeof FALLBACK_STRATEGIES)[number];
export function isFallbackStrategy(value: string): value is FallbackStrategy {
  return (FALLBACK_STRATEGIES as readonly string[]).includes(value);
}

/** `CK_CircuitBreakerEvents_transition` — also the Redis state hash's own `state` field (`data-model.md` §8, key #4), lower-cased there (`closed`/`open`/`half_open`) but the same three values. */
export const BREAKER_TRANSITIONS = ["Open", "HalfOpen", "Closed"] as const;
export type BreakerTransition = (typeof BREAKER_TRANSITIONS)[number];
export function isBreakerTransition(value: string): value is BreakerTransition {
  return (BREAKER_TRANSITIONS as readonly string[]).includes(value);
}

/** `CK_CircuitBreakerEvents_reason`. */
export const BREAKER_EVENT_REASONS = [
  "ThresholdBreached",
  "ManualTrip",
  "ManualReset",
  "CooldownElapsed",
  "ProbeSucceeded",
  "ProbeFailed",
] as const;
export type BreakerEventReason = (typeof BREAKER_EVENT_REASONS)[number];
export function isBreakerEventReason(value: string): value is BreakerEventReason {
  return (BREAKER_EVENT_REASONS as readonly string[]).includes(value);
}

/**
 * `CK_CircuitBreakerEvents_manualHasActor`: a manual trip or reset is attributable, an
 * automatic transition is not. Pure so the application layer can validate an event before
 * ever reaching the database (a clearer rejection than the CHECK constraint's generic SQL
 * error), and so the append-only `CircuitBreakerEvent` writer can't be called with a shape
 * the ledger itself would refuse.
 */
export function requiresActor(reason: BreakerEventReason): boolean {
  return reason === "ManualTrip" || reason === "ManualReset";
}

/** The manual reset transition B5 tab 4's "Reset breaker" always produces. */
export function manualResetTransition(): {
  transition: BreakerTransition;
  reason: BreakerEventReason;
} {
  return { transition: "Closed", reason: "ManualReset" };
}

/** The manual trip transition B5 tab 4's "Trip manually (test)" always produces. */
export function manualTripTransition(): {
  transition: BreakerTransition;
  reason: BreakerEventReason;
} {
  return { transition: "Open", reason: "ManualTrip" };
}

/**
 * The Redis key discriminator for one breaker — whichever of `targetId`/`targetKey` a
 * config row actually carries (`CK_CircuitBreakerConfigs_targetPaired` requires exactly
 * one non-null). Centralised here so `circuit-breaker-state-store.ts`'s adapter and every
 * application use case resolve the same string the same way, rather than each re-deriving
 * it and risking two different keys for the same breaker.
 */
export function breakerRef(config: {
  readonly targetId: string | null;
  readonly targetKey: string | null;
}): string {
  const ref = config.targetId ?? config.targetKey;
  if (ref === null) {
    throw new Error(
      "A CircuitBreakerConfig must have exactly one of targetId/targetKey set " +
        "(CK_CircuitBreakerConfigs_targetPaired) — this row violates that invariant.",
    );
  }
  return ref;
}
