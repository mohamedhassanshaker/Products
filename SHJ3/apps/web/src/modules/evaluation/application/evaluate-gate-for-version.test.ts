import { describe, expect, it } from "vitest";
import {
  FakeGateEvaluationRepository,
  FakeLocaleReadinessRepository,
  FakePublishGateRepository,
  FakeRegressionRunRepository,
} from "../testing/fakes.js";
import { EvaluateGateForVersion } from "./evaluate-gate-for-version.js";

const now = new Date("2026-09-10T10:00:00.000Z");

function makeHarness() {
  const gate = new FakePublishGateRepository();
  const runs = new FakeRegressionRunRepository();
  const locales = new FakeLocaleReadinessRepository();
  const evaluations = new FakeGateEvaluationRepository();
  const checker = new EvaluateGateForVersion({ gate, runs, locales, evaluations });
  return { gate, runs, locales, evaluations, checker };
}

describe("EvaluateGateForVersion", () => {
  it("FR-EVAL-11: blocks and records a GateEvaluation when no run exists for the exact version", async () => {
    const { checker, evaluations } = makeHarness();

    const decision = await checker.evaluateForPublish({
      agentId: "agent_1",
      agentVersionId: "ver_untested",
      now,
    });

    expect(decision.passed).toBe(false);
    expect(evaluations.findMostRecentForVersion("ver_untested")).resolves.toMatchObject({
      passed: false,
      evaluatedForKind: "Publish",
    });
  });

  it("CK_GateEvaluations_failedHasReasons: the persisted row's blockingReasonsJson is non-null iff passed=false", async () => {
    const { checker, evaluations } = makeHarness();

    await checker.evaluateForPublish({ agentId: "agent_1", agentVersionId: "ver_untested", now });
    const failedRow = await evaluations.findMostRecentForVersion("ver_untested");
    expect(failedRow?.passed).toBe(false);
    expect(failedRow?.blockingReasonsJson).not.toBeNull();
  });

  it("passes when the version has a real, recent, passing run and no other blocking condition", async () => {
    const { runs, checker, evaluations } = makeHarness();
    runs.seedRun({
      id: "run_1",
      goldenSetId: "gs_billing",
      agentId: "agent_1",
      agentVersionId: "ver_ok",
      triggeredBy: "Manual",
      state: "Completed",
      accuracy: 0.94,
      groundedness: 0.91,
      toolAccuracy: 0.97,
      localeParity: null,
      result: "Passed",
      casesTotal: 48,
      casesPassed: 48,
      startedAt: now,
      finishedAt: now,
      ranByStaffUserId: "staff_1",
      createdAt: now,
      updatedAt: now,
    });
    runs.seedSetMeta("gs_billing", "Billing core journeys", "Journey");
    runs.seedRun({
      id: "run_1_redteam",
      goldenSetId: "gs_redteam",
      agentId: "agent_1",
      agentVersionId: "ver_ok",
      triggeredBy: "Manual",
      state: "Completed",
      accuracy: 1,
      groundedness: null,
      toolAccuracy: 1,
      localeParity: null,
      result: "Passed",
      casesTotal: 25,
      casesPassed: 25,
      startedAt: now,
      finishedAt: now,
      ranByStaffUserId: "staff_1",
      createdAt: now,
      updatedAt: now,
    });
    runs.seedSetMeta("gs_redteam", "Guardrail red-team set", "RedTeam");

    const decision = await checker.evaluateForPublish({
      agentId: "agent_1",
      agentVersionId: "ver_ok",
      now,
    });

    expect(decision.passed).toBe(true);
    const row = await evaluations.findMostRecentForVersion("ver_ok");
    expect(row?.passed).toBe(true);
    expect(row?.blockingReasonsJson).toBeNull();
  });

  it("FR-EVAL-09: blocks on a bound locale below 100% translated, via the real locale-readiness port", async () => {
    const { runs, locales, checker } = makeHarness();
    runs.seedRun({
      id: "run_2",
      goldenSetId: "gs_billing",
      agentId: "agent_1",
      agentVersionId: "ver_locale",
      triggeredBy: "Manual",
      state: "Completed",
      accuracy: 0.94,
      groundedness: 0.91,
      toolAccuracy: 0.97,
      localeParity: null,
      result: "Passed",
      casesTotal: 48,
      casesPassed: 48,
      startedAt: now,
      finishedAt: now,
      ranByStaffUserId: "staff_1",
      createdAt: now,
      updatedAt: now,
    });
    runs.seedSetMeta("gs_billing", "Billing core journeys", "Journey");
    runs.seedRun({
      id: "run_2_redteam",
      goldenSetId: "gs_redteam",
      agentId: "agent_1",
      agentVersionId: "ver_locale",
      triggeredBy: "Manual",
      state: "Completed",
      accuracy: 1,
      groundedness: null,
      toolAccuracy: 1,
      localeParity: null,
      result: "Passed",
      casesTotal: 25,
      casesPassed: 25,
      startedAt: now,
      finishedAt: now,
      ranByStaffUserId: "staff_1",
      createdAt: now,
      updatedAt: now,
    });
    runs.seedSetMeta("gs_redteam", "Guardrail red-team set", "RedTeam");
    locales.seed("ver_locale", [{ localeCode: "ar", translatedPercent: 82 }]);

    const decision = await checker.evaluateForPublish({
      agentId: "agent_1",
      agentVersionId: "ver_locale",
      now,
    });

    expect(decision.passed).toBe(false);
    if (!decision.passed) {
      expect(decision.reasons).toEqual([
        { metric: "boundLocale", localeCode: "ar", observed: 82, threshold: 100 },
      ]);
    }
  });

  it("evaluateForPromotion tags the persisted row evaluatedForKind='Promotion' and returns a real gateEvaluationId", async () => {
    const { checker, evaluations } = makeHarness();

    const result = await checker.recordEvaluation({
      agentId: "agent_1",
      agentVersionId: "ver_promo",
      evaluatedForKind: "Promotion",
      now,
    });

    expect(result.gateEvaluationId).toBeTruthy();
    const row = await evaluations.findMostRecentForVersion("ver_promo");
    expect(row?.evaluatedForKind).toBe("Promotion");
    expect(row?.id).toBe(result.gateEvaluationId);
  });
});
