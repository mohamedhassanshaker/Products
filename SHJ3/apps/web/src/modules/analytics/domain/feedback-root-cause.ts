/**
 * `FeedbackIssues.rootCause` — `MissingKnowledge | StaleSource | ToolFailure |
 * GuardrailRefusal | Other`. Named, rule-based heuristic (not hand-waved): classifies a
 * single thumbs-down turn from the real signals `OrchestrationTrace`/
 * `OrchestrationTraceStep`/`ConversationTurn` already carry, in this exact priority order:
 *
 *  1. `wasRefused` -> `GuardrailRefusal`. The turn's own refusal flag is the most direct
 *     signal available — the assistant declined to answer at all, which is what a
 *     guardrail refusal *is* (`ConversationTurns.wasRefused`/`refusalReason`).
 *  2. A `ToolCall` trace step that ended `Failed`/`Timeout` -> `ToolFailure`. The
 *     assistant tried to act and the action itself broke.
 *  3. No grounding signal, or a low `groundingConfidence` (below `LOW_GROUNDING_
 *     THRESHOLD`) -> `MissingKnowledge`. Nothing relevant was retrieved, or retrieval
 *     was unconvincing.
 *  4. Otherwise -> `Other`.
 *
 * **`StaleSource` is deliberately never produced by this function.** Telling "the
 * knowledge exists but is out of date" apart from "the knowledge was retrieved and the
 * assistant answered anyway, wrongly" needs a signal this wave has no source for — a
 * per-source freshness/staleness flag that does not exist anywhere in
 * `prisma/tenant/schema.prisma` today. Fabricating that distinction from data that
 * cannot support it would be the "hand-wave" this doc comment exists to rule out, so a
 * reviewing staff member re-tags a case as `StaleSource` by hand (via the review queue's
 * own edit path) when they recognise it — the same honest-gap discipline this module
 * already applies to the rollup/clustering worker itself.
 */

export const FEEDBACK_ROOT_CAUSES = [
  "MissingKnowledge",
  "StaleSource",
  "ToolFailure",
  "GuardrailRefusal",
  "Other",
] as const;
export type FeedbackRootCause = (typeof FEEDBACK_ROOT_CAUSES)[number];

/** Below this, a retrieval that technically returned something is treated the same as
 *  finding nothing — arbitrary but named, and easy to retune from one place. */
export const LOW_GROUNDING_THRESHOLD = 0.5;

export interface FeedbackRootCauseInput {
  readonly wasRefused: boolean;
  /** Any `ToolCall` step on this turn's trace with `status` `Failed` or `Timeout`. */
  readonly hasFailedToolCall: boolean;
  /** `OrchestrationTrace.groundingConfidence` for this turn — `null` when the turn has
   *  no trace at all (e.g. a `HumanAgent` turn, or one predating tracing). */
  readonly groundingConfidence: number | null;
}

export function classifyFeedbackRootCause(input: FeedbackRootCauseInput): FeedbackRootCause {
  if (input.wasRefused) return "GuardrailRefusal";
  if (input.hasFailedToolCall) return "ToolFailure";
  if (input.groundingConfidence === null || input.groundingConfidence < LOW_GROUNDING_THRESHOLD) {
    return "MissingKnowledge";
  }
  return "Other";
}
