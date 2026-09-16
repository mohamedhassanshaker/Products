/**
 * B13 tab 1's **Run now** — rescores ONE golden set against ONE specific agent version,
 * live. Also the inner loop `run-all-suites.ts` calls once per `{goldenSetId, agentId,
 * agentVersionId}` pairing.
 *
 * ## Why this module (not `apps/ai`) owns every write here
 *
 * `docs/api.md`'s originally-documented `POST /v1/evaluation/runs` had the AI side own an
 * entire run end to end. That does not match the real, already-migrated SQL Server grants
 * (`prisma/sql/002_tenant_grants.sql`): `shj3_ai_ro` gets INSERT/UPDATE on exactly
 * `ConversationTurns`/`OrchestrationTraces`/`OrchestrationTraceSteps`/`GroundingCitations`/
 * `ReindexJobs` — nothing on `Conversations`, `GoldenSets`, `RegressionRuns`, or
 * `RegressionCaseResults`. Only this web tier's own Prisma role has full DML across the
 * tenant schema, so this use case creates the synthetic `Conversation` per case
 * (`EvaluationConversationFactory` — a real, flagged gap: see that port's own doc
 * comment on why these rows are not distinguishable from real citizen conversations),
 * calls `apps/ai`'s two grant-safe endpoints (`AiEvaluationClient.executeTurn`/
 * `scoreSimilarity`) to reuse the real orchestration pipeline and the real embedding
 * client, and persists every `RegressionRun`/`RegressionCaseResult`/`GoldenSet.lastScore`
 * write itself.
 *
 * ## No job queue — this runs synchronously, inside one request
 *
 * Nothing in this codebase (web or AI side) has a job-queue/background-worker
 * infrastructure today. Golden sets are small in practice (the seeded ones top out at 60
 * cases), so this awaits every case's real model call in sequence and returns only once
 * the whole run is `Completed` — a real, reasonable scope trim for this feature slice
 * (flagged, not silently assumed): a much larger set, or a slow model, would want this
 * backgrounded, which would need a queue this codebase does not yet have anywhere.
 *
 * ## Per-case scoring
 *
 * - `mustRefuse` cases: `passed = <the turn was refused>` (`EvaluationTurnResult.
 *   wasRefused`, the identical signal `ConversationTurn.wasRefused` itself carries).
 *   `accuracyScore` is `1`/`0` accordingly. `groundednessScore` stays `null` — a refusal
 *   produced no grounded answer to score.
 * - Other cases: `accuracyScore` is a REAL cosine similarity between the actual response
 *   and `expectedBehaviour` (`AiEvaluationClient.scoreSimilarity`, real
 *   `text-embedding-3-large` embeddings — never a fabricated number). `passed =
 *   accuracyScore >= ACCURACY_PASS_THRESHOLD`. `groundednessScore` is the real
 *   `OrchestrationTrace.groundingConfidence` the AI side already computed — never
 *   recomputed here.
 * - `toolAccuracyScore` is computed identically for every case (`computeToolAccuracy`
 *   below): a `mustRefuse` case's `expectedToolCallsJson` is always `NULL`
 *   (`CK_GoldenCases_refusalHasNoTools`), so it naturally scores `1.0` whenever the agent
 *   correctly called no tools either — no special-casing needed.
 * - A per-case exception (a scoring bug, an unreachable AI call) is caught HERE, recorded
 *   as `passed=false` with the exception's own message as `failureReason`, and does not
 *   abort the run — but it does flag the run's own `result` as `"Error"` rather than a
 *   clean `"Passed"`/`"Failed"` (see the roll-up below and `domain/vocabulary.ts`'s own
 *   comment on why `state`/`result` are two different columns).
 *
 * ## Roll-up
 *
 * `accuracy` = mean of every case's `accuracyScore`. `groundedness` = mean over only the
 * cases that produced one (excludes `mustRefuse` cases). `toolAccuracy` = mean of every
 * case's `toolAccuracyScore`. `localeParity` = the SAME value as `accuracy`, but ONLY for
 * a `LanguageParity`-kind set (matches the wireframe's "Arabic language parity: 71%" being
 * exactly that set's own accuracy) — `null` for every other kind, rather than a second,
 * separately-computed parity metric this schema has no other data to support.
 * `GoldenSet.lastScore` is updated to the run's own `accuracy` — B13 tab 1's "Last score"
 * column.
 */

