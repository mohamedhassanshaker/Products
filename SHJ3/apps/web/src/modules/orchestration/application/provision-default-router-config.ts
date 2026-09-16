import type { RouterConfigRepository } from "../ports/router-config-repository.js";

export interface ProvisionDefaultRouterConfigInput {
  readonly now: Date;
}

export interface ProvisionDefaultRouterConfigResult {
  /** Whether a `RouterConfigs` singleton was created this call — `false` for an
   *  already-provisioned tenant (including `sewa`, whose real row this must never touch). */
  readonly created: boolean;
}

/**
 * Creates the tenant's `RouterConfigs` singleton (B4 configuration) if one does not already
 * exist — the identical shape `ProvisionDefaultChannelsForTenant` (`channels` module)
 * already established for B10 tab 1's fixed channel catalogue, applied here to
 * orchestration's own tenant-wide singleton.
 *
 * ## The bug this closes
 *
 * `ProvisionTenant` (platform/application) never created a `RouterConfigs` row for any
 * tenant — the only place one was ever created was `scripts/seed-agent-runtime-demo-data.ts`,
 * a one-off CLI script run once, by hand, against `sewa` alone. `sharjah`/`customs`/
 * `libraries` were provisioned with zero `RouterConfigs` rows and, per `router-config-
 * vocabulary.ts`'s own doc comment, there is no UI path that ever writes one either —
 * `ExecutionModePanel` renders the tenant's execution mode read-only, deliberately never a
 * screen-level toggle, because it is a tenant-wide fact `ProcessTurn` reads fresh every turn,
 * not a per-screen preference. So without a real provisioning hook, those three tenants could
 * never get a real, persisted row through any path this product actually offers.
 *
 * This did NOT stop those tenants' turns from processing, which is why real
 * `OrchestrationTraces` rows exist for `sharjah` even though `/orchestrator` shows
 * "No router configuration yet — this tenant has not been provisioned with a RouterConfigs
 * singleton": `apps/ai`'s `SqlConfigReader.get_router_config()`
 * (`adapters/outbound/sql/orchestration_repository.py`) returns a hardcoded, platform-safe
 * `_DEFAULT_ROUTER_CONFIG` fallback whenever no row exists — by design, so a fresh tenant
 * with no configuration screen visited yet still gets a bounded pipeline rather than an
 * unbounded one. The pipeline ran under that in-memory fallback every turn; nothing was ever
 * persisted for the screen to read back. Not a contradiction — two independent, individually
 * correct facts about the same gap.
 *
 * ## Defaults used here
 *
 * Mirrors `sewa`'s own real, persisted `RouterConfigs` row exactly — confirmed live via a
 * direct query against the real dev database, not assumed from the seed script's source
 * alone: `Sequential` / `IntentClassifier` / `AllPublished`, `maxHops` 6,
 * `maxLoopIterations` 3, cost ceilings 8,000 tokens / 350,000 micro-AED,
 * `HighestConfidence` / `DeduplicateOverlap`, `minRoutingConfidence` 0.30. This is
 * deliberately NOT `apps/ai`'s own in-memory `_DEFAULT_ROUTER_CONFIG` fallback, which
 * independently hardcodes `min_routing_confidence=0.55` — the two already disagree on that
 * one field (`tasks/lessons.md`'s "a SQL trigger's string literal can silently drift from
 * the application's real constant" family: two independently-typed artifacts encoding the
 * same real-world default, never reconciled). Deliberately picked, not silently reconciled:
 * the persisted, seeded value (0.30) is what every other tenant should get, because it is
 * the one an operator can actually see and reason about on `/orchestrator` — an emergency-
 * only in-memory number nothing ever surfaces is not the more "authoritative" of the two just
 * because it is newer code. Flagged for whoever next owns `apps/ai`'s `ConfigReader` to
 * decide, deliberately, whether `_DEFAULT_ROUTER_CONFIG` itself should be updated to match.
 *
 * ## Why this lives in `orchestration`, not `platform`
 *
 * `platform` depends on nothing (architecture.md §3) — `ProvisionTenant` cannot import this
 * use case directly. `ProvisionDefaultRouterConfigHook` (adapters/outbound/sql/) implements
 * platform's own `TenantProvisionedHook` port and calls this; the composition root wires the
 * concrete hook into `ProvisionTenant`'s deps, exactly mirroring `ProvisionDefaultChannelsHook`.
 *
 * ## Idempotent
 *
 * Safe to re-run against an already-provisioned tenant (including `sewa` itself, whose real
 * row this must never touch) — the backfill script for the three already-active tenants
 * missing this needs exactly that property.
 */
export class ProvisionDefaultRouterConfigForTenant {
  constructor(private readonly deps: { readonly routerConfig: RouterConfigRepository }) {}

  async execute(
    input: ProvisionDefaultRouterConfigInput,
  ): Promise<ProvisionDefaultRouterConfigResult> {
    const existing = await this.deps.routerConfig.getSingleton();
    if (existing) return { created: false };

    await this.deps.routerConfig.createDefault({ now: input.now });
    return { created: true };
  }
}
