/**
 * B5 tab 4's breaker table — SQL configuration joined with live Redis state.
 *
 * Trips-at/cooldown/fallback come from `CircuitBreakerRepository` (durable
 * config); current state comes from `CircuitBreakerStateStore` (Redis — "a
 * breaker tripped on one pod is tripped on all"). These are two different
 * sources on purpose (`circuit-breaker-state-store.ts`'s own module comment),
 * so this use case reads both on every call rather than trusting one to imply
 * the other. `domain/circuit-breaker.ts`'s `breakerRef()` resolves which of
 * `targetId`/`targetKey` a config row actually carries, so this use case never
 * has to branch on that itself.
 */

import { breakerRef } from "../domain/circuit-breaker.js";
import type {
  CircuitBreakerConfigRow,
  CircuitBreakerRepository,
} from "../ports/circuit-breaker-repository.js";
import {
  DEFAULT_BREAKER_STATE,
  type BreakerLiveState,
  type CircuitBreakerStateStore,
} from "../ports/circuit-breaker-state-store.js";

export type CircuitBreakerCatalogRow = CircuitBreakerConfigRow & {
  readonly liveState: BreakerLiveState;
};

export interface ListCircuitBreakersResult {
  readonly rows: readonly CircuitBreakerCatalogRow[];
}

export interface ListCircuitBreakersDeps {
  readonly breakers: CircuitBreakerRepository;
  readonly state: CircuitBreakerStateStore;
}

export class ListCircuitBreakers {
  constructor(private readonly deps: ListCircuitBreakersDeps) {}

  async execute(): Promise<ListCircuitBreakersResult> {
    const { breakers, state } = this.deps;

    const configs = await breakers.list();
    const rows = await Promise.all(
      configs.map(async (config): Promise<CircuitBreakerCatalogRow> => {
        const ref = breakerRef(config);
        const liveState = (await state.getState(config.targetKind, ref)) ?? DEFAULT_BREAKER_STATE;
        return { ...config, liveState };
      }),
    );

    return { rows };
  }
}
