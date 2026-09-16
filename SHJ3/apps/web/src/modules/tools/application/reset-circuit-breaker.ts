/**
 * "Reset breaker" — B5 tab 4's manual close action.
 *
 * Both the durable ledger and the live Redis state must change together: Redis
 * is the live truth every replica reads before calling a tool, SQL is the
 * durable audit ledger nothing else reconstructs it from
 * (`circuit-breaker-state-store.ts`'s own module comment). Neither write alone
 * would be honest — a ledger entry with no matching live-state change would
 * claim a reset that never actually took effect; a live-state change with no
 * ledger entry would leave B5 tab 4's history silent about who closed it and
 * why.
 *
 * `domain/circuit-breaker.ts`'s `requiresActor("ManualReset")` is `true`, so
 * `actorStaffUserId` must be a real, non-empty string — validated here even
 * though the input type already requires a `string`, because a caller could
 * still pass an empty one, and `CK_CircuitBreakerEvents_manualHasActor` would
 * reject a null actor at the database in any case. Failing here is the same
 * rejection, surfaced earlier and more legibly.
 */

import { breakerRef, manualResetTransition, requiresActor } from "../domain/circuit-breaker.js";
import type { CircuitBreakerRepository } from "../ports/circuit-breaker-repository.js";
import type { CircuitBreakerStateStore } from "../ports/circuit-breaker-state-store.js";

export interface ResetCircuitBreakerInput {
  readonly circuitBreakerConfigId: string;
  readonly actorStaffUserId: string;
  readonly now: Date;
}

export type ResetCircuitBreakerResult =
  { readonly ok: true } | { readonly ok: false; readonly reason: "tools.breaker_not_found" };

export interface ResetCircuitBreakerDeps {
  readonly breakers: CircuitBreakerRepository;
  readonly state: CircuitBreakerStateStore;
}

export class ResetCircuitBreaker {
  constructor(private readonly deps: ResetCircuitBreakerDeps) {}

  async execute(input: ResetCircuitBreakerInput): Promise<ResetCircuitBreakerResult> {
    const { breakers, state } = this.deps;

    const config = await breakers.get(input.circuitBreakerConfigId);
    if (!config) return { ok: false, reason: "tools.breaker_not_found" };

    const { transition, reason } = manualResetTransition();
    if (requiresActor(reason) && input.actorStaffUserId.trim().length === 0) {
      throw new Error(
        `Resetting circuit breaker "${input.circuitBreakerConfigId}" requires a non-empty actorStaffUserId — ` +
          'a manual reset always writes CircuitBreakerEvent.reason="ManualReset", and requiresActor("ManualReset") ' +
          "is true. CK_CircuitBreakerEvents_manualHasActor would reject a null actor at the database regardless; " +
          "this is the same rejection, surfaced earlier and more legibly.",
      );
    }

    const ref = breakerRef(config);
    await state.setState(config.targetKind, ref, {
      state: transition,
      openedAt: null,
      cooldownUntil: null,
      consecutiveProbeFailures: 0,
    });
    await breakers.appendEvent({
      circuitBreakerConfigId: input.circuitBreakerConfigId,
      transition,
      reason,
      failureCount: null,
      actorStaffUserId: input.actorStaffUserId,
      now: input.now,
    });

    return { ok: true };
  }
}
