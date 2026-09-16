/**
 * B13 tab 2's **Run all suites** (FR-EVAL-06). The real schema has no association model
 * between a `GoldenSet` and "the agent version(s) it should be run against" — there is no
 * foreign key or join table anywhere in `prisma/tenant/schema.prisma` for this. Rather than
 * invent one (a real design decision this feature slice does not own), this use case
 * accepts an explicit list of `{goldenSetId, agentId, agentVersionId}` pairings from its
 * caller — the backoffice screen, which already has to render "which agent/version is
 * this set normally checked against" from the UI's own state (e.g. every pairing that
 * already has at least one prior `RegressionRun`, or one the user picks explicitly). This
 * keeps the association decision in the UI/composition layer, where it is visible and
 * changeable, rather than baked into a schema this wave does not control.
 *
 * Runs sequentially (never in parallel — `UQ_RegressionRuns_active` would reject a
 * concurrent pair sharing a `(goldenSetId, agentVersionId)` anyway, but sequential
 * execution is also simply what "no job queue exists" already forces every other run in
 * this module to be). Each pairing produces its own new `RegressionRun` row; a failure on
 * one pairing (a `run_in_progress` collision, or the run itself failing) is recorded and
 * does not stop the remaining pairings from being attempted — FR-EVAL-06's "produces one
 * run record per pairing" would not hold if one bad pairing aborted the rest.
 */

import type { RegressionTriggerKind } from "../domain/vocabulary.js";
import type { RegressionRunRow } from "../ports/regression-run-repository.js";
import type { RunGoldenSetNow, RunGoldenSetNowResult } from "./run-golden-set-now.js";

export interface SuitePairing {
  readonly goldenSetId: string;
  readonly agentId: string;
  readonly agentVersionId: string;
}

export interface RunAllSuitesOutcome {
  readonly pairing: SuitePairing;
  readonly result: RunGoldenSetNowResult;
}

export class RunAllSuites {
  constructor(private readonly deps: { readonly runGoldenSetNow: RunGoldenSetNow }) {}

  async execute(input: {
    readonly pairings: readonly SuitePairing[];
    readonly triggeredBy: RegressionTriggerKind;
    readonly ranByStaffUserId: string | null;
    readonly now: Date;
  }): Promise<readonly RunAllSuitesOutcome[]> {
    const outcomes: RunAllSuitesOutcome[] = [];
    for (const pairing of input.pairings) {
      const result = await this.deps.runGoldenSetNow.execute({
        goldenSetId: pairing.goldenSetId,
        agentId: pairing.agentId,
        agentVersionId: pairing.agentVersionId,
        triggeredBy: input.triggeredBy,
        ranByStaffUserId: input.ranByStaffUserId,
        now: input.now,
      });
      outcomes.push({ pairing, result });
    }
    return outcomes;
  }
}

/** Successful runs only, in pairing order — the convenience view B13 tab 2's "prepends a
 *  new passing run" language describes; a caller that needs the failures too should read
 *  `RunAllSuitesOutcome[]` directly. */
export function successfulRuns(
  outcomes: readonly RunAllSuitesOutcome[],
): readonly RegressionRunRow[] {
  return outcomes
    .map((o) => o.result)
    .filter((r): r is Extract<RunGoldenSetNowResult, { ok: true }> => r.ok)
    .map((r) => r.value);
}
