/**
 * Edit a circuit breaker's configuration — B5 tab 4's config editor, every field
 * independently optional in the same call, mirroring `iam`'s `edit-user.ts`
 * shape. Pure passthrough to `CircuitBreakerRepository.update`; this use case
 * adds no policy of its own, so there is no second place this module's
 * threshold/window/cooldown/fallback rules could drift from what the port
 * actually persists.
 *
 * Deliberately separate from `ResetCircuitBreaker`/`TripCircuitBreaker`: this is
 * an ordinary config edit (no live-state write, no ledger event) — it does not
 * open or close the breaker, it only changes the rules the breaker will apply
 * the next time something trips or resets it.
 */

import type { CircuitBreakerRepository } from "../ports/circuit-breaker-repository.js";
import type { FallbackStrategy } from "../domain/circuit-breaker.js";

export interface UpdateCircuitBreakerConfigInput {
  readonly id: string;
  readonly failureThreshold?: number;
  readonly windowSeconds?: number;
  readonly cooldownSeconds?: number;
  readonly fallbackStrategy?: FallbackStrategy;
  readonly cachedAnswerMaxAgeSeconds?: number | null;
  readonly serveCachedWhenDown?: boolean;
  readonly degradedModeMessage?: string;
  readonly isEnabled?: boolean;
  readonly now: Date;
}

export interface UpdateCircuitBreakerConfigDeps {
  readonly breakers: CircuitBreakerRepository;
}

export class UpdateCircuitBreakerConfig {
  constructor(private readonly deps: UpdateCircuitBreakerConfigDeps) {}

  async execute(input: UpdateCircuitBreakerConfigInput): Promise<void> {
    await this.deps.breakers.update(
      input.id,
      {
        ...(input.failureThreshold !== undefined
          ? { failureThreshold: input.failureThreshold }
          : {}),
        ...(input.windowSeconds !== undefined ? { windowSeconds: input.windowSeconds } : {}),
        ...(input.cooldownSeconds !== undefined ? { cooldownSeconds: input.cooldownSeconds } : {}),
        ...(input.fallbackStrategy !== undefined
          ? { fallbackStrategy: input.fallbackStrategy }
          : {}),
        ...(input.cachedAnswerMaxAgeSeconds !== undefined
          ? { cachedAnswerMaxAgeSeconds: input.cachedAnswerMaxAgeSeconds }
          : {}),
        ...(input.serveCachedWhenDown !== undefined
          ? { serveCachedWhenDown: input.serveCachedWhenDown }
          : {}),
        ...(input.degradedModeMessage !== undefined
          ? { degradedModeMessage: input.degradedModeMessage }
          : {}),
        ...(input.isEnabled !== undefined ? { isEnabled: input.isEnabled } : {}),
      },
      input.now,
    );
  }
}