import type { AiEvaluationClient } from "../ports/ai-evaluation-client.js";
import type { EvaluationConversationFactory } from "../ports/evaluation-conversation-factory.js";
import type {
  GoldenCaseRepository,
  GoldenCaseRow,
  GoldenSetRepository,
} from "../ports/golden-set-repository.js";
import type {
  RegressionRunRepository,
  RegressionRunRow,
} from "../ports/regression-run-repository.js";
import type { RegressionTriggerKind } from "../domain/vocabulary.js";

/** First-cut threshold, not a tuned model — revisit once real regression history exists. */
export const ACCURACY_PASS_THRESHOLD = 0.75;

function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002"
  );
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/** This module's own documented shape for `GoldenCase.expectedToolCallsJson`: a JSON
 *  array of tool-binding-id strings, in expected call order. Nothing else in the codebase
 *  defines this shape, since nothing else reads the column. */
function parseExpectedToolCalls(json: string | null): readonly string[] {
  if (json === null) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === "string");
  } catch {
    return [];
  }
}

/** Positional comparison: for each expected index, does the actual call at that same
 *  index match? Calls beyond the shorter list are neither rewarded nor penalised. `1.0`
 *  when both are empty (nothing was expected, nothing happened — a clean match). When
 *  something IS expected, the match fraction is `matched / expected.length`; when nothing
 *  is expected but the agent called tools anyway, that is a clean miss (`0`), not a
 *  division by zero. */
