import { describe, expect, it } from "vitest";
import {
  evaluateGate,
  type GateEvaluationContext,
  type PublishGateSnapshot,
} from "./gate-evaluation.js";

const PASSING_GATE: PublishGateSnapshot = {
  blockOnSuiteFailure: true,
  minAccuracy: 0.85,
  minGroundedness: 0.8,
  redTeamMustScore100: true,
  blockOnBoundLocaleBelow100: true,
};

/** Every check off except the one a given test wants to isolate — `redTeamMustScore100`
 *  and `blockOnBoundLocaleBelow100` each fire independently of every other setting (by
 *  design — FR-EVAL-07's "independently effective"), so a test isolating ONE metric must
 *  explicitly disable the others rather than leaving them at `PASSING_GATE`'s defaults,
 *  which would otherwise also fire on an empty `setRuns`/`boundLocales` fixture. */
const ALL_OFF: PublishGateSnapshot = {
  blockOnSuiteFailure: false,
  minAccuracy: 0.85,
  minGroundedness: 0.8,
  redTeamMustScore100: false,
  blockOnBoundLocaleBelow100: false,
};

const EMPTY_CONTEXT: GateEvaluationContext = {
  hasAnyRunForVersion: true,
  setRuns: [],
  boundLocales: [],
};

const PASSING_RED_TEAM_RUN = {
  goldenSetId: "gs_redteam",
  goldenSetName: "Guardrail red-team set",
  kind: "RedTeam" as const,
  accuracy: 1,
  groundedness: null,
};

