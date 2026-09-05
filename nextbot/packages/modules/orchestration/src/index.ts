// PUBLIC API for the "orchestration" module (LLD §2.2, BL-05/BL-12). Phase 12 stands
// up the Tier-1 turn pipeline (param-extract -> guardrail-eval -> tier-engine ->
// dispatch); Tier-2/3 suspension (BL-08) and tool-chain composition (BL-12) are later
// phases' additions to this same public surface.

export { runTurnPipeline, type TurnPipelineInput, type TurnPipelineDeps, type TurnPipelineResult } from "./application/turn-pipeline.js";
export { extractToolCall, type ExtractedToolCall, type ParamExtractResult } from "./application/param-extract.js";
export { runTierEngine, type TierOutcome } from "./application/tier-engine.js";
export { selectGoalAndTool, GoalSelectionResultSchema, type GoalSelectionResult, type CatalogEntryForSelection } from "./application/goal-selection.js";
export { evaluateGuardrails, type GuardrailDecision, type GuardrailEvalContext, type StubGuardrailRule } from "./domain/guardrail-eval.js";
export { selectRenderedCard } from "./domain/render-selection.js";
export { backendTimeoutFallback, goalNotUnderstoodFallback, toolCallFailureFallback, humanHandoffFallback } from "./domain/fallback-messages.js";
export { maskArgsForLogging } from "./domain/mask-args.js";
export { appendDomainEvent, type DomainEventInput } from "./infrastructure/domain-event-repository.js";
export type { EgressPort } from "./ports/egress.js";

// Phase 14 (BL-08) — Tier-2/3 approval-tier state machine (LLD §6).
export {
  createSuspendedToolCall,
  decideTier2,
  decideTier3,
  type CreateSuspendedCallInput,
  // Target Architecture Blueprint Phase 14 (BL-46, FR-ORC-04) — the delegation
  // chain a team member's tool call carries into the Approval Queue.
  type ToolCallDelegationContext,
} from "./application/approval-service.js";

// Target Architecture Blueprint Phase 14 (BL-46, FR-ORC-09) — "output guardrails on
// tool results run BEFORE a tool result or retrieved chunk crosses a delegation
// boundary into another agent's context, not only before it reaches the customer."
// `@nextbot/teams`' delegation executor screens each hand-off payload with THIS
// scanner — the same already-shipped `PostToolResult` injection guardrail the turn
// pipeline uses, never a second detector with its own (drifting) pattern set.
export { scanValueForPromptInjection, type InjectionScanResult } from "./domain/injection-guardrail.js";
export { transition, isTerminal, TERMINAL_STATUSES, IllegalToolCallTransition } from "./domain/tool-call-fsm.js";
export {
  findToolCallById,
  // Target Architecture Blueprint Phase 17 (BL-48) — the live side of shadow
  // evaluation's tool-call divergence figure, and the assertion its containment tests
  // use to prove a shadow run wrote ZERO `tool_call` rows.
  countToolCallsForAgentRun,
  listPendingApprovalRequests,
  findApprovalRequestByToolCallId,
  findExpiredSuspendedToolCalls,
  SUSPENDED_TOOL_CALL_STATUSES,
  type ToolCallRow,
  type ApprovalRequestRow,
} from "./infrastructure/tool-call-repository.js";

// Target Architecture Blueprint Phase 16 (BL-47b, ADR-0013 §7.4) — the Tier-2/Tier-3
// approval-expiry sweeper. `sweepExpiredApprovals` backs `apps/worker`'s
// `approvals.expiry-sweep` job; `expireSuspendedToolCall` is the SHARED primitive
// `@nextbot/workflows`' `workflow.suspension-expiry-sweep` delegates to, so a
// workflow run suspended on a Human task and the Approval Queue row behind it can
// never be governed by two clocks that disagree.
export {
  expireSuspendedToolCall,
  sweepExpiredApprovals,
  TIER2_TIMEOUT_MS,
  TIER3_TIMEOUT_MS,
  type ApprovalExpiryResult,
  type ApprovalExpirySweepResult,
} from "./application/approval-expiry-service.js";
