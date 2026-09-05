/**
 * The one shape `DeploymentsPanel` and `ShadowEvaluationCard` both need (Target
 * Architecture Blueprint Phase 17, BL-48).
 *
 * Extracted into its own module rather than exported from `DeploymentsPanel.tsx`, which is
 * where it started: the panel renders the card, so the card importing a type back out of
 * the panel formed a genuine import cycle that `.dependency-cruiser.cjs`'s `no-circular`
 * rule correctly rejected. A leaf types module is the fix; the two components' one-way
 * relationship (panel → card) is preserved.
 */

/** A version of the agent definition this tab belongs to, as the two version pickers need
 *  it. `status` matters because the two pickers apply deliberately OPPOSITE eligibility
 *  rules: the canary split accepts only `Production` versions (ADR-0019 §2.4 — canary is
 *  not a second route past the promotion gate), while shadow evaluation accepts any
 *  non-`Deprecated` version, because gathering evidence about a pre-promotion candidate
 *  with zero customer exposure is the entire point of it. */
export interface DeploymentsPanelVersion {
  id: string;
  version: string;
  status: "Draft" | "EvalGated" | "HumanReview" | "Approved" | "Production" | "Deprecated";
}
