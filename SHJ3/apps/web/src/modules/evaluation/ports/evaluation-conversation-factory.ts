/**
 * Creates the synthetic `Conversation` row a golden-case run needs before it can call
 * `apps/ai`'s `POST /v1/evaluation/turns` — `ProcessTurn.execute()` (`process_turn.py`
 * line ~316) requires an already-persisted conversation and raises
 * `ConversationNotFoundError` otherwise, and the AI service's own SQL role has no grant to
 * create one itself (`prisma/sql/002_tenant_grants.sql` — `shj3_ai_ro` gets INSERT/UPDATE
 * on exactly `ConversationTurns`/`OrchestrationTraces`/`OrchestrationTraceSteps`/
 * `GroundingCitations`/`ReindexJobs`, nothing else). Only `shj3_app` (this web tier) can
 * write `Conversations`, so this module owns that one write.
 *
 * This is a narrow, self-contained port rather than a reuse of `conversation/ports/
 * conversation-repository.ts` — this codebase's `eslint.config.mjs` boundary rule
 * disallows one feature module importing a sibling feature module directly ("Cross-
 * feature work goes through a published port or a domain event," enforced mechanically
 * for every module in `FEATURE_MODULES`, which lists both `conversation` and
 * `evaluation`) — so this module declares the one write it needs, in its own terms,
 * rather than reaching across the boundary for a much larger port it does not otherwise
 * depend on.
 *
 * ## The flagged, real gap this factory cannot close
 *
 * `Conversations.channelKey` has a real CHECK constraint (`CK_Conversations_channelKey`)
 * admitting only `'WebWidget'`/`'WhatsApp'`/`'MobileApp'`/`'KioskIvr'` — there is no
 * evaluation/internal value, and `Conversation` has no `origin`/`isSynthetic` column at
 * all (confirmed by direct schema read; the schema is owned by an earlier wave and is out
 * of scope for this feature to alter). A regression-run conversation is therefore
 * indistinguishable from a real citizen conversation to `ConversationMetricsDaily`'s real
 * rollups and the command-centre's analytics — a genuine, unfixed-in-this-wave data-
 * quality gap, not a silent oversight. Two partial mitigations, both real but neither
 * sufficient on their own: `intentKey` is stamped with a distinctive, greppable marker
 * (the one free-text column `Conversations` happens to carry), and `retentionExpiresAt`
 * is set to `now` — already expired at creation — so the standing retention sweep
 * reclaims the row at its very next pass rather than letting it linger for the ordinary
 * 90-day window. Neither stops it from being counted once, which is the real limitation.
 */

/** Stamped into `Conversation.intentKey` — a best-effort marker for manual identification
 *  only; nothing downstream currently filters on it (see the module doc comment above). */
export const EVALUATION_CONVERSATION_INTENT_KEY = "__evaluation_synthetic__";

export interface NewEvaluationConversationInput {
  readonly localeCode: string;
  readonly agentId: string;
  readonly now: Date;
}

export interface EvaluationConversationFactory {
  /** Returns the new conversation's id. */
  create(input: NewEvaluationConversationInput): Promise<string>;
}
