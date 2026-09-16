import { mapPromotionTriggerError, type GateEvaluationKind } from "../domain/promotion.js";
import type { EnvironmentRepository } from "../ports/environment-repository.js";
import type { PromotionRequestRepository } from "../ports/promotion-repository.js";
import type {
  GateDecision,
  PublishGateChecker,
} from "../../evaluation/ports/publish-gate-checker.js";

export interface RequestPromotionInput {
  readonly agentVersionId: string;
  readonly fromEnvironmentKey: string;
  readonly toEnvironmentKey: string;
  readonly requestedByStaffUserId: string;
  readonly now: Date;
}

export type RequestPromotionResult =
  | { readonly ok: true; readonly promotionRequestId: string }
  | { readonly ok: false; readonly decision: Extract<GateDecision, { passed: false }> };

const PROMOTION_KIND: GateEvaluationKind = "Promotion";

/**
 * B14 tab 1's "request a promotion" flow. api.md: `POST /governance/promotions`.
 *
 * Flow (this file's own doc comment matches the module brief exactly):
 *   1. If `toEnvironmentKey` is the live environment, call
 *      `gate.recordEvaluation({..., evaluatedForKind: "Promotion"})` FIRST — regardless of
 *      pass/fail, so the check is performed and PERSISTED before any insert is attempted.
 *   2. If the decision is `passed: false`, return a structured rejection naming the exact
 *      blocking golden set/score/threshold (FR-EVAL-08) — BEFORE attempting the insert.
 *   3. Otherwise (passed, or the target isn't live) attempt the real INSERT with
 *      `gateEvaluationId` set.
 *   4. The real DB trigger (`TR_PromotionRequests_decisionRules`) can still fire even
 *      after this pre-check (a race, a second caller, a direct script) — its thrown
 *      errors are mapped to typed errors via `domain/promotion.ts#mapPromotionTriggerError`
 *      rather than left to leak a raw SQL Server exception to the UI.
 */
export class RequestPromotion {
  constructor(
    private readonly deps: {
      readonly promotions: PromotionRequestRepository;
      readonly environments: EnvironmentRepository;
      readonly gate: PublishGateChecker;
    },
  ) {}

  async execute(input: RequestPromotionInput): Promise<RequestPromotionResult> {
    const versionSummary = await this.deps.promotions.findVersionSummary(input.agentVersionId);
    if (!versionSummary) throw new Error(`Unknown agent version "${input.agentVersionId}".`);

    const targetEnvironment = await this.deps.environments.findByKey(input.toEnvironmentKey);
    const targetIsLive = targetEnvironment?.isLive ?? false;

    let gateEvaluationId: string | null = null;
    if (targetIsLive) {
      const evaluation = await this.deps.gate.recordEvaluation({
        agentId: versionSummary.agentId,
        agentVersionId: input.agentVersionId,
        evaluatedForKind: PROMOTION_KIND,
        now: input.now,
      });
      gateEvaluationId = evaluation.gateEvaluationId;
      if (!evaluation.decision.passed) {
        return { ok: false, decision: evaluation.decision };
      }
    }

    try {
      const created = await this.deps.promotions.create({
        agentVersionId: input.agentVersionId,
        fromEnvironmentKey: input.fromEnvironmentKey,
        toEnvironmentKey: input.toEnvironmentKey,
        requestedByStaffUserId: input.requestedByStaffUserId,
        gateEvaluationId,
        now: input.now,
      });
      return { ok: true, promotionRequestId: created.id };
    } catch (error) {
      const mapped = mapPromotionTriggerError(error);
      if (mapped) throw mapped;
      throw error;
    }
  }
}
