/**
 * The closed vocabularies this module reads and writes, transcribed VERBATIM from the
 * real, already-migrated CHECK constraints in `prisma/sql/001_constraints.sql` — not
 * guessed from `schema.prisma`'s doc-comment prose (this project's own `tasks/lessons.md`
 * "a doc's illustrative names are not proof" discipline, applied here to a CHECK
 * constraint's string literals instead of a design doc's names). Whoever next touches
 * either side of this vocabulary should grep the other before changing it — the same
 * file's "a SQL trigger's string literal can silently drift from the application's real
 * constant" lesson describes exactly the failure mode a silent rename here would produce.
 */

/** `CK_GoldenSets_kind`. */
export const GOLDEN_SET_KINDS = ["Journey", "LanguageParity", "RedTeam", "ToolAccuracy"] as const;
export type GoldenSetKind = (typeof GOLDEN_SET_KINDS)[number];

/** `CK_RegressionRuns_triggeredBy`. */
export const REGRESSION_TRIGGER_KINDS = ["Manual", "Publish", "Promotion", "Schedule"] as const;
export type RegressionTriggerKind = (typeof REGRESSION_TRIGGER_KINDS)[number];

/** `CK_RegressionRuns_state`. No `'Error'` value here — see `REGRESSION_RESULTS` below;
 *  `state` and `result` are two different columns with two different vocabularies, and
 *  `CK_RegressionRuns_finishedHasResult` ties them together (see that constant's own
 *  comment). */
export const REGRESSION_STATES = ["Queued", "Running", "Completed", "Failed", "Cancelled"] as const;
export type RegressionState = (typeof REGRESSION_STATES)[number];

/**
 * `CK_RegressionRuns_result`. `result IS NULL OR result IN (...)` — meaningful only once a
 * run has finished, and `CK_RegressionRuns_finishedHasResult` requires it to be non-null
 * **if and only if** `state = 'Completed'`. A run whose OWN execution fails outright
 * (cannot even finish attempting every case) is `state = 'Failed'` with `result = NULL` —
 * never `result = 'Error'`, which instead means "the run finished (state stays
 * `'Completed'`), but at least one case's own scoring blew up rather than cleanly passing
 * or failing." Two different failure shapes, deliberately distinguished.
 */
export const REGRESSION_RESULTS = ["Passed", "Failed", "Error"] as const;
export type RegressionResult = (typeof REGRESSION_RESULTS)[number];

/** `CK_GateEvaluations_evaluatedForKind`. */
export const GATE_EVALUATED_FOR_KINDS = ["Publish", "Promotion"] as const;
export type GateEvaluatedForKind = (typeof GATE_EVALUATED_FOR_KINDS)[number];

/** `CK_RegressionCaseResults` carries no closed `passed` vocabulary (it's a `Boolean`), but
 *  the metric names `GateBlockingReason.metric` uses are this module's own vocabulary, not
 *  a DB CHECK — kept here so every consumer (the gate, the UI) reads one shared source. */
export const GATE_BLOCKING_METRICS = [
  "accuracy",
  "groundedness",
  "toolAccuracy",
  "localeParity",
  "redTeam",
  "boundLocale",
  "suiteFailure",
] as const;
export type GateBlockingMetric = (typeof GATE_BLOCKING_METRICS)[number];
