import { describe, expect, it } from "vitest";
import {
  GATE_EVALUATED_FOR_KINDS,
  GOLDEN_SET_KINDS,
  REGRESSION_RESULTS,
  REGRESSION_STATES,
  REGRESSION_TRIGGER_KINDS,
} from "./vocabulary.js";

describe("evaluation vocabulary", () => {
  it("matches CK_GoldenSets_kind verbatim", () => {
    expect(GOLDEN_SET_KINDS).toEqual(["Journey", "LanguageParity", "RedTeam", "ToolAccuracy"]);
  });

  it("matches CK_RegressionRuns_triggeredBy verbatim", () => {
    expect(REGRESSION_TRIGGER_KINDS).toEqual(["Manual", "Publish", "Promotion", "Schedule"]);
  });

  it("matches CK_RegressionRuns_state verbatim — no 'Error' state", () => {
    expect(REGRESSION_STATES).toEqual(["Queued", "Running", "Completed", "Failed", "Cancelled"]);
    expect(REGRESSION_STATES).not.toContain("Error");
  });

  it("matches CK_RegressionRuns_result verbatim — 'Error' lives here, not in state", () => {
    expect(REGRESSION_RESULTS).toEqual(["Passed", "Failed", "Error"]);
  });

  it("matches CK_GateEvaluations_evaluatedForKind verbatim", () => {
    expect(GATE_EVALUATED_FOR_KINDS).toEqual(["Publish", "Promotion"]);
  });
});
