/**
 * Implements the `PublishGateChecker` port (`ports/publish-gate-checker.ts`) — the
 * cross-module contract `agents/application/publish-agent-version.ts` and the governance
 * module's promotion flow both depend on.
 *
 * Loads every real fact `domain/gate-evaluation.ts` needs for the EXACT `agentVersionId`
 * under evaluation (FR-EVAL-11: "a run against a different version does not satisfy the
 * gate"), lets that pure function decide, and persists the resulting `GateEvaluation` row
 * either way (passed or blocked) — so every decision is itself auditable, matching this
 * module's own doc comment on `GateEvaluation` ("a gate decision, with the reasons that
 * produced it").
 */

import {
  evaluateGate,
  type GateEvaluationContext,
  type PublishGateSnapshot,
} from "../domain/gate-evaluation.js";
import type { GateEvaluationRepository } from "../ports/gate-evaluation-repository.js";
import type { LocaleReadinessRepository } from "../ports/locale-readiness-repository.js";
import type { PublishGateRepository } from "../ports/publish-gate-repository.js";
import type { GateDecision, PublishGateChecker } from "../ports/publish-gate-checker.js";
import type { RegressionRunRepository } from "../ports/regression-run-repository.js";

/**
 * Only ever used as the `updatedByStaffUserId` of a bootstrap-created `PublishGate` row —
 * i.e. only on the very first gate evaluation a tenant ever runs, before any staff member
 * has opened B13 tab 3 to save real settings. Every ordinary path reads the row
 * `UpdatePublishGate` already created with a real principal.
 */
const SYSTEM_BOOTSTRAP_STAFF_USER_ID = "system";

function toSnapshot(gate: {
  blockOnSuiteFailure: boolean;
  minAccuracy: number;
  minGroundedness: number;
  redTeamMustScore100: boolean;
  blockOnBoundLocaleBelow100: boolean;
}): PublishGateSnapshot {
  return {
    blockOnSuiteFailure: gate.blockOnSuiteFailure,
    minAccuracy: gate.minAccuracy,
    minGroundedness: gate.minGroundedness,
    redTeamMustScore100: gate.redTeamMustScore100,
    blockOnBoundLocaleBelow100: gate.blockOnBoundLocaleBelow100,
  };
}

export class EvaluateGateForVersion implements PublishGateChecker {
  constructor(
    private readonly deps: {
      readonly gate: PublishGateRepository;
      readonly runs: RegressionRunRepository;
      readonly locales: LocaleReadinessRepository;
      readonly evaluations: GateEvaluationRepository;
    },
  ) {}

  private async decide(
    agentVersionId: string,
    now: Date,
  ): Promise<{ readonly snapshot: PublishGateSnapshot; readonly decision: GateDecision }> {
    const gate = await this.deps.gate.getOrCreateDefault(SYSTEM_BOOTSTRAP_STAFF_USER_ID, now);
    const [hasAnyRunForVersion, setRuns, boundLocales] = await Promise.all([
      this.deps.runs.hasAnyCompletedRunForVersion(agentVersionId),
      this.deps.runs.listLatestCompletedRunsForVersion(agentVersionId),
      this.deps.locales.listForVersion(agentVersionId),
    ]);
    const ctx: GateEvaluationContext = { hasAnyRunForVersion, setRuns, boundLocales };
    const snapshot = toSnapshot(gate);
    return { snapshot, decision: evaluateGate(snapshot, ctx) };
  }

  async recordEvaluation(input: {
    readonly agentId: string;
    readonly agentVersionId: string;
    readonly evaluatedForKind: "Publish" | "Promotion";
    readonly now: Date;
  }): Promise<{ readonly gateEvaluationId: string; readonly decision: GateDecision }> {
    const { snapshot, decision } = await this.decide(input.agentVersionId, input.now);
    const record = await this.deps.evaluations.record({
      agentVersionId: input.agentVersionId,
      evaluatedAt: input.now,
      passed: decision.passed,
      // Freezes the thresholds in force at evaluation time — a later gate-config change
      // never rewrites the history of this decision (`GateEvaluation.gateSnapshotJson`'s
      // own doc comment).
      gateSnapshot: { ...snapshot },
      blockingReasons: decision.passed ? null : decision.reasons,
      evaluatedForKind: input.evaluatedForKind,
    });
    return { gateEvaluationId: record.id, decision };
  }

  async evaluateForPublish(input: {
    readonly agentId: string;
    readonly agentVersionId: string;
    readonly now: Date;
  }): Promise<GateDecision> {
    const { decision } = await this.recordEvaluation({ ...input, evaluatedForKind: "Publish" });
    return decision;
  }

  async evaluateForPromotion(input: {
    readonly agentId: string;
    readonly agentVersionId: string;
    readonly now: Date;
  }): Promise<GateDecision> {
    const { decision } = await this.recordEvaluation({ ...input, evaluatedForKind: "Promotion" });
    return decision;
  }
}
