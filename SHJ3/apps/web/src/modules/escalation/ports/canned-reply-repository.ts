export interface CannedReplyRow {
  readonly id: string;
  readonly name: string;
  readonly body: string;
  readonly teamId: string | null;
  readonly topicKey: string | null;
  readonly localeCode: string;
  readonly ordinal: number;
  readonly isEnabled: boolean;
}

export interface CannedReplyRepository {
  /** `IX_CannedReplies_topicKey_localeCode ... WHERE isEnabled = 1 AND deletedAt IS
   *  NULL` — "topic-specific canned replies... 3 billing, 3 customs, 3 library"
   *  (api.md §6.8). A `topicKey` of `null` means "General" (no topic filter). */
  listForTopic(topicKey: string, localeCode: string): Promise<readonly CannedReplyRow[]>;
}
