// PUBLIC API for @nextbot/conversations (LLD §2.2, BL-04/06).
export { createWidgetSession, type VerifiedSandboxPreview } from "./application/create-widget-session.js";
export { sendWidgetMessage, type SendWidgetMessageDeps, type GenerateAiReplyArgs } from "./application/send-widget-message.js";
export { setWidgetTypingState } from "./application/set-widget-typing.js";
export { setWidgetLanguage } from "./application/set-widget-language.js";
export { replayMessagesSince, subscribeToConversation, type ConversationEvent } from "./application/stream-widget-events.js";
export {
  issueWidgetSessionToken,
  verifyWidgetSessionToken,
  type WidgetSessionClaims,
} from "./application/widget-session-token.js";
export { mergeWidgetConfigWithBranding } from "./application/merge-widget-config.js";
export {
  findConversationById,
  bulkApplyConversationAction,
  insertConversation,
  updateConversationStatus,
  findConversationsByCustomerIdentifier,
  deleteConversationsByCustomerIdentifier,
  findConversationIdsOlderThan,
  deleteConversationsByIds,
  redactRawPiiOlderThan,
  findOrCreateConversationForChannelCustomer,
  updateConversationLastInboundAt,
  // Target Architecture Blueprint Phase 19 (BL-50, FR-OC-08) — cross-channel identity
  // resolution: the admin "record a confirmed customer identifier" action and its
  // exact-hash-match lookup.
  updateConversationCustomerIdentifier,
  findConversationsByCustomerIdentifierHash,
  type ConversationRow,
} from "./infrastructure/conversation-repository.js";
export { resolveLinkedConversations, type LinkedConversationSummary } from "./application/identity-resolution.js";
export { computeCustomerIdentifierHash } from "./domain/customer-identifier-hash.js";
export {
  listMessagesSince,
  findMessageByClientId,
  insertMessage,
  // Target Architecture Blueprint Phase 17 (BL-48, ADR-0019 §2.5) — READ-ONLY transcript
  // accessors added for shadow evaluation's pointer-dereferencing replay. Both return
  // "absent" rather than throwing when the conversation has been purged, which is the
  // `Skipped(SourceGone)` outcome the shadow pump depends on.
  findMessageById,
  listMessagesUpToSequence,
  type MessageRow,
} from "./infrastructure/message-repository.js";
export { publishConversationEvent, _resetMessageBusForTests } from "./infrastructure/message-bus.js";
export { sweepIdleConversationsForTenant, sweepIdleConversationsAcrossAllTenants, type IdleSweepResult } from "./application/idle-sweeper.js";
export { decideIdleResolution, type IdleSweepDecision } from "./domain/idle-sweep-decision.js";
export {
  listConversationsForAdmin,
  listAllConversationsForExport,
  getConversationDetailForAdmin,
  type ConversationListFilters,
  type ConversationListItem,
  type ConversationDetail,
} from "./application/admin-conversation-query.js";
export {
  handleCreateWidgetSession,
  handleVerifyWidgetSession,
  handleSendWidgetMessage,
  handleSetWidgetTyping,
  handleSetWidgetLanguage,
  handleReplaySince,
  handleSubscribe,
} from "./http/widget-routes.js";
