/**
 * `ConversationMetricsDaily` / `IntentMetricsDaily` — B1 tab 1's rollups (schema §4.15).
 *
 * Split into two halves on purpose:
 *  - `aggregate*ForDate` reads real, live data (`Conversations`/`ConversationTurns`/
 *    `MessageFeedback`/`OrchestrationTrace*`) and computes one date's numbers from
 *    scratch — the thing `ComputeDailyMetrics` calls.
 *  - `upsert*`/`list*`/`listRolledUpDates` read and write the rollup tables themselves —
 *    the thing `GetOverviewMetrics` calls once the rollup is known to exist.
 *
 * Every rollup row this port ever writes has `agentId: null` — B1 tab 1 never splits by
 * agent (that split is `AgentUsageDaily`'s job, `AgentUsageDailyRepository`'s own
 * out-of-scope table per this module's brief), so this module only ever produces the
 * one "whole channel, that day" row per `(metricDate, channelKey)`, which already
 * satisfies `UQ_ConversationMetricsDaily_date_channel_agent` without ever colliding with
 * a per-agent row some other module might one day add.
 */

/** One UTC calendar date's real counts for one channel, computed directly from
 *  `Conversations`/`ConversationTurns`/`MessageFeedback`/`OrchestrationTraceSteps` — never
 *  read from the rollup table itself. */
export interface RawChannelDayAggregate {
  readonly channelKey: string;
  readonly conversationCount: number;
  /** `Conversations.wasContained = true` — the AI runtime's own "no human has been
   *  involved" signal, counted as-is.
   *
   *  **Corrected 2026-09-10 (a real bug, found live):** this field's own doc comment
   *  previously claimed a conversation "can be `wasContained = true` yet later escalate,"
   *  reasoning the two counters were legitimately independent. Live data disproved that:
   *  `Conversations.create()` seeds every row `wasContained: true`, and neither `close()`
   *  nor `markEscalated()` (`modules/conversation/adapters/outbound/sql/prisma-
   *  conversation-repository.ts`) ever cleared it back to `false` on a real escalation —
   *  so a real, escalated conversation was double-counted into both `containedCount` and
   *  `escalatedCount` here, which is exactly the combination
   *  `CK_ConversationMetricsDaily_coherent` (`containedCount + escalatedCount +
   *  abandonedCount <= conversationCount`) forbids, and a real `ComputeDailyMetrics` run
   *  hit it the first time this environment's real data included an escalated
   *  conversation. Fixed at the source: `containmentClearedBy()` (`modules/conversation/
   *  domain/containment.ts`) is now the single place that decides `wasContained` flips to
   *  `false`, monotonically, the moment `outcome` becomes `Escalated` — never resurrected
   *  to `true` afterward by a later `Resolved`/`Abandoned` close. `containedCount` and
   *  `escalatedCount` are therefore mutually exclusive per conversation from here on. */
  readonly containedCount: number;
  /** `Conversations.outcome = 'Resolved'` — a distinct, outcome-based cut from
   *  `containedCount` above, kept as two independent counters because "contained" (no
   *  human involvement, ever) and "resolved" (the conversation's own terminal state) still
   *  answer different questions once `Abandoned` is in the mix — an abandoned conversation
   *  that never escalated is contained but not resolved. Named plainly because the
   *  wireframe defines neither term precisely and the schema offers no third field to
   *  disambiguate them. */
  readonly deflectedCount: number;
  readonly escalatedCount: number;
  readonly abandonedCount: number;
  readonly turnCount: number;
  readonly toolCallCount: number;
  readonly toolErrorCount: number;
  readonly thumbsUpCount: number;
  readonly thumbsDownCount: number;
  readonly avgFirstResponseMs: number | null;
}

/** One UTC calendar date's real counts for one intent. */
export interface RawIntentDayAggregate {
  readonly intentKey: string;
  readonly intentLabel: string;
  readonly conversationCount: number;
  readonly escalatedCount: number;
  readonly resolvedCount: number;
}

export interface ConversationMetricsDailyRow extends RawChannelDayAggregate {
  readonly metricDate: string;
}

export interface IntentMetricsDailyRow extends RawIntentDayAggregate {
  readonly metricDate: string;
}

export interface MetricsRepository {
  /** Every conversation whose `startedAt` falls in the UTC calendar date `dateKey`,
   *  grouped by channel — everything `ComputeDailyMetrics` needs for one date's
   *  `ConversationMetricsDaily` rows, attributed to the day the conversation *started*
   *  (one consistent rule for every counter on the row, including feedback/tool-call
   *  activity that may itself have happened slightly later in the same conversation). */
  aggregateConversationsForDate(dateKey: string): Promise<readonly RawChannelDayAggregate[]>;

  /** Same scope, grouped by intent instead of channel — `IntentMetricsDaily`. */
  aggregateIntentsForDate(dateKey: string): Promise<readonly RawIntentDayAggregate[]>;

  /** Idempotent upsert on `(metricDate, channelKey, agentId=null)` — a re-run for the same
   *  date replaces the row rather than adding to it (schema's own "repairs a partial day
   *  rather than double-counting" rule). `now` stamps `createdAt` on a genuinely new row
   *  only — an existing row's `createdAt` is never touched by a repair run. */
  upsertConversationMetrics(row: ConversationMetricsDailyRow, now: Date): Promise<void>;

  /** Idempotent upsert on `(metricDate, intentKey)`. Same `now` contract as
   *  `upsertConversationMetrics`. */
  upsertIntentMetrics(row: IntentMetricsDailyRow, now: Date): Promise<void>;

  /** Which of these dates already have at least one `ConversationMetricsDaily` row —
   *  `GetOverviewMetrics`'s "compute on read if missing" check. */
  listRolledUpDates(dateKeys: readonly string[]): Promise<ReadonlySet<string>>;

  listConversationMetrics(
    dateKeys: readonly string[],
  ): Promise<readonly ConversationMetricsDailyRow[]>;

  listIntentMetrics(dateKeys: readonly string[]): Promise<readonly IntentMetricsDailyRow[]>;
}