export function computeToolAccuracy(
  expected: readonly string[],
  actual: readonly string[],
): number {
  if (expected.length === 0) return actual.length === 0 ? 1 : 0;
  let matched = 0;
  for (let i = 0; i < expected.length; i += 1) {
    if (actual[i] === expected[i]) matched += 1;
  }
  return matched / expected.length;
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

interface CaseScore {
  readonly passed: boolean;
  readonly accuracyScore: number;
  readonly groundednessScore: number | null;
  readonly toolAccuracyScore: number;
  readonly actualResponse: string | null;
  readonly actualToolCallsJson: string | null;
  readonly failureReason: string | null;
  readonly errored: boolean;
}

export type RunGoldenSetNowResult =
  | { readonly ok: true; readonly value: RegressionRunRow }
  | { readonly ok: false; readonly error: "evaluation.golden_set_not_found" }
  | {
      readonly ok: false;
      readonly error: "evaluation.run_in_progress";
      readonly activeRunId: string | null;
    };

export interface RunGoldenSetNowInput {
  readonly goldenSetId: string;
  readonly agentId: string;
  readonly agentVersionId: string;
  readonly triggeredBy: RegressionTriggerKind;
  readonly ranByStaffUserId: string | null;
  readonly now: Date;
}

export class RunGoldenSetNow {
  constructor(
    private readonly deps: {
      readonly sets: GoldenSetRepository;
      readonly cases: GoldenCaseRepository;
      readonly runs: RegressionRunRepository;
      readonly conversations: EvaluationConversationFactory;
      readonly ai: AiEvaluationClient;
    },
  ) {}

  private async scoreCase(
    goldenCase: GoldenCaseRow,
    input: RunGoldenSetNowInput,
  ): Promise<CaseScore> {
    const conversationId = await this.deps.conversations.create({
      localeCode: goldenCase.localeCode,
      agentId: input.agentId,
      now: input.now,
    });
    const turn = await this.deps.ai.executeTurn({
      conversationId,
      agentId: input.agentId,
      agentVersionId: input.agentVersionId,
      prompt: goldenCase.prompt,
      locale: goldenCase.localeCode,
      turnOrdinal: 0,
    });

    const expectedTools = parseExpectedToolCalls(goldenCase.expectedToolCallsJson);
    const actualTools = turn.toolCalls
      .map((call) => call.toolBindingId)
      .filter((id): id is string => id !== null);
    const toolAccuracyScore = computeToolAccuracy(expectedTools, actualTools);
    const actualToolCallsJson = actualTools.length > 0 ? JSON.stringify(actualTools) : null;

    if (goldenCase.mustRefuse) {
      const passed = turn.wasRefused;
      return {
        passed,
        accuracyScore: passed ? 1 : 0,
        groundednessScore: null,
        toolAccuracyScore,
        actualResponse: turn.messageText,
        actualToolCallsJson,
        failureReason: passed ? null : "Expected the agent to refuse; it answered instead.",
        errored: false,
      };
    }

    const similarity = clamp01(
      await this.deps.ai.scoreSimilarity(turn.messageText, goldenCase.expectedBehaviour),
    );
    const passed = similarity >= ACCURACY_PASS_THRESHOLD;
    return {
      passed,
      accuracyScore: similarity,
      groundednessScore: turn.groundingConfidence,
      toolAccuracyScore,
      actualResponse: turn.messageText,
      actualToolCallsJson,
      failureReason: passed
        ? null
        : `accuracy ${similarity.toFixed(2)} below the ${ACCURACY_PASS_THRESHOLD.toFixed(2)} threshold`,
      errored: false,
    };
  }

  async execute(input: RunGoldenSetNowInput): Promise<RunGoldenSetNowResult> {
    const set = await this.deps.sets.findById(input.goldenSetId);
    if (!set) return { ok: false, error: "evaluation.golden_set_not_found" };

    const caseRows = await this.deps.cases.listForSet(input.goldenSetId);

    let run;
    try {
      run = await this.deps.runs.start({
        goldenSetId: input.goldenSetId,
        agentId: input.agentId,
        agentVersionId: input.agentVersionId,
        triggeredBy: input.triggeredBy,
        casesTotal: caseRows.length,
        ranByStaffUserId: input.ranByStaffUserId,
        now: input.now,
      });
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        const active = await this.deps.runs.findActive(input.goldenSetId, input.agentVersionId);
        return { ok: false, error: "evaluation.run_in_progress", activeRunId: active?.id ?? null };
      }
      throw error;
    }

    try {
      const accuracyScores: number[] = [];
      const groundednessScores: number[] = [];
      const toolAccuracyScores: number[] = [];
      let casesPassed = 0;
      let anyErrored = false;

      for (const goldenCase of caseRows) {
        let score: CaseScore;
        try {
          score = await this.scoreCase(goldenCase, input);
        } catch (error) {
          // One case's own execution/scoring blew up — recorded, not fatal to the run
          // (see this file's own module doc comment on `result="Error"` vs. a clean
          // "Passed"/"Failed").
          score = {
            passed: false,
            accuracyScore: 0,
            groundednessScore: null,
            toolAccuracyScore: 0,
            actualResponse: null,
            actualToolCallsJson: null,
            failureReason: (error instanceof Error ? error.message : String(error)).slice(0, 1000),
            errored: true,
          };
        }

        await this.deps.runs.addCaseResult({
          regressionRunId: run.id,
          goldenCaseId: goldenCase.id,
          passed: score.passed,
          accuracyScore: score.accuracyScore,
          groundednessScore: score.groundednessScore,
          toolAccuracyScore: score.toolAccuracyScore,
          actualResponse: score.actualResponse,
          actualToolCallsJson: score.actualToolCallsJson,
          failureReason: score.failureReason,
          now: input.now,
        });

        accuracyScores.push(score.accuracyScore);
        if (score.groundednessScore !== null) groundednessScores.push(score.groundednessScore);
        toolAccuracyScores.push(score.toolAccuracyScore);
        if (score.passed) casesPassed += 1;
        if (score.errored) anyErrored = true;
      }

      const accuracy = mean(accuracyScores);
      const groundedness = mean(groundednessScores);
      const toolAccuracy = mean(toolAccuracyScores);
      const localeParity = set.kind === "LanguageParity" ? accuracy : null;
      const result = anyErrored ? "Error" : casesPassed === caseRows.length ? "Passed" : "Failed";

      await this.deps.runs.finish({
        regressionRunId: run.id,
        result,
        accuracy,
        groundedness,
        toolAccuracy,
        localeParity,
        casesPassed,
        finishedAt: input.now,
      });
      await this.deps.sets.updateScore(input.goldenSetId, accuracy, input.now);

      const finished = await this.deps.runs.findById(run.id);
      return { ok: true, value: finished ?? run };
    } catch (error) {
      // The run's own execution failed outright (not one case's scoring — something
      // broke the loop itself). `state="Failed"`, `result` stays NULL
      // (`CK_RegressionRuns_finishedHasResult`).
      await this.deps.runs.markFailed(run.id, input.now);
      throw error;
    }
  }
}
