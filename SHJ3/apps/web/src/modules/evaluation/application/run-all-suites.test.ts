import { describe, expect, it } from "vitest";
import {
  createGoldenSetFakes,
  FakeAiEvaluationClient,
  FakeEvaluationConversationFactory,
  FakeRegressionRunRepository,
} from "../testing/fakes.js";
import { RunGoldenSetNow } from "./run-golden-set-now.js";
import { RunAllSuites, successfulRuns } from "./run-all-suites.js";

const now = new Date("2026-09-10T10:00:00.000Z");

describe("RunAllSuites", () => {
  it("produces one new run per pairing, never overwriting history, and continues past a failing pairing", async () => {
    const { sets, cases } = createGoldenSetFakes();
    const runs = new FakeRegressionRunRepository();
    const conversations = new FakeEvaluationConversationFactory();
    const ai = new FakeAiEvaluationClient();
    const runGoldenSetNow = new RunGoldenSetNow({ sets, cases, runs, conversations, ai });
    const useCase = new RunAllSuites({ runGoldenSetNow });

    sets.seed({
      id: "gs_billing",
      name: "Billing core journeys",
      ownerTenantId: "t1",
      description: null,
      kind: "Journey",
      localeCode: null,
      caseCount: 0,
      lastScore: null,
      lastRunAt: null,
      createdAt: now,
      updatedAt: now,
    });
    sets.seed({
      id: "gs_customs",
      name: "Customs enquiries",
      ownerTenantId: "t1",
      description: null,
      kind: "Journey",
      localeCode: null,
      caseCount: 0,
      lastScore: null,
      lastRunAt: null,
      createdAt: now,
      updatedAt: now,
    });

    const outcomes = await useCase.execute({
      pairings: [
        { goldenSetId: "gs_billing", agentId: "agent_billing", agentVersionId: "ver_1" },
        { goldenSetId: "gs_customs", agentId: "agent_customs", agentVersionId: "ver_2" },
        { goldenSetId: "missing_set", agentId: "agent_x", agentVersionId: "ver_x" },
      ],
      triggeredBy: "Manual",
      ranByStaffUserId: "staff_1",
      now,
    });

    expect(outcomes).toHaveLength(3);
    expect(outcomes[0]?.result.ok).toBe(true);
    expect(outcomes[1]?.result.ok).toBe(true);
    expect(outcomes[2]?.result).toEqual({ ok: false, error: "evaluation.golden_set_not_found" });

    const passed = successfulRuns(outcomes);
    expect(passed).toHaveLength(2);

    const history = await runs.listRecent();
    expect(history).toHaveLength(2);

    // Running the same pairing again produces a SECOND, new run row — history is never
    // overwritten (FR-EVAL-06).
    await useCase.execute({
      pairings: [{ goldenSetId: "gs_billing", agentId: "agent_billing", agentVersionId: "ver_9" }],
      triggeredBy: "Manual",
      ranByStaffUserId: "staff_1",
      now,
    });
    expect(await runs.listRecent()).toHaveLength(3);
  });
});
