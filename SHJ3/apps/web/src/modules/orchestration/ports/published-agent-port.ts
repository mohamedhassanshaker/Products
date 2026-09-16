/**
 * The one genuinely cross-feature call this module makes: `agents`' registry, to check
 * that every agent id in an `ExplicitList` agent-selection scope is a real, currently
 * `Published` agent (`UpdateRouterConfig`'s own validation rule 7). `orchestration` and
 * `agents` are both listed in `eslint.config.mjs`'s `FEATURE_MODULES`, so
 * `boundaries/element-types` forbids `modules/orchestration/**` importing anything from
 * `modules/agents/**` directly — "A feature may use... itself — but NOT a sibling feature.
 * Cross-feature work goes through a published port or a domain event."
 *
 * So this port is that published port: `application/update-router-config.ts` depends on
 * `PublishedAgentPort` only. The concrete implementation — a thin adapter over `agents`'
 * real `ListAgents` use case — is wired up in the **composition root**
 * (`app/[locale]/(backoffice)/orchestrator/composition.ts`), which is allowed to import
 * both feature modules because route/composition code is the "app" boundary type, not a
 * "feature" one — the identical shape `command-centre/composition.ts`'s `GoldenCasePort`/
 * `EvaluationGoldenCaseAdapter` already establishes for the same architectural reason, not
 * a workaround invented for this feature.
 */

export interface PublishedAgentSummary {
  readonly id: string;
}

export interface PublishedAgentPort {
  /** Every currently `Published` agent's id — enough to validate an `ExplicitList`
   *  selection against, nothing more. */
  listPublished(): Promise<readonly PublishedAgentSummary[]>;
}
