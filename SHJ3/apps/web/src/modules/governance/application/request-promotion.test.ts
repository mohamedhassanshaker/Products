import { describe, expect, it } from "vitest";
import { PromotionGateBlockedError, PromotionPathInvalidError } from "../domain/promotion.js";
import {
  FakeEnvironmentRepository,
  FakePromotionRequestRepository,
  FakePublishGateChecker,
} from "../testing/fakes.js";
import { RequestPromotion } from "./request-promotion.js";

const now = new Date("2026-09-10T10:00:00.000Z");

function setUp() {
  const environments = new FakeEnvironmentRepository();
  environments.seed({
    key: "development",
    displayName: "Development",
    ordinal: 1,
    promotesToKey: "uat",
    isLive: false,
    agentCount: 0,
    deployedVersionLabels: [],
  });
  environments.seed({
    key: "uat",
    displayName: "UAT",
    ordinal: 2,
    promotesToKey: "production",
    isLive: false,
    agentCount: 0,
    deployedVersionLabels: [],
  });
  environments.seed({
    key: "production",
    displayName: "Production",
    ordinal: 3,
    promotesToKey: null,
    isLive: true,
    agentCount: 0,
    deployedVersionLabels: [],
  });

  const promotions = new FakePromotionRequestRepository();
  promotions.environmentChain.set("development", "uat");
  promotions.environmentChain.set("uat", "production");
  promotions.liveEnvironmentKey = "production";
  promotions.seedVersionSummary("version_1", {
    agentId: "agent_1",
    agentName: "SEWA Billing Agent",
    versionLabel: "v1.4",
  });

  const gate = new FakePublishGateChecker();

  return { environments, promotions, gate };
}

describe("RequestPromotion", () => {
  it("creates a promotion request for a non-live target without calling the gate", async () => {
    const { environments, promotions, gate } = setUp();
    let gateCalled = false;
    gate.recordEvaluation = async () => {
      gateCalled = true;
      return { gateEvaluationId: "x", decision: { passed: true } };
    };

    const result = await new RequestPromotion({ promotions, environments, gate }).execute({
      agentVersionId: "version_1",
      fromEnvironmentKey: "development",
      toEnvironmentKey: "uat",
      requestedByStaffUserId: "staff_1",
      now,
    });

    expect(result.ok).toBe(true);
    expect(gateCalled).toBe(false);
  });

  it("records a gate evaluation before inserting when the target is live, and succeeds when it passes", async () => {
    const { environments, promotions, gate } = setUp();
    gate.decision = { passed: true };
    // The fake repository independently validates `gateEvaluationId` against its own
    // `GateEvaluations`-shaped registry (mirroring the real trigger's own check against
    // the real table) — seed it with the exact id the gate checker will hand back, the
    // same way a real `recordEvaluation()` call would have really persisted the row.
    promotions.gateEvaluations.set("eval_1", { agentVersionId: "version_1", passed: true });
    gate.recordEvaluation = async () => ({
      gateEvaluationId: "eval_1",
      decision: { passed: true },
    });

    const result = await new RequestPromotion({ promotions, environments, gate }).execute({
      agentVersionId: "version_1",
      fromEnvironmentKey: "uat",
      toEnvironmentKey: "production",
      requestedByStaffUserId: "staff_1",
      now,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const created = await promotions.findById(result.promotionRequestId);
      expect(created?.gateEvaluationId).not.toBeNull();
    }
  });

  it("returns a structured rejection BEFORE inserting when the gate fails, naming the blocking reason", async () => {
    const { environments, promotions, gate } = setUp();
    gate.decision = {
      passed: false,
      reasons: [
        { metric: "accuracy", goldenSetName: "Billing disputes", observed: 0.71, threshold: 0.85 },
      ],
    };

    const result = await new RequestPromotion({ promotions, environments, gate }).execute({
      agentVersionId: "version_1",
      fromEnvironmentKey: "uat",
      toEnvironmentKey: "production",
      requestedByStaffUserId: "staff_1",
      now,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.decision.reasons[0]?.metric).toBe("accuracy");
    }
    expect((await promotions.listPending()).length).toBe(0);
  });

  it("maps the environment-chain violation to a typed error (mirrors trigger error 51190)", async () => {
    const { environments, promotions, gate } = setUp();

    await expect(
      new RequestPromotion({ promotions, environments, gate }).execute({
        agentVersionId: "version_1",
        fromEnvironmentKey: "development",
        toEnvironmentKey: "production",
        requestedByStaffUserId: "staff_1",
        now,
      }),
    ).rejects.toThrow(PromotionPathInvalidError);
  });

  it("maps a missing/failed gate evaluation at the repository layer to a typed error (mirrors trigger error 51191)", async () => {
    const { environments, promotions, gate } = setUp();
    // Simulate a race: the pre-check passed, but the repository's own gate-must-pass
    // enforcement (standing in for the DB trigger) sees a stale/mismatched evaluation.
    promotions.gateEvaluations.set("stale_eval", { agentVersionId: "version_1", passed: false });
    gate.recordEvaluation = async () => ({
      gateEvaluationId: "stale_eval",
      decision: { passed: true } as const,
    });

    await expect(
      new RequestPromotion({ promotions, environments, gate }).execute({
        agentVersionId: "version_1",
        fromEnvironmentKey: "uat",
        toEnvironmentKey: "production",
        requestedByStaffUserId: "staff_1",
        now,
      }),
    ).rejects.toThrow(PromotionGateBlockedError);
  });
});
