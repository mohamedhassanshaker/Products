import type { RouterConfigRepository, RouterConfigRow } from "../ports/router-config-repository.js";

/** The Orchestrator screen's read-only "current configuration" panel — the real
 *  `RouterConfigs` singleton, never a screen-level toggle (see `router-config-vocabulary.ts`'s
 *  module comment on why: execution mode is a tenant-wide fact `ProcessTurn` reads fresh
 *  every turn, not a per-screen preference). */
export class GetRouterConfig {
  constructor(private readonly deps: { readonly routerConfig: RouterConfigRepository }) {}

  async execute(): Promise<RouterConfigRow | null> {
    return this.deps.routerConfig.getSingleton();
  }
}
