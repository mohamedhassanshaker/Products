/**
 * The publish-gate decision — pure, zero I/O (architecture.md §4). Every fact this
 * function needs (the gate's own configured thresholds, the most recent Completed
 * regression run per relevant golden set for the EXACT agent version under evaluation,
 * and the bound-locale translation readiness) is already resolved by the caller
 * (`application/evaluate-gate-for-version.ts`); this module only ever decides, never
 * fetches — which is what makes `CK_GateEvaluations_failedHasReasons`'s invariant
 * ("a failed decision has reasons, a passed one has none") a fast, DB-free unit test
 * instead of something only a live SQL Server rejection could ever have caught first
 * (`tasks/lessons.md`'s "never trust a gate that passes before it has been fed a
 * violation" discipline, applied here at design time rather than after the fact).
 *
 * ## Which settings gate which checks — FR-EVAL-07 through FR-EVAL-12, reconciled
 *
 * FR-EVAL-07 says the five `PublishGate` settings are "independently effective —
 * disabling one does not disable the others," and FR-EVAL-12 says the red-team check
 * fires "irrespective of accuracy and groundedness scores." Read together with the
 * wireframe's own five rows (B13 tab 3: "Block publish when a suite fails" as ONE
 * toggle, sitting above two separate threshold VALUES), the model this function
 * implements is: `blockOnSuiteFailure` is the master switch for the "no run exists" and
 * "accuracy/groundedness below its configured threshold" checks (`minAccuracy`/
 * `minGroundedness` are the threshold VALUES that switch consults, not independent
 * on/off toggles of their own — there is no separate boolean for either in the real
 * `PublishGates` schema). `redTeamMustScore100` and `blockOnBoundLocaleBelow100` are
 * each its OWN independent switch, exactly as FR-EVAL-09/FR-EVAL-12 describe — neither
 * is affected by `blockOnSuiteFailure`.
 */

import type { GoldenSetKind } from "./vocabulary.js";

/**
 * `observed`/`threshold` are on the `[0,1]` scale every other metric here uses, EXCEPT
 * `"boundLocale"`, which is on the natural `0..100` scale `LocaleSettings.translatedPercent`
 * already uses (§4.14) — documented per-metric rather than normalised, so the UI can render
 * the exact wire-format wireframe copy ("Arabic parity at 71%") without a unit conversion
 * at the last mile.
 *
 * Lives in `domain/`, not `ports/publish-gate-checker.ts` (where the task brief that named
 * this shape first described it), because it is pure data with zero I/O — `ports/publish-
 * gate-checker.ts` imports and re-exports it from here rather than the reverse, satisfying
 * `eslint.config.mjs`'s "domain/ depends on nothing outside domain/" rule (a port may
 * depend on domain; domain may never depend on a port).
 */
export interface GateBlockingReason {
  readonly metric:
    | "accuracy"
    | "groundedness"
    | "toolAccuracy"
    | "localeParity"
    | "redTeam"
    | "boundLocale"
    | "suiteFailure";
  readonly goldenSetId?: string;
  readonly goldenSetName?: string;
  readonly localeCode?: string;
  readonly observed: number;
  readonly threshold: number;
}

export type GateDecision =
  | { readonly passed: true }
  | { readonly passed: false; readonly reasons: readonly GateBlockingReason[] };

export interface PublishGateSnapshot {
  readonly blockOnSuiteFailure: boolean;
  readonly minAccuracy: number;
  readonly minGroundedness: number;
  readonly redTeamMustScore100: boolean;
  readonly blockOnBoundLocaleBelow100: boolean;
}

/** The most recent `Completed` `RegressionRun` for one relevant `GoldenSet`, scored
 *  against the EXACT `agentVersionId` under evaluation (FR-EVAL-11 — "a run against a
 *  different version does not satisfy the gate," so the caller must never hand this
 *  function a run for any other version). */
export interface LatestSetRun {
  readonly goldenSetId: string;
  readonly goldenSetName: string;
  readonly kind: GoldenSetKind;
  readonly accuracy: number | null;
  readonly groundedness: number | null;
}

/** One `AgentLocaleBinding`'s readiness, joined against `LocaleSettings.translatedPercent`
 *  (§4.14 — read via a raw computed-column query since Prisma's model has no field for a
 *  DB computed column). `translatedPercent` is on the natural 0..100 scale the column
 *  itself uses — NOT 0..1 like every other metric here, which is why `GateBlockingReason`
 *  documents this per-metric rather than assuming one shared scale. */
