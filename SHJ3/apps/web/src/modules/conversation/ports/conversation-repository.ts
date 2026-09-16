/**
 * `Conversations`/`ConversationTurns` reads and the narrow slice of writes
 * `shj3-web` itself owns (api.md §3.6: `shj3_ai` is grant-group-1 AI-writable
 * on `ConversationTurns` — `shj3-web` never inserts a turn row itself, only
 * reads them back for rehydration).
 *
 * ## `subjectId === conversationId` — the session-scoping decision
 *
 * FR-CONV-16 requires "one citizen session ↔ one active conversation,
 * resolved at session creation" but `iam/domain/session.ts`'s `SessionRecord`
 * carries no `conversationId` field (out of this module's scope to add one).
 * `OpenConversation` therefore mints the citizen session with `subjectId` set
 * to the **new conversation's own id** — the two are the same ULID. Every
 * later citizen-session-scoped endpoint then checks conversation ownership as
 * `session.subjectId === conversationId` (`requireOwnConversation` in
 * `application/conversation-ownership.ts`), which is exactly "one session,
 * one conversation" made mechanical with no new persisted mapping at all.
 * Documented here because it is the one non-obvious design decision this
 * whole module's request-scoping depends on.
 */

export interface NewConversationInput {
  /**
   * No `id` field: the adapter mints it (`newUlid()`), matching this
   * codebase's own established convention (`PrismaKnowledgeSourceRepository.
   * createSource()` and siblings) — `application/` may not import an
   * adapter/vendor module directly (`eslint.config.mjs`'s swap-test rule), so
   * id generation belongs to the repository that is about to write the row,
   * not to the use case that only decides *that* a row is needed.
   */
  /** `WebWidget` | `WhatsApp` — the channel *kind* only; tenant is implicit via the calling schema (Conversations.channelKey's own VARCHAR(24) width rules out the full "{tenant}.{kind}" composite). */
  readonly channelKey: string;
  readonly localeCode: string;
  readonly startedAt: Date;
  readonly retentionExpiresAt: Date;
}

export interface ConversationRow {
  readonly id: string;
  readonly channelKey: string;
  readonly localeCode: string;
  readonly outcome: string;
  readonly turnCount: number;
  readonly startedAt: Date;
  readonly lastTurnAt: Date;
  readonly endedAt: Date | null;
}

export interface ConversationTurnRow {
  readonly id: string;
  readonly conversationId: string;
  readonly ordinal: number;
  /** `Citizen` | `Assistant` | `System` | `HumanAgent`. */
  readonly role: string;
  readonly contentMasked: string;
  /** `Text` | `Markdown` | `WhatsAppList`. */
  readonly contentFormat: string;
  readonly createdAt: Date;
  readonly wasRefused: boolean;
  readonly refusalReason: string | null;
}

export interface ConversationSlotRow {
  readonly name: string;
  readonly valueMasked: string | null;
  /** `Pending` | `Filled` | `Abandoned`. */
  readonly status: string;
  readonly requiredAssurance: string;
}

export interface ConversationRepository {
  create(input: NewConversationInput): Promise<ConversationRow>;
  findById(conversationId: string): Promise<ConversationRow | null>;

  /** Turns strictly after `afterOrdinal` (0 for "from the start"), ordinal ascending, capped at `limit`. Returns `limit + 1` rows so the caller can compute `hasMore` without a second COUNT query — trim the extra row before returning to the client. */
  listTurnsAfter(
    conversationId: string,
    afterOrdinal: number,
    limit: number,
  ): Promise<readonly ConversationTurnRow[]>;

  listPendingSlots(conversationId: string): Promise<readonly ConversationSlotRow[]>;

  /** Which conversation a turn belongs to — the ownership check `PUT/DELETE .../turns/{turnId}/feedback` needs before trusting a citizen-supplied `turnId` at all. Null if the turn doesn't exist. */
  findTurnConversationId(turnId: string): Promise<string | null>;

  /** Sets `outcome`/`endedAt` (api.md `POST .../close`). Idempotent: closing an already-closed conversation is a no-op success. */
  close(conversationId: string, outcome: string, endedAt: Date): Promise<void>;

  /** FR-CONV-14's outcome derivation may need to flip `Active` -> `Escalated` at the moment a handover ticket is created, independent of an explicit close call. */
  markEscalated(conversationId: string, now: Date): Promise<void>;

  /**
   * Append a `role: "HumanAgent"` turn — added for B-7 (2026-09-10). This module's own
   * header comment says `shj3-web` "never inserts a turn row itself, only reads them
   * back for rehydration"; that convention describes the citizen<->assistant path,
   * whose turns `shj3_ai` owns because grant-group-1 (`prisma/sql/001_constraints.sql`
   * §2.17) is the *only* principal with `INSERT`/`UPDATE` on `ConversationTurns` for
   * that path's own reason (the AI runtime is what generates them). A live agent's own
   * reply is a genuinely different write path — `shj3-web` is the only party that ever
   * has one (there is no AI generation involved), and nothing denies `shj3-web`'s own
   * database principal this table, so this method is additive here rather than routed
   * through `shj3-ai`. Computes the next `ordinal` from the real `MAX(ordinal)` for the
   * conversation (never from the (currently never-updated — a pre-existing gap this
   * method does not otherwise touch) cached `Conversations.turnCount`), and bumps
   * `Conversations.turnCount`/`lastTurnAt` itself since nothing else does for this path.
   */
  appendHumanAgentTurn(input: {
    readonly conversationId: string;
    readonly contentMasked: string;
    /** `Text` | `Markdown` | `WhatsAppList`. */
    readonly contentFormat: string;
    readonly now: Date;
  }): Promise<ConversationTurnRow>;
}
