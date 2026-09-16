import { describe, expect, it } from "vitest";
import { FakeGateEvaluationRepository, FakePublishGateRepository } from "../testing/fakes.js";
import { GetGateStatusSummary } from "./get-gate-status-summary.js";

const now = new Date("2026-09-10T10:00:00.000Z");

describe("GetGateStatusSummary", () => {
  it("FR-EVAL-10: reports inactive when every enforcement setting is off", async () => {
    const gate = new FakePublishGateRepository();
    gate.seed({
      id: "gate_1",
      blockOnSuiteFailure: false,
      minAccuracy: 0.85,
      minGroundedness: 0.8,
      redTeamMustScore100: false,
      blockOnBoundLocaleBelow100: false,
      updatedByStaffUserId: "staff_1",
      createdAt: now,
      updatedAt: now,
    });
    const evaluations = new FakeGateEvaluationRepository();
    const useCase = new GetGateStatusSummary({ gate, evaluations });

    const summary = await useCase.execute("staff_1", now);
    expect(summary).toEqual({ gateActive: false, blockedVersion: null });
  });

  it("reports the most recently blocked publish attempt when the gate is active", async () => {
    const gate = new FakePublishGateRepository();
    gate.seed({
      id: "gate_1",
      blockOnSuiteFailure: true,
      minAccuracy: 0.85,
      minGroundedness: 0.8,
      redTeamMustScore100: true,
      blockOnBoundLocaleBelow100: true,
      updatedByStaffUserId: "staff_1",
      createdAt: now,
      updatedAt: now,
    });
    const evaluations = new FakeGateEvaluationRepository();
    await evaluations.record({
      agentVersionId: "ver_3",
      evaluatedAt: now,
      passed: false,
      gateSnapshot: {},
      blockingReasons: [
        {
          metric: "accuracy",
          goldenSetId: "gs_arabic",
          goldenSetName: "Arabic language parity",
          observed: 0.71,
          threshold: 0.85,
        },
      ],
      evaluatedForKind: "Publish",
    });
    const useCase = new GetGateStatusSummary({ gate, evaluations });

    const summary = await useCase.execute("staff_1", now);
    expect(summary.gateActive).toBe(true);
    expect(summary.blockedVersion?.agentVersionId).toBe("ver_3");
    expect(summary.blockedVersion?.reasons[0]?.metric).toBe("accuracy");
  });
});
