/**
 * The CROSS-MODULE contract other B-9 modules depend on. `agents/application/
 * publish-agent-version.ts` calls `evaluateForPublish` before completing a publish
 * (FR-AGENT-20); the governance module (promotions, built in parallel) calls
 * `evaluateForPromotion` before creating a `PromotionRequest` row, and needs the real,
 * persisted `GateEvaluation.id` back to satisfy `TR_PromotionRequests_decisionRules`'s
 * DB-level check. Do not change these names/shapes without updating both call sites —
 * neither of which lives in this module.
 */

/**
 * `GateBlockingReason`/`GateDecision` are defined in `domain/gate-evaluation.ts` (pure
 * data, zero I/O) and re-exported here so this file remains the one documented place a
 * consumer imports the full cross-module contract from — `eslint.config.mjs`'s "domain/
 * depends on nothing outside domain/" rule is what forbids the reverse (a domain file
 * importing from `ports/`), not a reason to duplicate the shapes.
 */
import type { GateDecision } from "../domain/gate-evaluation.js";

export type { GateBlockingReason, GateDecision } from "../domain/gate-evaluation.js";

export interface PublishGateChecker {
  evaluateForPublish(input: {
    readonly agentId: string;
    readonly agentVersionId: string;
    readonly now: Date;
  }): Promise<GateDecision>;

  evaluateForPromotion(input: {
    readonly agentId: string;
    readonly agentVersionId: string;
    readonly now: Date;
  }): Promise<GateDecision>;

  /**
   * Evaluate AND persist the `GateEvaluation` row, returning its real id — the one thing
   * `evaluateForPublish`/`evaluateForPromotion` alone cannot hand back to a caller that
   * needs to reference the row itself (the governance module's `PromotionRequest` write).
   * `evaluateForPublish`/`evaluateForPromotion` are convenience wrappers around this same
   * persisted evaluation — see `application/evaluate-gate-for-version.ts`.
   */
  recordEvaluation(input: {
    readonly agentId: string;
    readonly agentVersionId: string;
    readonly evaluatedForKind: "Publish" | "Promotion";
    readonly now: Date;
  }): Promise<{ readonly gateEvaluationId: string; readonly decision: GateDecision }>;
}
