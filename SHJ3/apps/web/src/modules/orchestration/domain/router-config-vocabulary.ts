/**
 * The closed vocabularies `prisma/tenant/schema.prisma`'s `RouterConfig` model documents
 * on its own columns (`prisma/sql/001_constraints.sql`'s enum-shaped `CK_RouterConfigs_*`
 * checks — read directly, not inferred, per `tasks/lessons.md`'s "a CHECK constraint's
 * closed vocabulary is not guessable from context" lesson). Pure vocabulary, no I/O — the
 * same shape `modules/analytics/ports/conversation-explorer-repository.ts`'s
 * `CONVERSATION_OUTCOME_FILTERS` already establishes for a tenant-config enum column.
 *
 * `apps/ai/src/shj3_ai/domain/orchestration.py`'s `ExecutionMode`/`ConflictResolution`/
 * `MergePolicy` enums are the real, already-shipped Python-side twin of the three
 * execution-mode/conflict/merge values below — this file does not import across the
 * runtime boundary (there is none to import through), it simply transcribes the identical
 * three literal strings `process_turn.py` reads via `ExecutionMode(router_config.
 * execution_mode)`, confirmed by reading that file directly rather than assumed.
 */

/** `RouterConfigs.executionMode` — read fresh every turn by `ProcessTurn.execute()`
 *  (`apps/ai/src/shj3_ai/application/process_turn.py`) as a single, tenant-wide singleton
 *  that governs the WHOLE turn's pipeline shape, never a per-agent or per-screen choice —
 *  confirmed by reading that module directly: `execution_mode = ExecutionMode(router_config
 *  .execution_mode)` is resolved once, before routing, and used unconditionally for every
 *  candidate this turn invokes. This is why the Orchestrator screen renders execution mode
 *  as a read-only fact about the current tenant configuration, never a screen-level toggle
 *  a reviewer could flip independently of `RouterConfigs` itself. */
export const EXECUTION_MODES = ["Sequential", "Parallel", "SupervisorWorker"] as const;
export type ExecutionMode = (typeof EXECUTION_MODES)[number];

/** `RouterConfigs.routingStrategy`. */
export const ROUTING_STRATEGIES = ["IntentClassifier", "LlmRouter", "RuleFirst"] as const;
export type RoutingStrategy = (typeof ROUTING_STRATEGIES)[number];

/** `RouterConfigs.agentSelectionScope`. */
export const AGENT_SELECTION_SCOPES = ["AllPublished", "ChannelBound", "ExplicitList"] as const;
export type AgentSelectionScope = (typeof AGENT_SELECTION_SCOPES)[number];

/** `RouterConfigs.conflictResolution`. */
export const CONFLICT_RESOLUTIONS = [
  "HighestConfidence",
  "PreferOwningEntity",
  "SupervisorArbitrates",
] as const;
export type ConflictResolution = (typeof CONFLICT_RESOLUTIONS)[number];

/** `RouterConfigs.responseMergePolicy`. */
export const MERGE_POLICIES = [
  "ConcatenateInOrder",
  "DeduplicateOverlap",
  "SupervisorRewrite",
] as const;
export type MergePolicy = (typeof MERGE_POLICIES)[number];

/** `OrchestrationTraceSteps.kind` — the real, ordered pipeline stages `process_turn.py`
 *  appends (`TraceStepKind` on the Python side), transcribed verbatim from
 *  `prisma/tenant/schema.prisma`'s own doc comment on the column. */
export const TRACE_STEP_KINDS = [
  "GuardrailPre",
  "Route",
  "AgentInvoke",
  "ToolCall",
  "Retrieval",
  "Merge",
  "GuardrailPost",
  "Handover",
  "FlowEscape",
] as const;
export type TraceStepKind = (typeof TRACE_STEP_KINDS)[number];

/** `OrchestrationTraceSteps.status`. */
export const TRACE_STEP_STATUSES = ["Ok", "Failed", "Timeout", "Blocked", "Skipped"] as const;
export type TraceStepStatus = (typeof TRACE_STEP_STATUSES)[number];

/** `OrchestrationTraces.guardrailPreResult`/`guardrailPostResult` — deliberately no
 *  `"Refused"` value (`tasks/lessons.md`'s own T-SQL-dialect lesson names this exact
 *  vocabulary and the mistake of guessing a fifth value that was never in the CHECK). */
export const GUARDRAIL_RESULTS = ["Pass", "Blocked", "Rewritten", "Skipped"] as const;
export type GuardrailResult = (typeof GUARDRAIL_RESULTS)[number];