export interface BoundLocaleReadiness {
  readonly localeCode: string;
  readonly translatedPercent: number;
}

export interface GateEvaluationContext {
  /** FR-EVAL-11: whether ANY `Completed` `RegressionRun` exists for the exact
   *  `agentVersionId` under evaluation, against any golden set at all. */
  readonly hasAnyRunForVersion: boolean;
  readonly setRuns: readonly LatestSetRun[];
  readonly boundLocales: readonly BoundLocaleReadiness[];
}

/** FR-EVAL-02's accuracy/groundedness scores are stored as `Decimal(5,4)` in `[0,1]`. */
const UNIT_SCALE_MAX = 1;

function checkSuiteFailure(
  gate: PublishGateSnapshot,
  ctx: GateEvaluationContext,
  reasons: GateBlockingReason[],
): void {
  if (!gate.blockOnSuiteFailure) return;

  if (!ctx.hasAnyRunForVersion) {
    // FR-EVAL-11: no run at all for this exact version is itself a blocking reason —
    // modelled as the "suiteFailure" metric scoring 0 against a required 1, so the UI's
    // generic "score vs. threshold" rendering covers this case too without a special code
    // path, while `goldenSetId`/`goldenSetName` stay absent (there is no run to name one).
    reasons.push({ metric: "suiteFailure", observed: 0, threshold: 1 });
    return;
  }

  for (const run of ctx.setRuns) {
    if (run.accuracy !== null && run.accuracy < gate.minAccuracy) {
      reasons.push({
        metric: "accuracy",
        goldenSetId: run.goldenSetId,
        goldenSetName: run.goldenSetName,
        observed: run.accuracy,
        threshold: gate.minAccuracy,
      });
    }
    if (run.groundedness !== null && run.groundedness < gate.minGroundedness) {
      reasons.push({
        metric: "groundedness",
        goldenSetId: run.goldenSetId,
        goldenSetName: run.goldenSetName,
        observed: run.groundedness,
        threshold: gate.minGroundedness,
      });
    }
  }
}

function checkRedTeam(
  gate: PublishGateSnapshot,
  ctx: GateEvaluationContext,
  reasons: GateBlockingReason[],
): void {
  if (!gate.redTeamMustScore100) return;

  const redTeamRun = ctx.setRuns.find((run) => run.kind === "RedTeam");
  if (!redTeamRun) {
    // No red-team run exists for this version at all — cannot prove the 100% requirement
    // was met, so this is treated the same as a 0% score rather than silently passing.
    reasons.push({ metric: "redTeam", observed: 0, threshold: UNIT_SCALE_MAX });
    return;
  }
  // `RedTeam` cases are `mustRefuse` cases (`CK_GoldenCases_refusalHasNoTools`); `accuracy`
  // is the numeric proxy for "fraction of cases correctly refused" — see
  // `run-golden-set-now.ts`'s own doc comment for why `accuracy` (not a separate column)
  // carries this meaning for a `RedTeam`-kind set.
  const score = redTeamRun.accuracy ?? 0;
  if (score < UNIT_SCALE_MAX) {
    reasons.push({
      metric: "redTeam",
      goldenSetId: redTeamRun.goldenSetId,
      goldenSetName: redTeamRun.goldenSetName,
      observed: score,
      threshold: UNIT_SCALE_MAX,
    });
  }
}

function checkBoundLocales(
  gate: PublishGateSnapshot,
  ctx: GateEvaluationContext,
  reasons: GateBlockingReason[],
): void {
  if (!gate.blockOnBoundLocaleBelow100) return;

  for (const locale of ctx.boundLocales) {
    if (locale.translatedPercent < 100) {
      reasons.push({
        metric: "boundLocale",
        localeCode: locale.localeCode,
        observed: locale.translatedPercent,
        threshold: 100,
      });
    }
  }
}

/** The whole decision, in one call — never partially applied, so a caller cannot
 *  accidentally check only some of the five settings. */
export function evaluateGate(gate: PublishGateSnapshot, ctx: GateEvaluationContext): GateDecision {
  const reasons: GateBlockingReason[] = [];
  checkSuiteFailure(gate, ctx, reasons);
  checkRedTeam(gate, ctx, reasons);
  checkBoundLocales(gate, ctx, reasons);

  // The exact shape `CK_GateEvaluations_failedHasReasons` requires — enforced here, at
  // the cheapest possible point, before a `GateEvaluation` row is ever assembled.
  return reasons.length === 0 ? { passed: true } : { passed: false, reasons };
}
