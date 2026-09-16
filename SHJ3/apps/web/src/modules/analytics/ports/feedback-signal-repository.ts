/**
 * The real signals `ClusterFeedbackAndGaps` clusters — read-only, spanning
 * `MessageFeedback` / `ConversationTurns` / `OrchestrationTrace(Steps)`. Kept as its own
 * port (rather than folded into `ConversationExplorerRepository`) because these two
 * methods are full, unscoped-by-conversation scans over a time window — a genuinely
 * different access pattern from "one conversation's own rows".
 */

export interface DownvotedTurnSignal {
  readonly turnId: string;
  readonly conversationId: string;
  /** The nearest preceding `Citizen` turn's `contentMasked` — the question this
   *  down-voted answer was responding to. Empty string when none exists (an opening
   *  system turn was rated, which should not happen in practice but is not fatal). */
  readonly questionText: string;
  readonly wasRefused: boolean;
  /** Any `ToolCall` step on this turn's trace ending `Failed`/`Timeout`. */
  readonly hasFailedToolCall: boolean;
  readonly groundingConfidence: number | null;
  readonly feedbackUpdatedAt: Date;
}

export interface RefusedTurnSignal {
  readonly turnId: string;
  readonly conversationId: string;
  readonly questionText: string;
  readonly refusedAt: Date;
}

export interface FeedbackSignalRepository {
  /** Every `MessageFeedback` row `rating = 'Down'` updated at/after `since` — the
   *  thumbs-down review queue's real source. */
  listDownvotedTurns(since: Date): Promise<readonly DownvotedTurnSignal[]>;

  /** Every `Assistant` turn with `wasRefused = true` created at/after `since` — the
   *  "produced no good answer" signal for the unanswered-questions queue
   *  (`ConversationTurns.wasRefused`, the real column this codebase already writes for
   *  every refusal, confirmed against the schema rather than guessed). */
  listRefusedTurns(since: Date): Promise<readonly RefusedTurnSignal[]>;
}
