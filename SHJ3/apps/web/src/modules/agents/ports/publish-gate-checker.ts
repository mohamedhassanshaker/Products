/**
 * This module's OWN, narrow view of "something that can check the B-9 evaluation publish
 * gate before a publish completes" (FR-AGENT-20). Declared locally, rather than imported
 * from `modules/evaluation/ports/publish-gate-checker.ts`, because `eslint.config.mjs`'s
 * module-boundary rule forbids one feature module importing a sibling feature module
 * directly ("Cross-feature work goes through a published port or a domain event" — and a
 * type-only import of another feature's port still counts as importing that feature).
 *
 * The real implementation this module depends on at runtime is `evaluation/application/
 * evaluate-gate-for-version.ts`'s `EvaluateGateForVersion` — it implements a STRICT
 * superset of this interface (it also has `evaluateForPromotion`/`recordEvaluation`, which
 * this module has no reason to call), so TypeScript's structural typing accepts a real
 * instance of it here with zero cross-feature import: only the composition root
 * (`app/[locale]/(backoffice)/agents/composition.ts`, which — unlike a feature module — IS
 * allowed to import every feature) ever names the concrete `EvaluateGateForVersion` class.
 */

export interface PublishGateBlockingReason {
  readonly metric:
    | "accuracy"
    | "groundedness"
    | "toolAccuracy"
    | "localeParity"
    | "redTeam"
    | "boundLocale"
    | "suiteFailure";
  readonly goldenSetId?: string;
  readonly goldenSetName?: string;
  readonly localeCode?: string;
  readonly observed: number;
  readonly threshold: number;
}

export type PublishGateDecision =
  | { readonly passed: true }
  | { readonly passed: false; readonly reasons: readonly PublishGateBlockingReason[] };

export interface PublishGateChecker {
  evaluateForPublish(input: {
    readonly agentId: string;
    readonly agentVersionId: string;
    readonly now: Date;
  }): Promise<PublishGateDecision>;
}
