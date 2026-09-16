/**
 * "Trip manually (test)" — B5 tab 4's manual-open action, to demonstrate or
 * verify the fallback path (`docs/api.md` §5.6: "Trip manually (test).
 * `{reason}` required").
 *
 * Mirrors `ResetCircuitBreaker`'s "both must happen" shape — durable ledger and
 * live Redis state together — using `manualTripTransition()` instead, and sets
 * `openedAt`/`cooldownUntil` on the live state sensibly for a deliberate manual
 * trip (`consecutiveProbeFailures: 0`, since nothing here is threshold-driven).
 *
 * ## `reason` is accepted, but honestly not persisted anywhere — a real, confirmed gap
 *
 * `docs/api.md` §5.6 documents this action's body as `{reason}` — a free-text
 * justification the staff user types before confirming the trip. This is
 * **not** the same thing as `BreakerEventReason` (`domain/circuit-breaker.ts`),
 * the closed six-value enum whose value for this action is always literally
 * `"ManualTrip"` (`manualTripTransition()`). Checked `CircuitBreakerEvent`'s real
 * columns directly (`prisma/tenant/schema.prisma`, the `CircuitBreakerEvent`
 * model): `id`, `circuitBreakerConfigId`, `transition`, `reason` (the closed
 * `VarChar(32)` enum column), `failureCount`, `actorStaffUserId`, `occurredAt`,
 * `createdAt`, `updatedAt` — there is no free-text column anywhere on this
 * model. `reason: string` is still accepted on this input, for fidelity with
 * the documented API contract (a future route/Server Action can require and
 * validate it exactly as `api.md` describes), but it is a parameter this use
 * case receives and then honestly drops — not persisted, not logged, and not
 * silently given a new column to live in (a schema change is not this task's
 * job). Flagged here plainly rather than silently discarded without a trace.
 */

import { breakerRef, manualTripTransition, requiresActor } from "../domain/circuit-breaker.js";
import type { CircuitBreakerRepository } from "../ports/circuit-breaker-repository.js";
import type { CircuitBreakerStateStore } from "../ports/circuit-breaker-state-store.js";

export interface TripCircuitBreakerInput {
  readonly circuitBreakerConfigId: string;
  /** A free-text justification the staff user types — see this class's own doc comment for why it is not persisted anywhere today. */
  readonly reason: string;
  readonly actorStaffUserId: string;
  readonly now: Date;
}

export type TripCircuitBreakerResult =
  { readonly ok: true } | { readonly ok: false; readonly reason: "tools.breaker_not_found" };

export interface TripCircuitBreakerDeps {
  readonly breakers: CircuitBreakerRepository;
  readonly state: CircuitBreakerStateStore;
}

export class TripCircuitBreaker {
  constructor(private readonly deps: TripCircuitBreakerDeps) {}

  async execute(input: TripCircuitBreakerInput): Promise<TripCircuitBreakerResult> {
    const { breakers, state } = this.deps;

    if (input.reason.trim().length === 0) {
      throw new Error(
        `Tripping circuit breaker "${input.circuitBreakerConfigId}" requires a non-empty reason ` +
          '(docs/api.md §5.6: "Trip manually (test). {reason} required") — a free-text justification, ' +
          "not persisted (see this class's own doc comment), but still mandatory input.",
      );
    }

    const config = await breakers.get(input.circuitBreakerConfigId);
    if (!config) return { ok: false, reason: "tools.breaker_not_found" };

    const { transition, reason: transitionReason } = manualTripTransition();
    if (requiresActor(transitionReason) && input.actorStaffUserId.trim().length === 0) {
      throw new Error(
        `Tripping circuit breaker "${input.circuitBreakerConfigId}" requires a non-empty actorStaffUserId — ` +
          'a manual trip always writes CircuitBreakerEvent.reason="ManualTrip", and requiresActor("ManualTrip") ' +
          "is true. CK_CircuitBreakerEvents_manualHasActor would reject a null actor at the database regardless; " +
          "this is the same rejection, surfaced earlier and more legibly.",
      );
    }

    const ref = breakerRef(config);
    await state.setState(config.targetKind, ref, {
      state: transition,
      openedAt: input.now,
      cooldownUntil: new Date(input.now.getTime() + config.cooldownSeconds * 1000),
      consecutiveProbeFailures: 0,
    });
    await breakers.appendEvent({
      circuitBreakerConfigId: input.circuitBreakerConfigId,
      transition,
      reason: transitionReason,
      failureCount: null,
      actorStaffUserId: input.actorStaffUserId,
      now: input.now,
    });

    return { ok: true };
  }
}
