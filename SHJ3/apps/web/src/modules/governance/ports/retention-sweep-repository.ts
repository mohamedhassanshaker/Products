/**
 * The real data-purge half of `RunRetentionSweep` (B14 tab 4, FR-GOV-23/24/27).
 *
 * `Conversations.retentionExpiresAt` is a real, per-row Prisma field stamped at creation
 * from whichever `PrivacyConfigs.transcriptRetention` was in force at the time — using
 * each row's own stamped value (rather than recomputing a single global cutoff from
 * *today's* setting) is deliberate: a row created under an earlier, longer retention
 * window must not have its lifetime shortened retroactively by a later, stricter setting,
 * which is the correct, non-retroactive semantics a "change applies going forward" privacy
 * control needs. `RunRetentionSweep` still records an informational `cutoffAt` (today's
 * setting applied to `now`) on the `RetentionSweepRuns` row, since that is what an
 * operator reading the run wants to see — the *predicate* this repository runs against is
 * always the per-row `retentionExpiresAt`.
 *
 * Transactions are structurally out of scope (FR-GOV-24) — `nullTransactionLinks` only
 * ever nulls the *conversation* back-reference (`Transactions.conversationId`, itself
 * nullable, "nulled by retention sweep" per this schema's own doc comment) so a purged
 * conversation can be removed without breaking the transaction row's own required
 * `citizenIdentityId`/`paymentGatewayId` shape — the `Transaction` row itself, and its
 * `retentionExpiresAt`, are never touched, and `TR_Transactions_blockDelete` would refuse
 * a delete of one regardless.
 */

export interface RetentionCandidateConversation {
  readonly id: string;
  readonly redisSessionKey: string | null;
}

export interface RetentionSweepDataRepository {
  /** `Conversations` where `retentionExpiresAt <= now AND erasedAt IS NULL`, oldest first,
   *  capped at `limit` per call so a very large backlog sweeps in bounded batches. */
  findConversationsPastRetention(
    now: Date,
    limit: number,
  ): Promise<readonly RetentionCandidateConversation[]>;

  /** Deletes every `ConversationTurns` row for the conversation. Returns the count deleted. */
  deleteTurns(conversationId: string): Promise<number>;

  /** Deletes every `OrchestrationTraces` row for the conversation (steps cascade with
   *  their parent trace). Returns the count of TRACES deleted (matching
   *  `RetentionSweepRuns.tracesPurged`'s own real column — not a step count). */
  deleteTraces(conversationId: string): Promise<number>;

  /** Nulls `Transactions.conversationId` for every transaction referencing this
   *  conversation. Returns the count nulled — folded into the run's
   *  `transactionsSkipped` metric, since each is a transaction the sweep explicitly left
   *  otherwise untouched. */
  nullTransactionLinks(conversationId: string): Promise<number>;

  /**
   * Marks the conversation itself erased (`erasedAt = now`) rather than hard-deleting the
   * row — a deliberate, conservative choice: `Conversations` has real referential fan-in
   * from tables this wave does not own (`EscalationTicket`, `CampaignSend`,
   * `VerificationAttempt`, `GoldenCase` all carry an FK toward it, per the identity/
   * escalation/channels modules' own schemas), and this wave did not re-verify every one
   * of those FKs' `onDelete` behaviour. Hard-deleting the parent row risks an FK violation
   * this wave cannot fully rule out; soft-marking `erasedAt` is real (turns and traces —
   * the actual transcript content — are genuinely, fully deleted above) without that risk.
   * Named here and in the final report as a scope note, not silently chosen.
   */
  markConversationErased(conversationId: string, now: Date): Promise<void>;
}

export interface RetentionSweepRunRow {
  readonly id: string;
  readonly scope: string;
  readonly retentionSetting: string;
  readonly cutoffAt: Date;
  readonly conversationsPurged: number;
  readonly turnsPurged: number;
  readonly tracesPurged: number;
  readonly derivedMemoryPurged: number;
  readonly vectorsPurged: number;
  readonly graphNodesPurged: number;
  readonly redisKeysPurged: number;
  readonly transactionsSkipped: number;
  readonly state: string;
  readonly startedAt: Date;
  readonly finishedAt: Date | null;
}

export interface StartRetentionSweepRunInput {
  readonly scope: string;
  readonly retentionSetting: string;
  readonly cutoffAt: Date;
  readonly now: Date;
}

export interface FinishRetentionSweepRunInput {
  readonly conversationsPurged: number;
  readonly turnsPurged: number;
  readonly tracesPurged: number;
  readonly derivedMemoryPurged: number;
  readonly vectorsPurged: number;
  readonly graphNodesPurged: number;
  readonly redisKeysPurged: number;
  readonly transactionsSkipped: number;
  readonly state: "Completed" | "Failed";
  readonly finishedAt: Date;
}

export interface RetentionSweepRunRepository {
  start(input: StartRetentionSweepRunInput): Promise<RetentionSweepRunRow>;
  finish(id: string, input: FinishRetentionSweepRunInput): Promise<RetentionSweepRunRow>;
  list(limit: number): Promise<readonly RetentionSweepRunRow[]>;
}
