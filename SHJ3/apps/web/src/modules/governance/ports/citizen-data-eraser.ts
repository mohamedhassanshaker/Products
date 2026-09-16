/**
 * The SQL Server half of a 4-store erasure (§10.4). Real, tenant-schema deletes/anonymises
 * across every table this codebase's own schema links to `CitizenIdentities` — found by
 * grepping `citizenIdentityId` across the whole tenant Prisma schema (9 referencing
 * tables): `Conversation`, `EscalationTicket`, `CampaignSend`, `IdentityLink`,
 * `VerificationAttempt`, `LinkedServiceAccount`, `Transaction`, `ConsentLedgerEntry`,
 * `ErasureRequest` (the request itself, left untouched — see below).
 *
 * `Transaction.citizenIdentityId` is NOT NULL and this eraser never touches it — FR-PAY-08
 * / FR-GOV-24's statutory 7-year carve-out, and `TR_Transactions_blockDelete` would refuse
 * a delete of any row whose `retentionExpiresAt` (computed, `DATEADD(YEAR,7,initiatedAt)`)
 * has not yet passed regardless of who asks. `erase()` only ever COUNTs matching
 * transactions — a confirm-and-record, never a write, exactly as the module brief
 * requires: "confirm-and-record via a COUNT(*) that they exist and are being deliberately
 * skipped."
 */

export interface CitizenSqlErasureResult {
  /** Rows anonymised/nulled/deleted across every table except `Transactions`. */
  readonly affectedCount: number;
  /** The literal set of queries actually run, joined for the `ErasureTasks.verificationQuery`
   *  column — kept as real, auditable text rather than a generic description. */
  readonly verificationQuery: string;
  /** `COUNT(*)` of `Transactions` rows referencing this citizen — recorded, never deleted. */
  readonly transactionsSkipped: number;
  /** Conversations whose FK was cleared — the caller uses these ids to also erase the
   *  matching Redis session keys (`Conversations.redisSessionKey`), since a SQL-only
   *  eraser has no reach into the cache store itself. */
  readonly purgedConversationIds: readonly string[];
}

export interface CitizenDataEraser {
  erase(citizenIdentityId: string, now: Date): Promise<CitizenSqlErasureResult>;
}
