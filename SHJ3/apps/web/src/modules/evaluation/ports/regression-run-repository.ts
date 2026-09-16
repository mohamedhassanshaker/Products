/** `RegressionRuns` + `RegressionCaseResults` (§4.14, B13 tab 2). */

import type {
  GoldenSetKind,
  RegressionResult,
  RegressionState,
  RegressionTriggerKind,
} from "../domain/vocabulary.js";

export interface RegressionRunRow {
  readonly id: string;
  readonly goldenSetId: string;
  readonly agentId: string;
  readonly agentVersionId: string;
  readonly triggeredBy: RegressionTriggerKind;
  readonly state: RegressionState;
  readonly accuracy: number | null;
  readonly groundedness: number | null;
  readonly toolAccuracy: number | null;
  readonly localeParity: number | null;
  readonly result: RegressionResult | null;
  readonly casesTotal: number;
  readonly casesPassed: number;
  readonly startedAt: Date;
  readonly finishedAt: Date | null;
  readonly ranByStaffUserId: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface RegressionCaseResultRow {
  readonly id: string;
  readonly regressionRunId: string;
  readonly goldenCaseId: string;
  readonly passed: boolean;
  readonly accuracyScore: number | null;
  readonly groundednessScore: number | null;
  readonly toolAccuracyScore: number | null;
  readonly actualResponse: string | null;
  readonly actualToolCallsJson: string | null;
  readonly failureReason: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface StartRegressionRunInput {
  readonly goldenSetId: string;
  readonly agentId: string;
  readonly agentVersionId: string;
  readonly triggeredBy: RegressionTriggerKind;
  readonly casesTotal: number;
  readonly ranByStaffUserId: string | null;
  readonly now: Date;
}

/** The four score columns, `null` where a run's own `GoldenSet.kind` makes a metric
 *  inapplicable — see `run-golden-set-now.ts`'s own doc comment for exactly which. */
export interface FinishRegressionRunInput {
  readonly regressionRunId: string;
  readonly result: RegressionResult;
  readonly accuracy: number | null;
  readonly groundedness: number | null;
  readonly toolAccuracy: number | null;
  readonly localeParity: number | null;
  readonly casesPassed: number;
  readonly finishedAt: Date;
}

export interface NewRegressionCaseResultInput {
  readonly regressionRunId: string;
  readonly goldenCaseId: string;
  readonly passed: boolean;
  readonly accuracyScore: number | null;
  readonly groundednessScore: number | null;
  readonly toolAccuracyScore: number | null;
  readonly actualResponse: string | null;
  readonly actualToolCallsJson: string | null;
  readonly failureReason: string | null;
  readonly now: Date;
}

/** One relevant golden set's most recent `Completed` run, for the EXACT `agentVersionId`
 *  under evaluation — `evaluate-gate-for-version.ts`'s own input to `domain/gate-
 *  evaluation.ts`. */
export interface LatestSetRunRow {
  readonly goldenSetId: string;
  readonly goldenSetName: string;
  readonly kind: GoldenSetKind;
  readonly accuracy: number | null;
  readonly groundedness: number | null;
}

export interface RegressionRunRepository {
  /**
   * Inserts a `Queued`-then-`Running` run row (the adapter's own call, not two writes —
   * see the adapter's doc comment). Raises the real `UQ_RegressionRuns_active` unique-
   * constraint violation as a raw Prisma error (`P2002`) when a run is already active for
   * this exact `(goldenSetId, agentVersionId)` pair — `run-golden-set-now.ts` is the one
   * place that translates it to `evaluation.run_in_progress`, matching `add()`'s identical
   * "the use case translates the constraint" convention on `GoldenCaseRepository`.
   */
  start(input: StartRegressionRunInput): Promise<RegressionRunRow>;
  finish(input: FinishRegressionRunInput): Promise<void>;
  /** The run's own execution failed outright before every case could even be attempted —
   *  `state="Failed"`, `result` stays `NULL` (`CK_RegressionRuns_finishedHasResult`). */
  markFailed(regressionRunId: string, finishedAt: Date): Promise<void>;
  addCaseResult(input: NewRegressionCaseResultInput): Promise<RegressionCaseResultRow>;

  /** Newest first — B13 tab 2's history, never overwritten (FR-EVAL-06). */
  listRecent(limit?: number): Promise<readonly RegressionRunRow[]>;
  findById(regressionRunId: string): Promise<RegressionRunRow | null>;
  listCaseResults(regressionRunId: string): Promise<readonly RegressionCaseResultRow[]>;

  /** FR-EVAL-11: whether ANY `Completed` run exists for this exact version, against any
   *  golden set. */
  hasAnyCompletedRunForVersion(agentVersionId: string): Promise<boolean>;

  /** One row per golden set that has ever been run against this exact `agentVersionId` —
   *  each one that set's own MOST RECENT `Completed` run. Feeds `domain/gate-
   *  evaluation.ts` directly. */
  listLatestCompletedRunsForVersion(agentVersionId: string): Promise<readonly LatestSetRunRow[]>;

  /** Best-effort lookup of whichever run currently holds the `UQ_RegressionRuns_active`
   *  slot for this pair — used only to enrich the `evaluation.run_in_progress` error with
   *  the running run's id; a caller must not fail the error path if this itself finds
   *  nothing (a benign race between the collision and this read). */
  findActive(goldenSetId: string, agentVersionId: string): Promise<RegressionRunRow | null>;
}
