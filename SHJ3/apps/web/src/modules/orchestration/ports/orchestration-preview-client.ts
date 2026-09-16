/**
 * `/orchestrator`'s "test a prompt" simulator — `POST /v1/orchestration/trace-preview`
 * (`apps/ai`'s `orchestration_preview_router.py`). Runs the real `ProcessTurn` pipeline
 * against the tenant's ACTUAL, currently-saved `RouterConfig` — never a hypothetical one —
 * so the result is an honest answer to "what would this saved configuration actually do
 * with this prompt," not a guess.
 *
 * Deliberately writes no real `Conversations`/`ConversationTurns`/`OrchestrationTraces`
 * row and never spends real money, regardless of whether the tenant has a real model API
 * key configured — see that router's own module doc comment for exactly how (the
 * sandbox-testing ports it reuses, plus one deliberate deviation: an unconditional
 * deterministic chat model, never the environment-conditional real one).
 *
 * Response shape mirrors `apps/ai`'s own `TurnEnvelopeOut` field for field — the identical
 * wire shape `modules/flows/ports/flow-sandbox-client.ts`'s `SendSandboxTurnResult` already
 * establishes for the same underlying Python type, reused here under this module's own
 * names rather than importing across feature-module boundaries.
 */

export interface PreviewMessage {
  readonly role: string;
  readonly content: string;
  readonly suggestions: readonly string[];
}

export interface PreviewTraceStep {
  readonly ordinal: number;
  readonly kind: string;
  readonly label: string;
  readonly status: string;
  readonly durationMs: number;
  readonly agentId: string | null;
  readonly toolBindingId: string | null;
  readonly confidence: number | null;
  readonly errorCode: string | null;
  readonly isSecondaryAgent: boolean;
  // Purely additive — `null` for every legacy-mode step. Populated only when `mode ===
  // "Pipeline"` (`apps/ai`'s `ExecutePipeline` graph interpreter).
  readonly pipelineNodeKey: string | null;
  readonly fromNodeKey: string | null;
  readonly edgeKind: string | null;
  readonly branchId: string | null;
  readonly loopIteration: number | null;
  readonly depth: number | null;
}

export interface PreviewTrace {
  readonly traceId: string;
  readonly mode: string;
  readonly hops: readonly PreviewTraceStep[];
  readonly degraded: readonly string[];
  readonly escapeTriggered: boolean;
  readonly usedFallbackModel: boolean;
  // Purely additive — `null` whenever `mode !== "Pipeline"`.
  readonly pipelineVersionId: string | null;
  readonly pipelineLabel: string | null;
  readonly terminalNodeKey: string | null;
}

export interface PreviewUsage {
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly costAed: number;
  readonly modelCalls: number;
  readonly toolCalls: number;
}

export interface PreviewTraceInput {
  // Required unless `pipelineVersionId` names a pipeline whose entry resolves without a
  // turn-bound agent (a fixed-`agentId`/`agentVersionPinId` entry node) — mirrors
  // `apps/ai`'s own `TracePreviewIn.primaryAgentId` relaxation exactly.
  readonly primaryAgentId?: string;
  readonly content: string;
  readonly locale: string;
  // Unset (the default): dry-runs the tenant's real ACTIVE, Published pipeline (or the
  // legacy dispatcher, if none is active). Set: pins this SPECIFIC pipeline version —
  // Draft included — letting an admin dry-run a pipeline before publishing it.
  readonly pipelineVersionId?: string;
}

export interface PreviewTraceResult {
  readonly turnId: string;
  readonly conversationId: string;
  readonly status: string;
  readonly message: PreviewMessage;
  readonly trace: PreviewTrace;
  readonly usage: PreviewUsage;
  readonly groundingConfidence: number | null;
}

export interface OrchestrationPreviewClient {
  previewTrace(input: PreviewTraceInput): Promise<PreviewTraceResult>;
}
