/**
 * B5 tab 4's SQL half — configuration and the append-only transition ledger.
 * Live "is it open" state is **not** here; see `circuit-breaker-state-store.ts` (Redis).
 */

import type {
  BreakerEventReason,
  BreakerTransition,
  CircuitBreakerTargetKind,
  FallbackStrategy,
} from "../domain/circuit-breaker.js";

export interface CircuitBreakerConfigRow {
  readonly id: string;
  readonly targetKind: CircuitBreakerTargetKind;
  readonly targetId: string | null;
  readonly targetKey: string | null;
  readonly failureThreshold: number;
  readonly windowSeconds: number;
  readonly cooldownSeconds: number;
  readonly halfOpenProbes: number;
  readonly fallbackStrategy: FallbackStrategy;
  readonly cachedAnswerMaxAgeSeconds: number | null;
  readonly serveCachedWhenDown: boolean;
  readonly degradedModeMessage: string;
  readonly isEnabled: boolean;
}

export interface CircuitBreakerEventRow {
  readonly id: string;
  readonly circuitBreakerConfigId: string;
  readonly transition: BreakerTransition;
  readonly reason: BreakerEventReason;
  readonly failureCount: number | null;
  readonly actorStaffUserId: string | null;
  readonly occurredAt: Date;
}

export interface CircuitBreakerRepository {
  list(): Promise<readonly CircuitBreakerConfigRow[]>;
  get(id: string): Promise<CircuitBreakerConfigRow | null>;

  update(
    id: string,
    input: {
      readonly failureThreshold?: number;
      readonly windowSeconds?: number;
      readonly cooldownSeconds?: number;
      readonly fallbackStrategy?: FallbackStrategy;
      readonly cachedAnswerMaxAgeSeconds?: number | null;
      readonly serveCachedWhenDown?: boolean;
      readonly degradedModeMessage?: string;
      readonly isEnabled?: boolean;
    },
    now: Date,
  ): Promise<void>;

  /** Append-only — `CK_CircuitBreakerEvents_manualHasActor` requires `actorStaffUserId` for `'ManualTrip'`/`'ManualReset'`; the caller (application layer) validates this via `domain/circuit-breaker.ts`'s `requiresActor` before ever reaching here. */
  appendEvent(input: {
    readonly circuitBreakerConfigId: string;
    readonly transition: BreakerTransition;
    readonly reason: BreakerEventReason;
    readonly failureCount: number | null;
    readonly actorStaffUserId: string | null;
    readonly now: Date;
  }): Promise<CircuitBreakerEventRow>;

  listRecentEvents(
    circuitBreakerConfigId: string,
    limit: number,
  ): Promise<readonly CircuitBreakerEventRow[]>;
}
