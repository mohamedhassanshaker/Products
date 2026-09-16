/**
 * B1 tab 2 — the conversation explorer's own read model. Deliberately a narrow,
 * analytics-owned shape rather than importing `modules/conversation`'s
 * `ConversationRepository` port: `conversation` is a sibling *feature* module
 * (`eslint.config.mjs`'s `FEATURE_MODULES` lists both), so `boundaries/element-types`
 * would reject that import outright ("A feature may use... itself — but NOT a sibling
 * feature. Cross-feature work goes through a published port or a domain event."). The
 * concrete adapter for this port reaches `Conversations`/`ConversationTurns`/
 * `MessageFeedback`/`CitizenIdentities` directly through `getTenantDb()` (platform, not a
 * feature), so no cross-feature import is needed at all for read-only table access —
 * only the one genuinely cross-feature *call* (adding a golden case) needs its own port
 * (`ports/golden-case-port.ts`).
 */

export const CONVERSATION_OUTCOME_FILTERS = ["All", "Escalated", "Resolved", "Abandoned"] as const;
export type ConversationOutcomeFilter = (typeof CONVERSATION_OUTCOME_FILTERS)[number];

/** One row of B1 tab 2's table. */
export interface ConversationListRow {
  readonly id: string;
  /** The masked display name (`CitizenIdentities.displayNameMasked`) when the
   *  conversation has a known identity, else `null` — the UI renders the `null` case as
   *  a translated "Citizen" fallback, the same convention `escalations`' own
   *  `queue-tab`/`unknownCitizen` already uses, rather than a second hardcoded label
   *  living here. */
  readonly displayUserMasked: string | null;
  readonly channelKey: string;
  readonly intentLabel: string;
  /** `Active` | `Resolved` | `Escalated` | `Abandoned` (`Conversations.outcome`, read
   *  as-is — `modules/conversation/domain/` derives no separate outcome logic to reuse;
   *  the column already is the derived fact, per FR-CONV-14). */
  readonly outcome: string;
  /** The most recent `MessageFeedback` rating anywhere in the conversation, or `null`
   *  when nothing has been rated — "most recent" because the wireframe's list shows one
   *  rating per conversation row, not one per turn. */
  readonly rating: "Up" | "Down" | null;
  readonly lastTurnAt: Date;
}

/** One row of the expanded transcript. */
export interface TranscriptTurnRow {
  readonly id: string;
  /** `Citizen` | `Assistant` | `System` | `HumanAgent`. */
  readonly role: string;
  /** Already-masked content — `ConversationTurns.contentMasked`, read as-is (§ "a
   *  transcript is never stored unmasked" — there is no second, unmasked value to
   *  accidentally leak here). */
  readonly contentMasked: string;
  readonly contentFormat: string;
  readonly createdAt: Date;
  readonly rating: "Up" | "Down" | null;
}

/** The real data an "Add to golden set" call needs — see `AddConversationToGoldenSet`'s
 *  own doc comment for the exact prompt/expectedBehaviour mapping this feeds. */
export interface GoldenCaseSeed {
  readonly localeCode: string;
  readonly promptText: string;
  readonly actualResponseText: string;
}

export interface ConversationExplorerRepository {
  list(filter: ConversationOutcomeFilter, limit: number): Promise<readonly ConversationListRow[]>;

  /** `null` when the conversation does not exist. */
  getTranscript(conversationId: string): Promise<readonly TranscriptTurnRow[] | null>;

  /** `null` when the conversation does not exist, or has no citizen turn to seed from. */
  findGoldenCaseSeed(conversationId: string): Promise<GoldenCaseSeed | null>;
}