describe("evaluateGate", () => {
  it("CK_GateEvaluations_failedHasReasons: passed=true carries zero reasons", () => {
    const decision = evaluateGate(PASSING_GATE, {
      ...EMPTY_CONTEXT,
      setRuns: [PASSING_RED_TEAM_RUN],
    });
    expect(decision.passed).toBe(true);
    if (decision.passed) {
      // Nothing further to assert — the discriminated union itself proves no
      // `reasons` field exists on this branch.
      expect(Object.keys(decision)).toEqual(["passed"]);
    }
  });

  it("CK_GateEvaluations_failedHasReasons: passed=false always carries at least one reason", () => {
    const decision = evaluateGate(
      { ...ALL_OFF, blockOnSuiteFailure: true },
      { ...EMPTY_CONTEXT, hasAnyRunForVersion: false },
    );
    expect(decision.passed).toBe(false);
    if (!decision.passed) {
      expect(decision.reasons.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("FR-EVAL-11: blocks when no run exists for the exact version, naming 'suiteFailure'", () => {
    const decision = evaluateGate(
      { ...ALL_OFF, blockOnSuiteFailure: true },
      { ...EMPTY_CONTEXT, hasAnyRunForVersion: false },
    );
    expect(decision.passed).toBe(false);
    if (!decision.passed) {
      expect(decision.reasons).toEqual([{ metric: "suiteFailure", observed: 0, threshold: 1 }]);
    }
  });

  it("blockOnSuiteFailure=false skips both the no-run and the threshold checks", () => {
    const decision = evaluateGate(
      { ...ALL_OFF, blockOnSuiteFailure: false },
      { hasAnyRunForVersion: false, setRuns: [], boundLocales: [] },
    );
    expect(decision.passed).toBe(true);
  });

  it("FR-EVAL-08 worked example: General FAQ Agent v3.0, Arabic language parity at 71%, floor 85%", () => {
    const decision = evaluateGate(
      { ...ALL_OFF, blockOnSuiteFailure: true, minAccuracy: 0.85, minGroundedness: 0.8 },
      {
        hasAnyRunForVersion: true,
        setRuns: [
          {
            goldenSetId: "gs_arabic_parity",
            goldenSetName: "Arabic language parity",
            kind: "LanguageParity",
            accuracy: 0.71,
            groundedness: 0.69,
          },
        ],
        boundLocales: [],
      },
    );
    expect(decision.passed).toBe(false);
    if (!decision.passed) {
      const accuracyReason = decision.reasons.find((r) => r.metric === "accuracy");
      expect(accuracyReason).toEqual({
        metric: "accuracy",
        goldenSetId: "gs_arabic_parity",
        goldenSetName: "Arabic language parity",
        observed: 0.71,
        threshold: 0.85,
      });
      const groundednessReason = decision.reasons.find((r) => r.metric === "groundedness");
      expect(groundednessReason?.observed).toBe(0.69);
    }
  });

  it("FR-EVAL-12: red-team below 100% blocks irrespective of passing accuracy/groundedness", () => {
    const decision = evaluateGate(PASSING_GATE, {
      hasAnyRunForVersion: true,
      setRuns: [
        {
          goldenSetId: "gs_billing",
          goldenSetName: "Billing core journeys",
          kind: "Journey",
          accuracy: 0.99,
          groundedness: 0.95,
        },
        {
          goldenSetId: "gs_redteam",
          goldenSetName: "Guardrail red-team set",
          kind: "RedTeam",
          accuracy: 0.96,
          groundedness: null,
        },
      ],
      boundLocales: [],
    });
    expect(decision.passed).toBe(false);
    if (!decision.passed) {
      expect(decision.reasons).toEqual([
        {
          metric: "redTeam",
          goldenSetId: "gs_redteam",
          goldenSetName: "Guardrail red-team set",
          observed: 0.96,
          threshold: 1,
        },
      ]);
    }
  });

  it("FR-EVAL-09: blocks on a bound locale below 100% translated, naming the locale and percent", () => {
    const decision = evaluateGate(
      { ...ALL_OFF, blockOnBoundLocaleBelow100: true },
      {
        hasAnyRunForVersion: true,
        setRuns: [],
        boundLocales: [{ localeCode: "ar", translatedPercent: 82 }],
      },
    );
    expect(decision.passed).toBe(false);
    if (!decision.passed) {
      expect(decision.reasons).toEqual([
        { metric: "boundLocale", localeCode: "ar", observed: 82, threshold: 100 },
      ]);
    }
  });

  it("blockOnBoundLocaleBelow100=false does not block on an untranslated bound locale", () => {
    const decision = evaluateGate(
      { ...ALL_OFF, blockOnBoundLocaleBelow100: false },
      {
        hasAnyRunForVersion: true,
        setRuns: [],
        boundLocales: [{ localeCode: "ar", translatedPercent: 10 }],
      },
    );
    expect(decision.passed).toBe(true);
  });

  it("redTeamMustScore100=true with no red-team run at all blocks (cannot prove the requirement)", () => {
    const decision = evaluateGate(
      { ...ALL_OFF, redTeamMustScore100: true },
      {
        hasAnyRunForVersion: true,
        setRuns: [
          {
            goldenSetId: "gs_billing",
            goldenSetName: "Billing",
            kind: "Journey",
            accuracy: 0.99,
            groundedness: 0.95,
          },
        ],
        boundLocales: [],
      },
    );
    expect(decision.passed).toBe(false);
    if (!decision.passed) {
      expect(decision.reasons).toEqual([{ metric: "redTeam", observed: 0, threshold: 1 }]);
    }
  });

  it("all five settings independently effective: disabling one leaves the others enforced", () => {
    const decision = evaluateGate(
      { ...PASSING_GATE, blockOnSuiteFailure: false },
      {
        hasAnyRunForVersion: true,
        setRuns: [
          {
            goldenSetId: "gs_rt",
            goldenSetName: "Red-team",
            kind: "RedTeam",
            accuracy: 0.9,
            groundedness: null,
          },
        ],
        boundLocales: [{ localeCode: "ar", translatedPercent: 90 }],
      },
    );
    expect(decision.passed).toBe(false);
    if (!decision.passed) {
      const metrics = decision.reasons.map((r) => r.metric).sort();
      expect(metrics).toEqual(["boundLocale", "redTeam"]);
    }
  });
});
