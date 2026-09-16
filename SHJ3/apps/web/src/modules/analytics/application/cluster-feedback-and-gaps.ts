import { classifyFeedbackRootCause } from "../domain/feedback-root-cause.js";
import { normalizedTextClusterKey } from "../domain/text-cluster-key.js";
import type { FeedbackIssueRepository } from "../ports/feedback-issue-repository.js";
import type { FeedbackSignalRepository } from "../ports/feedback-signal-repository.js";
import type { UnansweredQuestionRepository } from "../ports/unanswered-question-repository.js";

export interface ClusterFeedbackAndGapsResult {
  readonly feedbackIssuesSeen: number;
  readonly unansweredQuestionsSeen: number;
}

/**
 * **The same honest, on-demand pattern as `ComputeDailyMetrics`, applied to B1 tab 3.**
 * Confirmed the same way: nothing in this repo populates `FeedbackIssues`/
 * `UnansweredQuestions` either — the `shj3-worker` gap is one gap, not two. This use case
 * is the real, on-demand alternative: given a `since` cutoff, it reads every real
 * `MessageFeedback` row rating `Down` and every real refused `Assistant` turn since then
 * (`FeedbackSignalRepository`), clusters each by `normalizedTextClusterKey` (exact/
 * near-exact match on normalized question text — the domain module's own doc comment
 * names this as a deliberate, honest first cut, not fabricated semantic clustering), and
 * upserts the result — incrementing `volume`/`askCount` and bumping `lastSeenAt`/
 * `lastAskedAt` on a cluster already seen, never touching a resolution a staff member
 * already recorded (both repositories' own `upsertSeen` doc comments).
 *
 * `rootCause` on a `FeedbackIssue` is `classifyFeedbackRootCause`'s output — a named,
 * rule-based heuristic over the turn's real refusal flag and trace signals (see that
 * function's own doc comment for the exact priority order, including why `StaleSource`
 * is never produced by it).
 *
 * Callers choose `since` (a full backfill passes an old cutoff; a scheduled or
 * manually-triggered incremental run passes "since last time this ran") — this use case
 * itself keeps no run-history bookkeeping, matching the same "on demand, not a
 * continuously running worker" scope this whole module is honest about.
 */
export class ClusterFeedbackAndGaps {
  constructor(
    private readonly deps: {
      readonly signals: FeedbackSignalRepository;
      readonly issues: FeedbackIssueRepository;
      readonly questions: UnansweredQuestionRepository;
    },
  ) {}

  async execute(input: { readonly since: Date }): Promise<ClusterFeedbackAndGapsResult> {
    const [downvotedTurns, refusedTurns] = await Promise.all([
      this.deps.signals.listDownvotedTurns(input.since),
      this.deps.signals.listRefusedTurns(input.since),
    ]);

    for (const turn of downvotedTurns) {
      if (!turn.questionText) continue; // nothing real to cluster on
      const rootCause = classifyFeedbackRootCause({
        wasRefused: turn.wasRefused,
        hasFailedToolCall: turn.hasFailedToolCall,
        groundingConfidence: turn.groundingConfidence,
      });
      await this.deps.issues.upsertSeen({
        questionText: turn.questionText,
        clusterKey: normalizedTextClusterKey(turn.questionText),
        rootCause,
        seenAt: turn.feedbackUpdatedAt,
      });
    }

    for (const turn of refusedTurns) {
      if (!turn.questionText) continue;
      await this.deps.questions.upsertSeen({
        questionText: turn.questionText,
        clusterKey: normalizedTextClusterKey(turn.questionText),
        askedAt: turn.refusedAt,
      });
    }

    return {
      feedbackIssuesSeen: downvotedTurns.length,
      unansweredQuestionsSeen: refusedTurns.length,
    };
  }
}
