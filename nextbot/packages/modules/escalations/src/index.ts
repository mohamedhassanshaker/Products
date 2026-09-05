// PUBLIC API for @nextbot/escalations — the ONLY file other packages may import from
// (LLD §2.2). Phase 16 (BL-09): escalation queue, routing, live human takeover,
// return-to-bot.

// domain
export {
  resolveRoutingQueue,
  type RoutingRule,
  type RoutingRuleConditions,
  type RoutingContext,
  type RoutingResolution,
  type EscalationReasonValue,
} from "./domain/escalation-routing.js";
export {
  assertValidEscalationTransition,
  isTerminalEscalationStatus,
  IllegalEscalationTransition,
  TERMINAL_ESCALATION_STATUSES,
  type EscalationStatusValue,
} from "./domain/escalation-fsm.js";

// application
export { triggerEscalation, HUMAN_HANDOFF_CONNECTING_TEXT, type TriggerEscalationInput, type TriggerEscalationResult } from "./application/trigger-escalation.js";
export {
  claimEscalation,
  reassignEscalation,
  EscalationAlreadyClaimedError,
  AgentAtConcurrencyCeilingError,
} from "./application/claim-escalation.js";
export { returnToBot, resolveEscalation, RETURN_TO_BOT_TEXT } from "./application/return-to-bot.js";
export { sendHumanAgentMessage, EscalationNotInProgressError } from "./application/send-human-message.js";
export { draftAiSuggestion, DraftReplySchema, type DraftReplyResult } from "./application/draft-reply.js";
export { listEscalationsForAdmin, getEscalationDetail, type EscalationQueueItem, type EscalationDetail } from "./application/list-escalations.js";
export { listRoutingRules, replaceRoutingRules, RoutingRuleQueueNotFoundError } from "./application/routing-rules-service.js";
// Target Architecture Blueprint Phase 13 (BL-45, FR-ESC-05).
export {
  getOrCreateAgentPresence,
  listAgentPresenceForTenant,
  setMyPresenceState,
  setAgentMaxConcurrent,
} from "./application/agent-presence-service.js";
export { sweepEscalationSla, type EscalationSlaSweepResult } from "./application/sla-sweep-service.js";

// infrastructure
export {
  findEscalationById,
  findEscalationsByConversationIds,
  deleteEscalationsByConversationIds,
  // Target Architecture Blueprint Phase 14 (BL-46, FR-ORC-06) — attaches a
  // delegation run + its full chain to the ONE active escalation this module's
  // existing partial unique index already guarantees per conversation.
  attachDelegationContextToEscalation,
  type EscalationRow,
} from "./infrastructure/escalation-repository.js";
export {
  listAgentQueues,
  findAgentQueueById,
  findDefaultAgentQueue,
  ensureDefaultQueue,
  createAgentQueue,
  updateAgentQueue,
  type AgentQueueRow,
} from "./infrastructure/agent-queue-repository.js";
// Target Architecture Blueprint Phase 13 (BL-45, FR-ESC-05).
export { findAgentPresence, type AgentPresenceRow, type AgentPresenceStateValue } from "./infrastructure/agent-presence-repository.js";
export {
  listAssignmentLogForEscalation,
  type EscalationAssignmentLogRow,
  type EscalationAssignmentActionValue,
} from "./infrastructure/escalation-assignment-log-repository.js";
